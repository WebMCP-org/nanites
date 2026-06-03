import {
  sessionInstallationSnapshotSchema,
  githubUserTokenSchema,
  nanitesSessionSchema,
  type SessionInstallationSnapshot,
  type BrowserNanitesContext,
  type NanitesSession,
} from "#/backend/browser-auth/cookies.ts";
import { refreshToken as refreshGitHubOAuthToken } from "@octokit/oauth-methods";
import type { GitHubUserToken, GitHubVisibleInstallation } from "#/backend/github.ts";
import {
  clearGitHubUserTokenCookie,
  clearSessionCookie,
  readGitHubUserTokenCookie,
  readSessionCookie,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
} from "#/backend/browser-auth/cookies.ts";
import {
  buildBrowserSessionExpiration,
  GITHUB_USER_TOKEN_REFRESH_THRESHOLD_SECONDS,
} from "#/backend/browser-auth/policy.ts";

export type { SessionInstallationSnapshot } from "#/backend/browser-auth/cookies.ts";

const AUTH_ERROR_MESSAGES = {
  authenticationRequired: "Authentication required.",
  activeInstallationRequired: "An active installation must be selected.",
} as const;

type SessionInstallationSelection =
  | {
      status: "selected";
      githubInstallationId: number;
    }
  | {
      status: "unselected";
    };

type SessionInstallationResolution =
  | {
      status: "active";
      activeInstallation: SessionInstallationSnapshot;
    }
  | {
      status: "unselected";
    }
  | {
      status: "revoked";
      githubInstallationId: number;
    };

type SessionInstallationSnapshots = readonly SessionInstallationSnapshot[];

type RevalidationArgs = {
  req: Request;
  env: Env;
  session: NanitesSession;
  resHeaders: Headers | undefined;
  sessionInstallationSnapshots: SessionInstallationSnapshots;
};
type GitHubVisibleInstallationAccount = NonNullable<GitHubVisibleInstallation["account"]>;

export class AuthenticationRequiredError extends Error {
  constructor() {
    super(AUTH_ERROR_MESSAGES.authenticationRequired);
    this.name = "AuthenticationRequiredError";
  }
}

