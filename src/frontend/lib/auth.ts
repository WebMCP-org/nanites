import { AUTH_RETURN_TO_PARAM } from "#/shared/constants.ts";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { parseResponse } from "hono/client";
import type { InferResponseType } from "hono/client";
import { httpClient } from "#/frontend/lib/http-client.ts";
import type { NanitesRouterContext } from "#/frontend/lib/router.ts";
import { normalizeAuthenticatedReturnToPath, normalizeReturnToPath } from "#/shared/utils/auth.ts";

export type OptionalBrowserNanitesContext = InferResponseType<
  typeof httpClient.api.auth.session.optional.$get,
  200
>;
export type BrowserNanitesContext = NonNullable<OptionalBrowserNanitesContext>;
export type SessionInstallationSnapshot = NonNullable<BrowserNanitesContext["activeInstallation"]>;

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
