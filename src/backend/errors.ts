import {
  GITHUB_OAUTH_CALLBACK_PATH,
  BROWSER_AUTH_COOKIE_PATH,
  BROWSER_AUTH_COOKIE_SAME_SITE,
  BROWSER_AUTH_COOKIE_NAMES,
  MCP_AUTHORIZE_ROUTE,
  MCP_AUTHORIZE_CONTEXT_ROUTE,
  MCP_CONSENT_COOKIE_NAME,
  MCP_CONSENT_COOKIE_PATH,
} from "#/shared/constants.ts";
import { OAuthError } from "@cloudflare/workers-oauth-provider";
import type { Hook } from "@hono/zod-validator";
import * as Sentry from "@sentry/cloudflare";
import { deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { Env as HonoEnv, ErrorHandler } from "hono";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";

type AppErrorStatus = 400 | 401 | 403 | 404 | 500;
type AppErrorDetails = Record<string, unknown>;
type AppErrorDefinition = {
  readonly code: string;
  readonly status: AppErrorStatus;
  readonly message: string;
  readonly publicDetailKeys?: readonly string[];
};
type ErrorHandlerContext = Parameters<ErrorHandler<WorkerHonoEnv>>[1];
type RequestValidationResult = Parameters<Hook<unknown, HonoEnv, string>>[0];

type SerializedError = {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: SerializedError;
};

type ProblemDetails = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly kind?: string;
  readonly details?: Record<string, unknown>;
  readonly diagnostics: {
    readonly request: {
      readonly id?: string;
      readonly method: string;
      readonly path: string;
      readonly query: Record<string, unknown>;
    };
    readonly error: SerializedError;
    readonly sentryEventId?: string;
  };
  [extension: string]: unknown;
};

