import { env } from "cloudflare:test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { buildBrowserSessionExpiration, sealSessionCookie } from "#/backend/auth/session.ts";

const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";

beforeAll(async () => {
  await env.DB.exec(
    [
      "CREATE TABLE IF NOT EXISTS installation_ai_provider_keys (",
      "github_installation_id integer NOT NULL,",
      "provider text NOT NULL,",
      "encrypted_api_key text NOT NULL,",
      "key_last4 text NOT NULL,",
      "created_at integer NOT NULL,",
      "updated_at integer NOT NULL,",
      "PRIMARY KEY(github_installation_id, provider)",
      ");",
    ].join(" "),
  );
});

function readCookieHeader(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) {
    throw new Error("Expected OAuth login response to set the state cookie.");
  }

  return setCookie.split(";", 1)[0];
}

async function browserSessionCookie(githubInstallationId: number): Promise<string> {
  return sealSessionCookie(
    {
      githubViewer: {
        id: 123,
        login: "octocat",
      },
      activeGithubInstallationId: githubInstallationId,
      sessionInstallationSnapshot: {
        id: githubInstallationId,
        account: {
          id: 456,
          login: "octo-org",
          type: "Organization",
          avatar_url: null,
        },
      },
      expiresAt: buildBrowserSessionExpiration(),
    },
    new Request("http://localhost:5173/api/auth/installation/ai-provider-keys"),
    env as Env,
  );
}

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
    success: boolean;
    error: { name: string; message: string };
  };
  expect(body).toMatchObject({
    success: false,
    error: { name: "ZodError" },
  });
  expect(body.error.message).toContain("githubInstallationId");
});

test("installation AI provider keys are managed from the active browser installation", async () => {
  const githubInstallationId = 78_910;
  const cookie = await browserSessionCookie(githubInstallationId);
  const listBefore = await nanitesHttpApp.request(
    "/api/auth/installation/ai-provider-keys",
    {
      headers: { Cookie: cookie },
    },
    env,
  );

  expect(listBefore.status).toBe(200);
  await expect(listBefore.json()).resolves.toMatchObject({
    providers: expect.arrayContaining([
      {
        provider: "deepseek",
        label: "DeepSeek",
      },
    ]),
    keys: [],
  });

  const saveResponse = await nanitesHttpApp.request(
    "/api/auth/installation/ai-provider-keys",
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: "deepseek",
        apiKey: "sk-test-deepseek-dashboard-key",
      }),
    },
    env,
  );

  expect(saveResponse.status).toBe(200);
  const saveBody = await saveResponse.json();
  expect(JSON.stringify(saveBody)).not.toContain("sk-test-deepseek-dashboard-key");
  expect(saveBody).toMatchObject({
    saved: {
      provider: "deepseek",
      keyLast4: "-key",
    },
    keys: [
      {
        provider: "deepseek",
        keyLast4: "-key",
      },
    ],
  });
});

test("test auth token failures bubble through the root error handler", async () => {
  const response = await nanitesHttpApp.request("/auth/test/mint-session?redirect=0", {}, env);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    code: "test_auth_token_required",
    hint: expect.stringContaining("GITHUB_TEST_USER_TOKEN"),
  });
});

test("root error handler maps auth failures from mounted API routes", async () => {
  const response = await nanitesHttpApp.request("/api/nanites/manager/installation:1", {}, env);

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    code: "authentication_required",
  });
});
