import { useQuery } from "@tanstack/react-query";
import {
  AUTH_SESSION_QUERY_KEY,
  EMPTY_VISIBLE_INSTALLATIONS,
  VISIBLE_INSTALLATIONS_QUERY_KEY,
  fetchOptionalSession,
  fetchVisibleInstallations,
  resolveBrowserInstallationSelection,
} from "#/frontend/lib/auth.ts";

export function useBrowserInstallationSelection(
  requestedInstallationId: number | null | undefined,
) {
  const { data: session, isPending: isSessionPending } = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: fetchOptionalSession,
    throwOnError: true,
  });
  const shouldLoadInstallations = !isSessionPending && session !== null;
  const { data: installationsData, isPending: isInstallationsPending } = useQuery({
    queryKey: VISIBLE_INSTALLATIONS_QUERY_KEY,
    queryFn: fetchVisibleInstallations,
    enabled: shouldLoadInstallations,
    throwOnError: true,
  });
  const visibleInstallations = installationsData?.installations ?? EMPTY_VISIBLE_INSTALLATIONS;

  return {
    session,
    visibleInstallations,
    installationSelection: resolveBrowserInstallationSelection({
      session,
      installations: visibleInstallations,
      requestedInstallationId,
    }),
    isPending: isSessionPending || (shouldLoadInstallations && isInstallationsPending),
  };
}
