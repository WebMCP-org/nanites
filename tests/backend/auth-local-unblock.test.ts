import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { buildBrowserSessionExpiration } from "#/backend/browser-auth/policy.ts";
import { sealGitHubUserTokenCookie, sealSessionCookie } from "#/backend/browser-auth/cookies.ts";
import worker from "#/server.ts";
import { recordAccountAuthFunnelEvent } from "#/backend/business-data.ts";
import { recordAuthFunnelFact, recordPlatformUsageFact } from "@nanites/db/mutations/business";
import { createDbClient } from "@nanites/db/client";
import type { DbClient } from "@nanites/db/client";
import {
  githubAccountIdSchema,
  githubInstallationIdSchema,
  githubUserIdSchema,
} from "@nanites/contracts/ids";
import type { ActiveInstallation, GitHubUserToken } from "@nanites/contracts/auth";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";
import { buildRpcPath } from "#/shared/constants/rpc.ts";

const testDb = createDbClient(env.DB);
const TEST_AUTH_MINT_SESSION_PATH = "/auth/test/mint-session";
const GITHUB_OAUTH_LOGIN_PATH = "/auth/github/login";
const SESSION_GET_OPTIONAL_RPC_PATH = buildRpcPath("auth", "session", "getOptional");
const REPOSITORIES_LIST_ACTIVE_RPC_PATH = buildRpcPath("auth", "repositories", "listActive");
const ORPC_CSRF_HEADER_NAME = "x-csrf-token";
const ORPC_CSRF_HEADER_VALUE = "orpc";
const TEST_AUTH_TOKEN_REQUIRED_MESSAGE =
  "Local authenticated browser sessions require a real GitHub user token. Provide GITHUB_TEST_USER_TOKEN, x-github-test-user-token, or ?githubAccessToken=...";

beforeAll(async () => {
  await env.DB.exec(
    [
      "PRAGMA foreign_keys = ON;",
      "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, last_active_at INTEGER, updated_at INTEGER);",
      "CREATE TABLE IF NOT EXISTS account_installations (account_id TEXT, github_installation_id INTEGER PRIMARY KEY, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE);",
      "CREATE TABLE IF NOT EXISTS auth_funnel_facts (id TEXT PRIMARY KEY, account_id TEXT, github_installation_id INTEGER, github_repository_id INTEGER, github_user_id INTEGER, github_login TEXT, event_type TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', occurred_at INTEGER NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE, FOREIGN KEY(github_installation_id) REFERENCES account_installations(github_installation_id) ON DELETE CASCADE);",
      "CREATE TABLE IF NOT EXISTS platform_usage_facts (id TEXT PRIMARY KEY, account_id TEXT, github_installation_id INTEGER, github_repository_id INTEGER, run_key TEXT, category TEXT NOT NULL, event_key TEXT NOT NULL, status TEXT, quantity INTEGER NOT NULL DEFAULT 1, duration_ms INTEGER, metadata_json TEXT NOT NULL DEFAULT '{}', occurred_at INTEGER NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE, FOREIGN KEY(github_installation_id) REFERENCES account_installations(github_installation_id) ON DELETE CASCADE);",
    ].join("\n"),
  );
});

beforeEach(async () => {
  await env.DB.exec(
    [
      "DELETE FROM auth_funnel_facts;",
      "DELETE FROM platform_usage_facts;",
      "DELETE FROM account_installations;",
      "DELETE FROM accounts;",
    ].join("\n"),
  );
});

async function selectFactRows(tableName: "auth_funnel_facts" | "platform_usage_facts") {
  const result = await env.DB.prepare(
    `SELECT account_id, github_installation_id, metadata_json FROM ${tableName}`,
  ).all<{
    account_id: string | null;
    github_installation_id: number | null;
    metadata_json: string;
  }>();

  return result.results.map((row) => ({
    accountId: row.account_id,
    githubInstallationId: row.github_installation_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  }));
}

async function buildAuthCookieHeader(options?: {
  activeInstallationSnapshot?: ActiveInstallation | null;
  githubUserToken?: Partial<GitHubUserToken>;
}) {
  const request = new Request("http://example.com/api/auth/session/optional");
  const expiresAt = buildBrowserSessionExpiration();
  const sessionCookie = await sealSessionCookie(
    {
      githubUserId: githubUserIdSchema.parse(7),
      githubLogin: "alex",
      activeGithubInstallationId: githubInstallationIdSchema.parse(999),
      activeInstallationSnapshot: options?.activeInstallationSnapshot,
      expiresAt,
    },
    request,
    env,
  );
  const githubUserTokenCookie = await sealGitHubUserTokenCookie(
    {
      accessToken: "invalid-token",
      expiresAt,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      ...options?.githubUserToken,
    },
    request,
    env,
  );

  return [sessionCookie, githubUserTokenCookie].map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

function buildGitHubApiJsonResponse(path: string, payload: unknown, init?: ResponseInit): Response {
  const response = Response.json(payload, init);
  Object.defineProperty(response, "url", {
    configurable: true,
    value: `https://api.github.com${path}`,
  });
  return response;
}

function collectSetCookieHeaders(response: Response): string[] {
  return [...response.headers.entries()]
    .filter(([name]) => name.toLowerCase() === "set-cookie")
    .map(([, value]) => value);
}

function buildRpcHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    [ORPC_CSRF_HEADER_NAME]: ORPC_CSRF_HEADER_VALUE,
    ...headers,
  };
}

