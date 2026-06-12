import { env } from "cloudflare:test";
import { beforeEach } from "vite-plus/test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { readGitHubAppMetadata, resolveGitHubApp } from "#/backend/github/apps.ts";
import { TEST_GITHUB_APP_ID, resetGitHubAppTables } from "../helpers/d1-baseline.ts";

const LOCAL_ORIGIN = "http://localhost:5173";
const DEPLOYED_ORIGIN = "https://sigvelo-agent-tests.example.workers.dev";
const GITHUB_APP_PROFILE_URL = "https://api.github.com/app";
const GITHUB_MANIFEST_CONVERSION_URL =
  "https://api.github.com/app-manifests/test-dev-manifest-code/conversions";
const STATE_COOKIE_NAME = "nanites_dev_setup_state";
const CONVERTED_APP_ID = 99999;

beforeEach(async () => {
  await resetGitHubAppTables(env.DB);
});

function buildAppProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_GITHUB_APP_ID,
    slug: "nanites-restored",
    html_url: "https://github.com/apps/nanites-restored",
    owner: { login: "WebMCP-org", type: "Organization" },
    client_id: "restored-client-id",
    permissions: { issues: "write" },
    events: ["issues"],
    ...overrides,
  };
}

function buildManifestConversion() {
  return {
    id: CONVERTED_APP_ID,
    slug: "nanites-dev-test",
    html_url: "https://github.com/apps/nanites-dev-test",
    owner: { login: "alexmnahas", type: "User" },
    client_id: "Iv1.devtest",
    client_secret: "dev-client-secret",
    // GitHub may omit the webhook secret when hooks start inactive.
    webhook_secret: null,
    pem: "-----BEGIN RSA PRIVATE KEY-----\ntest-key-body\n-----END RSA PRIVATE KEY-----\n",
    permissions: { issues: "write" },
    events: ["issues"],
  };
}

function withStubbedFetch(handler: (request: Request) => Response | null): { restore: () => void } {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return handler(request) ?? originalFetch(input, init);
  };
  return { restore: () => void (globalThis.fetch = originalFetch) };
}

function readStateCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${STATE_COOKIE_NAME}=([^;]+)`).exec(setCookie);
  if (!match?.[1]) {
    throw new Error("Expected the dev setup page to set a manifest state cookie.");
  }
  return match[1];
}

test("dev setup routes are hidden off loopback hostnames", async () => {
  const pageResponse = await nanitesHttpApp.request(`${DEPLOYED_ORIGIN}/setup/local`, {}, env);
  expect(pageResponse.status).toBe(404);

  const restoreResponse = await nanitesHttpApp.request(
    `${DEPLOYED_ORIGIN}/setup/local/restore`,
    { method: "POST" },
    env,
  );
  expect(restoreResponse.status).toBe(404);
});

test("restore rebuilds the github_apps row from env secrets via GET /app", async () => {
  const stub = withStubbedFetch((request) =>
    request.url === GITHUB_APP_PROFILE_URL && request.method === "GET"
      ? Response.json(buildAppProfile())
      : null,
  );
  try {
    const response = await nanitesHttpApp.request(
      `${LOCAL_ORIGIN}/setup/local/restore`,
      { method: "POST", headers: { accept: "application/json" } },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      restored: [{ appId: TEST_GITHUB_APP_ID, slug: "nanites-restored", missingSecrets: [] }],
      failed: [],
    });
  } finally {
    stub.restore();
  }

  const db = createDbClient(env.DB);
  await expect(readGitHubAppMetadata(db, TEST_GITHUB_APP_ID)).resolves.toMatchObject({
    slug: "nanites-restored",
    clientId: "restored-client-id",
    isPrimary: true,
    status: "active",
    permissions: { issues: "write" },
    events: ["issues"],
  });
  // The restored row resolves against the secrets already in env.
  await expect(resolveGitHubApp(db, env, TEST_GITHUB_APP_ID)).resolves.not.toBeNull();
});

test("restore reports rotated or deleted apps instead of registering them", async () => {
  const stub = withStubbedFetch((request) =>
    request.url === GITHUB_APP_PROFILE_URL
      ? Response.json({ message: "Bad credentials" }, { status: 401 })
      : null,
  );
  try {
    const response = await nanitesHttpApp.request(
      `${LOCAL_ORIGIN}/setup/local/restore`,
      { method: "POST", headers: { accept: "application/json" } },
      env,
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as { restored: unknown[]; failed: { appId: number }[] };
    expect(body.restored).toEqual([]);
    expect(body.failed).toMatchObject([{ appId: TEST_GITHUB_APP_ID }]);
  } finally {
    stub.restore();
  }

  await expect(
    readGitHubAppMetadata(createDbClient(env.DB), TEST_GITHUB_APP_ID),
  ).resolves.toBeNull();
});

test("manifest callback registers the app and prints the .dev.vars paste block", async () => {
  const pageResponse = await nanitesHttpApp.request(`${LOCAL_ORIGIN}/setup/local`, {}, env);
  const state = readStateCookie(pageResponse);
  // The OAuth callback registered on the dev app must use localhost, or
  // sign-in fails only after a real app has been created on GitHub.
  expect(await pageResponse.text()).toContain("http://localhost:5173/auth/github/callback");

  const stub = withStubbedFetch((request) =>
    request.url === GITHUB_MANIFEST_CONVERSION_URL && request.method === "POST"
      ? Response.json(buildManifestConversion(), { status: 201 })
      : null,
  );
  let body: string;
  try {
    const response = await nanitesHttpApp.request(
      `${LOCAL_ORIGIN}/setup/local/github/callback?code=test-dev-manifest-code&state=${state}`,
      { headers: { cookie: `${STATE_COOKIE_NAME}=${state}` } },
      env,
    );
    expect(response.status).toBe(200);
    body = await response.text();
  } finally {
    stub.restore();
  }

  // The PEM is rendered as one dotenv line with literal \n escapes.
  expect(body).toContain(`GITHUB_APP_${CONVERTED_APP_ID}_PRIVATE_KEY=`);
  expect(body).toContain("-----BEGIN RSA PRIVATE KEY-----\\ntest-key-body\\n");
  expect(body).toContain(`GITHUB_APP_${CONVERTED_APP_ID}_CLIENT_SECRET=`);
  // GitHub returned no webhook secret, so the route minted one.
  expect(body).toMatch(
    new RegExp(`GITHUB_APP_${CONVERTED_APP_ID}_WEBHOOK_SECRET=&quot;[0-9a-f]{64}&quot;`),
  );
  expect(body).toContain("https://github.com/apps/nanites-dev-test/installations/new");
  // The trimmed dev permissions drift from the defaults only warns.
  expect(body).toContain("Missing default permission");

  await expect(
    readGitHubAppMetadata(createDbClient(env.DB), CONVERTED_APP_ID),
  ).resolves.toMatchObject({
    slug: "nanites-dev-test",
    clientId: "Iv1.devtest",
    isPrimary: true,
    status: "active",
  });
});

test("manifest callback rejects a state mismatch without contacting GitHub", async () => {
  const response = await nanitesHttpApp.request(
    `${LOCAL_ORIGIN}/setup/local/github/callback?code=test-dev-manifest-code&state=forged`,
    { headers: { cookie: `${STATE_COOKIE_NAME}=expected` } },
    env,
  );

  expect(response.status).toBe(400);
  await expect(readGitHubAppMetadata(createDbClient(env.DB), CONVERTED_APP_ID)).resolves.toBeNull();
});
