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
  createInitialNanitesSetupState,
  type CheckGitHubSecretPropagationInput,
  type NanitesSetupAgent,
  type NanitesSetupAgentState,
  type RecordRepositoryInstallInput,
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
const CLOUDFLARE_MCP_SERVER_URL = "https://mcp.cloudflare.com/mcp";
const CLOUDFLARE_PROTECTED_RESOURCE_METADATA_URL =
  "https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp";
const CLOUDFLARE_AUTHORIZATION_SERVER_METADATA_URL =
  "https://mcp.cloudflare.com/.well-known/oauth-authorization-server";
const CLOUDFLARE_DCR_REGISTRATION_URL = "https://mcp.cloudflare.com/register";
const CLOUDFLARE_SETUP_OAUTH_SCOPE =
  "offline_access user:read account:read billing:read workers:read workers_scripts:write";

type SetupAgentTestRpc = {
  listSchedules(): Promise<readonly { readonly id: string }[]>;
  cancelSchedule(id: string): Promise<void>;
  setState(state: NanitesSetupAgentState): void;
  clearSetupClaim: NanitesSetupAgent["clearSetupClaim"];
  issueSetupClaim: NanitesSetupAgent["issueSetupClaim"];
  refresh(input?: RefreshSetupInput | null): Promise<NanitesSetupAgentState>;
  checkGitHubSecretPropagation(
    input: CheckGitHubSecretPropagationInput,
  ): Promise<NanitesSetupAgentState>;
  claimSetupOwner(input?: { readonly setupOwnerToken?: string | null } | null): Promise<{
    readonly claimed: boolean;
    readonly setupOwnerToken: string | null;
    readonly expiresAt: string | null;
    readonly state: NanitesSetupAgentState;
  }>;
  resetSetupOwner(input: {
    readonly setupOwnerToken?: string | null;
  }): Promise<NanitesSetupAgentState>;
  connectCloudflare: NanitesSetupAgent["connectCloudflare"];
  startGitHubManifest: NanitesSetupAgent["startGitHubManifest"];
  recordRepositoryInstall(input: RecordRepositoryInstallInput): Promise<NanitesSetupAgentState>;
  recordUpstreamStarVerified: NanitesSetupAgent["recordUpstreamStarVerified"];
  recordUpstreamStarMissing: NanitesSetupAgent["recordUpstreamStarMissing"];
};

beforeEach(async () => {
  await resetDeploymentGitHubAppConfigTable(env.DB);
  const setupAgent = await getSetupAgent();
  for (const schedule of await setupAgent.listSchedules()) {
    await setupAgent.cancelSchedule(schedule.id);
  }
  setupAgent.setState(createInitialNanitesSetupState());
  await setupAgent.clearSetupClaim();
  await setupAgent.resetSetupOwner({ setupOwnerToken: null });
});

function readRedirectLocation(response: Response): URL {
  const location = response.headers.get("Location");
  if (!location) {
    throw new Error("Expected setup response to redirect.");
  }

  return new URL(location);
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
    token: claim.claimToken,
    cookieHeader: `${SETUP_CLAIM_COOKIE_NAME}=${claim.claimToken}`,
  };
}

async function buildClaimedGitHubSetupVerifyRequest({
  setupAgent,
  installationId = 42,
  origin = "https://sigvelo-agent-tests.example.workers.dev",
}: {
  readonly setupAgent: SetupAgentTestRpc;
  readonly installationId?: number;
  readonly origin?: string;
}): Promise<Request> {
  await saveGeneratedGitHubAppMetadata();
  const setupState = await setupAgent.refresh({ origin });
  const installState = setupState.repositories.installState;
  if (!installState) {
    throw new Error("Expected setup Agent to expose a repository install nonce.");
  }

  const url = new URL("/setup/github/verify", origin);
  url.searchParams.set("installation_id", String(installationId));
  url.searchParams.set("state", installState);
  return new Request(url);
}

async function readRepositoryInstallState(
  setupAgent: SetupAgentTestRpc,
  origin = "https://sigvelo-agent-tests.example.workers.dev",
): Promise<string> {
  const setupState = await setupAgent.refresh({ origin });
  const installState = setupState.repositories.installState;
  if (!installState) {
    throw new Error("Expected setup Agent to expose a repository install nonce.");
  }
  return installState;
}

