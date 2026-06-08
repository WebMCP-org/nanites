import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { LanguageModelUsage } from "ai";
import { eq, like } from "drizzle-orm";
import worker from "#/server.ts";
import baselineMigrationSql from "../../src/backend/db/migrations/0000_baseline.sql?raw";
import { createDbClient } from "#/backend/db/index.ts";
import {
  accounts,
  accountInstallations,
  aiUsageFacts,
  auditEvents,
  naniteCatalog,
  naniteRunFacts,
} from "#/backend/db/schema.ts";
import { recordVisibleInstallationSnapshots } from "#/backend/db/facts.ts";
import {
  buildBrowserSessionExpiration,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
  type NanitesSession,
  type SessionInstallationSnapshot,
} from "#/backend/auth/session.ts";
import {
  buildNaniteAiGatewayMetadata,
  githubUserActor,
  recordAiUsageFact,
  recordAuditEvent,
  recordNaniteCatalogProjection,
  recordNaniteRunFact,
  resolveNaniteBillingAttribution,
  triggerActor,
} from "#/backend/observability/recorders.ts";
import {
  getNaniteCostBreakdown,
  getRunFeed,
  getObservabilityOverview,
  type ObservabilityVisibilityScope,
} from "#/backend/observability/queries.ts";
import { readGitHubPullRequestReference } from "#/backend/github/index.ts";
import type {
  ManagedNanite,
  NaniteManifest,
  NaniteRunRecord,
} from "#/backend/agents/SigveloNaniteManager.ts";
import type { GitHubWebhookEventSnapshot } from "#/github.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";

const visibleRepositoryId = 91_001;
const hiddenRepositoryId = 91_002;
const visibleRepository = "acme/visible";
const hiddenRepository = "acme/hidden";
const migrationStatementSeparator = "--> statement-breakpoint";

type ObservabilityFixture = {
  prefix: string;
  installation: SessionInstallationSnapshot;
  accountId: string;
  db: ReturnType<typeof createDbClient>;
};

