import { generateCookie } from "hono/cookie";
import { parse, type CookieOptions } from "hono/utils/cookie";
import { EncryptJWT, jwtDecrypt, errors as joseErrors, type JWTPayload } from "jose";
import { z } from "zod";
import { AppError } from "#/backend/errors.ts";
import type { GitHubUserToken } from "#/backend/github/index.ts";
import { refreshToken as refreshGitHubOAuthToken } from "@octokit/oauth-methods";
import type { GitHubVisibleInstallation } from "#/backend/github/index.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { requireDeploymentGitHubApp } from "#/backend/github/apps.ts";
import {
  BROWSER_AUTH_COOKIE_NAMES,
  BROWSER_AUTH_COOKIE_PATH,
  BROWSER_AUTH_COOKIE_SAME_SITE,
} from "#/auth.ts";
import type { NaniteManagerIdentity } from "#/nanites.ts";

/**
 * GitHub OAuth state lifetime in seconds.
 *
 * Arbitrary Nanites app policy: first-time setup can include GitHub App install
 * and repository-selection detours, so keep the browser state deliberately lax.
 */
const GITHUB_OAUTH_STATE_TTL_SECONDS = 60 * 60;

/**
 * Nanites-owned browser session lifetime in seconds.
 *
 * This is intentionally decoupled from the GitHub user access-token lifetime.
 */
const BROWSER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Refresh the GitHub user token shortly before expiry to avoid mid-request 401s.
 */
const GITHUB_USER_TOKEN_REFRESH_THRESHOLD_SECONDS = 5 * 60;

/**
 * Type labels and purpose strings for Nanites browser-auth tokens.
 *
 * Each cookie class uses a distinct type label and key-derivation info value.
 */
const BROWSER_AUTH_COOKIE_PURPOSES = {
  session: "nanites-session",
  githubUserToken: "github-user-token",
  githubOAuthState: "github-oauth-state",
} as const satisfies Record<string, string>;

/**
 * Internal issuer used for all sealed Nanites browser-auth JWEs.
 */
const NANITES_BROWSER_AUTH_JWE_ISSUER = "sigvelo:nanites:browser-auth";

/**
 * Direct symmetric JWE key management for sealed browser-auth cookies.
 *
 * @see https://github.com/panva/jose
 * @see https://www.rfc-editor.org/rfc/rfc7516
 */
const NANITES_BROWSER_AUTH_JWE_ALG = "dir";

/**
 * AES-256-GCM content encryption for sealed browser-auth cookies.
 *
 * @see https://github.com/panva/jose
 * @see https://www.rfc-editor.org/rfc/rfc7518
 */
const NANITES_BROWSER_AUTH_JWE_ENC = "A256GCM";

/**
 * HKDF hash algorithm for deriving a stable 256-bit JWE secret from the Worker string secret.
 */
const NANITES_BROWSER_AUTH_HKDF_HASH = "SHA-256";

/**
 * Stable HKDF salt for deriving the JWE content-encryption key from `AUTH_COOKIE_SECRET`.
 *
 * This is Nanites-owned application policy, not a GitHub-defined value.
 */
const NANITES_BROWSER_AUTH_HKDF_SALT = "sigvelo:nanites:browser-auth";

function requireAuthCookieSecret(env: Env): string {
  const secret = env.AUTH_COOKIE_SECRET;
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new AppError("deploymentGitHubAppSetupRequired");
  }

  return secret;
}

/**
 * Returns the GitHub OAuth state expiry timestamp as an ISO-8601 UTC string.
 */
export function buildOAuthStateExpiration(now = Date.now()): string {
  return new Date(now + GITHUB_OAUTH_STATE_TTL_SECONDS * 1000).toISOString();
}

/**
 * Returns the Nanites browser-session expiry timestamp as an ISO-8601 UTC string.
 */
export function buildBrowserSessionExpiration(now = Date.now()): string {
  return new Date(now + BROWSER_SESSION_TTL_SECONDS * 1000).toISOString();
}

const isoDateTimeSchema = z.string();
const githubIdSchema = z.number().int().positive();
const githubLoginSchema = z.string().min(1);

type BrowserAuthenticatedActor = {
  id: number;
  login: string;
} & Record<string, unknown>;

type SessionInstallationAccountSnapshot = {
  id: number;
  login: string;
  type: string;
  avatar_url: string | null;
};

export type SessionInstallationSnapshot = {
  id: number;
  githubAppId: number;
  account: SessionInstallationAccountSnapshot;
};

// Cookie boundary check: preserve GitHub's authenticated user object, but require the fields the app reads.
const authenticatedActorSchema: z.ZodType<BrowserAuthenticatedActor> = z
  .object({
    id: githubIdSchema,
    login: githubLoginSchema,
  })
  .passthrough();
