import { createExecutionContext, env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { createDbClient } from "#/backend/db/index.ts";
import {
  readDeploymentGitHubAppConfig,
  readDeploymentGitHubAppMetadata,
} from "#/backend/github/app-config.ts";
import {
  resetDeploymentGitHubAppConfigTable,
  saveTestDeploymentGitHubAppMetadata,
} from "../helpers/d1-baseline.ts";
import {
  CLOUDFLARE_SETUP_OAUTH_SCOPE,
  createInitialSetupState,
  type NanitesSetupAgent,
  type NanitesSetupState,
  type RefreshSetupInput,
} from "#/backend/agents/NanitesSetupAgent.ts";
import {
  buildBrowserSessionExpiration,
  githubUserTokenSchema,
  nanitesSessionSchema,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
} from "#/backend/auth/session.ts";
import { beforeEach } from "vite-plus/test";
import worker from "#/server.ts";
import { NANITES_SETUP_AGENT_INSTANCE_NAME, NANITES_SETUP_AGENT_NAME } from "#/nanites.ts";

const GITHUB_UPSTREAM_STAR_URL = "https://api.github.com/user/starred/WebMCP-org/nanites";
const SETUP_CLAIM_COOKIE_NAME = "nanites_setup_claim";
const GITHUB_API_ORIGIN = "https://api.github.com";
const SETUP_ORIGIN = "https://sigvelo-agent-tests.example.workers.dev";
const GITHUB_MANIFEST_CONVERSION_URL =
  "https://api.github.com/app-manifests/test-manifest-code/conversions";
const CLOUDFLARE_MCP_SERVER_ID = "cloudflare-api";
const CLOUDFLARE_MCP_SERVER_URL = "https://mcp.cloudflare.com/mcp";
const CLOUDFLARE_MCP_CALLBACK_PATH = `/agents/${NANITES_SETUP_AGENT_NAME}/${NANITES_SETUP_AGENT_INSTANCE_NAME}/callback`;
const CLOUDFLARE_PROTECTED_RESOURCE_METADATA_URL =
  "https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp";
const CLOUDFLARE_AUTHORIZATION_SERVER_METADATA_URL =
  "https://mcp.cloudflare.com/.well-known/oauth-authorization-server";
const CLOUDFLARE_DCR_REGISTRATION_URL = "https://mcp.cloudflare.com/register";

type SetupAgentTestRpc = {
  readonly state: Promise<NanitesSetupState>;
  listSchedules(): Promise<readonly { readonly id: string }[]>;
  cancelSchedule(id: string): Promise<void>;
  setState(state: NanitesSetupState): void;
  getMcpServers: NanitesSetupAgent["getMcpServers"];
  removeMcpServer: NanitesSetupAgent["removeMcpServer"];
  addMcpServer: NanitesSetupAgent["addMcpServer"];
  issueSetupClaim: NanitesSetupAgent["issueSetupClaim"];
  refresh(input?: RefreshSetupInput | null): Promise<NanitesSetupState>;
  checkSecretPropagation(payload: { readonly origin: string }): Promise<void>;
  connectCloudflare: NanitesSetupAgent["connectCloudflare"];
  startGitHubApp: NanitesSetupAgent["startGitHubApp"];
  recordRepositoryInstall: NanitesSetupAgent["recordRepositoryInstall"];
  recordUpstreamStar: NanitesSetupAgent["recordUpstreamStar"];
};

beforeEach(async () => {
  await resetDeploymentGitHubAppConfigTable(env.DB);
  const setupAgent = await getSetupAgent();
  for (const schedule of await setupAgent.listSchedules()) {
    await setupAgent.cancelSchedule(schedule.id);
  }
  setupAgent.setState(createInitialSetupState());
});

function readRedirectLocation(response: Response): URL {
  const location = response.headers.get("Location");
  if (!location) {
    throw new Error("Expected setup response to redirect.");
  }

  return new URL(location, SETUP_ORIGIN);
}

function envWithoutGeneratedGitHubAppSecrets(): Env {
  const testEnv = { ...env } as Env;
  Reflect.set(testEnv, "GITHUB_APP_PRIVATE_KEY", "replace-with-github-private-key");
  Reflect.set(testEnv, "GITHUB_CLIENT_SECRET", "replace-with-github-client-secret");
  Reflect.set(testEnv, "GITHUB_WEBHOOK_SECRET", "replace-with-github-webhook-secret");
  Reflect.set(testEnv, "AUTH_COOKIE_SECRET", "replace-with-auth-cookie-secret");
  return testEnv;
}

function envWithoutAuthCookieSecret(): Env {
  const testEnv = { ...env } as Env;
  Reflect.set(testEnv, "AUTH_COOKIE_SECRET", "replace-with-auth-cookie-secret");
  return testEnv;
}

function snapshotGeneratedSecretEnv(): Record<string, unknown> {
  return {
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    AUTH_COOKIE_SECRET: env.AUTH_COOKIE_SECRET,
  };
}

function applyGeneratedSecretEnv(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    Reflect.set(env, key, value);
  }
}

function blankGeneratedSecretEnv(): Record<string, unknown> {
  const original = snapshotGeneratedSecretEnv();
  applyGeneratedSecretEnv({
    GITHUB_APP_PRIVATE_KEY: "",
    GITHUB_CLIENT_SECRET: "",
    GITHUB_WEBHOOK_SECRET: "",
    AUTH_COOKIE_SECRET: "",
  });
  return original;
}

async function getSetupAgent(): Promise<SetupAgentTestRpc> {
  return getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    NANITES_SETUP_AGENT_INSTANCE_NAME,
  ) as unknown as SetupAgentTestRpc;
}

