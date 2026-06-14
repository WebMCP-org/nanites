import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createDbClient } from "#/backend/db/index.ts";
import { AppError, requestValidationHook } from "#/backend/errors.ts";
import { listBrowserVisibleInstallationSnapshots } from "#/backend/auth/installations.ts";
import {
  completeGitHubOAuthCallback,
  mintTestAuthSession,
  startGitHubOAuthLogin,
  TEST_AUTH_MINT_SESSION_PATH,
} from "#/backend/auth/index.ts";
import {
  clearGitHubOAuthStateCookie,
  clearGitHubUserTokenCookie,
  clearSessionCookie,
  buildBrowserSessionExpiration,
  nanitesSessionSchema,
  readSessionCookie,
  sealSessionCookie,
} from "#/backend/auth/session.ts";
import { readDeploymentGitHubAppMetadata } from "#/backend/github/apps.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import {
  AUTH_RETURN_TO_PARAM,
  GITHUB_OAUTH_CALLBACK_PATH,
  GITHUB_OAUTH_LOGIN_PATH,
  DEFAULT_AUTH_RETURN_TO_PATH,
  normalizeAuthenticatedReturnToPath,
} from "#/auth.ts";
import { shouldShowSetup } from "#/backend/setup-policy.ts";

const activeInstallationInput = zValidator(
  "json",
  z.object({
    githubInstallationId: z.number().int().positive(),
  }),
  requestValidationHook,
);

const testAuthQueryInput = zValidator(
  "query",
  z.object({
    activeGithubInstallationId: z.preprocess((value) => {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      return value;
    }, z.coerce.number().int().positive().nullable().default(null)),
    returnTo: z
      .string()
      .min(1)
      .default(DEFAULT_AUTH_RETURN_TO_PATH)
      .transform((value) => normalizeAuthenticatedReturnToPath(value)),
    redirect: z.preprocess((value) => {
      if (typeof value !== "string") {
        return true;
      }
      return value !== "0" && value !== "false";
    }, z.boolean()),
    githubAccessToken: z.preprocess(
      (value) => (typeof value === "string" && value.length > 0 ? value : undefined),
      z.string().min(1).optional(),
    ),
  }),
  requestValidationHook,
);

const githubOAuthLoginQueryInput = zValidator(
  "query",
  z.object({
    [AUTH_RETURN_TO_PARAM]: z.string().optional(),
  }),
  requestValidationHook,
);

const githubOAuthCallbackQueryInput = zValidator(
  "query",
  z.object({
    code: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
  }),
  requestValidationHook,
);

const githubInstallationIdQueryValueSchema = z
  .string()
  .min(1)
  .transform((value) => Number(value))
  .pipe(z.number().int().positive());

const gitHubAppInstallCallbackQuerySchema = z.object({
  installation_id: githubInstallationIdQueryValueSchema,
  setup_action: z.enum(["install", "update"]),
  state: z.string().min(1).nullable(),
});

type GitHubAppInstallCallbackQuery = z.infer<typeof gitHubAppInstallCallbackQuerySchema>;

function readGitHubAppInstallCallbackQuery(request: Request): GitHubAppInstallCallbackQuery | null {
  const callbackUrl = new URL(request.url);
  if (!callbackUrl.searchParams.has("setup_action")) {
    return null;
  }

  const result = gitHubAppInstallCallbackQuerySchema.safeParse({
    installation_id: callbackUrl.searchParams.get("installation_id"),
    setup_action: callbackUrl.searchParams.get("setup_action"),
    state: callbackUrl.searchParams.get("state"),
  });
  return result.success ? result.data : null;
}

function buildGitHubInstallVerificationLoginUrl(
  request: Request,
  callbackQuery: GitHubAppInstallCallbackQuery,
): URL {
  const verifyUrl = new URL("/setup/github/verify", request.url);
  verifyUrl.searchParams.set("installation_id", String(callbackQuery.installation_id));
  if (callbackQuery.state) {
    verifyUrl.searchParams.set("state", callbackQuery.state);
  }

  const loginUrl = new URL(GITHUB_OAUTH_LOGIN_PATH, request.url);
  loginUrl.searchParams.set(AUTH_RETURN_TO_PARAM, `${verifyUrl.pathname}${verifyUrl.search}`);
  return loginUrl;
}

function buildGitHubInstallCallbackLoginUrl(request: Request): URL | null {
  const callbackQuery = readGitHubAppInstallCallbackQuery(request);
  return callbackQuery ? buildGitHubInstallVerificationLoginUrl(request, callbackQuery) : null;
}

