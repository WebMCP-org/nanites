// Wrangler entrypoint ("main" in wrangler.jsonc).
import * as Sentry from "@sentry/cloudflare";
import { OAuthProvider, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { HostBridgeLoopback } from "@cloudflare/think/extensions";
import { getLogger } from "@logtape/logtape";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { nanitesMcpApiHandler } from "#/backend/mcp/index.ts";
import {
  MCP_AUTHORIZE_ROUTE,
  MCP_CLIENT_REGISTRATION_ROUTE,
  MCP_ROUTE,
  MCP_TOKEN_ROUTE,
  SUPPORTED_MCP_SCOPES,
} from "#/mcp.ts";
import { downscopeMcpAuthPropsForToken, sigveloMcpAuthPropsSchema } from "#/backend/mcp/index.ts";
import {
  configureAgentLogging,
  createWorkerRequestId,
  getApiRequestLogEvent,
  getHttpStatusClass,
  LOG_EVENTS,
  LOGGING,
  OTEL_ATTRS,
} from "#/backend/logging.ts";
import { ChatSdkStateAgent, SigveloChatIngress } from "#/backend/agents/SigveloChatIngress.ts";
import { createMcpTokenScopeUnavailableError } from "#/backend/errors.ts";
import { SigveloManagerConversationAgent } from "#/backend/agents/SigveloManagerConversationAgent.ts";
import { SigveloNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import { SigveloNaniteAgent } from "#/backend/agents/SigveloNaniteAgent.ts";

configureAgentLogging("info");

type OAuthProviderError = Parameters<NonNullable<OAuthProviderOptions<Env>["onError"]>>[0];

const DEFAULT_LOCAL_TRACES_SAMPLE_RATE = 1;
const DEFAULT_REMOTE_TRACES_SAMPLE_RATE = 0.1;
const SAMPLING_RATE_MIN = 0;
const SAMPLING_RATE_MAX = 1;
const OAUTH_AUTHORIZATION_SERVER_METADATA_ROUTE = "/.well-known/oauth-authorization-server";
const OAUTH_PROTECTED_RESOURCE_METADATA_ROUTE_PREFIX = "/.well-known/oauth-protected-resource";

// Keep Sentry at the Worker boundary. Agents/Think already manages the Durable Object
// WebSocket context, and Sentry's DO wrapper rewraps waitUntil recursively on those routes.
export {
  ChatSdkStateAgent,
  HostBridgeLoopback,
  SigveloChatIngress,
  SigveloManagerConversationAgent,
  SigveloNaniteAgent,
  SigveloNaniteManager,
};

function parseSamplingRate(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < SAMPLING_RATE_MIN || parsed > SAMPLING_RATE_MAX) {
    return fallback;
  }

  return parsed;
}

function createServerSentryOptions(env: Env) {
  const isLocalLikeEnvironment =
    env.SENTRY_ENVIRONMENT === "local" || env.SENTRY_ENVIRONMENT === "development";

  return {
    dsn: env.SENTRY_DSN ?? "",
    enabled: Boolean(env.SENTRY_DSN),
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: parseSamplingRate(
      env.SENTRY_TRACES_SAMPLE_RATE,
      isLocalLikeEnvironment ? DEFAULT_LOCAL_TRACES_SAMPLE_RATE : DEFAULT_REMOTE_TRACES_SAMPLE_RATE,
    ),
    integrations: [Sentry.vercelAIIntegration()],
  };
}

const oauthLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild("oauth")
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  });
const oauthProviderRequestLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild(LOGGING.REQUEST_CHILD_CATEGORY)
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  });

function readOAuthInternalReason(internal: unknown): string | undefined {
  if (typeof internal !== "object" || internal === null || !("reason" in internal)) {
    return;
  }

  const reason = internal.reason;
  return typeof reason === "string" ? reason : undefined;
}

function createOAuthProviderErrorLogProperties(error: OAuthProviderError) {
  const internalReason = readOAuthInternalReason(error.internal);

  return {
    [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CODE]: error.status,
    [OTEL_ATTRS.ERROR_TYPE]: error.code,
    [OTEL_ATTRS.OAUTH_ERROR_CODE]: error.code,
    [OTEL_ATTRS.OAUTH_ERROR_DESCRIPTION]: error.description,
    ...(internalReason ? { [OTEL_ATTRS.OAUTH_INTERNAL_REASON]: internalReason } : {}),
  };
}

function logOAuthProviderErrorResponse(error: OAuthProviderError): void {
  oauthLogger.warn(LOG_EVENTS.OAUTH_ERROR_RESPONSE, createOAuthProviderErrorLogProperties(error));
}

