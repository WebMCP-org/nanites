import { createDbClient, type DbClient } from "#/backend/db/client.ts";
import {
  githubOAuthStateSchema,
  nanitesSessionSchema,
  type GitHubOAuthState,
} from "#/backend/browser-auth/cookies.ts";
import {
  clearGitHubOAuthStateCookie,
  clearGitHubUserTokenCookie,
  clearSessionCookie,
  readGitHubOAuthStateCookie,
  sealGitHubOAuthStateCookie,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
} from "#/backend/browser-auth/cookies.ts";
import {
  buildBrowserSessionExpiration,
  buildOAuthStateExpiration,
  GITHUB_OAUTH_CALLBACK_PATH,
} from "#/backend/browser-auth/policy.ts";
import { recordAuthFunnelFact } from "#/backend/db/business-mutations.ts";
import { readSessionInstallationSnapshots } from "#/backend/browser-auth/session.ts";
import {
  exchangeGitHubOAuthCode,
  fetchGitHubViewer,
  GITHUB_OAUTH_AUTHORIZE_URL,
  GITHUB_OAUTH_CODE_CHALLENGE_METHOD,
  GITHUB_OAUTH_PROMPT_SELECT_ACCOUNT,
  GITHUB_PKCE_CODE_CHALLENGE_HASH,
  GITHUB_PKCE_CODE_VERIFIER_RANDOM_BYTES,
  listVisibleInstallations,
} from "#/backend/github.ts";
import { normalizeAuthenticatedReturnToPath } from "#/shared/auth-return-to.ts";

class InvalidGitHubOAuthCallbackStateError extends Error {
  constructor() {
    super("Invalid GitHub OAuth callback state.");
    this.name = "InvalidGitHubOAuthCallbackStateError";
  }
}