const sessionInstallationAccountSchema: z.ZodType<SessionInstallationAccountSnapshot> = z.object({
  id: githubIdSchema,
  login: githubLoginSchema,
  type: z.string().min(1),
  avatar_url: z.string().nullable(),
});

const sessionInstallationSnapshotSchema: z.ZodType<SessionInstallationSnapshot> = z.object({
  id: githubIdSchema,
  githubAppId: githubIdSchema,
  account: sessionInstallationAccountSchema,
});
export const nanitesSessionSchema = z.object({
  githubViewer: authenticatedActorSchema,
  activeGithubAppId: githubIdSchema.nullable(),
  activeGithubInstallationId: githubIdSchema.nullable(),
  sessionInstallationSnapshot: sessionInstallationSnapshotSchema.nullable().optional(),
  expiresAt: isoDateTimeSchema,
});
export const githubUserTokenSchema: z.ZodType<GitHubUserToken> = z.object({
  accessToken: z.string().min(1),
  expiresAt: isoDateTimeSchema.nullable(),
  refreshToken: z.string().min(1).nullable(),
  refreshTokenExpiresAt: isoDateTimeSchema.nullable(),
  githubAppId: githubIdSchema,
  githubAppClientId: z.string().min(1),
});
export const githubOAuthStateSchema = z.object({
  state: z.string().min(1),
  returnToPath: z.string().min(1),
  expiresAt: isoDateTimeSchema,
});

export type NanitesSession = z.infer<typeof nanitesSessionSchema>;
export type GitHubOAuthState = z.infer<typeof githubOAuthStateSchema>;

const textEncoder = new TextEncoder();

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function buildCookieOptions(
  request: Request,
  expiresAt: string,
  overrides?: Partial<CookieOptions>,
): CookieOptions {
  return {
    path: BROWSER_AUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: BROWSER_AUTH_COOKIE_SAME_SITE,
    secure: isSecureRequest(request),
    expires: new Date(expiresAt),
    ...overrides,
  };
}

function buildExpiredCookieOptions(request: Request): CookieOptions {
  return {
    path: BROWSER_AUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: BROWSER_AUTH_COOKIE_SAME_SITE,
    secure: isSecureRequest(request),
    expires: new Date(0),
    maxAge: 0,
  };
}

/**
 * Derives a stable 256-bit JWE secret from the Worker string secret and a purpose label.
 *
 * `AUTH_COOKIE_SECRET` is configured as a Wrangler string secret, not as a pre-generated JWK.
 * HKDF keeps the actual content-encryption key purpose-scoped while still letting the app use one
 * operator-managed Worker secret.
 */
async function deriveCookieEncryptionKey(secret: string, purpose: string): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: NANITES_BROWSER_AUTH_HKDF_HASH,
      salt: textEncoder.encode(NANITES_BROWSER_AUTH_HKDF_SALT),
      info: textEncoder.encode(purpose),
    },
    keyMaterial,
    256,
  );

  return new Uint8Array(derivedBits);
}

type CookiePayloadSchema = z.ZodType<JWTPayload>;

async function sealCookieValue<TSchema extends CookiePayloadSchema>(
  schema: TSchema,
  value: z.input<TSchema>,
  env: Env,
  purpose: string,
  expiresAt: string,
): Promise<string> {
  const parsedValue = schema.parse(value);
  const key = await deriveCookieEncryptionKey(requireAuthCookieSecret(env), purpose);

  return new EncryptJWT(parsedValue)
    .setProtectedHeader({
      alg: NANITES_BROWSER_AUTH_JWE_ALG,
      enc: NANITES_BROWSER_AUTH_JWE_ENC,
      typ: purpose,
    })
    .setIssuer(NANITES_BROWSER_AUTH_JWE_ISSUER)
    .setIssuedAt()
    .setExpirationTime(new Date(expiresAt))
    .encrypt(key);
}

async function readSealedCookieValue<TSchema extends CookiePayloadSchema>(
  schema: TSchema,
  sealedValue: string,
  env: Env,
  purpose: string,
): Promise<z.output<TSchema> | null> {
  const key = await deriveCookieEncryptionKey(requireAuthCookieSecret(env), purpose);

  try {
    const { payload } = await jwtDecrypt<z.output<TSchema>>(sealedValue, key, {
      typ: purpose,
      issuer: NANITES_BROWSER_AUTH_JWE_ISSUER,
      keyManagementAlgorithms: [NANITES_BROWSER_AUTH_JWE_ALG],
      contentEncryptionAlgorithms: [NANITES_BROWSER_AUTH_JWE_ENC],
    });

    return schema.parse(payload);
  } catch (error) {
    if (error instanceof joseErrors.JOSEError || error instanceof z.ZodError) {
      return null;
    }

    throw error;
  }
}