test("GitHub output PR URLs are parsed for impact attribution", () => {
  expect(readGitHubPullRequestReference("https://github.com/WebMCP-org/nanites/pull/42")).toEqual({
    owner: "WebMCP-org",
    repo: "nanites",
    pullRequestNumber: 42,
  });
  expect(readGitHubPullRequestReference("https://github.com/WebMCP-org/nanites/issues/42")).toBe(
    null,
  );
  expect(readGitHubPullRequestReference("https://example.com/WebMCP-org/nanites/pull/42")).toBe(
    null,
  );
});

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function migrationStatements(sql: string): string[] {
  return sql
    .split(migrationStatementSeparator)
    .map((statement) => statement.replaceAll(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function readD1UserTables(): Promise<string[]> {
  const tables = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'",
  ).all<{ name: string }>();

  return (tables.results ?? []).map((row) => row.name);
}

async function readD1TableDependencies(
  tableNames: readonly string[],
): Promise<Map<string, Set<string>>> {
  const tableNameSet = new Set(tableNames);
  const dependencies = new Map<string, Set<string>>();

  for (const tableName of tableNames) {
    const foreignKeys = await env.DB.prepare(
      `pragma foreign_key_list(${quoteSqlIdentifier(tableName)})`,
    ).all<{ table: string }>();
    dependencies.set(
      tableName,
      new Set(
        (foreignKeys.results ?? [])
          .map((row) => row.table)
          .filter((name) => tableNameSet.has(name)),
      ),
    );
  }

  return dependencies;
}

async function orderedD1TablesForDrop(): Promise<string[]> {
  const dependencies = await readD1TableDependencies(await readD1UserTables());
  const remaining = new Set(dependencies.keys());
  const dropOrder: string[] = [];

  while (remaining.size) {
    const leaves = Array.from(remaining)
      .filter(
        (tableName) =>
          !Array.from(remaining).some((otherTableName) =>
            dependencies.get(otherTableName)?.has(tableName),
          ),
      )
      .sort();
    const nextTables = leaves.length ? leaves : [Array.from(remaining).sort()[0]];

    for (const tableName of nextTables) {
      dropOrder.push(tableName);
      remaining.delete(tableName);
    }
  }

  return dropOrder;
}

async function resetD1SchemaFromBaseline() {
  await env.DB.exec("PRAGMA foreign_keys = OFF;");

  for (const tableName of await orderedD1TablesForDrop()) {
    await env.DB.exec(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(tableName)};`);
  }

  await env.DB.exec("PRAGMA foreign_keys = ON;");
  for (const statement of migrationStatements(baselineMigrationSql)) {
    await env.DB.exec(statement);
  }
}

beforeEach(async () => {
  await resetD1SchemaFromBaseline();
});

function uniquePrefix() {
  return `obs-${crypto.randomUUID()}`;
}

async function cleanupPrefix(prefix: string) {
  const db = createDbClient(env.DB);
  await db
    .delete(aiUsageFacts)
    .where(like(aiUsageFacts.id, `%${prefix}%`))
    .run();
  await db
    .delete(naniteRunFacts)
    .where(like(naniteRunFacts.id, `%${prefix}%`))
    .run();
  await db
    .delete(auditEvents)
    .where(like(auditEvents.id, `%${prefix}%`))
    .run();
  await db
    .delete(naniteCatalog)
    .where(like(naniteCatalog.naniteId, `${prefix}%`))
    .run();
  await db
    .delete(accountInstallations)
    .where(like(accountInstallations.id, `${prefix}%`))
    .run();
  await db
    .delete(accounts)
    .where(like(accounts.id, `${prefix}%`))
    .run();
}

async function createFixture(): Promise<ObservabilityFixture> {
  const prefix = uniquePrefix();
  const installation: SessionInstallationSnapshot = {
    id: 1_700_000_000 + Math.floor(Math.random() * 100_000_000),
    account: {
      id: 1_800_000_000 + Math.floor(Math.random() * 100_000_000),
      login: `${prefix}-account`,
      type: "Organization",
      avatar_url: null,
    },
  };
  const db = createDbClient(env.DB);
  await recordVisibleInstallationSnapshots(db, [installation]);
  const accountRow = await db.query.accounts.findFirst({
    columns: { id: true },
    where: eq(accounts.githubAccountId, installation.account.id),
  });

  if (!accountRow) {
    throw new Error("Expected fixture account to be recorded.");
  }

  return { prefix, installation, accountId: accountRow.id, db };
}

function createNanite(input: {
  prefix: string;
  id: string;
  repository: string;
  eventSource?: NaniteManifest["eventSource"];
  actorLogin?: string;
}): ManagedNanite {
  const now = new Date().toISOString();
  const eventSource = input.eventSource ?? {
    type: "github",
    events: ["push"],
    repositories: [input.repository],
  };
  const manifest: NaniteManifest =
    eventSource.type === "manual"
      ? {
          id: `${input.prefix}-${input.id}`,
          name: `${input.id} Nanite`,
          description: "Fixture Nanite",
          eventSource,
          permissions: {
            github: {
              repositories: [input.repository],
              appPermissions: { contents: "read" },
            },
          },
        }
      : {
          id: `${input.prefix}-${input.id}`,
          name: `${input.id} Nanite`,
          description: "Fixture Nanite",
          eventSource,
          triggerSource: "export default () => ({ ok: true })",
          permissions: {
            github: {
              repositories: [input.repository],
              appPermissions: { contents: "read" },
            },
          },
        };

  return {
    manifest,
    enabled: true,
    latestVersion: {
      versionId: `${input.prefix}-${input.id}-v1`,
      manifestHash: `${input.prefix}-${input.id}-hash`,
      registeredAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function createPushEvent(input: {
  installationId: number;
  repositoryId: number;
  repository: string;
}): GitHubWebhookEventSnapshot {
  return {
    id: `${input.repositoryId}-event`,
    name: "push",
    payload: {
      installation: { id: input.installationId },
      repository: {
        id: input.repositoryId,
        full_name: input.repository,
      },
      ref: "refs/heads/main",
      after: "a".repeat(40),
    },
  };
}

function createPullRequestEvent(input: {
  installationId: number;
  repositoryId: number;
  repository: string;
  pullRequestNumber: number;
}): GitHubWebhookEventSnapshot {
  return {
    id: `${input.repositoryId}-pr-event`,
    name: "pull_request",
    payload: {
      action: "opened",
      installation: { id: input.installationId },
      repository: {
        id: input.repositoryId,
        full_name: input.repository,
      },
      pull_request: {
        number: input.pullRequestNumber,
        html_url: `https://github.com/${input.repository}/pull/${input.pullRequestNumber}`,
      },
    },
  };
}