function mockGitHubOAuthRefreshToken(): { requestBodies: string[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const requestBodies: string[] = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.origin !== "https://github.com" || url.pathname !== "/login/oauth/access_token") {
      return originalFetch(input, init);
    }

    requestBodies.push(await request.text());

    return Response.json(
      {
        access_token: "refreshed-user-token",
        expires_in: 28_800,
        refresh_token: "rotated-refresh-token",
        refresh_token_expires_in: 15_897_600,
        scope: "",
        token_type: "bearer",
      },
      {
        headers: {
          date: new Date().toUTCString(),
        },
      },
    );
  };

  return {
    requestBodies,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function parseRefreshTokenRequestBody(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(body));
  }
}

test("recordAuthFunnelFact stores unresolved installation ids in metadata instead of violating foreign keys", async () => {
  await recordAuthFunnelFact(testDb, {
    githubInstallationId: 999,
    githubUserId: 7,
    githubLogin: "alex",
    eventType: "session_invalidated",
    metadata: {
      reason: "bad_token",
    },
  });

  await expect(selectFactRows("auth_funnel_facts")).resolves.toEqual([
    {
      accountId: null,
      githubInstallationId: null,
      metadata: {
        reason: "bad_token",
        unresolvedGithubInstallationId: 999,
      },
    },
  ]);
  await expect(selectFactRows("platform_usage_facts")).resolves.toEqual([
    {
      accountId: null,
      githubInstallationId: null,
      metadata: {
        reason: "bad_token",
        unresolvedGithubInstallationId: 999,
      },
    },
  ]);
});

test("recordPlatformUsageFact also preserves unresolved installation ids in metadata", async () => {
  await recordPlatformUsageFact(testDb, {
    githubInstallationId: 555,
    category: "auth",
    eventKey: "session_invalidated",
    metadata: {
      phase: "revalidation",
    },
  });

  await expect(selectFactRows("platform_usage_facts")).resolves.toEqual([
    {
      accountId: null,
      githubInstallationId: null,
      metadata: {
        phase: "revalidation",
        unresolvedGithubInstallationId: 555,
      },
    },
  ]);
});

test("auth funnel telemetry write failures do not block auth routes", async () => {
  const failingDb = {
    insert() {
      throw new Error("analytics table unavailable");
    },
  } as unknown as DbClient;

  await expect(
    recordAccountAuthFunnelEvent({
      db: failingDb,
      eventType: "github_oauth_started",
      metadata: {
        returnToPath: "/authorize",
      },
    }),
  ).resolves.toBeUndefined();
});

test("GitHub OAuth login canonicalizes loopback host before creating GitHub redirect_uri", async () => {
  const loopbackResponse = await worker.fetch(
    new Request(`http://127.0.0.1:8765${GITHUB_OAUTH_LOGIN_PATH}?returnTo=/nanites`),
    env,
    createExecutionContext(),
  );

  expect(loopbackResponse.status).toBe(302);
  expect(loopbackResponse.headers.get("location")).toBe(
    `http://localhost:8765${GITHUB_OAUTH_LOGIN_PATH}?returnTo=/nanites`,
  );
  expect(collectSetCookieHeaders(loopbackResponse)).toEqual([]);

  const loginCtx = createExecutionContext();
  const loginResponse = await worker.fetch(
    new Request(`http://localhost:8765${GITHUB_OAUTH_LOGIN_PATH}?returnTo=/nanites`),
    env,
    loginCtx,
  );
  await waitOnExecutionContext(loginCtx);

  expect(loginResponse.status).toBe(302);
  const githubLocation = loginResponse.headers.get("location");
  expect(githubLocation).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  expect(githubLocation).not.toContain("127.0.0.1");
  expect(new URL(githubLocation ?? "").searchParams.get("redirect_uri")).toBe(
    "http://localhost:8765/auth/github/callback",
  );
  expect(collectSetCookieHeaders(loginResponse).some((value) => value.includes("Domain="))).toBe(
    false,
  );
});

