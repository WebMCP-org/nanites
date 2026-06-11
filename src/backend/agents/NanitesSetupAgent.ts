import {
  Agent,
  DurableObjectOAuthClientProvider,
  callable,
  getCurrentAgent,
  type Connection,
  type ConnectionContext,
} from "agents";
import type { MCPClientOAuthResult } from "agents/mcp/client";
import { getLogger } from "@logtape/logtape";
import { generateCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { z } from "zod";
import { createDbClient } from "#/backend/db/index.ts";
import { AppError } from "#/backend/errors.ts";
import {
  AUTH_COOKIE_SECRET_BINDING,
  GITHUB_APP_PRIVATE_KEY_BINDING,
  GITHUB_CLIENT_SECRET_BINDING,
  GITHUB_WEBHOOK_SECRET_BINDING,
  readDeploymentGitHubAppConfig,
  readDeploymentGitHubAppMetadata,
  requireDeploymentGitHubAppConfigTableReady,
  saveDeploymentGitHubAppConfig,
  saveDeploymentGitHubAppSelectedInstallation,
} from "#/backend/github/app-config.ts";
import {
  convertGitHubAppManifestCode,
  type GitHubAppManifestConversion,
} from "#/backend/github/index.ts";
import { normalizeGitHubAppPrivateKeyToPkcs8 } from "#/backend/github/private-key.ts";
import {
  DEFAULT_SIGVELO_AGENT_MODEL_ID,
  resolveNanitesAiGatewayId,
} from "#/backend/nanites/language-model.ts";
import { LOGGING } from "#/backend/logging.ts";
import { GITHUB_WEBHOOK_PATH, buildGitHubAppInstallHref } from "#/github.ts";
import { GITHUB_OAUTH_CALLBACK_PATH } from "#/auth.ts";
import { NANITES_SETUP_AGENT_INSTANCE_NAME, NANITES_SETUP_AGENT_NAME } from "#/nanites.ts";

const setupAgentLogger = getLogger(LOGGING.NANITES_CATEGORY).getChild("setup");

const CLOUDFLARE_API_MCP_SERVER_ID = "cloudflare-api";
const CLOUDFLARE_API_MCP_SERVER_NAME = "Cloudflare API";
const CLOUDFLARE_API_MCP_SERVER_URL = "https://mcp.cloudflare.com/mcp";
const CLOUDFLARE_MCP_CALLBACK_PATH = `/agents/${NANITES_SETUP_AGENT_NAME}/${NANITES_SETUP_AGENT_INSTANCE_NAME}/callback`;
const GITHUB_APP_MANIFEST_CALLBACK_PATH = "/setup/github/manifest/callback";
const GITHUB_APP_INSTALL_CALLBACK_PATH = "/setup/github/installed";
const GENERATED_AUTH_SECRET_BYTE_LENGTH = 48;
const SETUP_OWNER_TOKEN_BYTE_LENGTH = 32;
const SETUP_OWNER_TTL_MS = 60 * 60 * 1_000;
const SETUP_OWNER_STORAGE_KEY = "nanites:setup:owner";
const SETUP_CLAIM_TOKEN_BYTE_LENGTH = 32;
const SETUP_CLAIM_TTL_MS = 60 * 60 * 1_000;
const SETUP_CLAIM_STORAGE_KEY = "nanites:setup:claim";
const CLOUDFLARE_MCP_EXECUTE_TIMEOUT_MS = 15 * 60 * 1_000;
const CLOUDFLARE_SETUP_OAUTH_SCOPE =
  "offline_access user:read account:read billing:read workers:read workers_scripts:write";
const CLOUDFLARE_READINESS_WORKER_CACHE_KEY = "nanites-setup-readiness";
const CLOUDFLARE_READINESS_WORKER_RESPONSE = "nanites-readiness-ok";
const GITHUB_APP_SECRET_PROPAGATION_RETRY_AFTER_MS = 2 * 60 * 1_000;
const GITHUB_APP_SECRET_PROPAGATION_CHECK_DELAY_SECONDS = 2;
const SETUP_CLAIM_COOKIE_PATH = "/";
const SETUP_CLAIM_COOKIE_SAME_SITE = "lax";

export const SETUP_CLAIM_COOKIE_NAME = "nanites_setup_claim";

const DEFAULT_GITHUB_APP_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  actions: "read",
  issues: "write",
  starring: "write",
} as const;

const DEFAULT_GITHUB_APP_EVENTS = [
  "push",
  "pull_request",
  "issue_comment",
  "pull_request_review_comment",
  "workflow_run",
] as const;

const cloudflareAccountMembershipSchema = z.object({
  account: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
  }),
});

const cloudflareWorkersAccountSubdomainSchema = z.object({
  subdomain: z.string().min(1),
});

const cloudflareWorkerSubdomainSchema = z.object({
  enabled: z.boolean().optional(),
});

const cloudflareWorkerDomainSchema = z.object({
  hostname: z.string().min(1),
  service: z.string().min(1),
});

const cloudflareAccountSubscriptionSchema = z.object({
  id: z.string().optional(),
  state: z.string().optional(),
  rate_plan: z
    .object({
      id: z.string().optional(),
      public_name: z.string().optional(),
      is_contract: z.boolean().optional(),
    })
    .optional(),
});

const storedSetupTokenSchema = z.object({
  tokenHash: z.string().min(1),
  expiresAt: z.string().min(1),
});

const setupConnectionStateSchema = z
  .object({
    setupClaimTokenHash: z.string().min(1).optional(),
    setupClaimExpiresAt: z.string().min(1).optional(),
  })
  .strict();

type StoredSetupToken = z.infer<typeof storedSetupTokenSchema>;
type SetupConnectionState = z.infer<typeof setupConnectionStateSchema>;
export type SetupStep =
  | "deploy"
  | "cloudflare"
  | "github-app"
  | "repositories"
  | "upstream-star"
  | "launch";
type SetupCurrentStepOverride = {
  readonly step: SetupStep;
  readonly baseStep: SetupStep;
};
type CloudflareSetupStatus =
  | "idle"
  | "authenticating"
  | "connecting"
  | "verifying"
  | "verified"
  | "failed";
export type CloudflareReadinessItemKey =
  | "worker-ownership"
  | "workers-paid"
  | "worker-loader"
  | "workers-ai"
  | "kimi-k2"
  | "ai-gateway"
  | "browser-run";
export type CloudflareReadinessItemStatus =
  | "pending"
  | "checking"
  | "ready"
  | "blocked"
  | "warning";
export type CloudflareReadinessSeverity = "required" | "informational";
export type CloudflareReadinessAction = "reconnect" | "configure" | "retry";
export type CloudflareReadinessItem = {
  readonly key: CloudflareReadinessItemKey;
  readonly status: CloudflareReadinessItemStatus;
  readonly severity: CloudflareReadinessSeverity;
  readonly label: string;
  readonly detail: string;
  readonly action: CloudflareReadinessAction | null;
};
export type CloudflareReadinessStatus = "pending" | "checking" | "ready" | "blocked";
export type CloudflareReadinessState = {
  readonly status: CloudflareReadinessStatus;
  readonly checkedAt: string | null;
  readonly items: readonly CloudflareReadinessItem[];
};
type SetupOwnerStatus = "unclaimed" | "claimed";
type GitHubAppSetupStatus =
  | "locked"
  | "ready"
  | "creating"
  | "secrets-writing"
  | "secrets-propagating"
  | "secrets-propagation-stalled"
  | "complete"
  | "failed";
type RepositorySetupStatus = "locked" | "ready" | "complete" | "failed";
type UpstreamStarSetupStatus = "locked" | "ready" | "complete" | "failed";
type LaunchSetupStatus = "locked" | "ready";
type GitHubManifestOwnerType = "user" | "organization";
type CurrentWorkerRoute = {
  readonly origin: string;
  readonly hostname: string;
  readonly scriptName: string;
  readonly workersDevSubdomain: string | null;
};
type SetupCompletionState = {
  readonly setupComplete: boolean;
  readonly repositories: NanitesSetupAgentState["repositories"];
  readonly upstreamStar: NanitesSetupAgentState["upstreamStar"];
  readonly launch: NanitesSetupAgentState["launch"];
};
type CloudflareAccountSubscription = z.output<typeof cloudflareAccountSubscriptionSchema>;
export type GitHubInstallationRepairReason =
  | "installation_deleted"
  | "installation_suspended"
  | "installation_repositories_removed"
  | "installation_permissions_changed";

export type NanitesSetupAgentState = {
  readonly setupComplete: boolean;
  readonly currentStep: SetupStep;
  readonly currentStepOverride: SetupCurrentStepOverride | null;
  readonly setupOwner: {
    readonly status: SetupOwnerStatus;
    readonly claimExpiresAt: string | null;
  };
  readonly deployment: {
    readonly status: "complete";
  };
  readonly cloudflare: {
    readonly status: CloudflareSetupStatus;
    readonly authorizationUrl: string | null;
    readonly accountId: string | null;
    readonly accountName: string | null;
    readonly scriptName: string | null;
    readonly readiness: CloudflareReadinessState;
    readonly error: string | null;
    readonly connectedAt: string | null;
  };
  readonly githubApp: {
    readonly status: GitHubAppSetupStatus;
    readonly manifestState: string | null;
    readonly manifestSetupClaimHash: string | null;
    readonly manifestSetupClaimExpiresAt: string | null;
    readonly generationKey: string | null;
    readonly slug: string | null;
    readonly htmlUrl: string | null;
    readonly installUrl: string | null;
    readonly ownerLogin: string | null;
    readonly ownerType: string | null;
    readonly orphanedHtmlUrl: string | null;
    readonly cleanupInstructions: string | null;
    readonly error: string | null;
  };
  readonly repositories: {
    readonly status: RepositorySetupStatus;
    readonly githubInstallationId: number | null;
    readonly githubAppGenerationKey: string | null;
    readonly installState: string | null;
    readonly error: string | null;
  };
  readonly upstreamStar: {
    readonly status: UpstreamStarSetupStatus;
    readonly verifiedAt: string | null;
    readonly error: string | null;
  };
  readonly launch: {
    readonly status: LaunchSetupStatus;
  };
  readonly error: {
    readonly step: SetupStep;
    readonly message: string;
  } | null;
  readonly updatedAt: string | null;
};

export type RefreshSetupInput = {
  readonly origin?: string;
  readonly deploymentGitHubAppConfigReadable?: boolean;
};

export type CheckGitHubSecretPropagationInput = {
  readonly origin: string;
};

