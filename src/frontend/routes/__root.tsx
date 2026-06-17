import { createRootRouteWithContext } from "@tanstack/react-router";
import type { NanitesRouterContext } from "#/frontend/lib/router.ts";
import { RouteErrorBoundary } from "#/frontend/lib/route-state.tsx";

// No component: TanStack Router renders <Outlet /> by default.
export const Route = createRootRouteWithContext<NanitesRouterContext>()({
  errorComponent: RouteErrorBoundary,
});
