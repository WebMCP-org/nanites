/**
 * Business-table persistence commands.
 *
 * Ownership:
 * - Command types in this file should be composed from `db/zod`-derived insert types whenever the
 *   fields already exist in persisted schemas.
 * - Canonical persisted row and insert schemas belong in `zod/business.ts`.
 * - Use shared enum and ID ownership from `schema/` and `@nanites/domain`; do not re-declare them
 *   inline here.
 * - Prefer `createInsertSchema`-derived types when a value is table-shaped. Keep local command
 *   extras when an operation spans multiple tables, counters, JSON encoding, or derived behavior.
 */
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { DbClient } from "../client.ts";
import {
  accountEntitlements,
  accountInstallations,
  accountInstallationRepositoryMap,
  accountPeople,
  accountRepositories,
  accounts,
  aiPricingSnapshots,
  aiUsageFacts,
  authFunnelFacts,
  naniteRunFacts,
  platformUsageFacts,
  type RepositoryPermissionTier,
} from "../schema/business.ts";
import type {
  AccountInsert,
  AccountInstallationInsert,
  AccountPersonInsert,
  AccountRepositoryInsert,
  AiPricingSnapshotInsert,
  AiUsageFactInsert,
  AuthFunnelFactInsert,
  NaniteRunFactInsert,
  PlatformUsageFactInsert,
} from "../zod/business.ts";

type Defined<T> = Exclude<T, undefined>;

type InstallationSnapshotInput = {
  githubInstallationId: Defined<AccountInstallationInsert["githubInstallationId"]>;
  githubAccountId: Defined<AccountInsert["githubAccountId"]>;
  githubAccountLogin: Defined<AccountInsert["githubAccountLogin"]>;
  githubAccountType: Defined<AccountInsert["githubAccountType"]>;
  githubAccountAvatarUrl: Defined<AccountInsert["githubAccountAvatarUrl"]>;
  status: Defined<AccountInstallationInsert["status"]>;
  seenAt?: Defined<AccountInstallationInsert["lastSeenAt"]>;
  suspendedAt?: AccountInstallationInsert["suspendedAt"];
  removedAt?: AccountInstallationInsert["removedAt"];
};

type RepositorySnapshotInput = {
  githubRepositoryId: Defined<AccountRepositoryInsert["githubRepositoryId"]>;
  name: Defined<AccountRepositoryInsert["name"]>;
  fullName: Defined<AccountRepositoryInsert["fullName"]>;
  ownerLogin: Defined<AccountRepositoryInsert["ownerLogin"]>;
  defaultBranch: Defined<AccountRepositoryInsert["defaultBranch"]>;
  private: Defined<AccountRepositoryInsert["private"]>;
  permissionTier?: AccountRepositoryInsert["permissionTier"];
  configSource?: AccountRepositoryInsert["configSource"];
  configEnabled?: AccountRepositoryInsert["configEnabled"];
  configuredNaniteCount?: AccountRepositoryInsert["configuredNaniteCount"];
  mcpServerCount?: AccountRepositoryInsert["mcpServerCount"];
  missingSoulDocumentCount?: AccountRepositoryInsert["missingSoulDocumentCount"];
  missingSkillDocumentCount?: AccountRepositoryInsert["missingSkillDocumentCount"];
  brokenPromptConfig?: AccountRepositoryInsert["brokenPromptConfig"];
  lastConfigFetchedAt?: AccountRepositoryInsert["lastConfigFetchedAt"];
};

type AccountPersonInput = {
  accountId: Defined<AccountPersonInsert["accountId"]>;
  githubUserId: Defined<AccountPersonInsert["githubUserId"]>;
  githubLogin: Defined<AccountPersonInsert["githubLogin"]>;
  relationship: Defined<AccountPersonInsert["relationship"]>;
  seenAt?: Defined<AccountPersonInsert["lastActiveAt"]>;
  signedInAt?: AccountPersonInsert["lastSignedInAt"];
};

type AuthFunnelFactInput = {
  accountId?: AuthFunnelFactInsert["accountId"];
  githubInstallationId?: AuthFunnelFactInsert["githubInstallationId"];
  githubRepositoryId?: AuthFunnelFactInsert["githubRepositoryId"];
  githubUserId?: AuthFunnelFactInsert["githubUserId"];
  githubLogin?: AuthFunnelFactInsert["githubLogin"];
  eventType: Defined<AuthFunnelFactInsert["eventType"]>;
  metadata?: Record<string, unknown>;
  occurredAt?: Defined<AuthFunnelFactInsert["occurredAt"]>;
};

