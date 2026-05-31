import { Link, createFileRoute } from "@tanstack/react-router";
import { Badge, Card } from "@nanites/ui";
import { AdminPageIntro } from "#/frontend/routes/_admin/-admin-shell.tsx";

export const Route = createFileRoute("/_admin/admin/accounts")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(context.adminOrpc.accounts.list.queryOptions()),
  component: AdminAccountsRoute,
});

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function AdminAccountsRoute() {
  const accounts = Route.useLoaderData();

  return (
    <>
      <AdminPageIntro
        title="Accounts"
        description="Commercial account rollup by installation owner, including recent usage, delivered value, and risk flags."
      />
      <Card>
        <div className="admin-table">
          <div className="admin-table__header">
            <span>Account</span>
            <span>Repos</span>
            <span>Users (30d)</span>
            <span>Runs (30d)</span>
            <span>AI cost (30d)</span>
            <span>Last active</span>
          </div>
          {accounts.accounts.map((account) => (
            <Link
              key={account.accountId}
              to="/admin/accounts/$accountId"
              params={{ accountId: account.accountId }}
              className="admin-table__row"
            >
              <span className="admin-table__primary">
                <strong>{account.login}</strong>
                <small>
                  {account.ownerType} · {account.installState}
                </small>
                {account.riskFlags.length > 0 ? (
                  <span className="admin-table__badges">
                    {account.riskFlags.map((flag) => (
                      <Badge key={flag} color="warning" variant="outline">
                        {flag}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </span>
              <span>{account.repoCount}</span>
              <span>{account.activeUserCount30d}</span>
              <span>{account.monthlyRunCount}</span>
              <span>{formatUsd(account.monthlyAiCostUsd)}</span>
              <span>
                {account.lastActiveAt ? new Date(account.lastActiveAt).toLocaleString() : "—"}
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}
