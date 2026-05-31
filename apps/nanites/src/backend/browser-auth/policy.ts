import type { SerializeOptions } from "cookie";
import { DEFAULT_AUTH_RETURN_TO_PATH } from "#/shared/auth-return-to.ts";

/**
 * GitHub OAuth state lifetime in seconds.
 *
 * Arbitrary Nanites app policy: ten minutes is long enough for a normal GitHub
 * round-trip without leaving abandoned login state in the browser for too long.
 */
export const GITHUB_OAUTH_STATE_TTL_SECONDS = 10 * 60;

/**
 * Nanites-owned browser session lifetime in seconds.
 *
 * This is intentionally decoupled from the GitHub user access-token lifetime.
 */
export const BROWSER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Refresh the GitHub user token shortly before expiry to avoid mid-request 401s.
 */
export const GITHUB_USER_TOKEN_REFRESH_THRESHOLD_SECONDS = 5 * 60;

/**
 * All auth cookies are scoped to the full app.
 */
export const BROWSER_AUTH_COOKIE_PATH = "/";

/**
 * `SameSite=Lax` allows the top-level GitHub redirect back to the app while still
 * blocking most cross-site ambient-cookie sends.
 */
export const BROWSER_AUTH_COOKIE_SAME_SITE = "lax" satisfies NonNullable<
  SerializeOptions["sameSite"]
>;

/**
 * Auth cookies owned by the Nanites browser login flow.
 *
 * The sealed app session is intentionally distinct from the sealed GitHub user token.
 */
export const BROWSER_AUTH_COOKIE_NAMES = {
  session: "nanites_session",
  githubUserToken: "nanites_github_user_token",
  githubOAuthState: "nanites_github_oauth_state",
} as const satisfies Record<string, string>;

/**
 * Type labels and purpose strings for Nanites browser-auth tokens.
 *
 * Each cookie class uses a distinct type label and key-derivation info value.
 */
export const BROWSER_AUTH_COOKIE_PURPOSES = {
  session: "nanites-session",
  githubUserToken: "github-user-token",
  githubOAuthState: "github-oauth-state",
} as const satisfies Record<string, string>;

/**
 * Internal issuer used for all sealed Nanites browser-auth JWEs.
 */
export const NANITES_BROWSER_AUTH_JWE_ISSUER = "sigvelo:nanites:browser-auth";

/**
 * Direct symmetric JWE key management for sealed browser-auth cookies.
 *
 * @see https://github.com/panva/jose
 * @see https://www.rfc-editor.org/rfc/rfc7516
 */
export const NANITES_BROWSER_AUTH_JWE_ALG = "dir";

/**
 * AES-256-GCM content encryption for sealed browser-auth cookies.
 *
 * @see https://github.com/panva/jose
 * @see https://www.rfc-editor.org/rfc/rfc7518
 */
export const NANITES_BROWSER_AUTH_JWE_ENC = "A256GCM";

/**
 * HKDF hash algorithm for deriving a stable 256-bit JWE secret from the Worker string secret.
 */
export const NANITES_BROWSER_AUTH_HKDF_HASH = "SHA-256";

/**
 * Stable HKDF salt for deriving the JWE content-encryption key from `AUTH_COOKIE_SECRET`.
 *
 * This is Nanites-owned application policy, not a GitHub-defined value.
 */
export const NANITES_BROWSER_AUTH_HKDF_SALT = "sigvelo:nanites:browser-auth";

/**
 * Browser route that receives the GitHub OAuth callback.
 */
export const GITHUB_OAUTH_CALLBACK_PATH = "/auth/github/callback";

/**
 * Browser route that starts the GitHub OAuth flow.
 */
export const GITHUB_OAUTH_LOGIN_PATH = "/auth/github/login";

/**
 * Safe fallback destination after login when the requested return path is absent or rejected.
 */
export const DEFAULT_BROWSER_RETURN_TO_PATH = DEFAULT_AUTH_RETURN_TO_PATH;

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