async function recordAccountAuthFunnelEvent(
  db: DbClient,
  input: Parameters<typeof recordAuthFunnelFact>[1],
): Promise<void> {
  try {
    await recordAuthFunnelFact(db, input);
  } catch (error) {
    console.warn("auth_funnel_event.record_failed", {
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    GITHUB_PKCE_CODE_CHALLENGE_HASH,
    new TextEncoder().encode(codeVerifier),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

async function buildGitHubAuthorizationUrl({
  request,
  env,
  requestedReturnToPath,
}: {
  request: Request;
  env: Env;
  requestedReturnToPath: string | null;
}): Promise<{ authorizationUrl: string; githubOAuthState: GitHubOAuthState }> {
  const codeVerifier = encodeBase64Url(
    crypto.getRandomValues(new Uint8Array(GITHUB_PKCE_CODE_VERIFIER_RANDOM_BYTES)),
  );
  const githubOAuthState = githubOAuthStateSchema.parse({
    state: crypto.randomUUID(),
    codeVerifier,
    returnToPath: normalizeAuthenticatedReturnToPath(requestedReturnToPath),
    expiresAt: buildOAuthStateExpiration(),
  });
  const authorizationUrl = new URL(GITHUB_OAUTH_AUTHORIZE_URL);

  authorizationUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", buildGitHubOAuthCallbackUrl(request));
  authorizationUrl.searchParams.set("state", githubOAuthState.state);
  authorizationUrl.searchParams.set("code_challenge", await createCodeChallenge(codeVerifier));
  authorizationUrl.searchParams.set("code_challenge_method", GITHUB_OAUTH_CODE_CHALLENGE_METHOD);
  authorizationUrl.searchParams.set("prompt", GITHUB_OAUTH_PROMPT_SELECT_ACCOUNT);

  return { authorizationUrl: authorizationUrl.toString(), githubOAuthState };
}

function toCanonicalLocalAuthUrl(request: Request): URL | null {
  const url = new URL(request.url);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "::1" && url.hostname !== "[::1]") {
    return null;
  }

  url.hostname = "localhost";
  return url;
}

function buildGitHubOAuthCallbackUrl(request: Request): string {
  const canonicalUrl = toCanonicalLocalAuthUrl(request);
  return new URL(GITHUB_OAUTH_CALLBACK_PATH, canonicalUrl ?? request.url).toString();
}

export async function handleGitHubLoginRequest(request: Request, env: Env): Promise<Response> {
  const canonicalUrl = toCanonicalLocalAuthUrl(request);
  if (canonicalUrl) {
    return Response.redirect(canonicalUrl, 302);
  }

  const url = new URL(request.url);
  const { authorizationUrl, githubOAuthState } = await buildGitHubAuthorizationUrl({
    request,
    env,
    requestedReturnToPath: url.searchParams.get("returnTo"),
  });
  const db = createDbClient(env.DB);
  await recordAccountAuthFunnelEvent(db, {
    eventType: "github_oauth_started",
    metadata: {
      returnToPath: githubOAuthState.returnToPath,
    },
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl,
      "Set-Cookie": await sealGitHubOAuthStateCookie(githubOAuthState, request, env),
    },
  });
}

async function requireGitHubOAuthCallbackState(
  request: Request,
  env: Env,
  url: URL,
): Promise<{ code: string; githubOAuthState: GitHubOAuthState }> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const githubOAuthState = await readGitHubOAuthStateCookie(request, env);

  if (!code || !state || !githubOAuthState || githubOAuthState.state !== state) {
    throw new InvalidGitHubOAuthCallbackStateError();
  }

  return { code, githubOAuthState };
}

export async function handleGitHubOAuthCallbackRequest({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const db = createDbClient(env.DB);
    await recordAccountAuthFunnelEvent(db, {
      eventType: "github_oauth_callback_failed",
      metadata: {
        error: oauthError,
      },
    });
    return new Response(`GitHub OAuth failed: ${oauthError}`, {
      status: 400,
      headers: {
        "Set-Cookie": clearGitHubOAuthStateCookie(request),
      },
    });
  }

  let callbackState: { code: string; githubOAuthState: GitHubOAuthState };
  try {
    callbackState = await requireGitHubOAuthCallbackState(request, env, url);
  } catch (error) {
    if (!(error instanceof InvalidGitHubOAuthCallbackStateError)) {
      throw error;
    }

    const db = createDbClient(env.DB);
    await recordAccountAuthFunnelEvent(db, {
      eventType: "github_oauth_callback_failed",
      metadata: {
        error: "invalid_callback_state",
      },
    });

    return new Response("Invalid GitHub OAuth callback state.", {
      status: 400,
      headers: {
        "Set-Cookie": clearGitHubOAuthStateCookie(request),
      },
    });
  }

  const githubUserToken = await exchangeGitHubOAuthCode({
    code: callbackState.code,
    codeVerifier: callbackState.githubOAuthState.codeVerifier,
    redirectUri: buildGitHubOAuthCallbackUrl(request),
    env,
  });
  const actor = await fetchGitHubViewer(githubUserToken.accessToken);
  const visibleInstallations = await listVisibleInstallations(githubUserToken.accessToken);
  const sessionInstallationSnapshots = readSessionInstallationSnapshots(visibleInstallations);
  const db = createDbClient(env.DB);
  const session = nanitesSessionSchema.parse({
    githubViewer: actor,
    activeGithubInstallationId: sessionInstallationSnapshots[0]?.id ?? null,
    sessionInstallationSnapshot: sessionInstallationSnapshots[0] ?? null,
    expiresAt: buildBrowserSessionExpiration(),
  });

  await recordAccountAuthFunnelEvent(db, {
    githubUserId: actor.id,
    githubLogin: actor.login,
    githubInstallationId: sessionInstallationSnapshots[0]?.id ?? null,
    eventType: "github_oauth_callback_succeeded",
    metadata: {
      visibleInstallationCount: visibleInstallations.length,
      activeInstallationCount: sessionInstallationSnapshots.length,
    },
  });
  await recordAccountAuthFunnelEvent(db, {
    githubUserId: actor.id,
    githubLogin: actor.login,
    githubInstallationId: sessionInstallationSnapshots[0]?.id ?? null,
    eventType: "first_session_created",
    metadata: {
      activeGithubInstallationId: session.activeGithubInstallationId,
    },
  });
  if (sessionInstallationSnapshots[0]) {
    await recordAccountAuthFunnelEvent(db, {
      githubUserId: actor.id,
      githubLogin: actor.login,
      githubInstallationId: sessionInstallationSnapshots[0].id,
      eventType: "first_visible_installation_auto_selected",
      metadata: {
        githubInstallationId: sessionInstallationSnapshots[0].id,
      },
    });
  }

  const headers = new Headers();
  headers.set("Location", callbackState.githubOAuthState.returnToPath);
  headers.append("Set-Cookie", clearGitHubOAuthStateCookie(request));
  headers.append("Set-Cookie", clearSessionCookie(request));
  headers.append("Set-Cookie", clearGitHubUserTokenCookie(request));
  headers.append("Set-Cookie", await sealSessionCookie(session, request, env));
  headers.append("Set-Cookie", await sealGitHubUserTokenCookie(githubUserToken, request, env));

  return new Response(null, {
    status: 302,
    headers,
  });
}