export const APP_ERRORS = {
  authenticationRequired: {
    code: "authentication_required",
    status: 401,
    message: "Authentication required.",
  },
  activeInstallationRequired: {
    code: "active_installation_required",
    status: 403,
    message: "Active GitHub installation required.",
    publicDetailKeys: ["githubInstallationId"],
  },
  installationAccessRevoked: {
    code: "installation_access_revoked",
    status: 403,
    message: "GitHub installation access was revoked.",
    publicDetailKeys: ["githubInstallationId"],
  },
  githubOAuthCallbackFailed: {
    code: "github_oauth_callback_failed",
    status: 400,
    message: "GitHub OAuth failed.",
    publicDetailKeys: ["reason"],
  },
  invalidGitHubOAuthCallbackState: {
    code: "invalid_github_oauth_callback_state",
    status: 400,
    message: "Invalid GitHub OAuth callback state.",
  },
  githubOAuthTokenExchangeFailed: {
    code: "github_oauth_token_exchange_failed",
    status: 400,
    message:
      "GitHub OAuth token exchange failed. Check the GitHub OAuth app credentials configured for this environment.",
  },
  githubAppPrivateKeyRequired: {
    code: "github_app_private_key_required",
    status: 500,
    message: "GITHUB_APP_PRIVATE_KEY is missing or empty.",
  },
  deploymentGitHubAppSetupRequired: {
    code: "deployment_github_app_setup_required",
    status: 403,
    message: "Nanites setup must create and install a GitHub App before this action can run.",
  },
  deploymentGitHubAppConflict: {
    code: "deployment_github_app_conflict",
    status: 500,
    message: "This deployment has more than one active GitHub App configured.",
    publicDetailKeys: ["githubAppIds"],
  },
  githubAppNotFound: {
    code: "github_app_not_found",
    status: 403,
    message: "This deployment has no active GitHub App with the requested app id.",
    publicDetailKeys: ["githubAppId"],
  },
  setupClaimRequired: {
    code: "setup_claim_required",
    status: 403,
    message: "This browser must complete Cloudflare setup before continuing.",
  },
  invalidSetupState: {
    code: "invalid_setup_state",
    status: 400,
    message: "Setup state is missing, expired, or invalid.",
  },
  requestValidationFailed: {
    code: "request_validation_failed",
    status: 400,
    message: "Request validation failed.",
    publicDetailKeys: ["target", "issues"],
  },
  apiRouteNotFound: {
    code: "api_route_not_found",
    status: 404,
    message: "API route not found.",
  },
  setupDatabaseMigrationRequired: {
    code: "setup_database_migration_required",
    status: 500,
    message: "Nanites setup database migrations have not been applied.",
    publicDetailKeys: ["table"],
  },
  cloudflareReadinessRequired: {
    code: "cloudflare_readiness_required",
    status: 403,
    message: "Cloudflare account is not ready for Nanites setup.",
    publicDetailKeys: ["reason"],
  },
  cloudflareWorkerSecretWriteFailed: {
    code: "cloudflare_worker_secret_write_failed",
    status: 500,
    message: "Nanites could not write generated secrets to this Cloudflare Worker.",
    publicDetailKeys: ["cloudflareResponseStatus"],
  },
  githubAppManifestConversionFailed: {
    code: "github_app_manifest_conversion_failed",
    status: 400,
    message: "GitHub App manifest conversion failed.",
    publicDetailKeys: ["githubResponseStatus"],
  },
  setupInstallationVerificationFailed: {
    code: "setup_installation_verification_failed",
    status: 403,
    message: "GitHub did not confirm access to the installed Nanites GitHub App.",
    publicDetailKeys: ["githubInstallationId", "reason", "visibleInstallationIds", "githubError"],
  },
  upstreamStarVerificationFailed: {
    code: "upstream_star_verification_failed",
    status: 403,
    message: "GitHub did not confirm that this user starred the Nanites repository.",
    publicDetailKeys: ["githubResponseStatus"],
  },
  githubRuntimeTokenRepositoryRequired: {
    code: "github_runtime_token_repository_required",
    status: 500,
    message: "GitHub Nanite runtime token requires at least one repository.",
  },
  githubWebhookChatIngressFailed: {
    code: "github_webhook_chat_ingress_failed",
    status: 500,
    message: "GitHub chat ingress failed.",
  },
  githubWebhookInstallationRequired: {
    code: "github_webhook_installation_required",
    status: 400,
    message: "GitHub webhook installation id required.",
  },
  chatIngressNotFound: {
    code: "chat_ingress_not_found",
    status: 404,
    message: "SigVelo chat ingress route not found.",
  },
  chatIngressUnavailable: {
    code: "chat_ingress_unavailable",
    status: 500,
    message: "SigVelo chat ingress is not configured.",
  },
  chatIngressInvalidGitHubMessage: {
    code: "chat_ingress_invalid_github_message",
    status: 400,
    message: "Chat SDK callback did not include a GitHub raw message.",
  },
  chatIngressInstallationRequired: {
    code: "chat_ingress_installation_required",
    status: 400,
    message: "GitHub thread is missing a valid installation id.",
  },
  agentAuthorizationForbidden: {
    code: "agent_authorization_forbidden",
    status: 403,
    message: "Agent authorization forbidden.",
    publicDetailKeys: ["reason"],
  },
  naniteSubAgentNotFound: {
    code: "nanite_sub_agent_not_found",
    status: 404,
    message: "Nanite sub-agent not found.",
  },
  naniteNotFound: {
    code: "nanite_not_found",
    status: 404,
    message: "Nanite not found.",
    publicDetailKeys: ["naniteId"],
  },
  naniteRunNotFound: {
    code: "nanite_run_not_found",
    status: 404,
    message: "Nanite run not found.",
    publicDetailKeys: ["runId"],
  },
  naniteManagerInstallationRequired: {
    code: "nanite_manager_installation_required",
    status: 403,
    message: "Nanite operation requires an installation-scoped manager.",
  },
  naniteGitHubRepositoryPermissionsRequired: {
    code: "nanite_github_repository_permissions_required",
    status: 400,
    message: "GitHub MCP capability requires GitHub repository permissions.",
  },
  naniteRepositoryScopeForbidden: {
    code: "nanite_repository_scope_forbidden",
    status: 403,
    message: "GitHub installation cannot access one or more Nanite repositories.",
    publicDetailKeys: ["githubInstallationId", "repositories"],
  },
  naniteTriggerValidationFailed: {
    code: "nanite_trigger_validation_failed",
    status: 400,
    message: "Generated trigger validation failed.",
    publicDetailKeys: ["reason"],
  },
  naniteRuntimeActivityMismatch: {
    code: "nanite_runtime_activity_mismatch",
    status: 400,
    message: "Nanite runtime activity does not match the run.",
    publicDetailKeys: ["runId", "naniteId", "actualNaniteId"],
  },
  naniteInvalidRunTransition: {
    code: "nanite_invalid_run_transition",
    status: 500,
    message: "Invalid Nanite run transition.",
    publicDetailKeys: ["currentStatus", "nextStatus"],
  },
  naniteInvalidTimestamp: {
    code: "nanite_invalid_timestamp",
    status: 500,
    message: "Nanite timestamp must be a valid ISO date.",
    publicDetailKeys: ["fieldName"],
  },
  naniteInvalidNonNegativeNumber: {
    code: "nanite_invalid_non_negative_number",
    status: 500,
    message: "Nanite numeric value must be non-negative.",
    publicDetailKeys: ["fieldName"],
  },
  naniteAgentManagerRequired: {
    code: "nanite_agent_manager_required",
    status: 500,
    message: "SigveloNaniteAgent is not attached to an installation manager.",
  },
  naniteAgentRunAcceptFailed: {
    code: "nanite_agent_run_accept_failed",
    status: 500,
    message: "Nanite agent could not accept the run from the manager.",
    publicDetailKeys: ["reason"],
  },
  naniteAgentRunSubmitFailed: {
    code: "nanite_agent_run_submit_failed",
    status: 500,
    message: "Nanite agent could not submit the run to the manager.",
    publicDetailKeys: ["reason"],
  },
  naniteAgentGithubMcpInstallationRequired: {
    code: "nanite_agent_github_mcp_installation_required",
    status: 403,
    message: "GitHub MCP capability requires an installation-scoped Nanite manager.",
  },
  naniteAgentActiveRunRequired: {
    code: "nanite_agent_active_run_required",
    status: 500,
    message: "SigveloNaniteAgent has no active run.",
  },
  nanitesModelSelectionInvalid: {
    code: "nanites_model_selection_invalid",
    status: 400,
    message: "Nanites model selection is invalid.",
    publicDetailKeys: ["reason", "modelId"],
  },
  generatedTriggerBundleFailed: {
    code: "generated_trigger_bundle_failed",
    status: 500,
    message: "Generated trigger bundling failed.",
    publicDetailKeys: ["reason"],
  },
  githubMcpToolPermissionMappingRequired: {
    code: "github_mcp_tool_permission_mapping_required",
    status: 500,
    message: "GitHub MCP tool is not mapped to GitHub App permissions.",
    publicDetailKeys: ["toolName"],
  },
  githubMcpAllowedToolRequired: {
    code: "github_mcp_allowed_tool_required",
    status: 400,
    message: "GitHub MCP capability must expose at least one allowed tool.",
  },
  toolOutputArtifactNotFound: {
    code: "tool_output_artifact_not_found",
    status: 404,
    message: "Tool output artifact was not found or has expired.",
    publicDetailKeys: ["artifactId"],
  },
  toolOutputPatternRequired: {
    code: "tool_output_pattern_required",
    status: 400,
    message: "artifact_read pattern must be a non-empty string when grep-searching.",
  },
  toolOutputActiveRunRequired: {
    code: "tool_output_active_run_required",
    status: 500,
    message: "Tool output artifacts require an active Nanite run.",
  },
  managerConversationInstallationRequired: {
    code: "manager_conversation_installation_required",
    status: 400,
    message: "Manager conversation requires a valid GitHub installation id.",
  },
  managerConversationInstallationMismatch: {
    code: "manager_conversation_installation_mismatch",
    status: 403,
    message: "Manager conversation installation does not match the selected manager.",
  },
  managerConversationAccountRequired: {
    code: "manager_conversation_account_required",
    status: 400,
    message: "Manager conversation requires a selected GitHub account.",
  },
  naniteManagerNotFound: {
    code: "nanite_manager_not_found",
    status: 404,
    message: "Nanite manager not found.",
    publicDetailKeys: ["managerName"],
  },
  naniteToolInstallationRequired: {
    code: "nanite_tool_installation_required",
    status: 401,
    message: "SigVelo manager tools require a connected GitHub installation.",
  },
  testAuthTokenRequired: {
    code: "test_auth_token_required",
    status: 400,
    message: "Local authenticated browser sessions require a real GitHub user token.",
    publicDetailKeys: ["hint"],
  },
  invalidMcpAuthorizationRequest: {
    code: "invalid_mcp_authorization_request",
    status: 400,
    message: "Invalid MCP authorization request",
    publicDetailKeys: ["reason"],
  },
  mcpAuthorizationInstallationRequired: {
    code: "mcp_authorization_installation_required",
    status: 401,
    message: "MCP authorization requires an authenticated GitHub installation.",
  },
  invalidMcpAuthorizationConsent: {
    code: "invalid_mcp_authorization_consent",
    status: 400,
    message: "Invalid or expired MCP authorization consent.",
  },
  mcpSelectedInstallationUnavailable: {
    code: "mcp_selected_installation_unavailable",
    status: 403,
    message: "Selected GitHub installation is no longer available.",
  },
  unsupportedMcpScope: {
    code: "unsupported_mcp_scope",
    status: 400,
    message: "Unsupported SigVelo MCP scope.",
    publicDetailKeys: ["scopes"],
  },
  mcpOAuthProviderUnavailable: {
    code: "mcp_oauth_provider_unavailable",
    status: 500,
    message: "OAuth provider helpers are not available on this request.",
  },
  mcpTokenScopeUnavailable: {
    code: "mcp_token_scope_unavailable",
    status: 400,
    message: "The requested token scope is not available on this SigVelo MCP grant.",
  },
  internalServerError: {
    code: "internal_server_error",
    status: 500,
    message: "Internal Server Error",
  },
} as const satisfies Record<string, AppErrorDefinition>;

