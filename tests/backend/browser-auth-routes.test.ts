import { env } from "cloudflare:test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import {
  buildBrowserSessionExpiration,
  githubUserTokenSchema,
  nanitesSessionSchema,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
} from "#/backend/auth/session.ts";
import {
  TEST_GITHUB_APP_ID,
  ensureD1BaselineSchema,
  resetGitHubAppTables,
  saveTestGitHubApp,
} from "../helpers/d1-baseline.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";

const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";

beforeEach(async () => {
  await ensureD1BaselineSchema(env.DB);
  await env.DB.exec("DELETE FROM account_repositories;");
  await env.DB.exec("DELETE FROM account_installations;");
  await env.DB.exec("DELETE FROM account_people;");
  await resetGitHubAppTables(env.DB);
  await env.DB.exec("DELETE FROM accounts;");
  await saveTestGitHubApp(env.DB);
});

function readCookieHeader(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) {
    throw new Error("Expected OAuth login response to set the state cookie.");
  }

  return setCookie.split(";", 1)[0];
}

function buildVisibleInstallation(id: number, login: string) {
  return {
    id,
    account: {
      id,
      login,
      type: "Organization",
      avatar_url: null,
    },
    suspended_at: null,
  };
}

function mockGitHubViewerAndInstallations(
  installationsResponse: Response | Record<string, unknown>,
): () => void {
  return mockGitHubApi([
    {
      path: "/user",
      response: () => Response.json({ id: 94631653, login: "MiguelsPizza" }),
    },
    {
      path: /^\/user\/installations\?/,
      response: () =>
        installationsResponse instanceof Response
          ? installationsResponse.clone()
          : Response.json(installationsResponse),
    },
  ]);
}

async function buildAuthenticatedCookieHeader(request: Request): Promise<string> {
  const expiresAt = buildBrowserSessionExpiration();
  const session = nanitesSessionSchema.parse({
    githubViewer: { id: 94631653, login: "MiguelsPizza" },
    activeGithubAppId: TEST_GITHUB_APP_ID,
    activeGithubInstallationId: 122769206,
    sessionInstallationSnapshot: {
      id: 122769206,
      githubAppId: TEST_GITHUB_APP_ID,
      account: {
        id: 122769206,
        login: "WebMCP-org",
        type: "Organization",
        avatar_url: null,
      },
    },
    expiresAt,
  });
  const githubUserToken = githubUserTokenSchema.parse({
    accessToken: "stale-github-user-token",
    expiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
  });

  return [
    await sealSessionCookie(session, request, env),
    await sealGitHubUserTokenCookie(githubUserToken, request, env),
  ]
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

test("GitHub OAuth callback reroutes install callbacks into setup verification login", async () => {
  const response = await nanitesHttpApp.request(
    "http://localhost:5173/auth/github/callback?code=test-code&installation_id=139264883&setup_action=update",
    {},
    env,
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("Set-Cookie")).toContain("nanites_github_oauth_state=");

  const location = new URL(response.headers.get("Location") ?? "");
  expect(location.origin).toBe("http://localhost:5173");
  expect(location.pathname).toBe("/auth/github/login");
  expect(location.searchParams.get("returnTo")).toBe(
    "/setup/github/verify?installation_id=139264883",
  );
});

test("GitHub OAuth callback preserves install callback state during setup verification login", async () => {
  const response = await nanitesHttpApp.request(
    "http://localhost:5173/auth/github/callback?code=test-code&installation_id=139264883&setup_action=install&state=test-install-state",
    {},
    env,
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("Set-Cookie")).toContain("nanites_github_oauth_state=");

  const location = new URL(response.headers.get("Location") ?? "");
  expect(location.origin).toBe("http://localhost:5173");
  expect(location.pathname).toBe("/auth/github/login");
  expect(location.searchParams.get("returnTo")).toBe(
    "/setup/github/verify?installation_id=139264883&state=test-install-state",
  );
});

test("GitHub OAuth callback reports token exchange errors without a raw 500", async () => {
  const loginResponse = await nanitesHttpApp.request(
    "http://localhost:5173/auth/github/login?returnTo=/nanites",
    {},
    env,
  );
  const authorizationUrl = new URL(loginResponse.headers.get("Location") ?? "");
  const callbackState = authorizationUrl.searchParams.get("state");
  const cookieHeader = readCookieHeader(loginResponse);
  const originalFetch = globalThis.fetch;
  const tokenExchangeRequests: string[] = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url !== GITHUB_OAUTH_TOKEN_URL) {
      return originalFetch(input, init);
    }

    tokenExchangeRequests.push(request.url);
    return Response.json(
      {
        error: "incorrect_client_credentials",
        error_description: "The client_id and/or client_secret passed are incorrect.",
      },
      { status: 200 },
    );
  };

  try {
    const callbackResponse = await nanitesHttpApp.request(
      `http://localhost:5173/auth/github/callback?code=test-code&state=${callbackState}`,
      {
        headers: {
          Cookie: cookieHeader,
        },
      },
      env,
    );

    const responseText = await callbackResponse.text();

    expect(responseText).toContain("GitHub OAuth token exchange failed");
    expect(responseText).not.toContain("Internal Server Error");
    expect(callbackResponse.status).toBe(400);
    expect(callbackResponse.headers.get("Set-Cookie")).toContain("nanites_github_oauth_state=");
    expect(tokenExchangeRequests).toHaveLength(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("active installation route validates JSON at the Hono boundary", async () => {
  const response = await nanitesHttpApp.request(
    "/api/auth/installations/active",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ githubInstallationId: 0 }),
    },
    env,
  );

  expect(response.status).toBe(400);
  const body = (await response.json()) as {
    code: string;
    kind: string;
    target: string;
    issues: readonly { readonly path: string; readonly code: string; readonly message: string }[];
  };
  expect(body).toMatchObject({
    code: "request_validation_failed",
    kind: "requestValidationFailed",
    target: "json",
    issues: [
      {
        path: "githubInstallationId",
        code: "too_small",
      },
    ],
  });
  expect(body.issues[0]?.message).toContain("number to be >0");
});

