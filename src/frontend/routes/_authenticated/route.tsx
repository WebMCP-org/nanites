import { Outlet, createFileRoute } from "@tanstack/react-router";
import { buildReturnToPath, requireSession } from "#/frontend/lib/auth.ts";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    await requireSession(context, buildReturnToPath(location));
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return <Outlet />;
}