export type AppErrorKind = keyof typeof APP_ERRORS;

export class AppError extends Error {
  readonly details: AppErrorDetails | undefined;

  constructor(
    readonly kind: AppErrorKind,
    options: {
      readonly cause?: unknown;
      readonly details?: AppErrorDetails;
      readonly message?: string;
    } = {},
  ) {
    super(options.message ?? APP_ERRORS[kind].message, { cause: options.cause });
    this.name = "AppError";
    this.details = options.details;
  }
}

export function requestValidationHook(result: RequestValidationResult): void {
  if (!result.success) {
    throw new AppError("requestValidationFailed", {
      cause: result.error,
      details: {
        target: result.target,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map((segment) => String(segment)).join("."),
          code: issue.code,
          message: issue.message,
        })),
      },
    });
  }
}

const PROBLEM_CONTENT_TYPE = "application/problem+json";
const PROBLEM_TYPE_BASE_URL = "https://app.sigvelo.com/problems/";
const REDACTED = "[redacted]";
const MAX_DIAGNOSTIC_STRING_LENGTH = 4096;
const MAX_SANITIZE_DEPTH = 4;
const GENERAL_SENSITIVE_KEY =
  /(?:authorization|cookie|password|private[_-]?key|secret|signature|token)/i;
const QUERY_SENSITIVE_KEY =
  /(?:authorization|code|cookie|key|password|private[_-]?key|secret|signature|state|token)/i;
