import { honoLogger, type HonoContext } from "@logtape/hono";
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { requestId, type RequestIdVariables } from "hono/request-id";
import { routePath } from "hono/route";
import { agentsMiddleware } from "hono-agents";
import { authorizeAgentRequest } from "#/backend/auth/index.ts";
import {
  requireAuthorizedDeploymentInstallation,
  type DeploymentGitHubInstallation,
} from "#/backend/auth/installations.ts";
import { requireGitHubUserToken, requireSession } from "#/backend/auth/session.ts";
import { AppError, handleAppError } from "#/backend/errors.ts";
import { browserAuthApiRoutes, browserAuthRoutes } from "#/backend/api/routes/auth.ts";
import { githubWebhookRoutes } from "#/backend/api/routes/github.ts";
import { mcpOAuthRoutes } from "#/backend/api/routes/mcp.ts";
import { nanitesApiRoutes } from "#/backend/api/routes/nanites.ts";
import { observabilityApiRoutes } from "#/backend/api/routes/observability.ts";
import {
  createWorkerRequestId,
  getApiRequestLogEvent,
  LOGGING,
  OTEL_ATTRS,
} from "#/backend/logging.ts";

type WorkerHonoVariables = RequestIdVariables;

export type WorkerHonoEnv = {
  Bindings: Env;
  Variables: WorkerHonoVariables;
};

export type DeploymentInstallationHonoEnv = {
  Bindings: Env;
  Variables: WorkerHonoVariables & {
    deploymentInstallation: DeploymentGitHubInstallation;
  };
};

export type WorkerContext = Context<WorkerHonoEnv>;
export type DeploymentInstallationContext = Context<DeploymentInstallationHonoEnv>;

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

const deploymentInstallationAuthRequired = createMiddleware<DeploymentInstallationHonoEnv>(
  async (context, next) => {
    await requireSession(context.req.raw, context.env);
    const githubUserToken = await requireGitHubUserToken(
      context.req.raw,
      context.env,
      context.res.headers,
    );
    const deploymentInstallation = await requireAuthorizedDeploymentInstallation({
      env: context.env,
      githubUserToken,
    });

    context.set("deploymentInstallation", deploymentInstallation);
    await next();
  },
);

const deploymentInstallationApiRoutes = new Hono<DeploymentInstallationHonoEnv>()
  .use("*", deploymentInstallationAuthRequired)
  .route("/nanites", nanitesApiRoutes)
  .route("/observability", observabilityApiRoutes);

export const nanitesHttpApp = app
  .route("/", browserAuthRoutes)
  .route("/", mcpOAuthRoutes)
  .route("/", githubWebhookRoutes)
  .route("/api/auth", browserAuthApiRoutes)
  .route("/api", deploymentInstallationApiRoutes);

nanitesHttpApp.use("/agents/*", async (context, next) => {
  const middleware = agentsMiddleware<WorkerHonoEnv>({
    options: {
      onBeforeConnect: (request) =>
        authorizeAgentRequest(request, context.env, context.get("requestId")),
      onBeforeRequest: (request) =>
        authorizeAgentRequest(request, context.env, context.get("requestId")),
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
