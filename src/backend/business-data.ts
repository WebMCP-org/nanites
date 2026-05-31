import { desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { DbClient } from "@nanites/db/client";
import {
  accountInstallations,
  accountInstallationRepositoryMap,
  accountPeople,
  accountRepositories,
  accounts,
  aiUsageFacts,
  authFunnelFacts,
  naniteRunFacts,
  platformUsageFacts,
  type InstallationStatus,
} from "@nanites/db/schema/business";
import {
  backfillAiUsageFactCosts,
  ensureAiPricingSnapshot,
  markAccountInstallationRemoved,
  persistInstallationRepositoriesSnapshot,
  recordAuthFunnelFact,
  upsertAccountInstallationSnapshot,
} from "@nanites/db/mutations/business";
import { githubInstallationIdSchema } from "@nanites/contracts/ids";
import {
  buildResolvedAiCostUsdMicrosSumSql,
  listAccountAiUsageByMonth,
  listAccountAiUsageByPerson,
  listAdminAiUsageByPerson,
  listAdminAiUsageByRun,
  listAdminValueByAccount,
} from "#/backend/admin-business-data-queries.ts";
import {
  listGitHubAppInstallations,
  listReposAccessibleToInstallation,
  toInstallationRepositories,
  type GitHubAppInstallation,
} from "#/backend/github.ts";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function microsToUsd(value: number | null | undefined): number {
  return value == null ? 0 : value / 1_000_000;
}

function summarizeInstallState(statuses: readonly InstallationStatus[]) {
  if (statuses.includes("active")) {
    return "active" as const;
  }

  if (statuses.includes("suspended")) {
    return "suspended" as const;
  }

  return "removed" as const;
}

function toInstallationStatus(
  installation: GitHubAppInstallation,
): Extract<InstallationStatus, "active" | "suspended"> {
  return installation.suspended_at ? "suspended" : "active";
}

function normalizeGitHubInstallationAccount(account: GitHubAppInstallation["account"]) {
  if (!account || typeof account.id !== "number") {
    throw new Error("GitHub App installation is missing an owner account id.");
  }

  const login =
    ("login" in account && typeof account.login === "string" && account.login.length > 0
      ? account.login
      : null) ??
    ("slug" in account && typeof account.slug === "string" && account.slug.length > 0
      ? account.slug
      : null) ??
    (typeof account.name === "string" && account.name.length > 0 ? account.name : null);
  if (!login) {
    throw new Error("GitHub App installation is missing an owner login.");
  }

  return {
    id: account.id,
    login,
    type: account.type === "User" ? ("User" as const) : ("Organization" as const),
    avatarUrl: typeof account.avatar_url === "string" ? account.avatar_url : null,
  };
}

export async function ensureWorkersAiPricingSnapshot(db: DbClient): Promise<void> {
  // Workers AI does not currently provide billed USD totals in the usage payloads we persist here,
  // so business facts depend on local pricing snapshots keyed by canonical provider/model ids.
  await ensureAiPricingSnapshot(db, {
    provider: "workers-ai",
    model: "@cf/moonshotai/kimi-k2.6",
    effectiveAt: new Date("2026-04-20T00:00:00.000Z"),
    inputTokenCostPerMillionUsdMicros: 950_000,
    cachedInputTokenCostPerMillionUsdMicros: 160_000,
    outputTokenCostPerMillionUsdMicros: 4_000_000,
  });
  await ensureAiPricingSnapshot(db, {
    provider: "workers-ai",
    model: "@cf/google/gemma-4-26b-a4b-it",
    effectiveAt: new Date("2026-04-10T00:00:00.000Z"),
    inputTokenCostPerMillionUsdMicros: 100_000,
    cachedInputTokenCostPerMillionUsdMicros: null,
    outputTokenCostPerMillionUsdMicros: 300_000,
  });
}

export async function syncGitHubInstallationsToBusinessData(input: {
  db: DbClient;
  env: Env;
}): Promise<{ syncedAt: string }> {
  const syncedAt = new Date();
  const installations = await listGitHubAppInstallations(input.env);

  const persistedInstallations = await input.db.query.accountInstallations.findMany({
    columns: {
      githubInstallationId: true,
    },
  });
  const activeIds = new Set<number>();

  for (const installation of installations) {
    activeIds.add(installation.id);
    const account = normalizeGitHubInstallationAccount(installation.account);
    const status = toInstallationStatus(installation);
    const { accountId } = await upsertAccountInstallationSnapshot(input.db, {
      githubInstallationId: installation.id,
      githubAccountId: account.id,
      githubAccountLogin: account.login,
      githubAccountType: account.type,
      githubAccountAvatarUrl: account.avatarUrl,
      status,
      seenAt: syncedAt,
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    });

    if (status !== "active") {
      continue;
    }

    const repositories = toInstallationRepositories(
      await listReposAccessibleToInstallation({
        env: input.env,
        githubInstallationId: githubInstallationIdSchema.parse(installation.id),
      }),
    );
    await persistInstallationRepositoriesSnapshot(input.db, {
      accountId,
      githubInstallationId: installation.id,
      repositories: repositories.map((repository) => ({
        githubRepositoryId: repository.id,
        name: repository.name,
        fullName: repository.full_name,
        ownerLogin: repository.owner.login,
        defaultBranch: repository.default_branch,
        private: repository.private,
      })),
      seenAt: syncedAt,
    });
  }

  for (const installation of persistedInstallations) {
    if (activeIds.has(installation.githubInstallationId)) {
      continue;
    }

    await markAccountInstallationRemoved(input.db, installation.githubInstallationId, syncedAt);
  }

  await ensureWorkersAiPricingSnapshot(input.db);
  await backfillAiUsageFactCosts(input.db);

  return {
    syncedAt: syncedAt.toISOString(),
  };
}

function buildRiskFlags(input: {
  repoCount: number;
  installState: InstallationStatus;
  lastActiveAt: Date | null;
  monthlyRunCount: number;
}): string[] {
  const flags: string[] = [];

  if (input.installState !== "active") {
    flags.push("installation_not_active");
  }

  if (input.repoCount === 0) {
    flags.push("no_connected_repositories");
  }

  if (!input.lastActiveAt || input.lastActiveAt < daysAgo(30)) {
    flags.push("dormant");
  }

  if (input.repoCount > 0 && input.monthlyRunCount === 0) {
    flags.push("no_recent_runs");
  }

  return flags;
}

export async function getAdminOverviewSnapshot(db: DbClient) {
  const since30d = daysAgo(30);

  const [installRow, activeInstallRow, repoRow, activePeopleRow, runRow, aiCostRow] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(accountInstallations),
      db
        .select({ count: sql<number>`count(*)` })
        .from(accountInstallations)
        .where(eq(accountInstallations.status, "active")),
      db
        .select({
          count: sql<number>`count(distinct ${accountInstallationRepositoryMap.githubRepositoryId})`,
        })
        .from(accountInstallationRepositoryMap),
      db
        .select({ count: sql<number>`count(distinct ${accountPeople.id})` })
        .from(accountPeople)
        .where(gte(accountPeople.lastActiveAt, since30d)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(naniteRunFacts)
        .where(gte(naniteRunFacts.startedAt, since30d)),
      db
        .select({ total: buildResolvedAiCostUsdMicrosSumSql() })
        .from(aiUsageFacts)
        .where(gte(aiUsageFacts.completedAt, since30d)),
    ]);

  const funnelRows = await db
    .select({
      eventType: authFunnelFacts.eventType,
      count: sql<number>`count(*)`,
    })
    .from(authFunnelFacts)
    .groupBy(authFunnelFacts.eventType);

  const completedRunRows = await db
    .select({
      total: sql<number>`count(*)`,
      failures: sql<number>`sum(case when ${naniteRunFacts.conclusion} = 'failure' then 1 else 0 end)`,
    })
    .from(naniteRunFacts)
    .where(eq(naniteRunFacts.status, "completed"));

  const failureRows = await db
    .select({
      reason: naniteRunFacts.implicitFailureReason,
      count: sql<number>`count(*)`,
    })
    .from(naniteRunFacts)
    .where(isNotNull(naniteRunFacts.implicitFailureReason))
    .groupBy(naniteRunFacts.implicitFailureReason)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  const funnelMap = new Map(funnelRows.map((row) => [row.eventType, row.count]));
  const completedRuns = completedRunRows[0];

  return {
    syncedAt: new Date().toISOString(),
    installsTotal: installRow[0]?.count ?? 0,
    activeInstalls: activeInstallRow[0]?.count ?? 0,
    connectedRepos: repoRow[0]?.count ?? 0,
    activePeople30d: activePeopleRow[0]?.count ?? 0,
    monthlyRuns: runRow[0]?.count ?? 0,
    estimatedMonthlyAiCostUsd: microsToUsd(aiCostRow[0]?.total),
    authFunnel: {
      oauthStarted: funnelMap.get("github_oauth_started") ?? 0,
      oauthSucceeded: funnelMap.get("github_oauth_callback_succeeded") ?? 0,
      oauthFailed: funnelMap.get("github_oauth_callback_failed") ?? 0,
      installationRevoked: funnelMap.get("active_installation_revoked") ?? 0,
      zeroRepoViews: funnelMap.get("active_installation_zero_repositories") ?? 0,
    },
    quality: {
      runFailureRate:
        completedRuns && completedRuns.total > 0 ? completedRuns.failures / completedRuns.total : 0,
      topImplicitFailureReasons: failureRows.flatMap((row) =>
        row.reason ? [{ reason: row.reason, count: row.count }] : [],
      ),
    },
  };
}

