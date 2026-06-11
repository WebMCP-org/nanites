import { Hono, type Context } from "hono";
import { parse } from "hono/utils/cookie";
import { getAgentByName } from "agents";
import { getLogger } from "@logtape/logtape";
import { z } from "zod";
import { APP_ERRORS, AppError, describeError, type AppErrorKind } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { createDbClient } from "#/backend/db/index.ts";
import {
  buildBrowserSessionExpiration,
  nanitesSessionSchema,
  readSessionInstallationSnapshots,
  requireGitHubUserToken,
  requireSession,
  sealSessionCookie,
} from "#/backend/auth/session.ts";
import {
  checkAuthenticatedUserStarredNanites,
  issueScopedGitHubInstallationToken,
  listInstallationRepositories,
  listVisibleInstallations,
  starNanitesRepositoryForAuthenticatedUser,
} from "#/backend/github/index.ts";
import { readDeploymentGitHubAppConfig } from "#/backend/github/app-config.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import { AUTH_RETURN_TO_PARAM, GITHUB_OAUTH_LOGIN_PATH } from "#/auth.ts";
import { NANITES_SETUP_AGENT_INSTANCE_NAME } from "#/nanites.ts";
import {
  SETUP_CLAIM_COOKIE_NAME,
  buildExpiredSetupClaimCookie,
  type NanitesSetupAgent,
} from "#/backend/agents/NanitesSetupAgent.ts";

const setupLogger = getLogger(LOGGING.SERVER_CATEGORY).getChild("setup");

const GITHUB_APP_INSTALL_VERIFY_PATH = "/setup/github/verify";
const UPSTREAM_STAR_MISSING_MESSAGE =
  "GitHub did not confirm that this user starred WebMCP-org/nanites.";
const githubInstallationIdQueryValueSchema = z
  .string()
  .min(1)
  .transform((value) => Number(value))
  .pipe(z.number().int().positive());
const gitHubSetupVerificationQuerySchema = z.object({
  installation_id: githubInstallationIdQueryValueSchema,
  state: z.string().min(1).nullable(),
});
const gitHubAppSetupCallbackQuerySchema = gitHubSetupVerificationQuerySchema.extend({
  setup_action: z.enum(["install", "update"]),
});
const SETUP_AGENT_REMOTE_ERROR_MESSAGES: readonly [message: string, kind: AppErrorKind][] = [
  [APP_ERRORS.invalidSetupState.message, "invalidSetupState"],
  [APP_ERRORS.setupOwnerProofRequired.message, "setupOwnerProofRequired"],
  [APP_ERRORS.setupClaimRequired.message, "setupClaimRequired"],
  [APP_ERRORS.cloudflareOAuthFailed.message, "cloudflareOAuthFailed"],
  [
    APP_ERRORS.cloudflareWorkerOwnershipVerificationFailed.message,
    "cloudflareWorkerOwnershipVerificationFailed",
  ],
  [APP_ERRORS.cloudflareReadinessRequired.message, "cloudflareReadinessRequired"],
  [APP_ERRORS.setupDatabaseMigrationRequired.message, "setupDatabaseMigrationRequired"],
  [APP_ERRORS.cloudflareWorkerSecretWriteFailed.message, "cloudflareWorkerSecretWriteFailed"],
  [APP_ERRORS.githubAppManifestConversionFailed.message, "githubAppManifestConversionFailed"],
  [APP_ERRORS.setupInstallationVerificationFailed.message, "setupInstallationVerificationFailed"],
];

async function getSetupAgent(env: Env): Promise<DurableObjectStub<NanitesSetupAgent>> {
  return getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    NANITES_SETUP_AGENT_INSTANCE_NAME,
  );
}

function mapSetupAgentError(error: unknown): never {
  if (error instanceof AppError) {
    throw error;
  }
  if (error instanceof Error) {
    const remoteMatch = SETUP_AGENT_REMOTE_ERROR_MESSAGES.find(([message]) =>
      error.message.includes(message),
    );
    if (remoteMatch) {
      throw new AppError(remoteMatch[1]);
    }
  }

  throw error;
}

