import type { QueryClient } from "@tanstack/react-query";
import { type RouterHistory, createRouter } from "@tanstack/react-router";
import {
  RouteErrorBoundary,
  RouteNotFoundPage,
  RoutePendingPage,
} from "#/frontend/features/routing/route-state.tsx";
import type { AdminORPCUtils, ORPCUtils } from "#/frontend/lib/orpc.tsx";
import { adminOrpc, orpc, queryClient } from "#/frontend/lib/orpc.tsx";
import { routeTree } from "#/frontend/routeTree.gen.ts";

/** Shared router context used by route loaders and beforeLoad auth guards. */
export interface NanitesRouterContext {
  queryClient: QueryClient;
  orpc: ORPCUtils;
  adminOrpc: AdminORPCUtils;
}

interface CreateAppRouterOptions {
  readonly history?: RouterHistory;
  readonly context?: NanitesRouterContext;
  readonly scrollRestoration?: boolean;
}

export function createAppRouter({
  history,
  context = {
    queryClient,
    orpc,
    adminOrpc,
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