export const browserAuthRoutes = new Hono<WorkerHonoEnv>()
  .get(TEST_AUTH_MINT_SESSION_PATH, testAuthQueryInput, async (context) => {
    if (context.env.ALLOW_TEST_AUTH !== "true") {
      return context.text("Not found", 404);
    }

    const result = await mintTestAuthSession({
      request: context.req.raw,
      env: context.env,
      params: context.req.valid("query"),
    });

    for (const cookie of result.cookies) {
      context.header("Set-Cookie", cookie, { append: true });
    }
    if (result.redirectTo) {
      return context.redirect(result.redirectTo, 302);
    }

    return context.json(result.body);
  })
  .get(GITHUB_OAUTH_LOGIN_PATH, githubOAuthLoginQueryInput, async (context) => {
    const requestUrl = new URL(context.req.raw.url);
    if (
      requestUrl.hostname === "127.0.0.1" ||
      requestUrl.hostname === "::1" ||
      requestUrl.hostname === "[::1]"
    ) {
      requestUrl.hostname = "localhost";
      return context.redirect(requestUrl.toString(), 302);
    }

    let login: Awaited<ReturnType<typeof startGitHubOAuthLogin>>;
    try {
      login = await startGitHubOAuthLogin({
        request: context.req.raw,
        env: context.env,
        requestedReturnToPath: context.req.valid("query")[AUTH_RETURN_TO_PARAM] ?? null,
      });
    } catch (error) {
      if (error instanceof AppError && error.kind === "deploymentGitHubAppSetupRequired") {
        if (shouldShowSetup(context.env)) {
          return context.redirect("/setup", 302);
        }
        // Literal path (not an import from dev-setup.ts) so production builds
        // can still tree-shake the dev-only route module. Loopback IPs were
        // already normalized to `localhost` above.
        if (
          import.meta.env.DEV &&
          (requestUrl.hostname === "localhost" || requestUrl.hostname.endsWith(".localhost"))
        ) {
          return context.redirect("/setup/local", 302);
        }
      }
      throw error;
    }

    context.header("Set-Cookie", login.stateCookie);
    return context.redirect(login.authorizationUrl, 302);
  })
  .get(GITHUB_OAUTH_CALLBACK_PATH, githubOAuthCallbackQueryInput, async (context) => {
    const callbackQuery = context.req.valid("query");
    const setupVerificationLoginUrl = buildGitHubInstallCallbackLoginUrl(context.req.raw);
    if (setupVerificationLoginUrl !== null) {
      context.header("Set-Cookie", clearGitHubOAuthStateCookie(context.req.raw), {
        append: true,
      });
      return context.redirect(setupVerificationLoginUrl.toString(), 302);
    }

    const result = await completeGitHubOAuthCallback({
      request: context.req.raw,
      env: context.env,
      code: callbackQuery.code ?? null,
      state: callbackQuery.state ?? null,
      oauthError: callbackQuery.error ?? null,
    });

    for (const cookie of result.cookies) {
      context.header("Set-Cookie", cookie, { append: true });
    }
    return context.redirect(result.location, 302);
  });

export const browserAuthApiRoutes = new Hono<WorkerHonoEnv>()
  .get("/session/optional", async (context) => {
    const session = await readSessionCookie(context.req.raw, context.env);
    const deploymentGitHubApp = session
      ? await readDeploymentGitHubAppMetadata(createDbClient(context.env.DB))
      : null;

    return context.json(
      session
        ? {
            actor: session.githubViewer,
            activeInstallation: session.sessionInstallationSnapshot ?? null,
            githubApp: deploymentGitHubApp
              ? {
                  appId: deploymentGitHubApp.appId,
                  slug: deploymentGitHubApp.slug,
                  htmlUrl: deploymentGitHubApp.htmlUrl,
                  ownerLogin: deploymentGitHubApp.ownerLogin,
                }
              : null,
            expiresAt: session.expiresAt,
          }
        : null,
    );
  })
  .get("/installations/visible", async (context) => {
    const { installations } = await listBrowserVisibleInstallationSnapshots(
      context.req.raw,
      context.env,
      {
        responseHeaders: context.res.headers,
      },
    );
    return context.json({ installations });
  })
  .post("/installations/active", activeInstallationInput, async (context) => {
    const { githubInstallationId } = context.req.valid("json");
    const { session, installations } = await listBrowserVisibleInstallationSnapshots(
      context.req.raw,
      context.env,
      {
        responseHeaders: context.res.headers,
      },
    );
    const activeInstallation =
      installations.find((installation) => installation.id === githubInstallationId) ?? null;

    if (!activeInstallation) {
      throw new AppError("installationAccessRevoked", {
        details: { githubInstallationId },
      });
    }

    const nextSession = nanitesSessionSchema.parse({
      ...session,
      activeGithubAppId: activeInstallation.githubAppId,
      activeGithubInstallationId: githubInstallationId,
      sessionInstallationSnapshot: activeInstallation,
      expiresAt: buildBrowserSessionExpiration(),
    });
    context.res.headers.append(
      "Set-Cookie",
      await sealSessionCookie(nextSession, context.req.raw, context.env),
    );

    return context.json({
      actor: nextSession.githubViewer,
      activeInstallation,
      expiresAt: nextSession.expiresAt,
    });
  })
  .post("/session/logout", (context) => {
    context.res.headers.append("Set-Cookie", clearSessionCookie(context.req.raw));
    context.res.headers.append("Set-Cookie", clearGitHubUserTokenCookie(context.req.raw));
    context.res.headers.append("Set-Cookie", clearGitHubOAuthStateCookie(context.req.raw));

    return context.body(null, 204);
  });
