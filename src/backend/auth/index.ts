import {
  GITHUB_OAUTH_CALLBACK_PATH,
  NANITE_MANAGER_NAME,
  MANAGER_CONVERSATION_AGENT_NAME,
  NANITE_AGENT_NAME,
} from "#/shared/constants.ts";
import { getLogger } from "@logtape/logtape";
import { AppError, createAppErrorProblemResponse } from "#/backend/errors.ts";
import { requireDeploymentGitHubInstallation } from "#/backend/auth/installations.ts";
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
  readGitHubOAuthStateCookie,
  sealGitHubOAuthStateCookie,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
  appendExpiredAuthCookies,
  requireSession,
} from "#/backend/auth/session.ts";
import { recordAuthFunnelFact } from "#/backend/db/facts.ts";
import { exchangeGitHubOAuthCode, fetchGitHubViewer } from "#/backend/github/index.ts";
import { requireDeploymentGitHubApp, type GitHubAppMetadata } from "#/backend/github/apps.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { normalizeAuthenticatedReturnToPath } from "#/shared/utils/auth.ts";
import { parseNaniteAgentName } from "#/shared/utils/nanites.ts";

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

function buildGitHubOAuthCallbackUrl(
  request: Request,
  githubApp: Pick<GitHubAppMetadata, "setupOrigin">,
): string {
  const url = new URL(request.url);
  if (githubApp.setupOrigin) {
    return new URL(GITHUB_OAUTH_CALLBACK_PATH, githubApp.setupOrigin).toString();
  }
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
  const githubAppConfig = await requireDeploymentGitHubApp(db, env);
  const { url: authorizationUrl } = getWebFlowAuthorizationUrl({
    clientType: "github-app",
    clientId: githubAppConfig.clientId,
    redirectUrl: buildGitHubOAuthCallbackUrl(request, githubAppConfig),
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
  const db = createDbClient(env.DB);
  if (oauthError) {
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
    await recordAccountAuthFunnelEvent(db, {
      eventType: "github_oauth_callback_failed",
      metadata: {
        error: "invalid_callback_state",
      },
    });

    throw new AppError("invalidGitHubOAuthCallbackState");
  }

  const deploymentGitHubApp = await requireDeploymentGitHubApp(db, env);
  let githubUserToken: Awaited<ReturnType<typeof exchangeGitHubOAuthCode>>;
  try {
    githubUserToken = await exchangeGitHubOAuthCode({
      code,
      redirectUri: buildGitHubOAuthCallbackUrl(request, deploymentGitHubApp),
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
  const session = nanitesSessionSchema.parse({
    githubViewer: actor,
    expiresAt: buildBrowserSessionExpiration(),
  });

  await recordAccountAuthFunnelEvent(db, {
    githubUserId: actor.id,
    githubLogin: actor.login,
    eventType: "github_oauth_callback_succeeded",
  });
  await recordAccountAuthFunnelEvent(db, {
    githubUserId: actor.id,
    githubLogin: actor.login,
    eventType: "first_session_created",
  });

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
  const db = createDbClient(env.DB);
  const deploymentGitHubApp = await requireDeploymentGitHubApp(db, env);
  const session = nanitesSessionSchema.parse({
    githubViewer: viewer,
    expiresAt: sessionExpiresAt,
  });
  const githubUserToken = githubUserTokenSchema.parse({
    accessToken: realGitHubUserToken,
    expiresAt: githubTokenExpiresAt,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    githubAppId: deploymentGitHubApp.appId,
    githubAppClientId: deploymentGitHubApp.clientId,
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
      returnTo: params.returnTo,
    },
  };
}

const AGENT_AUTH_HEADERS = {
  kind: "x-nanites-auth-kind",
  githubLogin: "x-nanites-github-login",
  githubUserId: "x-nanites-github-user-id",
} as const;

type AgentRouteTarget = {
  className: string;
  instanceName: string;
};

type AgentInstallationTarget = {
  readonly managerName: string;
};

function toAgentErrorResponse(error: AppError, request?: Request): Response {
  const headers = new Headers();
  if (error.kind === "authenticationRequired" && request) {
    appendExpiredAuthCookies(request, headers);
  }

  return createAppErrorProblemResponse(error, request, headers);
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

function readManagerConversationTarget(
  instanceName: string,
  session: Awaited<ReturnType<typeof requireSession>>,
): AgentInstallationTarget | AppError {
  const actorSeparator = ":manager:";
  const separatorIndex = instanceName.lastIndexOf(actorSeparator);
  if (separatorIndex <= 0) {
    return new AppError("agentAuthorizationForbidden", {
      details: { reason: "Manager conversation instance is not installation-scoped." },
    });
  }

  const managerName = instanceName.slice(0, separatorIndex);
  const rawActorId = instanceName.slice(separatorIndex + actorSeparator.length);
  const actorId = Number(rawActorId);
  if (!Number.isInteger(actorId) || actorId !== session.githubViewer.id) {
    return new AppError("agentAuthorizationForbidden", {
      details: { reason: "Manager conversation does not belong to the authenticated actor." },
    });
  }

  return { managerName };
}

function readNaniteAgentInstallationTarget(
  request: Request,
  session: Awaited<ReturnType<typeof requireSession>>,
): AgentInstallationTarget | AppError | null {
  const routeTarget = getAgentRouteTarget(request);
  if (!routeTarget) {
    return null;
  }

  const isNaniteManager = routeTarget.className.toLowerCase() === NANITE_MANAGER_NAME.toLowerCase();
  const isNaniteAgent = routeTarget.className.toLowerCase() === NANITE_AGENT_NAME.toLowerCase();
  const isManagerConversation =
    routeTarget.className.toLowerCase() === MANAGER_CONVERSATION_AGENT_NAME.toLowerCase();
  if (!isNaniteManager && !isNaniteAgent && !isManagerConversation) {
    return null;
  }

  if (isManagerConversation) {
    return readManagerConversationTarget(routeTarget.instanceName, session);
  }

  const naniteAgentTarget = isNaniteAgent ? parseNaniteAgentName(routeTarget.instanceName) : null;
  const managerName = isNaniteAgent ? naniteAgentTarget?.managerName : routeTarget.instanceName;
  if (!managerName) {
    return new AppError("agentAuthorizationForbidden", {
      details: { reason: "Nanite agent is not installation-scoped." },
    });
  }

  return { managerName };
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

    const routeTarget = readNaniteAgentInstallationTarget(request, session);
    if (routeTarget instanceof AppError) {
      return toAgentErrorResponse(routeTarget);
    }

    const scope = await requireDeploymentGitHubInstallation(env);
    if (routeTarget) {
      if (routeTarget.managerName !== scope.managerName) {
        return toAgentErrorResponse(
          new AppError("agentAuthorizationForbidden", {
            details: { reason: "Agent target does not belong to the deployment GitHub App." },
          }),
        );
      }
    }

    return new Request(request, { headers });
  } catch (error) {
    if (error instanceof AppError) {
      return toAgentErrorResponse(error, request);
    }

    throw error;
  }
}