function createRun(input: {
  prefix: string;
  naniteId: string;
  installationId: number;
  repositoryId: number;
  repository: string;
  runId: string;
  status?: NaniteRunRecord["status"];
  event?: GitHubWebhookEventSnapshot;
  outputUrl?: string | null;
}): NaniteRunRecord {
  const now = new Date().toISOString();
  return {
    runId: `${input.prefix}-${input.runId}`,
    naniteId: input.naniteId,
    versionId: `${input.naniteId}-v1`,
    triggerKey: `${input.prefix}-${input.runId}-trigger`,
    trigger: {
      type: "github",
      event:
        input.event ??
        createPushEvent({
          installationId: input.installationId,
          repositoryId: input.repositoryId,
          repository: input.repository,
        }),
    },
    status: input.status ?? "complete",
    summary: "Fixture run",
    outputUrl: input.outputUrl ?? null,
    agentFeedback: null,
    humanRequest: null,
    chatUrl: "https://example.com/chat",
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    dispatchError: null,
  };
}

function scopeFor(fixture: ObservabilityFixture): ObservabilityVisibilityScope {
  return {
    githubInstallationId: fixture.installation.id,
    visibleRepositoryIds: [visibleRepositoryId],
    visibleRepositoryFullNames: [visibleRepository],
    filters: { range: "7d" },
    now: new Date(Date.now() + 1_000),
  };
}

function createUsage(inputTokens: number, outputTokens: number): LanguageModelUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: {
      textTokens: outputTokens,
      reasoningTokens: undefined,
    },
  };
}

