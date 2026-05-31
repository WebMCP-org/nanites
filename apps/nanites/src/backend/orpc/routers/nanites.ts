import { getAgentByName } from "agents";
import { oo } from "@orpc/openapi";
import {
  AUTH_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  installationProcedureErrors,
  sessionProcedureErrors,
} from "@nanites/contracts/auth";
import { githubInstallationIdSchema } from "@nanites/contracts/ids";
import { type NaniteManager } from "#/backend/nanites/host.ts";
import {
  ActiveInstallationRequiredError,
  appendExpiredAuthCookies,
  AuthenticationRequiredError,
  requireActiveGithubInstallationId,
  requireSession,
} from "#/backend/browser-auth/session.ts";
import {
  assertNaniteRepositoriesBelongToInstallation,
  NaniteRepositoryScopeError,
} from "#/backend/nanites/repository-scope.ts";
import { requireMcpScope } from "#/backend/mcp/auth-context.ts";
import { buildNotFoundErrorData } from "#/backend/orpc/errors.ts";
import { publicProcedure } from "#/backend/orpc/orpc.ts";
import {
  createNaniteInputSchema,
  createNaniteOutputSchema,
  managerInputSchema,
  managerStateOutputSchema,
} from "#/backend/orpc/contracts/nanites.ts";
import {
  buildNanitesAccessSecurity,
  managerNameParameterDescriptions,
  withParameterDescriptions,
} from "#/backend/orpc/openapi-contract.ts";
import { MCP_SCOPES, type McpScope } from "#/shared/constants/mcp.ts";
import { buildNaniteManagerKey } from "#/shared/nanites.ts";

function getManager(env: Env, managerName: string) {
  return getAgentByName<Env, NaniteManager>(env.SigveloNaniteManager, managerName);
}

function getInstallationIdFromManagerName(managerName: string) {
  const prefix = "installation:";
  if (!managerName.startsWith(prefix)) {
    return null;
  }

  const value = Number(managerName.slice(prefix.length));
  const result = githubInstallationIdSchema.safeParse(value);
  return result.success ? result.data : null;
}

function createNanitesProcedure(requiredScope: McpScope) {
  const nanitesProcedure = publicProcedure.errors({
    UNAUTHORIZED: oo.spec(sessionProcedureErrors.UNAUTHORIZED, {
      security: buildNanitesAccessSecurity(requiredScope),
    }),
    ...installationProcedureErrors,
  });

  return nanitesProcedure.use(async ({ context, next, errors }) => {
    const mcpAuthProps = context.mcpAuthProps;
    if (mcpAuthProps) {
      requireMcpScope(mcpAuthProps, requiredScope);

      return next({
        context: {
          naniteManagerName: buildNaniteManagerKey(mcpAuthProps.githubInstallationId),
        },
      });
    }

    try {
      const session = await requireSession(context.req, context.env);
      const githubInstallationId = requireActiveGithubInstallationId(session);

      return next({
        context: {
          naniteManagerName: buildNaniteManagerKey(githubInstallationId),
        },
      });
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        appendExpiredAuthCookies(context.req, context.resHeaders);
        throw errors.UNAUTHORIZED({
          data: {
            code: AUTH_ERROR_CODES.authenticationRequired,
            message: AUTH_ERROR_MESSAGES.authenticationRequired,
          },
        });
      }

      if (error instanceof ActiveInstallationRequiredError) {
        throw errors.BAD_REQUEST({
          data: {
            code: AUTH_ERROR_CODES.activeInstallationRequired,
            message: AUTH_ERROR_MESSAGES.activeInstallationRequired,
          },
        });
      }

      throw error;
    }
  });
}

const nanitesReadProcedure = createNanitesProcedure(MCP_SCOPES.read);
const nanitesWriteProcedure = createNanitesProcedure(MCP_SCOPES.write);

function requireAuthorizedManagerName({
  requestedManagerName,
  authorizedManagerName,
  errors,
}: {
  requestedManagerName: string | undefined;
  authorizedManagerName: string;
  errors: {
    NOT_FOUND: (input: { data: ReturnType<typeof buildNotFoundErrorData> }) => unknown;
  };
}): string {
  if (requestedManagerName && requestedManagerName !== authorizedManagerName) {
    throw errors.NOT_FOUND({
      data: buildNotFoundErrorData("nanite_manager", requestedManagerName),
    });
  }

  return authorizedManagerName;
}

export const nanitesRouter = {
  manager: {
    get: nanitesReadProcedure
      .route({
        method: "GET",
        path: "/nanites/manager/{managerName}",
        summary: "Inspect a Nanite manager Agent state",
        description:
          "Return the current state for the authorized installation-scoped Nanite manager.",
        tags: ["Nanites"],
        operationId: "nanites_manager_get",
        spec: withParameterDescriptions(managerNameParameterDescriptions),
      })
      .input(managerInputSchema)
      .output(managerStateOutputSchema)
      .handler(async ({ context, input, errors }) => {
        const managerName = requireAuthorizedManagerName({
          requestedManagerName: input.managerName,
          authorizedManagerName: context.naniteManagerName,
          errors,
        });
        const manager = await getManager(context.env, managerName);

        return {
          managerName,
          state: await manager.getSnapshot(),
        };
      }),
  },
  create: nanitesWriteProcedure
    .route({
      method: "POST",
      path: "/nanites/create",
      summary: "Create or update a Nanite on a manager Agent",
      description: "Register a stable Nanite spec with the authorized manager.",
      tags: ["Nanites"],
      operationId: "nanites_create",
    })
    .input(createNaniteInputSchema)
    .output(createNaniteOutputSchema)
    .handler(async ({ context, input, errors }) => {
      const managerName = requireAuthorizedManagerName({
        requestedManagerName: input.managerName,
        authorizedManagerName: context.naniteManagerName,
        errors,
      });
      const githubInstallationId = getInstallationIdFromManagerName(managerName);
      if (githubInstallationId !== null) {
        try {
          await assertNaniteRepositoriesBelongToInstallation({
            env: context.env,
            githubInstallationId,
            manifest: input.manifest,
          });
        } catch (error) {
          if (error instanceof NaniteRepositoryScopeError) {
            throw errors.FORBIDDEN({
              data: {
                code: AUTH_ERROR_CODES.installationAccessRevoked,
                message: AUTH_ERROR_MESSAGES.installationAccessRevoked,
                githubInstallationId,
              },
            });
          }

          throw error;
        }
      }
      const manager = await getManager(context.env, managerName);

      const nanite = await manager.registerNanite({
        manifest: input.manifest,
        enabled: input.enabled,
      });

      return {
        managerName,
        naniteId: nanite.manifest.id,
        versionId: nanite.latestVersion.versionId,
        manifestHash: nanite.latestVersion.manifestHash,
      };
    }),
};