const SENSITIVE_TEXT_PATTERNS = [
  /github_pat_[A-Za-z0-9_]+/g,
  /gh[pousr]_[A-Za-z0-9_]+/g,
  /Bearer\s+[-._~+/A-Za-z0-9]+=*/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:authorization|code|cookie|password|private[_-]?key|secret|signature|state|token)\s*[:=]\s*[^&\s,;]+/gi,
] as const;

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseAppIsoDate(value: string, fieldName: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError("naniteInvalidTimestamp", {
      details: { fieldName },
      message: `${APP_ERRORS.naniteInvalidTimestamp.message}: ${fieldName}`,
    });
  }
  return date;
}

export function parseOptionalAppIsoDate(
  value: string | undefined,
  fieldName: string,
): Date | undefined {
  return value ? parseAppIsoDate(value, fieldName) : undefined;
}

export function createMcpTokenScopeUnavailableError(): OAuthError {
  return new OAuthError("invalid_scope", {
    description: APP_ERRORS.mcpTokenScopeUnavailable.message,
  });
}

function redactText(value: string): string {
  const redacted = SENSITIVE_TEXT_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, REDACTED),
    value,
  );
  return redacted.length > MAX_DIAGNOSTIC_STRING_LENGTH
    ? `${redacted.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...`
    : redacted;
}