export type ConnectCloudflareInput = {
  readonly origin?: string;
  readonly setupOwnerToken?: string | null;
  readonly forceReconnect?: boolean;
} | null;

export type ConnectCloudflareOutput = {
  readonly state: NanitesSetupAgentState;
  readonly authorizationUrl: string | null;
  readonly setupOwnerClaimRequired?: boolean;
};

export type ClaimSetupOwnerInput = {
  readonly setupOwnerToken?: string | null;
} | null;

export type ClaimSetupOwnerOutput = {
  readonly state: NanitesSetupAgentState;
  readonly claimed: boolean;
  readonly setupOwnerToken: string | null;
  readonly expiresAt: string | null;
};

export type ResetSetupOwnerInput = {
  readonly setupOwnerToken?: string | null;
} | null;

export type ShowSetupStepInput = {
  readonly step: SetupStep;
} | null;

export type StartGitHubManifestInput = {
  readonly origin?: string;
  readonly ownerType: GitHubManifestOwnerType;
  readonly ownerLogin?: string | null;
  readonly setupClaimToken?: string | null;
};

export type StartGitHubManifestOutput = {
  readonly action: string;
  readonly manifest: unknown;
  readonly state: string;
};

export type CompleteGitHubManifestInput = {
  readonly code: string;
  readonly state: string;
  readonly origin: string;
  readonly setupClaimToken: string;
};

export type CompleteGitHubManifestCallbackOutput =
  | {
      readonly ok: true;
      readonly installUrl: string;
      readonly deploymentConfigured: boolean;
      readonly setupComplete: boolean;
    }
  | {
      readonly ok: false;
      readonly errorKind:
        | "invalidSetupState"
        | "setupOwnerProofRequired"
        | "setupClaimRequired"
        | "cloudflareOAuthFailed"
        | "cloudflareReadinessRequired"
        | "cloudflareWorkerSecretWriteFailed"
        | "githubAppManifestConversionFailed";
    };

export type RecordRepositoryInstallInput = {
  readonly githubInstallationId: number;
  readonly setupClaimToken?: string | null;
  readonly installState?: string | null;
  readonly deploymentGitHubAppConfigReadable?: boolean;
};

export type RecordGitHubInstallationRepairInput = {
  readonly githubInstallationId: number;
  readonly reason: GitHubInstallationRepairReason;
};

export type IssueSetupClaimOutput = {
  readonly claimToken: string;
  readonly expiresAt: string;
};

export function createInitialNanitesSetupState(): NanitesSetupAgentState {
  return {
    setupComplete: false,
    currentStep: "cloudflare",
    currentStepOverride: null,
    setupOwner: {
      status: "unclaimed",
      claimExpiresAt: null,
    },
    deployment: {
      status: "complete",
    },
    cloudflare: {
      status: "idle",
      authorizationUrl: null,
      accountId: null,
      accountName: null,
      scriptName: null,
      readiness: createInitialCloudflareReadinessState(),
      error: null,
      connectedAt: null,
    },
    githubApp: {
      status: "locked",
      manifestState: null,
      manifestSetupClaimHash: null,
      manifestSetupClaimExpiresAt: null,
      generationKey: null,
      slug: null,
      htmlUrl: null,
      installUrl: null,
      ownerLogin: null,
      ownerType: null,
      orphanedHtmlUrl: null,
      cleanupInstructions: null,
      error: null,
    },
    repositories: {
      status: "locked",
      githubInstallationId: null,
      githubAppGenerationKey: null,
      installState: null,
      error: null,
    },
    upstreamStar: {
      status: "locked",
      verifiedAt: null,
      error: null,
    },
    launch: {
      status: "locked",
    },
    error: null,
    updatedAt: null,
  };
}

const cloudflareReadinessItemDefaults = {
  "worker-ownership": {
    severity: "required",
    label: "Worker ownership",
    detail: "Connect the Cloudflare account that owns this deployed Worker.",
    action: null,
  },
  "workers-paid": {
    severity: "required",
    label: "Workers Paid",
    detail: "Nanites needs Workers Paid because Dynamic Workers run generated trigger code.",
    action: "configure",
  },
  "worker-loader": {
    severity: "required",
    label: "Worker Loader",
    detail: "Worker Loader runs generated trigger handlers in isolated Dynamic Workers.",
    action: "retry",
  },
  "workers-ai": {
    severity: "required",
    label: "Workers AI",
    detail: "Workers AI provides the default Cloudflare-hosted model binding.",
    action: "retry",
  },
  "kimi-k2": {
    severity: "required",
    label: "Kimi K2.6",
    detail: "The default model is Cloudflare-hosted Kimi K2.6 with function calling.",
    action: "retry",
  },
  "ai-gateway": {
    severity: "informational",
    label: "AI Gateway",
    detail: "Default model requests route through Cloudflare AI Gateway.",
    action: null,
  },
  "browser-run": {
    severity: "informational",
    label: "Browser Run",
    detail: "Browser Run supports later preview verification flows.",
    action: null,
  },
} as const satisfies Record<
  CloudflareReadinessItemKey,
  {
    readonly severity: CloudflareReadinessSeverity;
    readonly label: string;
    readonly detail: string;
    readonly action: CloudflareReadinessAction | null;
  }
>;

const cloudflareReadinessItemKeys = [
  "worker-ownership",
  "workers-paid",
  "worker-loader",
  "workers-ai",
  "kimi-k2",
  "ai-gateway",
  "browser-run",
] as const satisfies readonly CloudflareReadinessItemKey[];

function createCloudflareReadinessItem(
  key: CloudflareReadinessItemKey,
  status: CloudflareReadinessItemStatus,
  detail: string = cloudflareReadinessItemDefaults[key].detail,
  action: CloudflareReadinessAction | null = cloudflareReadinessItemDefaults[key].action,
): CloudflareReadinessItem {
  const defaults = cloudflareReadinessItemDefaults[key];
  return {
    key,
    status,
    severity: defaults.severity,
    label: defaults.label,
    detail,
    action,
  };
}

function createInitialCloudflareReadinessState(): CloudflareReadinessState {
  return createCloudflareReadinessState(
    cloudflareReadinessItemKeys.map((key) => createCloudflareReadinessItem(key, "pending")),
    null,
  );
}

function createCheckingCloudflareReadinessState(): CloudflareReadinessState {
  return createCloudflareReadinessState(
    cloudflareReadinessItemKeys.map((key) => createCloudflareReadinessItem(key, "checking")),
    null,
  );
}

function createCloudflareReadinessState(
  items: readonly CloudflareReadinessItem[],
  checkedAt: string | null = new Date().toISOString(),
): CloudflareReadinessState {
  const requiredItems = items.filter((item) => item.severity === "required");
  const status: CloudflareReadinessStatus = requiredItems.some((item) => item.status === "blocked")
    ? "blocked"
    : items.some((item) => item.status === "checking")
      ? "checking"
      : requiredItems.some((item) => item.status === "pending")
        ? "pending"
        : "ready";

  return { status, checkedAt, items };
}

function cloudflareReadinessAllowsGitHubApp(
  cloudflare: NanitesSetupAgentState["cloudflare"],
): boolean {
  return cloudflare.status === "verified" && cloudflare.readiness.status === "ready";
}

function firstCloudflareReadinessBlocker(
  readiness: CloudflareReadinessState,
): CloudflareReadinessItem | null {
  return (
    readiness.items.find((item) => item.severity === "required" && item.status === "blocked") ??
    null
  );
}

function cloudflareReadinessNeedsReconnect(readiness: CloudflareReadinessState): boolean {
  return readiness.items.some((item) => item.status === "blocked" && item.action === "reconnect");
}

function buildCloudflareReadinessError(readiness: CloudflareReadinessState): string | null {
  return firstCloudflareReadinessBlocker(readiness)?.detail ?? null;
}

const LEGACY_KIMI_MODEL_CATALOG_BLOCKER_DETAIL =
  "Cloudflare Workers AI did not list Kimi K2.6 for this account.";
const LEGACY_KIMI_MODEL_CATALOG_READY_DETAIL =
  "Cloudflare Workers AI lists Kimi K2.6 with function calling. No Moonshot or provider API key is required for the default model.";
const KIMI_MODEL_CONFIGURED_DETAIL = `Default model \`${DEFAULT_SIGVELO_AGENT_MODEL_ID}\` is configured through Workers AI. No Moonshot or provider API key is required.`;
const setupStepOrder = [
  "deploy",
  "cloudflare",
  "github-app",
  "repositories",
  "upstream-star",
  "launch",
] as const satisfies readonly SetupStep[];

function normalizeCloudflareStateForCurrentVersion(
  cloudflare: NanitesSetupAgentState["cloudflare"],
): NanitesSetupAgentState["cloudflare"] {
  if (cloudflare.status !== "verified") {
    return cloudflare;
  }

  const workersAiReady = cloudflare.readiness.items.some(
    (item) => item.key === "workers-ai" && item.status === "ready",
  );
  const hasLegacyKimiCatalogState = cloudflare.readiness.items.some(
    (item) =>
      item.key === "kimi-k2" &&
      ((item.status === "blocked" && item.detail === LEGACY_KIMI_MODEL_CATALOG_BLOCKER_DETAIL) ||
        (item.status === "ready" && item.detail === LEGACY_KIMI_MODEL_CATALOG_READY_DETAIL)),
  );
  if (!workersAiReady || !hasLegacyKimiCatalogState) {
    return cloudflare;
  }

  const readiness = createCloudflareReadinessState(
    cloudflare.readiness.items.map((item) =>
      item.key === "kimi-k2"
        ? createCloudflareReadinessItem("kimi-k2", "ready", KIMI_MODEL_CONFIGURED_DETAIL, null)
        : item,
    ),
  );

  return {
    ...cloudflare,
    readiness,
    error: buildCloudflareReadinessError(readiness),
  };
}

