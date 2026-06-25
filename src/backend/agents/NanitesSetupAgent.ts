import {
  GITHUB_OAUTH_CALLBACK_PATH,
  GITHUB_WEBHOOK_PATH,
  NANITES_SETUP_AGENT_NAME,
  NANITES_SETUP_AGENT_INSTANCE_NAME,
  DEFAULT_SIGVELO_AGENT_MODEL_ID,
} from "#/shared/constants.ts";
import { Agent, DurableObjectOAuthClientProvider, getCurrentAgent } from "agents";
import type { MCPClientOAuthResult } from "agents/mcp/client";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { getLogger } from "@logtape/logtape";
import { generateCookie } from "hono/cookie";
import { z } from "zod";
import { createDbClient } from "#/backend/db/index.ts";
import { AppError, describeError } from "#/backend/errors.ts";
import {
  AUTH_COOKIE_SECRET_BINDING,
  assertDeploymentGitHubAppRegistrable,
  buildGitHubAppSecretBindings,
  readAuthCookieSecret,
  readDeploymentGitHubAppMetadata,
  registerGitHubApp,
  resolveGitHubApp,
} from "#/backend/github/apps.ts";
import {
  convertGitHubAppManifestCode,
  type GitHubAppManifestConversion,
} from "#/backend/github/index.ts";
import { normalizeGitHubAppPrivateKeyToPkcs8 } from "#/backend/github/private-key.ts";
import {
  NANITES_AI_GATEWAY_ID,
  NANITES_AI_GATEWAY_REQUEST_DEFAULTS,
} from "#/backend/nanites/language-model.ts";
import { LOGGING } from "#/backend/logging.ts";
import { buildGitHubAppInstallHref, type GitHubWebhookEventName } from "#/shared/utils/github.ts";

const setupLogger = getLogger(LOGGING.NANITES_CATEGORY).getChild("setup");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETUP_STATE_VERSION = 5;

const CLOUDFLARE_MCP_SERVER_ID = "cloudflare-api";
const CLOUDFLARE_MCP_SERVER_NAME = "Cloudflare API";
const CLOUDFLARE_MCP_SERVER_URL = "https://mcp.cloudflare.com/mcp";
const CLOUDFLARE_MCP_CALLBACK_PATH = `/agents/${NANITES_SETUP_AGENT_NAME}/${NANITES_SETUP_AGENT_INSTANCE_NAME}/callback`;
const CLOUDFLARE_MCP_TIMEOUT_MS = 2 * 60 * 1_000;
export const CLOUDFLARE_SETUP_OAUTH_SCOPE =
  "offline_access user:read account:read billing:read workers:read workers_scripts:write aig:read aig:write";

export const GITHUB_APP_MANIFEST_CALLBACK_PATH = "/setup/github/manifest/callback";
export const GITHUB_APP_INSTALL_CALLBACK_PATH = "/setup/github/installed";

export const SETUP_CLAIM_COOKIE_NAME = "nanites_setup_claim";
const SETUP_CLAIM_STORAGE_KEY = "nanites:setup:claim";
const SETUP_CLAIM_TTL_MS = 60 * 60 * 1_000;
const MANIFEST_NONCE_STORAGE_KEY = "nanites:setup:manifest";
const MANIFEST_NONCE_TTL_MS = 60 * 60 * 1_000;
const INSTALL_NONCE_STORAGE_KEY = "nanites:setup:install-nonce";
const CONNECTED_INSTALLATION_STORAGE_KEY = "nanites:setup:connected-installation";
const SETUP_TOKEN_BYTE_LENGTH = 32;
const AUTH_COOKIE_SECRET_BYTE_LENGTH = 48;

const SECRET_PROPAGATION_CHECK_DELAY_SECONDS = 2;
const SECRET_PROPAGATION_STALL_AFTER_MS = 2 * 60 * 1_000;

const READINESS_SMOKE_WORKER_KEY = "nanites-setup-readiness";
const READINESS_SMOKE_WORKER_RESPONSE = "nanites-readiness-ok";

export const GITHUB_APP_MANIFEST_DESCRIPTION =
  "Nanites runs small durable agents that maintain selected GitHub repositories through scoped events, schedules, and manual prompts.";

// The app is the self-hoster's own customer-owned GitHub App, so the default ceiling
// is broad: per-run nanite tokens are downscoped from it
// (issueScopedGitHubInstallationToken), and downscoping can only subtract.
// Defaults apply to new registrations only — widening later forces every
// existing installation to re-approve, which is the friction a broad default
// avoids. Deliberately excluded: `administration` (irreversible non-git
// damage, no nanite use case) and all org/security scopes (a different trust
// conversation than repo automation).
//
// Every key must appear in GitHub's `app-permissions` API schema: the
// manifest endpoint rejects the whole registration ("Default permission ...
// resource is not included in the list") for keys it does not know, and its
// allowlist lags the settings UI. UI-only permissions (`discussions`,
// `merge_queues`, `variables`, artifact metadata) can be granted manually on
// the app after creation. The `satisfies` clause enforces schema membership
// at compile time.
type GitHubAppManifestPermissions = NonNullable<
  RestEndpointMethodTypes["apps"]["createInstallationAccessToken"]["parameters"]["permissions"]
>;

export const DEFAULT_GITHUB_APP_PERMISSIONS = {
  actions: "write",
  checks: "write",
  contents: "write",
  deployments: "write",
  environments: "write",
  issues: "write",
  metadata: "read",
  pages: "write",
  pull_requests: "write",
  repository_hooks: "write",
  repository_projects: "write",
  secrets: "write",
  starring: "write",
  statuses: "write",
  // Without `workflows`, any nanite push touching .github/workflows/ is
  // rejected by GitHub.
  workflows: "write",
} as const satisfies GitHubAppManifestPermissions;

// Unhandled events are cheap no-ops at the webhook ingress, so subscribe
// wide: new trigger types become possible without re-registering the app.
// Every event must be backed by a permission above (GitHub validates the
// pairing at registration), so `discussion`/`discussion_comment`/
// `merge_group` are out until their permissions can ride a manifest.
export const DEFAULT_GITHUB_APP_EVENTS = [
  "check_run",
  "check_suite",
  "commit_comment",
  "create",
  "delete",
  "deployment",
  "deployment_status",
  "fork",
  "issue_comment",
  "issues",
  "label",
  "milestone",
  "public",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_review_thread",
  "push",
  "release",
  "repository",
  "repository_dispatch",
  "star",
  "status",
  "watch",
  "workflow_dispatch",
  "workflow_job",
  "workflow_run",
] as const satisfies readonly GitHubWebhookEventName[];

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

export type SetupStep = "cloudflare" | "github-app" | "repositories" | "launch";

export type CloudflareReadinessAction = "reconnect" | "configure" | "retry";

export type CloudflareReadinessItem = {
  readonly key: "workers-paid" | "worker-loader" | "workers-ai" | "ai-gateway" | "browser";
  readonly label: string;
  readonly required: boolean;
  readonly status: "ready" | "blocked" | "warning";
  readonly detail: string;
  readonly action: CloudflareReadinessAction | null;
};

export type CloudflareReadiness = {
  readonly status: "unknown" | "checking" | "ready" | "blocked";
  readonly checkedAt: string | null;
  readonly items: readonly CloudflareReadinessItem[];
};