type NaniteRunFactInput = {
  githubInstallationId: Defined<NaniteRunFactInsert["githubInstallationId"]>;
  githubRepositoryId: Defined<NaniteRunFactInsert["githubRepositoryId"]>;
  repositoryFullName: Defined<NaniteRunFactInsert["repositoryFullName"]>;
  runKey: Defined<NaniteRunFactInsert["runKey"]>;
  naniteId: Defined<NaniteRunFactInsert["naniteId"]>;
  variant: Defined<NaniteRunFactInsert["variant"]>;
  triggerKind: Defined<NaniteRunFactInsert["triggerKind"]>;
  triggerPullRequestNumber?: NaniteRunFactInsert["triggerPullRequestNumber"];
  triggeredByGithubUserId?: NaniteRunFactInsert["triggeredByGithubUserId"];
  triggeredByGithubLogin?: NaniteRunFactInsert["triggeredByGithubLogin"];
  status: Defined<NaniteRunFactInsert["status"]>;
  conclusion?: NaniteRunFactInsert["conclusion"];
  phase: Defined<NaniteRunFactInsert["phase"]>;
  task: Defined<NaniteRunFactInsert["task"]>;
  summary?: NaniteRunFactInsert["summary"];
  configSource?: NaniteRunFactInsert["configSource"];
  implicitFailureReason?: NaniteRunFactInsert["implicitFailureReason"];
  missingExitToolReminderCount?: NaniteRunFactInsert["missingExitToolReminderCount"];
  totalMessageCount?: NaniteRunFactInsert["totalMessageCount"];
  runtimeActivityPartCount?: NaniteRunFactInsert["runtimeActivityPartCount"];
  reasoningBlockCount?: NaniteRunFactInsert["reasoningBlockCount"];
  toolInvocationCount?: NaniteRunFactInsert["toolInvocationCount"];
  toolFailureCount?: NaniteRunFactInsert["toolFailureCount"];
  modelTurnCount?: NaniteRunFactInsert["modelTurnCount"];
  continuationTurnCount?: NaniteRunFactInsert["continuationTurnCount"];
  workspaceFileCount?: NaniteRunFactInsert["workspaceFileCount"];
  workspaceDirectoryCount?: NaniteRunFactInsert["workspaceDirectoryCount"];
  workspaceTotalBytes?: NaniteRunFactInsert["workspaceTotalBytes"];
  workspaceHydrationDurationMs?: NaniteRunFactInsert["workspaceHydrationDurationMs"];
  workspaceHydrationHeartbeatCount?: NaniteRunFactInsert["workspaceHydrationHeartbeatCount"];
  startedAt: Defined<NaniteRunFactInsert["startedAt"]>;
  completedAt?: NaniteRunFactInsert["completedAt"];
  lastUpdatedAt: Defined<NaniteRunFactInsert["lastUpdatedAt"]>;
};

type AiPricingSnapshotInput = Omit<AiPricingSnapshotInsert, "id" | "createdAt">;

type AiUsageFactInput = {
  githubInstallationId: Defined<AiUsageFactInsert["githubInstallationId"]>;
  githubRepositoryId?: AiUsageFactInsert["githubRepositoryId"];
  runKey?: AiUsageFactInsert["runKey"];
  requestId: Defined<AiUsageFactInsert["requestId"]>;
  provider: Defined<AiUsageFactInsert["provider"]>;
  model: Defined<AiUsageFactInsert["model"]>;
  sessionAffinity?: AiUsageFactInsert["sessionAffinity"];
  isContinuation: Defined<AiUsageFactInsert["isContinuation"]>;
  stepCount?: AiUsageFactInsert["stepCount"];
  finishReason?: AiUsageFactInsert["finishReason"];
  inputTokens?: AiUsageFactInsert["inputTokens"];
  outputTokens?: AiUsageFactInsert["outputTokens"];
  totalTokens?: AiUsageFactInsert["totalTokens"];
  reasoningTokens?: AiUsageFactInsert["reasoningTokens"];
  cachedInputTokens?: AiUsageFactInsert["cachedInputTokens"];
  cacheWriteTokens?: AiUsageFactInsert["cacheWriteTokens"];
  rawUsage?: unknown;
  providerMetadata?: unknown;
  providerBilledTotalCostUsdMicros?: AiUsageFactInsert["providerBilledTotalCostUsdMicros"];
  startedAt: Defined<AiUsageFactInsert["startedAt"]>;
  completedAt: Defined<AiUsageFactInsert["completedAt"]>;
};