export async function listAdminAccounts(db: DbClient) {
  const since30d = daysAgo(30);

  const [accountRows, installationRows, repoRows, memberRows, activeUserRows, runRows, aiRows] =
    await Promise.all([
      db.query.accounts.findMany({
        orderBy: [accounts.githubAccountLogin],
      }),
      db.query.accountInstallations.findMany(),
      db
        .select({
          accountId: accountRepositories.accountId,
          repoCount: sql<number>`count(distinct ${accountRepositories.githubRepositoryId})`,
        })
        .from(accountRepositories)
        .innerJoin(
          accountInstallationRepositoryMap,
          eq(
            accountRepositories.githubRepositoryId,
            accountInstallationRepositoryMap.githubRepositoryId,
          ),
        )
        .groupBy(accountRepositories.accountId),
      db
        .select({
          accountId: accountPeople.accountId,
          memberCount: sql<number>`count(*)`,
        })
        .from(accountPeople)
        .groupBy(accountPeople.accountId),
      db
        .select({
          accountId: accountPeople.accountId,
          activeUserCount: sql<number>`count(*)`,
        })
        .from(accountPeople)
        .where(gte(accountPeople.lastActiveAt, since30d))
        .groupBy(accountPeople.accountId),
      db
        .select({
          accountId: naniteRunFacts.accountId,
          monthlyRunCount: sql<number>`count(*)`,
        })
        .from(naniteRunFacts)
        .where(gte(naniteRunFacts.startedAt, since30d))
        .groupBy(naniteRunFacts.accountId),
      db
        .select({
          accountId: aiUsageFacts.accountId,
          monthlyAiCostUsdMicros: buildResolvedAiCostUsdMicrosSumSql(),
        })
        .from(aiUsageFacts)
        .where(gte(aiUsageFacts.completedAt, since30d))
        .groupBy(aiUsageFacts.accountId),
    ]);

  const installationMap = new Map<string, typeof installationRows>();
  for (const row of installationRows) {
    const list = installationMap.get(row.accountId) ?? [];
    list.push(row);
    installationMap.set(row.accountId, list);
  }

  const repoCountByAccount = new Map(repoRows.map((row) => [row.accountId, row.repoCount]));
  const memberCountByAccount = new Map(memberRows.map((row) => [row.accountId, row.memberCount]));
  const activeUsersByAccount = new Map(
    activeUserRows.map((row) => [row.accountId, row.activeUserCount]),
  );
  const runCountByAccount = new Map(runRows.map((row) => [row.accountId, row.monthlyRunCount]));
  const aiByAccount = new Map(
    aiRows.map((row) => [row.accountId, microsToUsd(row.monthlyAiCostUsdMicros)]),
  );

  return {
    accounts: accountRows.map((account) => {
      const installState = summarizeInstallState(
        (installationMap.get(account.id) ?? []).map((row) => row.status),
      );
      const repoCount = repoCountByAccount.get(account.id) ?? 0;
      const monthlyRunCount = runCountByAccount.get(account.id) ?? 0;

      return {
        accountId: account.id,
        githubAccountId: account.githubAccountId,
        login: account.githubAccountLogin,
        ownerType: account.githubAccountType,
        avatarUrl: account.githubAccountAvatarUrl,
        installState,
        repoCount,
        memberCount: memberCountByAccount.get(account.id) ?? 0,
        activeUserCount30d: activeUsersByAccount.get(account.id) ?? 0,
        lastActiveAt: account.lastActiveAt?.toISOString() ?? null,
        monthlyRunCount,
        monthlyAiCostUsd: aiByAccount.get(account.id) ?? 0,
        riskFlags: buildRiskFlags({
          repoCount,
          installState,
          lastActiveAt: account.lastActiveAt ?? null,
          monthlyRunCount,
        }),
      };
    }),
  };
}