async function startClaimedGitHubManifest(setupAgent: SetupAgentTestRpc): Promise<{
  readonly setupClaim: { readonly token: string; readonly cookieHeader: string };
  readonly manifest: { readonly state: string };
}> {
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const manifest = await setupAgent.startGitHubManifest({
    origin: "https://sigvelo-agent-tests.example.workers.dev",
    ownerType: "user",
    setupClaimToken: setupClaim.token,
  });

  return { setupClaim, manifest };
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

function buildCloudflareVerifiedSetupState() {
  const initialState = createInitialNanitesSetupState();
  return {
    ...initialState,
    cloudflare: {
      status: "verified" as const,
      authorizationUrl: null,
      accountId: "test-account",
      accountName: "Test Account",
      scriptName: "sigvelo-agent-tests",
      readiness: buildCloudflareReadyReadiness(),
      error: null,
      connectedAt: new Date().toISOString(),
    },
    githubApp: {
      ...initialState.githubApp,
      status: "ready" as const,
    },
  };
}

function buildCloudflareReadyReadiness(): NanitesSetupAgentState["cloudflare"]["readiness"] {
  const readiness = createInitialNanitesSetupState().cloudflare.readiness;
  return {
    status: "ready",
    checkedAt: new Date().toISOString(),
    items: readiness.items.map((item) => ({
      ...item,
      status: "ready" as const,
      detail: `${item.label} is ready.`,
      action: null,
    })),
  };
}

function buildCloudflareBlockedSetupState(
  key: NanitesSetupAgentState["cloudflare"]["readiness"]["items"][number]["key"],
  detail: string,
): NanitesSetupAgentState {
  const state = buildCloudflareVerifiedSetupState();
  return {
    ...state,
    currentStep: "cloudflare",
    cloudflare: {
      ...state.cloudflare,
      readiness: {
        status: "blocked",
        checkedAt: new Date().toISOString(),
        items: state.cloudflare.readiness.items.map((item) =>
          item.key === key
            ? {
                ...item,
                status: "blocked" as const,
                detail,
                action: key === "workers-paid" ? "configure" : "retry",
              }
            : item,
        ),
      },
      error: detail,
    },
    githubApp: {
      ...state.githubApp,
      status: "locked",
    },
    error: {
      step: "cloudflare",
      message: detail,
    },
  };
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
    launch: {
      status: "locked",
    },
  });
});

test("repository install unlocks the required upstream star gate", async () => {
  await saveGeneratedGitHubAppMetadata();

  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);

  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      setupClaimToken: setupClaim.token,
      installState: await readRepositoryInstallState(setupAgent),
    }),
  ).resolves.toMatchObject({
    setupComplete: false,
    currentStep: "upstream-star",
    repositories: {
      status: "complete",
      githubInstallationId: 42,
    },
    upstreamStar: {
      status: "ready",
      verifiedAt: null,
    },
    launch: {
      status: "locked",
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
    setupClaimToken: setupClaim.token,
    installState: await readRepositoryInstallState(setupAgent),
  });

  setupAgent.setState(createInitialNanitesSetupState());

  await expect(
    setupAgent.refresh({
      origin: "https://sigvelo-agent-tests.example.workers.dev",
    }),
  ).resolves.toMatchObject({
    setupComplete: false,
    currentStep: "upstream-star",
    githubApp: {
      status: "complete",
      slug: "nanites-test",
    },
    repositories: {
      status: "complete",
      githubInstallationId: 42,
    },
    upstreamStar: {
      status: "ready",
    },
    launch: {
      status: "locked",
    },
  });
});

