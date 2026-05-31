import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { isAdminNotAuthorizedError } from "#/frontend/features/admin/admin-access.ts";

export const Route = createFileRoute("/_admin")({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(context.adminOrpc.me.get.queryOptions());
    } catch (error) {
      if (isAdminNotAuthorizedError(error)) {
        throw redirect({
          to: "/admin/not-authorized",
        });
      }

      throw error;
    }
  },
  component: AdminGuardLayout,
});

function AdminGuardLayout() {
  return <Outlet />;
}
