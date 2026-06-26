import {
  DEFAULT_AUTH_RETURN_TO_PATH,
  GITHUB_OAUTH_LOGIN_PATH,
  GITHUB_OAUTH_CALLBACK_PATH,
  AUTH_RETURN_TO_PARAM,
} from "#/shared/constants.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { AppError, requestValidationHook } from "#/backend/errors.ts";
import { requireDeploymentGitHubInstallation } from "#/backend/auth/installations.ts";
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
  appendExpiredAuthCookies,
  readSessionCookie,
  requireGitHubUserToken,
} from "#/backend/auth/session.ts";
import { readDeploymentGitHubAppMetadata } from "#/backend/github/apps.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import { normalizeAuthenticatedReturnToPath } from "#/shared/utils/auth.ts";

const testAuthQueryInput = zValidator(
  "query",
  z.object({
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

export const browserAuthRoutes = new Hono<WorkerHonoEnv>()
  .get(TEST_AUTH_MINT_SESSION_PATH, testAuthQueryInput, async (context) => {
    if (String(context.env.ALLOW_TEST_AUTH) !== "true") {
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
    const login = await startGitHubOAuthLogin({
      request: context.req.raw,
      env: context.env,
      requestedReturnToPath: context.req.valid("query")[AUTH_RETURN_TO_PARAM] ?? null,
    });

    context.header("Set-Cookie", login.stateCookie);
    return context.redirect(login.authorizationUrl, 302);
  })
  .get(GITHUB_OAUTH_CALLBACK_PATH, githubOAuthCallbackQueryInput, async (context) => {
    const callbackQuery = context.req.valid("query");

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
    if (!session) {
      return context.json(null);
    }

    const deploymentGitHubApp = readDeploymentGitHubAppMetadata(context.env);

    try {
      await requireGitHubUserToken(context.req.raw, context.env, {
        responseHeaders: context.res.headers,
      });
    } catch (error) {
      if (error instanceof AppError && error.kind === "authenticationRequired") {
        appendExpiredAuthCookies(context.req.raw, context.res.headers);
        return context.json(null);
      }

      throw error;
    }

    let activeInstallation: Awaited<ReturnType<typeof requireDeploymentGitHubInstallation>> | null =
      null;
    try {
      activeInstallation = await requireDeploymentGitHubInstallation(context.env);
    } catch (error) {
      if (!(error instanceof AppError) || error.kind !== "deploymentGitHubInstallationRequired") {
        throw error;
      }
    }

    return context.json({
      actor: session.githubViewer,
      activeInstallation,
      githubApp: {
        slug: deploymentGitHubApp.slug,
        htmlUrl: deploymentGitHubApp.htmlUrl,
      },
      expiresAt: session.expiresAt,
    });
  })
  .post("/session/logout", (context) => {
    context.res.headers.append("Set-Cookie", clearSessionCookie(context.req.raw));
    context.res.headers.append("Set-Cookie", clearGitHubUserTokenCookie(context.req.raw));
    context.res.headers.append("Set-Cookie", clearGitHubOAuthStateCookie(context.req.raw));

    return context.body(null, 204);
  });
