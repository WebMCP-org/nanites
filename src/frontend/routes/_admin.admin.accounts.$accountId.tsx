import { createFileRoute } from "@tanstack/react-router";
import { Badge, Card } from "@nanites/ui";
import { accountIdSchema } from "@nanites/contracts/ids";
import { AdminMetricCard, AdminPageIntro } from "#/frontend/routes/_admin/-admin-shell.tsx";

export const Route = createFileRoute("/_admin/admin/accounts/$accountId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      context.adminOrpc.accounts.get.queryOptions({
        input: {
          accountId: params.accountId,
        },
      }),
    ),
  params: {
    parse: ({ accountId }) => ({
      accountId: accountIdSchema.parse(accountId),
    }),
    stringify: ({ accountId }) => ({
      accountId,
    }),
  },
  component: AdminAccountDetailRoute,
});

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function AdminAccountDetailRoute() {
  const detail = Route.useLoaderData();

  return (
    <>
      <AdminPageIntro
        title={detail.account.login}
        description="Installation lifecycle, repository coverage, roster, recent runs, and usage trends for one commercial account."
      />
      <div className="admin-metrics">
        <AdminMetricCard label="Installations" value={detail.installations.length} />
        <AdminMetricCard label="Repositories" value={detail.repositories.length} />
        <AdminMetricCard label="People" value={detail.people.length} />
        <AdminMetricCard label="Recent runs" value={detail.recentRuns.length} />
      </div>

      <div className="admin-grid admin-grid--two">
        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">Repositories</h2>
            <div className="admin-list">
              {detail.repositories.map((repository) => (
                <div
                  key={repository.githubRepositoryId}
                  className="admin-list__row admin-list__row--stack"
                >
                  <span>
                    <strong>{repository.fullName}</strong>
                  </span>
                  <span>
                    {repository.permissionTier ?? "—"} · runs {repository.runCount}
                  </span>
                  {repository.brokenPromptConfig ? (
                    <Badge color="warning" variant="outline">
                      broken_prompt_config
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="app-stack">
            <h2 className="dashboard__heading">People</h2>
            <div className="admin-list">
              {detail.people.map((person) => (
                <div key={person.githubUserId} className="admin-list__row">
                  <span>
                    {person.login} · {person.relationship}
                  </span>
                  <strong>
                    {person.lastActiveAt ? new Date(person.lastActiveAt).toLocaleDateString() : "—"}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="app-stack">
          <h2 className="dashboard__heading">Recent runs</h2>
          <div className="admin-list">
            {detail.recentRuns.map((run) => (
              <div key={run.runKey} className="admin-list__row admin-list__row--stack">
                <span>
                  <strong>{run.repositoryFullName}</strong>
                </span>
                <span>
                  {run.naniteId} · {run.phase} · {run.status}
                  {run.conclusion ? ` · ${run.conclusion}` : ""}
                </span>
                <small>Cost {formatUsd(run.estimatedCostUsd)}</small>
                {run.implicitFailureReason ? <small>{run.implicitFailureReason}</small> : null}
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
              {detail.aiUsageByPerson.map((row) => (
                <div
                  key={`${row.githubUserId ?? "unattributed"}:${row.login}`}
                  className="admin-list__row admin-list__row--stack"
                >
                  <span>
                    <strong>{row.login}</strong>
                    {row.relationship ? ` · ${row.relationship}` : ""}
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
            <h2 className="dashboard__heading">Monthly AI usage</h2>
            <div className="admin-list">
              {detail.aiUsageByMonth.map((row) => (
                <div key={row.month} className="admin-list__row admin-list__row--stack">
                  <span>
                    <strong>{row.month}</strong>
                  </span>
                  <small>
                    {row.totalTokens} total tokens · {formatUsd(row.estimatedCostUsd)}
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
