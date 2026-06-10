import { Hono, type Context } from "hono";
import { parse } from "hono/utils/cookie";
import { getAgentByName } from "agents";
import { APP_ERRORS, AppError, type AppErrorKind } from "#/backend/errors.ts";
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

const GITHUB_APP_INSTALL_VERIFY_PATH = "/setup/github/verify";
const UPSTREAM_STAR_MISSING_MESSAGE =
  "GitHub did not confirm that this user starred WebMCP-org/nanites.";
const SETUP_AGENT_REMOTE_ERROR_MESSAGES: readonly [message: string, kind: AppErrorKind][] = [
  [APP_ERRORS.invalidSetupState.message, "invalidSetupState"],
  [APP_ERRORS.setupOwnerProofRequired.message, "setupOwnerProofRequired"],
  [APP_ERRORS.setupClaimRequired.message, "setupClaimRequired"],
  [APP_ERRORS.cloudflareOAuthFailed.message, "cloudflareOAuthFailed"],
  [
    APP_ERRORS.cloudflareWorkerOwnershipVerificationFailed.message,
    "cloudflareWorkerOwnershipVerificationFailed",
  ],
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

function readGitHubInstallationId(url: URL): number | null {
  const installationId = Number(url.searchParams.get("installation_id"));
  return Number.isInteger(installationId) && installationId > 0 ? installationId : null;
}

function requireGitHubInstallationId(url: URL): number {
  const installationId = readGitHubInstallationId(url);
  if (installationId === null) {
    throw new AppError("setupInstallationVerificationFailed", {
      details: { githubInstallationId: null },
    });
  }

  return installationId;
}

function buildGitHubSetupVerificationPath(request: Request): string {
  const requestUrl = new URL(request.url);
  const installationId = requireGitHubInstallationId(requestUrl);
  const verifyUrl = new URL(GITHUB_APP_INSTALL_VERIFY_PATH, requestUrl.origin);
  verifyUrl.searchParams.set("installation_id", String(installationId));
  const installState = requestUrl.searchParams.get("state");
  if (installState) {
    verifyUrl.searchParams.set("state", installState);
  }

  return `${verifyUrl.pathname}${verifyUrl.search}`;
}

function buildGitHubSetupVerificationLoginUrl(request: Request): URL {
  const loginUrl = new URL(GITHUB_OAUTH_LOGIN_PATH, request.url);
  loginUrl.searchParams.set(AUTH_RETURN_TO_PARAM, buildGitHubSetupVerificationPath(request));
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
    throw new AppError("setupInstallationVerificationFailed", {
      details: { githubInstallationId },
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
    throw new AppError("setupInstallationVerificationFailed", {
      cause: error,
      details: { githubInstallationId },
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
    return context.redirect(buildGitHubSetupVerificationLoginUrl(context.req.raw).toString(), 302);
  })
  .get("/setup/github/verify", async (context) => {
    const setupClaimToken = requireSetupClaimToken(context.req.raw);
    let session: Awaited<ReturnType<typeof requireSession>>;
    let githubUserToken: Awaited<ReturnType<typeof requireGitHubUserToken>>;
    try {
      session = await requireSession(context.req.raw, context.env);
      githubUserToken = await requireGitHubUserToken(context.req.raw, context.env, {
        responseHeaders: context.res.headers,
      });
    } catch (error) {
      if (error instanceof AppError && error.kind === "authenticationRequired") {
        return context.redirect(buildGitHubSetupVerificationLoginUrl(context.req.raw).toString());
      }
      throw error;
    }

    const requestedInstallationId = requireGitHubInstallationId(new URL(context.req.raw.url));
    const installState = new URL(context.req.raw.url).searchParams.get("state");
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
      throw new AppError("setupInstallationVerificationFailed", {
        details: { githubInstallationId: requestedInstallationId },
      });
    }

    const visibleInstallations = readSessionInstallationSnapshots(
      await listVisibleInstallations(githubUserToken.accessToken),
    );
    const verifiedInstallation =
      visibleInstallations.find((installation) => installation.id === requestedInstallationId) ??
      null;

    if (!verifiedInstallation) {
      throw new AppError("setupInstallationVerificationFailed", {
        details: { githubInstallationId: requestedInstallationId },
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