function getOAuthProviderRequestRoute(url: URL): string | undefined {
  if (url.pathname === MCP_ROUTE || url.pathname.startsWith(`${MCP_ROUTE}/`)) {
    return MCP_ROUTE;
  }
  if (url.pathname === MCP_TOKEN_ROUTE) {
    return MCP_TOKEN_ROUTE;
  }
  if (url.pathname === MCP_CLIENT_REGISTRATION_ROUTE) {
    return MCP_CLIENT_REGISTRATION_ROUTE;
  }
  if (url.pathname === OAUTH_AUTHORIZATION_SERVER_METADATA_ROUTE) {
    return OAUTH_AUTHORIZATION_SERVER_METADATA_ROUTE;
  }
  if (
    url.pathname === OAUTH_PROTECTED_RESOURCE_METADATA_ROUTE_PREFIX ||
    url.pathname.startsWith(`${OAUTH_PROTECTED_RESOURCE_METADATA_ROUTE_PREFIX}/`)
  ) {
    return `${OAUTH_PROTECTED_RESOURCE_METADATA_ROUTE_PREFIX}/*`;
  }
}

function createOAuthProviderRequestLogProperties({
  request,
  response,
  route,
  requestId,
  responseTime,
}: {
  request: Request;
  response: Response;
  route: string;
  requestId: string;
  responseTime: number;
}) {
  const url = new URL(request.url);
  const roundedResponseTime = Math.round(responseTime);

  return {
    method: request.method,
    url: url.pathname,
    path: url.pathname,
    status: response.status,
    responseTime: roundedResponseTime,
    message: getApiRequestLogEvent(response.status),
    [OTEL_ATTRS.HTTP_REQUEST_METHOD]: request.method,
    [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CODE]: response.status,
    [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CLASS]: getHttpStatusClass(response.status),
    [OTEL_ATTRS.HTTP_ROUTE]: route,
    [OTEL_ATTRS.REQUEST_ID]: requestId,
    [OTEL_ATTRS.REQUEST_DURATION_MS]: roundedResponseTime,
    [OTEL_ATTRS.URL_PATH]: url.pathname,
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  };
}

function logOAuthProviderRequest({
  request,
  response,
  route,
  requestId,
  startTime,
}: {
  request: Request;
  response: Response;
  route: string;
  requestId: string;
  startTime: number;
}): void {
  oauthProviderRequestLogger.info(
    "{method} {url} {status} - {responseTime} ms",
    createOAuthProviderRequestLogProperties({
      request,
      response,
      route,
      requestId,
      responseTime: performance.now() - startTime,
    }),
  );
}

const appHandler = {
  fetch: nanitesHttpApp.fetch,
} satisfies ExportedHandler<Env>;

const oauthProvider = new OAuthProvider<Env>({
  apiRoute: MCP_ROUTE,
  apiHandler: nanitesMcpApiHandler,
  defaultHandler: appHandler,
  authorizeEndpoint: MCP_AUTHORIZE_ROUTE,
  tokenEndpoint: MCP_TOKEN_ROUTE,
  clientRegistrationEndpoint: MCP_CLIENT_REGISTRATION_ROUTE,
  scopesSupported: [...SUPPORTED_MCP_SCOPES],
  accessTokenTTL: 60 * 60,
  refreshTokenTTL: 30 * 24 * 60 * 60,
  clientRegistrationTTL: 90 * 24 * 60 * 60,
  allowPlainPKCE: false,
  clientIdMetadataDocumentEnabled: true,
  onError: logOAuthProviderErrorResponse,
  tokenExchangeCallback: ({ props, requestedScope }) => {
    const parsedProps = sigveloMcpAuthPropsSchema.safeParse(props);
    if (!parsedProps.success) {
      return;
    }

    const accessTokenProps = downscopeMcpAuthPropsForToken({
      props: parsedProps.data,
      requestedScopes: requestedScope,
    });
    if (accessTokenProps.scopes.length === 0) {
      throw createMcpTokenScopeUnavailableError();
    }

    return {
      accessTokenProps,
      accessTokenScope: accessTokenProps.scopes,
    };
  },
  resourceMetadata: {
    resource_name: "Sigvelo Nanites MCP",
    scopes_supported: [...SUPPORTED_MCP_SCOPES],
    bearer_methods_supported: ["header"],
  },
});

const handler = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const oauthProviderRoute = getOAuthProviderRequestRoute(new URL(request.url));
    const requestId = oauthProviderRoute ? createWorkerRequestId(request) : undefined;
    const startTime = performance.now();
    const response = await oauthProvider.fetch(request, env, executionContext);
    if (oauthProviderRoute && requestId) {
      logOAuthProviderRequest({
        request,
        response,
        route: oauthProviderRoute,
        requestId,
        startTime,
      });
    }

    return response;
  },
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry(createServerSentryOptions, handler);