export type NanitesSetupState = {
  readonly version: number;
  readonly setupComplete: boolean;
  readonly currentStep: SetupStep;
  readonly cloudflare: {
    readonly status: "idle" | "authenticating" | "verifying" | "verified" | "failed";
    readonly authorizationUrl: string | null;
    readonly accountId: string | null;
    readonly accountName: string | null;
    readonly scriptName: string | null;
    readonly readiness: CloudflareReadiness;
    readonly error: string | null;
  };
  readonly githubApp: {
    readonly status:
      | "locked"
      | "ready"
      | "writing-secrets"
      | "propagating"
      | "stalled"
      | "complete";
    readonly appId: number | null;
    readonly slug: string | null;
    readonly htmlUrl: string | null;
    readonly ownerLogin: string | null;
    readonly installUrl: string | null;
    readonly orphanedAppUrl: string | null;
    readonly error: string | null;
  };
  readonly repositories: {
    readonly status: "locked" | "ready" | "complete";
    readonly githubInstallationId: number | null;
    readonly repositoryFullName: string | null;
    readonly error: string | null;
  };
  readonly upstreamStar: {
    readonly starred: boolean;
    readonly error: string | null;
  };
};

export function createInitialSetupState(): NanitesSetupState {
  return {
    version: SETUP_STATE_VERSION,
    setupComplete: false,
    currentStep: "cloudflare",
    cloudflare: {
      status: "idle",
      authorizationUrl: null,
      accountId: null,
      accountName: null,
      scriptName: null,
      readiness: { status: "unknown", checkedAt: null, items: [] },
      error: null,
    },
    githubApp: {
      status: "locked",
      appId: null,
      slug: null,
      htmlUrl: null,
      ownerLogin: null,
      installUrl: null,
      orphanedAppUrl: null,
      error: null,
    },
    repositories: {
      status: "locked",
      githubInstallationId: null,
      repositoryFullName: null,
      error: null,
    },
    upstreamStar: {
      starred: false,
      error: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Method inputs and results
// ---------------------------------------------------------------------------

export type RefreshSetupInput = {
  readonly origin?: string;
  /**
   * Set by Worker routes that already read the deployment GitHub App config in
   * a fresh isolate. Secrets written through the Cloudflare API only appear in
   * new isolates, so this Durable Object's own `env` can lag behind.
   */
  readonly runtimeConfigReadable?: boolean;
};

export type SetupClaim = {
  readonly token: string;
  readonly expiresAt: string;
};

export type ConnectCloudflareResult = {
  readonly state: NanitesSetupState;
  readonly authorizationUrl: string | null;
  /** Present when Cloudflare ownership was verified without an OAuth redirect. */
  readonly claim: SetupClaim | null;
};

export type StartGitHubAppInput = {
  readonly origin: string;
  readonly claimToken: string;
};

export type StartGitHubAppResult =
  | {
      readonly ok: true;
      readonly action: string;
      readonly manifest: GitHubAppManifest;
      readonly state: string;
    }
  | {
      readonly ok: false;
      readonly errorKind:
        | "setupClaimRequired"
        | "cloudflareReadinessRequired"
        | "invalidSetupState";
    };

export type CompleteGitHubAppManifestInput = {
  readonly origin: string;
  readonly claimToken: string;
  readonly code: string;
  readonly state: string;
};

export type CompleteGitHubAppManifestResult =
  | {
      readonly ok: true;
      readonly installUrl: string;
      readonly deploymentConfigured: boolean;
    }
  | {
      readonly ok: false;
      readonly errorKind:
        | "setupClaimRequired"
        | "invalidSetupState"
        | "cloudflareWorkerSecretWriteFailed"
        | "githubAppManifestConversionFailed";
    };

export type RecordRepositoryInstallInput = {
  readonly claimToken: string | null;
  readonly githubInstallationId: number;
  readonly repositoryFullName: string;
  readonly installState: string | null;
  readonly runtimeConfigReadable?: boolean;
};

export type RecordRepositoryInstallResult =
  | { readonly ok: true; readonly state: NanitesSetupState }
  | {
      readonly ok: false;
      readonly errorKind: "setupClaimRequired" | "invalidSetupState" | "installStateMismatch";
    };

export type GitHubInstallationRepairReason =
  | "installation_deleted"
  | "installation_suspended"
  | "installation_repositories_removed"
  | "installation_permissions_changed";

export type RecordUpstreamStarInput = {
  readonly starred: boolean;
  readonly error?: string | null;
};

// ---------------------------------------------------------------------------
// Setup claim cookie
// ---------------------------------------------------------------------------

export function buildSetupClaimCookie(request: Request, claim: SetupClaim): string {
  return generateCookie(SETUP_CLAIM_COOKIE_NAME, claim.token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    expires: new Date(claim.expiresAt),
  });
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const storedSetupTokenSchema = z.object({
  tokenHash: z.string().min(1),
  expiresAt: z.string().min(1),
});

const connectedInstallationSchema = z.object({
  githubAppId: z.number().int().positive(),
  githubInstallationId: z.number().int().positive(),
  repositoryFullName: z.string().trim().min(1),
});
type ConnectedInstallation = z.infer<typeof connectedInstallationSchema>;

const manifestNonceSchema = z.object({
  state: z.string().min(1),
  expiresAt: z.string().min(1),
});

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// Worker route resolution
// ---------------------------------------------------------------------------

type WorkerRoute = {
  readonly origin: string;
  readonly hostname: string;
  readonly scriptName: string;
  readonly workersDevSubdomain: string | null;
};

function resolveWorkerRoute(origin: string, env: Env): WorkerRoute | null {
  const configuredScriptName =
    typeof env.NANITES_CLOUDFLARE_SCRIPT_NAME === "string" &&
    env.NANITES_CLOUDFLARE_SCRIPT_NAME.trim().length > 0
      ? env.NANITES_CLOUDFLARE_SCRIPT_NAME.trim()
      : null;
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();
  let scriptName = configuredScriptName;
  let workersDevSubdomain: string | null = null;

  if (hostname.endsWith(".workers.dev")) {
    const labels = hostname.slice(0, -".workers.dev".length).split(".").filter(Boolean);
    if (labels.length >= 2) {
      const workerSubdomain = labels[0] ?? null;
      if (configuredScriptName && workerSubdomain !== configuredScriptName) {
        return null;
      }
      scriptName ??= workerSubdomain;
      workersDevSubdomain = labels.slice(1).join(".");
    }
  }

  if (!scriptName) {
    return null;
  }

  return { origin: url.origin, hostname, scriptName, workersDevSubdomain };
}

// ---------------------------------------------------------------------------
// GitHub App manifest
// ---------------------------------------------------------------------------

const GITHUB_APP_NAME_MAX_LENGTH = 34;

function buildGitHubAppManifest(origin: string, manifestState: string) {
  // Keep Nanites first for GitHub UI branding. The deployment's first hostname
  // label keeps multiple apps legible, and the short suffix dodges GitHub's
  // global app-name uniqueness on re-registration. The user can still edit the
  // name on GitHub's manifest confirmation page.
  const nameSuffix = manifestState
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 4);
  const fixedPartLength = "Nanites  ".length + nameSuffix.length;
  const hostLabel = (new URL(origin).hostname.split(".")[0] ?? "deployment").slice(
    0,
    GITHUB_APP_NAME_MAX_LENGTH - fixedPartLength,
  );
  const name = `Nanites ${hostLabel} ${nameSuffix}`;

  return {
    name,
    url: origin,
    description: GITHUB_APP_MANIFEST_DESCRIPTION,
    // Private apps 404 GitHub's OAuth authorize endpoint for everyone but the
    // owner, which blocks teammates from signing in to the deployment. Public
    // here only means other accounts may authorize/install — it does not list
    // the app anywhere.
    public: true,
    redirect_url: new URL(GITHUB_APP_MANIFEST_CALLBACK_PATH, origin).toString(),
    callback_urls: [new URL(GITHUB_OAUTH_CALLBACK_PATH, origin).toString()],
    setup_url: new URL(GITHUB_APP_INSTALL_CALLBACK_PATH, origin).toString(),
    setup_on_update: true,
    request_oauth_on_install: false,
    hook_attributes: {
      url: new URL(GITHUB_WEBHOOK_PATH, origin).toString(),
      active: true,
    },
    default_permissions: DEFAULT_GITHUB_APP_PERMISSIONS,
    default_events: DEFAULT_GITHUB_APP_EVENTS,
  };
}

export type GitHubAppManifest = ReturnType<typeof buildGitHubAppManifest>;

function requireManifestString(
  githubApp: GitHubAppManifestConversion,
  field: "client_id" | "client_secret" | "pem" | "slug" | "webhook_secret",
): string {
  const value = githubApp[field];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new AppError("githubAppManifestConversionFailed", {
    details: { githubResponseStatus: null, reason: "missing_required_field", field },
  });
}

function readManifestPermissions(githubApp: GitHubAppManifestConversion): Record<string, string> {
  const permissions: Record<string, string> = {};
  for (const [permission, access] of Object.entries(githubApp.permissions ?? {})) {
    if (typeof access === "string") {
      permissions[permission] = access;
    }
  }
  return permissions;
}

function readManifestEvents(githubApp: GitHubAppManifestConversion): readonly string[] {
  return Array.isArray(githubApp.events)
    ? githubApp.events.filter((event): event is string => typeof event === "string")
    : [];
}

function requireManifestMeetsMinimums(githubApp: GitHubAppManifestConversion): void {
  const PERMISSION_RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };
  const permissions = readManifestPermissions(githubApp);
  for (const [permission, requiredAccess] of Object.entries(DEFAULT_GITHUB_APP_PERMISSIONS)) {
    if ((PERMISSION_RANK[permissions[permission]] ?? 0) < (PERMISSION_RANK[requiredAccess] ?? 0)) {
      throw new AppError("githubAppManifestConversionFailed", {
        details: { githubResponseStatus: null, reason: "missing_required_permission", permission },
      });
    }
  }

  const events = new Set(readManifestEvents(githubApp));
  for (const event of DEFAULT_GITHUB_APP_EVENTS) {
    if (!events.has(event)) {
      throw new AppError("githubAppManifestConversionFailed", {
        details: { githubResponseStatus: null, reason: "missing_required_event", event },
      });
    }
  }
}

const INSTALLATION_REPAIR_MESSAGES: Record<GitHubInstallationRepairReason, string> = {
  installation_deleted:
    "GitHub App installation was deleted. Reinstall the app before launching Nanites.",
  installation_suspended:
    "GitHub App installation was suspended. Unsuspend or reinstall the app before launching Nanites.",
  installation_repositories_removed:
    "GitHub App repository access changed. Verify repository access again before launching Nanites.",
  installation_permissions_changed:
    "GitHub App permissions changed. Verify repository access again before launching Nanites.",
};

// ---------------------------------------------------------------------------
// Cloudflare API response schemas
// ---------------------------------------------------------------------------

const cloudflareMembershipSchema = z.object({
  account: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
  }),
});

