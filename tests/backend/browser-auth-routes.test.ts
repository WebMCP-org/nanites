import { MANAGER_CONVERSATION_AGENT_NAME } from "#/shared/constants.ts";
import { env } from "cloudflare:test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { authorizeAgentRequest } from "#/backend/auth/index.ts";
import {
  TEST_GITHUB_APP_ID,
  buildTestBrowserAuthCookieHeader,
  ensureD1BaselineSchema,
  resetGitHubAppTables,
  saveTestGitHubApp,
} from "../helpers/d1-baseline.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";
import { buildNaniteManagerKey } from "#/shared/utils/nanites.ts";

const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const CANONICAL_ORIGIN = "https://app.sigvelo.com";
const TEST_INSTALLATION_ID = 122769206;
const TEST_ACCOUNT_ID = "github-account:122769206";

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

function mockGitHubViewer(): () => void {
  return mockGitHubApi([
    {
      path: "/user",
      response: () => Response.json({ id: 94631653, login: "MiguelsPizza" }),
    },
  ]);
}

async function seedDeploymentInstallation(): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO accounts (
      id,
      github_account_id,
      github_account_login,
      github_account_type,
      github_account_avatar_url,
      last_active_at,
      first_seen_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      TEST_ACCOUNT_ID,
      TEST_INSTALLATION_ID,
      "WebMCP-org",
      "Organization",
      null,
      now,
      now,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO account_installations (
      id,
      account_id,
      github_app_id,
      github_installation_id,
      status,
      first_seen_at,
      last_seen_at,
      suspended_at,
      removed_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `github-installation:${TEST_INSTALLATION_ID}`,
      TEST_ACCOUNT_ID,
      TEST_GITHUB_APP_ID,
      TEST_INSTALLATION_ID,
      "active",
      now,
      now,
      null,
      null,
      now,
      now,
    )
    .run();
}

async function buildAuthenticatedCookieHeader(request: Request): Promise<string> {
  return buildTestBrowserAuthCookieHeader(env, request, {
    githubViewer: { id: 94631653, login: "MiguelsPizza" },
    githubUserToken: "test-github-user-token",
  });
}

async function expectOptionalSessionToClearAuthCookies(
  request: Request,
  cookieHeader: string,
): Promise<void> {
  const response = await nanitesHttpApp.request(
    request,
    {
      headers: { Cookie: cookieHeader },
    },
    env,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toBeNull();
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  expect(setCookie).toContain("nanites_session=");
  expect(setCookie).toContain("nanites_github_user_token=");
}

async function expectAgentAuthProblemResponse(
  request: Request,
  expected: Record<string, unknown>,
  status = 403,
): Promise<void> {
  const authorized = await authorizeAgentRequest(request, env);

  expect(authorized).toBeInstanceOf(Response);
  expect((authorized as Response).status).toBe(status);
  await expect((authorized as Response).json()).resolves.toMatchObject(expected);
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

test("GitHub OAuth login starts on the GitHub App setup origin", async () => {
  await resetGitHubAppTables(env.DB);
  await saveTestGitHubApp(env.DB, { setupOrigin: CANONICAL_ORIGIN });

  const redirected = await nanitesHttpApp.request(
    "https://nanites-app-production.alexmnahas.workers.dev/auth/github/login?returnTo=/setup",
    {},
    env,
  );

  expect(redirected.status).toBe(302);
  expect(redirected.headers.get("Set-Cookie")).toBeNull();
  expect(redirected.headers.get("Location")).toBe(
    `${CANONICAL_ORIGIN}/auth/github/login?returnTo=/setup`,
  );

  const login = await nanitesHttpApp.request(
    `${CANONICAL_ORIGIN}/auth/github/login?returnTo=/setup`,
    {},
    env,
  );
  const authorizationUrl = new URL(login.headers.get("Location") ?? "");

  expect(login.status).toBe(302);
  expect(login.headers.get("Set-Cookie")).toContain("nanites_github_oauth_state=");
  expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
    `${CANONICAL_ORIGIN}/auth/github/callback`,
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

test("test auth mints a browser session without selecting an installation", async () => {
  const restore = mockGitHubViewer();

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
    });
  } finally {
    restore();
  }
});

test("optional session returns setup state when no deployment installation exists", async () => {
  const request = new Request("http://localhost:5173/api/auth/session/optional");
  const cookieHeader = await buildAuthenticatedCookieHeader(request);

  const response = await nanitesHttpApp.request(
    request,
    {
      headers: { Cookie: cookieHeader },
    },
    env,
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    actor: { id: 94631653, login: "MiguelsPizza" },
    activeInstallation: null,
  });
});

test("optional session clears stale auth cookies when deployment app metadata is gone", async () => {
  const request = new Request("http://localhost:5173/api/auth/session/optional");
  const cookieHeader = await buildAuthenticatedCookieHeader(request);
  await resetGitHubAppTables(env.DB);

  await expectOptionalSessionToClearAuthCookies(request, cookieHeader);
});

test("manager conversation agent auth derives trusted actor headers", async () => {
  await seedDeploymentInstallation();
  const managerName = buildNaniteManagerKey({
    githubAppId: TEST_GITHUB_APP_ID,
    githubInstallationId: TEST_INSTALLATION_ID,
  });
  const request = new Request(
    `http://localhost:5173/agents/${MANAGER_CONVERSATION_AGENT_NAME}/${managerName}:manager:94631653`,
    {
      headers: {
        Cookie: await buildAuthenticatedCookieHeader(
          new Request("http://localhost:5173/api/auth/session/optional"),
        ),
        "x-nanites-github-login": "spoofed-login",
        "x-nanites-github-user-id": "999",
      },
    },
  );

  const authorized = await authorizeAgentRequest(request, env);

  expect(authorized).toBeInstanceOf(Request);
  const headers = (authorized as Request).headers;
  expect(headers.get("x-nanites-github-login")).toBe("MiguelsPizza");
  expect(headers.get("x-nanites-github-user-id")).toBe("94631653");
});

test("manager conversation agent auth rejects a manager outside the deployment installation", async () => {
  await seedDeploymentInstallation();
  const managerName = buildNaniteManagerKey({
    githubAppId: TEST_GITHUB_APP_ID,
    githubInstallationId: 999,
  });
  const request = new Request(
    `http://localhost:5173/agents/${MANAGER_CONVERSATION_AGENT_NAME}/${managerName}:manager:94631653`,
    {
      headers: {
        Cookie: await buildAuthenticatedCookieHeader(
          new Request("http://localhost:5173/api/auth/session/optional"),
        ),
      },
    },
  );

  await expectAgentAuthProblemResponse(request, {
    code: "agent_authorization_forbidden",
  });
});

test("manager conversation agent auth rejects another actor suffix", async () => {
  await seedDeploymentInstallation();
  const managerName = buildNaniteManagerKey({
    githubAppId: TEST_GITHUB_APP_ID,
    githubInstallationId: TEST_INSTALLATION_ID,
  });
  const request = new Request(
    `http://localhost:5173/agents/${MANAGER_CONVERSATION_AGENT_NAME}/${managerName}:manager:999`,
    {
      headers: {
        Cookie: await buildAuthenticatedCookieHeader(
          new Request("http://localhost:5173/api/auth/session/optional"),
        ),
      },
    },
  );

  await expectAgentAuthProblemResponse(request, {
    code: "agent_authorization_forbidden",
  });
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

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    code: "deployment_github_installation_required",
  });
});
