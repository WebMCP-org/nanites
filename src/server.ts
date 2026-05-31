// Wrangler entrypoint ("main" in wrangler.jsonc).
import "#/backend/orpc/instrumentation.ts";
import * as Sentry from "@sentry/cloudflare";
import { OAuthError, OAuthProvider } from "@cloudflare/workers-oauth-provider";
export { HostBridgeLoopback } from "@cloudflare/think/extensions";
import { getAgentByName, routeAgentRequest } from "agents";
import { getLogger } from "@logtape/logtape";
import { LOG_EVENTS } from "@nanites/observability/log-events";
import { LOGGING } from "@nanites/observability/logging";
import { setActiveSpanAttributes, withActiveSpan } from "@nanites/observability/otel";
import { OTEL_ATTRS } from "@nanites/observability/otel-attrs";
import { createDbClient } from "@nanites/db/client";
import { authorizeAdminRequest, buildAdminUnauthorizedErrorData } from "#/backend/admin-auth.ts";
import { ADMIN_API_PREFIX, API_PREFIX } from "#/shared/constants/openapi-document.ts";
import { authorizeAgentRequest } from "#/backend/agents/request-auth.ts";
import { handleBrowserAuthRequest } from "#/backend/browser-auth/routes.ts";
import { handleTestAuthRequest } from "#/backend/browser-auth/test-auth.ts";
import { handleGitHubWebhook } from "#/backend/github.ts";
import {
  handleMcpOAuthAuthorizeContextRequest,
  handleMcpOAuthAuthorizeRequest,
} from "#/backend/mcp/oauth.ts";
import { nanitesMcpApiHandler } from "#/backend/mcp/server.ts";
import {
  adminOpenAPIHandler,
  adminRpcHandler,
  getOpenAPIDocument,
  openAPIHandler,
  rpcHandler,
} from "#/backend/orpc/orpc.ts";
import { createServerSentryOptions } from "#/backend/sentry.ts";
import {
  MCP_AUTHORIZE_ROUTE,
  MCP_AUTHORIZE_CONTEXT_ROUTE,
  MCP_CLIENT_REGISTRATION_ROUTE,
  MCP_ROUTE,
  MCP_TOKEN_ROUTE,
  SUPPORTED_MCP_SCOPES,
} from "#/shared/constants/mcp.ts";
import {
  downscopeMcpAuthPropsForToken,
  sigveloMcpAuthPropsSchema,
} from "#/backend/mcp/auth-context.ts";
import { ADMIN_RPC_PREFIX, RPC_PREFIX } from "#/shared/constants/rpc.ts";
import { configureAgentLogging } from "#/shared/logger.ts";

configureAgentLogging("info");