async function readOptionalCookie<TSchema extends CookiePayloadSchema>(
  request: Request,
  env: Env,
  cookieName: string,
  schema: TSchema,
  purpose: string,
): Promise<z.output<TSchema> | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const sealedValue = parse(cookieHeader)[cookieName];
  if (!sealedValue) {
    return null;
  }

  return readSealedCookieValue(schema, sealedValue, env, purpose);
}

export async function sealSessionCookie(
  session: NanitesSession,
  request: Request,
  env: Env,
): Promise<string> {
  return generateCookie(
    BROWSER_AUTH_COOKIE_NAMES.session,
    await sealCookieValue(
      nanitesSessionSchema,
      session,
      env,
      BROWSER_AUTH_COOKIE_PURPOSES.session,
      session.expiresAt,
    ),
    buildCookieOptions(request, session.expiresAt),
  );
}

export async function readSessionCookie(
  request: Request,
  env: Env,
): Promise<NanitesSession | null> {
  return readOptionalCookie(
    request,
    env,
    BROWSER_AUTH_COOKIE_NAMES.session,
    nanitesSessionSchema,
    BROWSER_AUTH_COOKIE_PURPOSES.session,
  );
}

export function clearSessionCookie(request: Request): string {
  return generateCookie(BROWSER_AUTH_COOKIE_NAMES.session, "", buildExpiredCookieOptions(request));
}

export async function sealGitHubUserTokenCookie(
  githubUserToken: GitHubUserToken,
  request: Request,
  env: Env,
): Promise<string> {
  const cookieExpiresAt =
    githubUserToken.refreshTokenExpiresAt ??
    githubUserToken.expiresAt ??
    buildBrowserSessionExpiration();
  return generateCookie(
    BROWSER_AUTH_COOKIE_NAMES.githubUserToken,
    await sealCookieValue(
      githubUserTokenSchema,
      githubUserToken,
      env,
      BROWSER_AUTH_COOKIE_PURPOSES.githubUserToken,
      cookieExpiresAt,
    ),
    buildCookieOptions(request, cookieExpiresAt),
  );
}

async function readGitHubUserTokenCookie(
  request: Request,
  env: Env,
): Promise<GitHubUserToken | null> {
  return readOptionalCookie(
    request,
    env,
    BROWSER_AUTH_COOKIE_NAMES.githubUserToken,
    githubUserTokenSchema,
    BROWSER_AUTH_COOKIE_PURPOSES.githubUserToken,
  );
}

export function clearGitHubUserTokenCookie(request: Request): string {
  return generateCookie(
    BROWSER_AUTH_COOKIE_NAMES.githubUserToken,
    "",
    buildExpiredCookieOptions(request),
  );
}

export async function sealGitHubOAuthStateCookie(
  githubOAuthState: GitHubOAuthState,
  request: Request,
  env: Env,
): Promise<string> {
  return generateCookie(
    BROWSER_AUTH_COOKIE_NAMES.githubOAuthState,
    await sealCookieValue(
      githubOAuthStateSchema,
      githubOAuthState,
      env,
      BROWSER_AUTH_COOKIE_PURPOSES.githubOAuthState,
      githubOAuthState.expiresAt,
    ),
    buildCookieOptions(request, githubOAuthState.expiresAt),
  );
}

export async function readGitHubOAuthStateCookie(
  request: Request,
  env: Env,
): Promise<GitHubOAuthState | null> {
  return readOptionalCookie(
    request,
    env,
    BROWSER_AUTH_COOKIE_NAMES.githubOAuthState,
    githubOAuthStateSchema,
    BROWSER_AUTH_COOKIE_PURPOSES.githubOAuthState,
  );
}

export function clearGitHubOAuthStateCookie(request: Request): string {
  return generateCookie(
    BROWSER_AUTH_COOKIE_NAMES.githubOAuthState,
    "",
    buildExpiredCookieOptions(request),
  );
}

type SessionInstallationSnapshots = readonly SessionInstallationSnapshot[];

type RevalidationArgs = {
  req: Request;
  env: Env;
  session: NanitesSession;
  resHeaders: Headers | undefined;
  sessionInstallationSnapshots: SessionInstallationSnapshots;
};
type GitHubVisibleInstallationAccount = NonNullable<GitHubVisibleInstallation["account"]>;
type RefreshableGitHubUserToken = GitHubUserToken & { refreshToken: string };

