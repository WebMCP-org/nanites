import {
  AUTH_ERROR_MESSAGES,
  activeInstallationSchema,
  authenticatedActorSchema,
  nanitesSessionSchema,
  type ActiveInstallation,
  type AuthenticatedActor,
  type BrowserNanitesContext,
  type GitHubUserToken,
  type NanitesSession,
} from "@nanites/contracts/auth";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import type { GitHubInstallationId } from "@nanites/contracts/ids";
import {
  clearGitHubUserTokenCookie,
  clearSessionCookie,
  readGitHubUserTokenCookie,
  readSessionCookie,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
} from "#/backend/browser-auth/cookies.ts";
import { refreshGitHubUserToken } from "#/backend/browser-auth/github-user-token.ts";
import {
  buildBrowserSessionExpiration,
  GITHUB_USER_TOKEN_REFRESH_THRESHOLD_SECONDS,
} from "#/backend/browser-auth/policy.ts";
import {
  toGitHubInstallationAccount,
  type GitHubVisibleInstallation,
} from "#/backend/github-installations.ts";

type GitHubViewer = RestEndpointMethodTypes["users"]["getAuthenticated"]["response"]["data"];

export type SessionInstallationSelection =
  | {
      status: "selected";
      githubInstallationId: GitHubInstallationId;
    }
  | {
      status: "unselected";
    };

export type SessionInstallationResolution =
  | {
      status: "active";
      activeInstallation: ActiveInstallation;
    }
  | {
      status: "unselected";
    }
  | {
      status: "revoked";
      githubInstallationId: GitHubInstallationId;
    };

export class AuthenticationRequiredError extends Error {
  constructor() {
    super(AUTH_ERROR_MESSAGES.authenticationRequired);
    this.name = "AuthenticationRequiredError";
  }
}

export class ActiveInstallationRequiredError extends Error {
  constructor() {
    super(AUTH_ERROR_MESSAGES.activeInstallationRequired);
    this.name = "ActiveInstallationRequiredError";
  }
}

export function isGitHubUserTokenAuthFailure(error: unknown, seen = new Set<unknown>()): boolean {
  if (seen.has(error)) {
    return false;
  }
  seen.add(error);

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };
  const status = candidate.status ?? candidate.response?.status;
  if (status === 401 || status === 403) {
    return true;
  }

  return isGitHubUserTokenAuthFailure(candidate.cause, seen);
}