type PlatformUsageFactInput = {
  accountId?: PlatformUsageFactInsert["accountId"];
  githubInstallationId?: PlatformUsageFactInsert["githubInstallationId"];
  githubRepositoryId?: PlatformUsageFactInsert["githubRepositoryId"];
  runKey?: PlatformUsageFactInsert["runKey"];
  category: Defined<PlatformUsageFactInsert["category"]>;
  eventKey: Defined<PlatformUsageFactInsert["eventKey"]>;
  status?: PlatformUsageFactInsert["status"];
  quantity?: PlatformUsageFactInsert["quantity"];
  durationMs?: PlatformUsageFactInsert["durationMs"];
  metadata?: Record<string, unknown>;
  occurredAt?: Defined<PlatformUsageFactInsert["occurredAt"]>;
};

export function normalizeAiUsageProvider(provider: string): string {
  return provider.startsWith("workersai") ? "workers-ai" : provider;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

async function normalizeOptionalInstallationScope(
  db: DbClient,
  input: {
    accountId?: string | null;
    githubInstallationId?: number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{
  accountId: string | null;
  githubInstallationId: number | null;
  metadata: Record<string, unknown> | undefined;
}> {
  let accountId = input.accountId ?? null;
  let githubInstallationId = input.githubInstallationId ?? null;
  let metadata = input.metadata;

  if (githubInstallationId === null) {
    return {
      accountId,
      githubInstallationId,
      metadata,
    };
  }

  const mappedAccountId = await findAccountIdByInstallationId(db, githubInstallationId);
  if (mappedAccountId) {
    return {
      accountId: accountId ?? mappedAccountId,
      githubInstallationId,
      metadata,
    };
  }

  metadata = {
    ...metadata,
    unresolvedGithubInstallationId: githubInstallationId,
  };
  githubInstallationId = null;

  return {
    accountId,
    githubInstallationId,
    metadata,
  };
}

export function buildAccountId(githubAccountId: number): string {
  return `account_${githubAccountId}`;
}

export function buildAccountInstallationId(githubInstallationId: number): string {
  return `account_installation_${githubInstallationId}`;
}

export function buildAccountRepositoryId(accountId: string, githubRepositoryId: number): string {
  return `${accountId}_repo_${githubRepositoryId}`;
}

export function buildAccountPersonId(accountId: string, githubUserId: number): string {
  return `${accountId}_person_${githubUserId}`;
}

export function buildNaniteRunFactId(
  githubInstallationId: number,
  githubRepositoryId: number,
  runKey: string,
): string {
  return `run_${githubInstallationId}_${githubRepositoryId}_${runKey}`;
}

async function touchAccountActivity(db: DbClient, accountId: string, at: Date): Promise<void> {
  await db
    .update(accounts)
    .set({
      lastActiveAt: at,
      updatedAt: at,
    })
    .where(eq(accounts.id, accountId))
    .run();
}

async function ensureAccountEntitlement(db: DbClient, accountId: string, now: Date): Promise<void> {
  await db
    .insert(accountEntitlements)
    .values({
      accountId,
      planId: "internal",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: accountEntitlements.accountId,
      set: {
        updatedAt: now,
      },
    })
    .run();
}

export async function findAccountIdByInstallationId(
  db: DbClient,
  githubInstallationId: number,
): Promise<string | null> {
  const row = await db.query.accountInstallations.findFirst({
    columns: {
      accountId: true,
    },
    where: eq(accountInstallations.githubInstallationId, githubInstallationId),
  });

  return row?.accountId ?? null;
}

export async function upsertAccountInstallationSnapshot(
  db: DbClient,
  input: InstallationSnapshotInput,
): Promise<{ accountId: string }> {
  const now = input.seenAt ?? new Date();
  const accountId = buildAccountId(input.githubAccountId);

  await db
    .insert(accounts)
    .values({
      id: accountId,
      githubAccountId: input.githubAccountId,
      githubAccountLogin: input.githubAccountLogin,
      githubAccountType: input.githubAccountType,
      githubAccountAvatarUrl: input.githubAccountAvatarUrl,
      lastActiveAt: now,
      firstSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: accounts.githubAccountId,
      set: {
        githubAccountLogin: input.githubAccountLogin,
        githubAccountType: input.githubAccountType,
        githubAccountAvatarUrl: input.githubAccountAvatarUrl,
        updatedAt: now,
      },
    })
    .run();

  await ensureAccountEntitlement(db, accountId, now);

  await db
    .insert(accountInstallations)
    .values({
      id: buildAccountInstallationId(input.githubInstallationId),
      accountId,
      githubInstallationId: input.githubInstallationId,
      status: input.status,
      firstSeenAt: now,
      lastSeenAt: now,
      suspendedAt: input.suspendedAt ?? null,
      removedAt: input.removedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: accountInstallations.githubInstallationId,
      set: {
        accountId,
        status: input.status,
        lastSeenAt: now,
        suspendedAt: input.suspendedAt ?? null,
        removedAt: input.removedAt ?? null,
        updatedAt: now,
      },
    })
    .run();

  await touchAccountActivity(db, accountId, now);

  return { accountId };
}

export async function markAccountInstallationRemoved(
  db: DbClient,
  githubInstallationId: number,
  removedAt = new Date(),
): Promise<void> {
  await db
    .update(accountInstallations)
    .set({
      status: "removed",
      removedAt,
      updatedAt: removedAt,
      lastSeenAt: removedAt,
    })
    .where(eq(accountInstallations.githubInstallationId, githubInstallationId))
    .run();

  await db
    .delete(accountInstallationRepositoryMap)
    .where(eq(accountInstallationRepositoryMap.githubInstallationId, githubInstallationId))
    .run();

  const accountId = await findAccountIdByInstallationId(db, githubInstallationId);
  if (accountId) {
    await touchAccountActivity(db, accountId, removedAt);
  }
}

export async function persistInstallationRepositoriesSnapshot(
  db: DbClient,
  input: {
    accountId: string;
    githubInstallationId: number;
    repositories: readonly RepositorySnapshotInput[];
    seenAt?: Date;
    replaceExisting?: boolean;
  },
): Promise<void> {
  const now = input.seenAt ?? new Date();
  const replaceExisting = input.replaceExisting ?? true;

  if (replaceExisting) {
    await db
      .delete(accountInstallationRepositoryMap)
      .where(eq(accountInstallationRepositoryMap.githubInstallationId, input.githubInstallationId))
      .run();
  }

  for (const repository of input.repositories) {
    await db
      .insert(accountRepositories)
      .values({
        id: buildAccountRepositoryId(input.accountId, repository.githubRepositoryId),
        accountId: input.accountId,
        githubInstallationId: input.githubInstallationId,
        githubRepositoryId: repository.githubRepositoryId,
        name: repository.name,
        fullName: repository.fullName,
        ownerLogin: repository.ownerLogin,
        defaultBranch: repository.defaultBranch,
        private: repository.private,
        permissionTier: repository.permissionTier ?? null,
        configSource: repository.configSource ?? null,
        configEnabled: repository.configEnabled ?? true,
        configuredNaniteCount: repository.configuredNaniteCount ?? 0,
        mcpServerCount: repository.mcpServerCount ?? 0,
        missingSoulDocumentCount: repository.missingSoulDocumentCount ?? 0,
        missingSkillDocumentCount: repository.missingSkillDocumentCount ?? 0,
        brokenPromptConfig: repository.brokenPromptConfig ?? false,
        lastConfigFetchedAt: repository.lastConfigFetchedAt ?? null,
        lastActiveAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [accountRepositories.accountId, accountRepositories.githubRepositoryId],
        set: {
          githubInstallationId: input.githubInstallationId,
          name: repository.name,
          fullName: repository.fullName,
          ownerLogin: repository.ownerLogin,
          defaultBranch: repository.defaultBranch,
          private: repository.private,
          permissionTier: repository.permissionTier ?? null,
          configSource: repository.configSource ?? null,
          configEnabled: repository.configEnabled ?? true,
          configuredNaniteCount: repository.configuredNaniteCount ?? 0,
          mcpServerCount: repository.mcpServerCount ?? 0,
          missingSoulDocumentCount: repository.missingSoulDocumentCount ?? 0,
          missingSkillDocumentCount: repository.missingSkillDocumentCount ?? 0,
          brokenPromptConfig: repository.brokenPromptConfig ?? false,
          lastConfigFetchedAt: repository.lastConfigFetchedAt ?? null,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .run();

    await db
      .insert(accountInstallationRepositoryMap)
      .values({
        githubInstallationId: input.githubInstallationId,
        githubRepositoryId: repository.githubRepositoryId,
      })
      .onConflictDoNothing()
      .run();
  }

  await db
    .update(accountInstallations)
    .set({
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(accountInstallations.githubInstallationId, input.githubInstallationId))
    .run();

  await touchAccountActivity(db, input.accountId, now);
}

export async function touchAccountRepositoryActivity(
  db: DbClient,
  input: {
    githubInstallationId: number;
    githubRepositoryId: number;
    at?: Date;
    permissionTier?: RepositoryPermissionTier | null;
    viewed?: boolean;
    ran?: boolean;
  },
): Promise<void> {
  const at = input.at ?? new Date();
  const accountId = await findAccountIdByInstallationId(db, input.githubInstallationId);
  if (!accountId) {
    return;
  }

  await db
    .update(accountRepositories)
    .set({
      permissionTier: input.permissionTier ?? undefined,
      lastViewedAt: input.viewed ? at : undefined,
      lastRunAt: input.ran ? at : undefined,
      lastActiveAt: at,
      updatedAt: at,
    })
    .where(
      and(
        eq(accountRepositories.accountId, accountId),
        eq(accountRepositories.githubRepositoryId, input.githubRepositoryId),
      ),
    )
    .run();

  await touchAccountActivity(db, accountId, at);
}

export async function upsertAccountPerson(db: DbClient, input: AccountPersonInput): Promise<void> {
  const now = input.seenAt ?? new Date();

  await db
    .insert(accountPeople)
    .values({
      id: buildAccountPersonId(input.accountId, input.githubUserId),
      accountId: input.accountId,
      githubUserId: input.githubUserId,
      githubLogin: input.githubLogin,
      relationship: input.relationship,
      lastSignedInAt: input.signedInAt ?? null,
      lastActiveAt: now,
      firstSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [accountPeople.accountId, accountPeople.githubUserId],
      set: {
        githubLogin: input.githubLogin,
        relationship: input.relationship,
        lastSignedInAt: input.signedInAt ?? sql`coalesce(${accountPeople.lastSignedInAt}, null)`,
        lastActiveAt: now,
        updatedAt: now,
      },
    })
    .run();

  await touchAccountActivity(db, input.accountId, now);
}

export async function recordAuthFunnelFact(
  db: DbClient,
  input: AuthFunnelFactInput,
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const normalizedScope = await normalizeOptionalInstallationScope(db, {
    accountId: input.accountId ?? null,
    githubInstallationId: input.githubInstallationId ?? null,
    metadata: input.metadata,
  });

  await db
    .insert(authFunnelFacts)
    .values({
      id: crypto.randomUUID(),
      accountId: normalizedScope.accountId,
      githubInstallationId: normalizedScope.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId ?? null,
      githubUserId: input.githubUserId ?? null,
      githubLogin: input.githubLogin ?? null,
      eventType: input.eventType,
      metadataJson: toJson(normalizedScope.metadata),
      occurredAt,
    })
    .run();

  await recordPlatformUsageFact(db, {
    accountId: normalizedScope.accountId,
    githubInstallationId: normalizedScope.githubInstallationId,
    githubRepositoryId: input.githubRepositoryId ?? null,
    category: "auth",
    eventKey: input.eventType,
    metadata: normalizedScope.metadata,
    occurredAt,
  });

  if (normalizedScope.accountId) {
    await touchAccountActivity(db, normalizedScope.accountId, occurredAt);
  }
}

export async function upsertNaniteRunFact(
  db: DbClient,
  input: NaniteRunFactInput,
): Promise<string> {
  const accountId = await findAccountIdByInstallationId(db, input.githubInstallationId);
  if (!accountId) {
    return buildNaniteRunFactId(input.githubInstallationId, input.githubRepositoryId, input.runKey);
  }

  const id = buildNaniteRunFactId(
    input.githubInstallationId,
    input.githubRepositoryId,
    input.runKey,
  );
  const existing = await db.query.naniteRunFacts.findFirst({
    where: and(
      eq(naniteRunFacts.githubInstallationId, input.githubInstallationId),
      eq(naniteRunFacts.githubRepositoryId, input.githubRepositoryId),
      eq(naniteRunFacts.runKey, input.runKey),
    ),
  });

  await db
    .insert(naniteRunFacts)
    .values({
      id,
      accountId,
      githubInstallationId: input.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId,
      repositoryFullName: input.repositoryFullName,
      runKey: input.runKey,
      naniteId: input.naniteId,
      variant: input.variant,
      triggerKind: input.triggerKind,
      triggerPullRequestNumber: input.triggerPullRequestNumber ?? null,
      triggeredByGithubUserId:
        input.triggeredByGithubUserId ?? existing?.triggeredByGithubUserId ?? null,
      triggeredByGithubLogin:
        input.triggeredByGithubLogin ?? existing?.triggeredByGithubLogin ?? null,
      status: input.status,
      conclusion: input.conclusion ?? null,
      phase: input.phase,
      task: input.task,
      summary: input.summary ?? null,
      configSource: input.configSource ?? null,
      implicitFailureReason: input.implicitFailureReason ?? null,
      missingExitToolReminderCount: input.missingExitToolReminderCount ?? 0,
      totalMessageCount: input.totalMessageCount ?? 0,
      runtimeActivityPartCount: input.runtimeActivityPartCount ?? 0,
      reasoningBlockCount: input.reasoningBlockCount ?? 0,
      toolInvocationCount: input.toolInvocationCount ?? 0,
      toolFailureCount: input.toolFailureCount ?? 0,
      modelTurnCount: input.modelTurnCount ?? 0,
      continuationTurnCount: input.continuationTurnCount ?? 0,
      workspaceFileCount: input.workspaceFileCount ?? null,
      workspaceDirectoryCount: input.workspaceDirectoryCount ?? null,
      workspaceTotalBytes: input.workspaceTotalBytes ?? null,
      workspaceHydrationDurationMs: input.workspaceHydrationDurationMs ?? null,
      workspaceHydrationHeartbeatCount: input.workspaceHydrationHeartbeatCount ?? null,
      startedAt: input.startedAt,
      completedAt: input.completedAt ?? null,
      lastUpdatedAt: input.lastUpdatedAt,
      createdAt: input.startedAt,
      updatedAt: input.lastUpdatedAt,
    })
    .onConflictDoUpdate({
      target: [
        naniteRunFacts.githubInstallationId,
        naniteRunFacts.githubRepositoryId,
        naniteRunFacts.runKey,
      ],
      set: {
        repositoryFullName: input.repositoryFullName,
        naniteId: input.naniteId,
        variant: input.variant,
        triggerKind: input.triggerKind,
        triggerPullRequestNumber: input.triggerPullRequestNumber ?? null,
        triggeredByGithubUserId:
          input.triggeredByGithubUserId ?? existing?.triggeredByGithubUserId ?? null,
        triggeredByGithubLogin:
          input.triggeredByGithubLogin ?? existing?.triggeredByGithubLogin ?? null,
        status: input.status,
        conclusion: input.conclusion ?? null,
        phase: input.phase,
        task: input.task,
        summary: input.summary ?? null,
        configSource: input.configSource ?? null,
        implicitFailureReason: input.implicitFailureReason ?? null,
        missingExitToolReminderCount: input.missingExitToolReminderCount ?? 0,
        totalMessageCount: input.totalMessageCount ?? 0,
        runtimeActivityPartCount: input.runtimeActivityPartCount ?? 0,
        reasoningBlockCount: input.reasoningBlockCount ?? 0,
        toolInvocationCount: input.toolInvocationCount ?? 0,
        toolFailureCount: input.toolFailureCount ?? 0,
        modelTurnCount: input.modelTurnCount ?? 0,
        continuationTurnCount: input.continuationTurnCount ?? 0,
        workspaceFileCount: input.workspaceFileCount ?? null,
        workspaceDirectoryCount: input.workspaceDirectoryCount ?? null,
        workspaceTotalBytes: input.workspaceTotalBytes ?? null,
        workspaceHydrationDurationMs: input.workspaceHydrationDurationMs ?? null,
        workspaceHydrationHeartbeatCount: input.workspaceHydrationHeartbeatCount ?? null,
        completedAt: input.completedAt ?? null,
        lastUpdatedAt: input.lastUpdatedAt,
        updatedAt: input.lastUpdatedAt,
      },
    })
    .run();

  await touchAccountRepositoryActivity(db, {
    githubInstallationId: input.githubInstallationId,
    githubRepositoryId: input.githubRepositoryId,
    at: input.lastUpdatedAt,
    ran: true,
  });

  return id;
}

export async function ensureAiPricingSnapshot(
  db: DbClient,
  input: AiPricingSnapshotInput,
): Promise<void> {
  await db
    .insert(aiPricingSnapshots)
    .values({
      id: crypto.randomUUID(),
      provider: input.provider,
      model: input.model,
      effectiveAt: input.effectiveAt,
      inputTokenCostPerMillionUsdMicros: input.inputTokenCostPerMillionUsdMicros,
      cachedInputTokenCostPerMillionUsdMicros:
        input.cachedInputTokenCostPerMillionUsdMicros ?? null,
      outputTokenCostPerMillionUsdMicros: input.outputTokenCostPerMillionUsdMicros,
      reasoningTokenCostPerMillionUsdMicros: input.reasoningTokenCostPerMillionUsdMicros ?? null,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
}

async function findLatestAiPricingSnapshot(
  db: DbClient,
  input: { provider: string; model: string; at: Date },
) {
  return db.query.aiPricingSnapshots.findFirst({
    where: and(
      eq(aiPricingSnapshots.provider, input.provider),
      eq(aiPricingSnapshots.model, input.model),
      lte(aiPricingSnapshots.effectiveAt, input.at),
    ),
    orderBy: [desc(aiPricingSnapshots.effectiveAt)],
  });
}

function estimateTokenCostUsdMicros(
  tokenCount: number | null | undefined,
  costPerMillionUsdMicros: number | null | undefined,
): number | null {
  if (tokenCount == null || costPerMillionUsdMicros == null) {
    return null;
  }

  return Math.round((tokenCount * costPerMillionUsdMicros) / 1_000_000);
}

function buildEstimatedAiUsageCosts(
  input: Pick<AiUsageFactInput, "cachedInputTokens" | "inputTokens" | "outputTokens">,
  pricing:
    | {
        inputTokenCostPerMillionUsdMicros: number;
        cachedInputTokenCostPerMillionUsdMicros: number | null;
        outputTokenCostPerMillionUsdMicros: number;
      }
    | null
    | undefined,
) {
  const noCacheInputTokens =
    input.inputTokens != null && input.cachedInputTokens != null
      ? Math.max(input.inputTokens - input.cachedInputTokens, 0)
      : (input.inputTokens ?? null);
  const estimatedInputCostUsdMicros = estimateTokenCostUsdMicros(
    noCacheInputTokens,
    pricing?.inputTokenCostPerMillionUsdMicros,
  );
  const estimatedCachedInputCostUsdMicros = estimateTokenCostUsdMicros(
    input.cachedInputTokens,
    pricing?.cachedInputTokenCostPerMillionUsdMicros,
  );
  const estimatedOutputCostUsdMicros = estimateTokenCostUsdMicros(
    input.outputTokens,
    pricing?.outputTokenCostPerMillionUsdMicros,
  );
  const estimatedTotalCostUsdMicros =
    estimatedInputCostUsdMicros === null &&
    estimatedCachedInputCostUsdMicros === null &&
    estimatedOutputCostUsdMicros === null
      ? null
      : (estimatedInputCostUsdMicros ?? 0) +
        (estimatedCachedInputCostUsdMicros ?? 0) +
        (estimatedOutputCostUsdMicros ?? 0);

  return {
    estimatedInputCostUsdMicros,
    estimatedOutputCostUsdMicros,
    estimatedTotalCostUsdMicros,
  };
}

export async function recordAiUsageFact(db: DbClient, input: AiUsageFactInput): Promise<void> {
  const accountId = await findAccountIdByInstallationId(db, input.githubInstallationId);
  if (!accountId) {
    return;
  }

  const normalizedProvider = normalizeAiUsageProvider(input.provider);
  const pricing = await findLatestAiPricingSnapshot(db, {
    provider: normalizedProvider,
    model: input.model,
    at: input.completedAt,
  });
  const { estimatedInputCostUsdMicros, estimatedOutputCostUsdMicros, estimatedTotalCostUsdMicros } =
    buildEstimatedAiUsageCosts(input, pricing);

  await db
    .insert(aiUsageFacts)
    .values({
      id: crypto.randomUUID(),
      accountId,
      githubInstallationId: input.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId ?? null,
      runKey: input.runKey ?? null,
      requestId: input.requestId,
      provider: normalizedProvider,
      model: input.model,
      sessionAffinity: input.sessionAffinity ?? null,
      isContinuation: input.isContinuation,
      stepCount: input.stepCount ?? 1,
      finishReason: input.finishReason ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      reasoningTokens: input.reasoningTokens ?? null,
      cachedInputTokens: input.cachedInputTokens ?? null,
      cacheWriteTokens: input.cacheWriteTokens ?? null,
      rawUsageJson: toJson(input.rawUsage),
      providerMetadataJson: toJson(input.providerMetadata),
      providerBilledTotalCostUsdMicros: input.providerBilledTotalCostUsdMicros ?? null,
      estimatedInputCostUsdMicros,
      estimatedOutputCostUsdMicros,
      estimatedTotalCostUsdMicros,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      createdAt: input.completedAt,
    })
    .onConflictDoNothing()
    .run();

  await touchAccountActivity(db, accountId, input.completedAt);
}

export async function backfillAiUsageFactCosts(db: DbClient): Promise<void> {
  const rows = await db.query.aiUsageFacts.findMany({
    where: isNull(aiUsageFacts.estimatedTotalCostUsdMicros),
  });

  for (const row of rows) {
    const normalizedProvider = normalizeAiUsageProvider(row.provider);
    const pricing = await findLatestAiPricingSnapshot(db, {
      provider: normalizedProvider,
      model: row.model,
      at: row.completedAt,
    });
    const {
      estimatedInputCostUsdMicros,
      estimatedOutputCostUsdMicros,
      estimatedTotalCostUsdMicros,
    } = buildEstimatedAiUsageCosts(
      {
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        outputTokens: row.outputTokens,
      },
      pricing,
    );

    if (
      estimatedInputCostUsdMicros === null &&
      estimatedOutputCostUsdMicros === null &&
      estimatedTotalCostUsdMicros === null
    ) {
      continue;
    }

    await db
      .update(aiUsageFacts)
      .set({
        provider: normalizedProvider,
        estimatedInputCostUsdMicros,
        estimatedOutputCostUsdMicros,
        estimatedTotalCostUsdMicros,
      })
      .where(eq(aiUsageFacts.id, row.id))
      .run();
  }
}

export async function recordPlatformUsageFact(
  db: DbClient,
  input: PlatformUsageFactInput,
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const normalizedScope = await normalizeOptionalInstallationScope(db, {
    accountId: input.accountId ?? null,
    githubInstallationId: input.githubInstallationId ?? null,
    metadata: input.metadata,
  });

  await db
    .insert(platformUsageFacts)
    .values({
      id: crypto.randomUUID(),
      accountId: normalizedScope.accountId,
      githubInstallationId: normalizedScope.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId ?? null,
      runKey: input.runKey ?? null,
      category: input.category,
      eventKey: input.eventKey,
      status: input.status ?? null,
      quantity: input.quantity ?? 1,
      durationMs: input.durationMs ?? null,
      metadataJson: toJson(normalizedScope.metadata),
      occurredAt,
    })
    .run();

  if (normalizedScope.accountId) {
    await touchAccountActivity(db, normalizedScope.accountId, occurredAt);
  }
}

export async function getBusinessSummaryCounts(db: DbClient) {
  const [accountCount] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(accounts);

  return {
    accountCount: accountCount?.count ?? 0,
  };
}
