/**
 * Safe fallback destination after login when the requested return path is absent or rejected.
 */
export const DEFAULT_AUTH_RETURN_TO_PATH = "/nanites";

/**
 * Browser login route for the Sigvelo dashboard.
 */
const LOGIN_ROUTE_PATH = "/";

/**
 * All GitHub OAuth browser routes live under this prefix.
 */
const GITHUB_AUTH_ROUTE_PREFIX = "/auth/github/";

/**
 * Browser route that starts the GitHub OAuth flow.
 */
export const GITHUB_OAUTH_LOGIN_PATH = `${GITHUB_AUTH_ROUTE_PREFIX}login`;

/**
 * Browser route that receives the GitHub OAuth callback.
 */
export const GITHUB_OAUTH_CALLBACK_PATH = `${GITHUB_AUTH_ROUTE_PREFIX}callback`;

/**
 * Query parameter used to preserve a post-auth redirect target.
 */
export const AUTH_RETURN_TO_PARAM = "returnTo";

/**
 * All auth cookies are scoped to the full app.
 */
export const BROWSER_AUTH_COOKIE_PATH = "/";

/**
 * `SameSite=Lax` allows the top-level GitHub redirect back to the app while still
 * blocking most cross-site ambient-cookie sends.
 */
export const BROWSER_AUTH_COOKIE_SAME_SITE = "lax";

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

const RELATIVE_URL_BASE = "https://sigvelo.local";

function parseRelativeUrl(href: string): URL {
  return new URL(href, RELATIVE_URL_BASE);
}

function isAuthRoutePath(pathname: string): boolean {
  return pathname === LOGIN_ROUTE_PATH || pathname.startsWith(GITHUB_AUTH_ROUTE_PREFIX);
}

export function normalizeReturnToPath(returnTo: string | null | undefined): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return DEFAULT_AUTH_RETURN_TO_PATH;
  }

  return returnTo;
}

export function normalizeAuthenticatedReturnToPath(returnTo: string | null | undefined): string {
  const normalizedReturnTo = normalizeReturnToPath(returnTo);

  if (isAuthRoutePath(parseRelativeUrl(normalizedReturnTo).pathname)) {
    return DEFAULT_AUTH_RETURN_TO_PATH;
  }

  return normalizedReturnTo;
}

export function readRequestedReturnTo(searchParams: URLSearchParams): string {
  return normalizeAuthenticatedReturnToPath(searchParams.get(AUTH_RETURN_TO_PARAM));
}

export function resolveAuthReturnTo(href: string): string {
  const url = parseRelativeUrl(href);

  if (isAuthRoutePath(url.pathname)) {
    return readRequestedReturnTo(url.searchParams);
  }

  return normalizeAuthenticatedReturnToPath(`${url.pathname}${url.search}${url.hash}`);
}