async function seedCatalogAndRuns(fixture: ObservabilityFixture) {
  const browserActor = githubUserActor({
    source: "browser",
    githubUserId: 42,
    githubLogin: "alex",
  });
  const mcpActor = githubUserActor({
    source: "mcp",
    githubUserId: 43,
    githubLogin: "mcp-user",
  });
  const visibleNanite = createNanite({
    prefix: fixture.prefix,
    id: "visible",
    repository: visibleRepository,
  });
  const hiddenNanite = createNanite({
    prefix: fixture.prefix,
    id: "hidden",
    repository: hiddenRepository,
  });
  const visibleRun = createRun({
    prefix: fixture.prefix,
    naniteId: visibleNanite.manifest.id,
    installationId: fixture.installation.id,
    repositoryId: visibleRepositoryId,
    repository: visibleRepository,
    runId: "visible-run",
    event: createPullRequestEvent({
      installationId: fixture.installation.id,
      repositoryId: visibleRepositoryId,
      repository: visibleRepository,
      pullRequestNumber: 12,
    }),
    outputUrl: `https://github.com/${visibleRepository}/pull/12`,
  });
  const hiddenRun = createRun({
    prefix: fixture.prefix,
    naniteId: hiddenNanite.manifest.id,
    installationId: fixture.installation.id,
    repositoryId: hiddenRepositoryId,
    repository: hiddenRepository,
    runId: "hidden-run",
  });

  await recordNaniteCatalogProjection(fixture.db, {
    accountId: fixture.accountId,
    githubInstallationId: fixture.installation.id,
    nanite: visibleNanite,
    actor: browserActor,
  });
  await recordNaniteCatalogProjection(fixture.db, {
    accountId: fixture.accountId,
    githubInstallationId: fixture.installation.id,
    nanite: hiddenNanite,
    actor: mcpActor,
  });
  await recordNaniteRunFact(fixture.db, {
    accountId: fixture.accountId,
    githubInstallationId: fixture.installation.id,
    nanite: visibleNanite,
    run: visibleRun,
    actor: browserActor,
    outputPullRequest: {
      pullRequestNumber: 12,
      merged: true,
      mergedAt: visibleRun.completedAt,
      additions: 42,
      deletions: 8,
      changedFiles: 5,
    },
  });
  await recordNaniteRunFact(fixture.db, {
    accountId: fixture.accountId,
    githubInstallationId: fixture.installation.id,
    nanite: hiddenNanite,
    run: hiddenRun,
    actor: mcpActor,
  });

  return { browserActor, mcpActor, visibleNanite, hiddenNanite, visibleRun, hiddenRun };
}

type CatalogAndRunSeed = Awaited<ReturnType<typeof seedCatalogAndRuns>>;

async function recordVisibleAndHiddenAiUsage(
  fixture: ObservabilityFixture,
  seed: CatalogAndRunSeed,
  input: {
    visibleRequestId: string;
    hiddenRequestId: string;
    visibleCostUsdMicros: number;
    hiddenCostUsdMicros: number;
  },
): Promise<void> {
  await recordAiUsageFact(fixture.db, {
    accountId: fixture.accountId,
    githubInstallationId: fixture.installation.id,
    githubRepositoryId: visibleRepositoryId,
    naniteId: seed.visibleNanite.manifest.id,
    runKey: seed.visibleRun.runId,
    requestId: input.visibleRequestId,
    provider: "workers-ai",
    model: "@cf/test/model",
    usage: createUsage(1, 1),
    providerBilledTotalCostUsdMicros: input.visibleCostUsdMicros,
    actor: seed.browserActor,
    completedAt: new Date(),
  });
  await recordAiUsageFact(fixture.db, {
    accountId: fixture.accountId,
    githubInstallationId: fixture.installation.id,
    githubRepositoryId: hiddenRepositoryId,
    naniteId: seed.hiddenNanite.manifest.id,
    runKey: seed.hiddenRun.runId,
    requestId: input.hiddenRequestId,
    provider: "workers-ai",
    model: "@cf/test/model",
    usage: createUsage(1, 1),
    providerBilledTotalCostUsdMicros: input.hiddenCostUsdMicros,
    actor: seed.browserActor,
    completedAt: new Date(),
  });
}

async function buildAuthCookie(installation: SessionInstallationSnapshot): Promise<string> {
  const request = new Request("http://localhost:5173/api/observability/overview");
  const session: NanitesSession = {
    githubViewer: { id: 42, login: "alex" },
    activeGithubInstallationId: installation.id,
    sessionInstallationSnapshot: installation,
    expiresAt: buildBrowserSessionExpiration(),
  };
  const sessionCookie = await sealSessionCookie(session, request, env);
  const tokenCookie = await sealGitHubUserTokenCookie(
    {
      accessToken: "test-gh-token",
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    },
    request,
    env,
  );

  return `${sessionCookie.split(";", 1)[0]}; ${tokenCookie.split(";", 1)[0]}`;
}

