import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@nanites/ui";
import { AdminPageIntro } from "#/frontend/routes/_admin/-admin-shell.tsx";

export const Route = createFileRoute("/_admin/admin/usage")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(context.adminOrpc.usage.get.queryOptions()),
  component: AdminUsageRoute,
});

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function AdminUsageRoute() {
  const usage = Route.useLoaderData();

  return (
    <>
      <AdminPageIntro
        title="Usage"
        description="AI usage, GitHub/runtime/platform usage, and delivered-value rollups by account."
      />
      <div className="admin-grid admin-grid--two">
        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">Platform usage by account</h2>
            <div className="admin-list">
              {usage.platformByAccount.map((row) => (
                <div key={row.accountId} className="admin-list__row admin-list__row--stack">
                  <span>
                    <strong>{row.accountLogin}</strong>
                  </span>
                  <small>
                    GitHub ops {row.githubOperationCount} · browser verifications{" "}
                    {row.browserVerificationCount}· hydrations {row.workspaceHydrationCount} ·
                    workspace ms {row.totalWorkspaceHydrationMs}
                  </small>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">Delivered value by account</h2>
            <div className="admin-list">
              {usage.valueByAccount.map((row) => (
                <div key={row.accountId} className="admin-list__row">
                  <span>{row.accountLogin}</span>
                  <strong>{row.runCount} runs</strong>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="app-stack">
          <h2 className="dashboard__heading">AI usage by account</h2>
          <div className="admin-table">
            <div className="admin-table__header">
              <span>Account</span>
              <span>Turns</span>
              <span>Input tokens</span>
              <span>Output tokens</span>
              <span>Total tokens</span>
              <span>Cost</span>
            </div>
            {usage.aiByAccount.map((row) => (
              <div key={row.accountId} className="admin-table__row">
                <span>{row.accountLogin}</span>
                <span>{row.turnCount}</span>
                <span>{row.inputTokens}</span>
                <span>{row.outputTokens}</span>
                <span>{row.totalTokens}</span>
                <span>{formatUsd(row.estimatedCostUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="admin-grid admin-grid--two">
        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">AI usage by person</h2>
            <div className="admin-list">
              {usage.aiByPerson.map((row) => (
                <div
                  key={`${row.accountId}:${row.githubUserId ?? "unattributed"}`}
                  className="admin-list__row admin-list__row--stack"
                >
                  <span>
                    <strong>{row.login}</strong> · {row.accountLogin}
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
            <h2 className="dashboard__heading">AI usage by run</h2>
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
                    {row.accountLogin} · {row.naniteId ?? "unknown nanite"} · {row.turnCount} turns
                    · {formatUsd(row.estimatedCostUsd)}
                  </small>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