function cleanLower(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

const workersPaidRatePlanIds = new Set([
  "workers_paid",
  "partners_workers_ent",
  "partners_workers_ss",
  "partners_workers_basic",
]);

function isActiveCloudflareSubscription(subscription: CloudflareAccountSubscription): boolean {
  const state = cleanLower(subscription.state);
  return state === "paid" || state === "active" || state === "provisioned";
}

function isWorkersPaidSubscription(subscription: CloudflareAccountSubscription): boolean {
  if (!isActiveCloudflareSubscription(subscription)) {
    return false;
  }

  const ratePlan = subscription.rate_plan;
  const ratePlanId = cleanLower(ratePlan?.id);
  const publicName = cleanLower(ratePlan?.public_name);
  if (workersPaidRatePlanIds.has(ratePlanId)) {
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
    ratePlan?.is_contract === true &&
    (ratePlanId.includes("workers") || publicName.includes("workers"))
  );
}

function describeCloudflareWorkersSubscription(
  subscription: CloudflareAccountSubscription,
): string {
  return (
    subscription.rate_plan?.public_name?.trim() ||
    subscription.rate_plan?.id?.trim() ||
    "Workers Paid"
  );
}

function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function readNonEmptyEnvValue(env: Env, key: keyof Env): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readCookieToken(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValueParts] = part.split("=");
    if (rawKey?.trim() !== name) {
      continue;
    }

    const value = rawValueParts.join("=").trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }

  return null;
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function buildSetupClaimCookieOptions(request: Request, expiresAt: string): CookieOptions {
  return {
    path: SETUP_CLAIM_COOKIE_PATH,
    httpOnly: true,
    sameSite: SETUP_CLAIM_COOKIE_SAME_SITE,
    secure: isSecureRequest(request),
    expires: new Date(expiresAt),
  };
}

function buildExpiredSetupClaimCookieOptions(request: Request): CookieOptions {
  return {
    path: SETUP_CLAIM_COOKIE_PATH,
    httpOnly: true,
    sameSite: SETUP_CLAIM_COOKIE_SAME_SITE,
    secure: isSecureRequest(request),
    expires: new Date(0),
    maxAge: 0,
  };
}

function buildSetupClaimCookie(request: Request, claim: IssueSetupClaimOutput): string {
  return generateCookie(
    SETUP_CLAIM_COOKIE_NAME,
    claim.claimToken,
    buildSetupClaimCookieOptions(request, claim.expiresAt),
  );
}

export function buildExpiredSetupClaimCookie(request: Request): string {
  return generateCookie(SETUP_CLAIM_COOKIE_NAME, "", buildExpiredSetupClaimCookieOptions(request));
}

function readCurrentWorkerRoute(origin: string, env: Env): CurrentWorkerRoute | null {
  const configured = readNonEmptyEnvValue(env, "NANITES_CLOUDFLARE_SCRIPT_NAME");
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();
  let scriptName = configured;
  let workersDevSubdomain: string | null = null;

  if (hostname.endsWith(".workers.dev")) {
    const labels = hostname.slice(0, -".workers.dev".length).split(".").filter(Boolean);
    if (labels.length >= 2) {
      const workerSubdomain = labels[0] ?? null;
      if (configured && workerSubdomain !== configured) {
        return null;
      }
      scriptName ??= workerSubdomain;
      workersDevSubdomain = labels.slice(1).join(".");
    }
  }

  if (!scriptName) {
    return null;
  }

  return {
    origin: url.origin,
    hostname,
    scriptName,
    workersDevSubdomain,
  };
}

function buildGitHubManifestCallbackUrl(origin: string): string {
  return new URL(GITHUB_APP_MANIFEST_CALLBACK_PATH, origin).toString();
}

function buildGitHubSetupUrl(origin: string): string {
  return new URL(GITHUB_APP_INSTALL_CALLBACK_PATH, origin).toString();
}

function buildGitHubOAuthCallbackUrl(origin: string): string {
  return new URL(GITHUB_OAUTH_CALLBACK_PATH, origin).toString();
}

function buildGitHubAppName(manifestState: string): string {
  const suffix = manifestState
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
  return `Nanites ${suffix}`;
}

function buildGitHubAppGenerationKey(appId: number): string {
  return `github-app:${appId}`;
}

function buildInFlightGitHubAppGenerationKey(manifestState: string): string {
  return `manifest:${manifestState}`;
}

function buildOrphanedGitHubAppCleanupInstructions(htmlUrl: string): string {
  return `GitHub created an app before setup failed. Delete the unused app at ${htmlUrl} before retrying if you do not want an orphaned Nanites app.`;
}

function buildGitHubInstallationRepairMessage(reason: GitHubInstallationRepairReason): string {
  switch (reason) {
    case "installation_deleted":
      return "GitHub App installation was deleted. Reinstall the app before launching Nanites.";
    case "installation_suspended":
      return "GitHub App installation was suspended. Unsuspend or reinstall the app before launching Nanites.";
    case "installation_repositories_removed":
      return "GitHub App repository access changed. Verify repository access again before launching Nanites.";
    case "installation_permissions_changed":
      return "GitHub App permissions changed. Verify repository access again before launching Nanites.";
  }
}