const cloudflareAccountSubdomainSchema = z.object({
  subdomain: z.string().min(1),
});

const cloudflareScriptSubdomainSchema = z.object({
  enabled: z.boolean().optional(),
});

const cloudflareWorkerDomainSchema = z.object({
  hostname: z.string().min(1),
  service: z.string().min(1),
});

const cloudflareSubscriptionSchema = z.object({
  state: z.string().optional(),
  rate_plan: z
    .object({
      id: z.string().optional(),
      public_name: z.string().optional(),
      is_contract: z.boolean().optional(),
    })
    .optional(),
});

type CloudflareSubscription = z.output<typeof cloudflareSubscriptionSchema>;

const cloudflareAiGatewaySetupSchema = z.object({
  id: z.string().min(1),
  created: z.boolean(),
  retry_max_attempts: z.number().nullish(),
  retry_delay: z.number().nullish(),
  retry_backoff: z.enum(["constant", "linear", "exponential"]).nullish(),
  zdr: z.boolean().nullish(),
});

const WORKERS_PAID_RATE_PLAN_IDS = new Set([
  "workers_paid",
  "partners_workers_ent",
  "partners_workers_ss",
  "partners_workers_basic",
]);

function isWorkersPaidSubscription(subscription: CloudflareSubscription): boolean {
  const state = subscription.state?.trim().toLowerCase() ?? "";
  if (state !== "paid" && state !== "active" && state !== "provisioned") {
    return false;
  }

  const ratePlanId = subscription.rate_plan?.id?.trim().toLowerCase() ?? "";
  const publicName = subscription.rate_plan?.public_name?.trim().toLowerCase() ?? "";
  if (WORKERS_PAID_RATE_PLAN_IDS.has(ratePlanId)) {
    return true;
  }
  if (
    ratePlanId.includes("workers") &&
    !ratePlanId.includes("free") &&
    (ratePlanId.includes("paid") ||
      ratePlanId.includes("ent") ||
      ratePlanId.includes("ss") ||
      ratePlanId.includes("basic"))
  ) {
    return true;
  }

  return (
    subscription.rate_plan?.is_contract === true &&
    (ratePlanId.includes("workers") || publicName.includes("workers"))
  );
}

// ---------------------------------------------------------------------------
// MCP tool result parsing
// ---------------------------------------------------------------------------

function readToolText(result: unknown): string {
  const content =
    typeof result === "object" && result !== null && "content" in result
      ? (result as { content: unknown }).content
      : null;
  if (!Array.isArray(content)) {
    throw new Error("Cloudflare MCP tool returned no content.");
  }

  const textItem = content.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string",
  );
  if (!textItem) {
    throw new Error("Cloudflare MCP tool returned no text content.");
  }

  return textItem.text;
}

