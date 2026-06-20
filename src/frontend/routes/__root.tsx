import { useEffect } from "react";
import { Outlet, createRootRouteWithContext, useLocation } from "@tanstack/react-router";
import type { NanitesRouterContext } from "#/frontend/lib/router.ts";
import { RouteErrorBoundary } from "#/frontend/lib/route-state.tsx";

export const Route = createRootRouteWithContext<NanitesRouterContext>()({
  component: RootRoute,
  errorComponent: RouteErrorBoundary,
});

function RootRoute() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);

  return <Outlet />;
}

function titleForPath(pathname: string): string {
  if (pathname.startsWith("/setup")) return "Setup | Nanites";
  if (pathname.startsWith("/mcp-authorize")) return "Authorize MCP Client | Nanites";
  if (pathname.startsWith("/observability")) return "Observability | Nanites";
  if (pathname.startsWith("/nanites")) return "Nanites Workspace | Nanites";
  return "Sign In | Nanites";
}