async function buildAuthenticatedSetupCookieHeader(request: Request): Promise<string> {
  const expiresAt = buildBrowserSessionExpiration();
  const session = nanitesSessionSchema.parse({
    githubViewer: { id: 1, login: "alice" },
    activeGithubInstallationId: null,
    sessionInstallationSnapshot: null,
    expiresAt,
  });
  const githubUserToken = githubUserTokenSchema.parse({
    accessToken: "test-github-user-token",
    expiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
  });
  const cookies = [
    await sealSessionCookie(session, request, env),
    await sealGitHubUserTokenCookie(githubUserToken, request, env),
  ];

  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function issueSetupClaim(
  setupAgent: SetupAgentTestRpc,
): Promise<{ token: string; cookieHeader: string }> {
  const claim = await setupAgent.issueSetupClaim();
  return {
    token: claim.token,
    cookieHeader: `${SETUP_CLAIM_COOKIE_NAME}=${claim.token}`,
  };
}

async function readRepositoryInstallState(
  setupAgent: SetupAgentTestRpc,
  origin = SETUP_ORIGIN,
): Promise<string> {
  const setupState = await setupAgent.refresh({ origin });
  const installUrl = setupState.githubApp.installUrl;
  const installState = installUrl ? new URL(installUrl).searchParams.get("state") : null;
  if (!installState) {
    throw new Error("Expected setup Agent to expose a repository install nonce.");
  }
  return installState;
}

async function buildClaimedGitHubSetupVerifyRequest({
  setupAgent,
  installationId = 42,
  installState,
  origin = SETUP_ORIGIN,
}: {
  readonly setupAgent: SetupAgentTestRpc;
  readonly installationId?: number;
  readonly installState?: string;
  readonly origin?: string;
}): Promise<Request> {
  await saveGeneratedGitHubAppMetadata();
  const state = installState ?? (await readRepositoryInstallState(setupAgent, origin));

  const url = new URL("/setup/github/verify", origin);
  url.searchParams.set("installation_id", String(installationId));
  url.searchParams.set("state", state);
  return new Request(url);
}

async function startClaimedGitHubApp(setupAgent: SetupAgentTestRpc): Promise<{
  readonly setupClaim: { readonly token: string; readonly cookieHeader: string };
  readonly manifestState: string;
}> {
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const result = await setupAgent.startGitHubApp({
    origin: SETUP_ORIGIN,
    ownerType: "user",
    claimToken: setupClaim.token,
  });
  if (!result.ok) {
    throw new Error(`Expected GitHub App start to succeed, got ${result.errorKind}.`);
  }

  return { setupClaim, manifestState: result.state };
}

function joinCookieHeaders(...cookieHeaders: readonly (string | null | undefined)[]): string {
  return cookieHeaders.filter((cookieHeader) => cookieHeader && cookieHeader.length > 0).join("; ");
}

function buildVisibleInstallation(id: number) {
  return {
    id,
    suspended_at: null,
    account: {
      id: 456,
      login: "WebMCP-org",
      type: "Organization",
      avatar_url: null,
    },
  };
}

function buildVisibleRepository(fullName = "WebMCP-org/nanites") {
  const [, name = "nanites"] = fullName.split("/", 2);
  return {
    id: 987,
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

function isVisibleInstallationsRequest(request: Request): boolean {
  return isGitHubListRequest(request, "/user/installations");
}

function isInstallationRepositoriesRequest(
  request: Request,
  githubInstallationId: number,
): boolean {
  return isGitHubListRequest(request, `/user/installations/${githubInstallationId}/repositories`);
}

function isInstallationTokenRequest(request: Request, githubInstallationId: number): boolean {
  return (
    request.method === "POST" &&
    isGitHubApiRequest(request, `/app/installations/${githubInstallationId}/access_tokens`)
  );
}

function buildInstallationTokenResponse(): Response {
  return Response.json({
    token: "test-installation-token",
    expires_at: "2026-06-10T20:00:00Z",
    permissions: {},
  });
}

function buildGitHubManifestConversion(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 12345,
    slug: "nanites-test",
    html_url: "https://github.com/apps/nanites-test",
    client_id: "generated-client-id",
    client_secret: "generated-client-secret",
    webhook_secret: "generated-webhook-secret",
    pem: "generated-private-key",
    owner: { login: "WebMCP-org", type: "Organization" },
    permissions: {
      contents: "write",
      pull_requests: "write",
      actions: "read",
      issues: "write",
      starring: "write",
    },
    events: [
      "push",
      "pull_request",
      "issue_comment",
      "pull_request_review_comment",
      "workflow_run",
    ],
    ...overrides,
  };
}

function handleSuccessfulSetupVerificationGitHubRequest(request: Request): Response | null {
  if (isVisibleInstallationsRequest(request)) {
    return Response.json({ installations: [buildVisibleInstallation(42)] });
  }
  if (isInstallationRepositoriesRequest(request, 42)) {
    return Response.json({ repositories: [buildVisibleRepository()] });
  }
  if (isInstallationTokenRequest(request, 42)) {
    return buildInstallationTokenResponse();
  }

  return null;
}

function buildCloudflareReadyReadiness(): NanitesSetupState["cloudflare"]["readiness"] {
  return { status: "ready", checkedAt: new Date().toISOString(), items: [] };
}

function buildCloudflareVerifiedSetupState(): NanitesSetupState {
  const initialState = createInitialSetupState();
  return {
    ...initialState,
    currentStep: "github-app",
    cloudflare: {
      status: "verified",
      authorizationUrl: null,
      accountId: "test-account",
      accountName: "Test Account",
      scriptName: "sigvelo-agent-tests",
      readiness: buildCloudflareReadyReadiness(),
      error: null,
    },
    githubApp: {
      ...initialState.githubApp,
      status: "ready",
    },
  };
}

function buildCloudflareBlockedSetupState(detail: string): NanitesSetupState {
  const state = buildCloudflareVerifiedSetupState();
  return {
    ...state,
    currentStep: "cloudflare",
    cloudflare: {
      ...state.cloudflare,
      readiness: {
        status: "blocked",
        checkedAt: new Date().toISOString(),
        items: [
          {
            key: "workers-paid",
            label: "Workers Paid",
            required: true,
            status: "blocked",
            detail,
            action: "configure",
          },
        ],
      },
      error: detail,
    },
    githubApp: {
      ...state.githubApp,
      status: "locked",
    },
  };
}

/**
 * Serves a minimal Streamable HTTP MCP server for the Cloudflare API endpoint
 * plus the GitHub manifest conversion endpoint, so the setup Agent can run its
 * `execute` tool calls (including the Worker secret write) without OAuth.
 */
function buildFakeCloudflareMcpFetch(originalFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === GITHUB_MANIFEST_CONVERSION_URL) {
      return Response.json(buildGitHubManifestConversion());
    }
    if (request.url !== CLOUDFLARE_MCP_SERVER_URL) {
      return originalFetch(input, init);
    }
    if (request.method === "GET") {
      return new Response("SSE not supported", { status: 405 });
    }
    if (request.method === "DELETE") {
      return new Response(null, { status: 200 });
    }

    const message = (await request.json()) as {
      id?: number | string;
      method?: string;
      params?: { protocolVersion?: string };
    };
    if (message.id === undefined) {
      return new Response(null, { status: 202 });
    }
    const respond = (result: unknown) => Response.json({ jsonrpc: "2.0", id: message.id, result });

    switch (message.method) {
      case "initialize":
        return respond({
          protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
          capabilities: { tools: {}, prompts: {}, resources: {} },
          serverInfo: { name: "fake-cloudflare-mcp", version: "1.0.0" },
        });
      case "tools/list":
        return respond({
          tools: [
            {
              name: "execute",
              description: "Execute code against the Cloudflare API.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        });
      case "tools/call":
        return respond({
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        });
      case "prompts/list":
        return respond({ prompts: [] });
      case "resources/list":
        return respond({ resources: [] });
      case "resources/templates/list":
        return respond({ resourceTemplates: [] });
      default:
        return respond({});
    }
  };
}

async function connectFakeCloudflareMcpServer(setupAgent: SetupAgentTestRpc): Promise<void> {
  // Drop any half-connected registration left behind by an earlier test (for
  // example an abandoned OAuth flow) so the connection attempt starts fresh.
  const existingServers = await setupAgent.getMcpServers();
  if (existingServers.servers[CLOUDFLARE_MCP_SERVER_ID]) {
    await setupAgent.removeMcpServer(CLOUDFLARE_MCP_SERVER_ID);
  }

  const added = await setupAgent.addMcpServer("Cloudflare API", CLOUDFLARE_MCP_SERVER_URL, {
    id: CLOUDFLARE_MCP_SERVER_ID,
    callbackHost: SETUP_ORIGIN,
    callbackPath: CLOUDFLARE_MCP_CALLBACK_PATH,
  });
  if (added.state !== "ready") {
    throw new Error(`Expected fake Cloudflare MCP server to connect, got "${added.state}".`);
  }
}

async function saveGeneratedGitHubAppMetadata(
  input: { readonly appId?: number; readonly slug?: string; readonly htmlUrl?: string } = {},
): Promise<void> {
  await saveTestDeploymentGitHubAppMetadata(env.DB, input);
}

test("setup status unlocks repository install after generated GitHub App config is readable", async () => {
  await saveGeneratedGitHubAppMetadata();

  const response = await nanitesHttpApp.request("/api/setup/status", {}, env);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    setupComplete: false,
    currentStep: "repositories",
    githubApp: {
      status: "complete",
      slug: "nanites-test",
      installUrl: expect.stringMatching(
        /^https:\/\/github\.com\/apps\/nanites-test\/installations\/new\?state=/,
      ),
    },
    repositories: {
      status: "ready",
      githubInstallationId: null,
    },
  });
});

test("repository install completes setup with the upstream star left optional", async () => {
  await saveGeneratedGitHubAppMetadata();

  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);

  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      claimToken: setupClaim.token,
      installState: await readRepositoryInstallState(setupAgent),
    }),
  ).resolves.toMatchObject({
    ok: true,
    state: {
      setupComplete: true,
      currentStep: "launch",
      repositories: {
        status: "complete",
        githubInstallationId: 42,
      },
      upstreamStar: {
        starred: false,
        error: null,
      },
    },
  });
});