test("repository install state is cleared when the GitHub App generation changes", async () => {
  await saveGeneratedGitHubAppMetadata({
    appId: 12345,
    slug: "nanites-test",
    htmlUrl: "https://github.com/apps/nanites-test",
  });

  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const originalInstallState = await readRepositoryInstallState(setupAgent);
  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    setupClaimToken: setupClaim.token,
    installState: originalInstallState,
  });

  await saveGeneratedGitHubAppMetadata({
    appId: 67890,
    slug: "nanites-next",
    htmlUrl: "https://github.com/apps/nanites-next",
  });

  await expect(
    setupAgent.refresh({
      origin: "https://sigvelo-agent-tests.example.workers.dev",
    }),
  ).resolves.toMatchObject({
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
    upstreamStar: {
      status: "locked",
    },
  });

  const refreshedInstallState = await readRepositoryInstallState(setupAgent);
  expect(refreshedInstallState).not.toBe(originalInstallState);
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

  const originalEnv = {
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    AUTH_COOKIE_SECRET: env.AUTH_COOKIE_SECRET,
  };

  Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", "replace-with-github-private-key");
  Reflect.set(env, "GITHUB_CLIENT_SECRET", "replace-with-github-client-secret");
  Reflect.set(env, "GITHUB_WEBHOOK_SECRET", "replace-with-github-webhook-secret");
  Reflect.set(env, "AUTH_COOKIE_SECRET", "replace-with-auth-cookie-secret");

  try {
    const response = await nanitesHttpApp.request("/api/setup/status", {}, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      setupComplete: false,
      githubApp: {
        status: "secrets-propagating",
        slug: "nanites-test",
      },
      repositories: {
        status: "locked",
      },
    });
  } finally {
    Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", originalEnv.GITHUB_APP_PRIVATE_KEY);
    Reflect.set(env, "GITHUB_CLIENT_SECRET", originalEnv.GITHUB_CLIENT_SECRET);
    Reflect.set(env, "GITHUB_WEBHOOK_SECRET", originalEnv.GITHUB_WEBHOOK_SECRET);
    Reflect.set(env, "AUTH_COOKIE_SECRET", originalEnv.AUTH_COOKIE_SECRET);
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

  const originalEnv = {
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    AUTH_COOKIE_SECRET: env.AUTH_COOKIE_SECRET,
  };

  Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", "replace-with-github-private-key");
  Reflect.set(env, "GITHUB_CLIENT_SECRET", "replace-with-github-client-secret");
  Reflect.set(env, "GITHUB_WEBHOOK_SECRET", "replace-with-github-webhook-secret");
  Reflect.set(env, "AUTH_COOKIE_SECRET", "replace-with-auth-cookie-secret");

  try {
    await expect(
      setupAgent.refresh({
        origin: "https://sigvelo-agent-tests.example.workers.dev",
      }),
    ).resolves.toMatchObject({
      githubApp: {
        status: "secrets-propagating",
        slug: "nanites-test",
      },
      repositories: {
        status: "locked",
      },
    });

    const response = await nanitesHttpApp.request(
      "https://sigvelo-agent-tests.example.workers.dev/api/setup/status",
      {},
      readyEnv,
    );

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
    Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", originalEnv.GITHUB_APP_PRIVATE_KEY);
    Reflect.set(env, "GITHUB_CLIENT_SECRET", originalEnv.GITHUB_CLIENT_SECRET);
    Reflect.set(env, "GITHUB_WEBHOOK_SECRET", originalEnv.GITHUB_WEBHOOK_SECRET);
    Reflect.set(env, "AUTH_COOKIE_SECRET", originalEnv.AUTH_COOKIE_SECRET);
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
  const originalEnv = {
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    AUTH_COOKIE_SECRET: env.AUTH_COOKIE_SECRET,
  };

  Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", "replace-with-github-private-key");
  Reflect.set(env, "GITHUB_CLIENT_SECRET", "replace-with-github-client-secret");
  Reflect.set(env, "GITHUB_WEBHOOK_SECRET", "replace-with-github-webhook-secret");
  Reflect.set(env, "AUTH_COOKIE_SECRET", "replace-with-auth-cookie-secret");

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === "https://sigvelo-agent-tests.example.workers.dev/api/setup/status") {
      return nanitesHttpApp.request(request, {}, readyEnv);
    }

    return originalFetch(input, init);
  };

  try {
    await expect(
      setupAgent.refresh({
        origin: "https://sigvelo-agent-tests.example.workers.dev",
      }),
    ).resolves.toMatchObject({
      githubApp: {
        status: "secrets-propagating",
        slug: "nanites-test",
      },
    });

    await expect(
      setupAgent.checkGitHubSecretPropagation({
        origin: "https://sigvelo-agent-tests.example.workers.dev",
      }),
    ).resolves.toMatchObject({
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
    Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", originalEnv.GITHUB_APP_PRIVATE_KEY);
    Reflect.set(env, "GITHUB_CLIENT_SECRET", originalEnv.GITHUB_CLIENT_SECRET);
    Reflect.set(env, "GITHUB_WEBHOOK_SECRET", originalEnv.GITHUB_WEBHOOK_SECRET);
    Reflect.set(env, "AUTH_COOKIE_SECRET", originalEnv.AUTH_COOKIE_SECRET);
  }
});

