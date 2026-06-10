import { getLogger } from "@logtape/logtape";
import { APP_ERRORS, AppError, readPublicAppErrorBody } from "#/backend/errors.ts";
import { createDbClient, type DbClient } from "#/backend/db/index.ts";
import { getWebFlowAuthorizationUrl } from "@octokit/oauth-methods";
import {
  buildBrowserSessionExpiration,
  buildOAuthStateExpiration,
  clearGitHubOAuthStateCookie,
  clearGitHubUserTokenCookie,
  clearSessionCookie,
  githubOAuthStateSchema,
  githubUserTokenSchema,
  nanitesSessionSchema,
  readSessionInstallationSnapshots,
  readGitHubOAuthStateCookie,
  sealGitHubOAuthStateCookie,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
  appendExpiredAuthCookies,
  requireSession,
} from "#/backend/auth/session.ts";
import { recordAuthFunnelFact, recordVisibleInstallationSnapshots } from "#/backend/db/facts.ts";
import {
  exchangeGitHubOAuthCode,
  fetchGitHubViewer,
  listVisibleInstallations,
} from "#/backend/github/index.ts";
import { requireDeploymentGitHubAppConfig } from "#/backend/github/app-config.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { GITHUB_OAUTH_CALLBACK_PATH, normalizeAuthenticatedReturnToPath } from "#/auth.ts";
import {
  MANAGER_CONVERSATION_AGENT_NAME,
  NANITE_MANAGER_NAME,
  buildNaniteManagerKey,
} from "#/nanites.ts";

const authLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild("auth")
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  });