type GitHubSetupVerificationQuery = z.infer<typeof gitHubSetupVerificationQuerySchema>;

function throwInstallationVerificationFailed(input: {
  readonly reason: string;
  readonly githubInstallationId: number | null;
  readonly cause?: unknown;
  readonly visibleInstallationIds?: readonly string[];
  readonly githubError?: string;
}): never {
  setupLogger.warn(LOG_EVENTS.SETUP_INSTALLATION_VERIFICATION_FAILED, {
    reason: input.reason,
    [OTEL_ATTRS.GITHUB_INSTALLATION_ID]: input.githubInstallationId,
    ...(input.visibleInstallationIds
      ? { visibleInstallationIds: input.visibleInstallationIds.join(",") }
      : {}),
    ...(input.githubError ? { [OTEL_ATTRS.EXCEPTION_MESSAGE]: input.githubError } : {}),
  });
  throw new AppError("setupInstallationVerificationFailed", {
    ...(input.cause === undefined ? {} : { cause: input.cause }),
    details: {
      githubInstallationId: input.githubInstallationId,
      reason: input.reason,
      ...(input.visibleInstallationIds
        ? { visibleInstallationIds: input.visibleInstallationIds }
        : {}),
      ...(input.githubError ? { githubError: input.githubError } : {}),
    },
  });
}

function requireGitHubSetupVerificationQuery(request: Request): GitHubSetupVerificationQuery {
  const url = new URL(request.url);
  const result = gitHubSetupVerificationQuerySchema.safeParse({
    installation_id: url.searchParams.get("installation_id"),
    state: url.searchParams.get("state"),
  });
  if (!result.success) {
    throwInstallationVerificationFailed({
      reason: "invalid_verification_query",
      githubInstallationId: null,
    });
  }

  return result.data;
}

function requireGitHubAppSetupCallbackQuery(request: Request): GitHubSetupVerificationQuery {
  const url = new URL(request.url);
  const result = gitHubAppSetupCallbackQuerySchema.safeParse({
    installation_id: url.searchParams.get("installation_id"),
    setup_action: url.searchParams.get("setup_action"),
    state: url.searchParams.get("state"),
  });
  if (!result.success) {
    throwInstallationVerificationFailed({
      reason: "invalid_install_callback_query",
      githubInstallationId: null,
    });
  }

  return result.data;
}

function buildGitHubSetupVerificationPath(
  request: Request,
  query: GitHubSetupVerificationQuery,
): string {
  const requestUrl = new URL(request.url);
  const verifyUrl = new URL(GITHUB_APP_INSTALL_VERIFY_PATH, requestUrl.origin);
  verifyUrl.searchParams.set("installation_id", String(query.installation_id));
  if (query.state) {
    verifyUrl.searchParams.set("state", query.state);
  }

  return `${verifyUrl.pathname}${verifyUrl.search}`;
}

function buildGitHubSetupVerificationLoginUrl(
  request: Request,
  query: GitHubSetupVerificationQuery = requireGitHubSetupVerificationQuery(request),
): URL {
  const loginUrl = new URL(GITHUB_OAUTH_LOGIN_PATH, request.url);
  loginUrl.searchParams.set(AUTH_RETURN_TO_PARAM, buildGitHubSetupVerificationPath(request, query));
  return loginUrl;
}

function readSetupCookieToken(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const claimToken = parse(cookieHeader)[name]?.trim();
  return claimToken && claimToken.length > 0 ? claimToken : null;
}

function requireSetupClaimToken(request: Request): string {
  const claimToken = readSetupCookieToken(request, SETUP_CLAIM_COOKIE_NAME);
  if (!claimToken) {
    throw new AppError("setupClaimRequired");
  }

  return claimToken;
}

