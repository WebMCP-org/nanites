import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowClockwiseIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Link, useRouter } from "@tanstack/react-router";
import { Button, Card } from "@nanites/ui";
import { useAdminORPC } from "#/frontend/lib/orpc.tsx";
import { ADMIN_API_DOCS_PATH } from "#/shared/constants/openapi-document.ts";

const ADMIN_NAV_ITEMS = [
  { to: "/admin", label: "Overview", exact: true },
  { to: "/admin/accounts", label: "Accounts", exact: false },
  { to: "/admin/people", label: "People", exact: true },
  { to: "/admin/usage", label: "Usage", exact: true },
  { to: "/admin/ai-costs", label: "AI Costs", exact: true },
] as const;

export function AdminShell(props: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const adminOrpc = useAdminORPC();
  const refreshAdminData = useMutation(
    adminOrpc.refresh.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries();
        await router.invalidate();
      },
    }),
  );

  return (
    <div className="admin-page">
      <div className="app-page-header">
        <div>
          <span className="app-page-eyebrow">Internal Admin</span>
          <h1 className="app-page-title">Admin Console</h1>
          <p className="app-page-description">
            Internal operating view for account health, usage, and support activity derived from
            first-party business data.
          </p>
          <div className="app-action-row">
            <Button
              color="neutral"
              size="sm"
              variant="outline"
              disabled={refreshAdminData.isPending}
              onClick={() => refreshAdminData.mutate({})}
            >
              <ArrowClockwiseIcon size={14} aria-hidden="true" />
              <span>{refreshAdminData.isPending ? "Refreshing..." : "Refresh data"}</span>
            </Button>
            <a
              className="button button--outline button--primary button--sm"
              href={ADMIN_API_DOCS_PATH}
              target="_blank"
              rel="noreferrer"
            >
              <span>Admin API reference</span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      <Card>
        <nav className="admin-nav" aria-label="Admin sections">
          {ADMIN_NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              preload="intent"
              activeOptions={{ exact: item.exact }}
              activeProps={{ className: "admin-nav__link admin-nav__link--active" }}
              inactiveProps={{ className: "admin-nav__link" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </Card>

      <div className="admin-page__content">{props.children}</div>
    </div>
  );
}

export function AdminPageIntro(props: { title: string; description: string }) {
  return (
    <div className="app-section-header">
      <h2 className="app-page-title">{props.title}</h2>
      <p className="app-page-description">{props.description}</p>
    </div>
  );
}

export function AdminMetricCard(props: { label: string; value: string | number; hint?: string }) {
  return (
    <article className="admin-metric">
      <span className="admin-metric__label">{props.label}</span>
      <strong className="admin-metric__value">{props.value}</strong>
      {props.hint ? <span className="admin-metric__hint">{props.hint}</span> : null}
    </article>
  );
}
