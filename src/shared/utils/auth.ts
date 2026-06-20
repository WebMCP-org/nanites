import {
  DEFAULT_AUTH_RETURN_TO_PATH,
  LOGIN_ROUTE_PATH,
  GITHUB_AUTH_ROUTE_PREFIX,
  AUTH_RETURN_TO_PARAM,
  RELATIVE_URL_BASE,
} from "#/shared/constants.ts";

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
