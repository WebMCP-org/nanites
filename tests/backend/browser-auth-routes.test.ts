import { env } from "cloudflare:test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { saveTestDeploymentGitHubAppMetadata } from "../helpers/d1-baseline.ts";

const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";

beforeEach(async () => {
  await saveTestDeploymentGitHubAppMetadata(env.DB);
});

function readCookieHeader(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) {
    throw new Error("Expected OAuth login response to set the state cookie.");
  }

  return setCookie.split(";", 1)[0];
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
    success: boolean;
    error: { name: string; message: string };
  };
  expect(body).toMatchObject({
    success: false,
    error: { name: "ZodError" },
  });
  expect(body.error.message).toContain("githubInstallationId");
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