test("auth session optional uses cached session installation without calling GitHub", async () => {
  const activeInstallation: ActiveInstallation = {
    id: githubInstallationIdSchema.parse(999),
    account: {
      id: githubAccountIdSchema.parse(123),
      login: "WebMCP-org",
      type: "Organization",
      avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
    },
  };
  const restoreFetch = mockGitHubApi([
    {
      path: /\/user\/installations(\?.*)?$/,
      response: () => {
        throw new Error("getOptional should not revalidate GitHub installations.");
      },
    },
  ]);

  try {
    const request = new Request(`http://example.com${SESSION_GET_OPTIONAL_RPC_PATH}`, {
      method: "POST",
      headers: buildRpcHeaders({
        "content-type": "application/json",
        cookie: await buildAuthCookieHeader({
          activeInstallationSnapshot: activeInstallation,
        }),
      }),
      body: "{}",
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      json: {
        actor: {
          id: 7,
          login: "alex",
        },
        activeInstallation,
      },
    });

    const setCookieHeaders = collectSetCookieHeaders(response);
    expect(setCookieHeaders.some((value) => value.includes("nanites_session="))).toBe(true);
  } finally {
    restoreFetch();
  }
});

test("auth session optional supports old sessions without an installation snapshot", async () => {
  const restoreFetch = mockGitHubApi([
    {
      path: /\/user\/installations(\?.*)?$/,
      response: () => {
        throw new Error("getOptional should not call GitHub for old session cookies.");
      },
    },
  ]);

  try {
    const request = new Request(`http://example.com${SESSION_GET_OPTIONAL_RPC_PATH}`, {
      method: "POST",
      headers: buildRpcHeaders({
        "content-type": "application/json",
        cookie: await buildAuthCookieHeader({
          activeInstallationSnapshot: null,
        }),
      }),
      body: "{}",
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      json: {
        actor: {
          id: 7,
          login: "alex",
        },
        activeInstallation: null,
      },
    });

    const setCookieHeaders = collectSetCookieHeaders(response);
    expect(setCookieHeaders.some((value) => value.includes("nanites_session="))).toBe(true);
  } finally {
    restoreFetch();
  }
});

test("auth session optional keeps the browser session when the GitHub token cookie is missing", async () => {
  const activeInstallation: ActiveInstallation = {
    id: githubInstallationIdSchema.parse(999),
    account: {
      id: githubAccountIdSchema.parse(123),
      login: "WebMCP-org",
      type: "Organization",
      avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
    },
  };
  const request = new Request(`http://example.com${SESSION_GET_OPTIONAL_RPC_PATH}`);
  const sessionCookie = await sealSessionCookie(
    {
      githubUserId: githubUserIdSchema.parse(7),
      githubLogin: "alex",
      activeGithubInstallationId: githubInstallationIdSchema.parse(999),
      activeInstallationSnapshot: activeInstallation,
      expiresAt: buildBrowserSessionExpiration(),
    },
    request,
    env,
  );

  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com${SESSION_GET_OPTIONAL_RPC_PATH}`, {
      method: "POST",
      headers: buildRpcHeaders({
        "content-type": "application/json",
        cookie: sessionCookie.split(";", 1)[0] ?? "",
      }),
      body: "{}",
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    json: {
      actor: {
        id: 7,
        login: "alex",
      },
      activeInstallation,
    },
  });

  const setCookieHeaders = collectSetCookieHeaders(response);
  const sessionSetCookie = setCookieHeaders.find((value) => value.includes("nanites_session="));
  expect(sessionSetCookie).toBeTruthy();
  expect(sessionSetCookie).not.toContain("Max-Age=0");
  expect(setCookieHeaders.some((value) => value.includes("nanites_github_user_token="))).toBe(
    false,
  );
});

test("auth session optional refreshes an expired GitHub access token when the refresh token is still valid", async () => {
  const activeInstallation: ActiveInstallation = {
    id: githubInstallationIdSchema.parse(999),
    account: {
      id: githubAccountIdSchema.parse(123),
      login: "WebMCP-org",
      type: "Organization",
      avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
    },
  };
  const refreshMock = mockGitHubOAuthRefreshToken();

  try {
    const request = new Request(`http://example.com${SESSION_GET_OPTIONAL_RPC_PATH}`, {
      method: "POST",
      headers: buildRpcHeaders({
        "content-type": "application/json",
        cookie: await buildAuthCookieHeader({
          activeInstallationSnapshot: activeInstallation,
          githubUserToken: {
            accessToken: "expired-user-token",
            expiresAt: new Date(Date.now() - 1000).toISOString(),
            refreshToken: "still-valid-refresh-token",
            refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        }),
      }),
      body: "{}",
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      json: {
        actor: {
          id: 7,
          login: "alex",
        },
        activeInstallation,
      },
    });

    const setCookieHeaders = collectSetCookieHeaders(response);
    expect(setCookieHeaders.some((value) => value.includes("nanites_session="))).toBe(true);
    expect(setCookieHeaders.some((value) => value.includes("nanites_github_user_token="))).toBe(
      true,
    );
    expect(refreshMock.requestBodies).toHaveLength(1);
    expect(parseRefreshTokenRequestBody(refreshMock.requestBodies[0] ?? "")).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "still-valid-refresh-token",
    });
  } finally {
    refreshMock.restore();
  }
});

