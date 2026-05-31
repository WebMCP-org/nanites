import { createContext, type ReactNode, useContext } from "react";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { RouterClient } from "@orpc/server";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppRouter } from "#/backend/orpc/router.ts";
import type { AdminRouter } from "#/backend/orpc/routers/admin.ts";
import { ADMIN_RPC_PREFIX, RPC_PREFIX } from "#/shared/constants/rpc.ts";

/**
 * Browser-side oRPC data should stay warm until the UI explicitly invalidates it.
 *
 * Live Nanite state comes from `useAgent`/`useAgentChat`, not TanStack Query refetch churn.
 */
const QUERY_STALE_TIME_MS = Number.POSITIVE_INFINITY;

/** Keep cached query data around across route transitions for a long time. */
const QUERY_GC_TIME_MS = 30 * 24 * 60 * 60 * 1000;

/** 3 retries covers transient network failures without delaying permanent errors. */
const MAX_QUERY_RETRIES = 3;

interface HttpStatusCarrier {
  readonly status: unknown;
}

interface ORPCProviderProps {
  readonly children: ReactNode;
}

type QueryAuthErrorHandler = (error: unknown) => Promise<void> | void;

function hasStatus(error: unknown): error is HttpStatusCarrier {
  return typeof error === "object" && error !== null && "status" in error;
}

function getErrorStatus(error: unknown): number | null {
  if (!hasStatus(error)) {
    return null;
  }

  const { status } = error;
  return typeof status === "number" ? status : null;
}

let queryAuthErrorHandler: QueryAuthErrorHandler | null = null;

function handleQueryAuthError(error: unknown): Promise<void> | void {
  return queryAuthErrorHandler?.(error);
}

export function setQueryAuthErrorHandler(handler: QueryAuthErrorHandler | null): void {
  queryAuthErrorHandler = handler;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => handleQueryAuthError(error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => handleQueryAuthError(error),
  }),
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME_MS,
      gcTime: QUERY_GC_TIME_MS,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failureCount, error) => {
        const status = getErrorStatus(error);
        if (status !== null && status >= 400 && status < 500) {
          return false;
        }

        return failureCount < MAX_QUERY_RETRIES;
      },
    },
  },
});

type Client = RouterClient<AppRouter>;
type AdminClient = RouterClient<AdminRouter>;

const link = new RPCLink({
  url: () => new URL(RPC_PREFIX, window.location.origin),
  plugins: [new SimpleCsrfProtectionLinkPlugin()],
});
const adminLink = new RPCLink({
  url: () => new URL(ADMIN_RPC_PREFIX, window.location.origin),
  plugins: [new SimpleCsrfProtectionLinkPlugin()],
});

const client: Client = createORPCClient(link);
const adminClient: AdminClient = createORPCClient(adminLink);

export const orpc = createTanstackQueryUtils(client);
export const adminOrpc = createTanstackQueryUtils(adminClient);
export type ORPCUtils = typeof orpc;
export type AdminORPCUtils = typeof adminOrpc;

const ORPCContext = createContext<ORPCUtils | null>(null);
const AdminORPCContext = createContext<AdminORPCUtils | null>(null);

export function ORPCProvider({ children }: ORPCProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ORPCContext.Provider value={orpc}>
        <AdminORPCContext.Provider value={adminOrpc}>{children}</AdminORPCContext.Provider>
      </ORPCContext.Provider>
    </QueryClientProvider>
  );
}

/** Returns the shared typed oRPC TanStack Query helpers for the current router tree. */
export function useORPC() {
  const value = useContext(ORPCContext);
  if (!value) {
    throw new Error("useORPC must be used within ORPCProvider");
  }

  return value;
}

/** Returns the shared typed admin oRPC helpers for the Cloudflare-only admin surface. */
export function useAdminORPC() {
  const value = useContext(AdminORPCContext);
  if (!value) {
    throw new Error("useAdminORPC must be used within ORPCProvider");
  }

  return value;
}
