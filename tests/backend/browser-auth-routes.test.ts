import { MANAGER_CONVERSATION_AGENT_NAME } from "#/shared/constants.ts";
import { env } from "cloudflare:test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { authorizeAgentRequest } from "#/backend/auth/index.ts";
import {
  buildTestBrowserAuthCookieHeader,
  ensureD1BaselineSchema,
  seedTestDeploymentInstallation,
} from "../helpers/d1-baseline.ts";
import { mockGitHubApi, mockGitHubVisibleInstallations } from "../helpers/github-api-mock.ts";
import { buildNaniteManagerKey } from "#/shared/utils/nanites.ts";

const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const TEST_INSTALLATION_ID = 122769206;
const TEST_REQUEST_ID = "test-request-id";

beforeEach(async () => {
  await ensureD1BaselineSchema(env.DB);
  await env.DB.exec("DELETE FROM account_repositories;");
  await env.DB.exec("DELETE FROM account_installations;");
  await env.DB.exec("DELETE FROM accounts;");
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
  await seedTestDeploymentInstallation(env.DB, { githubInstallationId: TEST_INSTALLATION_ID });
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
  const authorized = await authorizeAgentRequest(request, env, TEST_REQUEST_ID);

  expect(authorized).toBeInstanceOf(Response);
  expect((authorized as Response).status).toBe(status);
  await expect((authorized as Response).json()).resolves.toMatchObject(expected);
}

test("GitHub OAuth login starts on the runtime origin", async () => {
  const login = await nanitesHttpApp.request(
    "https://nanites-app-production.alexmnahas.workers.dev/auth/github/login?returnTo=/nanites",
    {},
    env,
  );
  const authorizationUrl = new URL(login.headers.get("Location") ?? "");

  expect(login.status).toBe(302);
  expect(login.headers.get("Set-Cookie")).toContain("nanites_github_oauth_state=");
  expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
    "https://nanites-app-production.alexmnahas.workers.dev/auth/github/callback",
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

test("optional session returns a null active installation when no deployment installation exists", async () => {
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

test("optional session hides active installation when GitHub user cannot see it", async () => {
  await seedDeploymentInstallation();
  const restore = mockGitHubVisibleInstallations([]);
  const request = new Request("http://localhost:5173/api/auth/session/optional");
  const cookieHeader = await buildAuthenticatedCookieHeader(request);

  try {
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
  } finally {
    restore();
  }
});

test("optional session clears stale auth cookies when the token belongs to another app", async () => {
  const request = new Request("http://localhost:5173/api/auth/session/optional");
  const cookieHeader = await buildTestBrowserAuthCookieHeader(env, request, {
    githubViewer: { id: 94631653, login: "MiguelsPizza" },
    githubAppId: 999,
  });

  await expectOptionalSessionToClearAuthCookies(request, cookieHeader);
});

test("manager conversation agent auth derives trusted actor headers", async () => {
  await seedDeploymentInstallation();
  const restore = mockGitHubVisibleInstallations([{ id: TEST_INSTALLATION_ID }]);
  const managerName = buildNaniteManagerKey({
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

  try {
    const authorized = await authorizeAgentRequest(request, env, TEST_REQUEST_ID);

    expect(authorized).toBeInstanceOf(Request);
    const headers = (authorized as Request).headers;
    expect(headers.get("x-nanites-github-login")).toBe("MiguelsPizza");
    expect(headers.get("x-nanites-github-user-id")).toBe("94631653");
  } finally {
    restore();
  }
});

test("manager conversation agent auth rejects a manager outside the deployment installation", async () => {
  await seedDeploymentInstallation();
  const restore = mockGitHubVisibleInstallations([{ id: TEST_INSTALLATION_ID }]);
  const managerName = buildNaniteManagerKey({
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

  try {
    await expectAgentAuthProblemResponse(request, {
      code: "agent_authorization_forbidden",
    });
  } finally {
    restore();
  }
});

test("manager conversation agent auth rejects another actor suffix", async () => {
  await seedDeploymentInstallation();
  const managerName = buildNaniteManagerKey({
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

test("manager conversation agent auth rejects GitHub users outside the deployment installation", async () => {
  await seedDeploymentInstallation();
  const restore = mockGitHubVisibleInstallations([]);
  const managerName = buildNaniteManagerKey({
    githubInstallationId: TEST_INSTALLATION_ID,
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

  try {
    await expectAgentAuthProblemResponse(request, {
      code: "deployment_github_installation_forbidden",
      githubInstallationId: TEST_INSTALLATION_ID,
    });
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

test("protected API routes require a browser session", async () => {
  const response = await nanitesHttpApp.request("/api/nanites/manager", {}, env);

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({
    code: "authentication_required",
  });
});

test("protected API routes reject GitHub users outside the deployment installation", async () => {
  await seedDeploymentInstallation();
  const restore = mockGitHubVisibleInstallations([]);
  const request = new Request("http://localhost:5173/api/nanites/models");

  try {
    const response = await nanitesHttpApp.request(
      request,
      {
        headers: {
          Cookie: await buildAuthenticatedCookieHeader(request),
        },
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "deployment_github_installation_forbidden",
      githubInstallationId: TEST_INSTALLATION_ID,
    });
  } finally {
    restore();
  }
});
