import * as Sentry from "@sentry/cloudflare";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIGenerator, oo, type OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { RPCHandler } from "@orpc/server/fetch";
import { ORPCError, onError, os } from "@orpc/server";
import { ResponseHeadersPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { LOG_EVENTS } from "@nanites/observability/log-events";
import { withActiveSpan } from "@nanites/observability/otel";
import { OTEL_ATTRS } from "@nanites/observability/otel-attrs";
import {
  AUTH_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  installationProcedureErrors,
  sessionProcedureErrors,
} from "@nanites/contracts/auth";
import { adminProcedureErrors as adminErrorsContract } from "@nanites/contracts/admin";
import {
  ActiveInstallationRequiredError,
  appendExpiredAuthCookies,
  extendBrowserSession,
  getActorFromSession,
  AuthenticationRequiredError,
  isGitHubUserTokenAuthFailure,
  requireGitHubUserToken,
  requireSession,
  toActiveInstallations,
} from "#/backend/browser-auth/session.ts";
import { authorizeAdminRequest, buildAdminUnauthorizedErrorData } from "#/backend/admin-auth.ts";
import { listVisibleInstallations } from "#/backend/github.ts";
import { revalidateSelectedActiveInstallation } from "#/backend/browser-auth/revalidation.ts";
import { baseErrors, buildInternalErrorData } from "#/backend/orpc/errors.ts";
import type { BaseContext } from "#/backend/orpc/context.ts";
import type { AppRouter } from "#/backend/orpc/router.ts";
import type { AdminRouter } from "#/backend/orpc/routers/admin.ts";
import {
  adminAccessSecurity,
  browserRevalidationSecurity,
  browserSessionSecurity,
  buildAdminOpenAPIGenerateOptions,
  buildPublicOpenAPIGenerateOptions,
} from "#/backend/orpc/openapi-contract.ts";
import {
  ADMIN_API_DOCS_PATH,
  ADMIN_API_PREFIX,
  ADMIN_API_SPEC_PATH,
  API_DOCS_PATH,
  API_PREFIX,
  API_SPEC_PATH,
} from "#/shared/constants/openapi-document.ts";

const schemaConverters = [new ZodToJsonSchemaConverter()];
const openApiGenerator = new OpenAPIGenerator({ schemaConverters });
const OPENAPI_INFO = {
  title: "Nanites API",
  version: "0.1.0",
  description: "GitHub-native maintenance layer for AI-accelerated codebases.",
} as const;
const ADMIN_OPENAPI_INFO = {
  title: "Nanites Admin API",
  version: "0.1.0",
  description: "Internal admin telemetry, account, and usage APIs for SigVelo operators.",
} as const;
const OPENAPI_SPEC_GENERATE_OPTIONS = buildPublicOpenAPIGenerateOptions(OPENAPI_INFO);
const ADMIN_OPENAPI_SPEC_GENERATE_OPTIONS = buildAdminOpenAPIGenerateOptions(ADMIN_OPENAPI_INFO);

const baseProcedure = os.$context<BaseContext>().use(async ({ context, next, path }) => {
  const rpcMethod = typeof path === "string" ? path : path.join(".");

  return await withActiveSpan(
    "orpc.procedure",
    {
      [OTEL_ATTRS.RPC_SYSTEM]: "orpc",
      [OTEL_ATTRS.RPC_METHOD]: rpcMethod,
      [OTEL_ATTRS.URL_PATH]: new URL(context.req.url).pathname,
      [OTEL_ATTRS.REQUEST_ID]: context.requestId,
    },
    async () => {
      try {
        return await next();
      } catch (error) {
        if (error instanceof ORPCError) {
          throw error;
        }

        Sentry.captureException(error);

        context.logger.error(LOG_EVENTS.API_UNHANDLED_ERROR, {
          [OTEL_ATTRS.REQUEST_ID]: context.requestId,
          [OTEL_ATTRS.ERROR_TYPE]: getErrorType(error),
          [OTEL_ATTRS.EXCEPTION_MESSAGE]: getErrorMessage(error),
          error,
        });

        const errorData = buildInternalErrorData(context.requestId);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          defined: true,
          message: errorData.message,
          data: errorData,
          cause: error,
        });
      }
    },
  );
});