test("repository install survives setup Agent state reset through deployment metadata", async () => {
  await saveGeneratedGitHubAppMetadata();

  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    claimToken: setupClaim.token,
    installState: await readRepositoryInstallState(setupAgent),
  });

  setupAgent.setState(createInitialSetupState());

  await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
    setupComplete: true,
    currentStep: "launch",
    githubApp: {
      status: "complete",
      slug: "nanites-test",
    },
    repositories: {
      status: "complete",
      githubInstallationId: 42,
    },
  });
});

test("regenerating the GitHub App returns the repositories step to ready", async () => {
  await saveGeneratedGitHubAppMetadata({
    appId: 12345,
    slug: "nanites-test",
    htmlUrl: "https://github.com/apps/nanites-test",
  });

  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    claimToken: setupClaim.token,
    installState: await readRepositoryInstallState(setupAgent),
  });

  // Re-saving the deployment config (a regenerated app) resets the selected
  // installation, so the repositories step must be redone.
  await saveGeneratedGitHubAppMetadata({
    appId: 67890,
    slug: "nanites-next",
    htmlUrl: "https://github.com/apps/nanites-next",
  });

  await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
    setupComplete: false,
    currentStep: "repositories",
    githubApp: {
      status: "complete",
      slug: "nanites-next",
      installUrl: expect.stringContaining("state="),
    },
    repositories: {
      status: "ready",
      githubInstallationId: null,
    },
  });
});

test("deployment GitHub App config waits for generated Worker secrets after metadata exists", async () => {
  await saveGeneratedGitHubAppMetadata();

  const db = createDbClient(env.DB);

  await expect(readDeploymentGitHubAppMetadata(db)).resolves.toMatchObject({
    slug: "nanites-test",
    clientId: "generated-client-id",
  });
  await expect(
    readDeploymentGitHubAppConfig(db, envWithoutGeneratedGitHubAppSecrets()),
  ).resolves.toBe(null);

  const originalEnv = snapshotGeneratedSecretEnv();
  applyGeneratedSecretEnv({
    GITHUB_APP_PRIVATE_KEY: "replace-with-github-private-key",
    GITHUB_CLIENT_SECRET: "replace-with-github-client-secret",
    GITHUB_WEBHOOK_SECRET: "replace-with-github-webhook-secret",
    AUTH_COOKIE_SECRET: "replace-with-auth-cookie-secret",
  });

  try {
    const response = await nanitesHttpApp.request(`${SETUP_ORIGIN}/api/setup/status`, {}, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      setupComplete: false,
      githubApp: {
        status: "propagating",
        slug: "nanites-test",
      },
      repositories: {
        status: "locked",
      },
    });
  } finally {
    applyGeneratedSecretEnv(originalEnv);
  }
});

