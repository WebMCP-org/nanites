import { createFileRoute } from "@tanstack/react-router";
import { buildReturnToPath, requireSession } from "#/frontend/lib/auth.ts";

// No component: the pathless layout only guards auth; <Outlet /> is the default.
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    await requireSession(context, buildReturnToPath(location));
  },
});