async function requireGitHubBrowserAuth(context: Context<WorkerHonoEnv>) {
  await requireSession(context.req.raw, context.env);
  const githubUserToken = await requireGitHubUserToken(context.req.raw, context.env, {
    responseHeaders: context.res.headers,
  });
  return { githubUserToken };
}

async function recordUpstreamStarStatus({
  setupAgent,
  starred,
}: {
  setupAgent: DurableObjectStub<NanitesSetupAgent>;
  starred: boolean;
}) {
  return starred
    ? setupAgent.recordUpstreamStarVerified().catch(mapSetupAgentError)
    : setupAgent.recordUpstreamStarMissing(UPSTREAM_STAR_MISSING_MESSAGE).catch(mapSetupAgentError);
}

async function requireInstallationHasVisibleRepository(
  accessToken: string,
  githubInstallationId: number,
): Promise<string> {
  const repositories = await listInstallationRepositories(accessToken, githubInstallationId);
  const repository = repositories[0] ?? null;
  if (!repository) {
    throwInstallationVerificationFailed({
      reason: "no_visible_repositories",
      githubInstallationId,
    });
  }

  return repository.full_name;
}

async function proveInstallationTokenCanBeMinted({
  env,
  githubInstallationId,
  repositoryFullName,
}: {
  env: Env;
  githubInstallationId: number;
  repositoryFullName: string;
}): Promise<void> {
  try {
    await issueScopedGitHubInstallationToken({
      env,
      installationId: githubInstallationId,
      repositories: [repositoryFullName],
    });
  } catch (error) {
    throwInstallationVerificationFailed({
      reason: "installation_token_mint_failed",
      githubInstallationId,
      cause: error,
      githubError: describeError(error),
    });
  }
}