export class SessionInstallationSnapshotRequiredError extends Error {
  constructor() {
    super(AUTH_ERROR_MESSAGES.activeInstallationRequired);
    this.name = "SessionInstallationSnapshotRequiredError";
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

function readInstallationAccountLogin(account: GitHubVisibleInstallationAccount): string | null {
  if ("login" in account && typeof account.login === "string" && account.login.length > 0) {
    return account.login;
  }

  if ("slug" in account && typeof account.slug === "string" && account.slug.length > 0) {
    return account.slug;
  }

  if ("name" in account && typeof account.name === "string" && account.name.length > 0) {
    return account.name;
  }

  return null;
}

function readInstallationAccountType(account: GitHubVisibleInstallationAccount): string {
  if ("type" in account && typeof account.type === "string" && account.type.length > 0) {
    return account.type;
  }

  if ("slug" in account) {
    return "Enterprise";
  }

  return "Account";
}

async function refreshGitHubUserToken({
  githubUserToken,
  env,
}: {
  githubUserToken: GitHubUserToken;
  env: Env;
}): Promise<GitHubUserToken> {
  if (!githubUserToken.refreshToken) {
    throw new Error("GitHub user token refresh requested without a refresh token.");
  }

  const { authentication } = await refreshGitHubOAuthToken({
    clientType: "github-app",
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    refreshToken: githubUserToken.refreshToken,
  });

  return githubUserTokenSchema.parse({
    accessToken: authentication.token,
    expiresAt: "expiresAt" in authentication ? authentication.expiresAt : null,
    refreshToken: "refreshToken" in authentication ? authentication.refreshToken : null,
    refreshTokenExpiresAt:
      "refreshTokenExpiresAt" in authentication ? authentication.refreshTokenExpiresAt : null,
  });
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

function readSessionInstallationSnapshot(
  visibleInstallation: GitHubVisibleInstallation,
): SessionInstallationSnapshot | null {
  if (visibleInstallation.suspended_at || !visibleInstallation.account) {
    return null;
  }

  const accountLogin = readInstallationAccountLogin(visibleInstallation.account);
  if (!accountLogin) {
    return null;
  }

  return sessionInstallationSnapshotSchema.parse({
    id: visibleInstallation.id,
    account: {
      id: visibleInstallation.account.id,
      login: accountLogin,
      type: readInstallationAccountType(visibleInstallation.account),
      avatar_url: visibleInstallation.account.avatar_url ?? null,
    },
  });
}

export function readSessionInstallationSnapshots(
  visibleInstallations: readonly GitHubVisibleInstallation[],
): SessionInstallationSnapshot[] {
  return visibleInstallations.flatMap((visibleInstallation) => {
    const activeInstallation = readSessionInstallationSnapshot(visibleInstallation);
    return activeInstallation ? [activeInstallation] : [];
  });
}

function findSessionInstallationSnapshot(
  sessionInstallationSnapshots: readonly SessionInstallationSnapshot[],
  githubInstallationId: number,
): SessionInstallationSnapshot | null {
  for (const activeInstallation of sessionInstallationSnapshots) {
    if (activeInstallation.id !== githubInstallationId) {
      continue;
    }

    return activeInstallation;
  }

  return null;
}

export function buildBrowserNanitesContext(
  session: NanitesSession,
  activeInstallation: SessionInstallationSnapshot | null,
): BrowserNanitesContext {
  return {
    actor: session.githubViewer,
    activeInstallation,
    expiresAt: session.expiresAt,
  };
}

export function selectSessionInstallationSnapshot(
  session: NanitesSession,
  githubInstallationId: number,
  activeInstallation?: SessionInstallationSnapshot | null,
): NanitesSession {
  return nanitesSessionSchema.parse({
    ...session,
    activeGithubInstallationId: githubInstallationId,
    sessionInstallationSnapshot:
      activeInstallation && activeInstallation.id === githubInstallationId
        ? activeInstallation
        : null,
  });
}

function clearSessionInstallationSnapshotSelection(session: NanitesSession): NanitesSession {
  return nanitesSessionSchema.parse({
    ...session,
    activeGithubInstallationId: null,
    sessionInstallationSnapshot: null,
  });
}

function readSessionInstallationSelection(session: NanitesSession): SessionInstallationSelection {
  const activeGithubInstallationId = session.activeGithubInstallationId;
  if (activeGithubInstallationId === null) {
    return { status: "unselected" };
  }

  return {
    status: "selected",
    githubInstallationId: activeGithubInstallationId,
  };
}

export function requireActiveGithubInstallationId(session: NanitesSession): number {
  const selection = readSessionInstallationSelection(session);
  if (selection.status === "unselected") {
    throw new SessionInstallationSnapshotRequiredError();
  }

  return selection.githubInstallationId;
}

function resolveSessionInstallation(
  session: NanitesSession,
  sessionInstallationSnapshots: readonly SessionInstallationSnapshot[],
): SessionInstallationResolution {
  const selection = readSessionInstallationSelection(session);
  if (selection.status === "unselected") {
    return { status: "unselected" };
  }

  const activeInstallation = findSessionInstallationSnapshot(
    sessionInstallationSnapshots,
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

export async function clearRevokedSessionSelectionIfNeeded(input: RevalidationArgs): Promise<void> {
  const resolution = resolveSessionInstallation(input.session, input.sessionInstallationSnapshots);
  if (resolution.status !== "revoked") {
    return;
  }

  const nextSession = clearSessionInstallationSnapshotSelection(input.session);
  input.resHeaders?.append(
    "Set-Cookie",
    await sealSessionCookie(nextSession, input.req, input.env),
  );
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
