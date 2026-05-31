import { readSessionCookie, sealSessionCookie } from "#/backend/browser-auth/cookies.ts";
import {
  listVisibleInstallations,
  listInstallationRepositories,
  toInstallationRepositories,
} from "#/backend/github.ts";
import { clearRevokedSessionSelectionIfNeeded } from "#/backend/browser-auth/revalidation.ts";
import { recordAccountAuthFunnelEvent } from "#/backend/business-data.ts";
import {
  AuthenticationRequiredError,
  appendExpiredAuthCookies,
  buildBrowserNanitesContext,
  buildCachedBrowserNanitesContext,
  extendBrowserSession,
  isGitHubUserTokenAuthFailure,
  readSessionInstallationSelection,
  resolveSessionInstallation,
  selectActiveInstallation,
  toActiveInstallations,
  requireGitHubUserToken,
} from "#/backend/browser-auth/session.ts";
import {
  AUTH_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  browserNanitesContextSchema,
  installationProcedureErrors,
  listInstallationRepositoriesOutputSchema,
  optionalBrowserNanitesContextSchema,
  selectActiveInstallationInputSchema,
  visibleInstallationsOutputSchema,
} from "@nanites/contracts/auth";
import {
  githubRevalidationProcedure,
  installationRevalidationProcedure,
  publicProcedure,
} from "#/backend/orpc/procedures.ts";
import { applyNoAuthOpenAPISpec } from "#/backend/orpc/openapi-contract.ts";
import { AUTH_INSTALLATION_ACTIVE_REPOSITORIES_ROUTE } from "#/shared/constants/routes.ts";

async function resolveLiveBrowserContext({
  session,
  accessToken,
}: {
  session: Parameters<typeof buildBrowserNanitesContext>[0];
  accessToken: string;
}) {
  const resolution = resolveSessionInstallation(
    session,
    toActiveInstallations(await listVisibleInstallations(accessToken)),
  );
  const activeInstallation = resolution.status === "active" ? resolution.activeInstallation : null;

  return buildBrowserNanitesContext(session, activeInstallation);
}