async function recordAccountAuthFunnelEvent(
  db: DbClient,
  input: Parameters<typeof recordAuthFunnelFact>[1],
): Promise<void> {
  try {
    await recordAuthFunnelFact(db, input);
  } catch (error) {
    authLogger.warn(LOG_EVENTS.AUTH_FUNNEL_EVENT_RECORD_FAILED, {
      [OTEL_ATTRS.AUTH_FUNNEL_EVENT_TYPE]: input.eventType,
      [OTEL_ATTRS.EXCEPTION_MESSAGE]: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildGitHubOAuthCallbackUrl(request: Request): string {
  const url = new URL(request.url);
  if (url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]") {
    url.hostname = "localhost";
  }

  return new URL(GITHUB_OAUTH_CALLBACK_PATH, url).toString();
}

export async function startGitHubOAuthLogin({
  request,
  env,
  requestedReturnToPath,
}: {
  request: Request;
  env: Env;
  requestedReturnToPath: string | null;
}) {
  const githubOAuthState = githubOAuthStateSchema.parse({
    state: crypto.randomUUID(),
    returnToPath: normalizeAuthenticatedReturnToPath(requestedReturnToPath),
    expiresAt: buildOAuthStateExpiration(),
  });
  const db = createDbClient(env.DB);
  const githubAppConfig = await requireDeploymentGitHubAppConfig(db, env);
  const { url: authorizationUrl } = getWebFlowAuthorizationUrl({
    clientType: "github-app",
    clientId: githubAppConfig.clientId,
    redirectUrl: buildGitHubOAuthCallbackUrl(request),
    state: githubOAuthState.state,
  });
  await recordAccountAuthFunnelEvent(db, {
    eventType: "github_oauth_started",
    metadata: {
      returnToPath: githubOAuthState.returnToPath,
    },
  });

  return {
    authorizationUrl,
    stateCookie: await sealGitHubOAuthStateCookie(githubOAuthState, request, env),
  };
}

export async function completeGitHubOAuthCallback({
  request,
  env,
  code,
  state,
  oauthError,
}: {
  request: Request;
  env: Env;
  code: string | null;
  state: string | null;
  oauthError: string | null;
}) {
  if (oauthError) {
    const db = createDbClient(env.DB);
    await recordAccountAuthFunnelEvent(db, {
      eventType: "github_oauth_callback_failed",
      metadata: {
        error: oauthError,
      },
    });
    throw new AppError("githubOAuthCallbackFailed", {
      details: { reason: oauthError },
    });
  }

  const githubOAuthState = await readGitHubOAuthStateCookie(request, env);
  if (!code || !state || !githubOAuthState || githubOAuthState.state !== state) {
    const db = createDbClient(env.DB);
    await recordAccountAuthFunnelEvent(db, {
      eventType: "github_oauth_callback_failed",
      metadata: {
        error: "invalid_callback_state",
      },
    });

    throw new AppError("invalidGitHubOAuthCallbackState");
  }

  let githubUserToken: Awaited<ReturnType<typeof exchangeGitHubOAuthCode>>;
  try {
    githubUserToken = await exchangeGitHubOAuthCode({
      code,
      redirectUri: buildGitHubOAuthCallbackUrl(request),
      env,
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.kind !== "githubOAuthTokenExchangeFailed") {
      throw error;
    }

    const githubError =
      typeof error.details?.githubError === "string" ? error.details.githubError : null;
    const githubResponseStatus =
      typeof error.details?.githubResponseStatus === "number"
        ? error.details.githubResponseStatus
        : null;
    const db = createDbClient(env.DB);
    await recordAccountAuthFunnelEvent(db, {
      eventType: "github_oauth_callback_failed",
      metadata: {
        error: githubError ?? "oauth_token_exchange_failed",
        ...(githubResponseStatus === null ? {} : { githubResponseStatus }),
      },
    });

    throw error;
  }
  const actor = await fetchGitHubViewer(githubUserToken.accessToken);
  const visibleInstallations = await listVisibleInstallations(githubUserToken.accessToken);
  const sessionInstallationSnapshots = readSessionInstallationSnapshots(visibleInstallations);
  const db = createDbClient(env.DB);
  await recordVisibleInstallationSnapshots(db, sessionInstallationSnapshots);
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

  return {
    location: githubOAuthState.returnToPath,
    cookies: [
      clearGitHubOAuthStateCookie(request),
      clearSessionCookie(request),
      clearGitHubUserTokenCookie(request),
      await sealSessionCookie(session, request, env),
      await sealGitHubUserTokenCookie(githubUserToken, request, env),
    ],
  };
}

export const TEST_AUTH_MINT_SESSION_PATH = "/auth/test/mint-session";
const TEST_GITHUB_USER_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const TEST_GITHUB_USER_TOKEN_HEADER = "x-github-test-user-token";
const TEST_AUTH_TOKEN_REQUIRED_MESSAGE =
  "Local authenticated browser sessions require a real GitHub user token. Provide GITHUB_TEST_USER_TOKEN, x-github-test-user-token, or ?githubAccessToken=...";

type TestAuthSessionParams = {
  activeGithubInstallationId: number | null;
  githubAccessToken?: string | undefined;
  redirect: boolean;
  returnTo: string;
};

export async function mintTestAuthSession({
  request,
  env,
  params,
}: {
  request: Request;
  env: Env;
  params: TestAuthSessionParams;
}) {
  const githubTokenExpiresAt = new Date(Date.now() + TEST_GITHUB_USER_TOKEN_TTL_MS).toISOString();
  const sessionExpiresAt = buildBrowserSessionExpiration();
  const headerToken = request.headers.get(TEST_GITHUB_USER_TOKEN_HEADER)?.trim();
  const queryToken = params.githubAccessToken?.trim();
  const envToken = env.GITHUB_TEST_USER_TOKEN?.trim();
  const realGitHubUserToken =
    (headerToken && headerToken.length > 0 ? headerToken : null) ??
    (queryToken && queryToken.length > 0 ? queryToken : null) ??
    (envToken && envToken.length > 0 ? envToken : null);
  if (!realGitHubUserToken) {
    throw new AppError("testAuthTokenRequired", {
      details: { hint: TEST_AUTH_TOKEN_REQUIRED_MESSAGE },
    });
  }

  const viewer = await fetchGitHubViewer(realGitHubUserToken);
  const visibleInstallations = await listVisibleInstallations(realGitHubUserToken);
  const sessionInstallationSnapshots = readSessionInstallationSnapshots(visibleInstallations);
  const session = nanitesSessionSchema.parse({
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
  });
  const githubUserToken = githubUserTokenSchema.parse({
    accessToken: realGitHubUserToken,
    expiresAt: githubTokenExpiresAt,
    refreshToken: null,
    refreshTokenExpiresAt: null,
  });

  return {
    cookies: [
      clearSessionCookie(request),
      clearGitHubUserTokenCookie(request),
      await sealSessionCookie(session, request, env),
      await sealGitHubUserTokenCookie(githubUserToken, request, env),
    ],
    redirectTo: params.redirect ? params.returnTo : null,
    body: {
      actor: {
        githubLogin: session.githubViewer.login,
        githubUserId: session.githubViewer.id,
      },
      activeGithubInstallationId: session.activeGithubInstallationId,
      returnTo: params.returnTo,
    },
  };
}

const AGENT_AUTH_HEADERS = {
  kind: "x-nanites-auth-kind",
  githubLogin: "x-nanites-github-login",
  githubUserId: "x-nanites-github-user-id",
  activeInstallationId: "x-nanites-active-installation-id",
} as const;

type AgentRouteTarget = {
  className: string;
  instanceName: string;
};

function toAgentErrorResponse(error: AppError, request?: Request): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (error.kind === "authenticationRequired" && request) {
    appendExpiredAuthCookies(request, headers);
  }

  return new Response(JSON.stringify(readPublicAppErrorBody(error)), {
    status: APP_ERRORS[error.kind].status,
    headers,
  });
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function getAgentRouteTarget(request: Request): AgentRouteTarget | null {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "agents" || !segments[1] || !segments[2]) {
    return null;
  }

  const className = decodePathSegment(segments[1]);
  const instanceName = decodePathSegment(segments[2]);
  if (!className || !instanceName) {
    return null;
  }

  return { className, instanceName };
}

function matchesNaniteAgentClass(className: string, expectedClassName: string): boolean {
  return (
    className === expectedClassName || className.toLowerCase() === expectedClassName.toLowerCase()
  );
}

function authorizeNaniteAgentScope(request: Request): AppError | null {
  const routeTarget = getAgentRouteTarget(request);
  if (!routeTarget) {
    return null;
  }

  const isNaniteManager = matchesNaniteAgentClass(routeTarget.className, NANITE_MANAGER_NAME);
  const isManagerConversation = matchesNaniteAgentClass(
    routeTarget.className,
    MANAGER_CONVERSATION_AGENT_NAME,
  );
  if (!isNaniteManager && !isManagerConversation) {
    return null;
  }

  const activeInstallationId = request.headers.get(AGENT_AUTH_HEADERS.activeInstallationId);
  if (!activeInstallationId) {
    return new AppError("activeInstallationRequired");
  }

  const installationId = Number(activeInstallationId);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return new AppError("activeInstallationRequired");
  }

  const managerName = buildNaniteManagerKey(installationId);

  if (isNaniteManager && routeTarget.instanceName !== managerName) {
    return new AppError("agentAuthorizationForbidden", {
      details: { reason: "Nanite manager does not belong to the active installation." },
    });
  }

  if (isManagerConversation && !routeTarget.instanceName.startsWith(`${managerName}:`)) {
    return new AppError("agentAuthorizationForbidden", {
      details: {
        reason: "Manager conversation does not belong to the active installation.",
      },
    });
  }

  return null;
}

export async function authorizeAgentRequest(
  request: Request,
  env: Env,
): Promise<Request | Response> {
  try {
    const session = await requireSession(request, env);

    const headers = new Headers(request.headers);
    headers.set(AGENT_AUTH_HEADERS.kind, "browser-session");
    headers.set(AGENT_AUTH_HEADERS.githubLogin, session.githubViewer.login);
    headers.set(AGENT_AUTH_HEADERS.githubUserId, String(session.githubViewer.id));

    if (session.activeGithubInstallationId === null) {
      headers.delete(AGENT_AUTH_HEADERS.activeInstallationId);
    } else {
      headers.set(
        AGENT_AUTH_HEADERS.activeInstallationId,
        String(session.activeGithubInstallationId),
      );
    }

    const authorizedRequest = new Request(request, { headers });
    const authorizationError = authorizeNaniteAgentScope(authorizedRequest);
    return authorizationError ? toAgentErrorResponse(authorizationError) : authorizedRequest;
  } catch (error) {
    if (error instanceof AppError && error.kind === "authenticationRequired") {
      return toAgentErrorResponse(error, request);
    }

    throw error;
  }
}
