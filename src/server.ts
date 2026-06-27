// Wrangler entrypoint ("main" in wrangler.jsonc).
import {
  MCP_ROUTE,
  MCP_AUTHORIZE_ROUTE,
  MCP_TOKEN_ROUTE,
  MCP_CLIENT_REGISTRATION_ROUTE,
  SUPPORTED_MCP_SCOPES,
} from "#/shared/constants.ts";
import {
  OAuthError,
  OAuthProvider,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import { ZodError } from "zod";
import { HostBridgeLoopback } from "@cloudflare/think/extensions";
import { getLogger } from "@logtape/logtape";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { nanitesMcpApiHandler } from "#/backend/mcp/index.ts";
import {
  downscopeMcpAuthPropsForToken,
  INVALID_MCP_AUTH_PROPS_DESCRIPTION,
  sigveloMcpAuthPropsSchema,
} from "#/backend/mcp/index.ts";
import {
  configureAgentLogging,
  createWorkerRequestId,
  getApiRequestLogEvent,
  LOG_EVENTS,
  LOGGING,
  OTEL_ATTRS,
} from "#/backend/logging.ts";
import { createMcpTokenScopeUnavailableError } from "#/backend/errors.ts";
import { requireNanitesEnv, summarizeNanitesEnvIssues } from "#/backend/env.ts";
import { SigveloManagerConversationAgent as BaseSigveloManagerConversationAgent } from "#/backend/agents/SigveloManagerConversationAgent.ts";
import { SigveloNaniteManager as BaseSigveloNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import { NaniteRunWorkflow } from "#/backend/agents/NaniteRunWorkflow.ts";
import { SigveloNaniteAgent as BaseSigveloNaniteAgent } from "#/backend/agents/SigveloNaniteAgent.ts";
import { ThinkMessengerStateAgent } from "@cloudflare/think/messengers";

configureAgentLogging("info");

type OAuthProviderError = Parameters<NonNullable<OAuthProviderOptions<Env>["onError"]>>[0];

const OAUTH_AUTHORIZATION_SERVER_METADATA_ROUTE = "/.well-known/oauth-authorization-server";
const OAUTH_PROTECTED_RESOURCE_METADATA_ROUTE_PREFIX = "/.well-known/oauth-protected-resource";

export class SigveloManagerConversationAgent extends BaseSigveloManagerConversationAgent {}
export class SigveloNaniteManager extends BaseSigveloNaniteManager {}
export class SigveloNaniteAgent extends BaseSigveloNaniteAgent {}

export { HostBridgeLoopback, NaniteRunWorkflow, ThinkMessengerStateAgent };

// The codemode execute tool runs inside a DO facet. Production workerd only
// accepts a facet class through ctx.exports (a loopback namespace), so the
// runtime class must be a worker-entry export; the in-module class fallback
// works in the vitest workerd pool but not in deployed Workers.
export { CodemodeRuntime } from "@cloudflare/think/server-entry";

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
const envLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild("env")
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
    [OTEL_ATTRS.HTTP_REQUEST_METHOD]: request.method,
    [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CODE]: response.status,
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
  const responseTime = performance.now() - startTime;
  oauthProviderRequestLogger.info(
    getApiRequestLogEvent(response.status),
    createOAuthProviderRequestLogProperties({
      request,
      response,
      route,
      requestId,
      responseTime,
    }),
  );
}

const oauthProvider = new OAuthProvider<Env>({
  apiRoute: MCP_ROUTE,
  apiHandler: nanitesMcpApiHandler,
  defaultHandler: { fetch: nanitesHttpApp.fetch },
  authorizeEndpoint: MCP_AUTHORIZE_ROUTE,
  tokenEndpoint: MCP_TOKEN_ROUTE,
  clientRegistrationEndpoint: MCP_CLIENT_REGISTRATION_ROUTE,
  scopesSupported: [...SUPPORTED_MCP_SCOPES],
  accessTokenTTL: 60 * 60,
  refreshTokenTTL: 30 * 24 * 60 * 60,
  clientRegistrationTTL: 90 * 24 * 60 * 60,
  allowPlainPKCE: false,
  clientIdMetadataDocumentEnabled: true,
  onError: (error) =>
    oauthLogger.warn(LOG_EVENTS.OAUTH_ERROR_RESPONSE, createOAuthProviderErrorLogProperties(error)),
  tokenExchangeCallback: ({ props, requestedScope }) => {
    const parsedProps = sigveloMcpAuthPropsSchema.safeParse(props);
    if (!parsedProps.success) {
      throw new OAuthError("invalid_grant", {
        description: INVALID_MCP_AUTH_PROPS_DESCRIPTION,
      });
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
    resource_name: "SigVelo Nanites MCP",
    scopes_supported: [...SUPPORTED_MCP_SCOPES],
    bearer_methods_supported: ["header"],
  },
});

function readRequestEnv(env: Env): Env | Response {
  try {
    return requireNanitesEnv(env);
  } catch (error) {
    envLogger.error("deployment_runtime_config_invalid", {
      [OTEL_ATTRS.EXCEPTION_MESSAGE]:
        error instanceof ZodError ? summarizeNanitesEnvIssues(error.issues) : String(error),
    });
    return Response.json({ code: "deployment_runtime_config_invalid" }, { status: 503 });
  }
}

const handler = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const runtimeEnv = readRequestEnv(env);
    if (runtimeEnv instanceof Response) {
      return runtimeEnv;
    }

    const oauthProviderRoute = getOAuthProviderRequestRoute(new URL(request.url));
    const requestId = oauthProviderRoute ? createWorkerRequestId(request) : undefined;
    const startTime = performance.now();
    const response = await oauthProvider.fetch(request, runtimeEnv, executionContext);
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

export default handler;
