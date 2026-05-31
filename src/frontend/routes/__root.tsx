import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { NanitesRouterContext } from "#/frontend/router.ts";
import { RouteErrorBoundary } from "#/frontend/routes/-route-state.tsx";

export const Route = createRootRouteWithContext<NanitesRouterContext>()({
  component: RootComponent,
  errorComponent: RouteErrorBoundary,
});

function RootComponent() {
  return <Outlet />;
}