function mockVisibleGitHubAccess(fixture: ObservabilityFixture) {
  return mockGitHubApi([
    {
      path: "/user/installations?per_page=100&page=1",
      response: () =>
        Response.json({
          total_count: 1,
          installations: [
            {
              id: fixture.installation.id,
              account: fixture.installation.account,
              suspended_at: null,
            },
          ],
        }),
    },
    {
      path: `/user/installations/${fixture.installation.id}/repositories?per_page=100&page=1`,
      response: () =>
        Response.json({
          total_count: 1,
          repositories: [
            {
              id: visibleRepositoryId,
              full_name: visibleRepository,
              name: "visible",
              owner: { login: "acme" },
              private: true,
              default_branch: "main",
            },
          ],
        }),
    },
  ]);
}

test("observability recorders map AI usage, gateway metadata, actors, and billing attribution", async () => {
  const fixture = await createFixture();
  try {
    const { browserActor, visibleNanite, visibleRun } = await seedCatalogAndRuns(fixture);
    const scheduledBilling = await resolveNaniteBillingAttribution(fixture.db, {
      githubInstallationId: fixture.installation.id,
      naniteId: visibleNanite.manifest.id,
      actor: triggerActor("schedule"),
    });

    expect(scheduledBilling).toEqual({
      githubUserId: 42,
      githubLogin: "alex",
      basis: "nanite_creator",
    });
    expect(
      Object.keys(
        buildNaniteAiGatewayMetadata({
          githubInstallationId: fixture.installation.id,
          naniteId: visibleNanite.manifest.id,
          runKey: visibleRun.runId,
          billingGithubUserId: scheduledBilling.githubUserId,
          repository: visibleRepository,
        }),
      ),
    ).toHaveLength(5);

    await recordAiUsageFact(fixture.db, {
      accountId: fixture.accountId,
      githubInstallationId: fixture.installation.id,
      githubRepositoryId: visibleRepositoryId,
      naniteId: visibleNanite.manifest.id,
      runKey: visibleRun.runId,
      requestId: `${fixture.prefix}-request-visible`,
      provider: "workers-ai",
      model: "@cf/test/model",
      finishReason: "stop",
      usage: {
        inputTokens: 100,
        outputTokens: 60,
        totalTokens: 160,
        inputTokenDetails: {
          noCacheTokens: 70,
          cacheReadTokens: 20,
          cacheWriteTokens: 10,
        },
        outputTokenDetails: {
          textTokens: 55,
          reasoningTokens: 5,
        },
        raw: {
          prompt_tokens: 100,
          completion_tokens: 60,
        },
      },
      providerMetadata: {
        gateway: {
          cacheStatus: "hit",
        },
      },
      aiGatewayLogId: "gateway-log-visible",
      aiGatewayEventId: "gateway-event-visible",
      providerBilledTotalCostUsdMicros: 207,
      actor: browserActor,
      billing: scheduledBilling,
      completedAt: new Date(),
    });

    const usageRow = await fixture.db.query.aiUsageFacts.findFirst({
      where: eq(aiUsageFacts.requestId, `${fixture.prefix}-request-visible`),
    });

    expect(usageRow).toMatchObject({
      naniteId: visibleNanite.manifest.id,
      aiGatewayLogId: "gateway-log-visible",
      aiGatewayEventId: "gateway-event-visible",
      actorKind: "github_user",
      actorSource: "browser",
      actorGithubUserId: 42,
      billingGithubUserId: 42,
      billingAttributionBasis: "nanite_creator",
      inputTokens: 100,
      outputTokens: 60,
      totalTokens: 160,
      reasoningTokens: 5,
      cachedInputTokens: 20,
      cacheWriteTokens: 10,
      providerBilledTotalCostUsdMicros: 207,
      estimatedInputCostUsdMicros: null,
      estimatedOutputCostUsdMicros: null,
      estimatedTotalCostUsdMicros: null,
    });
    expect(JSON.parse(usageRow?.rawUsageJson ?? "{}")).toEqual({
      prompt_tokens: 100,
      completion_tokens: 60,
    });
    expect(JSON.parse(usageRow?.providerMetadataJson ?? "{}")).toEqual({
      gateway: { cacheStatus: "hit" },
    });
  } finally {
    await cleanupPrefix(fixture.prefix);
  }
});

