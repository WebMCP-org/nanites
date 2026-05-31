import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "#/frontend/routes/_admin/-admin-shell.tsx";

export const Route = createFileRoute("/_admin/admin")({
  component: AdminLayoutRoute,
});

function AdminLayoutRoute() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
