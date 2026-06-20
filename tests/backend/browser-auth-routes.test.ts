import { MANAGER_CONVERSATION_AGENT_NAME } from "#/shared/constants.ts";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
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
import worker from "#/server.ts";

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

function mockBrowserManagerConversationGitHubApi(): () => void {
  return mockGitHubApi([
    {
      path: "/user",
      response: () => Response.json({ id: 94631653, login: "MiguelsPizza" }),
    },
    {
      path: /^\/user\/installations\?/,
      response: () =>
        Response.json({
          total_count: 1,
          installations: [buildVisibleInstallation(122769206, "WebMCP-org")],
        }),
    },
    {
      method: "POST",
      path: "/app/installations/122769206/access_tokens",
      response: () =>
        Response.json({
          token: "test-installation-token",
          expires_at: "2026-06-10T20:00:00Z",
          permissions: {},
        }),
    },
    {
      path: /^\/installation\/repositories\?(?:page=1&per_page=100|per_page=100&page=1)$/,
      response: () =>
        Response.json({
          total_count: 0,
          repository_selection: "selected",
          repositories: [],
        }),
    },
  ]);
}

async function buildAuthenticatedCookieHeader(request: Request): Promise<string> {
  return buildTestBrowserAuthCookieHeader(env, request, {
    githubViewer: { id: 94631653, login: "MiguelsPizza" },
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
    githubUserToken: "stale-github-user-token",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function webSocketMessageText(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return String(data);
}

function readWebSocketJson(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message."));
    }, 5_000);
    const onMessage = (event: MessageEvent) => {
      cleanup();
      resolve(JSON.parse(webSocketMessageText(event.data)));
    };
    const onError = () => {
      cleanup();
      reject(new Error("Websocket errored before the expected message arrived."));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Websocket closed before the expected message arrived."));
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

async function readRpcResponse(socket: WebSocket, id: string): Promise<Record<string, unknown>> {
  for (;;) {
    const message = await readWebSocketJson(socket);
    if (isRecord(message) && message.type === "rpc" && message.id === id) {
      return message;
    }
  }
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

test("optional session clears stale auth cookies when deployment app metadata is gone", async () => {
  const request = new Request("http://localhost:5173/api/auth/session/optional");
  const cookieHeader = await buildAuthenticatedCookieHeader(request);
  await resetGitHubAppTables(env.DB);

  await expectOptionalSessionToClearAuthCookies(request, cookieHeader);
});

test("optional session clears stale auth cookies minted by another deployment app", async () => {
  const request = new Request("http://localhost:5173/api/auth/session/optional");
  const cookieHeader = await buildTestBrowserAuthCookieHeader(env, request, {
    githubViewer: { id: 94631653, login: "MiguelsPizza" },
    activeGithubInstallationId: 122769206,
    sessionInstallationSnapshot: {
      id: 122769206,
      githubAppId: 999,
      account: {
        id: 122769206,
        login: "WebMCP-org",
        type: "Organization",
        avatar_url: null,
      },
    },
    githubAppId: 999,
  });

  await expectOptionalSessionToClearAuthCookies(request, cookieHeader);
});

test("manager conversation agent auth derives trusted browser installation headers", async () => {
  const managerName = buildNaniteManagerKey({
    githubAppId: TEST_GITHUB_APP_ID,
    githubInstallationId: 122769206,
  });
  const request = new Request(
    `http://localhost:5173/agents/${MANAGER_CONVERSATION_AGENT_NAME}/${managerName}:manager:94631653`,
    {
      headers: {
        Cookie: await buildAuthenticatedCookieHeader(
          new Request("http://localhost:5173/api/auth/installations/visible"),
        ),
        "x-nanites-active-github-app-id": "999",
        "x-nanites-active-installation-id": "999",
        "x-nanites-github-login": "spoofed-login",
        "x-nanites-github-user-id": "999",
        "x-nanites-installation-account-login": "SpoofedOrg",
      },
    },
  );
  const restore = mockGitHubViewerAndInstallations({
    total_count: 1,
    installations: [buildVisibleInstallation(122769206, "WebMCP-org")],
  });

  try {
    const authorized = await authorizeAgentRequest(request, env);

    expect(authorized).toBeInstanceOf(Request);
    const headers = (authorized as Request).headers;
    expect(headers.get("x-nanites-active-github-app-id")).toBe(String(TEST_GITHUB_APP_ID));
    expect(headers.get("x-nanites-active-installation-id")).toBe("122769206");
    expect(headers.get("x-nanites-github-login")).toBe("MiguelsPizza");
    expect(headers.get("x-nanites-github-user-id")).toBe("94631653");
    expect(headers.get("x-nanites-installation-account-login")).toBe("WebMCP-org");
  } finally {
    restore();
  }
});

test("manager conversation agent auth returns a problem response when installation access is revoked", async () => {
  const managerName = buildNaniteManagerKey({
    githubAppId: TEST_GITHUB_APP_ID,
    githubInstallationId: 999,
  });
  const request = new Request(
    `http://localhost:5173/agents/${MANAGER_CONVERSATION_AGENT_NAME}/${managerName}:manager:94631653`,
    {
      headers: {
        Cookie: await buildAuthenticatedCookieHeader(
          new Request("http://localhost:5173/api/auth/installations/visible"),
        ),
      },
    },
  );
  const restore = mockGitHubViewerAndInstallations({
    total_count: 1,
    installations: [buildVisibleInstallation(122769206, "WebMCP-org")],
  });

  try {
    await expectAgentAuthProblemResponse(request, {
      code: "installation_access_revoked",
      githubInstallationId: 999,
    });
  } finally {
    restore();
  }
});

test("manager conversation agent auth rejects another actor suffix", async () => {
  const managerName = buildNaniteManagerKey({
    githubAppId: TEST_GITHUB_APP_ID,
    githubInstallationId: 122769206,
  });
  const request = new Request(
    `http://localhost:5173/agents/${MANAGER_CONVERSATION_AGENT_NAME}/${managerName}:manager:999`,
    {
      headers: {
        Cookie: await buildAuthenticatedCookieHeader(
          new Request("http://localhost:5173/api/auth/installations/visible"),
        ),
      },
    },
  );

  await expectAgentAuthProblemResponse(request, {
    code: "agent_authorization_forbidden",
  });
});

test("manager conversation websocket RPC uses browser auth captured at connect time", async () => {
  const managerName = buildNaniteManagerKey({
    githubAppId: TEST_GITHUB_APP_ID,
    githubInstallationId: 122769206,
  });
  const restore = mockBrowserManagerConversationGitHubApi();
  const ctx = createExecutionContext();

  try {
    const response = await worker.fetch(
      new Request(
        `http://localhost:5173/agents/${MANAGER_CONVERSATION_AGENT_NAME}/${managerName}:manager:94631653`,
        {
          headers: {
            Cookie: await buildAuthenticatedCookieHeader(
              new Request("http://localhost:5173/api/auth/installations/visible"),
            ),
            Upgrade: "websocket",
          },
        },
      ),
      env,
      ctx,
    );
    const socket = response.webSocket;

    expect(response.status).toBe(101);
    expect(socket).toBeDefined();

    socket?.accept();
    socket?.send(
      JSON.stringify({
        args: [],
        id: "connect-browser-installation",
        method: "connectBrowserInstallation",
        type: "rpc",
      }),
    );

    await expect(readRpcResponse(socket!, "connect-browser-installation")).resolves.toMatchObject({
      done: true,
      result: { connected: true },
      success: true,
      type: "rpc",
    });
    socket?.close(1000, "test complete");
    await waitOnExecutionContext(ctx);
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
