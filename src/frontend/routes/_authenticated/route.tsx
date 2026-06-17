import { createFileRoute, retainSearchParams } from "@tanstack/react-router";
import { z } from "zod";
import { buildReturnToPath, requireSession } from "#/frontend/lib/auth.ts";

// No component: the pathless layout only guards auth; <Outlet /> is the default.
// installationId lives here so it persists across the authenticated routes
// (Nanites <-> Observability) without each link re-threading it.
export const Route = createFileRoute("/_authenticated")({
  validateSearch: z.object({
    installationId: z.coerce.number().int().positive().optional(),
  }),
  search: {
    middlewares: [retainSearchParams(["installationId"])],
  },
  beforeLoad: async ({ context, location }) => {
    await requireSession(context, buildReturnToPath(location));
  },
});
