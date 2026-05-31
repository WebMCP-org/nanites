import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@nanites/ui";
import { AdminMetricCard, AdminPageIntro } from "#/frontend/routes/_admin/-admin-shell.tsx";

export const Route = createFileRoute("/_admin/admin/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(context.adminOrpc.overview.get.queryOptions()),
  component: AdminOverviewRoute,
});

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function AdminOverviewRoute() {
  const overview = Route.useLoaderData();

  return (
    <>
      <AdminPageIntro
        title="Overview"
        description="Investor-facing top lines, activation funnel health, and product-quality signals derived from first-party business facts."
      />

      <div className="admin-metrics">
        <AdminMetricCard label="Installs" value={overview.installsTotal} />
        <AdminMetricCard label="Active installs" value={overview.activeInstalls} />
        <AdminMetricCard label="Connected repos" value={overview.connectedRepos} />
        <AdminMetricCard label="Active people (30d)" value={overview.activePeople30d} />
        <AdminMetricCard label="Runs (30d)" value={overview.monthlyRuns} />
        <AdminMetricCard
          label="Estimated AI cost (30d)"
          value={formatUsd(overview.estimatedMonthlyAiCostUsd)}
        />
      </div>

      <div className="admin-grid admin-grid--two">
        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">Auth funnel</h2>
            <div className="admin-list">
              <div className="admin-list__row">
                <span>OAuth started</span>
                <strong>{overview.authFunnel.oauthStarted}</strong>
              </div>
              <div className="admin-list__row">
                <span>OAuth succeeded</span>
                <strong>{overview.authFunnel.oauthSucceeded}</strong>
              </div>
              <div className="admin-list__row">
                <span>OAuth failed</span>
                <strong>{overview.authFunnel.oauthFailed}</strong>
              </div>
              <div className="admin-list__row">
                <span>Installation revoked</span>
                <strong>{overview.authFunnel.installationRevoked}</strong>
              </div>
              <div className="admin-list__row">
                <span>Zero-repo views</span>
                <strong>{overview.authFunnel.zeroRepoViews}</strong>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">Quality</h2>
            <div className="admin-list">
              <div className="admin-list__row">
                <span>Run failure rate</span>
                <strong>{Math.round(overview.quality.runFailureRate * 100)}%</strong>
              </div>
            </div>
            <div className="app-stack">
              <h3 className="dashboard__section-heading">Top implicit failure reasons</h3>
              <div className="admin-list">
                {overview.quality.topImplicitFailureReasons.length > 0 ? (
                  overview.quality.topImplicitFailureReasons.map((reason) => (
                    <div key={reason.reason} className="admin-list__row">
                      <span>{reason.reason}</span>
                      <strong>{reason.count}</strong>
                    </div>
                  ))
                ) : (
                  <div className="admin-list__row">
                    <span>No implicit failures recorded yet.</span>
                    <strong>0</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
