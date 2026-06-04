import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { NanitesRouterContext } from "#/frontend/lib/router.ts";
import { RouteErrorBoundary } from "#/frontend/lib/route-state.tsx";

export const Route = createRootRouteWithContext<NanitesRouterContext>()({
  component: RootComponent,
  errorComponent: RouteErrorBoundary,
});

function RootComponent() {
  return <Outlet />;
}