function parseToolJson(result: unknown): unknown {
  const text = readToolText(result);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

function cloudflareAllowsGitHubApp(cloudflare: NanitesSetupState["cloudflare"]): boolean {
  return cloudflare.status === "verified" && cloudflare.readiness.status === "ready";
}

function deriveCurrentStep(state: NanitesSetupState): SetupStep {
  if (state.setupComplete) {
    return "launch";
  }
  if (state.repositories.status === "complete") {
    return "launch";
  }
  if (state.githubApp.status === "complete") {
    return "repositories";
  }
  if (!cloudflareAllowsGitHubApp(state.cloudflare)) {
    return "cloudflare";
  }
  return "github-app";
}

function finalizeSetupState(state: NanitesSetupState): NanitesSetupState {
  return { ...state, currentStep: deriveCurrentStep(state) };
}

class CloudflareSetupOAuthProvider extends DurableObjectOAuthClientProvider {
  override get clientMetadata() {
    return {
      ...super.clientMetadata,
      scope: CLOUDFLARE_SETUP_OAUTH_SCOPE,
    };
  }
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class NanitesSetupAgent extends Agent<Env, NanitesSetupState> {
  initialState: NanitesSetupState = createInitialSetupState();

  override async onStart(): Promise<void> {
    if (this.state.version !== SETUP_STATE_VERSION) {
      this.setState(createInitialSetupState());
    }
    this.recoverInterruptedSteps();
    this.mcp.configureOAuthCallback({
      // The SDK types the handler as returning Response, but it awaits the
      // returned value, so an async handler works.
      customHandler: ((result: MCPClientOAuthResult) =>
        this.handleCloudflareOAuthCallback(result)) as unknown as (
        result: MCPClientOAuthResult,
      ) => Response,
    });
    this.mcp.onServerStateChanged(() => {
      this.syncCloudflareServerState();
    });
    await this.refresh();
  }

  override createMcpOAuthProvider(callbackUrl: string): CloudflareSetupOAuthProvider {
    return new CloudflareSetupOAuthProvider(this.ctx.storage, this.name, callbackUrl);
  }

  // -- Refresh ---------------------------------------------------------------

  async refresh(input: RefreshSetupInput = {}): Promise<NanitesSetupState> {
    const db = createDbClient(this.env.DB);
    // The wizard works with the singleton deployment GitHub App.
    const metadata = await readDeploymentGitHubAppMetadata(db);
    const runtimeConfigReadable =
      metadata !== null &&
      (input.runtimeConfigReadable === true ||
        (readAuthCookieSecret(this.env) !== null &&
          (await resolveGitHubApp(db, this.env, metadata.appId)) !== null));

    let githubApp: NanitesSetupState["githubApp"];
    let repositories: NanitesSetupState["repositories"];
    let connectedInstallation: ConnectedInstallation | null = null;
    if (metadata) {
      const installNonce = await this.ensureInstallNonce();
      const storedInstallation = await this.readConnectedInstallation();
      connectedInstallation =
        storedInstallation?.githubAppId === metadata.appId ? storedInstallation : null;
      if (storedInstallation && !connectedInstallation) {
        await this.ctx.storage.delete(CONNECTED_INSTALLATION_STORAGE_KEY);
      }
      const installedId =
        connectedInstallation !== null ? connectedInstallation.githubInstallationId : null;
      githubApp = {
        status: runtimeConfigReadable
          ? "complete"
          : Date.now() - metadata.configUpdatedAt.getTime() >= SECRET_PROPAGATION_STALL_AFTER_MS
            ? "stalled"
            : "propagating",
        appId: metadata.appId,
        slug: metadata.slug,
        htmlUrl: metadata.htmlUrl,
        ownerLogin: metadata.ownerLogin,
        installUrl: buildGitHubAppInstallHref({ appSlug: metadata.slug, state: installNonce }),
        orphanedAppUrl: null,
        error: null,
      };
      repositories = {
        status: !runtimeConfigReadable ? "locked" : installedId !== null ? "complete" : "ready",
        githubInstallationId: runtimeConfigReadable ? installedId : null,
        repositoryFullName:
          runtimeConfigReadable && connectedInstallation
            ? connectedInstallation.repositoryFullName
            : null,
        error: installedId !== null ? null : this.state.repositories.error,
      };
    } else {
      // No registered apps (e.g. a wiped deployment): any recorded selection
      // points at an app row that no longer exists.
      await this.ctx.storage.delete(CONNECTED_INSTALLATION_STORAGE_KEY);
      githubApp = {
        status:
          this.state.githubApp.status === "writing-secrets"
            ? "writing-secrets"
            : cloudflareAllowsGitHubApp(this.state.cloudflare)
              ? "ready"
              : "locked",
        appId: null,
        slug: null,
        htmlUrl: null,
        ownerLogin: null,
        installUrl: null,
        orphanedAppUrl: this.state.githubApp.orphanedAppUrl,
        error: this.state.githubApp.error,
      };
      repositories = {
        status: "locked",
        githubInstallationId: null,
        repositoryFullName: null,
        error: null,
      };
    }

    const next = finalizeSetupState({
      ...this.state,
      setupComplete: repositories.status === "complete",
      githubApp,
      repositories,
    });
    this.setState(next);

    if (next.githubApp.status === "complete") {
      // Setup no longer needs the Cloudflare API; stop holding its tokens.
      await this.removeCloudflareMcpServerIfPresent();
    } else if (next.githubApp.status === "propagating" && input.origin) {
      await this.schedule<{ origin: string }>(
        SECRET_PROPAGATION_CHECK_DELAY_SECONDS,
        "checkSecretPropagation",
        { origin: input.origin },
        { idempotent: true },
      );
    }

    return next;
  }

  /**
   * Scheduled while generated Worker secrets propagate. Fetching the public
   * setup status endpoint runs `refresh` in a fresh isolate whose `env` can
   * already see the new secrets; that refresh reschedules this check until the
   * config becomes readable or the propagation stalls.
   */
  async checkSecretPropagation(payload: { origin: string }): Promise<void> {
    if (this.state.githubApp.status !== "propagating") {
      return;
    }

    try {
      const response = await fetch(new URL("/api/setup/status", payload.origin), {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Setup status refresh failed with status ${response.status}.`);
      }
    } catch {
      await this.refresh({ origin: payload.origin });
    }
  }

  // -- Cloudflare ------------------------------------------------------------

  /**
   * Starts (or restarts) the Cloudflare MCP OAuth flow. Always tears down any
   * existing connection: the setup claim cookie is only issued when ownership
   * verification succeeds, so reconnecting is also the recovery path for a
   * browser that lost its claim.
   */
  async connectCloudflare(input: { readonly origin: string }): Promise<ConnectCloudflareResult> {
    try {
      const worker = resolveWorkerRoute(input.origin, this.env);
      if (!worker) {
        throw new Error(
          "This URL does not map to a deployed Cloudflare Worker, so ownership cannot be verified.",
        );
      }

      await this.removeCloudflareMcpServerIfPresent();
      this.setCloudflare({
        ...this.state.cloudflare,
        status: "authenticating",
        authorizationUrl: null,
        scriptName: worker.scriptName,
        readiness: { status: "checking", checkedAt: null, items: [] },
        error: null,
      });

      const added = await this.addMcpServer(CLOUDFLARE_MCP_SERVER_NAME, CLOUDFLARE_MCP_SERVER_URL, {
        id: CLOUDFLARE_MCP_SERVER_ID,
        callbackHost: worker.origin,
        callbackPath: CLOUDFLARE_MCP_CALLBACK_PATH,
      });
      if (added.state === "authenticating") {
        const state = this.setCloudflare({
          ...this.state.cloudflare,
          authorizationUrl: added.authUrl,
        });
        return { state, authorizationUrl: added.authUrl, claim: null };
      }

      // Persisted OAuth tokens let the connection come up without a redirect.
      await this.verifyCloudflareAccount(worker);
      return { state: this.state, authorizationUrl: null, claim: await this.issueSetupClaim() };
    } catch (error) {
      return {
        state: this.markCloudflareFailed(describeError(error)),
        authorizationUrl: null,
        claim: null,
      };
    }
  }

  private async handleCloudflareOAuthCallback(result: MCPClientOAuthResult): Promise<Response> {
    const { request } = getCurrentAgent<NanitesSetupAgent>();
    const origin = request ? new URL(request.url).origin : null;
    const redirectUrl = new URL("/setup", origin ?? "https://nanites.invalid");

    try {
      if (!result.authSuccess) {
        throw new Error(result.authError);
      }
      const worker = origin ? resolveWorkerRoute(origin, this.env) : null;
      if (!worker) {
        throw new Error("The OAuth callback did not arrive on a recognizable Worker URL.");
      }

      await this.mcp.waitForConnections({ timeout: CLOUDFLARE_MCP_TIMEOUT_MS });
      await this.verifyCloudflareAccount(worker);
      const claim = await this.issueSetupClaim();

      redirectUrl.searchParams.set("cloudflare", "connected");
      // Response.redirect() has immutable headers, which would drop Set-Cookie.
      const response = new Response(null, {
        status: 302,
        headers: { location: redirectUrl.href },
      });
      if (request) {
        response.headers.append("set-cookie", buildSetupClaimCookie(request, claim));
      }
      return response;
    } catch (error) {
      this.markCloudflareFailed(describeError(error));
      redirectUrl.searchParams.set("cloudflare", "failed");
      return Response.redirect(redirectUrl.href, 302);
    }
  }

  private syncCloudflareServerState(): void {
    const server = this.getMcpServers().servers[CLOUDFLARE_MCP_SERVER_ID];
    if (!server) {
      return;
    }
    if (server.state === "failed") {
      this.markCloudflareFailed(server.error ?? "Cloudflare MCP connection failed.");
      return;
    }
    if (
      server.state === "authenticating" &&
      this.state.cloudflare.status === "authenticating" &&
      server.auth_url &&
      server.auth_url !== this.state.cloudflare.authorizationUrl
    ) {
      this.setCloudflare({ ...this.state.cloudflare, authorizationUrl: server.auth_url });
    }
  }

  private async verifyCloudflareAccount(worker: WorkerRoute): Promise<void> {
    this.setCloudflare({
      ...this.state.cloudflare,
      status: "verifying",
      authorizationUrl: null,
      scriptName: worker.scriptName,
      readiness: { status: "checking", checkedAt: null, items: [] },
      error: null,
    });

    const memberships = z.array(cloudflareMembershipSchema).parse(
      await this.executeCloudflareCode({
        code: `async () => {
  const response = await cloudflare.request({ method: "GET", path: "/memberships" });
  return response.result;
}`,
      }),
    );

    for (const { account } of memberships) {
      if (!(await this.accountOwnsWorkerRoute(account.id, worker))) {
        continue;
      }

      const readiness = await this.checkCloudflareReadiness(account.id);
      this.setCloudflare({
        status: "verified",
        authorizationUrl: null,
        accountId: account.id,
        accountName: account.name ?? null,
        scriptName: worker.scriptName,
        readiness,
        error:
          readiness.items.find((item) => item.required && item.status === "blocked")?.detail ??
          null,
      });
      return;
    }

    throw new Error(
      `Cloudflare did not confirm that a connected account owns the Worker "${worker.scriptName}".`,
    );
  }

  private async accountOwnsWorkerRoute(accountId: string, worker: WorkerRoute): Promise<boolean> {
    try {
      if (worker.workersDevSubdomain) {
        const accountSubdomain = cloudflareAccountSubdomainSchema.parse(
          await this.executeCloudflareCode({
            accountId,
            code: `async () => {
  const response = await cloudflare.request({
    method: "GET",
    path: \`/accounts/\${accountId}/workers/subdomain\`,
  });
  return response.result;
}`,
          }),
        );
        if (accountSubdomain.subdomain.toLowerCase() !== worker.workersDevSubdomain) {
          return false;
        }

        const scriptSubdomain = cloudflareScriptSubdomainSchema.parse(
          await this.executeCloudflareCode({
            accountId,
            code: `async () => {
  const scriptName = ${JSON.stringify(worker.scriptName)};
  const response = await cloudflare.request({
    method: "GET",
    path: \`/accounts/\${accountId}/workers/scripts/\${scriptName}/subdomain\`,
  });
  return response.result;
}`,
          }),
        );
        return scriptSubdomain.enabled === true;
      }

      const domains = z.array(cloudflareWorkerDomainSchema).parse(
        await this.executeCloudflareCode({
          accountId,
          code: `async () => {
  const hostname = ${JSON.stringify(worker.hostname)};
  const service = ${JSON.stringify(worker.scriptName)};
  const params = new URLSearchParams({ hostname, service });
  const response = await cloudflare.request({
    method: "GET",
    path: \`/accounts/\${accountId}/workers/domains?\${params.toString()}\`,
  });
  return response.result;
}`,
        }),
      );
      return domains.some(
        (domain) =>
          domain.hostname.toLowerCase() === worker.hostname && domain.service === worker.scriptName,
      );
    } catch {
      return false;
    }
  }

  /**
   * Request-scoped statuses cannot survive a Durable Object restart: the
   * request that set them died with the previous instance, so finding one at
   * startup means the step was interrupted. Demote it to a retryable failure
   * instead of leaving the wizard on an eternal spinner. ("authenticating" is
   * exempt — it legitimately spans restarts while the user completes the
   * Cloudflare consent screen in another tab.)
   */
  private recoverInterruptedSteps(): void {
    if (this.state.cloudflare.status === "verifying") {
      this.markCloudflareFailed("Cloudflare verification was interrupted. Retry the connection.");
    }
    if (this.state.githubApp.status === "writing-secrets") {
      this.recordGitHubAppFailure(
        "GitHub App setup was interrupted while writing Worker secrets. Retry creating the app.",
        null,
      );
    }
  }

  private markCloudflareFailed(message: string): NanitesSetupState {
    return this.setCloudflare({
      ...this.state.cloudflare,
      status: "failed",
      authorizationUrl: null,
      readiness: { status: "unknown", checkedAt: null, items: [] },
      error: message,
    });
  }

  /**
   * Applies a Cloudflare update and recomputes the parts of the state that
   * depend on it without touching the database.
   */
  private setCloudflare(cloudflare: NanitesSetupState["cloudflare"]): NanitesSetupState {
    const githubApp =
      this.state.githubApp.status === "locked" || this.state.githubApp.status === "ready"
        ? {
            ...this.state.githubApp,
            status: cloudflareAllowsGitHubApp(cloudflare)
              ? ("ready" as const)
              : ("locked" as const),
          }
        : this.state.githubApp;
    const next = finalizeSetupState({ ...this.state, cloudflare, githubApp });
    this.setState(next);
    return next;
  }

  private async removeCloudflareMcpServerIfPresent(): Promise<void> {
    if (this.getMcpServers().servers[CLOUDFLARE_MCP_SERVER_ID]) {
      await this.removeMcpServer(CLOUDFLARE_MCP_SERVER_ID);
    }
  }

  // -- Cloudflare readiness ----------------------------------------------------

  private async checkCloudflareReadiness(accountId: string): Promise<CloudflareReadiness> {
    const items: CloudflareReadinessItem[] = [
      await this.checkWorkersPaid(accountId),
      await this.checkWorkerLoader(),
      this.checkWorkersAiBinding(),
      await this.checkAiGateway(accountId),
      this.checkBrowserBinding(),
    ];

    return {
      status: items.some((item) => item.required && item.status === "blocked")
        ? "blocked"
        : "ready",
      checkedAt: new Date().toISOString(),
      items,
    };
  }

  private async checkWorkersPaid(accountId: string): Promise<CloudflareReadinessItem> {
    const item = {
      key: "workers-paid" as const,
      label: "Workers Paid",
      required: true,
    };
    try {
      const subscriptions = z.array(cloudflareSubscriptionSchema).parse(
        await this.executeCloudflareCode({
          accountId,
          code: `async () => {
  const response = await cloudflare.request({
    method: "GET",
    path: \`/accounts/\${accountId}/subscriptions\`,
  });
  return response.result;
}`,
        }),
      );
      const workersPaid = subscriptions.find(isWorkersPaidSubscription);
      if (workersPaid) {
        return {
          ...item,
          status: "ready",
          detail: `${workersPaid.rate_plan?.public_name?.trim() || workersPaid.rate_plan?.id?.trim() || "Workers Paid"} is active on this account. Cloudflare bills Workers and Dynamic Workers directly to this account.`,
          action: null,
        };
      }

      return {
        ...item,
        status: "blocked",
        detail:
          "Workers Paid was not detected on this account. Add the Workers Paid plan in Cloudflare before launching Nanites; Dynamic Workers require it.",
        action: "configure",
      };
    } catch {
      return {
        ...item,
        status: "blocked",
        detail:
          "Billing Read did not return account subscriptions. Reconnect Cloudflare and grant Account > Billing > Read.",
        action: "reconnect",
      };
    }
  }

  private async checkWorkerLoader(): Promise<CloudflareReadinessItem> {
    const item = {
      key: "worker-loader" as const,
      label: "Worker Loader",
      required: true,
    };
    if (!this.env.LOADER || typeof this.env.LOADER.get !== "function") {
      return {
        ...item,
        status: "blocked",
        detail: "Worker Loader binding `LOADER` is missing from this deployment.",
        action: "retry",
      };
    }

    try {
      const worker = this.env.LOADER.get(READINESS_SMOKE_WORKER_KEY, () => ({
        compatibilityDate: "2026-06-10",
        compatibilityFlags: ["nodejs_compat"],
        mainModule: "index.js",
        modules: {
          "index.js": `export default {
  fetch() {
    return new Response(${JSON.stringify(READINESS_SMOKE_WORKER_RESPONSE)});
  },
};`,
        },
        globalOutbound: null,
      }));
      const response = await worker
        .getEntrypoint()
        .fetch(new Request("https://nanites.invalid/setup/readiness"));
      if (!response.ok || (await response.text()) !== READINESS_SMOKE_WORKER_RESPONSE) {
        throw new Error("Worker Loader smoke test returned an unexpected response.");
      }

      return {
        ...item,
        status: "ready",
        detail:
          "Worker Loader ran the setup smoke Worker. Generated trigger handlers can run as Dynamic Workers.",
        action: null,
      };
    } catch {
      return {
        ...item,
        status: "blocked",
        detail:
          "Worker Loader did not run the setup smoke Worker. Confirm this deployment has Worker Loader and Workers Paid enabled.",
        action: "retry",
      };
    }
  }

  private checkWorkersAiBinding(): CloudflareReadinessItem {
    const item = {
      key: "workers-ai" as const,
      label: "Workers AI",
      required: true,
    };
    const ai = this.env.AI as { models?: unknown; run?: unknown } | undefined;
    if (!ai || typeof ai.models !== "function" || typeof ai.run !== "function") {
      return {
        ...item,
        status: "blocked",
        detail: "Workers AI binding `AI` is missing from this deployment.",
        action: "retry",
      };
    }

    return {
      ...item,
      status: "ready",
      detail:
        "Workers AI binding `AI` is present. The default model is a third-party model id routed through the AI Gateway and billed via AI Gateway Unified Billing, so ensure your account has credits loaded (no provider API key required).",
      action: null,
    };
  }

  private async checkAiGateway(accountId: string): Promise<CloudflareReadinessItem> {
    const item = {
      key: "ai-gateway",
      label: "AI Gateway",
      required: true,
    } as const;
    const gatewayId = NANITES_AI_GATEWAY_ID;
    const modelId = DEFAULT_SIGVELO_AGENT_MODEL_ID;
    const gatewayDefaults = NANITES_AI_GATEWAY_REQUEST_DEFAULTS;

    try {
      const gateway = cloudflareAiGatewaySetupSchema.parse(
        await this.executeCloudflareCode({
          accountId,
          code: `async () => {
  const gatewayId = ${JSON.stringify(gatewayId)};
  const defaults = ${JSON.stringify({
    retry_max_attempts: gatewayDefaults.maxAttempts,
    retry_delay: gatewayDefaults.retryDelayMs,
    retry_backoff: gatewayDefaults.backoff,
    zdr: gatewayDefaults.zdr,
  })};
  const gatewayPath = \`/accounts/\${accountId}/ai-gateway/gateways\`;

  function readBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function readNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  const listParams = new URLSearchParams({ search: gatewayId, per_page: "100" });
  const listResponse = await cloudflare.request({
    method: "GET",
    path: \`\${gatewayPath}?\${listParams.toString()}\`,
  });
  if (!listResponse.success) {
    throw new Error(\`AI Gateway list failed (\${listResponse.status}): \${JSON.stringify(listResponse.errors)}\`);
  }

  const gateways = Array.isArray(listResponse.result) ? listResponse.result : [];
  const existing = gateways.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      candidate.id === gatewayId,
  );

  const gatewayConfig = existing
    ? {
        id: gatewayId,
        authentication: true,
        cache_invalidate_on_update: readBoolean(existing.cache_invalidate_on_update, true),
        cache_ttl: readNumber(existing.cache_ttl, 0),
        collect_logs: readBoolean(existing.collect_logs, true),
        rate_limiting_interval: readNumber(existing.rate_limiting_interval, 0),
        rate_limiting_limit: readNumber(existing.rate_limiting_limit, 0),
        retry_max_attempts: defaults.retry_max_attempts,
        retry_delay: defaults.retry_delay,
        retry_backoff: defaults.retry_backoff,
        zdr: defaults.zdr || readBoolean(existing.zdr, false),
      }
    : {
        id: gatewayId,
        authentication: true,
        cache_invalidate_on_update: true,
        cache_ttl: 0,
        collect_logs: true,
        rate_limiting_interval: 0,
        rate_limiting_limit: 0,
        retry_max_attempts: defaults.retry_max_attempts,
        retry_delay: defaults.retry_delay,
        retry_backoff: defaults.retry_backoff,
        zdr: defaults.zdr,
      };

  const response = await cloudflare.request({
    method: existing ? "PUT" : "POST",
    path: existing
      ? \`\${gatewayPath}/\${encodeURIComponent(gatewayId)}\`
      : gatewayPath,
    body: gatewayConfig,
  });
  if (!response.success) {
    throw new Error(\`AI Gateway \${existing ? "update" : "create"} failed (\${response.status}): \${JSON.stringify(response.errors)}\`);
  }

  return {
    ...response.result,
    created: !existing,
  };
}`,
        }),
      );
      const configuredMaxAttempts = gateway.retry_max_attempts ?? gatewayDefaults.maxAttempts;
      const configuredRetryDelay = gateway.retry_delay ?? gatewayDefaults.retryDelayMs;
      const configuredBackoff = gateway.retry_backoff ?? gatewayDefaults.backoff;
      const zdrDetail =
        gateway.zdr === true
          ? "ZDR is enabled on the gateway."
          : "ZDR is not enabled; set `zdr: true` in NANITES_AI_GATEWAY_REQUEST_DEFAULTS and redeploy to request it.";

      return {
        ...item,
        status: "ready",
        detail: `${gateway.created ? "Created" : "Configured"} Cloudflare AI Gateway \`${gateway.id}\` for default model \`${modelId}\`. Retry policy is ${configuredMaxAttempts} attempts, ${configuredRetryDelay}ms delay, ${configuredBackoff} backoff. ${zdrDetail}`,
        action: null,
      };
    } catch {
      return {
        ...item,
        status: "blocked",
        detail:
          "AI Gateway setup failed. Reconnect Cloudflare and grant AI Gateway Read/Write, or create the configured gateway manually before continuing.",
        action: "reconnect",
      };
    }
  }

  private checkBrowserBinding(): CloudflareReadinessItem {
    const item = {
      key: "browser" as const,
      label: "Browser Run",
      required: false,
    };
    const browser = this.env.BROWSER as { fetch?: unknown } | undefined;
    if (browser && typeof browser.fetch === "function") {
      return {
        ...item,
        status: "ready",
        detail: "Browser Run binding `BROWSER` is present for later preview verification.",
        action: null,
      };
    }

    return {
      ...item,
      status: "warning",
      detail:
        "Browser Run binding `BROWSER` was not detected. Setup can continue, but preview verification may be limited.",
      action: "retry",
    };
  }

  // -- GitHub App ------------------------------------------------------------

  async startGitHubApp(input: StartGitHubAppInput): Promise<StartGitHubAppResult> {
    if (!(await this.verifySetupClaim(input.claimToken))) {
      return { ok: false, errorKind: "setupClaimRequired" };
    }
    if (!cloudflareAllowsGitHubApp(this.state.cloudflare)) {
      return { ok: false, errorKind: "cloudflareReadinessRequired" };
    }
    if (this.state.githubApp.status !== "ready") {
      return { ok: false, errorKind: "invalidSetupState" };
    }
    if ((await readDeploymentGitHubAppMetadata(createDbClient(this.env.DB))) !== null) {
      return { ok: false, errorKind: "invalidSetupState" };
    }
    const manifestState = randomToken(SETUP_TOKEN_BYTE_LENGTH);
    await this.ctx.storage.put(MANIFEST_NONCE_STORAGE_KEY, {
      state: manifestState,
      expiresAt: new Date(Date.now() + MANIFEST_NONCE_TTL_MS).toISOString(),
    } satisfies z.infer<typeof manifestNonceSchema>);
    if (this.state.githubApp.error) {
      this.setState(
        finalizeSetupState({
          ...this.state,
          githubApp: { ...this.state.githubApp, error: null },
        }),
      );
    }

    return {
      ok: true,
      action: "https://github.com/settings/apps/new",
      manifest: buildGitHubAppManifest(new URL(input.origin).origin, manifestState),
      state: manifestState,
    };
  }

  async completeGitHubAppManifest(
    input: CompleteGitHubAppManifestInput,
  ): Promise<CompleteGitHubAppManifestResult> {
    if (!(await this.verifySetupClaim(input.claimToken))) {
      return { ok: false, errorKind: "setupClaimRequired" };
    }
    const manifestNonce = manifestNonceSchema.safeParse(
      await this.ctx.storage.get(MANIFEST_NONCE_STORAGE_KEY),
    );
    if (
      !manifestNonce.success ||
      manifestNonce.data.state !== input.state ||
      Date.parse(manifestNonce.data.expiresAt) <= Date.now()
    ) {
      return { ok: false, errorKind: "invalidSetupState" };
    }
    await this.ctx.storage.delete(MANIFEST_NONCE_STORAGE_KEY);

    const { accountId, scriptName } = this.state.cloudflare;
    if (this.state.cloudflare.status !== "verified" || !accountId || !scriptName) {
      return { ok: false, errorKind: "invalidSetupState" };
    }
    const db = createDbClient(this.env.DB);
    if ((await readDeploymentGitHubAppMetadata(db)) !== null) {
      return { ok: false, errorKind: "invalidSetupState" };
    }

    this.setState(
      finalizeSetupState({
        ...this.state,
        githubApp: { ...this.state.githubApp, status: "writing-secrets", error: null },
      }),
    );

    let convertedApp: GitHubAppManifestConversion | null = null;
    try {
      const githubApp = await convertGitHubAppManifestCode(input.code);
      convertedApp = githubApp;
      requireManifestMeetsMinimums(githubApp);
      const appSlug = requireManifestString(githubApp, "slug");
      // GitHub returns the manifest "pem" in PKCS#1, which the WebCrypto JWT
      // signing in @octokit/auth-app rejects — store it as PKCS#8.
      const privateKey = normalizeGitHubAppPrivateKeyToPkcs8(
        requireManifestString(githubApp, "pem"),
      );
      const secretBindings = buildGitHubAppSecretBindings(githubApp.id);
      // Reject a conflicting deployment app before writing Worker secrets, so a
      // late insert-time rejection in registerGitHubApp never orphans this
      // app's GITHUB_APP_<id>_* bindings on the Worker. registerGitHubApp
      // re-checks at commit time as the authoritative guard.
      await assertDeploymentGitHubAppRegistrable(db, githubApp.id);
      await this.writeWorkerSecrets({
        accountId,
        scriptName,
        secrets: {
          // The cookie secret is deployment-wide; rotating it on every app
          // registration would invalidate live sessions, so only seed it once.
          ...(readAuthCookieSecret(this.env)
            ? {}
            : { [AUTH_COOKIE_SECRET_BINDING]: randomToken(AUTH_COOKIE_SECRET_BYTE_LENGTH) }),
          [secretBindings.privateKeyBinding]: privateKey,
          [secretBindings.clientSecretBinding]: requireManifestString(githubApp, "client_secret"),
          [secretBindings.webhookSecretBinding]: requireManifestString(githubApp, "webhook_secret"),
        },
      });

      const owner = githubApp.owner;
      await registerGitHubApp(db, {
        appId: githubApp.id,
        slug: appSlug,
        htmlUrl: githubApp.html_url,
        setupOrigin: input.origin,
        ownerLogin: owner && "login" in owner ? owner.login : null,
        ownerType: owner && "type" in owner ? owner.type : null,
        clientId: requireManifestString(githubApp, "client_id"),
        permissions: readManifestPermissions(githubApp),
        events: readManifestEvents(githubApp),
      });
      // A new app invalidates any earlier install URL.
      const installNonce = randomToken(SETUP_TOKEN_BYTE_LENGTH);
      await this.ctx.storage.put(INSTALL_NONCE_STORAGE_KEY, installNonce);

      const state = await this.refresh({ origin: input.origin });
      return {
        ok: true,
        installUrl: buildGitHubAppInstallHref({ appSlug, state: installNonce }),
        deploymentConfigured: state.githubApp.status === "complete",
      };
    } catch (error) {
      this.recordGitHubAppFailure(describeError(error), convertedApp?.html_url ?? null);
      if (
        error instanceof AppError &&
        (error.kind === "githubAppManifestConversionFailed" ||
          error.kind === "cloudflareWorkerSecretWriteFailed")
      ) {
        return { ok: false, errorKind: error.kind };
      }
      throw error;
    }
  }

  private recordGitHubAppFailure(message: string, orphanedAppUrl: string | null): void {
    this.setState(
      finalizeSetupState({
        ...this.state,
        githubApp: {
          ...this.state.githubApp,
          status: cloudflareAllowsGitHubApp(this.state.cloudflare) ? "ready" : "locked",
          orphanedAppUrl: orphanedAppUrl ?? this.state.githubApp.orphanedAppUrl,
          error: message,
        },
      }),
    );
  }

  private async writeWorkerSecrets(input: {
    readonly accountId: string;
    readonly scriptName: string;
    readonly secrets: Record<string, string>;
  }): Promise<void> {
    const secretPatch: Record<string, { name: string; text: string; type: "secret_text" }> = {};
    for (const [name, text] of Object.entries(input.secrets)) {
      secretPatch[name] = { name, text, type: "secret_text" };
    }

    try {
      // The MCP execute sandbox's cloudflare.request has no `headers` option —
      // unknown options are silently ignored, so the merge-patch content type
      // must be set via `contentType` or the secrets-bulk endpoint rejects the
      // request as application/json.
      await this.executeCloudflareCode({
        accountId: input.accountId,
        code: `async () => {
  const scriptName = ${JSON.stringify(input.scriptName)};
  const response = await cloudflare.request({
    method: "PATCH",
    path: \`/accounts/\${accountId}/workers/scripts/\${scriptName}/secrets-bulk\`,
    contentType: "application/merge-patch+json",
    body: ${JSON.stringify({ secrets: secretPatch })},
  });
  if (!response.success) {
    throw new Error(\`secrets-bulk failed (\${response.status}): \${JSON.stringify(response.errors)}\`);
  }
  return response.result ?? { ok: true };
}`,
      });
    } catch (error) {
      throw new AppError("cloudflareWorkerSecretWriteFailed", { cause: error });
    }
  }

  // -- Repositories ------------------------------------------------------------

  async recordRepositoryInstall(
    input: RecordRepositoryInstallInput,
  ): Promise<RecordRepositoryInstallResult> {
    if (!(await this.verifySetupClaim(input.claimToken)) && input.runtimeConfigReadable !== true) {
      return { ok: false, errorKind: "setupClaimRequired" };
    }

    const current = await this.refresh({ runtimeConfigReadable: input.runtimeConfigReadable });
    if (current.githubApp.status !== "complete") {
      return { ok: false, errorKind: "invalidSetupState" };
    }
    const installNonce = await this.ctx.storage.get(INSTALL_NONCE_STORAGE_KEY);
    if (
      typeof installNonce !== "string" ||
      !input.installState ||
      input.installState !== installNonce
    ) {
      return { ok: false, errorKind: "installStateMismatch" };
    }

    if (current.githubApp.appId === null) {
      return { ok: false, errorKind: "invalidSetupState" };
    }
    const repositoryFullName = input.repositoryFullName.trim();
    if (!repositoryFullName) {
      return { ok: false, errorKind: "invalidSetupState" };
    }

    await this.ctx.storage.put(CONNECTED_INSTALLATION_STORAGE_KEY, {
      githubAppId: current.githubApp.appId,
      githubInstallationId: input.githubInstallationId,
      repositoryFullName,
    } satisfies ConnectedInstallation);
    const next = finalizeSetupState({
      ...this.state,
      setupComplete: true,
      repositories: {
        status: "complete",
        githubInstallationId: input.githubInstallationId,
        repositoryFullName,
        error: null,
      },
    });
    this.setState(next);
    return { ok: true, state: next };
  }

  async recordInstallationRepair(input: {
    readonly githubAppId: number;
    readonly githubInstallationId: number;
    readonly reason: GitHubInstallationRepairReason;
  }): Promise<NanitesSetupState> {
    const current = await this.refresh();
    const connectedInstallation = await this.readConnectedInstallation();
    if (
      connectedInstallation?.githubAppId !== input.githubAppId ||
      connectedInstallation.githubInstallationId !== input.githubInstallationId ||
      current.repositories.githubInstallationId !== input.githubInstallationId
    ) {
      return current;
    }

    await this.ctx.storage.delete(CONNECTED_INSTALLATION_STORAGE_KEY);
    await this.ctx.storage.put(INSTALL_NONCE_STORAGE_KEY, randomToken(SETUP_TOKEN_BYTE_LENGTH));
    this.setState({
      ...this.state,
      repositories: {
        ...this.state.repositories,
        error: INSTALLATION_REPAIR_MESSAGES[input.reason],
      },
    });
    return await this.refresh();
  }

  private async readConnectedInstallation(): Promise<ConnectedInstallation | null> {
    const raw = await this.ctx.storage.get(CONNECTED_INSTALLATION_STORAGE_KEY);
    const stored = connectedInstallationSchema.safeParse(raw);
    if (!stored.success && raw !== undefined) {
      await this.ctx.storage.delete(CONNECTED_INSTALLATION_STORAGE_KEY);
    }
    return stored.success ? stored.data : null;
  }

  // -- Upstream star -----------------------------------------------------------

  async recordUpstreamStar(input: RecordUpstreamStarInput): Promise<NanitesSetupState> {
    const next = finalizeSetupState({
      ...this.state,
      upstreamStar: { starred: input.starred, error: input.error ?? null },
    });
    this.setState(next);
    return next;
  }

  // -- Setup claim ---------------------------------------------------------------

  async issueSetupClaim(): Promise<SetupClaim> {
    const token = randomToken(SETUP_TOKEN_BYTE_LENGTH);
    const expiresAt = new Date(Date.now() + SETUP_CLAIM_TTL_MS).toISOString();
    await this.ctx.storage.put(SETUP_CLAIM_STORAGE_KEY, {
      tokenHash: await sha256Base64Url(token),
      expiresAt,
    } satisfies z.infer<typeof storedSetupTokenSchema>);
    return { token, expiresAt };
  }

  private async verifySetupClaim(claimToken: string | null | undefined): Promise<boolean> {
    if (!claimToken) {
      return false;
    }
    const stored = storedSetupTokenSchema.safeParse(
      await this.ctx.storage.get(SETUP_CLAIM_STORAGE_KEY),
    );
    if (!stored.success) {
      return false;
    }
    if (Date.parse(stored.data.expiresAt) <= Date.now()) {
      await this.ctx.storage.delete(SETUP_CLAIM_STORAGE_KEY);
      return false;
    }
    return (await sha256Base64Url(claimToken)) === stored.data.tokenHash;
  }

  // -- Install nonce ---------------------------------------------------------------

  private async ensureInstallNonce(): Promise<string> {
    const existing = await this.ctx.storage.get(INSTALL_NONCE_STORAGE_KEY);
    if (typeof existing === "string" && existing.length > 0) {
      return existing;
    }

    const nonce = randomToken(SETUP_TOKEN_BYTE_LENGTH);
    await this.ctx.storage.put(INSTALL_NONCE_STORAGE_KEY, nonce);
    return nonce;
  }

  // -- Cloudflare MCP execute ------------------------------------------------------

  private async executeCloudflareCode(input: {
    readonly code: string;
    readonly accountId?: string;
  }): Promise<unknown> {
    const result = await this.mcp.callTool(
      {
        serverId: CLOUDFLARE_MCP_SERVER_ID,
        name: "execute",
        arguments: input.accountId
          ? { code: input.code, account_id: input.accountId }
          : { code: input.code },
      },
      undefined,
      { timeout: CLOUDFLARE_MCP_TIMEOUT_MS },
    );

    if ("isError" in result && result.isError) {
      let toolError: string;
      try {
        toolError = readToolText(result);
      } catch {
        toolError = "unreadable tool error content";
      }
      setupLogger.error("Cloudflare MCP execute failed: {toolError}", { toolError });
      throw new Error(`Cloudflare API call failed: ${toolError}`);
    }

    return parseToolJson(result);
  }
}
