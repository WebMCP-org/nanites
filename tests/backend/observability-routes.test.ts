import { env } from "cloudflare:test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { createDbClient } from "#/backend/db/index.ts";
import {
  accountInstallations,
  accounts,
  aiUsageFacts,
  auditEvents,
  naniteCatalog,
  naniteRunFacts,
} from "#/backend/db/schema.ts";
import {
  TEST_GITHUB_APP_ID,
  buildTestBrowserAuthCookieHeader,
  ensureD1BaselineSchema,
  resetGitHubAppTables,
  saveTestGitHubApp,
} from "../helpers/d1-baseline.ts";

const TEST_INSTALLATION_ID = 42;
const TEST_REPOSITORY_ID = 987;
const TEST_REPOSITORY = "WebMCP-org/nanites";
const TEST_ACCOUNT_ID = "github-account:456";

beforeEach(async () => {
  await ensureD1BaselineSchema(env.DB);
  await env.DB.exec("DELETE FROM ai_usage_facts;");
  await env.DB.exec("DELETE FROM audit_events;");
  await env.DB.exec("DELETE FROM nanite_run_facts;");
  await env.DB.exec("DELETE FROM nanite_catalog;");
  await env.DB.exec("DELETE FROM account_repositories;");
  await env.DB.exec("DELETE FROM account_people;");
  await resetGitHubAppTables(env.DB);
  await env.DB.exec("DELETE FROM accounts;");
  await saveTestGitHubApp(env.DB);
});

function buildVisibleRepository(input: { id?: number; fullName?: string } = {}) {
  const fullName = input.fullName ?? TEST_REPOSITORY;
  const [, name = "nanites"] = fullName.split("/", 2);

  return {
    id: input.id ?? TEST_REPOSITORY_ID,
    name,
    full_name: fullName,
    owner: {
      id: 456,
      login: "WebMCP-org",
      type: "Organization",
      avatar_url: null,
    },
  };
}

async function buildCookieHeader(request: Request): Promise<string> {
  return buildTestBrowserAuthCookieHeader(env, request, {
    githubViewer: { id: 1, login: "alice" },
  });
}

