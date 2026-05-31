import * as Sentry from "@sentry/cloudflare";
import { oo } from "@orpc/openapi";
import { ORPCError, os } from "@orpc/server";
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
import { getErrorMessage, getErrorType } from "#/backend/orpc/error-format.ts";
import type { BaseContext } from "#/backend/orpc/context.ts";
import {
  adminAccessSecurity,
  browserRevalidationSecurity,
  browserSessionSecurity,
} from "#/backend/orpc/openapi-contract.ts";

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