export async function requireSession(request: Request, env: Env): Promise<NanitesSession> {
  const session = await readSessionCookie(request, env);
  if (!session) {
    throw new AppError("authenticationRequired");
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

function isRefreshTokenUsable(
  githubUserToken: GitHubUserToken,
  now = Date.now(),
): githubUserToken is RefreshableGitHubUserToken {
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
  githubUserToken: RefreshableGitHubUserToken;
  env: Env;
}): Promise<GitHubUserToken> {
  const githubAppConfig = await requireDeploymentGitHubApp(createDbClient(env.DB), env);
  const { authentication } = await refreshGitHubOAuthToken({
    clientType: "github-app",
    clientId: githubAppConfig.clientId,
    clientSecret: githubAppConfig.clientSecret,
    refreshToken: githubUserToken.refreshToken,
  });

  return githubUserTokenSchema.parse({
    accessToken: authentication.token,
    expiresAt: "expiresAt" in authentication ? authentication.expiresAt : null,
    refreshToken: "refreshToken" in authentication ? authentication.refreshToken : null,
    refreshTokenExpiresAt:
      "refreshTokenExpiresAt" in authentication ? authentication.refreshTokenExpiresAt : null,
    githubAppId: githubAppConfig.appId,
    githubAppClientId: githubAppConfig.clientId,
  });
}

function isGitHubUserTokenBoundToDeploymentApp(
  githubUserToken: GitHubUserToken,
  deploymentApp: { readonly appId: number; readonly clientId: string },
): boolean {
  return (
    githubUserToken.githubAppId === deploymentApp.appId &&
    githubUserToken.githubAppClientId === deploymentApp.clientId
  );
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
    throw new AppError("authenticationRequired");
  }

  const deploymentApp = await requireDeploymentGitHubApp(createDbClient(env.DB), env);
  if (!isGitHubUserTokenBoundToDeploymentApp(githubUserToken, deploymentApp)) {
    appendGitHubUserTokenFailureCookies(request, options?.responseHeaders, options);
    throw new AppError("authenticationRequired");
  }

  if (!shouldRefreshGitHubUserToken(githubUserToken)) {
    return githubUserToken;
  }

  if (options?.allowRefresh === false) {
    if (isGitHubUserTokenExpired(githubUserToken)) {
      appendGitHubUserTokenFailureCookies(request, options?.responseHeaders, options);
      throw new AppError("authenticationRequired");
    }

    return githubUserToken;
  }

  if (!isRefreshTokenUsable(githubUserToken)) {
    appendGitHubUserTokenFailureCookies(request, options?.responseHeaders, options);
    throw new AppError("authenticationRequired");
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
    throw new AppError("authenticationRequired");
  }
}

function readSessionInstallationSnapshot(
  visibleInstallation: GitHubVisibleInstallation,
  githubAppId: number,
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
    githubAppId,
    account: {
      id: visibleInstallation.account.id,
      login: accountLogin,
      type: readInstallationAccountType(visibleInstallation.account),
      avatar_url: visibleInstallation.account.avatar_url ?? null,
    },
  });
}

/**
 * GitHub user tokens list installations of the app that minted them, so every
 * snapshot from one listing belongs to that single app — the caller names it.
 */
export function readSessionInstallationSnapshots(
  visibleInstallations: readonly GitHubVisibleInstallation[],
  githubAppId: number,
): SessionInstallationSnapshot[] {
  return visibleInstallations.flatMap((visibleInstallation) => {
    const activeInstallation = readSessionInstallationSnapshot(visibleInstallation, githubAppId);
    return activeInstallation ? [activeInstallation] : [];
  });
}

export function requireActiveGithubInstallation(session: NanitesSession): NaniteManagerIdentity {
  if (session.activeGithubAppId === null || session.activeGithubInstallationId === null) {
    throw new AppError("activeInstallationRequired");
  }

  return {
    githubAppId: session.activeGithubAppId,
    githubInstallationId: session.activeGithubInstallationId,
  };
}

export async function clearRevokedSessionSelectionIfNeeded(input: RevalidationArgs): Promise<void> {
  const activeGithubInstallationId = input.session.activeGithubInstallationId;
  if (
    activeGithubInstallationId === null ||
    input.sessionInstallationSnapshots.some(
      (installation) =>
        installation.id === activeGithubInstallationId &&
        installation.githubAppId === input.session.activeGithubAppId,
    )
  ) {
    return;
  }

  const nextSession = nanitesSessionSchema.parse({
    ...input.session,
    activeGithubAppId: null,
    activeGithubInstallationId: null,
    sessionInstallationSnapshot: null,
  });
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