async function seedObservabilityRows(): Promise<void> {
  const db = createDbClient(env.DB);
  const now = new Date();

  await db
    .insert(accounts)
    .values({
      id: TEST_ACCOUNT_ID,
      githubAccountId: 456,
      githubAccountLogin: "WebMCP-org",
      githubAccountType: "Organization",
    })
    .run();
  await db
    .insert(accountInstallations)
    .values({
      id: "installation-1",
      accountId: TEST_ACCOUNT_ID,
      githubAppId: TEST_GITHUB_APP_ID,
      githubInstallationId: TEST_INSTALLATION_ID,
      status: "active",
    })
    .run();
  await env.DB.prepare(
    `INSERT INTO account_repositories (
      id,
      account_id,
      github_app_id,
      github_installation_id,
      github_repository_id,
      github_repository,
      first_seen_at,
      last_seen_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      "repository-1",
      TEST_ACCOUNT_ID,
      TEST_GITHUB_APP_ID,
      TEST_INSTALLATION_ID,
      TEST_REPOSITORY_ID,
      JSON.stringify(buildVisibleRepository()),
      now.getTime(),
      now.getTime(),
      now.getTime(),
      now.getTime(),
    )
    .run();
  await db
    .insert(naniteCatalog)
    .values({
      id: "catalog-1",
      accountId: TEST_ACCOUNT_ID,
      githubAppId: TEST_GITHUB_APP_ID,
      githubInstallationId: TEST_INSTALLATION_ID,
      naniteId: "docs-syncer",
      name: "Docs syncer",
      enabled: true,
      eventSourceType: "github",
      latestVersionId: "version-1",
      modelId: "@cf/test/model",
      repositoryFullNamesJson: JSON.stringify([TEST_REPOSITORY]),
      repositoryCount: 1,
      createdByGithubUserId: 1,
      createdByGithubLogin: "alice",
      updatedByGithubUserId: 1,
      updatedByGithubLogin: "alice",
      createdAt: now,
      updatedAt: now,
      lastRunAt: now,
      lastRunStatus: "complete",
    })
    .run();
  await db
    .insert(naniteRunFacts)
    .values({
      id: "run-fact-1",
      accountId: TEST_ACCOUNT_ID,
      githubAppId: TEST_GITHUB_APP_ID,
      githubInstallationId: TEST_INSTALLATION_ID,
      githubRepositoryId: TEST_REPOSITORY_ID,
      repositoryFullName: TEST_REPOSITORY,
      runKey: "run-1",
      naniteId: "docs-syncer",
      variant: "workspace",
      triggerKind: "manual",
      actorKind: "github_user",
      actorGithubUserId: 1,
      actorGithubLogin: "alice",
      actorSource: "browser",
      status: "complete",
      conclusion: "success",
      phase: "completed",
      task: "Update docs",
      summary: "Docs updated.",
      startedAt: now,
      completedAt: now,
      lastUpdatedAt: now,
    })
    .run();
  await db
    .insert(aiUsageFacts)
    .values({
      id: "ai-usage-1",
      accountId: TEST_ACCOUNT_ID,
      githubAppId: TEST_GITHUB_APP_ID,
      githubInstallationId: TEST_INSTALLATION_ID,
      githubRepositoryId: TEST_REPOSITORY_ID,
      naniteId: "docs-syncer",
      runKey: "run-1",
      requestId: "request-1",
      provider: "workers-ai",
      model: "@cf/test/model",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      actorKind: "github_user",
      actorGithubUserId: 1,
      actorGithubLogin: "alice",
      actorSource: "browser",
      estimatedTotalCostUsdMicros: 123,
      startedAt: now,
      completedAt: now,
    })
    .run();
  await db
    .insert(auditEvents)
    .values({
      id: "audit-1",
      occurredAt: now,
      eventName: "nanite.run.completed",
      accountId: TEST_ACCOUNT_ID,
      githubAppId: TEST_GITHUB_APP_ID,
      githubInstallationId: TEST_INSTALLATION_ID,
      githubRepositoryId: TEST_REPOSITORY_ID,
      repositoryFullName: TEST_REPOSITORY,
      naniteId: "docs-syncer",
      runKey: "run-1",
      actorKind: "github_user",
      actorGithubUserId: 1,
      actorGithubLogin: "alice",
      surface: "browser",
      targetType: "run",
      targetId: "run-1",
      outcome: "success",
      metadataJson: "{}",
    })
    .run();
}

test("observability dashboard composes the page after resolving GitHub scope once", async () => {
  await seedObservabilityRows();
  const request = new Request("http://localhost:5173/api/observability/dashboard?range=7d");
  const response = await nanitesHttpApp.request(
    request,
    {
      headers: {
        Cookie: await buildCookieHeader(request),
      },
    },
    env,
  );
  const responseBody = await response.json();
  const body = responseBody as {
    overview: { kpis: readonly { key: string; value: number }[] };
    nanites: readonly { naniteId: string }[];
    runs: readonly { runKey: string }[];
    audit: readonly { eventName: string }[];
    filterOptions: {
      repositories: readonly string[];
      nanites: readonly string[];
      creators: readonly string[];
      outcomes: readonly string[];
      surfaces: readonly string[];
    };
  };

  expect(response.status).toBe(200);
  expect(body.nanites).toEqual([expect.objectContaining({ naniteId: "docs-syncer" })]);
  expect(body.runs).toEqual([expect.objectContaining({ runKey: "run-1" })]);
  expect(body.audit).toEqual([expect.objectContaining({ eventName: "nanite.run.completed" })]);
  expect(body.filterOptions.repositories).toEqual([TEST_REPOSITORY]);
  expect(body.filterOptions).toMatchObject({
    nanites: ["docs-syncer"],
    creators: ["alice"],
    outcomes: ["success"],
    surfaces: ["browser"],
  });
  expect(body.overview.kpis.find((kpi) => kpi.key === "runs")?.value).toBe(1);
});