function sanitize(value: unknown, key?: string, depth = 0): unknown {
  if (key && GENERAL_SENSITIVE_KEY.test(key)) {
    return REDACTED;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return redactText(value);
  }

  if (Array.isArray(value)) {
    return depth >= MAX_SANITIZE_DEPTH
      ? "[array]"
      : value.map((item) => sanitize(item, undefined, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= MAX_SANITIZE_DEPTH) {
      return "[object]";
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitize(entryValue, entryKey, depth + 1),
      ]),
    );
  }

  return redactText(String(value));
}

function readQuery(url: URL): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  for (const [key, value] of url.searchParams.entries()) {
    const sanitizedValue = QUERY_SENSITIVE_KEY.test(key) ? REDACTED : sanitize(value, key);
    const currentValue = query[key];
    query[key] =
      currentValue === undefined
        ? sanitizedValue
        : Array.isArray(currentValue)
          ? [...currentValue, sanitizedValue]
          : [currentValue, sanitizedValue];
  }

  return query;
}

function serializeError(error: unknown, depth = 0): SerializedError {
  const type =
    error instanceof Error
      ? error.name === "Error"
        ? error.constructor.name || "Error"
        : error.name
      : error === null
        ? "null"
        : typeof error;
  const serialized: {
    type: string;
    message: string;
    stack?: string;
    cause?: SerializedError;
  } = {
    type,
    message: redactText(describeError(error)),
  };

  if (error instanceof Error && error.stack) {
    serialized.stack = redactText(error.stack);
  }

  if (error instanceof Error && error.cause !== undefined) {
    serialized.cause =
      depth >= MAX_SANITIZE_DEPTH
        ? { type: "CauseDepthExceeded", message: "Nested error cause omitted." }
        : serializeError(error.cause, depth + 1);
  }

  return serialized;
}

function captureServerError(error: unknown, status: number): string | undefined {
  if (status < 500) {
    return;
  }

  try {
    const eventId = Sentry.captureException(error, {
      mechanism: { handled: true, type: "hono.on_error" },
    });
    return typeof eventId === "string" ? eventId : undefined;
  } catch {
    return;
  }
}

function writeProblemResponse(body: ProblemDetails, sourceHeaders?: Headers): Response {
  const headers = new Headers();
  sourceHeaders?.forEach((value, key) => {
    headers.append(key, value);
  });
  headers.set("content-type", PROBLEM_CONTENT_TYPE);
  headers.set("cache-control", "no-store");

  return new Response(JSON.stringify(body), {
    status: body.status,
    headers,
  });
}