test("setup status can unlock generated GitHub App config from the current Worker env", async () => {
  await saveGeneratedGitHubAppMetadata();
  const setupAgent = await getSetupAgent();
  const readyEnv = { ...env } as Env;
  Reflect.set(readyEnv, "GITHUB_APP_PRIVATE_KEY", "generated-private-key");
  Reflect.set(readyEnv, "GITHUB_CLIENT_SECRET", "generated-client-secret");
  Reflect.set(readyEnv, "GITHUB_WEBHOOK_SECRET", "generated-webhook-secret");
  Reflect.set(readyEnv, "AUTH_COOKIE_SECRET", "generated-auth-cookie-secret");

  const originalEnv = snapshotGeneratedSecretEnv();
  applyGeneratedSecretEnv({
    GITHUB_APP_PRIVATE_KEY: "replace-with-github-private-key",
    GITHUB_CLIENT_SECRET: "replace-with-github-client-secret",
    GITHUB_WEBHOOK_SECRET: "replace-with-github-webhook-secret",
    AUTH_COOKIE_SECRET: "replace-with-auth-cookie-secret",
  });

  try {
    await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
      githubApp: {
        status: "propagating",
        slug: "nanites-test",
      },
      repositories: {
        status: "locked",
      },
    });

    const response = await nanitesHttpApp.request(`${SETUP_ORIGIN}/api/setup/status`, {}, readyEnv);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      setupComplete: false,
      githubApp: {
        status: "complete",
        slug: "nanites-test",
      },
      repositories: {
        status: "ready",
      },
    });
  } finally {
    applyGeneratedSecretEnv(originalEnv);
  }
});

test("setup Agent checks generated GitHub App secret propagation through the current Worker", async () => {
  await saveGeneratedGitHubAppMetadata();
  const setupAgent = await getSetupAgent();
  const readyEnv = { ...env } as Env;
  Reflect.set(readyEnv, "GITHUB_APP_PRIVATE_KEY", "generated-private-key");
  Reflect.set(readyEnv, "GITHUB_CLIENT_SECRET", "generated-client-secret");
  Reflect.set(readyEnv, "GITHUB_WEBHOOK_SECRET", "generated-webhook-secret");
  Reflect.set(readyEnv, "AUTH_COOKIE_SECRET", "generated-auth-cookie-secret");
  const originalFetch = globalThis.fetch;
  const originalEnv = snapshotGeneratedSecretEnv();
  applyGeneratedSecretEnv({
    GITHUB_APP_PRIVATE_KEY: "replace-with-github-private-key",
    GITHUB_CLIENT_SECRET: "replace-with-github-client-secret",
    GITHUB_WEBHOOK_SECRET: "replace-with-github-webhook-secret",
    AUTH_COOKIE_SECRET: "replace-with-auth-cookie-secret",
  });

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === `${SETUP_ORIGIN}/api/setup/status`) {
      return nanitesHttpApp.request(request, {}, readyEnv);
    }

    return originalFetch(input, init);
  };

  try {
    await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
      githubApp: {
        status: "propagating",
        slug: "nanites-test",
      },
    });

    await setupAgent.checkSecretPropagation({ origin: SETUP_ORIGIN });

    // The propagation check refreshed through the status route, whose isolate
    // already sees the generated secrets, and the unlocked state persisted.
    await expect(setupAgent.state).resolves.toMatchObject({
      setupComplete: false,
      githubApp: {
        status: "complete",
        slug: "nanites-test",
      },
      repositories: {
        status: "ready",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    applyGeneratedSecretEnv(originalEnv);
  }
});

test("deployment GitHub App config becomes retryable when generated secrets do not propagate", async () => {
  await saveGeneratedGitHubAppMetadata();
  await env.DB.exec("UPDATE deployment_github_app_config SET updated_at = 1 WHERE id = 'current';");
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const originalEnv = blankGeneratedSecretEnv();

  try {
    const setupState = await setupAgent.refresh({ origin: SETUP_ORIGIN });
    const setupClaim = await issueSetupClaim(setupAgent);

    expect(setupState.githubApp).toMatchObject({
      status: "stalled",
      slug: "nanites-test",
    });
    await expect(
      setupAgent.startGitHubApp({
        origin: SETUP_ORIGIN,
        ownerType: "user",
        claimToken: setupClaim.token,
      }),
    ).resolves.toMatchObject({
      ok: true,
      action: "https://github.com/settings/apps/new",
    });
  } finally {
    applyGeneratedSecretEnv(originalEnv);
  }
});

test("deployment GitHub App config waits for generated auth-cookie secret", async () => {
  await saveGeneratedGitHubAppMetadata();

  await expect(
    readDeploymentGitHubAppConfig(createDbClient(env.DB), envWithoutAuthCookieSecret()),
  ).resolves.toBe(null);
});

test("setup status route is available before GitHub sign-in exists", async () => {
  const response = await worker.fetch(
    new Request(`${SETUP_ORIGIN}/api/setup/status`),
    env,
    createExecutionContext(),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    setupComplete: false,
    currentStep: "cloudflare",
    cloudflare: { status: "idle" },
    githubApp: { status: "locked" },
  });
});