const workerLogger = getLogger(LOGGING.SERVER_CATEGORY).with({
  [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
});

// Keep Sentry at the Worker boundary. Agents/Think already manages the Durable Object
// WebSocket context, and Sentry's DO wrapper rewraps waitUntil recursively on those routes.
export { ChatSdkStateAgent } from "agents/chat-sdk";
export { SigveloChatIngress } from "#/backend/chat-ingress.ts";
export { SigveloMcpAgent } from "#/backend/mcp/server.ts";
export { SigveloManagerConversationAgent } from "#/backend/manager-conversation-agent.ts";
export { SigveloNaniteManager } from "#/backend/nanites/host.ts";
export { SigveloNaniteAgent } from "#/backend/nanites/agent.ts";

class DeletedDurableObjectClass {
  fetch(): Response {
    return new Response("This Durable Object class has been removed.", { status: 410 });
  }
}

export class ChatAgent extends DeletedDurableObjectClass {}
export class RepoAgent extends DeletedDurableObjectClass {}
export class NaniteRunAgent extends DeletedDurableObjectClass {}
export class NaniteManager extends DeletedDurableObjectClass {}
export class Nanite extends DeletedDurableObjectClass {}
export class Sandbox extends DeletedDurableObjectClass {}
export class GeneratedNanite extends DeletedDurableObjectClass {}
export class LegacyNaniteManager20260518 extends DeletedDurableObjectClass {}
export class LegacyGeneratedNanite20260518 extends DeletedDurableObjectClass {}
export class NaniteAgent extends DeletedDurableObjectClass {}

function shouldInstrumentD1(env: Env): boolean {
  return env.SENTRY_ENVIRONMENT !== "local" && env.SENTRY_ENVIRONMENT !== "development";
}

function setRouteResponseAttributes(routeTarget: string, response: Response): void {
  setActiveSpanAttributes({
    [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CODE]: response.status,
    [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CLASS]: `${Math.trunc(response.status / 100)}xx`,
    [OTEL_ATTRS.ROUTE_TARGET]: routeTarget,
  });
}

function isRequestUnderPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function createAdminUnauthorizedResponse(): Response {
  return new Response(JSON.stringify(buildAdminUnauthorizedErrorData()), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function handleGitHubChatSdkWebhook(request: Request, env: Env): Promise<Response> {
  const ingress = await getAgentByName(env.SigveloChatIngress, "default");
  return ingress.fetch(request);
}

async function traceRouteResponse<TResponse extends Response | null>({
  spanName,
  httpRoute,
  routeTarget,
  requestId,
  handler,
}: {
  spanName: string;
  httpRoute: string;
  routeTarget: string;
  requestId: string;
  handler: () => Promise<TResponse>;
}): Promise<TResponse> {
  const response = await withActiveSpan(
    spanName,
    {
      [OTEL_ATTRS.HTTP_ROUTE]: httpRoute,
      [OTEL_ATTRS.ROUTE_TARGET]: routeTarget,
      [OTEL_ATTRS.REQUEST_ID]: requestId,
    },
    handler,
  );

  if (response) {
    setRouteResponseAttributes(routeTarget, response);
  }

  return response;
}

const appHandler = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const e = env;
    const requestId = crypto.randomUUID();
    const requestStartedAt = Date.now();
    const url = new URL(request.url);
    const db = createDbClient(shouldInstrumentD1(e) ? Sentry.instrumentD1WithSentry(e.DB) : e.DB);
    const requestLogger = workerLogger.getChild(LOGGING.REQUEST_CHILD_CATEGORY).with({
      [OTEL_ATTRS.HTTP_REQUEST_METHOD]: request.method,
      [OTEL_ATTRS.URL_PATH]: url.pathname,
      [OTEL_ATTRS.REQUEST_ID]: requestId,
    });
    const completeResponse = (
      response: Response,
      routeTarget: string,
      httpRoute: string,
    ): Response => {
      const durationMs = Date.now() - requestStartedAt;
      const statusClass = `${Math.trunc(response.status / 100)}xx`;

      setActiveSpanAttributes({
        [OTEL_ATTRS.HTTP_ROUTE]: httpRoute,
        [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CODE]: response.status,
        [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CLASS]: statusClass,
        [OTEL_ATTRS.REQUEST_DURATION_MS]: durationMs,
        [OTEL_ATTRS.ROUTE_TARGET]: routeTarget,
      });

      requestLogger.info(LOG_EVENTS.API_REQUEST_COMPLETED, {
        [OTEL_ATTRS.HTTP_ROUTE]: httpRoute,
        [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CODE]: response.status,
        [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CLASS]: statusClass,
        [OTEL_ATTRS.REQUEST_DURATION_MS]: durationMs,
        [OTEL_ATTRS.ROUTE_TARGET]: routeTarget,
      });

      return response;
    };

    setActiveSpanAttributes({
      [OTEL_ATTRS.HTTP_REQUEST_METHOD]: request.method,
      [OTEL_ATTRS.URL_FULL]: url.toString(),
      [OTEL_ATTRS.URL_PATH]: url.pathname,
      [OTEL_ATTRS.REQUEST_ID]: requestId,
    });

    if (e.ALLOW_TEST_AUTH === "true") {
      const testAuthResponse = await traceRouteResponse({
        spanName: "auth.test",
        httpRoute: "/auth/test",
        routeTarget: "test-auth",
        requestId,
        handler: () => handleTestAuthRequest({ request, env: e }),
      });
      if (testAuthResponse) {
        return completeResponse(testAuthResponse, "test-auth", "/auth/test");
      }
    }

    const mcpAuthorizeResponse = await traceRouteResponse({
      spanName: "mcp.oauth.authorize",
      httpRoute: MCP_AUTHORIZE_ROUTE,
      routeTarget: "mcp-oauth-authorize",
      requestId,
      handler: () => handleMcpOAuthAuthorizeRequest({ request, env: e }),
    });
    if (mcpAuthorizeResponse) {
      return completeResponse(mcpAuthorizeResponse, "mcp-oauth-authorize", MCP_AUTHORIZE_ROUTE);
    }

    const browserAuthResponse = await traceRouteResponse({
      spanName: "auth.browser",
      httpRoute: "/auth/*",
      routeTarget: "browser-auth",
      requestId,
      handler: () => handleBrowserAuthRequest({ request, env: e }),
    });
    if (browserAuthResponse) {
      return completeResponse(browserAuthResponse, "browser-auth", "/auth/*");
    }

    if (request.method === "POST" && url.pathname === "/api/github/webhook") {
      const gitHubEvent = request.headers.get("x-github-event");
      if (gitHubEvent === "ping") {
        return completeResponse(new Response("pong"), "github-webhook", "/api/github/webhook");
      }

      if (gitHubEvent === "issue_comment" || gitHubEvent === "pull_request_review_comment") {
        return completeResponse(
          await traceRouteResponse({
            spanName: "github.chat_sdk_webhook",
            httpRoute: "/api/github/webhook",
            routeTarget: "github-chat-sdk-webhook",
            requestId,
            handler: () => handleGitHubChatSdkWebhook(request, e),
          }),
          "github-chat-sdk-webhook",
          "/api/github/webhook",
        );
      }

      return completeResponse(
        await traceRouteResponse({
          spanName: "github.webhook",
          httpRoute: "/api/github/webhook",
          routeTarget: "github-webhook",
          requestId,
          handler: () => handleGitHubWebhook(request, e, executionContext),
        }),
        "github-webhook",
        "/api/github/webhook",
      );
    }

    if (request.method === "GET" && url.pathname === "/api/spec.json") {
      return completeResponse(
        Response.json(await getOpenAPIDocument(), {
          headers: {
            "cache-control": "no-store",
          },
        }),
        "openapi-document",
        "/api/spec.json",
      );
    }

    const mcpAuthorizeContextResponse = await traceRouteResponse({
      spanName: "mcp.oauth.authorize_context",
      httpRoute: MCP_AUTHORIZE_CONTEXT_ROUTE,
      routeTarget: "mcp-oauth-authorize-context",
      requestId,
      handler: () => handleMcpOAuthAuthorizeContextRequest({ request, env: e }),
    });
    if (mcpAuthorizeContextResponse) {
      return completeResponse(
        mcpAuthorizeContextResponse,
        "mcp-oauth-authorize-context",
        MCP_AUTHORIZE_CONTEXT_ROUTE,
      );
    }

    const apiResult = await withActiveSpan(
      "http.openapi.handle",
      {
        [OTEL_ATTRS.HTTP_ROUTE]: API_PREFIX,
        [OTEL_ATTRS.ROUTE_TARGET]: "openapi",
        [OTEL_ATTRS.REQUEST_ID]: requestId,
      },
      () =>
        openAPIHandler.handle(request, {
          prefix: API_PREFIX,
          context: { req: request, env: e, db, requestId, logger: requestLogger },
        }),
    );

    if (apiResult.matched) {
      setRouteResponseAttributes("openapi", apiResult.response);
      return completeResponse(apiResult.response, "openapi", API_PREFIX);
    }

    const adminApiResult = await withActiveSpan(
      "http.admin_openapi.handle",
      {
        [OTEL_ATTRS.HTTP_ROUTE]: ADMIN_API_PREFIX,
        [OTEL_ATTRS.ROUTE_TARGET]: "admin-openapi",
        [OTEL_ATTRS.REQUEST_ID]: requestId,
      },
      async () => {
        if (isRequestUnderPrefix(url.pathname, ADMIN_API_PREFIX)) {
          const adminAccess = await authorizeAdminRequest(request, e);
          if (!adminAccess.ok) {
            return {
              matched: true,
              response: createAdminUnauthorizedResponse(),
            };
          }
        }

        return adminOpenAPIHandler.handle(request, {
          prefix: ADMIN_API_PREFIX,
          context: { req: request, env: e, db, requestId, logger: requestLogger },
        });
      },
    );

    if (adminApiResult.matched) {
      setRouteResponseAttributes("admin-openapi", adminApiResult.response);
      return completeResponse(adminApiResult.response, "admin-openapi", ADMIN_API_PREFIX);
    }

    const adminRpcResult = await withActiveSpan(
      "http.admin_rpc.handle",
      {
        [OTEL_ATTRS.HTTP_ROUTE]: ADMIN_RPC_PREFIX,
        [OTEL_ATTRS.ROUTE_TARGET]: "admin-rpc",
        [OTEL_ATTRS.REQUEST_ID]: requestId,
      },
      () =>
        adminRpcHandler.handle(request, {
          prefix: ADMIN_RPC_PREFIX,
          context: { req: request, env: e, db, requestId, logger: requestLogger },
        }),
    );

    if (adminRpcResult.matched) {
      setRouteResponseAttributes("admin-rpc", adminRpcResult.response);
      return completeResponse(adminRpcResult.response, "admin-rpc", ADMIN_RPC_PREFIX);
    }

    const rpcResult = await withActiveSpan(
      "http.rpc.handle",
      {
        [OTEL_ATTRS.HTTP_ROUTE]: RPC_PREFIX,
        [OTEL_ATTRS.ROUTE_TARGET]: "rpc",
        [OTEL_ATTRS.REQUEST_ID]: requestId,
      },
      () =>
        rpcHandler.handle(request, {
          prefix: RPC_PREFIX,
          context: { req: request, env: e, db, requestId, logger: requestLogger },
        }),
    );

    if (rpcResult.matched) {
      setRouteResponseAttributes("rpc", rpcResult.response);
      return completeResponse(rpcResult.response, "rpc", RPC_PREFIX);
    }

    const agentResponse = await traceRouteResponse({
      spanName: "agents.route",
      httpRoute: "/agents/*",
      routeTarget: "agents",
      requestId,
      handler: () =>
        routeAgentRequest(request, e, {
          onBeforeConnect: (req) => authorizeAgentRequest(req, e),
          onBeforeRequest: (req) => authorizeAgentRequest(req, e),
        }),
    });
    if (agentResponse) {
      return completeResponse(agentResponse, "agents", "/agents/*");
    }

    requestLogger.warn(LOG_EVENTS.API_REQUEST_NOT_FOUND);
    return completeResponse(new Response("Not found", { status: 404 }), "not-found", "unmatched");
  },
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
      throw new OAuthError("invalid_scope", {
        description: "The requested token scope is not available on this Sigvelo MCP grant.",
      });
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
    return oauthProvider.fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry(createServerSentryOptions, handler);