export const setupRoutes = new Hono<WorkerHonoEnv>()
  .get("/api/setup/status", async (context) => {
    const setupAgent = await getSetupAgent(context.env);
    const runtimeConfig = await readDeploymentGitHubAppConfig(
      createDbClient(context.env.DB),
      context.env,
    );
    return context.json(
      await setupAgent.refresh({
        origin: new URL(context.req.raw.url).origin,
        deploymentGitHubAppConfigReadable: runtimeConfig !== null,
      }),
    );
  })
  .get("/setup/github/manifest/callback", async (context) => {
    const url = new URL(context.req.raw.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const setupClaimToken = requireSetupClaimToken(context.req.raw);
    if (!code || !state) {
      throw new AppError("invalidSetupState");
    }

    const setupAgent = await getSetupAgent(context.env);
    const result = await setupAgent
      .completeGitHubManifestFromCallback({
        code,
        state,
        origin: url.origin,
        setupClaimToken,
      })
      .catch(mapSetupAgentError);
    if (!result.ok) {
      throw new AppError(result.errorKind);
    }

    return context.redirect(
      result.deploymentConfigured ? result.installUrl : "/setup?github_app=created",
      302,
    );
  })
  .get("/setup/github/installed", async (context) => {
    requireSetupClaimToken(context.req.raw);
    const callbackQuery = requireGitHubAppSetupCallbackQuery(context.req.raw);
    return context.redirect(
      buildGitHubSetupVerificationLoginUrl(context.req.raw, callbackQuery).toString(),
      302,
    );
  })
  .get("/setup/github/verify", async (context) => {
    const setupClaimToken = requireSetupClaimToken(context.req.raw);
    const verificationQuery = requireGitHubSetupVerificationQuery(context.req.raw);
    let session: Awaited<ReturnType<typeof requireSession>>;
    let githubUserToken: Awaited<ReturnType<typeof requireGitHubUserToken>>;
    try {
      session = await requireSession(context.req.raw, context.env);
      githubUserToken = await requireGitHubUserToken(context.req.raw, context.env, {
        responseHeaders: context.res.headers,
      });
    } catch (error) {
      if (error instanceof AppError && error.kind === "authenticationRequired") {
        return context.redirect(
          buildGitHubSetupVerificationLoginUrl(context.req.raw, verificationQuery).toString(),
        );
      }
      throw error;
    }

    const requestedInstallationId = verificationQuery.installation_id;
    const installState = verificationQuery.state;
    const setupAgent = await getSetupAgent(context.env);
    const deploymentGitHubAppConfigReadable =
      (await readDeploymentGitHubAppConfig(createDbClient(context.env.DB), context.env)) !== null;
    const setupState = await setupAgent
      .refresh({
        origin: new URL(context.req.raw.url).origin,
        deploymentGitHubAppConfigReadable,
      })
      .catch(mapSetupAgentError);
    if (setupState.githubApp.status !== "complete") {
      throw new AppError("invalidSetupState");
    }
    if (!installState || installState !== setupState.repositories.installState) {
      throwInstallationVerificationFailed({
        reason: "install_state_mismatch",
        githubInstallationId: requestedInstallationId,
      });
    }

    const visibleInstallations = readSessionInstallationSnapshots(
      await listVisibleInstallations(githubUserToken.accessToken),
    );
    const verifiedInstallation =
      visibleInstallations.find((installation) => installation.id === requestedInstallationId) ??
      null;

    if (!verifiedInstallation) {
      throwInstallationVerificationFailed({
        reason: "installation_not_visible",
        githubInstallationId: requestedInstallationId,
        visibleInstallationIds: visibleInstallations.map((installation) => String(installation.id)),
      });
    }

    const firstVisibleRepositoryFullName = await requireInstallationHasVisibleRepository(
      githubUserToken.accessToken,
      verifiedInstallation.id,
    );

    await proveInstallationTokenCanBeMinted({
      env: context.env,
      githubInstallationId: verifiedInstallation.id,
      repositoryFullName: firstVisibleRepositoryFullName,
    });

    const nextSession = nanitesSessionSchema.parse({
      ...session,
      activeGithubInstallationId: verifiedInstallation.id,
      sessionInstallationSnapshot: verifiedInstallation,
      expiresAt: buildBrowserSessionExpiration(),
    });
    context.header(
      "Set-Cookie",
      await sealSessionCookie(nextSession, context.req.raw, context.env),
      {
        append: true,
      },
    );

    await setupAgent
      .recordRepositoryInstall({
        githubInstallationId: verifiedInstallation.id,
        setupClaimToken,
        installState,
        deploymentGitHubAppConfigReadable,
      })
      .catch(mapSetupAgentError);

    return context.redirect("/setup", 302);
  })
  .get("/api/setup/upstream-star", async (context) => {
    const setupAgent = await getSetupAgent(context.env);
    const { githubUserToken } = await requireGitHubBrowserAuth(context);
    const starred = await checkAuthenticatedUserStarredNanites(githubUserToken.accessToken);
    const state = await recordUpstreamStarStatus({ setupAgent, starred });
    if (starred) {
      await setupAgent.clearSetupClaim().catch(mapSetupAgentError);
      context.header("Set-Cookie", buildExpiredSetupClaimCookie(context.req.raw), {
        append: true,
      });
    }

    return context.json(state);
  })
  .put("/api/setup/upstream-star", async (context) => {
    const { githubUserToken } = await requireGitHubBrowserAuth(context);
    const setupAgent = await getSetupAgent(context.env);
    await starNanitesRepositoryForAuthenticatedUser(githubUserToken.accessToken);
    const starred = await checkAuthenticatedUserStarredNanites(githubUserToken.accessToken);
    const state = await recordUpstreamStarStatus({ setupAgent, starred });
    if (starred) {
      await setupAgent.clearSetupClaim().catch(mapSetupAgentError);
      context.header("Set-Cookie", buildExpiredSetupClaimCookie(context.req.raw), {
        append: true,
      });
    }

    return context.json(state);
  });