test("Cloudflare setup OAuth uses the stable setup Agent callback route", async () => {
  const setupAgent = await getSetupAgent();
  const expectedCallbackUrl = `${SETUP_ORIGIN}${CLOUDFLARE_MCP_CALLBACK_PATH}`;
  const registrationBodies: unknown[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === CLOUDFLARE_MCP_SERVER_URL && request.method === "POST") {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${CLOUDFLARE_PROTECTED_RESOURCE_METADATA_URL}", scope="${CLOUDFLARE_SETUP_OAUTH_SCOPE}"`,
        },
      });
    }

    if (request.url === CLOUDFLARE_PROTECTED_RESOURCE_METADATA_URL && request.method === "GET") {
      return Response.json({
        resource: CLOUDFLARE_MCP_SERVER_URL,
        authorization_servers: ["https://mcp.cloudflare.com"],
        scopes_supported: CLOUDFLARE_SETUP_OAUTH_SCOPE.split(" "),
      });
    }

    if (request.url === CLOUDFLARE_AUTHORIZATION_SERVER_METADATA_URL && request.method === "GET") {
      return Response.json({
        issuer: "https://mcp.cloudflare.com",
        authorization_endpoint: "https://dash.cloudflare.com/oauth2/auth",
        token_endpoint: "https://mcp.cloudflare.com/token",
        registration_endpoint: CLOUDFLARE_DCR_REGISTRATION_URL,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        client_id_metadata_document_supported: false,
      });
    }

    if (request.url === CLOUDFLARE_DCR_REGISTRATION_URL && request.method === "POST") {
      const body = (await request.json()) as Record<string, unknown>;
      registrationBodies.push(body);
      return Response.json({
        ...body,
        client_id: "test-cloudflare-client",
      });
    }

    return originalFetch(input, init);
  };

  try {
    const result = await setupAgent.connectCloudflare({ origin: SETUP_ORIGIN });

    expect(result.claim).toBeNull();
    expect(result.authorizationUrl).toEqual(expect.any(String));
    const authorizationUrl = new URL(result.authorizationUrl ?? "");
    expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
      "https://dash.cloudflare.com/oauth2/auth",
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(expectedCallbackUrl);
    expect(authorizationUrl.searchParams.get("client_id")).toBe("test-cloudflare-client");
    expect(registrationBodies).toHaveLength(1);
    expect(registrationBodies[0]).toMatchObject({
      redirect_uris: [expectedCallbackUrl],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub App creation route requires the setup claim", async () => {
  const response = await nanitesHttpApp.request(
    `${SETUP_ORIGIN}/api/setup/github-app`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerType: "user" }),
    },
    env,
  );

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    code: "setup_claim_required",
  });
});

test("GitHub App creation route returns the manifest form for the claimed browser", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);

  const response = await nanitesHttpApp.request(
    `${SETUP_ORIGIN}/api/setup/github-app`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: setupClaim.cookieHeader,
      },
      body: JSON.stringify({ ownerType: "user" }),
    },
    env,
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    action: "https://github.com/settings/apps/new",
    state: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
    manifest: {
      name: expect.stringMatching(/^Nanites [a-z0-9]{10}$/),
    },
  });
});

test("GitHub App start returns a first-party manifest form target after Cloudflare proof", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);

  const result = await setupAgent.startGitHubApp({
    origin: SETUP_ORIGIN,
    ownerType: "organization",
    ownerLogin: " WebMCP-org ",
    claimToken: setupClaim.token,
  });

  if (!result.ok) {
    throw new Error(`Expected GitHub App start to succeed, got ${result.errorKind}.`);
  }
  expect(result.action).toBe("https://github.com/organizations/WebMCP-org/settings/apps/new");
  expect(result.state).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(result.manifest).toMatchObject({
    name: expect.stringMatching(/^Nanites [a-z0-9]{10}$/),
    redirect_url: `${SETUP_ORIGIN}/setup/github/manifest/callback`,
    callback_urls: [`${SETUP_ORIGIN}/auth/github/callback`],
    setup_url: `${SETUP_ORIGIN}/setup/github/installed`,
    request_oauth_on_install: false,
    hook_attributes: {
      url: `${SETUP_ORIGIN}/api/github/webhook`,
      active: true,
    },
    default_permissions: {
      contents: "write",
      pull_requests: "write",
      starring: "write",
    },
  });
});

test("GitHub App start requires a setup claim and ready Cloudflare readiness", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());

  await expect(
    setupAgent.startGitHubApp({
      origin: SETUP_ORIGIN,
      ownerType: "user",
      claimToken: "not-the-claimed-browser",
    }),
  ).resolves.toEqual({ ok: false, errorKind: "setupClaimRequired" });

  setupAgent.setState(buildCloudflareBlockedSetupState("Workers Paid was not detected."));
  const setupClaim = await issueSetupClaim(setupAgent);

  await expect(
    setupAgent.startGitHubApp({
      origin: SETUP_ORIGIN,
      ownerType: "user",
      claimToken: setupClaim.token,
    }),
  ).resolves.toEqual({ ok: false, errorKind: "cloudflareReadinessRequired" });
});

test("setup keeps GitHub App locked while Workers Paid readiness is blocked", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(
    buildCloudflareBlockedSetupState("Workers Paid was not detected on this account."),
  );

  await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
    currentStep: "cloudflare",
    cloudflare: {
      readiness: {
        status: "blocked",
      },
    },
    githubApp: {
      status: "locked",
    },
  });
});

test("GitHub App start ignores informational Cloudflare readiness warnings", async () => {
  const setupAgent = await getSetupAgent();
  const state = buildCloudflareVerifiedSetupState();
  setupAgent.setState({
    ...state,
    cloudflare: {
      ...state.cloudflare,
      readiness: {
        status: "ready",
        checkedAt: new Date().toISOString(),
        items: [
          {
            key: "browser",
            label: "Browser Run",
            required: false,
            status: "warning",
            detail: "Browser Run binding `BROWSER` was not detected.",
            action: "retry",
          },
        ],
      },
    },
  });
  const setupClaim = await issueSetupClaim(setupAgent);

  await expect(
    setupAgent.startGitHubApp({
      origin: SETUP_ORIGIN,
      ownerType: "user",
      claimToken: setupClaim.token,
    }),
  ).resolves.toMatchObject({
    ok: true,
    action: "https://github.com/settings/apps/new",
  });
});