function problemResponse(input: {
  readonly error: unknown;
  readonly request?: Request;
  readonly requestId?: string;
  readonly sourceHeaders?: Headers;
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly kind?: string;
  readonly details?: AppErrorDetails;
  readonly publicDetailKeys?: readonly string[];
}): Response {
  const requestUrl = input.request ? new URL(input.request.url) : undefined;
  const requestId = input.requestId;
  const error = serializeError(input.error);
  const details = input.details ? (sanitize(input.details) as Record<string, unknown>) : undefined;
  const sentryEventId = captureServerError(input.error, input.status);
  const body: ProblemDetails = {
    type: `${PROBLEM_TYPE_BASE_URL}${input.code}`,
    title: input.title,
    status: input.status,
    detail: error.message,
    code: input.code,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(requestId ? { instance: `urn:sigvelo:request:${requestId}`, requestId } : {}),
    ...(details ? { details } : {}),
    diagnostics: {
      request: {
        ...(requestId ? { id: requestId } : {}),
        method: input.request?.method ?? "UNKNOWN",
        path: requestUrl?.pathname ?? "unknown",
        query: requestUrl ? readQuery(requestUrl) : {},
      },
      error,
      ...(sentryEventId ? { sentryEventId } : {}),
    },
  };

  for (const key of input.publicDetailKeys ?? []) {
    const value = details?.[key];
    if (value !== undefined) {
      body[key] = value;
    }
  }

  return writeProblemResponse(body, input.sourceHeaders);
}

function appErrorProblemResponse(
  error: AppError,
  request?: Request,
  requestId?: string,
  sourceHeaders?: Headers,
): Response {
  const definition = APP_ERRORS[error.kind];
  const publicDetailKeys =
    "publicDetailKeys" in definition ? definition.publicDetailKeys : undefined;
  return problemResponse({
    error,
    request,
    requestId,
    sourceHeaders,
    status: definition.status,
    code: definition.code,
    title: definition.message,
    kind: error.kind,
    details: error.details,
    publicDetailKeys,
  });
}

export function createAppErrorProblemResponse(
  error: AppError,
  request?: Request,
  sourceHeaders?: Headers,
): Response {
  return appErrorProblemResponse(
    error,
    request,
    request?.headers.get("x-request-id") ?? undefined,
    sourceHeaders,
  );
}

function readMcpAuthorizationErrorMessage(error: AppError): string {
  const reason = error.details?.reason;
  return typeof reason === "string" && reason.length > 0
    ? `${APP_ERRORS[error.kind].message}: ${reason}`
    : error.message;
}

function readGitHubOAuthCallbackErrorMessage(error: AppError): string {
  const reason = error.details?.reason;
  return typeof reason === "string" && reason.length > 0
    ? `GitHub OAuth failed: ${reason}`
    : error.message;
}

function expireMcpConsentCookie(context: ErrorHandlerContext): void {
  deleteCookie(context, MCP_CONSENT_COOKIE_NAME, {
    path: MCP_CONSENT_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(context.req.raw.url).protocol === "https:",
  });
}

function expireBrowserAuthCookie(context: ErrorHandlerContext, name: string): void {
  deleteCookie(context, name, {
    path: BROWSER_AUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: BROWSER_AUTH_COOKIE_SAME_SITE,
    secure: new URL(context.req.raw.url).protocol === "https:",
  });
}

function expireBrowserSessionCookies(context: ErrorHandlerContext): void {
  expireBrowserAuthCookie(context, BROWSER_AUTH_COOKIE_NAMES.session);
  expireBrowserAuthCookie(context, BROWSER_AUTH_COOKIE_NAMES.githubUserToken);
}

function redirectMcpOAuthError(
  context: ErrorHandlerContext,
  error: "access_denied" | "invalid_scope",
  description: string,
): Response | null {
  const authRequest = context.get("mcpAuthRequest");
  if (!authRequest) {
    return null;
  }

  const redirectUrl = new URL(authRequest.redirectUri);
  redirectUrl.searchParams.set("error", error);
  redirectUrl.searchParams.set("error_description", description);
  redirectUrl.searchParams.set("state", authRequest.state);

  expireMcpConsentCookie(context);
  return context.redirect(redirectUrl.toString(), 302);
}