test("test auth does not auto-select when GitHub returns multiple visible installations", async () => {
  const restore = mockGitHubViewerAndInstallations({
    total_count: 2,
    installations: [
      buildVisibleInstallation(139264883, "MiguelsPizza"),
      buildVisibleInstallation(122769206, "WebMCP-org"),
    ],
  });

  try {
    const response = await nanitesHttpApp.request(
      "http://localhost:5173/auth/test/mint-session?redirect=0&githubAccessToken=test-token",
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      actor: {
        githubLogin: "MiguelsPizza",
        githubUserId: 94631653,
      },
      activeGithubInstallationId: null,
    });

    const rows = await env.DB.prepare(
      "SELECT github_installation_id, github_account_login FROM account_installations INNER JOIN accounts ON accounts.id = account_installations.account_id ORDER BY github_installation_id",
    ).all<{ github_installation_id: number; github_account_login: string }>();
    expect(rows.results).toEqual([
      { github_installation_id: 122769206, github_account_login: "WebMCP-org" },
      { github_installation_id: 139264883, github_account_login: "MiguelsPizza" },
    ]);
  } finally {
    restore();
  }
});

test("visible installations clears stale auth cookies when GitHub rejects the user token", async () => {
  const request = new Request("http://localhost:5173/api/auth/installations/visible");
  const cookieHeader = await buildAuthenticatedCookieHeader(request);
  const restore = mockGitHubViewerAndInstallations(
    Response.json({ message: "Bad credentials" }, { status: 401 }),
  );

  try {
    const response = await nanitesHttpApp.request(
      request,
      {
        headers: { Cookie: cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "authentication_required",
    });
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("nanites_session=");
    expect(setCookie).toContain("nanites_github_user_token=");
  } finally {
    restore();
  }
});

test("test auth token failures bubble through the root error handler", async () => {
  const response = await nanitesHttpApp.request("/auth/test/mint-session?redirect=0", {}, env);

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    code: "test_auth_token_required",
    hint: expect.stringContaining("GITHUB_TEST_USER_TOKEN"),
  });
});

test("root error handler maps auth failures from mounted API routes", async () => {
  const response = await nanitesHttpApp.request(
    `/api/nanites/manager/app:${TEST_GITHUB_APP_ID}:installation:1`,
    {},
    env,
  );

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({
    code: "authentication_required",
  });
});