export const authRouter = {
  session: {
    getOptional: publicProcedure
      .route({
        method: "GET",
        path: "/auth/session/optional",
        summary: "Get the current browser auth context when available",
        description:
          "Return the current browser session context, or null when the browser is not authenticated.",
        tags: ["Auth"],
        operationId: "auth_session_get_optional",
        spec: applyNoAuthOpenAPISpec,
      })
      .output(optionalBrowserNanitesContextSchema)
      .handler(async ({ context }) => {
        const session = await readSessionCookie(context.req, context.env);
        if (!session) {
          appendExpiredAuthCookies(context.req, context.resHeaders);
          return null;
        }

        try {
          await requireGitHubUserToken(context.req, context.env, {
            clearSessionOnFailure: false,
            responseHeaders: context.resHeaders,
          });
        } catch (error) {
          if (!(error instanceof AuthenticationRequiredError)) {
            throw error;
          }
        }

        const nextSession = await extendBrowserSession(
          context.req,
          context.env,
          session,
          context.resHeaders,
        );

        return buildCachedBrowserNanitesContext(nextSession);
      }),
    get: githubRevalidationProcedure
      .route({
        method: "GET",
        path: "/auth/session",
        summary: "Get the current browser auth context",
        description:
          "Return the authenticated actor, active GitHub installation, and browser-session expiration.",
        tags: ["Auth"],
        operationId: "auth_session_get",
      })
      .output(browserNanitesContextSchema)
      .handler(async ({ context, errors }) => {
        try {
          return await resolveLiveBrowserContext({
            session: context.session,
            accessToken: context.githubUserToken.accessToken,
          });
        } catch (error) {
          if (isGitHubUserTokenAuthFailure(error)) {
            await recordAccountAuthFunnelEvent({
              db: context.db,
              githubUserId: context.session.githubUserId,
              githubLogin: context.session.githubLogin,
              githubInstallationId: context.session.activeGithubInstallationId,
              eventType: "session_invalidated",
            });
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
      }),
    logout: publicProcedure
      .route({
        method: "POST",
        path: "/auth/session/logout",
        summary: "Clear browser auth cookies and end the session",
        description:
          "Expire SigVelo browser auth cookies and record a logout event when a session exists.",
        tags: ["Auth"],
        operationId: "auth_session_logout",
        spec: applyNoAuthOpenAPISpec,
      })
      .handler(async ({ context }) => {
        const session = await readSessionCookie(context.req, context.env);
        const activeGithubInstallationId = session?.activeGithubInstallationId ?? null;
        await recordAccountAuthFunnelEvent({
          db: context.db,
          githubUserId: session?.githubUserId ?? null,
          githubLogin: session?.githubLogin ?? null,
          githubInstallationId: activeGithubInstallationId,
          eventType: "logout",
        });
        appendExpiredAuthCookies(context.req, context.resHeaders);
      }),
  },
  installations: {
    listVisible: githubRevalidationProcedure
      .route({
        method: "GET",
        path: "/auth/installations/visible",
        summary: "List visible installations for the current actor",
        description:
          "List GitHub App installations visible to the authenticated GitHub actor and refresh the active selection when needed.",
        tags: ["Auth"],
        operationId: "auth_installations_list_visible",
      })
      .output(visibleInstallationsOutputSchema)
      .handler(async ({ context }) => {
        const visibleInstallations = await listVisibleInstallations(
          context.githubUserToken.accessToken,
        );
        const activeInstallations = toActiveInstallations(visibleInstallations);

        await clearRevokedSessionSelectionIfNeeded({
          req: context.req,
          env: context.env,
          session: context.session,
          resHeaders: context.resHeaders,
          activeInstallations,
        });

        const currentSelection = readSessionInstallationSelection(context.session);
        const selectionStillValid =
          currentSelection.status === "selected" &&
          resolveSessionInstallation(context.session, activeInstallations).status === "active";

        if (!selectionStillValid && activeInstallations.length > 0) {
          const nextSession = selectActiveInstallation(context.session, activeInstallations[0].id);
          context.resHeaders?.append(
            "Set-Cookie",
            await sealSessionCookie(nextSession, context.req, context.env),
          );
          await recordAccountAuthFunnelEvent({
            db: context.db,
            githubUserId: context.actor.id,
            githubLogin: context.actor.login,
            githubInstallationId: activeInstallations[0].id,
            eventType: "first_visible_installation_auto_selected",
            metadata: {
              githubInstallationId: activeInstallations[0].id,
            },
          });
        }

        return {
          installations: activeInstallations,
        };
      }),
    setActive: githubRevalidationProcedure
      .errors(installationProcedureErrors)
      .route({
        method: "POST",
        path: "/auth/installations/active",
        summary: "Set the active installation for the current browser session",
        description:
          "Select one visible GitHub App installation as the active authorization boundary for this browser session.",
        tags: ["Auth"],
        operationId: "auth_installations_set_active",
      })
      .input(selectActiveInstallationInputSchema)
      .output(browserNanitesContextSchema)
      .handler(async ({ context, input, errors }) => {
        const activeInstallation = toActiveInstallations(
          await listVisibleInstallations(context.githubUserToken.accessToken),
        ).find((installation) => installation.id === input.githubInstallationId);
        if (!activeInstallation) {
          await recordAccountAuthFunnelEvent({
            db: context.db,
            githubUserId: context.actor.id,
            githubLogin: context.actor.login,
            githubInstallationId: input.githubInstallationId,
            eventType: "active_installation_revoked",
          });
          throw errors.FORBIDDEN({
            data: {
              code: AUTH_ERROR_CODES.installationAccessRevoked,
              message: AUTH_ERROR_MESSAGES.installationAccessRevoked,
              githubInstallationId: input.githubInstallationId,
            },
          });
        }

        const nextSession = selectActiveInstallation(
          context.session,
          activeInstallation.id,
          activeInstallation,
        );
        context.resHeaders?.append(
          "Set-Cookie",
          await sealSessionCookie(nextSession, context.req, context.env),
        );
        await recordAccountAuthFunnelEvent({
          db: context.db,
          githubUserId: context.actor.id,
          githubLogin: context.actor.login,
          githubInstallationId: activeInstallation.id,
          eventType: "installation_switched",
          metadata: {
            githubInstallationId: activeInstallation.id,
          },
        });

        return buildBrowserNanitesContext(nextSession, activeInstallation);
      }),
  },
  repositories: {
    listActive: installationRevalidationProcedure
      .route({
        method: "GET",
        path: AUTH_INSTALLATION_ACTIVE_REPOSITORIES_ROUTE,
        summary: "List repositories selectable in the active installation",
        description:
          "Return repositories the actor can access inside the active GitHub App installation.",
        tags: ["Auth"],
        operationId: "auth_installation_repositories_list_active",
      })
      .output(listInstallationRepositoriesOutputSchema)
      .handler(async ({ context }) => {
        const repositories = toInstallationRepositories(
          await listInstallationRepositories(
            context.githubUserToken.accessToken,
            context.activeInstallation.id,
          ),
        );
        await recordAccountAuthFunnelEvent({
          db: context.db,
          githubInstallationId: context.activeInstallation.id,
          githubUserId: context.actor.id,
          githubLogin: context.actor.login,
          eventType:
            repositories.length === 0
              ? "active_installation_zero_repositories"
              : "active_installation_repositories_loaded",
          metadata: {
            repositoryCount: repositories.length,
          },
        });

        return {
          repositories,
        };
      }),
  },
};
