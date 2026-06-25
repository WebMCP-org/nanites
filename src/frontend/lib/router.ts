import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import {
  RouteErrorBoundary,
  RouteNotFoundPage,
  RoutePendingPage,
} from "#/frontend/lib/route-state.tsx";
import { routeTree } from "#/frontend/routeTree.gen.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 30 * 24 * 60 * 60 * 1000,
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

/** Shared router context used by route loaders and beforeLoad auth guards. */
export interface NanitesRouterContext {
  queryClient: QueryClient;
}

export const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
  defaultPendingComponent: RoutePendingPage,
  defaultErrorComponent: RouteErrorBoundary,
  defaultNotFoundComponent: RouteNotFoundPage,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
