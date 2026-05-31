import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@nanites/ui";
import { AdminPageIntro } from "#/frontend/features/admin/admin-shell.tsx";

export const Route = createFileRoute("/_admin/admin/ai-costs")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(context.adminOrpc.usage.get.queryOptions()),
  component: AdminAiCostsRoute,
});

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function AdminAiCostsRoute() {
  const usage = Route.useLoaderData();

  return (
    <>
      <AdminPageIntro
        title="AI Costs"
        description="Resolved AI cost split by provider/model, account, person, and run."
      />
      <div className="admin-grid admin-grid--two">
        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">By model</h2>
            <div className="admin-list">
              {usage.aiByModel.map((row) => (
                <div
                  key={`${row.provider}:${row.model}`}
                  className="admin-list__row admin-list__row--stack"
                >
                  <span>
                    <strong>{row.model}</strong>
                  </span>
                  <small>
                    {row.provider} · {row.turnCount} turns · {row.totalTokens} total tokens ·{" "}
                    {formatUsd(row.estimatedCostUsd)}
                  </small>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">By account</h2>
            <div className="admin-list">
              {usage.aiByAccount.map((row) => (
                <div key={row.accountId} className="admin-list__row admin-list__row--stack">
                  <span>
                    <strong>{row.accountLogin}</strong>
                  </span>
                  <small>
                    {row.turnCount} turns · {row.totalTokens} total tokens ·{" "}
                    {formatUsd(row.estimatedCostUsd)}
                  </small>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">By person</h2>
            <div className="admin-list">
              {usage.aiByPerson.map((row) => (
                <div
                  key={`${row.accountId}:${row.githubUserId ?? "unattributed"}`}
                  className="admin-list__row admin-list__row--stack"
                >
                  <span>
                    <strong>{row.login}</strong>
                  </span>
                  <small>
                    {row.accountLogin} · {row.turnCount} turns · {row.totalTokens} total tokens ·{" "}
                    {formatUsd(row.estimatedCostUsd)}
                  </small>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">By run</h2>
            <div className="admin-list">
              {usage.aiByRun.map((row) => (
                <div
                  key={`${row.accountId}:${row.runKey}`}
                  className="admin-list__row admin-list__row--stack"
                >
                  <span>
                    <strong>{row.repositoryFullName}</strong>
                  </span>
                  <small>
                    {row.naniteId ?? "unknown nanite"} · {row.turnCount} turns ·{" "}
                    {formatUsd(row.estimatedCostUsd)}
                  </small>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">Largest account spenders</h2>
            <div className="admin-list">
              {usage.aiByAccount.map((row) => (
                <div key={`${row.accountId}:topline`} className="admin-list__row">
                  <span>{row.accountLogin}</span>
                  <strong>{formatUsd(row.estimatedCostUsd)}</strong>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
