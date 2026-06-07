import { getLogger } from "@logtape/logtape";
import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { ErrorHandler } from "hono";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import {
  BROWSER_AUTH_COOKIE_NAMES,
  BROWSER_AUTH_COOKIE_PATH,
  BROWSER_AUTH_COOKIE_SAME_SITE,
  GITHUB_OAUTH_CALLBACK_PATH,
} from "#/auth.ts";
import {
  MCP_AUTHORIZE_CONTEXT_ROUTE,
  MCP_AUTHORIZE_ROUTE,
  MCP_CONSENT_COOKIE_NAME,
  MCP_CONSENT_COOKIE_PATH,
} from "#/mcp.ts";

type AppErrorDetails = Record<string, string | number | boolean | null | readonly string[]>;
type AppErrorDefinition = {
  readonly code: string;
  readonly status: 400 | 401 | 403 | 404 | 500;
  readonly message: string;
  readonly publicDetailKeys?: readonly string[];
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
    message: "Sigvelo chat ingress route not found.",
  },
  chatIngressUnavailable: {
    code: "chat_ingress_unavailable",
    status: 500,
    message: "Sigvelo chat ingress is not configured.",
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
  naniteDisabled: {
    code: "nanite_disabled",
    status: 400,
    message: "Nanite is disabled.",
    publicDetailKeys: ["naniteId"],
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
    message: "Sigvelo manager tools require a connected GitHub installation.",
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
    message: "Unsupported Sigvelo MCP scope.",
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
    message: "The requested token scope is not available on this Sigvelo MCP grant.",
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

const apiErrorLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild("api")
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  });

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function describeErrorWithStack(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export function parseAppIsoDate(value: string, fieldName: string): Date {
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

function getRequestPath(context: Parameters<ErrorHandler<WorkerHonoEnv>>[1]): string {
  return new URL(context.req.url).pathname;
}

export function readPublicAppErrorBody(error: AppError): Record<string, unknown> {
  const definition: AppErrorDefinition = APP_ERRORS[error.kind];
  const body: Record<string, unknown> = { code: definition.code };

  for (const detailKey of definition.publicDetailKeys ?? []) {
    const detail = error.details?.[detailKey];
    if (detail !== undefined) {
      body[detailKey] = detail;
    }
  }

  return body;
}

function readMcpAuthorizationErrorMessage(error: AppError): string {
  const definition = APP_ERRORS[error.kind];
  const reason = error.details?.reason;

  return typeof reason === "string" && reason.length > 0
    ? `${definition.message}: ${reason}`
    : error.message;
}

function readGitHubOAuthCallbackErrorMessage(error: AppError): string {
  const reason = error.details?.reason;
  return typeof reason === "string" && reason.length > 0
    ? `GitHub OAuth failed: ${reason}`
    : error.message;
}

function expireMcpConsentCookie(context: Parameters<ErrorHandler<WorkerHonoEnv>>[1]): void {
  deleteCookie(context, MCP_CONSENT_COOKIE_NAME, {
    path: MCP_CONSENT_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(context.req.raw.url).protocol === "https:",
  });
}

function expireBrowserAuthCookie(
  context: Parameters<ErrorHandler<WorkerHonoEnv>>[1],
  name: string,
): void {
  deleteCookie(context, name, {
    path: BROWSER_AUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: BROWSER_AUTH_COOKIE_SAME_SITE,
    secure: new URL(context.req.raw.url).protocol === "https:",
  });
}

function expireBrowserSessionCookies(context: Parameters<ErrorHandler<WorkerHonoEnv>>[1]): void {
  expireBrowserAuthCookie(context, BROWSER_AUTH_COOKIE_NAMES.session);
  expireBrowserAuthCookie(context, BROWSER_AUTH_COOKIE_NAMES.githubUserToken);
}

function redirectMcpOAuthError(
  context: Parameters<ErrorHandler<WorkerHonoEnv>>[1],
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
  context: Parameters<ErrorHandler<WorkerHonoEnv>>[1],
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

function handleMcpAuthorizeError(
  error: AppError,
  context: Parameters<ErrorHandler<WorkerHonoEnv>>[1],
): Response | null {
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
  context: Parameters<ErrorHandler<WorkerHonoEnv>>[1],
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

function logUnhandledError(
  error: Error,
  context: Parameters<ErrorHandler<WorkerHonoEnv>>[1],
): void {
  apiErrorLogger.error(LOG_EVENTS.API_UNHANDLED_ERROR, {
    [OTEL_ATTRS.REQUEST_ID]: context.get("requestId"),
    [OTEL_ATTRS.HTTP_REQUEST_METHOD]: context.req.method,
    [OTEL_ATTRS.URL_PATH]: getRequestPath(context),
    [OTEL_ATTRS.ERROR_TYPE]: error.name,
    [OTEL_ATTRS.EXCEPTION_MESSAGE]: error.message,
  });
}

function logKnownServerError(
  error: AppError,
  context: Parameters<ErrorHandler<WorkerHonoEnv>>[1],
): void {
  apiErrorLogger.error(LOG_EVENTS.API_UNHANDLED_ERROR, {
    [OTEL_ATTRS.REQUEST_ID]: context.get("requestId"),
    [OTEL_ATTRS.HTTP_REQUEST_METHOD]: context.req.method,
    [OTEL_ATTRS.URL_PATH]: getRequestPath(context),
    [OTEL_ATTRS.ERROR_TYPE]: error.kind,
    [OTEL_ATTRS.EXCEPTION_MESSAGE]: error.message,
  });
}

function handleAppErrorResponse(
  error: AppError,
  context: Parameters<ErrorHandler<WorkerHonoEnv>>[1],
): Response {
  const definition = APP_ERRORS[error.kind];
  const requestPath = getRequestPath(context);

  if (error.kind === "authenticationRequired") {
    expireBrowserSessionCookies(context);
  }

  if (definition.status >= 500) {
    logKnownServerError(error, context);
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

  return context.json(readPublicAppErrorBody(error), definition.status);
}

function handleHttpException(
  error: HTTPException,
  context: Parameters<ErrorHandler<WorkerHonoEnv>>[1],
): Response {
  if (error.status >= 500) {
    logUnhandledError(error, context);
  }

  const response = error.getResponse();
  const headers = new Headers(response.headers);
  context.res.headers.forEach((value, key) => {
    headers.append(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export const handleAppError: ErrorHandler<WorkerHonoEnv> = (error, context) => {
  if (error instanceof AppError) {
    return handleAppErrorResponse(error, context);
  }

  if (error instanceof HTTPException) {
    return handleHttpException(error, context);
  }

  logUnhandledError(error, context);
  return context.json(
    { code: APP_ERRORS.internalServerError.code },
    APP_ERRORS.internalServerError.status,
  );
};
