import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { DetailedError, parseResponse } from "hono/client";
import type { InferResponseType } from "hono/client";
import { httpClient } from "#/frontend/lib/http-client.ts";
import type { NanitesRouterContext } from "#/frontend/lib/router.ts";
import {
  AUTH_RETURN_TO_PARAM,
  normalizeAuthenticatedReturnToPath,
  normalizeReturnToPath,
} from "#/auth.ts";

type InstallationAuthErrorResponse =
  | {
      code: "active_installation_required";
    }
  | {
      code: "installation_access_revoked";
      githubInstallationId: number;
    };

export type OptionalBrowserNanitesContext = InferResponseType<
  typeof httpClient.api.auth.session.optional.$get,
  200
>;
export type BrowserNanitesContext = NonNullable<OptionalBrowserNanitesContext>;
export type SessionInstallationSnapshot = NonNullable<BrowserNanitesContext["activeInstallation"]>;
export type VisibleInstallationsResponse = {
  readonly installations: readonly SessionInstallationSnapshot[];
};
export type BrowserInstallationSelection = {
  readonly installation: SessionInstallationSnapshot | null;
  readonly canonicalInstallationId: number | null;
};
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
export const VISIBLE_INSTALLATIONS_QUERY_KEY = ["auth", "installations", "visible"] as const;
export const EMPTY_VISIBLE_INSTALLATIONS: readonly SessionInstallationSnapshot[] = [];

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

export async function fetchVisibleInstallations(): Promise<VisibleInstallationsResponse> {
  const response = await parseResponse(httpClient.api.auth.installations.visible.$get());
  return { installations: response.installations };
}

export function resolveBrowserInstallationSelection({
  session,
  installations,
  requestedInstallationId,
}: {
  readonly session: BrowserNanitesContext | null | undefined;
  readonly installations: readonly SessionInstallationSnapshot[];
  readonly requestedInstallationId: number | null | undefined;
}): BrowserInstallationSelection {
  if (!session) {
    return { installation: null, canonicalInstallationId: null };
  }

  const requestedId = requestedInstallationId ?? null;
  const requestedInstallation =
    requestedId === null
      ? null
      : (installations.find((installation) => installation.id === requestedId) ?? null);
  const defaultInstallationId = session.activeInstallation?.id ?? null;
  const defaultInstallation =
    requestedId !== null || defaultInstallationId === null
      ? null
      : (installations.find((installation) => installation.id === defaultInstallationId) ?? null);
  const soleInstallation =
    requestedId !== null || defaultInstallationId !== null || installations.length !== 1
      ? null
      : (installations[0] ?? null);
  const installation = requestedInstallation ?? defaultInstallation ?? soleInstallation;

  return {
    installation,
    canonicalInstallationId:
      installation && requestedId !== installation.id ? installation.id : null,
  };
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

export function readApiErrorMessage(error: unknown): string | null {
  const data = readDetailedErrorData(error);
  if (typeof data !== "object" || data === null) {
    return null;
  }

  if ("detail" in data && typeof (data as { detail?: unknown }).detail === "string") {
    return (data as { detail: string }).detail;
  }

  if ("title" in data && typeof (data as { title?: unknown }).title === "string") {
    return (data as { title: string }).title;
  }

  return null;
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