export async function requireSession(request: Request, env: Env): Promise<NanitesSession> {
  const session = await readSessionCookie(request, env);
  if (!session) {
    throw new AuthenticationRequiredError();
  }

  return session;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function shouldRefreshGitHubUserToken(githubUserToken: GitHubUserToken, now = Date.now()): boolean {
  const expiresAt = parseTimestamp(githubUserToken.expiresAt);
  if (expiresAt === null) {
    return false;
  }

  return expiresAt <= now + GITHUB_USER_TOKEN_REFRESH_THRESHOLD_SECONDS * 1000;
}

function isGitHubUserTokenExpired(githubUserToken: GitHubUserToken, now = Date.now()): boolean {
  const expiresAt = parseTimestamp(githubUserToken.expiresAt);
  return expiresAt !== null && expiresAt <= now;
}

function isRefreshTokenUsable(githubUserToken: GitHubUserToken, now = Date.now()): boolean {
  if (!githubUserToken.refreshToken) {
    return false;
  }

  const refreshTokenExpiresAt = parseTimestamp(githubUserToken.refreshTokenExpiresAt);
  return refreshTokenExpiresAt === null || refreshTokenExpiresAt > now;
}

export async function extendBrowserSession(
  request: Request,
  env: Env,
  session: NanitesSession,
  responseHeaders: Headers | undefined,
): Promise<NanitesSession> {
  const nextSession = nanitesSessionSchema.parse({
    ...session,
    expiresAt: buildBrowserSessionExpiration(),
  });

  responseHeaders?.append("Set-Cookie", await sealSessionCookie(nextSession, request, env));
  return nextSession;
}

export async function requireGitHubUserToken(
  request: Request,
  env: Env,
  options?: {
    allowRefresh?: boolean | undefined;
    clearSessionOnFailure?: boolean | undefined;
    responseHeaders?: Headers | undefined;
  },
): Promise<GitHubUserToken> {
  const githubUserToken = await readGitHubUserTokenCookie(request, env);
  if (!githubUserToken) {
    throw new AuthenticationRequiredError();
  }

  if (!shouldRefreshGitHubUserToken(githubUserToken)) {
    return githubUserToken;
  }

  if (options?.allowRefresh === false) {
    if (isGitHubUserTokenExpired(githubUserToken)) {
      appendGitHubUserTokenFailureCookies(request, options?.responseHeaders, options);
      throw new AuthenticationRequiredError();
    }

    return githubUserToken;
  }

  if (!isRefreshTokenUsable(githubUserToken)) {
    appendGitHubUserTokenFailureCookies(request, options?.responseHeaders, options);
    throw new AuthenticationRequiredError();
  }

  try {
    const refreshedGitHubUserToken = await refreshGitHubUserToken({
      githubUserToken,
      env,
    });
    options?.responseHeaders?.append(
      "Set-Cookie",
      await sealGitHubUserTokenCookie(refreshedGitHubUserToken, request, env),
    );
    return refreshedGitHubUserToken;
  } catch {
    appendGitHubUserTokenFailureCookies(request, options?.responseHeaders, options);
    throw new AuthenticationRequiredError();
  }
}

export function getActorFromSession(session: NanitesSession): AuthenticatedActor {
  return {
    id: session.githubUserId,
    login: session.githubLogin,
  };
}

export function toAuthenticatedActor(viewer: GitHubViewer): AuthenticatedActor {
  return authenticatedActorSchema.parse(viewer);
}

export function toActiveInstallation(
  visibleInstallation: GitHubVisibleInstallation,
): ActiveInstallation | null {
  if (visibleInstallation.suspended_at) {
    return null;
  }

  return activeInstallationSchema.parse({
    id: visibleInstallation.id,
    account: toGitHubInstallationAccount(visibleInstallation.account),
  });
}

export function toActiveInstallations(
  visibleInstallations: readonly GitHubVisibleInstallation[],
): ActiveInstallation[] {
  return visibleInstallations.flatMap((visibleInstallation) => {
    const activeInstallation = toActiveInstallation(visibleInstallation);
    return activeInstallation ? [activeInstallation] : [];
  });
}

export function findActiveInstallation(
  activeInstallations: readonly ActiveInstallation[],
  githubInstallationId: GitHubInstallationId,
): ActiveInstallation | null {
  for (const activeInstallation of activeInstallations) {
    if (activeInstallation.id !== githubInstallationId) {
      continue;
    }

    return activeInstallation;
  }

  return null;
}

export function buildBrowserNanitesContext(
  session: NanitesSession,
  activeInstallation: ActiveInstallation | null,
): BrowserNanitesContext {
  return {
    actor: getActorFromSession(session),
    activeInstallation,
    expiresAt: session.expiresAt,
  };
}

export function buildCachedBrowserNanitesContext(session: NanitesSession): BrowserNanitesContext {
  return buildBrowserNanitesContext(session, session.activeInstallationSnapshot ?? null);
}

export function selectActiveInstallation(
  session: NanitesSession,
  githubInstallationId: GitHubInstallationId,
  activeInstallation?: ActiveInstallation | null,
): NanitesSession {
  return nanitesSessionSchema.parse({
    ...session,
    activeGithubInstallationId: githubInstallationId,
    activeInstallationSnapshot:
      activeInstallation && activeInstallation.id === githubInstallationId
        ? activeInstallation
        : null,
  });
}

export function clearActiveInstallationSelection(session: NanitesSession): NanitesSession {
  return nanitesSessionSchema.parse({
    ...session,
    activeGithubInstallationId: null,
    activeInstallationSnapshot: null,
  });
}

export function readSessionInstallationSelection(
  session: NanitesSession,
): SessionInstallationSelection {
  const activeGithubInstallationId = session.activeGithubInstallationId;
  if (activeGithubInstallationId === null) {
    return { status: "unselected" };
  }

  return {
    status: "selected",
    githubInstallationId: activeGithubInstallationId,
  };
}

export function requireActiveGithubInstallationId(session: NanitesSession): GitHubInstallationId {
  const selection = readSessionInstallationSelection(session);
  if (selection.status === "unselected") {
    throw new ActiveInstallationRequiredError();
  }

  return selection.githubInstallationId;
}

export function resolveSessionInstallation(
  session: NanitesSession,
  activeInstallations: readonly ActiveInstallation[],
): SessionInstallationResolution {
  const selection = readSessionInstallationSelection(session);
  if (selection.status === "unselected") {
    return { status: "unselected" };
  }

  const activeInstallation = findActiveInstallation(
    activeInstallations,
    selection.githubInstallationId,
  );
  if (activeInstallation) {
    return {
      status: "active",
      activeInstallation,
    };
  }

  return {
    status: "revoked",
    githubInstallationId: selection.githubInstallationId,
  };
}

export function appendExpiredAuthCookies(
  request: Request,
  responseHeaders: Headers | undefined,
): void {
  responseHeaders?.append("Set-Cookie", clearSessionCookie(request));
  responseHeaders?.append("Set-Cookie", clearGitHubUserTokenCookie(request));
}

function appendGitHubUserTokenFailureCookies(
  request: Request,
  responseHeaders: Headers | undefined,
  options: { clearSessionOnFailure?: boolean | undefined } | undefined,
): void {
  if (options?.clearSessionOnFailure === false) {
    responseHeaders?.append("Set-Cookie", clearGitHubUserTokenCookie(request));
    return;
  }

  appendExpiredAuthCookies(request, responseHeaders);
}
