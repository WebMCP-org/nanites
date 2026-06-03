import { readSessionInstallationSnapshots } from "#/backend/browser-auth/session.ts";
import {
  clearGitHubUserTokenCookie,
  clearSessionCookie,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
} from "#/backend/browser-auth/cookies.ts";
import { fetchGitHubViewer, listVisibleInstallations } from "#/backend/github.ts";
import {
  buildBrowserSessionExpiration,
  DEFAULT_BROWSER_RETURN_TO_PATH,
} from "#/backend/browser-auth/policy.ts";
import { githubUserTokenSchema, nanitesSessionSchema } from "#/backend/browser-auth/cookies.ts";
import { z } from "zod";
import { normalizeAuthenticatedReturnToPath } from "#/shared/auth-return-to.ts";

export const TEST_AUTH_MINT_SESSION_PATH = "/auth/test/mint-session";
const TEST_GITHUB_USER_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const TEST_GITHUB_USER_TOKEN_HEADER = "x-github-test-user-token";
const TEST_AUTH_TOKEN_REQUIRED_MESSAGE =
  "Local authenticated browser sessions require a real GitHub user token. Provide GITHUB_TEST_USER_TOKEN, x-github-test-user-token, or ?githubAccessToken=...";

const testAuthQuerySchema = z.object({
  activeGithubInstallationId: z.preprocess((value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    return value;
  }, z.coerce.number().int().positive().nullable().default(null)),
  returnTo: z
    .string()
    .min(1)
    .default(DEFAULT_BROWSER_RETURN_TO_PATH)
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
});

function getTestGitHubUserToken(env: Env): string | null {
  const token = env.GITHUB_TEST_USER_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

function readExplicitGitHubUserToken(
  request: Request,
  params: { githubAccessToken?: string },
): string | null {
  const headerToken = request.headers.get(TEST_GITHUB_USER_TOKEN_HEADER)?.trim();
  if (headerToken && headerToken.length > 0) {
    return headerToken;
  }

  const queryToken = params.githubAccessToken?.trim();
  return queryToken && queryToken.length > 0 ? queryToken : null;
}

export async function handleTestAuthRequest({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method !== "GET" || url.pathname !== TEST_AUTH_MINT_SESSION_PATH) {
    return null;
  }

  const params = testAuthQuerySchema.parse({
    activeGithubInstallationId: url.searchParams.get("activeGithubInstallationId") ?? undefined,
    returnTo: url.searchParams.get("returnTo") ?? undefined,
    redirect: url.searchParams.get("redirect") ?? undefined,
    githubAccessToken: url.searchParams.get("githubAccessToken") ?? undefined,
  });

  const githubTokenExpiresAt = new Date(Date.now() + TEST_GITHUB_USER_TOKEN_TTL_MS).toISOString();
  const sessionExpiresAt = buildBrowserSessionExpiration();
  const realGitHubUserToken =
    readExplicitGitHubUserToken(request, params) ?? getTestGitHubUserToken(env);
  if (!realGitHubUserToken) {
    return Response.json(
      {
        error: TEST_AUTH_TOKEN_REQUIRED_MESSAGE,
      },
      {
        status: 400,
      },
    );
  }

  const { session, githubUserToken } = await (async () => {
    const viewer = await fetchGitHubViewer(realGitHubUserToken);
    const visibleInstallations = await listVisibleInstallations(realGitHubUserToken);
    const sessionInstallationSnapshots = readSessionInstallationSnapshots(visibleInstallations);

    return {
      session: nanitesSessionSchema.parse({
        githubViewer: viewer,
        activeGithubInstallationId:
          params.activeGithubInstallationId ?? sessionInstallationSnapshots[0]?.id ?? null,
        sessionInstallationSnapshot:
          sessionInstallationSnapshots.find(
            (installation) => installation.id === params.activeGithubInstallationId,
          ) ??
          sessionInstallationSnapshots[0] ??
          null,
        expiresAt: sessionExpiresAt,
      }),
      githubUserToken: githubUserTokenSchema.parse({
        accessToken: realGitHubUserToken,
        expiresAt: githubTokenExpiresAt,
        refreshToken: null,
        refreshTokenExpiresAt: null,
      }),
    };
  })();

  const headers = new Headers();
  headers.append("Set-Cookie", clearSessionCookie(request));
  headers.append("Set-Cookie", clearGitHubUserTokenCookie(request));
  headers.append("Set-Cookie", await sealSessionCookie(session, request, env));
  headers.append("Set-Cookie", await sealGitHubUserTokenCookie(githubUserToken, request, env));

  if (params.redirect) {
    headers.set("Location", params.returnTo);
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  return Response.json(
    {
      actor: {
        githubLogin: session.githubViewer.login,
        githubUserId: session.githubViewer.id,
      },
      activeGithubInstallationId: session.activeGithubInstallationId,
      returnTo: params.returnTo,
    },
    {
      headers,
    },
  );
}