export const baseOrpc = baseProcedure;
export const publicProcedure = baseProcedure.errors(baseErrors);

/**
 * Rethrows `AuthenticationRequiredError` as an oRPC UNAUTHORIZED error after
 * clearing stale auth cookies. All other errors propagate unchanged.
 */
async function rethrowAsUnauthorized<T>(
  fn: () => Promise<T>,
  context: BaseContext,
  errors: {
    UNAUTHORIZED: (opts: {
      data: {
        code: typeof AUTH_ERROR_CODES.authenticationRequired;
        message: typeof AUTH_ERROR_MESSAGES.authenticationRequired;
      };
    }) => unknown;
  },
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError || isGitHubUserTokenAuthFailure(error)) {
      appendExpiredAuthCookies(context.req, context.resHeaders);
      throw errors.UNAUTHORIZED({
        data: {
          code: AUTH_ERROR_CODES.authenticationRequired,
          message: AUTH_ERROR_MESSAGES.authenticationRequired,
        },
      });
    }

    throw error;
  }
}

export const sessionProcedure = publicProcedure
  .errors({
    UNAUTHORIZED: oo.spec(sessionProcedureErrors.UNAUTHORIZED, {
      security: browserSessionSecurity,
    }),
  })
  .use(async ({ context, next, errors }) => {
    const session = await rethrowAsUnauthorized(
      () => requireSession(context.req, context.env),
      context,
      errors,
    );
    return next({
      context: {
        actor: getActorFromSession(session),
        session,
      },
    });
  });

const githubRevalidationProcedureErrors = {
  UNAUTHORIZED: oo.spec(sessionProcedureErrors.UNAUTHORIZED, {
    security: browserRevalidationSecurity,
  }),
} as const;

export const githubRevalidationProcedure = sessionProcedure
  .errors(githubRevalidationProcedureErrors)
  .use(async ({ context, next, errors }) => {
    const { githubUserToken, session } = await rethrowAsUnauthorized(
      async () => ({
        githubUserToken: await requireGitHubUserToken(context.req, context.env, {
          responseHeaders: context.resHeaders,
        }),
        session: await extendBrowserSession(
          context.req,
          context.env,
          context.session,
          context.resHeaders,
        ),
      }),
      context,
      errors,
    );
    try {
      return await next({
        context: {
          actor: getActorFromSession(session),
          githubUserToken,
          session,
        },
      });
    } catch (error) {
      if (isGitHubUserTokenAuthFailure(error)) {
        appendExpiredAuthCookies(context.req, context.resHeaders);
        throw errors.UNAUTHORIZED({
          data: {
            code: AUTH_ERROR_CODES.authenticationRequired,
            message: AUTH_ERROR_MESSAGES.authenticationRequired,
          },
        });
      }

      throw error;
    }
  });