test("GitHub App start rotates the manifest nonce after an abandoned GitHub form", async () => {
  const setupAgent = await getSetupAgent();
  const { setupClaim, manifestState } = await startClaimedGitHubApp(setupAgent);

  const retried = await setupAgent.startGitHubApp({
    origin: SETUP_ORIGIN,
    ownerType: "user",
    claimToken: setupClaim.token,
  });

  if (!retried.ok) {
    throw new Error(`Expected GitHub App restart to succeed, got ${retried.errorKind}.`);
  }
  expect(retried.action).toBe("https://github.com/settings/apps/new");
  expect(retried.state).not.toBe(manifestState);
  expect(retried.state).toMatch(/^[A-Za-z0-9_-]+$/);
});

test("GitHub manifest callback rejects state values that do not match the issued nonce", async () => {
  const setupAgent = await getSetupAgent();
  const { setupClaim } = await startClaimedGitHubApp(setupAgent);

  const response = await nanitesHttpApp.request(
    `${SETUP_ORIGIN}/setup/github/manifest/callback?code=test-manifest-code&state=wrong-state`,
    {
      headers: { Cookie: setupClaim.cookieHeader },
    },
    env,
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    code: "invalid_setup_state",
  });
});

test("GitHub manifest callback requires a currently valid setup claim", async () => {
  const setupAgent = await getSetupAgent();
  const { manifestState } = await startClaimedGitHubApp(setupAgent);
  // Issuing a new claim invalidates the one that started the manifest.
  await issueSetupClaim(setupAgent);
  const originalFetch = globalThis.fetch;
  let conversionRequests = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === GITHUB_MANIFEST_CONVERSION_URL) {
      conversionRequests += 1;
      return Response.json(buildGitHubManifestConversion());
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      `${SETUP_ORIGIN}/setup/github/manifest/callback?code=test-manifest-code&state=${manifestState}`,
      {
        headers: { Cookie: `${SETUP_CLAIM_COOKIE_NAME}=stale-claim-token` },
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(conversionRequests).toBe(0);
    await expect(response.json()).resolves.toEqual({
      code: "setup_claim_required",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub manifest setup failure leaves the setup Agent retryable", async () => {
  const setupAgent = await getSetupAgent();
  const { setupClaim, manifestState } = await startClaimedGitHubApp(setupAgent);
  // The manifest nonce survives unrelated status refreshes before the callback.
  await setupAgent.refresh({ origin: SETUP_ORIGIN });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === GITHUB_MANIFEST_CONVERSION_URL) {
      return Response.json({ message: "conversion failed" }, { status: 500 });
    }

    return originalFetch(input, init);
  };

  try {
    const callbackUrl = `${SETUP_ORIGIN}/setup/github/manifest/callback?code=test-manifest-code&state=${manifestState}`;
    const response = await nanitesHttpApp.request(
      callbackUrl,
      {
        headers: { Cookie: setupClaim.cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "github_app_manifest_conversion_failed",
    });
    await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
      githubApp: {
        status: "ready",
        error: expect.any(String),
      },
    });

    // The manifest nonce is one-shot: replaying the callback is rejected.
    const replayedResponse = await nanitesHttpApp.request(
      callbackUrl,
      {
        headers: { Cookie: setupClaim.cookieHeader },
      },
      env,
    );
    expect(replayedResponse.status).toBe(400);
    await expect(replayedResponse.json()).resolves.toEqual({
      code: "invalid_setup_state",
    });

    await expect(
      setupAgent.startGitHubApp({
        origin: SETUP_ORIGIN,
        ownerType: "user",
        claimToken: setupClaim.token,
      }),
    ).resolves.toMatchObject({
      ok: true,
      action: "https://github.com/settings/apps/new",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub manifest callback rejects apps missing required permissions", async () => {
  const setupAgent = await getSetupAgent();
  const { setupClaim, manifestState } = await startClaimedGitHubApp(setupAgent);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === GITHUB_MANIFEST_CONVERSION_URL) {
      return Response.json(
        buildGitHubManifestConversion({
          permissions: {
            contents: "read",
            pull_requests: "write",
            actions: "read",
            issues: "write",
            starring: "write",
          },
        }),
      );
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      `${SETUP_ORIGIN}/setup/github/manifest/callback?code=test-manifest-code&state=${manifestState}`,
      {
        headers: { Cookie: setupClaim.cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "github_app_manifest_conversion_failed",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub manifest callback reports Cloudflare Worker secret write failures separately", async () => {
  const setupAgent = await getSetupAgent();
  const { setupClaim, manifestState } = await startClaimedGitHubApp(setupAgent);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === GITHUB_MANIFEST_CONVERSION_URL) {
      return Response.json(buildGitHubManifestConversion());
    }

    return originalFetch(input, init);
  };

  try {
    // No Cloudflare MCP server is connected, so the Worker secret write fails.
    const response = await nanitesHttpApp.request(
      `${SETUP_ORIGIN}/setup/github/manifest/callback?code=test-manifest-code&state=${manifestState}`,
      {
        headers: { Cookie: setupClaim.cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "cloudflare_worker_secret_write_failed",
    });
    await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
      githubApp: {
        status: "ready",
        orphanedAppUrl: "https://github.com/apps/nanites-test",
        error: expect.stringContaining("generated secrets"),
      },
      repositories: {
        status: "locked",
        githubInstallationId: null,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub manifest callback redirects to the install URL once the deployment is configured", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = buildFakeCloudflareMcpFetch(originalFetch);

  try {
    await connectFakeCloudflareMcpServer(setupAgent);
    const started = await setupAgent.startGitHubApp({
      origin: SETUP_ORIGIN,
      ownerType: "user",
      claimToken: setupClaim.token,
    });
    if (!started.ok) {
      throw new Error(`Expected GitHub App start to succeed, got ${started.errorKind}.`);
    }

    const response = await nanitesHttpApp.request(
      `${SETUP_ORIGIN}/setup/github/manifest/callback?code=test-manifest-code&state=${started.state}`,
      {
        headers: { Cookie: setupClaim.cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(302);
    const location = readRedirectLocation(response);
    expect(`${location.origin}${location.pathname}`).toBe(
      "https://github.com/apps/nanites-test/installations/new",
    );
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);

    await expect(readDeploymentGitHubAppMetadata(createDbClient(env.DB))).resolves.toMatchObject({
      slug: "nanites-test",
      clientId: "generated-client-id",
    });
    await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
      githubApp: {
        status: "complete",
        slug: "nanites-test",
      },
      repositories: {
        status: "ready",
        githubInstallationId: null,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub manifest callback returns to setup while generated secrets propagate", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = buildFakeCloudflareMcpFetch(originalFetch);
  const originalEnv = snapshotGeneratedSecretEnv();
  applyGeneratedSecretEnv({
    GITHUB_APP_PRIVATE_KEY: "replace-with-github-private-key",
    GITHUB_CLIENT_SECRET: "replace-with-github-client-secret",
    GITHUB_WEBHOOK_SECRET: "replace-with-github-webhook-secret",
    AUTH_COOKIE_SECRET: "replace-with-auth-cookie-secret",
  });

  try {
    await connectFakeCloudflareMcpServer(setupAgent);
    const started = await setupAgent.startGitHubApp({
      origin: SETUP_ORIGIN,
      ownerType: "user",
      claimToken: setupClaim.token,
    });
    if (!started.ok) {
      throw new Error(`Expected GitHub App start to succeed, got ${started.errorKind}.`);
    }

    const response = await nanitesHttpApp.request(
      `${SETUP_ORIGIN}/setup/github/manifest/callback?code=test-manifest-code&state=${started.state}`,
      {
        headers: { Cookie: setupClaim.cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/setup?github_app=created");
  } finally {
    globalThis.fetch = originalFetch;
    applyGeneratedSecretEnv(originalEnv);
    for (const schedule of await setupAgent.listSchedules()) {
      await setupAgent.cancelSchedule(schedule.id);
    }
  }
});

test("repository install waits for readable runtime GitHub App config", async () => {
  await saveGeneratedGitHubAppMetadata();
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const installState = await readRepositoryInstallState(setupAgent);
  const originalEnv = blankGeneratedSecretEnv();

  try {
    await expect(
      setupAgent.recordRepositoryInstall({
        githubInstallationId: 42,
        claimToken: setupClaim.token,
        installState,
      }),
    ).resolves.toEqual({
      ok: false,
      errorKind: "invalidSetupState",
    });
  } finally {
    applyGeneratedSecretEnv(originalEnv);
  }
});

test("GitHub setup verification returns to setup with the repositories step complete", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const request = await buildClaimedGitHubSetupVerifyRequest({ setupAgent });
  const cookieHeader = joinCookieHeaders(
    await buildAuthenticatedSetupCookieHeader(request),
    setupClaim.cookieHeader,
  );
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    const githubResponse = handleSuccessfulSetupVerificationGitHubRequest(githubRequest);
    if (githubResponse) {
      return githubResponse;
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      request,
      {
        headers: { Cookie: cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/setup");
    await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
      setupComplete: true,
      currentStep: "launch",
      repositories: {
        status: "complete",
        githubInstallationId: 42,
      },
      upstreamStar: {
        starred: false,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub login redirects to setup when no deployment app config exists", async () => {
  const response = await nanitesHttpApp.request(
    `${SETUP_ORIGIN}/auth/github/login?returnTo=/nanites`,
    {},
    env,
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/setup");
});

test("MCP route reports setup required when no deployment app config exists", async () => {
  const response = await worker.fetch(
    new Request(`${SETUP_ORIGIN}/mcp`),
    env,
    createExecutionContext(),
  );

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    code: "deployment_github_app_setup_required",
  });
});

test("GitHub setup URL sends the claimed installation id through OAuth for verification", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);

  const response = await nanitesHttpApp.request(
    `${SETUP_ORIGIN}/setup/github/installed?installation_id=42&setup_action=install&state=test-install-state`,
    {
      headers: { Cookie: setupClaim.cookieHeader },
    },
    env,
  );

  expect(response.status).toBe(302);
  const location = readRedirectLocation(response);
  expect(location.pathname).toBe("/auth/github/login");
  expect(location.searchParams.get("returnTo")).toBe(
    "/setup/github/verify?installation_id=42&state=test-install-state",
  );
});

test("GitHub setup URL requires the setup claim", async () => {
  const response = await nanitesHttpApp.request(
    `${SETUP_ORIGIN}/setup/github/installed?installation_id=42&setup_action=install`,
    {},
    env,
  );

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    code: "setup_claim_required",
  });
});

test("GitHub setup URL requires GitHub's returned installation id", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);

  const response = await nanitesHttpApp.request(
    `${SETUP_ORIGIN}/setup/github/installed?setup_action=install`,
    {
      headers: { Cookie: setupClaim.cookieHeader },
    },
    env,
  );

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    code: "setup_installation_verification_failed",
    githubInstallationId: null,
    reason: "invalid_install_callback_query",
  });
});

test("GitHub setup URL requires GitHub's setup action", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);

  const response = await nanitesHttpApp.request(
    `${SETUP_ORIGIN}/setup/github/installed?installation_id=42`,
    {
      headers: { Cookie: setupClaim.cookieHeader },
    },
    env,
  );

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    code: "setup_installation_verification_failed",
    githubInstallationId: null,
    reason: "invalid_install_callback_query",
  });
});

test("GitHub setup verification rejects install nonces that do not match the issued one", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const request = await buildClaimedGitHubSetupVerifyRequest({
    setupAgent,
    installState: "not-the-issued-install-nonce",
  });
  const cookieHeader = joinCookieHeaders(
    await buildAuthenticatedSetupCookieHeader(request),
    setupClaim.cookieHeader,
  );
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    const githubResponse = handleSuccessfulSetupVerificationGitHubRequest(githubRequest);
    if (githubResponse) {
      return githubResponse;
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      request,
      {
        headers: { Cookie: cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "setup_installation_verification_failed",
      githubInstallationId: 42,
      reason: "install_state_mismatch",
    });
    await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
      setupComplete: false,
      repositories: {
        status: "ready",
        githubInstallationId: null,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub setup verification activates only GitHub-visible installations", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const request = await buildClaimedGitHubSetupVerifyRequest({ setupAgent });
  const cookieHeader = joinCookieHeaders(
    await buildAuthenticatedSetupCookieHeader(request),
    setupClaim.cookieHeader,
  );
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    const githubResponse = handleSuccessfulSetupVerificationGitHubRequest(githubRequest);
    if (githubResponse) {
      return githubResponse;
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      request,
      {
        headers: { Cookie: cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/setup");
    expect(response.headers.get("Set-Cookie")).toContain("nanites_session=");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub setup verification requires at least one visible repository", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const request = await buildClaimedGitHubSetupVerifyRequest({ setupAgent });
  const cookieHeader = joinCookieHeaders(
    await buildAuthenticatedSetupCookieHeader(request),
    setupClaim.cookieHeader,
  );
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    if (isVisibleInstallationsRequest(githubRequest)) {
      return Response.json({ installations: [buildVisibleInstallation(42)] });
    }
    if (isInstallationRepositoriesRequest(githubRequest, 42)) {
      return Response.json({ repositories: [] });
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      request,
      {
        headers: { Cookie: cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "setup_installation_verification_failed",
      githubInstallationId: 42,
      reason: "no_visible_repositories",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub setup verification proves the app can mint an installation token", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const request = await buildClaimedGitHubSetupVerifyRequest({ setupAgent });
  const cookieHeader = joinCookieHeaders(
    await buildAuthenticatedSetupCookieHeader(request),
    setupClaim.cookieHeader,
  );
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    if (isVisibleInstallationsRequest(githubRequest)) {
      return Response.json({ installations: [buildVisibleInstallation(42)] });
    }
    if (isInstallationRepositoriesRequest(githubRequest, 42)) {
      return Response.json({ repositories: [buildVisibleRepository()] });
    }
    if (isInstallationTokenRequest(githubRequest, 42)) {
      return Response.json({ message: "installation token failed" }, { status: 403 });
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      request,
      {
        headers: { Cookie: cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "setup_installation_verification_failed",
      githubInstallationId: 42,
      reason: "installation_token_mint_failed",
      githubError: expect.stringContaining("installation token failed"),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub setup verification requires the setup claim", async () => {
  const request = new Request(`${SETUP_ORIGIN}/setup/github/verify?installation_id=42`);
  const cookieHeader = await buildAuthenticatedSetupCookieHeader(request);
  const response = await nanitesHttpApp.request(
    request,
    {
      headers: { Cookie: cookieHeader },
    },
    env,
  );

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    code: "setup_claim_required",
  });
});

test("upstream star verification requires GitHub sign-in", async () => {
  const response = await nanitesHttpApp.request(`${SETUP_ORIGIN}/api/setup/upstream-star`, {}, env);

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({
    code: "authentication_required",
  });
});

test("upstream star verification records the confirmed star", async () => {
  await saveGeneratedGitHubAppMetadata();
  const request = new Request(`${SETUP_ORIGIN}/api/setup/upstream-star`);
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    claimToken: setupClaim.token,
    installState: await readRepositoryInstallState(setupAgent),
  });
  const cookieHeader = await buildAuthenticatedSetupCookieHeader(request);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    if (githubRequest.url === GITHUB_UPSTREAM_STAR_URL) {
      return new Response(null, { status: 204 });
    }

    return originalFetch(input, init);
  };

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
      setupComplete: true,
      currentStep: "launch",
      upstreamStar: {
        starred: true,
        error: null,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upstream star verification keeps setup complete when GitHub does not confirm the star", async () => {
  await saveGeneratedGitHubAppMetadata();
  const request = new Request(`${SETUP_ORIGIN}/api/setup/upstream-star`);
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    claimToken: setupClaim.token,
    installState: await readRepositoryInstallState(setupAgent),
  });
  const cookieHeader = await buildAuthenticatedSetupCookieHeader(request);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    if (githubRequest.url === GITHUB_UPSTREAM_STAR_URL) {
      return new Response(null, { status: 404 });
    }

    return originalFetch(input, init);
  };

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
      setupComplete: true,
      currentStep: "launch",
      upstreamStar: {
        starred: false,
        error: "GitHub did not confirm that this user starred WebMCP-org/nanites.",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upstream star action stars through the signed-in GitHub user token", async () => {
  await saveGeneratedGitHubAppMetadata();
  const request = new Request(`${SETUP_ORIGIN}/api/setup/upstream-star`, { method: "PUT" });
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    claimToken: setupClaim.token,
    installState: await readRepositoryInstallState(setupAgent),
  });
  const cookieHeader = await buildAuthenticatedSetupCookieHeader(request);
  const githubMethods: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    if (githubRequest.url === GITHUB_UPSTREAM_STAR_URL) {
      githubMethods.push(githubRequest.method);
      return new Response(null, { status: 204 });
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      request,
      {
        method: "PUT",
        headers: { Cookie: cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(githubMethods).toEqual(["PUT", "GET"]);
    await expect(response.json()).resolves.toMatchObject({
      setupComplete: true,
      currentStep: "launch",
      upstreamStar: {
        starred: true,
        error: null,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub setup verification rejects spoofed installation ids", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const request = await buildClaimedGitHubSetupVerifyRequest({ setupAgent });
  const cookieHeader = joinCookieHeaders(
    await buildAuthenticatedSetupCookieHeader(request),
    setupClaim.cookieHeader,
  );
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    if (isVisibleInstallationsRequest(githubRequest)) {
      return Response.json({ installations: [buildVisibleInstallation(77)] });
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      request,
      {
        headers: { Cookie: cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "setup_installation_verification_failed",
      githubInstallationId: 42,
      reason: "installation_not_visible",
      visibleInstallationIds: ["77"],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
