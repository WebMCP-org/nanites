import { QueryClient } from "@tanstack/react-query";
import { type RouterHistory, createRouter } from "@tanstack/react-router";
import {
  RouteErrorBoundary,
  RouteNotFoundPage,
  RoutePendingPage,
} from "#/frontend/routes/-route-state.tsx";
import { routeTree } from "#/frontend/routeTree.gen.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 30 * 24 * 60 * 60 * 1000,
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

interface CreateAppRouterOptions {
  readonly history?: RouterHistory;
  readonly context?: NanitesRouterContext;
  readonly scrollRestoration?: boolean;
}

function createAppRouter({
  history,
  context = {
    queryClient,
  },
  scrollRestoration = true,
}: CreateAppRouterOptions = {}) {
  return createRouter({
    routeTree,
    history,
    context,
    defaultPendingComponent: RoutePendingPage,
    defaultErrorComponent: RouteErrorBoundary,
    defaultNotFoundComponent: RouteNotFoundPage,
    scrollRestoration,
  });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