function buildGitHubAppManifest(origin: string, manifestState: string) {
  return {
    name: buildGitHubAppName(manifestState),
    url: origin,
    description: "Self-hosted durable agents for GitHub repository maintenance.",
    public: false,
    redirect_url: buildGitHubManifestCallbackUrl(origin),
    callback_urls: [buildGitHubOAuthCallbackUrl(origin)],
    setup_url: buildGitHubSetupUrl(origin),
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

function buildGitHubManifestAction(input: StartGitHubManifestInput): string {
  if (input.ownerType === "organization") {
    const ownerLogin = input.ownerLogin?.trim();
    if (!ownerLogin) {
      throw new AppError("invalidSetupState");
    }
    return `https://github.com/organizations/${encodeURIComponent(ownerLogin)}/settings/apps/new`;
  }

  return "https://github.com/settings/apps/new";
}

function buildCurrentStep(state: NanitesSetupAgentState): SetupStep {
  if (state.setupComplete) {
    return "launch";
  }
  if (state.githubApp.status === "complete" && state.repositories.status !== "complete") {
    return "repositories";
  }
  if (!cloudflareReadinessAllowsGitHubApp(state.cloudflare)) {
    return "cloudflare";
  }
  if (state.githubApp.status !== "complete") {
    return "github-app";
  }
  if (state.repositories.status !== "complete") {
    return "repositories";
  }
  return "launch";
}

function setupStepIndex(step: SetupStep): number {
  return setupStepOrder.indexOf(step);
}

function isSetupStep(value: unknown): value is SetupStep {
  return typeof value === "string" && setupStepOrder.includes(value as SetupStep);
}

function canUseCurrentStepOverride(step: SetupStep, baseStep: SetupStep): boolean {
  return setupStepIndex(step) < setupStepIndex(baseStep);
}

function clearCurrentStepOverride(state: NanitesSetupAgentState): NanitesSetupAgentState {
  return state.currentStepOverride ? { ...state, currentStepOverride: null } : state;
}

function createSetupCompletionState(input: {
  readonly hasRuntimeConfig: boolean;
  readonly githubAppGenerationKey: string | null;
  readonly repositories: NanitesSetupAgentState["repositories"];
  readonly upstreamStar: NanitesSetupAgentState["upstreamStar"];
}): SetupCompletionState {
  const repositoryInstalled =
    input.repositories.githubInstallationId !== null &&
    input.repositories.githubAppGenerationKey !== null &&
    input.repositories.githubAppGenerationKey === input.githubAppGenerationKey;
  const upstreamStarComplete = input.upstreamStar.status === "complete";
  const upstreamStarReady = input.hasRuntimeConfig && repositoryInstalled;
  // The upstream star is optional: offer it once repositories are installed,
  // but never gate launch on it.
  const setupComplete = upstreamStarReady;
  const upstreamStar: NanitesSetupAgentState["upstreamStar"] =
    upstreamStarReady && upstreamStarComplete
      ? input.upstreamStar
      : upstreamStarReady
        ? {
            status: input.upstreamStar.status === "failed" ? "failed" : "ready",
            verifiedAt: null,
            error: input.upstreamStar.status === "failed" ? input.upstreamStar.error : null,
          }
        : {
            status: "locked" as const,
            verifiedAt: null,
            error: null,
          };

  return {
    setupComplete,
    repositories: {
      status: input.hasRuntimeConfig ? (repositoryInstalled ? "complete" : "ready") : "locked",
      githubInstallationId: repositoryInstalled ? input.repositories.githubInstallationId : null,
      githubAppGenerationKey: input.repositories.githubAppGenerationKey,
      installState: input.repositories.installState,
      error: null,
    },
    upstreamStar,
    launch: {
      status: setupComplete ? "ready" : "locked",
    },
  };
}

function buildGitHubAppSetupStatus(input: {
  readonly hasRuntimeConfig: boolean;
  readonly metadataUpdatedAt: Date | null;
}): GitHubAppSetupStatus {
  if (input.hasRuntimeConfig) {
    return "complete";
  }
  if (
    input.metadataUpdatedAt &&
    Date.now() - input.metadataUpdatedAt.getTime() >= GITHUB_APP_SECRET_PROPAGATION_RETRY_AFTER_MS
  ) {
    return "secrets-propagation-stalled";
  }
  return "secrets-propagating";
}

function buildRepositoryStateForGitHubAppGeneration(
  repositories: NanitesSetupAgentState["repositories"],
  githubAppGenerationKey: string | null,
  selectedGithubInstallationId: number | null,
): NanitesSetupAgentState["repositories"] {
  if (!githubAppGenerationKey) {
    return {
      status: "locked",
      githubInstallationId: null,
      githubAppGenerationKey: null,
      installState: null,
      error: null,
    };
  }

  if (selectedGithubInstallationId !== null) {
    return {
      status: "complete",
      githubInstallationId: selectedGithubInstallationId,
      githubAppGenerationKey,
      installState: repositories.installState ?? randomBase64Url(),
      error: null,
    };
  }

  if (repositories.githubAppGenerationKey === githubAppGenerationKey) {
    return repositories.installState
      ? repositories
      : {
          ...repositories,
          installState: randomBase64Url(),
        };
  }

  return {
    status: "locked",
    githubInstallationId: null,
    githubAppGenerationKey,
    installState: randomBase64Url(),
    error: null,
  };
}

function buildUnconfiguredGitHubAppState(
  state: NanitesSetupAgentState,
): NanitesSetupAgentState["githubApp"] {
  const manifestClaimExpiresAt = state.githubApp.manifestSetupClaimExpiresAt
    ? Date.parse(state.githubApp.manifestSetupClaimExpiresAt)
    : NaN;
  const manifestInFlight =
    state.githubApp.status === "creating" &&
    state.githubApp.manifestState !== null &&
    Number.isFinite(manifestClaimExpiresAt) &&
    manifestClaimExpiresAt > Date.now();
  const failed = state.githubApp.status === "failed";

  return {
    status: manifestInFlight
      ? "creating"
      : failed
        ? "failed"
        : cloudflareReadinessAllowsGitHubApp(state.cloudflare)
          ? "ready"
          : "locked",
    manifestState: manifestInFlight ? state.githubApp.manifestState : null,
    manifestSetupClaimHash: manifestInFlight ? state.githubApp.manifestSetupClaimHash : null,
    manifestSetupClaimExpiresAt: manifestInFlight
      ? state.githubApp.manifestSetupClaimExpiresAt
      : null,
    generationKey: manifestInFlight ? state.githubApp.generationKey : null,
    slug: null,
    htmlUrl: null,
    installUrl: null,
    ownerLogin: null,
    ownerType: null,
    orphanedHtmlUrl: failed ? state.githubApp.orphanedHtmlUrl : null,
    cleanupInstructions: failed ? state.githubApp.cleanupInstructions : null,
    error: failed ? state.githubApp.error : null,
  };
}

function buildSetupOwnerState(
  setupOwner: StoredSetupToken | null,
): NanitesSetupAgentState["setupOwner"] {
  return setupOwner
    ? {
        status: "claimed",
        claimExpiresAt: setupOwner.expiresAt,
      }
    : {
        status: "unclaimed",
        claimExpiresAt: null,
      };
}

function withDerivedState(state: NanitesSetupAgentState): NanitesSetupAgentState {
  const stateMachineStep = buildCurrentStep(state);
  const currentStepOverride =
    state.currentStepOverride &&
    state.currentStepOverride.baseStep === stateMachineStep &&
    canUseCurrentStepOverride(state.currentStepOverride.step, stateMachineStep)
      ? state.currentStepOverride
      : null;

  return {
    ...state,
    currentStep: currentStepOverride?.step ?? stateMachineStep,
    currentStepOverride,
    updatedAt: new Date().toISOString(),
  };
}

function readToolText(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) {
    throw new AppError("cloudflareOAuthFailed", { details: { reason: "missing_mcp_content" } });
  }
  const content = (result as { content: unknown }).content;
  if (!Array.isArray(content)) {
    throw new AppError("cloudflareOAuthFailed", { details: { reason: "invalid_mcp_content" } });
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
    throw new AppError("cloudflareOAuthFailed", { details: { reason: "missing_mcp_text" } });
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

function generateAuthCookieSecret(): string {
  return randomBase64Url(GENERATED_AUTH_SECRET_BYTE_LENGTH);
}

function githubPermissionRank(permission: string | undefined): number {
  switch (permission) {
    case "read":
      return 1;
    case "write":
      return 2;
    case "admin":
      return 3;
    default:
      return 0;
  }
}

function requireGitHubAppManifestString(
  githubApp: GitHubAppManifestConversion,
  field: "client_id" | "client_secret" | "pem" | "slug" | "webhook_secret",
): string {
  const value = githubApp[field];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new AppError("githubAppManifestConversionFailed", {
    details: {
      githubResponseStatus: null,
      reason: "missing_required_field",
      field,
    },
  });
}

function readGitHubAppManifestPermissions(
  permissions: GitHubAppManifestConversion["permissions"],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [permission, access] of Object.entries(permissions ?? {})) {
    if (typeof access === "string") {
      result[permission] = access;
    }
  }
  return result;
}

function readGitHubAppManifestEvents(
  events: GitHubAppManifestConversion["events"],
): readonly string[] {
  return Array.isArray(events)
    ? events.filter((event): event is string => typeof event === "string")
    : [];
}

function readGitHubAppManifestOwnerLogin(
  owner: GitHubAppManifestConversion["owner"],
): string | null {
  return owner && "login" in owner ? owner.login : null;
}

function readGitHubAppManifestOwnerType(
  owner: GitHubAppManifestConversion["owner"],
): string | null {
  return owner && "type" in owner ? owner.type : null;
}

function requireGitHubAppManifestMeetsMinimums(githubApp: GitHubAppManifestConversion): void {
  const permissions = readGitHubAppManifestPermissions(githubApp.permissions);
  for (const [permission, requiredAccess] of Object.entries(DEFAULT_GITHUB_APP_PERMISSIONS)) {
    const actualAccess = permissions[permission];
    if (githubPermissionRank(actualAccess) < githubPermissionRank(requiredAccess)) {
      throw new AppError("githubAppManifestConversionFailed", {
        details: {
          githubResponseStatus: null,
          reason: "missing_required_permission",
          permission,
        },
      });
    }
  }

  const returnedEvents = new Set(readGitHubAppManifestEvents(githubApp.events));
  for (const event of DEFAULT_GITHUB_APP_EVENTS) {
    if (!returnedEvents.has(event)) {
      throw new AppError("githubAppManifestConversionFailed", {
        details: {
          githubResponseStatus: null,
          reason: "missing_required_event",
          event,
        },
      });
    }
  }
}

function createCloudflareSetupError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError("cloudflareOAuthFailed", {
        details: { reason: error instanceof Error ? error.message : "unknown_error" },
      });
}

function isExpectedCloudflareAuthorizationUrl(authorizationUrl: string): boolean {
  try {
    const url = new URL(authorizationUrl);
    return url.searchParams.get("scope") === CLOUDFLARE_SETUP_OAUTH_SCOPE;
  } catch {
    return false;
  }
}

function readCurrentAgentOrigin(): string | null {
  const { request, connection } = getCurrentAgent<NanitesSetupAgent>();
  if (request) {
    return new URL(request.url).origin;
  }
  if (connection?.uri) {
    return new URL(connection.uri).origin;
  }

  return null;
}

function readSetupOrigin(fallbackOrigin: string | null | undefined): string | null {
  const currentOrigin = readCurrentAgentOrigin();
  if (currentOrigin) {
    return currentOrigin;
  }
  if (!fallbackOrigin) {
    return null;
  }

  return new URL(fallbackOrigin).origin;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(createError());
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

class CloudflareSetupOAuthProvider extends DurableObjectOAuthClientProvider {
  override get clientMetadata() {
    return {
      ...super.clientMetadata,
      scope: CLOUDFLARE_SETUP_OAUTH_SCOPE,
    };
  }
}

export class NanitesSetupAgent extends Agent<Env, NanitesSetupAgentState> {
  initialState: NanitesSetupAgentState = createInitialNanitesSetupState();

  override async onStart(): Promise<void> {
    this.mcp.configureOAuthCallback({
      customHandler: ((result: MCPClientOAuthResult) =>
        this.handleCloudflareMcpOAuthCallback(result)) as unknown as (
        result: MCPClientOAuthResult,
      ) => Response,
    });
    this.mcp.onServerStateChanged(() => {
      this.syncCloudflareMcpState().catch((error: unknown) => {
        this.markCloudflareFailed(createCloudflareSetupError(error).message);
      });
    });
    await this.refresh();
  }

  async onRequest(_request: Request): Promise<Response> {
    return Response.json(await this.refresh({ origin: new URL(_request.url).origin }));
  }

  override async onConnect(
    connection: Connection<SetupConnectionState>,
    context: ConnectionContext,
  ): Promise<void> {
    await this.refresh({ origin: new URL(context.request.url).origin });

    const setupClaimToken = readCookieToken(
      context.request.headers.get("cookie"),
      SETUP_CLAIM_COOKIE_NAME,
    );
    if (!setupClaimToken) {
      return;
    }

    const storedClaim = await this.readStoredSetupClaim();
    if (!storedClaim || Date.parse(storedClaim.expiresAt) <= Date.now()) {
      await this.clearSetupClaim();
      return;
    }
    if ((await sha256Base64Url(setupClaimToken)) !== storedClaim.tokenHash) {
      return;
    }

    connection.setState({
      ...setupConnectionStateSchema.parse(connection.state ?? {}),
      setupClaimExpiresAt: storedClaim.expiresAt,
      setupClaimTokenHash: storedClaim.tokenHash,
    });
  }

  override createMcpOAuthProvider(callbackUrl: string): CloudflareSetupOAuthProvider {
    return new CloudflareSetupOAuthProvider(this.ctx.storage, this.name, callbackUrl);
  }

  private async handleCloudflareMcpOAuthCallback(result: MCPClientOAuthResult): Promise<Response> {
    const { request } = getCurrentAgent<NanitesSetupAgent>();
    const origin = request ? new URL(request.url).origin : "https://nanites.invalid";
    const redirectUrl = new URL("/setup", origin);

    if (!result.authSuccess) {
      this.markCloudflareFailed(result.authError);
      redirectUrl.searchParams.set("cloudflare", "failed");
      return Response.redirect(redirectUrl.href, 302);
    }

    try {
      await this.mcp.waitForConnections({ timeout: CLOUDFLARE_MCP_EXECUTE_TIMEOUT_MS });
      const currentWorker = readCurrentWorkerRoute(origin, this.env);
      if (!currentWorker) {
        throw new AppError("cloudflareWorkerOwnershipVerificationFailed", {
          details: { scriptName: "unknown" },
        });
      }

      await this.verifyCloudflareWorkerOwnershipOrFail(currentWorker);
      const claim = await this.issueSetupClaim();
      redirectUrl.searchParams.set("cloudflare", "connected");
      // Response.redirect() returns immutable headers, which would make the
      // Set-Cookie append below throw and silently drop the setup claim.
      const response = new Response(null, {
        status: 302,
        headers: { Location: redirectUrl.href },
      });
      if (request) {
        response.headers.append("Set-Cookie", buildSetupClaimCookie(request, claim));
      }
      return response;
    } catch (error) {
      const setupError = createCloudflareSetupError(error);
      this.markCloudflareFailed(setupError.message);
      redirectUrl.searchParams.set("cloudflare", "failed");
      return Response.redirect(redirectUrl.href, 302);
    }
  }

  async refresh(input: RefreshSetupInput | null = null): Promise<NanitesSetupAgentState> {
    const db = createDbClient(this.env.DB);
    const setupOwner = await this.readActiveStoredSetupOwnerClaim();
    const metadata = await readDeploymentGitHubAppMetadata(db);
    const runtimeConfig = await readDeploymentGitHubAppConfig(db, this.env);
    const githubApp = runtimeConfig ?? metadata;
    const cloudflare = normalizeCloudflareStateForCurrentVersion(this.state.cloudflare);
    const stateForDerivation = {
      ...this.state,
      cloudflare,
      error:
        this.state.error?.step === "cloudflare"
          ? cloudflare.error
            ? { step: "cloudflare" as const, message: cloudflare.error }
            : null
          : this.state.error,
    };
    const hasRuntimeConfig =
      runtimeConfig !== null || input?.deploymentGitHubAppConfigReadable === true;
    const githubAppGenerationKey = githubApp ? buildGitHubAppGenerationKey(githubApp.appId) : null;
    const repositoriesForGeneration = buildRepositoryStateForGitHubAppGeneration(
      stateForDerivation.repositories,
      githubAppGenerationKey,
      githubApp?.selectedGithubInstallationId ?? null,
    );
    const completionState = createSetupCompletionState({
      hasRuntimeConfig,
      githubAppGenerationKey,
      repositories: repositoriesForGeneration,
      upstreamStar: stateForDerivation.upstreamStar,
    });
    const installUrl = githubApp
      ? buildGitHubAppInstallHref({
          appSlug: githubApp.slug,
          state: completionState.repositories.installState,
        })
      : null;
    const githubAppStatus = githubApp
      ? buildGitHubAppSetupStatus({
          hasRuntimeConfig,
          metadataUpdatedAt: metadata?.configUpdatedAt ?? null,
        })
      : null;
    const nextState = withDerivedState({
      ...stateForDerivation,
      setupComplete: completionState.setupComplete,
      setupOwner: buildSetupOwnerState(setupOwner),
      githubApp: githubApp
        ? {
            ...stateForDerivation.githubApp,
            status: githubAppStatus ?? "secrets-propagating",
            slug: githubApp.slug,
            manifestState: null,
            manifestSetupClaimHash: null,
            manifestSetupClaimExpiresAt: null,
            generationKey: githubAppGenerationKey,
            htmlUrl: githubApp.htmlUrl,
            installUrl,
            ownerLogin: githubApp.ownerLogin,
            ownerType: githubApp.ownerType,
            orphanedHtmlUrl: null,
            cleanupInstructions: null,
            error: null,
          }
        : {
            ...buildUnconfiguredGitHubAppState(stateForDerivation),
          },
      repositories: completionState.repositories,
      upstreamStar: completionState.upstreamStar,
      launch: completionState.launch,
    });
    this.setState(nextState);
    if (hasRuntimeConfig) {
      await this.removeCloudflareMcpServerIfPresent();
    } else if (nextState.githubApp.status === "secrets-propagating" && input?.origin) {
      await this.scheduleGitHubSecretPropagationCheck(input.origin);
    }
    return nextState;
  }

  async checkGitHubSecretPropagation(
    input: CheckGitHubSecretPropagationInput,
  ): Promise<NanitesSetupAgentState> {
    if (this.state.githubApp.status !== "secrets-propagating") {
      return this.state;
    }

    try {
      const response = await fetch(new URL("/api/setup/status", input.origin), {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("setup_status_refresh_failed");
      }

      const refreshedState = (await response.json()) as NanitesSetupAgentState;
      if (refreshedState.githubApp.status === "secrets-propagating") {
        await this.scheduleGitHubSecretPropagationCheck(input.origin, { idempotent: false });
      }
      return refreshedState;
    } catch {
      const refreshedState = await this.refresh({ origin: input.origin });
      if (refreshedState.githubApp.status === "secrets-propagating") {
        await this.scheduleGitHubSecretPropagationCheck(input.origin, { idempotent: false });
      }
      return refreshedState;
    }
  }

  @callable()
  async claimSetupOwner(input: ClaimSetupOwnerInput = null): Promise<ClaimSetupOwnerOutput> {
    const providedToken = input?.setupOwnerToken ?? null;
    const activeOwner = await this.readActiveStoredSetupOwnerClaim();

    if (activeOwner) {
      if (!providedToken || (await sha256Base64Url(providedToken)) !== activeOwner.tokenHash) {
        return {
          state: await this.refresh(),
          claimed: false,
          setupOwnerToken: null,
          expiresAt: activeOwner.expiresAt,
        };
      }

      const state = withDerivedState({
        ...this.state,
        setupOwner: buildSetupOwnerState(activeOwner),
      });
      this.setState(state);
      return {
        state,
        claimed: true,
        setupOwnerToken: providedToken,
        expiresAt: activeOwner.expiresAt,
      };
    }

    const setupOwnerToken = randomBase64Url(SETUP_OWNER_TOKEN_BYTE_LENGTH);
    const ownerClaim = {
      tokenHash: await sha256Base64Url(setupOwnerToken),
      expiresAt: new Date(Date.now() + SETUP_OWNER_TTL_MS).toISOString(),
    } satisfies StoredSetupToken;
    await this.ctx.storage.put(SETUP_OWNER_STORAGE_KEY, ownerClaim);

    const state = withDerivedState({
      ...this.state,
      setupOwner: buildSetupOwnerState(ownerClaim),
      error: null,
    });
    this.setState(state);

    return {
      state,
      claimed: true,
      setupOwnerToken,
      expiresAt: ownerClaim.expiresAt,
    };
  }

  @callable()
  async resetSetupOwner(input: ResetSetupOwnerInput = null): Promise<NanitesSetupAgentState> {
    const providedToken = input?.setupOwnerToken ?? null;
    const activeOwner = await this.readActiveStoredSetupOwnerClaim();
    if (
      activeOwner &&
      this.state.setupOwner.status !== "unclaimed" &&
      (!providedToken || (await sha256Base64Url(providedToken)) !== activeOwner.tokenHash)
    ) {
      return await this.refresh();
    }

    await this.ctx.storage.delete(SETUP_OWNER_STORAGE_KEY);
    if (this.state.cloudflare.status !== "verified") {
      await this.removeCloudflareMcpServerIfPresent();
    }

    const initialState = createInitialNanitesSetupState();
    const shouldResetCloudflare = this.state.cloudflare.status !== "verified";
    const nextState = withDerivedState({
      ...this.state,
      setupOwner: buildSetupOwnerState(null),
      cloudflare: shouldResetCloudflare ? initialState.cloudflare : this.state.cloudflare,
      githubApp:
        shouldResetCloudflare && this.state.githubApp.status !== "complete"
          ? initialState.githubApp
          : this.state.githubApp,
      error:
        shouldResetCloudflare && this.state.error?.step === "cloudflare" ? null : this.state.error,
    });
    this.setState(nextState);
    return await this.refresh();
  }

  @callable()
  async showSetupStep(input: ShowSetupStepInput = null): Promise<NanitesSetupAgentState> {
    const requestedStep = input?.step;
    if (!isSetupStep(requestedStep)) {
      throw new AppError("invalidSetupState");
    }

    const stateMachineStep = buildCurrentStep(this.state);
    if (requestedStep === stateMachineStep) {
      const nextState = withDerivedState(clearCurrentStepOverride(this.state));
      this.setState(nextState);
      return nextState;
    }

    if (this.state.currentStepOverride) {
      return this.state;
    }

    if (!canUseCurrentStepOverride(requestedStep, stateMachineStep)) {
      return this.state;
    }

    const nextState = withDerivedState({
      ...this.state,
      currentStepOverride: {
        step: requestedStep,
        baseStep: stateMachineStep,
      },
    });
    this.setState(nextState);
    return nextState;
  }

  @callable()
  async connectCloudflare(input: ConnectCloudflareInput = null): Promise<ConnectCloudflareOutput> {
    try {
      return await this.connectCloudflareOrFail(input);
    } catch (error) {
      this.markCloudflareFailed(createCloudflareSetupError(error).message);
      return { state: this.state, authorizationUrl: null };
    }
  }

  @callable()
  async startGitHubManifest(input: StartGitHubManifestInput): Promise<StartGitHubManifestOutput> {
    try {
      return await this.startGitHubManifestOrFail(input);
    } catch (error) {
      const setupError =
        error instanceof AppError ? error : new AppError("invalidSetupState", { cause: error });
      if (setupError.kind === "cloudflareReadinessRequired") {
        const reason =
          typeof setupError.details?.reason === "string"
            ? setupError.details.reason
            : setupError.message;
        this.setState(
          withDerivedState({
            ...clearCurrentStepOverride(this.state),
            cloudflare: {
              ...this.state.cloudflare,
              error: reason,
            },
            error: {
              step: "cloudflare",
              message: setupError.message,
            },
          }),
        );
        throw setupError;
      }
      this.markGitHubAppFailed(setupError.message);
      throw setupError;
    }
  }

  private async connectCloudflareOrFail(
    input: ConnectCloudflareInput,
  ): Promise<ConnectCloudflareOutput> {
    const origin = readSetupOrigin(input?.origin);
    const currentWorker = origin ? readCurrentWorkerRoute(origin, this.env) : null;
    if (!currentWorker) {
      throw new AppError("cloudflareWorkerOwnershipVerificationFailed", {
        details: { scriptName: "unknown" },
      });
    }
    if (!(await this.setupOwnerClaimAllowsMutation(input?.setupOwnerToken))) {
      return {
        state: await this.refresh(),
        authorizationUrl: null,
        setupOwnerClaimRequired: true,
      };
    }

    let existingServer = this.getMcpServers().servers[CLOUDFLARE_API_MCP_SERVER_ID];
    if (input?.forceReconnect === true && existingServer) {
      await this.removeMcpServer(CLOUDFLARE_API_MCP_SERVER_ID);
      existingServer = this.getMcpServers().servers[CLOUDFLARE_API_MCP_SERVER_ID];
    }
    if (
      existingServer?.state === "authenticating" &&
      existingServer.auth_url &&
      isExpectedCloudflareAuthorizationUrl(existingServer.auth_url)
    ) {
      const nextState = withDerivedState({
        ...clearCurrentStepOverride(this.state),
        cloudflare: {
          ...this.state.cloudflare,
          status: "authenticating",
          authorizationUrl: existingServer.auth_url,
          scriptName: currentWorker.scriptName,
          readiness: createCheckingCloudflareReadinessState(),
          error: existingServer.error,
        },
        error: null,
      });
      this.setState(nextState);
      return { state: nextState, authorizationUrl: existingServer.auth_url };
    }

    if (
      existingServer?.state === "authenticating" &&
      existingServer.auth_url &&
      !isExpectedCloudflareAuthorizationUrl(existingServer.auth_url)
    ) {
      await this.removeMcpServer(CLOUDFLARE_API_MCP_SERVER_ID);
    }

    if (
      existingServer?.state === "ready" &&
      cloudflareReadinessNeedsReconnect(this.state.cloudflare.readiness)
    ) {
      await this.removeMcpServer(CLOUDFLARE_API_MCP_SERVER_ID);
    } else if (existingServer?.state === "ready") {
      await this.verifyCloudflareWorkerOwnershipOrFail(currentWorker);
      return { state: this.state, authorizationUrl: null };
    }

    if (existingServer?.state === "failed") {
      await this.removeMcpServer(CLOUDFLARE_API_MCP_SERVER_ID);
    }

    this.setState(
      withDerivedState({
        ...clearCurrentStepOverride(this.state),
        cloudflare: {
          ...this.state.cloudflare,
          status: "connecting",
          authorizationUrl: null,
          scriptName: currentWorker.scriptName,
          readiness: createCheckingCloudflareReadinessState(),
          error: null,
        },
        error: null,
      }),
    );

    const result = await this.addCloudflareMcpServerOrFail(currentWorker.origin);

    if (result.state === "authenticating") {
      const nextState = withDerivedState({
        ...clearCurrentStepOverride(this.state),
        cloudflare: {
          ...this.state.cloudflare,
          status: "authenticating",
          authorizationUrl: result.authUrl,
          scriptName: currentWorker.scriptName,
          readiness: createCheckingCloudflareReadinessState(),
          error: null,
        },
      });
      this.setState(nextState);
      return { state: nextState, authorizationUrl: result.authUrl };
    }

    await this.verifyCloudflareWorkerOwnershipOrFail(currentWorker);
    return { state: this.state, authorizationUrl: null };
  }

  private async startGitHubManifestOrFail(
    input: StartGitHubManifestInput,
  ): Promise<StartGitHubManifestOutput> {
    const origin = readSetupOrigin(input.origin);
    if (!origin) {
      throw new AppError("invalidSetupState");
    }
    let setupClaim: StoredSetupToken;
    if (input.setupClaimToken) {
      setupClaim = await this.requireSetupClaim(input.setupClaimToken);
    } else {
      setupClaim = await this.requireSetupClaimedConnection();
    }
    if (!cloudflareReadinessAllowsGitHubApp(this.state.cloudflare)) {
      throw new AppError("cloudflareReadinessRequired", {
        details: {
          reason:
            buildCloudflareReadinessError(this.state.cloudflare.readiness) ??
            "Cloudflare readiness checks have not completed.",
        },
      });
    }
    await requireDeploymentGitHubAppConfigTableReady(createDbClient(this.env.DB));
    if (
      this.state.githubApp.status !== "ready" &&
      this.state.githubApp.status !== "creating" &&
      this.state.githubApp.status !== "secrets-propagation-stalled" &&
      this.state.githubApp.status !== "failed"
    ) {
      throw new AppError("invalidSetupState");
    }

    const action = buildGitHubManifestAction(input);
    const manifestState = randomBase64Url();
    const generationKey = buildInFlightGitHubAppGenerationKey(manifestState);
    this.setState(
      withDerivedState({
        ...clearCurrentStepOverride(this.state),
        githubApp: {
          ...this.state.githubApp,
          status: "creating",
          manifestState,
          manifestSetupClaimHash: setupClaim.tokenHash,
          manifestSetupClaimExpiresAt: setupClaim.expiresAt,
          generationKey,
          slug: null,
          htmlUrl: null,
          installUrl: null,
          ownerLogin: null,
          ownerType: null,
          orphanedHtmlUrl: null,
          cleanupInstructions: null,
          error: null,
        },
        repositories: {
          status: "locked",
          githubInstallationId: null,
          githubAppGenerationKey: generationKey,
          installState: null,
          error: null,
        },
        upstreamStar: {
          status: "locked",
          verifiedAt: null,
          error: null,
        },
        launch: {
          status: "locked",
        },
        error: null,
      }),
    );

    return {
      action,
      manifest: buildGitHubAppManifest(origin, manifestState),
      state: manifestState,
    };
  }

  async completeGitHubManifestFromCallback(
    input: CompleteGitHubManifestInput,
  ): Promise<CompleteGitHubManifestCallbackOutput> {
    let setupClaim: StoredSetupToken;
    try {
      setupClaim = await this.requireSetupClaim(input.setupClaimToken);
    } catch (error) {
      if (error instanceof AppError && error.kind === "setupClaimRequired") {
        return { ok: false, errorKind: "setupClaimRequired" };
      }
      throw error;
    }
    if (!this.state.githubApp.manifestState || input.state !== this.state.githubApp.manifestState) {
      return { ok: false, errorKind: "invalidSetupState" };
    }
    if (
      this.state.githubApp.manifestSetupClaimHash !== setupClaim.tokenHash ||
      this.state.githubApp.manifestSetupClaimExpiresAt !== setupClaim.expiresAt
    ) {
      return { ok: false, errorKind: "invalidSetupState" };
    }
    if (
      this.state.cloudflare.status !== "verified" ||
      !this.state.cloudflare.accountId ||
      !this.state.cloudflare.scriptName
    ) {
      return { ok: false, errorKind: "setupOwnerProofRequired" };
    }
    if (!cloudflareReadinessAllowsGitHubApp(this.state.cloudflare)) {
      return { ok: false, errorKind: "cloudflareReadinessRequired" };
    }
    if (this.state.githubApp.status !== "creating") {
      return { ok: false, errorKind: "invalidSetupState" };
    }

    this.setState(
      withDerivedState({
        ...clearCurrentStepOverride(this.state),
        githubApp: {
          ...this.state.githubApp,
          status: "secrets-writing",
          error: null,
        },
        error: null,
      }),
    );

    let convertedGitHubApp: GitHubAppManifestConversion | null = null;
    try {
      const githubApp = await convertGitHubAppManifestCode(input.code);
      convertedGitHubApp = githubApp;
      requireGitHubAppManifestMeetsMinimums(githubApp);
      const appSlug = requireGitHubAppManifestString(githubApp, "slug");
      const clientId = requireGitHubAppManifestString(githubApp, "client_id");
      const clientSecret = requireGitHubAppManifestString(githubApp, "client_secret");
      // GitHub returns the manifest "pem" in PKCS#1, which the WebCrypto JWT
      // signing in @octokit/auth-app rejects — store it as PKCS#8.
      const privateKey = normalizeGitHubAppPrivateKeyToPkcs8(
        requireGitHubAppManifestString(githubApp, "pem"),
      );
      const webhookSecret = requireGitHubAppManifestString(githubApp, "webhook_secret");
      const appPermissions = readGitHubAppManifestPermissions(githubApp.permissions);
      const appEvents = readGitHubAppManifestEvents(githubApp.events);
      const ownerLogin = readGitHubAppManifestOwnerLogin(githubApp.owner);
      const ownerType = readGitHubAppManifestOwnerType(githubApp.owner);
      await this.writeGeneratedWorkerSecrets({
        accountId: this.state.cloudflare.accountId,
        scriptName: this.state.cloudflare.scriptName,
        secrets: {
          [AUTH_COOKIE_SECRET_BINDING]: generateAuthCookieSecret(),
          [GITHUB_APP_PRIVATE_KEY_BINDING]: privateKey,
          [GITHUB_CLIENT_SECRET_BINDING]: clientSecret,
          [GITHUB_WEBHOOK_SECRET_BINDING]: webhookSecret,
        },
      });

      const db = createDbClient(this.env.DB);
      await saveDeploymentGitHubAppConfig(db, {
        appId: githubApp.id,
        slug: appSlug,
        htmlUrl: githubApp.html_url,
        ownerLogin,
        ownerType,
        clientId,
        permissions: appPermissions,
        events: appEvents,
      });

      const generationKey = buildGitHubAppGenerationKey(githubApp.id);
      const repositoriesForGeneration = buildRepositoryStateForGitHubAppGeneration(
        this.state.repositories,
        generationKey,
        null,
      );
      const runtimeConfig = await readDeploymentGitHubAppConfig(db, this.env);
      const completionState = createSetupCompletionState({
        hasRuntimeConfig: runtimeConfig !== null,
        githubAppGenerationKey: generationKey,
        repositories: repositoriesForGeneration,
        upstreamStar: this.state.upstreamStar,
      });
      this.setState(
        withDerivedState({
          ...clearCurrentStepOverride(this.state),
          setupComplete: completionState.setupComplete,
          githubApp: {
            ...this.state.githubApp,
            status: runtimeConfig ? "complete" : "secrets-propagating",
            manifestState: null,
            manifestSetupClaimHash: null,
            manifestSetupClaimExpiresAt: null,
            generationKey,
            slug: appSlug,
            htmlUrl: githubApp.html_url,
            installUrl: buildGitHubAppInstallHref({
              appSlug,
              state: completionState.repositories.installState,
            }),
            ownerLogin,
            ownerType,
            orphanedHtmlUrl: null,
            cleanupInstructions: null,
            error: null,
          },
          repositories: completionState.repositories,
          upstreamStar: completionState.upstreamStar,
          launch: completionState.launch,
          error: null,
        }),
      );
      if (runtimeConfig) {
        await this.removeCloudflareMcpServerIfPresent();
      } else {
        await this.scheduleGitHubSecretPropagationCheck(input.origin);
      }

      return {
        ok: true,
        installUrl: buildGitHubAppInstallHref({
          appSlug,
          state: completionState.repositories.installState,
        }),
        deploymentConfigured: runtimeConfig !== null,
        setupComplete: completionState.setupComplete,
      };
    } catch (error) {
      this.markGitHubAppFailed(
        error instanceof Error ? error.message : "GitHub App setup failed.",
        {
          orphanedHtmlUrl: convertedGitHubApp?.html_url ?? null,
        },
      );
      if (
        error instanceof AppError &&
        (error.kind === "cloudflareOAuthFailed" ||
          error.kind === "cloudflareWorkerSecretWriteFailed" ||
          error.kind === "githubAppManifestConversionFailed")
      ) {
        return { ok: false, errorKind: error.kind };
      }
      throw error;
    }
  }

  async recordRepositoryInstall(
    input: RecordRepositoryInstallInput,
  ): Promise<NanitesSetupAgentState> {
    await this.requireSetupClaim(input.setupClaimToken);
    const currentState = await this.refresh({
      deploymentGitHubAppConfigReadable: input.deploymentGitHubAppConfigReadable,
    });
    if (currentState.githubApp.status !== "complete") {
      throw new AppError("invalidSetupState");
    }
    this.requireRepositoryInstallState(input.installState);
    const githubAppGenerationKey = currentState.githubApp.generationKey;
    if (!githubAppGenerationKey) {
      throw new AppError("invalidSetupState");
    }
    await saveDeploymentGitHubAppSelectedInstallation(
      createDbClient(this.env.DB),
      input.githubInstallationId,
    );

    const nextState = withDerivedState({
      ...clearCurrentStepOverride(this.state),
      setupComplete: true,
      repositories: {
        status: "complete",
        githubInstallationId: input.githubInstallationId,
        githubAppGenerationKey,
        installState: this.state.repositories.installState,
        error: null,
      },
      upstreamStar: {
        status: this.state.upstreamStar.status === "complete" ? "complete" : "ready",
        verifiedAt: this.state.upstreamStar.verifiedAt,
        error: null,
      },
      launch: {
        status: "ready",
      },
      error: null,
    });
    this.setState(nextState);
    return nextState;
  }

  async recordGitHubInstallationRepairRequired(
    input: RecordGitHubInstallationRepairInput,
  ): Promise<NanitesSetupAgentState> {
    const currentState = await this.refresh();
    if (
      currentState.githubApp.status !== "complete" ||
      currentState.repositories.githubInstallationId !== input.githubInstallationId
    ) {
      return currentState;
    }

    const message = buildGitHubInstallationRepairMessage(input.reason);
    await saveDeploymentGitHubAppSelectedInstallation(createDbClient(this.env.DB), null);
    const nextState = withDerivedState({
      ...clearCurrentStepOverride(this.state),
      setupComplete: false,
      repositories: {
        status: "ready",
        githubInstallationId: null,
        githubAppGenerationKey:
          currentState.githubApp.generationKey ?? currentState.repositories.githubAppGenerationKey,
        installState: randomBase64Url(),
        error: message,
      },
      upstreamStar: {
        status: "locked",
        verifiedAt: null,
        error: null,
      },
      launch: {
        status: "locked",
      },
      error: {
        step: "repositories",
        message,
      },
    });
    this.setState(nextState);
    return nextState;
  }

  async recordUpstreamStarVerified(): Promise<NanitesSetupAgentState> {
    const currentState = await this.refresh();
    if (currentState.repositories.status !== "complete") {
      throw new AppError("invalidSetupState");
    }

    const nextState = withDerivedState({
      ...clearCurrentStepOverride(this.state),
      setupComplete: true,
      upstreamStar: {
        status: "complete",
        verifiedAt: new Date().toISOString(),
        error: null,
      },
      launch: {
        status: "ready",
      },
      error: null,
    });
    this.setState(nextState);
    return nextState;
  }

  async recordUpstreamStarMissing(message: string): Promise<NanitesSetupAgentState> {
    const currentState = await this.refresh();
    if (currentState.repositories.status !== "complete") {
      throw new AppError("invalidSetupState");
    }

    // Starring is optional, so a missing or failed star keeps the step's own
    // error visible without revoking launch.
    const nextState = withDerivedState({
      ...clearCurrentStepOverride(this.state),
      setupComplete: true,
      upstreamStar: {
        status: "failed",
        verifiedAt: null,
        error: message,
      },
      launch: {
        status: "ready",
      },
      error: null,
    });
    this.setState(nextState);
    return nextState;
  }

  async issueSetupClaim(): Promise<IssueSetupClaimOutput> {
    if (
      this.state.cloudflare.status !== "verified" ||
      !this.state.cloudflare.accountId ||
      !this.state.cloudflare.scriptName
    ) {
      throw new AppError("setupOwnerProofRequired");
    }

    const claimToken = randomBase64Url(SETUP_CLAIM_TOKEN_BYTE_LENGTH);
    const expiresAt = new Date(Date.now() + SETUP_CLAIM_TTL_MS).toISOString();
    await this.ctx.storage.put(SETUP_CLAIM_STORAGE_KEY, {
      tokenHash: await sha256Base64Url(claimToken),
      expiresAt,
    } satisfies StoredSetupToken);

    return { claimToken, expiresAt };
  }

  async clearSetupClaim(): Promise<void> {
    await this.ctx.storage.delete(SETUP_CLAIM_STORAGE_KEY);
  }

  private async readStoredSetupOwnerClaim(): Promise<StoredSetupToken | null> {
    const storedToken = await this.ctx.storage.get(SETUP_OWNER_STORAGE_KEY);
    const parsedToken = storedSetupTokenSchema.safeParse(storedToken);
    if (!parsedToken.success) {
      return null;
    }

    return parsedToken.data;
  }

  private async readActiveStoredSetupOwnerClaim(): Promise<StoredSetupToken | null> {
    const storedToken = await this.readStoredSetupOwnerClaim();
    if (!storedToken) {
      return null;
    }
    if (Date.parse(storedToken.expiresAt) <= Date.now()) {
      await this.ctx.storage.delete(SETUP_OWNER_STORAGE_KEY);
      return null;
    }

    return storedToken;
  }

  private async setupOwnerClaimAllowsMutation(
    setupOwnerToken: string | null | undefined,
  ): Promise<boolean> {
    const storedToken = await this.readActiveStoredSetupOwnerClaim();
    if (!storedToken) {
      return false;
    }
    if (!setupOwnerToken) {
      return false;
    }
    return (await sha256Base64Url(setupOwnerToken)) === storedToken.tokenHash;
  }

  private async readStoredSetupClaim(): Promise<StoredSetupToken | null> {
    const storedToken = await this.ctx.storage.get(SETUP_CLAIM_STORAGE_KEY);
    const parsedToken = storedSetupTokenSchema.safeParse(storedToken);
    if (!parsedToken.success) {
      return null;
    }

    return parsedToken.data;
  }

  private async requireSetupClaim(
    claimToken: string | null | undefined,
  ): Promise<StoredSetupToken> {
    if (!claimToken) {
      throw new AppError("setupClaimRequired");
    }

    const storedToken = await this.readStoredSetupClaim();
    if (!storedToken) {
      throw new AppError("setupClaimRequired");
    }
    if (Date.parse(storedToken.expiresAt) <= Date.now()) {
      await this.clearSetupClaim();
      throw new AppError("setupClaimRequired");
    }
    if ((await sha256Base64Url(claimToken)) !== storedToken.tokenHash) {
      throw new AppError("setupClaimRequired");
    }

    return storedToken;
  }

  private async requireSetupClaimedConnection(): Promise<StoredSetupToken> {
    const { connection } = getCurrentAgent<NanitesSetupAgent>();
    const connectionState = setupConnectionStateSchema.safeParse(connection?.state);
    if (!connectionState.success) {
      throw new AppError("setupClaimRequired");
    }

    const storedClaim = await this.readStoredSetupClaim();
    if (!storedClaim) {
      throw new AppError("setupClaimRequired");
    }
    if (Date.parse(storedClaim.expiresAt) <= Date.now()) {
      await this.clearSetupClaim();
      throw new AppError("setupClaimRequired");
    }
    if (
      connectionState.data.setupClaimTokenHash !== storedClaim.tokenHash ||
      connectionState.data.setupClaimExpiresAt !== storedClaim.expiresAt
    ) {
      throw new AppError("setupClaimRequired");
    }

    return storedClaim;
  }

  private requireRepositoryInstallState(installState: string | null | undefined): void {
    if (!installState || installState !== this.state.repositories.installState) {
      throw new AppError("setupInstallationVerificationFailed", {
        details: { githubInstallationId: null },
      });
    }
  }

  private markGitHubAppFailed(
    message: string,
    options: { readonly orphanedHtmlUrl?: string | null } = {},
  ): void {
    const orphanedHtmlUrl = options.orphanedHtmlUrl ?? this.state.githubApp.orphanedHtmlUrl;
    const cleanupInstructions = orphanedHtmlUrl
      ? buildOrphanedGitHubAppCleanupInstructions(orphanedHtmlUrl)
      : null;
    this.setState(
      withDerivedState({
        ...clearCurrentStepOverride(this.state),
        githubApp: {
          ...this.state.githubApp,
          status: "failed",
          orphanedHtmlUrl,
          cleanupInstructions,
          error: message,
        },
        repositories: {
          status: "locked",
          githubInstallationId: null,
          githubAppGenerationKey: null,
          installState: null,
          error: null,
        },
        upstreamStar: {
          status: "locked",
          verifiedAt: null,
          error: null,
        },
        launch: {
          status: "locked",
        },
        error: {
          step: "github-app",
          message,
        },
      }),
    );
  }

  private async syncCloudflareMcpState(): Promise<void> {
    const cloudflareServer = this.getMcpServers().servers[CLOUDFLARE_API_MCP_SERVER_ID];
    if (!cloudflareServer) {
      return;
    }
    if (cloudflareServer.state === "authenticating") {
      this.setState(
        withDerivedState({
          ...clearCurrentStepOverride(this.state),
          cloudflare: {
            ...this.state.cloudflare,
            status: "authenticating",
            authorizationUrl: cloudflareServer.auth_url,
            readiness: createCheckingCloudflareReadinessState(),
            error: cloudflareServer.error,
          },
        }),
      );
      return;
    }
    if (cloudflareServer.state === "failed") {
      this.markCloudflareFailed(cloudflareServer.error ?? "Cloudflare MCP authorization failed.");
      return;
    }
    if (cloudflareServer.state === "ready" && this.state.cloudflare.status !== "verified") {
      const origin = readCurrentAgentOrigin();
      const currentWorker = origin ? readCurrentWorkerRoute(origin, this.env) : null;
      if (currentWorker) {
        await this.verifyCloudflareWorkerOwnershipOrFail(currentWorker);
      }
    }
  }

  private markCloudflareFailed(message: string): void {
    this.setState(
      withDerivedState({
        ...clearCurrentStepOverride(this.state),
        cloudflare: {
          ...this.state.cloudflare,
          status: "failed",
          authorizationUrl: null,
          readiness: createInitialCloudflareReadinessState(),
          error: message,
        },
        error: {
          step: "cloudflare",
          message,
        },
      }),
    );
  }

  private async verifyCloudflareWorkerOwnershipOrFail(
    currentWorker: CurrentWorkerRoute,
  ): Promise<void> {
    try {
      await this.verifyCloudflareWorkerOwnership(currentWorker);
    } catch (error) {
      const setupError = createCloudflareSetupError(error);
      this.markCloudflareFailed(setupError.message);
      throw setupError;
    }
  }

  private async addCloudflareMcpServerOrFail(callbackHost: string) {
    try {
      return await this.addMcpServer(
        CLOUDFLARE_API_MCP_SERVER_NAME,
        CLOUDFLARE_API_MCP_SERVER_URL,
        {
          callbackHost,
          callbackPath: CLOUDFLARE_MCP_CALLBACK_PATH,
          id: CLOUDFLARE_API_MCP_SERVER_ID,
        },
      );
    } catch (error) {
      const setupError = createCloudflareSetupError(error);
      this.markCloudflareFailed(setupError.message);
      throw setupError;
    }
  }

  private async removeCloudflareMcpServerIfPresent(): Promise<void> {
    if (this.getMcpServers().servers[CLOUDFLARE_API_MCP_SERVER_ID]) {
      await this.removeMcpServer(CLOUDFLARE_API_MCP_SERVER_ID);
    }
  }

  private async scheduleGitHubSecretPropagationCheck(
    origin: string,
    options: { readonly idempotent: boolean } = { idempotent: true },
  ): Promise<void> {
    await this.schedule<CheckGitHubSecretPropagationInput>(
      GITHUB_APP_SECRET_PROPAGATION_CHECK_DELAY_SECONDS,
      "checkGitHubSecretPropagation",
      { origin },
      { idempotent: options.idempotent },
    );
  }

  private async checkCloudflareWorkersPaid(accountId: string): Promise<CloudflareReadinessItem> {
    try {
      const subscriptions = z.array(cloudflareAccountSubscriptionSchema).parse(
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
        return createCloudflareReadinessItem(
          "workers-paid",
          "ready",
          `${describeCloudflareWorkersSubscription(workersPaid)} is active on this account. Cloudflare bills Workers and Dynamic Workers directly to this account.`,
          null,
        );
      }

      return createCloudflareReadinessItem(
        "workers-paid",
        "blocked",
        "Workers Paid was not detected on this account. Add the Workers Paid plan in Cloudflare before launching Nanites; Dynamic Workers require it.",
        "configure",
      );
    } catch {
      return createCloudflareReadinessItem(
        "workers-paid",
        "blocked",
        "Billing Read did not return account subscriptions. Reconnect Cloudflare and grant Account > Billing > Read.",
        "reconnect",
      );
    }
  }

  private async checkWorkerLoader(): Promise<CloudflareReadinessItem> {
    if (!this.env.LOADER || typeof this.env.LOADER.get !== "function") {
      return createCloudflareReadinessItem(
        "worker-loader",
        "blocked",
        "Worker Loader binding `LOADER` is missing from this deployment.",
        "retry",
      );
    }

    try {
      const worker = this.env.LOADER.get(CLOUDFLARE_READINESS_WORKER_CACHE_KEY, () => ({
        compatibilityDate: "2026-06-10",
        compatibilityFlags: ["nodejs_compat"],
        mainModule: "index.js",
        modules: {
          "index.js": `export default {
  fetch() {
    return new Response(${JSON.stringify(CLOUDFLARE_READINESS_WORKER_RESPONSE)});
  },
};`,
        },
        globalOutbound: null,
      }));
      const response = await worker
        .getEntrypoint()
        .fetch(new Request("https://nanites.invalid/setup/readiness"));
      const text = await response.text();
      if (!response.ok || text !== CLOUDFLARE_READINESS_WORKER_RESPONSE) {
        throw new Error("worker_loader_smoke_failed");
      }

      return createCloudflareReadinessItem(
        "worker-loader",
        "ready",
        "Worker Loader ran the setup smoke Worker. Generated trigger handlers can run as Dynamic Workers.",
        null,
      );
    } catch {
      return createCloudflareReadinessItem(
        "worker-loader",
        "blocked",
        "Worker Loader did not run the setup smoke Worker. Confirm this deployment has Worker Loader and Workers Paid enabled.",
        "retry",
      );
    }
  }

  private checkWorkersAiBinding(): CloudflareReadinessItem {
    const ai = this.env.AI as { models?: unknown; run?: unknown } | undefined;
    if (!ai || typeof ai.models !== "function" || typeof ai.run !== "function") {
      return createCloudflareReadinessItem(
        "workers-ai",
        "blocked",
        "Workers AI binding `AI` is missing from this deployment.",
        "retry",
      );
    }

    return createCloudflareReadinessItem(
      "workers-ai",
      "ready",
      "Workers AI binding `AI` is present. Default model usage runs in this Cloudflare account.",
      null,
    );
  }

  private checkDefaultKimiModel(): CloudflareReadinessItem {
    return createCloudflareReadinessItem("kimi-k2", "ready", KIMI_MODEL_CONFIGURED_DETAIL, null);
  }

  private checkAiGateway(): CloudflareReadinessItem {
    const gatewayId = resolveNanitesAiGatewayId(this.env);
    return createCloudflareReadinessItem(
      "ai-gateway",
      "ready",
      `Default model requests use Cloudflare AI Gateway \`${gatewayId}\`; provider API keys are only needed for future non-Workers-AI models.`,
      null,
    );
  }

  private checkBrowserRunBinding(): CloudflareReadinessItem {
    const browser = this.env.BROWSER as { fetch?: unknown } | undefined;
    if (browser && typeof browser.fetch === "function") {
      return createCloudflareReadinessItem(
        "browser-run",
        "ready",
        "Browser Run binding `BROWSER` is present for later preview verification.",
        null,
      );
    }

    return createCloudflareReadinessItem(
      "browser-run",
      "warning",
      "Browser Run binding `BROWSER` was not detected. Setup can continue, but preview verification may be limited.",
      "retry",
    );
  }

  private async checkCloudflareReadiness(accountId: string): Promise<CloudflareReadinessState> {
    const workersAi = this.checkWorkersAiBinding();
    const items = [
      createCloudflareReadinessItem(
        "worker-ownership",
        "ready",
        "Cloudflare confirmed this account owns the deployed Worker route.",
        null,
      ),
      await this.checkCloudflareWorkersPaid(accountId),
      await this.checkWorkerLoader(),
      workersAi,
      workersAi.status === "ready"
        ? this.checkDefaultKimiModel()
        : createCloudflareReadinessItem(
            "kimi-k2",
            "blocked",
            "Kimi K2.6 cannot be checked until the Workers AI binding is available.",
            "retry",
          ),
      this.checkAiGateway(),
      this.checkBrowserRunBinding(),
    ];

    return createCloudflareReadinessState(items);
  }

  private async verifyCloudflareWorkerOwnership(currentWorker: CurrentWorkerRoute): Promise<void> {
    this.setState(
      withDerivedState({
        ...clearCurrentStepOverride(this.state),
        cloudflare: {
          ...this.state.cloudflare,
          status: "verifying",
          authorizationUrl: null,
          scriptName: currentWorker.scriptName,
          readiness: createCheckingCloudflareReadinessState(),
          error: null,
        },
      }),
    );

    const memberships = z.array(cloudflareAccountMembershipSchema).parse(
      await this.executeCloudflareCode({
        code: `async () => {
  const response = await cloudflare.request({ method: "GET", path: "/memberships" });
  return response.result;
}`,
      }),
    );

    for (const { account } of memberships) {
      if (await this.cloudflareAccountOwnsCurrentWorkerRoute(account.id, currentWorker)) {
        const readiness = await this.checkCloudflareReadiness(account.id);
        const readinessError = buildCloudflareReadinessError(readiness);
        const nextState = withDerivedState({
          ...clearCurrentStepOverride(this.state),
          cloudflare: {
            status: "verified",
            authorizationUrl: null,
            accountId: account.id,
            accountName: account.name ?? null,
            scriptName: currentWorker.scriptName,
            readiness,
            error: readinessError,
            connectedAt: new Date().toISOString(),
          },
          githubApp: {
            ...this.state.githubApp,
            status: this.state.setupComplete
              ? this.state.githubApp.status
              : readiness.status === "ready"
                ? "ready"
                : "locked",
            error: null,
          },
          error: readinessError
            ? {
                step: "cloudflare",
                message: readinessError,
              }
            : null,
        });
        this.setState(nextState);
        return;
      }
    }

    throw new AppError("cloudflareWorkerOwnershipVerificationFailed", {
      details: { scriptName: currentWorker.scriptName },
    });
  }

  private async cloudflareAccountOwnsCurrentWorkerRoute(
    accountId: string,
    currentWorker: CurrentWorkerRoute,
  ): Promise<boolean> {
    return currentWorker.workersDevSubdomain
      ? await this.cloudflareAccountOwnsWorkersDevRoute(accountId, currentWorker)
      : await this.cloudflareAccountOwnsCustomDomainRoute(accountId, currentWorker);
  }

  private async cloudflareAccountOwnsWorkersDevRoute(
    accountId: string,
    currentWorker: CurrentWorkerRoute,
  ): Promise<boolean> {
    try {
      const accountSubdomain = cloudflareWorkersAccountSubdomainSchema.parse(
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
      if (accountSubdomain.subdomain.toLowerCase() !== currentWorker.workersDevSubdomain) {
        return false;
      }

      const scriptSubdomain = cloudflareWorkerSubdomainSchema.parse(
        await this.executeCloudflareCode({
          accountId,
          code: `async () => {
  const scriptName = ${JSON.stringify(currentWorker.scriptName)};
  const response = await cloudflare.request({
    method: "GET",
    path: \`/accounts/\${accountId}/workers/scripts/\${scriptName}/subdomain\`,
  });
  return response.result;
}`,
        }),
      );
      return scriptSubdomain.enabled === true;
    } catch {
      return false;
    }
  }

  private async cloudflareAccountOwnsCustomDomainRoute(
    accountId: string,
    currentWorker: CurrentWorkerRoute,
  ): Promise<boolean> {
    try {
      const domains = z.array(cloudflareWorkerDomainSchema).parse(
        await this.executeCloudflareCode({
          accountId,
          code: `async () => {
  const hostname = ${JSON.stringify(currentWorker.hostname)};
  const service = ${JSON.stringify(currentWorker.scriptName)};
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
          domain.hostname.toLowerCase() === currentWorker.hostname &&
          domain.service === currentWorker.scriptName,
      );
    } catch {
      return false;
    }
  }

  private async writeGeneratedWorkerSecrets(input: {
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
  const accountIdValue = ${JSON.stringify(input.accountId)};
  const scriptName = ${JSON.stringify(input.scriptName)};
  const response = await cloudflare.request({
    method: "PATCH",
    path: \`/accounts/\${accountIdValue}/workers/scripts/\${scriptName}/secrets-bulk\`,
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

  private async executeCloudflareCode(input: {
    readonly code: string;
    readonly accountId?: string;
  }): Promise<unknown> {
    const toolArguments: { code: string; account_id?: string } = { code: input.code };
    if (input.accountId) {
      toolArguments.account_id = input.accountId;
    }

    const result = await withTimeout(
      this.mcp.callTool({
        serverId: CLOUDFLARE_API_MCP_SERVER_ID,
        name: "execute",
        arguments: toolArguments,
      }),
      CLOUDFLARE_MCP_EXECUTE_TIMEOUT_MS,
      () =>
        new AppError("cloudflareOAuthFailed", {
          details: { reason: "mcp_execute_timeout" },
        }),
    );

    if ("isError" in result && result.isError) {
      let toolError: string;
      try {
        toolError = readToolText(result);
      } catch {
        toolError = "unreadable tool error content";
      }
      setupAgentLogger.error("Cloudflare MCP execute failed: {toolError}", { toolError });
      throw new AppError("cloudflareOAuthFailed", {
        details: { reason: "mcp_execute_failed", toolError },
      });
    }

    return parseToolJson(result);
  }
}