export async function getAdminAccountDetail(db: DbClient, accountId: string) {
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!account) {
    return null;
  }

  const list = await listAdminAccounts(db);
  const accountRow = list.accounts.find((candidate) => candidate.accountId === accountId);
  if (!accountRow) {
    return null;
  }

  const [
    installations,
    repositories,
    people,
    recentRuns,
    aiUsageRows,
    aiUsageByPerson,
    platformRows,
  ] = await Promise.all([
    db.query.accountInstallations.findMany({
      where: eq(accountInstallations.accountId, accountId),
      orderBy: [desc(accountInstallations.lastSeenAt)],
    }),
    db.query.accountRepositories.findMany({
      where: eq(accountRepositories.accountId, accountId),
      orderBy: [accountRepositories.fullName],
    }),
    db.query.accountPeople.findMany({
      where: eq(accountPeople.accountId, accountId),
      orderBy: [desc(accountPeople.lastActiveAt)],
    }),
    db.query.naniteRunFacts.findMany({
      where: eq(naniteRunFacts.accountId, accountId),
      orderBy: [desc(naniteRunFacts.lastUpdatedAt)],
      limit: 25,
    }),
    listAccountAiUsageByMonth(db, accountId),
    listAccountAiUsageByPerson(db, accountId),
    db
      .select({
        category: platformUsageFacts.category,
        eventCount: sql<number>`count(*)`,
        totalDurationMs: sql<number>`coalesce(sum(${platformUsageFacts.durationMs}), 0)`,
      })
      .from(platformUsageFacts)
      .where(eq(platformUsageFacts.accountId, accountId))
      .groupBy(platformUsageFacts.category),
  ]);

  const runAiUsageRows = await db
    .select({
      githubRepositoryId: aiUsageFacts.githubRepositoryId,
      runKey: aiUsageFacts.runKey,
      estimatedCostUsdMicros: buildResolvedAiCostUsdMicrosSumSql(),
    })
    .from(aiUsageFacts)
    .where(eq(aiUsageFacts.accountId, accountId))
    .groupBy(aiUsageFacts.githubRepositoryId, aiUsageFacts.runKey);

  const runCostByKey = new Map(
    runAiUsageRows.flatMap((row) =>
      row.githubRepositoryId && row.runKey
        ? [[`${row.githubRepositoryId}:${row.runKey}`, microsToUsd(row.estimatedCostUsdMicros)]]
        : [],
    ),
  );

  return {
    account: {
      accountId: accountRow.accountId,
      githubAccountId: accountRow.githubAccountId,
      login: accountRow.login,
      ownerType: accountRow.ownerType,
      avatarUrl: accountRow.avatarUrl,
      installState: accountRow.installState,
      lastActiveAt: accountRow.lastActiveAt,
      riskFlags: accountRow.riskFlags,
    },
    installations: installations.map((installation) => ({
      githubInstallationId: installation.githubInstallationId,
      status: installation.status,
      firstSeenAt: installation.firstSeenAt.toISOString(),
      lastSeenAt: installation.lastSeenAt.toISOString(),
      suspendedAt: installation.suspendedAt?.toISOString() ?? null,
      removedAt: installation.removedAt?.toISOString() ?? null,
    })),
    repositories: repositories.map((repository) => ({
      githubRepositoryId: repository.githubRepositoryId,
      name: repository.name,
      fullName: repository.fullName,
      private: repository.private,
      permissionTier: repository.permissionTier,
      configEnabled: repository.configEnabled,
      configuredNaniteCount: repository.configuredNaniteCount,
      mcpServerCount: repository.mcpServerCount,
      missingSoulDocumentCount: repository.missingSoulDocumentCount,
      missingSkillDocumentCount: repository.missingSkillDocumentCount,
      brokenPromptConfig: repository.brokenPromptConfig,
      lastViewedAt: repository.lastViewedAt?.toISOString() ?? null,
      lastRunAt: repository.lastRunAt?.toISOString() ?? null,
      lastActiveAt: repository.lastActiveAt?.toISOString() ?? null,
      runCount: recentRuns.filter((run) => run.githubRepositoryId === repository.githubRepositoryId)
        .length,
    })),
    people: people.map((person) => ({
      githubUserId: person.githubUserId,
      login: person.githubLogin,
      relationship: person.relationship,
      lastSignedInAt: person.lastSignedInAt?.toISOString() ?? null,
      lastActiveAt: person.lastActiveAt?.toISOString() ?? null,
    })),
    recentRuns: recentRuns.map((run) => ({
      runKey: run.runKey,
      repositoryFullName: run.repositoryFullName,
      naniteId: run.naniteId,
      variant: run.variant,
      triggerKind: run.triggerKind,
      status: run.status,
      conclusion: run.conclusion,
      phase: run.phase,
      summary: run.summary,
      implicitFailureReason: run.implicitFailureReason,
      estimatedCostUsd: runCostByKey.get(`${run.githubRepositoryId}:${run.runKey}`) ?? 0,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    })),
    aiUsageByMonth: aiUsageRows,
    aiUsageByPerson,
    platformUsage: platformRows.map((row) => ({
      category: row.category,
      eventCount: row.eventCount,
      totalDurationMs: row.totalDurationMs,
    })),
  };
}