test("observability audit rows capture browser and MCP surfaces", async () => {
  const fixture = await createFixture();
  try {
    const { browserActor, mcpActor, visibleNanite } = await seedCatalogAndRuns(fixture);
    await recordAuditEvent(fixture.db, {
      id: `${fixture.prefix}-audit-create`,
      eventName: "audit.nanite.created",
      accountId: fixture.accountId,
      githubInstallationId: fixture.installation.id,
      githubRepositoryId: visibleRepositoryId,
      repositoryFullName: visibleRepository,
      naniteId: visibleNanite.manifest.id,
      actor: browserActor,
      targetType: "nanite",
      targetId: visibleNanite.manifest.id,
      outcome: "success",
      requestId: `${fixture.prefix}-browser-request`,
    });
    await recordAuditEvent(fixture.db, {
      id: `${fixture.prefix}-audit-update`,
      eventName: "audit.nanite.updated",
      accountId: fixture.accountId,
      githubInstallationId: fixture.installation.id,
      githubRepositoryId: visibleRepositoryId,
      repositoryFullName: visibleRepository,
      naniteId: visibleNanite.manifest.id,
      actor: mcpActor,
      targetType: "nanite",
      targetId: visibleNanite.manifest.id,
      outcome: "success",
      requestId: `${fixture.prefix}-mcp-request`,
    });
    await recordAuditEvent(fixture.db, {
      id: `${fixture.prefix}-audit-deprovision`,
      eventName: "audit.nanite.deprovisioned",
      accountId: fixture.accountId,
      githubInstallationId: fixture.installation.id,
      githubRepositoryId: visibleRepositoryId,
      repositoryFullName: visibleRepository,
      naniteId: visibleNanite.manifest.id,
      actor: browserActor,
      targetType: "nanite",
      targetId: visibleNanite.manifest.id,
      outcome: "success",
      requestId: `${fixture.prefix}-delete-request`,
    });

    const rows = await fixture.db.query.auditEvents.findMany({
      where: like(auditEvents.id, `${fixture.prefix}-audit-%`),
    });
    expect(rows.map((row) => [row.eventName, row.surface])).toEqual(
      expect.arrayContaining([
        ["audit.nanite.created", "browser"],
        ["audit.nanite.updated", "mcp"],
        ["audit.nanite.deprovisioned", "browser"],
      ]),
    );
  } finally {
    await cleanupPrefix(fixture.prefix);
  }
});

