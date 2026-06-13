import { env } from "cloudflare:test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import {
  buildBrowserSessionExpiration,
  githubUserTokenSchema,
  nanitesSessionSchema,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
} from "#/backend/auth/session.ts";
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
  ensureD1BaselineSchema,
  resetGitHubAppTables,
  saveTestGitHubApp,
} from "../helpers/d1-baseline.ts";

const GITHUB_API_ORIGIN = "https://api.github.com";
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

function isGitHubApiRequest(request: Request, pathname: string): boolean {
  const url = new URL(request.url);
  return url.origin === GITHUB_API_ORIGIN && url.pathname === pathname;
}

function isGitHubListRequest(request: Request, pathname: string): boolean {
  if (!isGitHubApiRequest(request, pathname)) {
    return false;
  }

  const url = new URL(request.url);
  return (
    request.method === "GET" &&
    url.searchParams.get("per_page") === "100" &&
    (url.searchParams.get("page") === null || url.searchParams.get("page") === "1")
  );
}

function buildVisibleInstallation() {
  return {
    id: TEST_INSTALLATION_ID,
    account: {
      id: 456,
      login: "WebMCP-org",
      type: "Organization",
      avatar_url: null,
    },
    suspended_at: null,
  };
}

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

function buildVisibleRepositories(count: number) {
  return [
    buildVisibleRepository(),
    ...Array.from({ length: count - 1 }, (_, index) =>
      buildVisibleRepository({
        id: TEST_REPOSITORY_ID + index + 1,
        fullName: `WebMCP-org/extra-${index + 1}`,
      }),
    ),
  ];
}

async function buildCookieHeader(request: Request): Promise<string> {
  const expiresAt = buildBrowserSessionExpiration();
  const session = nanitesSessionSchema.parse({
    githubViewer: { id: 1, login: "alice" },
    activeGithubAppId: TEST_GITHUB_APP_ID,
    activeGithubInstallationId: TEST_INSTALLATION_ID,
    sessionInstallationSnapshot: null,
    expiresAt,
  });
  const githubUserToken = githubUserTokenSchema.parse({
    accessToken: "test-github-user-token",
    expiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    githubAppId: TEST_GITHUB_APP_ID,
    githubAppClientId: "generated-client-id",
  });

  return [
    await sealSessionCookie(session, request, env),
    await sealGitHubUserTokenCookie(githubUserToken, request, env),
  ]
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function seedObservabilityRows(): Promise<void> {
  const db = createDbClient(env.DB);
  const now = new Date("2026-06-12T12:00:00Z");

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
  const originalFetch = globalThis.fetch;
  const visibleInstallationRequests: string[] = [];
  const repositoryRequests: string[] = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);

    if (isGitHubListRequest(request, "/user/installations")) {
      visibleInstallationRequests.push(request.url);
      return Response.json({
        total_count: 1,
        installations: [buildVisibleInstallation()],
      });
    }

    if (isGitHubListRequest(request, `/user/installations/${TEST_INSTALLATION_ID}/repositories`)) {
      repositoryRequests.push(request.url);
      return Response.json({
        total_count: 70,
        repositories: buildVisibleRepositories(70),
      });
    }

    return originalFetch(input, init);
  };

  try {
    const request = new Request(
      `http://localhost:5173/api/observability/dashboard?range=7d&installationId=${TEST_INSTALLATION_ID}`,
    );
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
    expect(body.filterOptions.repositories).toHaveLength(70);
    expect(body.filterOptions.repositories).toContain(TEST_REPOSITORY);
    expect(body.filterOptions).toMatchObject({
      nanites: ["docs-syncer"],
      creators: ["alice"],
      outcomes: ["success"],
      surfaces: ["browser"],
    });
    expect(body.overview.kpis.find((kpi) => kpi.key === "runs")?.value).toBe(1);
    expect(visibleInstallationRequests).toHaveLength(1);
    expect(repositoryRequests).toHaveLength(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