export async function listAdminPeople(db: DbClient) {
  const people = await db
    .select({
      accountId: accountPeople.accountId,
      accountLogin: accounts.githubAccountLogin,
      githubUserId: accountPeople.githubUserId,
      login: accountPeople.githubLogin,
      relationship: accountPeople.relationship,
      lastSignedInAt: accountPeople.lastSignedInAt,
      lastActiveAt: accountPeople.lastActiveAt,
    })
    .from(accountPeople)
    .innerJoin(accounts, eq(accountPeople.accountId, accounts.id))
    .orderBy(desc(accountPeople.lastActiveAt))
    .limit(250);

  return {
    people: people.map((person) => ({
      accountId: person.accountId,
      accountLogin: person.accountLogin,
      githubUserId: person.githubUserId,
      login: person.login,
      relationship: person.relationship,
      lastSignedInAt: person.lastSignedInAt?.toISOString() ?? null,
      lastActiveAt: person.lastActiveAt?.toISOString() ?? null,
    })),
  };
}

export async function getAdminUsageSnapshot(db: DbClient) {
  const [aiByModel, aiByAccount, aiByPerson, aiByRun, platformByAccount, valueByAccount] =
    await Promise.all([
      db
        .select({
          provider: aiUsageFacts.provider,
          model: aiUsageFacts.model,
          turnCount: sql<number>`count(*)`,
          inputTokens: sql<number>`coalesce(sum(${aiUsageFacts.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${aiUsageFacts.outputTokens}), 0)`,
          totalTokens: sql<number>`coalesce(sum(${aiUsageFacts.totalTokens}), 0)`,
          estimatedCostUsdMicros: buildResolvedAiCostUsdMicrosSumSql(),
        })
        .from(aiUsageFacts)
        .groupBy(aiUsageFacts.provider, aiUsageFacts.model)
        .orderBy(desc(buildResolvedAiCostUsdMicrosSumSql())),
      db
        .select({
          accountId: aiUsageFacts.accountId,
          accountLogin: accounts.githubAccountLogin,
          turnCount: sql<number>`count(*)`,
          inputTokens: sql<number>`coalesce(sum(${aiUsageFacts.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${aiUsageFacts.outputTokens}), 0)`,
          totalTokens: sql<number>`coalesce(sum(${aiUsageFacts.totalTokens}), 0)`,
          estimatedCostUsdMicros: buildResolvedAiCostUsdMicrosSumSql(),
        })
        .from(aiUsageFacts)
        .innerJoin(accounts, eq(aiUsageFacts.accountId, accounts.id))
        .groupBy(aiUsageFacts.accountId, accounts.githubAccountLogin)
        .orderBy(desc(buildResolvedAiCostUsdMicrosSumSql())),
      listAdminAiUsageByPerson(db),
      listAdminAiUsageByRun(db),
      db
        .select({
          accountId: platformUsageFacts.accountId,
          accountLogin: accounts.githubAccountLogin,
          githubOperationCount: sql<number>`sum(case when ${platformUsageFacts.category} = 'github-api' then 1 else 0 end)`,
          browserVerificationCount: sql<number>`sum(case when ${platformUsageFacts.category} = 'browser-verification' then 1 else 0 end)`,
          workspaceHydrationCount: sql<number>`sum(case when ${platformUsageFacts.category} = 'workspace-hydration' then 1 else 0 end)`,
          totalWorkspaceHydrationMs: sql<number>`coalesce(sum(case when ${platformUsageFacts.category} = 'workspace-hydration' then ${platformUsageFacts.durationMs} else 0 end), 0)`,
        })
        .from(platformUsageFacts)
        .innerJoin(accounts, eq(platformUsageFacts.accountId, accounts.id))
        .where(isNotNull(platformUsageFacts.accountId))
        .groupBy(platformUsageFacts.accountId, accounts.githubAccountLogin)
        .orderBy(desc(sql`coalesce(sum(${platformUsageFacts.durationMs}), 0)`)),
      listAdminValueByAccount(db),
    ]);

  return {
    aiByModel: aiByModel.map((row) => ({
      provider: row.provider,
      model: row.model,
      turnCount: row.turnCount,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      estimatedCostUsd: microsToUsd(row.estimatedCostUsdMicros),
    })),
    aiByAccount: aiByAccount.map((row) => ({
      accountId: row.accountId,
      accountLogin: row.accountLogin,
      turnCount: row.turnCount,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      estimatedCostUsd: microsToUsd(row.estimatedCostUsdMicros),
    })),
    aiByPerson,
    aiByRun,
    platformByAccount: platformByAccount.flatMap((row) =>
      row.accountId
        ? [
            {
              accountId: row.accountId,
              accountLogin: row.accountLogin,
              githubOperationCount: row.githubOperationCount,
              browserVerificationCount: row.browserVerificationCount,
              workspaceHydrationCount: row.workspaceHydrationCount,
              totalWorkspaceHydrationMs: row.totalWorkspaceHydrationMs,
            },
          ]
        : [],
    ),
    valueByAccount: valueByAccount.map((row) => ({
      accountId: row.accountId,
      accountLogin: row.accountLogin,
      runCount: row.runCount,
    })),
  };
}

export async function recordAccountAuthFunnelEvent(input: {
  db: DbClient;
  accountId?: string | null;
  githubInstallationId?: number | null;
  githubRepositoryId?: number | null;
  githubUserId?: number | null;
  githubLogin?: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await recordAuthFunnelFact(input.db, {
      accountId: input.accountId ?? null,
      githubInstallationId: input.githubInstallationId ?? null,
      githubRepositoryId: input.githubRepositoryId ?? null,
      githubUserId: input.githubUserId ?? null,
      githubLogin: input.githubLogin ?? null,
      eventType: input.eventType,
      metadata: input.metadata,
    });
  } catch (error) {
    console.warn("auth_funnel_event.record_failed", {
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