export const installationRevalidationProcedure = sessionProcedure
  .errors({
    ...githubRevalidationProcedureErrors,
    ...installationProcedureErrors,
  })
  .use(async ({ context, next, errors }) => {
    const { githubUserToken, session } = await rethrowAsUnauthorized(
      async () => ({
        githubUserToken: await requireGitHubUserToken(context.req, context.env, {
          responseHeaders: context.resHeaders,
        }),
        session: await extendBrowserSession(
          context.req,
          context.env,
          context.session,
          context.resHeaders,
        ),
      }),
      context,
      errors,
    );
    try {
      const activeInstallations = toActiveInstallations(
        await listVisibleInstallations(githubUserToken.accessToken),
      );
      const revalidation = await revalidateSelectedActiveInstallation({
        req: context.req,
        env: context.env,
        session,
        resHeaders: context.resHeaders,
        activeInstallations,
      });

      if (revalidation.status === "revoked") {
        throw errors.FORBIDDEN({
          data: {
            code: AUTH_ERROR_CODES.installationAccessRevoked,
            message: AUTH_ERROR_MESSAGES.installationAccessRevoked,
            githubInstallationId: revalidation.githubInstallationId,
          },
        });
      }

      return await next({
        context: {
          activeInstallation: revalidation.activeInstallation,
          actor: getActorFromSession(session),
          githubUserToken,
          session,
        },
      });
    } catch (error) {
      if (error instanceof ActiveInstallationRequiredError) {
        throw errors.BAD_REQUEST({
          data: {
            code: AUTH_ERROR_CODES.activeInstallationRequired,
            message: AUTH_ERROR_MESSAGES.activeInstallationRequired,
          },
        });
      }

      if (isGitHubUserTokenAuthFailure(error)) {
        appendExpiredAuthCookies(context.req, context.resHeaders);
        throw errors.UNAUTHORIZED({
          data: {
            code: AUTH_ERROR_CODES.authenticationRequired,
            message: AUTH_ERROR_MESSAGES.authenticationRequired,
          },
        });
      }

      throw error;
    }
  });

export const adminBaseProcedure = publicProcedure
  .errors({
    UNAUTHORIZED: oo.spec(adminErrorsContract.UNAUTHORIZED, {
      security: adminAccessSecurity,
    }),
  })
  .use(async ({ context, next, errors }) => {
    const adminAccess = await authorizeAdminRequest(context.req, context.env);
    if (!adminAccess.ok) {
      throw errors.UNAUTHORIZED({
        data: buildAdminUnauthorizedErrorData(),
      });
    }

    return next({
      context: {
        adminActor: adminAccess.actor,
      },
    });
  });

let cachedOpenAPIDocument: Awaited<ReturnType<OpenAPIGenerator["generate"]>> | null = null;
let cachedAdminOpenAPIDocument: Awaited<ReturnType<OpenAPIGenerator["generate"]>> | null = null;

function toOpenAPIHandlerPath(path: string, prefix: string): `/${string}` {
  return path.slice(prefix.length) as `/${string}`;
}

