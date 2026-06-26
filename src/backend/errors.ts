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
  };
  [extension: string]: unknown;
};

export const APP_ERRORS = {
  authenticationRequired: {
    code: "authentication_required",
    status: 401,
    message: "Authentication required.",
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
  deploymentGitHubAppRequired: {
    code: "deployment_github_app_required",
    status: 403,
    message:
      "This deployment must have one provisioned GitHub App and required Worker secrets before this action can run.",
  },
  deploymentGitHubInstallationRequired: {
    code: "deployment_github_installation_required",
    status: 403,
    message:
      "This deployment must have one connected GitHub App installation before this action can run.",
  },
  deploymentGitHubInstallationConflict: {
    code: "deployment_github_installation_conflict",
    status: 500,
    message: "This deployment has more than one active GitHub App installation configured.",
    publicDetailKeys: ["githubInstallationIds"],
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
  githubRuntimeTokenRepositoryRequired: {
    code: "github_runtime_token_repository_required",
    status: 500,
    message: "GitHub Nanite runtime token requires at least one repository.",
  },
  githubWebhookMessengerFailed: {
    code: "github_webhook_messenger_failed",
    status: 500,
    message: "GitHub messenger delivery failed.",
  },
  githubWebhookInstallationRequired: {
    code: "github_webhook_installation_required",
    status: 400,
    message: "GitHub webhook installation id required.",
  },
  agentAuthorizationForbidden: {
    code: "agent_authorization_forbidden",
    status: 403,
    message: "Agent authorization forbidden.",
    publicDetailKeys: ["reason"],
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
  invalidNaniteTriggerTestEvent: {
    code: "invalid_nanite_trigger_test_event",
    status: 400,
    message: "Invalid Nanite trigger test event.",
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
  naniteAgentManagerRequired: {
    code: "nanite_agent_manager_required",
    status: 500,
    message: "SigveloNaniteAgent is not attached to an installation manager.",
  },
  naniteAgentGithubMcpInstallationRequired: {
    code: "nanite_agent_github_mcp_installation_required",
    status: 403,
    message: "GitHub MCP capability requires an installation-scoped Nanite manager.",
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
  toolOutputArtifactNotFound: {
    code: "tool_output_artifact_not_found",
    status: 404,
    message: "Tool output artifact was not found or has expired.",
    publicDetailKeys: ["artifactId"],
  },
  toolOutputActiveRunRequired: {
    code: "tool_output_active_run_required",
    status: 500,
    message: "Tool output artifacts require an active Nanite run.",
  },
  managerConversationInstallationMismatch: {
    code: "manager_conversation_installation_mismatch",
    status: 403,
    message: "Manager conversation installation does not match the selected manager.",
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
    error.kind !== "invalidMcpAuthorizationConsent"
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