test("deployment GitHub App config becomes retryable when generated secrets do not propagate", async () => {
  await saveGeneratedGitHubAppMetadata();
  await env.DB.exec("UPDATE deployment_github_app_config SET updated_at = 1 WHERE id = 'current';");
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const originalEnv = {
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    AUTH_COOKIE_SECRET: env.AUTH_COOKIE_SECRET,
  };

  Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", "");
  Reflect.set(env, "GITHUB_CLIENT_SECRET", "");
  Reflect.set(env, "GITHUB_WEBHOOK_SECRET", "");
  Reflect.set(env, "AUTH_COOKIE_SECRET", "");

  try {
    const setupState = await setupAgent.refresh({
      origin: "https://sigvelo-agent-tests.example.workers.dev",
    });
    const setupClaim = await issueSetupClaim(setupAgent);

    expect(setupState.githubApp).toMatchObject({
      status: "secrets-propagation-stalled",
      slug: "nanites-test",
    });
    await expect(
      setupAgent.startGitHubManifest({
        origin: "https://sigvelo-agent-tests.example.workers.dev",
        ownerType: "user",
        setupClaimToken: setupClaim.token,
      }),
    ).resolves.toMatchObject({
      action: "https://github.com/settings/apps/new",
    });
  } finally {
    Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", originalEnv.GITHUB_APP_PRIVATE_KEY);
    Reflect.set(env, "GITHUB_CLIENT_SECRET", originalEnv.GITHUB_CLIENT_SECRET);
    Reflect.set(env, "GITHUB_WEBHOOK_SECRET", originalEnv.GITHUB_WEBHOOK_SECRET);
    Reflect.set(env, "AUTH_COOKIE_SECRET", originalEnv.AUTH_COOKIE_SECRET);
  }
});

test("deployment GitHub App config waits for generated auth-cookie secret", async () => {
  await saveGeneratedGitHubAppMetadata();

  await expect(
    readDeploymentGitHubAppConfig(createDbClient(env.DB), envWithoutAuthCookieSecret()),
  ).resolves.toBe(null);
});

test("setup Agent route is available before GitHub sign-in exists", async () => {
  const response = await worker.fetch(
    new Request(
      "https://sigvelo-agent-tests.example.workers.dev/agents/nanites-setup-agent/default",
    ),
    env,
    createExecutionContext(),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    deployment: { status: "complete" },
    cloudflare: { status: "idle" },
  });
});

test("Cloudflare setup OAuth uses the stable setup Agent callback route", async () => {
  const setupAgent = await getSetupAgent();
  const setupOwner = await setupAgent.claimSetupOwner();
  if (!setupOwner.setupOwnerToken) {
    throw new Error("Expected setup owner claim to return a token.");
  }

  const expectedCallbackUrl = `${SETUP_ORIGIN}/agents/${NANITES_SETUP_AGENT_NAME}/${NANITES_SETUP_AGENT_INSTANCE_NAME}/callback`;
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
    const result = await setupAgent.connectCloudflare({
      origin: SETUP_ORIGIN,
      setupOwnerToken: setupOwner.setupOwnerToken,
    });

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

test("setup owner claim prevents another browser from mutating Cloudflare setup", async () => {
  const setupAgent = await getSetupAgent();
  const firstOwner = await setupAgent.claimSetupOwner();

  expect(firstOwner.claimed).toBe(true);
  expect(firstOwner.setupOwnerToken).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(firstOwner.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  const secondOwner = await setupAgent.claimSetupOwner();
  expect(secondOwner).toMatchObject({
    claimed: false,
    setupOwnerToken: null,
    expiresAt: firstOwner.expiresAt,
  });
  await expect(
    setupAgent.connectCloudflare({
      origin: "https://sigvelo-agent-tests.example.workers.dev",
      setupOwnerToken: "not-the-owner",
    }),
  ).resolves.toMatchObject({
    authorizationUrl: null,
    setupOwnerClaimRequired: true,
  });

  await expect(setupAgent.refresh()).resolves.toMatchObject({
    cloudflare: { status: "idle" },
    setupOwner: {
      status: "claimed",
      claimExpiresAt: firstOwner.expiresAt,
    },
  });

  if (!firstOwner.setupOwnerToken) {
    throw new Error("Expected setup owner claim to return a token.");
  }
  await expect(
    setupAgent.resetSetupOwner({ setupOwnerToken: firstOwner.setupOwnerToken }),
  ).resolves.toMatchObject({
    setupOwner: {
      status: "unclaimed",
      claimExpiresAt: null,
    },
  });
});

test("GitHub manifest start is not exposed as a setup API route", async () => {
  const response = await nanitesHttpApp.request(
    "https://sigvelo-agent-tests.example.workers.dev/api/setup/github/manifest/start",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerType: "user" }),
    },
    env,
  );

  expect(response.status).toBe(404);
});

