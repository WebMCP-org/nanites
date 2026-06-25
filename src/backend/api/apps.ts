import { NANITES_SETUP_AGENT_NAME, NANITES_SETUP_AGENT_INSTANCE_NAME } from "#/shared/constants.ts";
import { honoLogger, type HonoContext } from "@logtape/hono";
import { Hono, type Context } from "hono";
import { requestId, type RequestIdVariables } from "hono/request-id";
import { routePath } from "hono/route";
import { agentsMiddleware } from "hono-agents";
import { authorizeAgentRequest } from "#/backend/auth/index.ts";
import { AppError, handleAppError } from "#/backend/errors.ts";
import { browserAuthApiRoutes, browserAuthRoutes } from "#/backend/api/routes/auth.ts";
import { clientConfigRoutes } from "#/backend/api/routes/client-config.ts";
import { githubWebhookRoutes } from "#/backend/api/routes/github.ts";
import { mcpOAuthRoutes } from "#/backend/api/routes/mcp.ts";
import { nanitesApiRoutes } from "#/backend/api/routes/nanites.ts";
import { observabilityApiRoutes } from "#/backend/api/routes/observability.ts";
import { setupRoutes } from "#/backend/api/routes/setup.ts";
import {
  createWorkerRequestId,
  getApiRequestLogEvent,
  LOGGING,
  OTEL_ATTRS,
} from "#/backend/logging.ts";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { GitHubUserToken } from "#/backend/github/index.ts";
import type { NanitesSession } from "#/backend/auth/session.ts";

export type WorkerHonoEnv = {
  Bindings: Env;
  Variables: RequestIdVariables & {
    browserSession: NanitesSession;
    githubUserToken: GitHubUserToken;
    mcpAuthRequest: AuthRequest;
    mcpOAuthProvider: OAuthHelpers;
  };
};

export type WorkerContext = Context<WorkerHonoEnv>;

function createRequestLogProperties(context: HonoContext, responseTime: number) {
  const url = new URL(context.req.url);
  const status = context.res.status;

  return {
    message: getApiRequestLogEvent(status),
    [OTEL_ATTRS.HTTP_REQUEST_METHOD]: context.req.method,
    [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CODE]: status,
    [OTEL_ATTRS.HTTP_ROUTE]: routePath(context, -1),
    [OTEL_ATTRS.REQUEST_ID]: context.get("requestId"),
    [OTEL_ATTRS.REQUEST_DURATION_MS]: Math.round(responseTime),
    [OTEL_ATTRS.URL_PATH]: url.pathname,
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  };
}

const app = new Hono<WorkerHonoEnv>();
const SETUP_AGENT_ROUTE_PREFIX = `/agents/${NANITES_SETUP_AGENT_NAME}/${NANITES_SETUP_AGENT_INSTANCE_NAME}`;

app.onError(handleAppError);

app.use(
  "*",
  requestId({
    generator: (context) => createWorkerRequestId(context.req.raw),
  }),
);

app.use(
  "*",
  honoLogger({
    category: [...LOGGING.SERVER_CATEGORY, LOGGING.REQUEST_CHILD_CATEGORY],
    format: createRequestLogProperties,
  }),
);

export const nanitesHttpApp = app
  .route("/", browserAuthRoutes)
  .route("/", mcpOAuthRoutes)
  .route("/", githubWebhookRoutes)
  .route("/", setupRoutes)
  .route("/api/auth", browserAuthApiRoutes)
  .route("/api/client-config", clientConfigRoutes)
  .route("/api/nanites", nanitesApiRoutes)
  .route("/api/observability", observabilityApiRoutes);

// Local-development setup (/setup/local) exists only in dev servers and test
// runs: the dynamic import behind the DEV gate keeps the module out of
// production bundles entirely.
if (import.meta.env.DEV) {
  const { devLocalSetupRoutes } = await import("#/backend/api/routes/dev-setup.ts");
  nanitesHttpApp.route("/", devLocalSetupRoutes);
}

nanitesHttpApp.use("/agents/*", async (context, next) => {
  if (new URL(context.req.url).pathname.startsWith(SETUP_AGENT_ROUTE_PREFIX)) {
    const middleware = agentsMiddleware<WorkerHonoEnv>();
    return middleware(context, next);
  }

  const middleware = agentsMiddleware<WorkerHonoEnv>({
    options: {
      onBeforeConnect: (request) => authorizeAgentRequest(request, context.env),
      onBeforeRequest: (request) => authorizeAgentRequest(request, context.env),
    },
  });

  return middleware(context, next);
});

nanitesHttpApp.notFound((context) => {
  const pathname = new URL(context.req.url).pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    throw new AppError("apiRouteNotFound");
  }

  return context.text("Not found", 404);
});

export type NanitesHttpApp = typeof nanitesHttpApp;
