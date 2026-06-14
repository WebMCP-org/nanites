import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { parse } from "hono/utils/cookie";
import { getAgentByName } from "agents";
import { getLogger } from "@logtape/logtape";
import { z } from "zod";
import { AppError, describeError } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { recordVisibleInstallationSnapshots } from "#/backend/db/facts.ts";
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
import {
  listGitHubApps,
  readAuthCookieSecret,
  readDeploymentGitHubAppMetadata,
  requireGitHubAppsTableReady,
  resolveGitHubApp,
  type GitHubAppMetadata,
} from "#/backend/github/apps.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import { AUTH_RETURN_TO_PARAM, GITHUB_OAUTH_LOGIN_PATH } from "#/auth.ts";
import { NANITES_SETUP_AGENT_INSTANCE_NAME } from "#/nanites.ts";
import {
  GITHUB_APP_INSTALL_CALLBACK_PATH,
  GITHUB_APP_MANIFEST_CALLBACK_PATH,
  SETUP_CLAIM_COOKIE_NAME,
  buildSetupClaimCookie,
  type NanitesSetupAgent,
  type NanitesSetupState,
} from "#/backend/agents/NanitesSetupAgent.ts";
import { shouldShowSetup } from "#/backend/setup-policy.ts";

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
const startGitHubAppBodySchema = z.object({
  ownerType: z.enum(["user", "organization"]),
  ownerLogin: z.string().trim().min(1).nullish(),
});

type GitHubSetupVerificationQuery = z.infer<typeof gitHubSetupVerificationQuerySchema>;
type SetupStatusResponse = NanitesSetupState & {
  readonly runtimeConfigReadable: boolean;
  readonly showSetup: boolean;
};

function toGitHubAppListEntry(app: GitHubAppMetadata) {
  return {
    appId: app.appId,
    slug: app.slug,
    htmlUrl: app.htmlUrl,
    ownerLogin: app.ownerLogin,
    status: app.status,
  };
}

const setupVisibleRequired = createMiddleware<WorkerHonoEnv>(async (context, next) => {
  if (!shouldShowSetup(context.env)) {
    return context.text("Not found", 404);
  }

  await next();
});

async function getSetupAgent(env: Env): Promise<DurableObjectStub<NanitesSetupAgent>> {
  return getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    NANITES_SETUP_AGENT_INSTANCE_NAME,
  );
}

async function isRuntimeConfigReadable(env: Env): Promise<boolean> {
  const db = createDbClient(env.DB);
  const wizardApp = await readDeploymentGitHubAppMetadata(db);
  return (
    wizardApp !== null &&
    readAuthCookieSecret(env) !== null &&
    (await resolveGitHubApp(db, env, wizardApp.appId)) !== null
  );
}

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

function buildGitHubSetupVerificationLoginUrl(
  request: Request,
  query: GitHubSetupVerificationQuery,
): URL {
  const requestUrl = new URL(request.url);
  const verifyUrl = new URL(GITHUB_APP_INSTALL_VERIFY_PATH, requestUrl.origin);
  verifyUrl.searchParams.set("installation_id", String(query.installation_id));
  if (query.state) {
    verifyUrl.searchParams.set("state", query.state);
  }

  const loginUrl = new URL(GITHUB_OAUTH_LOGIN_PATH, request.url);
  loginUrl.searchParams.set(AUTH_RETURN_TO_PARAM, `${verifyUrl.pathname}${verifyUrl.search}`);
  return loginUrl;
}