function handleMcpAuthorizeContextError(
  error: AppError,
  context: ErrorHandlerContext,
): Response | null {
  if (error.kind !== "invalidMcpAuthorizationRequest" && error.kind !== "unsupportedMcpScope") {
    return null;
  }

  return context.json(
    {
      status: "invalid",
      message:
        error.kind === "invalidMcpAuthorizationRequest"
          ? readMcpAuthorizationErrorMessage(error)
          : error.message,
    },
    APP_ERRORS[error.kind].status,
  );
}

function handleMcpAuthorizeError(error: AppError, context: ErrorHandlerContext): Response | null {
  if (error.kind === "unsupportedMcpScope") {
    return redirectMcpOAuthError(context, "invalid_scope", error.message);
  }

  if (
    error.kind !== "invalidMcpAuthorizationRequest" &&
    error.kind !== "mcpAuthorizationInstallationRequired" &&
    error.kind !== "invalidMcpAuthorizationConsent" &&
    error.kind !== "mcpSelectedInstallationUnavailable"
  ) {
    return null;
  }

  return context.text(
    error.kind === "invalidMcpAuthorizationRequest"
      ? readMcpAuthorizationErrorMessage(error)
      : error.message,
    APP_ERRORS[error.kind].status,
  );
}

function handleGitHubOAuthCallbackError(
  error: AppError,
  context: ErrorHandlerContext,
): Response | null {
  if (
    error.kind !== "githubOAuthCallbackFailed" &&
    error.kind !== "invalidGitHubOAuthCallbackState" &&
    error.kind !== "githubOAuthTokenExchangeFailed"
  ) {
    return null;
  }

  expireBrowserAuthCookie(context, BROWSER_AUTH_COOKIE_NAMES.githubOAuthState);
  return context.text(
    error.kind === "githubOAuthCallbackFailed"
      ? readGitHubOAuthCallbackErrorMessage(error)
      : error.message,
    APP_ERRORS[error.kind].status,
  );
}

function handleAppErrorResponse(error: AppError, context: ErrorHandlerContext): Response {
  const requestPath = new URL(context.req.url).pathname;

  if (error.kind === "authenticationRequired") {
    expireBrowserSessionCookies(context);
  }

  if (requestPath === MCP_AUTHORIZE_CONTEXT_ROUTE) {
    const response = handleMcpAuthorizeContextError(error, context);
    if (response) {
      return response;
    }
  }

  if (requestPath === MCP_AUTHORIZE_ROUTE) {
    const response = handleMcpAuthorizeError(error, context);
    if (response) {
      return response;
    }
  }

  if (requestPath === GITHUB_OAUTH_CALLBACK_PATH) {
    const response = handleGitHubOAuthCallbackError(error, context);
    if (response) {
      return response;
    }
  }

  return appErrorProblemResponse(
    error,
    context.req.raw,
    context.get("requestId"),
    context.res.headers,
  );
}

function withContextHeaders(response: Response, context: ErrorHandlerContext): Response {
  const headers = new Headers(response.headers);
  context.res.headers.forEach((value, key) => {
    headers.append(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function handleHttpException(error: HTTPException, context: ErrorHandlerContext): Response {
  const response = error.getResponse();
  captureServerError(error, response.status);
  return withContextHeaders(response, context);
}

export const handleAppError: ErrorHandler<WorkerHonoEnv> = (error, context) => {
  if (error instanceof AppError) {
    return handleAppErrorResponse(error, context);
  }

  if (error instanceof HTTPException) {
    return handleHttpException(error, context);
  }

  const definition = APP_ERRORS.internalServerError;
  return problemResponse({
    error,
    request: context.req.raw,
    requestId: context.get("requestId"),
    sourceHeaders: context.res.headers,
    status: definition.status,
    code: definition.code,
    title: definition.message,
  });
};
