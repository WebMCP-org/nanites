import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import type { AnyRouter } from "@tanstack/react-router";
import { DetailedError, parseResponse } from "hono/client";
import type { InferResponseType } from "hono/client";
import { httpClient } from "#/frontend/http-client.ts";
import type { NanitesRouterContext } from "#/frontend/router.ts";
import {
  AUTH_RETURN_TO_PARAM,
  DEFAULT_AUTH_RETURN_TO_PATH,
  normalizeAuthenticatedReturnToPath,
  normalizeReturnToPath,
  readRequestedReturnTo,
  resolveAuthReturnTo,
} from "#/shared/auth-return-to.ts";

export const DEFAULT_AUTH_RETURN_TO = DEFAULT_AUTH_RETURN_TO_PATH;
export { resolveAuthReturnTo };

type InstallationAuthErrorResponse =
  | InferResponseType<typeof httpClient.api.auth.installations.active.$post, 403>
  | InferResponseType<(typeof httpClient.api.nanites.manager)[":managerName"]["$get"], 403>;

export type OptionalBrowserNanitesContext = InferResponseType<
  typeof httpClient.api.auth.session.optional.$get,
  200
>;
export type BrowserNanitesContext = NonNullable<OptionalBrowserNanitesContext>;
export type SessionInstallationSnapshot = NonNullable<BrowserNanitesContext["activeInstallation"]>;
export type InstallationAuthErrorDetails = Extract<
  InstallationAuthErrorResponse,
  { code: "active_installation_required" | "installation_access_revoked" }
>;

export interface BrowserLocationLike {
  readonly pathname: string;
  readonly search?: unknown;
  readonly hash?: unknown;
}

const AUTH_QUERY_KEY = ["auth"] as const;
export const AUTH_SESSION_QUERY_KEY = ["auth", "session"] as const;

export function buildReturnToPath(location: BrowserLocationLike): string {
  const search = typeof location.search === "string" ? location.search : "";
  const hash = typeof location.hash === "string" ? location.hash : "";
  return normalizeReturnToPath(`${location.pathname}${search}${hash}`);
}

export function buildLoginHref(returnTo: string): string {
  return `/auth/github/login?returnTo=${encodeURIComponent(normalizeAuthenticatedReturnToPath(returnTo))}`;
}

export function readRequestedReturnToFromWindow(): string {
  return readRequestedReturnTo(new URLSearchParams(window.location.search));
}

export async function invalidateAuthQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: AUTH_QUERY_KEY,
  });
}

export async function fetchOptionalSession(): Promise<OptionalBrowserNanitesContext> {
  return parseResponse(httpClient.api.auth.session.optional.$get());
}

export async function loadSession(
  context: NanitesRouterContext,
  options?: {
    readonly force?: boolean;
  },
): Promise<OptionalBrowserNanitesContext> {
  const queryOptions = {
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: fetchOptionalSession,
    staleTime: options?.force ? 0 : undefined,
  };

  return context.queryClient.fetchQuery(queryOptions);
}

export async function requireSession(
  context: NanitesRouterContext,
  returnTo: string,
): Promise<BrowserNanitesContext> {
  const session = await loadSession(context, { force: true });
  if (session) {
    return session;
  }

  throw redirect({
    href: `/?${AUTH_RETURN_TO_PARAM}=${encodeURIComponent(
      normalizeAuthenticatedReturnToPath(returnTo),
    )}`,
  });
}

function readDetailedErrorData(error: unknown): unknown {
  if (!(error instanceof DetailedError)) {
    return undefined;
  }

  const detail = error.detail;
  return typeof detail === "object" && detail !== null && "data" in detail
    ? (detail as { data?: unknown }).data
    : undefined;
}

function readErrorCode(error: unknown): unknown {
  const data = readDetailedErrorData(error);
  if (typeof data !== "object" || data === null || !("code" in data)) {
    return undefined;
  }

  return (data as { code?: unknown }).code;
}

export function isAuthenticationRequiredError(error: unknown): boolean {
  if (!(error instanceof DetailedError)) {
    return false;
  }

  if (error.statusCode !== 401) {
    return false;
  }

  const code = readErrorCode(error);
  return code === undefined || code === "authentication_required";
}

export function getInstallationAuthErrorDetails(
  error: unknown,
): InstallationAuthErrorDetails | null {
  const code = readErrorCode(error);
  if (code !== "active_installation_required" && code !== "installation_access_revoked") {
    return null;
  }

  const data = readDetailedErrorData(error);
  const githubInstallationId =
    typeof data === "object" && data !== null && "githubInstallationId" in data
      ? (data as { githubInstallationId?: unknown }).githubInstallationId
      : undefined;

  if (code === "active_installation_required") {
    return { code };
  }

  return typeof githubInstallationId === "number" ? { code, githubInstallationId } : null;
}

export function installAuthQueryRedirects(_router: AnyRouter): void {
  // Hono fetch helpers will wire auth redirects in the replacement API client.
}
