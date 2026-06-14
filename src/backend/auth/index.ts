import { getLogger } from "@logtape/logtape";
import { AppError, createAppErrorProblemResponse } from "#/backend/errors.ts";
import { requireBrowserInstallationScope } from "#/backend/auth/installations.ts";
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
  type SessionInstallationSnapshot,
} from "#/backend/auth/session.ts";
import { recordAuthFunnelFact, recordVisibleInstallationSnapshots } from "#/backend/db/facts.ts";
import {
  exchangeGitHubOAuthCode,
  fetchGitHubViewer,
  listVisibleInstallations,
} from "#/backend/github/index.ts";
import { requireDeploymentGitHubApp } from "#/backend/github/apps.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { GITHUB_OAUTH_CALLBACK_PATH, normalizeAuthenticatedReturnToPath } from "#/auth.ts";
import {
  MANAGER_CONVERSATION_AGENT_NAME,
  NANITE_MANAGER_NAME,
  parseNaniteManagerKey,
} from "#/nanites.ts";

const authLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild("auth")
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  });

function chooseActiveInstallation(
  installations: readonly SessionInstallationSnapshot[],
  requestedInstallationId: number | null,
): SessionInstallationSnapshot | null {
  if (requestedInstallationId !== null) {
    return (
      installations.find((installation) => installation.id === requestedInstallationId) ?? null
    );
  }

  return installations.length === 1 ? (installations[0] ?? null) : null;
}

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
  const githubAppConfig = await requireDeploymentGitHubApp(db, env);
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
  const db = createDbClient(env.DB);
  // The user token was minted by the deployment app, so every installation it
  // can see belongs to that app.
  const deploymentGitHubApp = await requireDeploymentGitHubApp(db, env);
  const visibleInstallations = await listVisibleInstallations(githubUserToken.accessToken);
  const sessionInstallationSnapshots = readSessionInstallationSnapshots(
    visibleInstallations,
    deploymentGitHubApp.appId,
  );
  await recordVisibleInstallationSnapshots(db, sessionInstallationSnapshots);
  const activeInstallation = chooseActiveInstallation(sessionInstallationSnapshots, null);
  const session = nanitesSessionSchema.parse({
    githubViewer: actor,
    activeGithubAppId: activeInstallation?.githubAppId ?? null,
    activeGithubInstallationId: activeInstallation?.id ?? null,
    sessionInstallationSnapshot: activeInstallation,
    expiresAt: buildBrowserSessionExpiration(),
  });

  await recordAccountAuthFunnelEvent(db, {
    githubUserId: actor.id,
    githubLogin: actor.login,
    githubInstallationId: activeInstallation?.id ?? null,
    eventType: "github_oauth_callback_succeeded",
    metadata: {
      visibleInstallationCount: visibleInstallations.length,
      activeInstallationCount: sessionInstallationSnapshots.length,
    },
  });
  await recordAccountAuthFunnelEvent(db, {
    githubUserId: actor.id,
    githubLogin: actor.login,
    githubInstallationId: activeInstallation?.id ?? null,
    eventType: "first_session_created",
    metadata: {
      activeGithubInstallationId: session.activeGithubInstallationId,
    },
  });
  if (activeInstallation) {
    await recordAccountAuthFunnelEvent(db, {
      githubUserId: actor.id,
      githubLogin: actor.login,
      githubInstallationId: activeInstallation.id,
      eventType: "first_visible_installation_auto_selected",
      metadata: {
        githubInstallationId: activeInstallation.id,
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
  const db = createDbClient(env.DB);
  const deploymentGitHubApp = await requireDeploymentGitHubApp(db, env);
  const visibleInstallations = await listVisibleInstallations(realGitHubUserToken);
  const sessionInstallationSnapshots = readSessionInstallationSnapshots(
    visibleInstallations,
    deploymentGitHubApp.appId,
  );
  await recordVisibleInstallationSnapshots(db, sessionInstallationSnapshots);
  const activeInstallationSnapshot = chooseActiveInstallation(
    sessionInstallationSnapshots,
    params.activeGithubInstallationId,
  );
  const session = nanitesSessionSchema.parse({
    githubViewer: viewer,
    activeGithubAppId: activeInstallationSnapshot?.githubAppId ?? null,
    activeGithubInstallationId: activeInstallationSnapshot?.id ?? null,
    sessionInstallationSnapshot: activeInstallationSnapshot,
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
      activeGithubInstallationId: session.activeGithubInstallationId,
      returnTo: params.returnTo,
    },
  };
}

const AGENT_AUTH_HEADERS = {
  kind: "x-nanites-auth-kind",
  githubLogin: "x-nanites-github-login",
  githubUserId: "x-nanites-github-user-id",
  activeGithubAppId: "x-nanites-active-github-app-id",
  activeInstallationId: "x-nanites-active-installation-id",
  installationAccountLogin: "x-nanites-installation-account-login",
} as const;

type AgentRouteTarget = {
  className: string;
  instanceName: string;
};

type AgentInstallationTarget = {
  readonly githubAppId: number;
  readonly githubInstallationId: number;
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

function matchesNaniteAgentClass(className: string, expectedClassName: string): boolean {
  return (
    className === expectedClassName || className.toLowerCase() === expectedClassName.toLowerCase()
  );
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

  const managerIdentity = parseNaniteManagerKey(managerName);
  if (!managerIdentity) {
    return new AppError("agentAuthorizationForbidden", {
      details: { reason: "Manager conversation is not addressed to a valid manager." },
    });
  }

  return {
    githubAppId: managerIdentity.githubAppId,
    githubInstallationId: managerIdentity.githubInstallationId,
    managerName,
  };
}

function readNaniteAgentInstallationTarget(
  request: Request,
  session: Awaited<ReturnType<typeof requireSession>>,
): AgentInstallationTarget | AppError | null {
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

  if (isManagerConversation) {
    return readManagerConversationTarget(routeTarget.instanceName, session);
  }

  const managerIdentity = parseNaniteManagerKey(routeTarget.instanceName);
  if (!managerIdentity) {
    return new AppError("agentAuthorizationForbidden", {
      details: { reason: "Nanite manager is not installation-scoped." },
    });
  }

  return {
    githubAppId: managerIdentity.githubAppId,
    githubInstallationId: managerIdentity.githubInstallationId,
    managerName: routeTarget.instanceName,
  };
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

    if (routeTarget) {
      const scope = await requireBrowserInstallationScope(request, env, {
        githubInstallationId: routeTarget.githubInstallationId,
      });
      if (
        routeTarget.githubAppId !== scope.githubAppId ||
        routeTarget.managerName !== scope.managerName
      ) {
        return toAgentErrorResponse(
          new AppError("agentAuthorizationForbidden", {
            details: { reason: "Agent target does not belong to the deployment GitHub App." },
          }),
        );
      }

      headers.set(AGENT_AUTH_HEADERS.activeGithubAppId, String(scope.githubAppId));
      headers.set(AGENT_AUTH_HEADERS.activeInstallationId, String(scope.githubInstallationId));
      headers.set(AGENT_AUTH_HEADERS.installationAccountLogin, scope.account.login);
    } else if (session.activeGithubAppId === null || session.activeGithubInstallationId === null) {
      headers.delete(AGENT_AUTH_HEADERS.activeGithubAppId);
      headers.delete(AGENT_AUTH_HEADERS.activeInstallationId);
      headers.delete(AGENT_AUTH_HEADERS.installationAccountLogin);
    } else {
      headers.set(AGENT_AUTH_HEADERS.activeGithubAppId, String(session.activeGithubAppId));
      headers.set(
        AGENT_AUTH_HEADERS.activeInstallationId,
        String(session.activeGithubInstallationId),
      );
    }

    return new Request(request, { headers });
  } catch (error) {
    if (error instanceof AppError && error.kind === "authenticationRequired") {
      return toAgentErrorResponse(error, request);
    }

    throw error;
  }
}
