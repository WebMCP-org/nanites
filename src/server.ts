// Wrangler entrypoint ("main" in wrangler.jsonc).
import * as Sentry from "@sentry/cloudflare";
import { OAuthError, OAuthProvider } from "@cloudflare/workers-oauth-provider";
export { HostBridgeLoopback } from "@cloudflare/think/extensions";
import { nanitesHttpApp } from "#/backend/http.ts";
import { SigveloMcpAgent } from "#/backend/mcp/server.ts";
import {
  MCP_AUTHORIZE_ROUTE,
  MCP_CLIENT_REGISTRATION_ROUTE,
  MCP_ROUTE,
  MCP_TOKEN_ROUTE,
  SUPPORTED_MCP_SCOPES,
} from "#/shared/constants/mcp.ts";
import {
  downscopeMcpAuthPropsForToken,
  sigveloMcpAuthPropsSchema,
} from "#/backend/mcp/auth-context.ts";
import { configureAgentLogging } from "#/shared/logger.ts";
import { parseSamplingRate } from "#/shared/observability/sampling.ts";

configureAgentLogging("info");

const DEFAULT_LOCAL_TRACES_SAMPLE_RATE = 1;
const DEFAULT_REMOTE_TRACES_SAMPLE_RATE = 0.1;

// Keep Sentry at the Worker boundary. Agents/Think already manages the Durable Object
// WebSocket context, and Sentry's DO wrapper rewraps waitUntil recursively on those routes.
export { ChatSdkStateAgent } from "agents/chat-sdk";
export { SigveloChatIngress } from "#/backend/nanites/chat-ingress.ts";
export { SigveloMcpAgent } from "#/backend/mcp/server.ts";
export { SigveloManagerConversationAgent } from "#/backend/nanites/manager-conversation-agent.ts";
export { SigveloNaniteManager } from "#/backend/nanites/host.ts";
export { SigveloNaniteAgent } from "#/backend/nanites/agent.ts";

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

const appHandler = {
  fetch: nanitesHttpApp.fetch,
} satisfies ExportedHandler<Env>;

const oauthProvider = new OAuthProvider<Env>({
  apiRoute: MCP_ROUTE,
  apiHandler: SigveloMcpAgent.serve(MCP_ROUTE, {
    binding: "SigveloMcpAgent",
  }),
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