test("auth session optional keeps the browser session when GitHub refresh is unavailable", async () => {
  const activeInstallation: ActiveInstallation = {
    id: githubInstallationIdSchema.parse(999),
    account: {
      id: githubAccountIdSchema.parse(123),
      login: "WebMCP-org",
      type: "Organization",
      avatar_url: "https://avatars.githubusercontent.com/u/123?v=4",
    },
  };
  const request = new Request(`http://example.com${SESSION_GET_OPTIONAL_RPC_PATH}`, {
    method: "POST",
    headers: buildRpcHeaders({
      "content-type": "application/json",
      cookie: await buildAuthCookieHeader({
        activeInstallationSnapshot: activeInstallation,
        githubUserToken: {
          accessToken: "nearly-expired-user-token",
          expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
          refreshToken: null,
          refreshTokenExpiresAt: null,
        },
      }),
    }),
    body: "{}",
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    json: {
      actor: {
        id: 7,
        login: "alex",
      },
      activeInstallation,
    },
  });

  const setCookieHeaders = collectSetCookieHeaders(response);
  const sessionSetCookie = setCookieHeaders.find((value) => value.includes("nanites_session="));
  const githubUserTokenSetCookie = setCookieHeaders.find((value) =>
    value.includes("nanites_github_user_token="),
  );
  expect(sessionSetCookie).toBeTruthy();
  expect(sessionSetCookie).not.toContain("Max-Age=0");
  expect(githubUserTokenSetCookie).toContain("Max-Age=0");
});

test("repository RPC maps structural GitHub auth failures to unauthorized instead of 500", async () => {
  const restoreFetch = mockGitHubApi([
    {
      path: /\/user\/installations(\?.*)?$/,
      response: () => {
        throw { status: 403, message: "Bad credentials" };
      },
    },
  ]);

  try {
    const request = new Request(`http://example.com${REPOSITORIES_LIST_ACTIVE_RPC_PATH}`, {
      method: "POST",
      headers: buildRpcHeaders({
        "content-type": "application/json",
        cookie: await buildAuthCookieHeader(),
      }),
      body: "{}",
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      json: {
        code: "UNAUTHORIZED",
        status: 401,
        data: {
          code: "authentication_required",
        },
      },
    });

    const setCookieHeaders = collectSetCookieHeaders(response);
    expect(setCookieHeaders.some((value) => value.includes("nanites_session="))).toBe(true);
    expect(setCookieHeaders.some((value) => value.includes("nanites_github_user_token="))).toBe(
      true,
    );
  } finally {
    restoreFetch();
  }
});

test("test auth mint-session returns 400 without a real GitHub user token", async () => {
  const response = await worker.fetch(
    new Request(`http://example.com${TEST_AUTH_MINT_SESSION_PATH}?redirect=0`),
    env,
    createExecutionContext(),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: TEST_AUTH_TOKEN_REQUIRED_MESSAGE,
  });
});

test("test auth mint-session accepts an explicit real GitHub token and seals browser cookies", async () => {
  const restoreFetch = mockGitHubApi([
    {
      path: "/user",
      response: () =>
        buildGitHubApiJsonResponse("/user", {
          id: 7,
          login: "alex",
        }),
    },
    {
      path: /\/user\/installations(\?.*)?$/,
      response: () =>
        buildGitHubApiJsonResponse("/user/installations?per_page=100", {
          total_count: 1,
          installations: [
            {
              id: 1,
              suspended_at: null,
              account: {
                id: 11,
                login: "WebMCP-org",
                type: "Organization",
                avatar_url: "https://avatars.githubusercontent.com/u/11?v=4",
              },
            },
          ],
        }),
    },
  ]);

  try {
    const response = await worker.fetch(
      new Request(
        `http://example.com${TEST_AUTH_MINT_SESSION_PATH}?redirect=0&githubAccessToken=real-token`,
      ),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      actor: {
        githubLogin: "alex",
        githubUserId: 7,
      },
      activeGithubInstallationId: 1,
      returnTo: "/nanites",
    });

    const setCookieHeaders = collectSetCookieHeaders(response);
    expect(setCookieHeaders.some((value) => value.includes("nanites_session="))).toBe(true);
    expect(setCookieHeaders.some((value) => value.includes("nanites_github_user_token="))).toBe(
      true,
    );
  } finally {
    restoreFetch();
  }
});