function getErrorType(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return "INTERNAL_SERVER_ERROR";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function buildOpenAPIHandler(
  router: AppRouter | AdminRouter,
  {
    docsPath,
    docsTitle,
    specGenerateOptions,
    specPath,
  }: {
    docsPath: `/${string}`;
    docsTitle: string;
    specGenerateOptions: OpenAPIGeneratorGenerateOptions;
    specPath: `/${string}`;
  },
) {
  return new OpenAPIHandler(router, {
    interceptors: [
      onError((error, options) => {
        options.context.logger.error(LOG_EVENTS.API_REQUEST_FAILED, {
          [OTEL_ATTRS.HTTP_REQUEST_METHOD]: options.request.method,
          [OTEL_ATTRS.URL_PATH]: new URL(options.request.url).pathname,
          [OTEL_ATTRS.REQUEST_ID]: options.context.requestId,
          [OTEL_ATTRS.ERROR_TYPE]: getErrorType(error),
          [OTEL_ATTRS.EXCEPTION_MESSAGE]: getErrorMessage(error),
          error,
        });
      }),
    ],
    plugins: [
      new SmartCoercionPlugin({ schemaConverters }),
      new ResponseHeadersPlugin(),
      new OpenAPIReferencePlugin({
        docsPath,
        docsProvider: "scalar",
        docsTitle,
        specPath,
        schemaConverters,
        specGenerateOptions,
      }),
    ],
  });
}

async function getOpenAPIHandler() {
  const { appRouter } = await import("#/backend/orpc/router.ts");

  return buildOpenAPIHandler(appRouter, {
    docsPath: toOpenAPIHandlerPath(API_DOCS_PATH, API_PREFIX),
    docsTitle: "Nanites API Reference",
    specGenerateOptions: OPENAPI_SPEC_GENERATE_OPTIONS,
    specPath: toOpenAPIHandlerPath(API_SPEC_PATH, API_PREFIX),
  });
}

export async function getOpenAPIDocument() {
  if (cachedOpenAPIDocument) {
    return cachedOpenAPIDocument;
  }

  const { appRouter } = await import("#/backend/orpc/router.ts");
  cachedOpenAPIDocument = await openApiGenerator.generate(appRouter, OPENAPI_SPEC_GENERATE_OPTIONS);

  return cachedOpenAPIDocument;
}

async function getAdminOpenAPIHandler() {
  const { adminRouter } = await import("#/backend/orpc/routers/admin.ts");

  return buildOpenAPIHandler(adminRouter, {
    docsPath: toOpenAPIHandlerPath(ADMIN_API_DOCS_PATH, ADMIN_API_PREFIX),
    docsTitle: "Nanites Admin API Reference",
    specGenerateOptions: ADMIN_OPENAPI_SPEC_GENERATE_OPTIONS,
    specPath: toOpenAPIHandlerPath(ADMIN_API_SPEC_PATH, ADMIN_API_PREFIX),
  });
}

export async function getAdminOpenAPIDocument() {
  if (cachedAdminOpenAPIDocument) {
    return cachedAdminOpenAPIDocument;
  }

  const { adminRouter } = await import("#/backend/orpc/routers/admin.ts");
  cachedAdminOpenAPIDocument = await openApiGenerator.generate(
    adminRouter,
    ADMIN_OPENAPI_SPEC_GENERATE_OPTIONS,
  );

  return cachedAdminOpenAPIDocument;
}

async function getRPCHandler() {
  const { appRouter } = await import("#/backend/orpc/router.ts");

  return new RPCHandler(appRouter, {
    interceptors: [
      onError((error, options) => {
        options.context.logger.error(LOG_EVENTS.API_REQUEST_FAILED, {
          [OTEL_ATTRS.HTTP_REQUEST_METHOD]: options.request.method,
          [OTEL_ATTRS.URL_PATH]: new URL(options.request.url).pathname,
          [OTEL_ATTRS.REQUEST_ID]: options.context.requestId,
          [OTEL_ATTRS.ERROR_TYPE]: getErrorType(error),
          [OTEL_ATTRS.EXCEPTION_MESSAGE]: getErrorMessage(error),
          error,
        });
      }),
    ],
    plugins: [new ResponseHeadersPlugin()],
  });
}

async function getAdminRPCHandler() {
  const { adminRouter } = await import("#/backend/orpc/routers/admin.ts");

  return new RPCHandler(adminRouter, {
    interceptors: [
      onError((error, options) => {
        options.context.logger.error(LOG_EVENTS.API_REQUEST_FAILED, {
          [OTEL_ATTRS.HTTP_REQUEST_METHOD]: options.request.method,
          [OTEL_ATTRS.URL_PATH]: new URL(options.request.url).pathname,
          [OTEL_ATTRS.REQUEST_ID]: options.context.requestId,
          [OTEL_ATTRS.ERROR_TYPE]: getErrorType(error),
          [OTEL_ATTRS.EXCEPTION_MESSAGE]: getErrorMessage(error),
          error,
        });
      }),
    ],
    plugins: [new ResponseHeadersPlugin()],
  });
}

export const openAPIHandler = {
  async handle(...args: Parameters<OpenAPIHandler<BaseContext>["handle"]>) {
    const handler = await getOpenAPIHandler();
    return handler.handle(...args);
  },
};

export const adminOpenAPIHandler = {
  async handle(...args: Parameters<OpenAPIHandler<BaseContext>["handle"]>) {
    const handler = await getAdminOpenAPIHandler();
    return handler.handle(...args);
  },
};

export const rpcHandler = {
  async handle(...args: Parameters<RPCHandler<BaseContext>["handle"]>) {
    const handler = await getRPCHandler();
    return handler.handle(...args);
  },
};

export const adminRpcHandler = {
  async handle(...args: Parameters<RPCHandler<BaseContext>["handle"]>) {
    const handler = await getAdminRPCHandler();
    return handler.handle(...args);
  },
};