test("observability queries group cost and filter hidden repositories", async () => {
  const fixture = await createFixture();
  try {
    const seed = await seedCatalogAndRuns(fixture);
    await recordVisibleAndHiddenAiUsage(fixture, seed, {
      visibleRequestId: `${fixture.prefix}-request-visible-grouping`,
      hiddenRequestId: `${fixture.prefix}-request-hidden-grouping`,
      visibleCostUsdMicros: 700,
      hiddenCostUsdMicros: 900,
    });

    const breakdown = await getNaniteCostBreakdown(fixture.db, scopeFor(fixture));
    const overview = await getObservabilityOverview(fixture.db, scopeFor(fixture));
    const runs = await getRunFeed(fixture.db, scopeFor(fixture));

    expect(breakdown.byRepository).toEqual([
      expect.objectContaining({
        key: visibleRepository,
        estimatedCostUsdMicros: 700,
        count: 1,
      }),
    ]);
    expect(breakdown.byNanite).toEqual([
      expect.objectContaining({
        key: seed.visibleNanite.manifest.id,
        estimatedCostUsdMicros: 700,
      }),
    ]);
    expect(overview.runsByOutcome).toEqual([
      expect.objectContaining({
        outcome: "success",
        count: 1,
      }),
    ]);
    expect(overview.impact).toEqual({
      prTriggeredRuns: 1,
      successfulPrRuns: 1,
      outputLinkedRuns: 1,
      outputPullRequests: 1,
      mergedPullRequests: 1,
      outputAdditions: 42,
      outputDeletions: 8,
      outputLinesChanged: 50,
      outputChangedFiles: 5,
      completedRuns: 1,
      noChangeRuns: 0,
    });
    expect(overview.runTrend).toEqual([
      expect.objectContaining({
        runCount: 1,
        successfulRuns: 1,
        failedRuns: 0,
        waitingRuns: 0,
        noChangeRuns: 0,
      }),
    ]);
    expect(overview.impactTrend).toEqual([
      expect.objectContaining({
        outputLinkedRuns: 1,
        outputPullRequests: 1,
        mergedPullRequests: 1,
        outputLinesChanged: 50,
        outputChangedFiles: 5,
      }),
    ]);
    expect(overview.nanitesByCreator).toEqual([
      expect.objectContaining({
        key: "alex",
        naniteCount: 1,
      }),
    ]);
    expect(overview.runsByActor).toEqual([
      expect.objectContaining({
        key: "alex",
        runCount: 1,
        successfulRunCount: 1,
      }),
    ]);
    expect(runs).toEqual([
      expect.objectContaining({
        repository: visibleRepository,
        outputUrl: seed.visibleRun.outputUrl,
        outputPullRequestNumber: 12,
        outputPullRequestMerged: true,
        outputAdditions: 42,
        outputDeletions: 8,
        outputChangedFiles: 5,
      }),
    ]);
  } finally {
    await cleanupPrefix(fixture.prefix);
  }
});

test("observability API uses GitHub installation and repository visibility", async () => {
  const fixture = await createFixture();
  const restore = mockVisibleGitHubAccess(fixture);
  try {
    const seed = await seedCatalogAndRuns(fixture);
    await recordVisibleAndHiddenAiUsage(fixture, seed, {
      visibleRequestId: `${fixture.prefix}-api-visible`,
      hiddenRequestId: `${fixture.prefix}-api-hidden`,
      visibleCostUsdMicros: 400,
      hiddenCostUsdMicros: 500,
    });
    const cookie = await buildAuthCookie(fixture.installation);
    const overviewContext = createExecutionContext();
    const overviewResponse = await worker.fetch(
      new Request(
        `http://example.com/api/observability/overview?installationId=${fixture.installation.id}&range=7d`,
        {
          headers: { Cookie: cookie },
        },
      ),
      env,
      overviewContext,
    );
    await waitOnExecutionContext(overviewContext);

    expect(overviewResponse.status).toBe(200);
    const overview: Awaited<ReturnType<typeof getObservabilityOverview>> =
      await overviewResponse.json();
    expect(overview.costByRepository).toEqual([
      expect.objectContaining({
        key: visibleRepository,
        estimatedCostUsdMicros: 400,
      }),
    ]);
    expect(overview.costByRepository).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: hiddenRepository })]),
    );

    const forbiddenContext = createExecutionContext();
    const forbiddenResponse = await worker.fetch(
      new Request(
        `http://example.com/api/observability/overview?installationId=${fixture.installation.id}&range=7d&repository=${encodeURIComponent(
          hiddenRepository,
        )}`,
        {
          headers: { Cookie: cookie },
        },
      ),
      env,
      forbiddenContext,
    );
    await waitOnExecutionContext(forbiddenContext);

    expect(forbiddenResponse.status).toBe(403);
    expect(await forbiddenResponse.json()).toEqual({
      code: "nanite_repository_scope_forbidden",
      githubInstallationId: fixture.installation.id,
      repositories: [hiddenRepository],
    });
  } finally {
    restore();
    await cleanupPrefix(fixture.prefix);
  }
});