function requireSetupClaimToken(request: Request): string {
  const cookieHeader = request.headers.get("cookie");
  const claimToken = cookieHeader ? parse(cookieHeader)[SETUP_CLAIM_COOKIE_NAME]?.trim() : null;
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

async function requireInstallationHasVisibleRepository(
  accessToken: string,
  githubInstallationId: number,
  projection: { env: Env; githubAppId: number },
): Promise<string> {
  const repositories = await listInstallationRepositories(
    accessToken,
    githubInstallationId,
    projection,
  );
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
  githubAppId,
  githubInstallationId,
  repositoryFullName,
}: {
  env: Env;
  githubAppId: number;
  githubInstallationId: number;
  repositoryFullName: string;
}): Promise<void> {
  try {
    await issueScopedGitHubInstallationToken({
      env,
      githubAppId,
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
    const runtimeConfigReadable = await isRuntimeConfigReadable(context.env);
    const state = await setupAgent.refresh({
      origin: new URL(context.req.raw.url).origin,
      runtimeConfigReadable,
    });

    return context.json({
      ...state,
      runtimeConfigReadable,
      showSetup: shouldShowSetup(context.env),
    } satisfies SetupStatusResponse);
  })
  .post("/api/setup/cloudflare", setupVisibleRequired, async (context) => {
    const setupAgent = await getSetupAgent(context.env);
    const result = await setupAgent.connectCloudflare({
      origin: new URL(context.req.raw.url).origin,
    });
    if (result.claim) {
      context.header("Set-Cookie", buildSetupClaimCookie(context.req.raw, result.claim), {
        append: true,
      });
    }

    return context.json({ state: result.state, authorizationUrl: result.authorizationUrl });
  })
  .post("/api/setup/github-app", setupVisibleRequired, async (context) => {
    const claimToken = requireSetupClaimToken(context.req.raw);
    const body = startGitHubAppBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!body.success) {
      throw new AppError("invalidSetupState");
    }
    await requireGitHubAppsTableReady(createDbClient(context.env.DB));

    const setupAgent = await getSetupAgent(context.env);
    const result = await setupAgent.startGitHubApp({
      origin: new URL(context.req.raw.url).origin,
      claimToken,
      ownerType: body.data.ownerType,
      ownerLogin: body.data.ownerLogin ?? null,
    });
    if (!result.ok) {
      throw new AppError(result.errorKind);
    }

    return context.json({ action: result.action, manifest: result.manifest, state: result.state });
  })
  .get(GITHUB_APP_MANIFEST_CALLBACK_PATH, setupVisibleRequired, async (context) => {
    const url = new URL(context.req.raw.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const claimToken = requireSetupClaimToken(context.req.raw);
    if (!code || !state) {
      throw new AppError("invalidSetupState");
    }

    const setupAgent = await getSetupAgent(context.env);
    const result = await setupAgent.completeGitHubAppManifest({
      origin: url.origin,
      claimToken,
      code,
      state,
    });
    if (!result.ok) {
      throw new AppError(result.errorKind);
    }

    return context.redirect(
      result.deploymentConfigured ? result.installUrl : "/setup?github_app=created",
      302,
    );
  })
  .get(GITHUB_APP_INSTALL_CALLBACK_PATH, setupVisibleRequired, async (context) => {
    requireSetupClaimToken(context.req.raw);
    const callbackQuery = requireGitHubAppSetupCallbackQuery(context.req.raw);
    return context.redirect(
      buildGitHubSetupVerificationLoginUrl(context.req.raw, callbackQuery).toString(),
      302,
    );
  })
  .get(GITHUB_APP_INSTALL_VERIFY_PATH, setupVisibleRequired, async (context) => {
    const claimToken = requireSetupClaimToken(context.req.raw);
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

    const db = createDbClient(context.env.DB);
    const wizardApp = await readDeploymentGitHubAppMetadata(db);
    if (!wizardApp) {
      throw new AppError("deploymentGitHubAppSetupRequired");
    }

    const requestedInstallationId = verificationQuery.installation_id;
    // The login session rides the singleton deployment app, and GitHub remains
    // authoritative for which installations the browser token can see.
    const visibleInstallations = readSessionInstallationSnapshots(
      await listVisibleInstallations(githubUserToken.accessToken),
      wizardApp.appId,
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

    await recordVisibleInstallationSnapshots(db, [verifiedInstallation]);
    const firstVisibleRepositoryFullName = await requireInstallationHasVisibleRepository(
      githubUserToken.accessToken,
      verifiedInstallation.id,
      { env: context.env, githubAppId: wizardApp.appId },
    );
    await proveInstallationTokenCanBeMinted({
      env: context.env,
      githubAppId: wizardApp.appId,
      githubInstallationId: verifiedInstallation.id,
      repositoryFullName: firstVisibleRepositoryFullName,
    });
    const setupAgent = await getSetupAgent(context.env);
    const result = await setupAgent.recordRepositoryInstall({
      claimToken,
      githubInstallationId: verifiedInstallation.id,
      installState: verificationQuery.state,
      runtimeConfigReadable: await isRuntimeConfigReadable(context.env),
    });
    if (!result.ok) {
      if (result.errorKind === "installStateMismatch") {
        throwInstallationVerificationFailed({
          reason: "install_state_mismatch",
          githubInstallationId: requestedInstallationId,
        });
      }
      throw new AppError(result.errorKind);
    }

    const nextSession = nanitesSessionSchema.parse({
      ...session,
      activeGithubAppId: verifiedInstallation.githubAppId,
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

    return context.redirect("/setup", 302);
  })
  .get("/api/setup/upstream-star", setupVisibleRequired, async (context) => {
    const { githubUserToken } = await requireGitHubBrowserAuth(context);
    const starred = await checkAuthenticatedUserStarredNanites(githubUserToken.accessToken);
    const setupAgent = await getSetupAgent(context.env);
    return context.json(
      await setupAgent.recordUpstreamStar({
        starred,
        error: starred ? null : UPSTREAM_STAR_MISSING_MESSAGE,
      }),
    );
  })
  .put("/api/setup/upstream-star", setupVisibleRequired, async (context) => {
    const { githubUserToken } = await requireGitHubBrowserAuth(context);
    await starNanitesRepositoryForAuthenticatedUser(githubUserToken.accessToken);
    const starred = await checkAuthenticatedUserStarredNanites(githubUserToken.accessToken);
    const setupAgent = await getSetupAgent(context.env);
    return context.json(
      await setupAgent.recordUpstreamStar({
        starred,
        error: starred ? null : UPSTREAM_STAR_MISSING_MESSAGE,
      }),
    );
  })
  .get("/api/setup/github-apps", setupVisibleRequired, async (context) => {
    requireSetupClaimToken(context.req.raw);
    const apps = await listGitHubApps(createDbClient(context.env.DB));
    return context.json({ apps: apps.map(toGitHubAppListEntry) });
  });