test("GitHub manifest callable returns a first-party manifest form target after Cloudflare proof", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);

  const result = await setupAgent.startGitHubManifest({
    origin: "https://sigvelo-agent-tests.example.workers.dev",
    ownerType: "organization",
    ownerLogin: " WebMCP-org ",
    setupClaimToken: setupClaim.token,
  });

  expect(result.action).toBe("https://github.com/organizations/WebMCP-org/settings/apps/new");
  expect(result.state).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(result.manifest).toMatchObject({
    name: expect.stringMatching(/^Nanites [a-z0-9]{10}$/),
    redirect_url: "https://sigvelo-agent-tests.example.workers.dev/setup/github/manifest/callback",
    callback_urls: ["https://sigvelo-agent-tests.example.workers.dev/auth/github/callback"],
    setup_url: "https://sigvelo-agent-tests.example.workers.dev/setup/github/installed",
    request_oauth_on_install: false,
    hook_attributes: {
      url: "https://sigvelo-agent-tests.example.workers.dev/api/github/webhook",
      active: true,
    },
    default_permissions: {
      contents: "write",
      pull_requests: "write",
      starring: "write",
    },
  });
});

test("setup keeps GitHub App locked while Workers Paid readiness is blocked", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(
    buildCloudflareBlockedSetupState(
      "workers-paid",
      "Workers Paid was not detected on this account.",
    ),
  );

  await expect(
    setupAgent.refresh({
      origin: "https://sigvelo-agent-tests.example.workers.dev",
    }),
  ).resolves.toMatchObject({
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

test("setup clears the legacy Kimi catalog blocker when Workers AI is ready", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(
    buildCloudflareBlockedSetupState(
      "kimi-k2",
      "Cloudflare Workers AI did not list Kimi K2.6 for this account.",
    ),
  );

  await expect(
    setupAgent.refresh({
      origin: "https://sigvelo-agent-tests.example.workers.dev",
    }),
  ).resolves.toMatchObject({
    currentStep: "github-app",
    cloudflare: {
      readiness: {
        status: "ready",
        items: expect.arrayContaining([
          expect.objectContaining({
            key: "kimi-k2",
            status: "ready",
            detail:
              "Default model `@cf/moonshotai/kimi-k2.6` is configured through Workers AI. No Moonshot or provider API key is required.",
          }),
        ]),
      },
      error: null,
    },
    githubApp: {
      status: "ready",
    },
    error: null,
  });
});

test("GitHub manifest callable ignores informational Cloudflare readiness warnings", async () => {
  const setupAgent = await getSetupAgent();
  const state = buildCloudflareVerifiedSetupState();
  setupAgent.setState({
    ...state,
    cloudflare: {
      ...state.cloudflare,
      readiness: {
        status: "ready",
        checkedAt: new Date().toISOString(),
        items: state.cloudflare.readiness.items.map((item) =>
          item.key === "browser-run"
            ? {
                ...item,
                status: "warning" as const,
                detail: "Browser Run binding `BROWSER` was not detected.",
                action: "retry" as const,
              }
            : item,
        ),
      },
    },
  });
  const setupClaim = await issueSetupClaim(setupAgent);

  await expect(
    setupAgent.startGitHubManifest({
      origin: "https://sigvelo-agent-tests.example.workers.dev",
      ownerType: "user",
      setupClaimToken: setupClaim.token,
    }),
  ).resolves.toMatchObject({
    action: "https://github.com/settings/apps/new",
  });
});

test("GitHub manifest callable can retry after an abandoned GitHub form", async () => {
  const setupAgent = await getSetupAgent();
  const setupState = buildCloudflareVerifiedSetupState();
  setupAgent.setState({
    ...setupState,
    githubApp: {
      ...setupState.githubApp,
      status: "creating",
      manifestState: "old-manifest-state",
    },
  });
  const setupClaim = await issueSetupClaim(setupAgent);

  const result = await setupAgent.startGitHubManifest({
    origin: "https://sigvelo-agent-tests.example.workers.dev",
    ownerType: "user",
    setupClaimToken: setupClaim.token,
  });

  expect(result.action).toBe("https://github.com/settings/apps/new");
  expect(result.state).not.toBe("old-manifest-state");
  expect(result.state).toMatch(/^[A-Za-z0-9_-]+$/);
});

test("setup refresh preserves an in-flight GitHub manifest callback state", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const manifest = await setupAgent.startGitHubManifest({
    origin: "https://sigvelo-agent-tests.example.workers.dev",
    ownerType: "user",
    setupClaimToken: setupClaim.token,
  });
  const originalEnv = {
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    AUTH_COOKIE_SECRET: env.AUTH_COOKIE_SECRET,
  };

  Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", "");
  Reflect.set(env, "GITHUB_CLIENT_SECRET", "");
  Reflect.set(env, "GITHUB_WEBHOOK_SECRET", "");
  Reflect.set(env, "AUTH_COOKIE_SECRET", "");

  try {
    await expect(
      setupAgent.refresh({
        origin: "https://sigvelo-agent-tests.example.workers.dev",
      }),
    ).resolves.toMatchObject({
      githubApp: {
        status: "creating",
        manifestState: manifest.state,
        slug: null,
        htmlUrl: null,
        installUrl: null,
        ownerLogin: null,
        ownerType: null,
      },
    });
  } finally {
    Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", originalEnv.GITHUB_APP_PRIVATE_KEY);
    Reflect.set(env, "GITHUB_CLIENT_SECRET", originalEnv.GITHUB_CLIENT_SECRET);
    Reflect.set(env, "GITHUB_WEBHOOK_SECRET", originalEnv.GITHUB_WEBHOOK_SECRET);
    Reflect.set(env, "AUTH_COOKIE_SECRET", originalEnv.AUTH_COOKIE_SECRET);
  }
});

test("GitHub manifest callback rejects callbacks that do not match setup Agent state", async () => {
  const setupAgent = await getSetupAgent();
  const setupState = buildCloudflareVerifiedSetupState();
  setupAgent.setState({
    ...setupState,
    githubApp: {
      ...setupState.githubApp,
      status: "creating",
      manifestState: "expected-state",
    },
  });
  const setupClaim = await issueSetupClaim(setupAgent);

  const response = await nanitesHttpApp.request(
    "https://sigvelo-agent-tests.example.workers.dev/setup/github/manifest/callback?code=test-manifest-code&state=wrong-state",
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

test("GitHub manifest callback is bound to the setup claim that started it", async () => {
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const firstSetupClaim = await issueSetupClaim(setupAgent);
  const manifest = await setupAgent.startGitHubManifest({
    origin: "https://sigvelo-agent-tests.example.workers.dev",
    ownerType: "user",
    setupClaimToken: firstSetupClaim.token,
  });
  const secondSetupClaim = await issueSetupClaim(setupAgent);
  const originalFetch = globalThis.fetch;
  let conversionRequests = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === "https://api.github.com/app-manifests/test-manifest-code/conversions") {
      conversionRequests += 1;
      return Response.json(buildGitHubManifestConversion());
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      `https://sigvelo-agent-tests.example.workers.dev/setup/github/manifest/callback?code=test-manifest-code&state=${manifest.state}`,
      {
        headers: { Cookie: secondSetupClaim.cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(conversionRequests).toBe(0);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_setup_state",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub manifest setup failure leaves the setup Agent retryable", async () => {
  const setupAgent = await getSetupAgent();
  const { setupClaim, manifest } = await startClaimedGitHubManifest(setupAgent);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === "https://api.github.com/app-manifests/test-manifest-code/conversions") {
      return Response.json({ message: "conversion failed" }, { status: 500 });
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      `https://sigvelo-agent-tests.example.workers.dev/setup/github/manifest/callback?code=test-manifest-code&state=${manifest.state}`,
      {
        headers: { Cookie: setupClaim.cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "github_app_manifest_conversion_failed",
    });

    await expect(
      setupAgent.startGitHubManifest({
        origin: "https://sigvelo-agent-tests.example.workers.dev",
        ownerType: "user",
        setupClaimToken: setupClaim.token,
      }),
    ).resolves.toMatchObject({
      action: expect.stringContaining("https://github.com/settings/apps/new"),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub manifest callback rejects apps missing required permissions", async () => {
  const setupAgent = await getSetupAgent();
  const { setupClaim, manifest } = await startClaimedGitHubManifest(setupAgent);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === "https://api.github.com/app-manifests/test-manifest-code/conversions") {
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
      `https://sigvelo-agent-tests.example.workers.dev/setup/github/manifest/callback?code=test-manifest-code&state=${manifest.state}`,
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
  const { setupClaim, manifest } = await startClaimedGitHubManifest(setupAgent);
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    AUTH_COOKIE_SECRET: env.AUTH_COOKIE_SECRET,
  };

  Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", "");
  Reflect.set(env, "GITHUB_CLIENT_SECRET", "");
  Reflect.set(env, "GITHUB_WEBHOOK_SECRET", "");
  Reflect.set(env, "AUTH_COOKIE_SECRET", "");

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url === "https://api.github.com/app-manifests/test-manifest-code/conversions") {
      return Response.json(buildGitHubManifestConversion());
    }

    return originalFetch(input, init);
  };

  try {
    const response = await nanitesHttpApp.request(
      `https://sigvelo-agent-tests.example.workers.dev/setup/github/manifest/callback?code=test-manifest-code&state=${manifest.state}`,
      {
        headers: { Cookie: setupClaim.cookieHeader },
      },
      env,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "cloudflare_worker_secret_write_failed",
    });
    await expect(
      setupAgent.refresh({
        origin: "https://sigvelo-agent-tests.example.workers.dev",
      }),
    ).resolves.toMatchObject({
      githubApp: {
        status: "failed",
        orphanedHtmlUrl: "https://github.com/apps/nanites-test",
        cleanupInstructions: expect.stringContaining("https://github.com/apps/nanites-test"),
      },
      repositories: {
        status: "locked",
        githubInstallationId: null,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", originalEnv.GITHUB_APP_PRIVATE_KEY);
    Reflect.set(env, "GITHUB_CLIENT_SECRET", originalEnv.GITHUB_CLIENT_SECRET);
    Reflect.set(env, "GITHUB_WEBHOOK_SECRET", originalEnv.GITHUB_WEBHOOK_SECRET);
    Reflect.set(env, "AUTH_COOKIE_SECRET", originalEnv.AUTH_COOKIE_SECRET);
  }
});

test("repository install callable waits for readable runtime GitHub App config", async () => {
  const request = new Request(
    "https://sigvelo-agent-tests.example.workers.dev/setup/github/verify?installation_id=42",
  );
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  const cookieHeader = joinCookieHeaders(
    await buildAuthenticatedSetupCookieHeader(request),
    setupClaim.cookieHeader,
  );
  const originalEnv = {
    GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
  };
  const originalFetch = globalThis.fetch;

  Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", "");
  Reflect.set(env, "GITHUB_CLIENT_SECRET", "");
  Reflect.set(env, "GITHUB_WEBHOOK_SECRET", "");

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    if (isVisibleInstallationsRequest(githubRequest)) {
      return Response.json({ installations: [buildVisibleInstallation(42)] });
    }
    if (isInstallationRepositoriesRequest(githubRequest, 42)) {
      return Response.json({ repositories: [buildVisibleRepository()] });
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_setup_state",
    });
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.set(env, "GITHUB_APP_PRIVATE_KEY", originalEnv.GITHUB_APP_PRIVATE_KEY);
    Reflect.set(env, "GITHUB_CLIENT_SECRET", originalEnv.GITHUB_CLIENT_SECRET);
    Reflect.set(env, "GITHUB_WEBHOOK_SECRET", originalEnv.GITHUB_WEBHOOK_SECRET);
  }
});

test("GitHub setup verification returns to setup and keeps launch locked until upstream star", async () => {
  await saveGeneratedGitHubAppMetadata();
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
    await expect(setupAgent.refresh({ origin: request.url })).resolves.toMatchObject({
      setupComplete: false,
      currentStep: "upstream-star",
      repositories: {
        status: "complete",
        githubInstallationId: 42,
      },
      upstreamStar: {
        status: "ready",
      },
      launch: {
        status: "locked",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub login redirects to setup when no deployment app config exists", async () => {
  const response = await nanitesHttpApp.request(
    "https://sigvelo-agent-tests.example.workers.dev/auth/github/login?returnTo=/nanites",
    {},
    env,
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/setup");
});

test("MCP route reports setup required when no deployment app config exists", async () => {
  const response = await worker.fetch(
    new Request("https://sigvelo-agent-tests.example.workers.dev/mcp"),
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
    "https://sigvelo-agent-tests.example.workers.dev/setup/github/installed?installation_id=42&setup_action=install&state=test-install-state",
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
    "https://sigvelo-agent-tests.example.workers.dev/setup/github/installed?installation_id=42&setup_action=install",
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
    "https://sigvelo-agent-tests.example.workers.dev/setup/github/installed?setup_action=install",
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
    "https://sigvelo-agent-tests.example.workers.dev/setup/github/installed?installation_id=42",
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

test("GitHub setup verification requires the install nonce for claimed setup", async () => {
  const request = new Request(
    "https://sigvelo-agent-tests.example.workers.dev/setup/github/verify?installation_id=42",
  );
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  await saveGeneratedGitHubAppMetadata();
  await setupAgent.refresh({
    origin: "https://sigvelo-agent-tests.example.workers.dev",
  });
  const cookieHeader = joinCookieHeaders(
    await buildAuthenticatedSetupCookieHeader(request),
    setupClaim.cookieHeader,
  );
  const originalFetch = globalThis.fetch;
  let githubApiRequests = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const githubRequest = input instanceof Request ? input : new Request(input, init);
    if (new URL(githubRequest.url).origin === GITHUB_API_ORIGIN) {
      githubApiRequests += 1;
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
    expect(githubApiRequests).toBe(0);
    await expect(response.json()).resolves.toEqual({
      code: "setup_installation_verification_failed",
      githubInstallationId: 42,
      reason: "install_state_mismatch",
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
  const request = new Request(
    "https://sigvelo-agent-tests.example.workers.dev/setup/github/verify?installation_id=42",
  );
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
  const response = await nanitesHttpApp.request(
    "https://sigvelo-agent-tests.example.workers.dev/api/setup/upstream-star",
    {},
    env,
  );

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({
    code: "authentication_required",
  });
});

test("upstream star verification completes setup when GitHub confirms the star", async () => {
  await saveGeneratedGitHubAppMetadata();
  const request = new Request(
    "https://sigvelo-agent-tests.example.workers.dev/api/setup/upstream-star",
  );
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    setupClaimToken: setupClaim.token,
    installState: await readRepositoryInstallState(setupAgent),
  });
  const cookieHeader = joinCookieHeaders(
    await buildAuthenticatedSetupCookieHeader(request),
    setupClaim.cookieHeader,
  );
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
    expect(response.headers.get("Set-Cookie")).toContain(`${SETUP_CLAIM_COOKIE_NAME}=`);
    await expect(response.json()).resolves.toMatchObject({
      setupComplete: true,
      currentStep: "launch",
      upstreamStar: {
        status: "complete",
      },
      launch: {
        status: "ready",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upstream star verification leaves setup blocked when GitHub does not confirm the star", async () => {
  await saveGeneratedGitHubAppMetadata();
  const request = new Request(
    "https://sigvelo-agent-tests.example.workers.dev/api/setup/upstream-star",
  );
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    setupClaimToken: setupClaim.token,
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
      setupComplete: false,
      currentStep: "upstream-star",
      upstreamStar: {
        status: "failed",
        verifiedAt: null,
        error: "GitHub did not confirm that this user starred WebMCP-org/nanites.",
      },
      launch: {
        status: "locked",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upstream star action stars through the signed-in GitHub user token", async () => {
  await saveGeneratedGitHubAppMetadata();
  const request = new Request(
    "https://sigvelo-agent-tests.example.workers.dev/api/setup/upstream-star",
    { method: "PUT" },
  );
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await issueSetupClaim(setupAgent);
  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    setupClaimToken: setupClaim.token,
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
        status: "complete",
      },
      launch: {
        status: "ready",
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
