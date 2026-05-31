import type { BrowserNanitesContext, OptionalBrowserNanitesContext } from "@nanites/contracts/auth";
import { AUTH_ERROR_CODES } from "@nanites/contracts/auth";
import { ORPCError } from "@orpc/client";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import type { AnyRouter } from "@tanstack/react-router";
import type { NanitesRouterContext } from "#/frontend/router.ts";
import { setQueryAuthErrorHandler } from "#/frontend/lib/orpc.tsx";
import {
  AUTH_RETURN_TO_PARAM,
  DEFAULT_AUTH_RETURN_TO_PATH,
  normalizeAuthenticatedReturnToPath,
  normalizeReturnToPath,
  readRequestedReturnTo,
  resolveAuthReturnTo,
} from "#/shared/auth-return-to.ts";

export const DEFAULT_AUTH_RETURN_TO = DEFAULT_AUTH_RETURN_TO_PATH;
export { normalizeReturnToPath, resolveAuthReturnTo };

interface AuthErrorDataCarrier {
  readonly code?: unknown;
}

interface InstallationAuthErrorDataCarrier extends AuthErrorDataCarrier {
  readonly githubInstallationId?: unknown;
}

export interface InstallationAuthErrorDetails {
  readonly code:
    | typeof AUTH_ERROR_CODES.activeInstallationRequired
    | typeof AUTH_ERROR_CODES.installationAccessRevoked;
  readonly githubInstallationId?: number;
}

export interface BrowserLocationLike {
  readonly pathname: string;
  readonly search?: unknown;
  readonly hash?: unknown;
}

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

export async function invalidateAuthQueries(
  queryClient: QueryClient,
  authQueryKey: readonly unknown[],
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: authQueryKey,
  });
}

export async function loadSession(
  context: NanitesRouterContext,
  options?: {
    readonly force?: boolean;
  },
): Promise<OptionalBrowserNanitesContext> {
  const sessionQueryOptions = context.orpc.auth.session.get.queryOptions();
  const session = options?.force
    ? await context.queryClient.fetchQuery(
        context.orpc.auth.session.getOptional.queryOptions({
          staleTime: 0,
        }),
      )
    : await context.queryClient.fetchQuery(context.orpc.auth.session.getOptional.queryOptions());

  if (session) {
    context.queryClient.setQueryData(sessionQueryOptions.queryKey, session);
  } else {
    context.queryClient.removeQueries({
      queryKey: sessionQueryOptions.queryKey,
    });
  }

  return session;
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

function getAuthErrorDataCode(error: ORPCError<string, unknown>): unknown {
  if (typeof error.data !== "object" || error.data === null) {
    return undefined;
  }

  return (error.data as AuthErrorDataCarrier).code;
}

export function isAuthenticationRequiredError(error: unknown): boolean {
  if (!(error instanceof ORPCError) || error.status !== 401) {
    return false;
  }

  const dataCode = getAuthErrorDataCode(error);
  return (
    dataCode === undefined ||
    dataCode === AUTH_ERROR_CODES.authenticationRequired ||
    error.code === "UNAUTHORIZED"
  );
}

export function getInstallationAuthErrorDetails(
  error: unknown,
): InstallationAuthErrorDetails | null {
  if (!(error instanceof ORPCError)) {
    return null;
  }

  const dataCode = getAuthErrorDataCode(error);
  if (
    dataCode !== AUTH_ERROR_CODES.activeInstallationRequired &&
    dataCode !== AUTH_ERROR_CODES.installationAccessRevoked
  ) {
    return null;
  }

  if (typeof error.data !== "object" || error.data === null) {
    return { code: dataCode };
  }

  const githubInstallationId = (error.data as InstallationAuthErrorDataCarrier)
    .githubInstallationId;
  return {
    code: dataCode,
    githubInstallationId:
      typeof githubInstallationId === "number" ? githubInstallationId : undefined,
  };
}

export function isActiveInstallationRequiredError(error: unknown): boolean {
  return (
    getInstallationAuthErrorDetails(error)?.code === AUTH_ERROR_CODES.activeInstallationRequired
  );
}

export function isInstallationAccessRevokedError(error: unknown): boolean {
  return (
    getInstallationAuthErrorDetails(error)?.code === AUTH_ERROR_CODES.installationAccessRevoked
  );
}

function buildAuthenticationNavigateOptions(router: AnyRouter) {
  return {
    to: "/" as const,
    search: {
      returnTo: resolveAuthReturnTo(router.state.location.href),
    },
    replace: true,
  } as const;
}

export function installAuthQueryRedirects(router: AnyRouter): void {
  setQueryAuthErrorHandler((error) => {
    if (isAuthenticationRequiredError(error)) {
      return router.navigate(buildAuthenticationNavigateOptions(router));
    }
  });
}
