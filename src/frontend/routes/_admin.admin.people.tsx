import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@nanites/ui";
import { AdminPageIntro } from "#/frontend/routes/_admin/-admin-shell.tsx";

export const Route = createFileRoute("/_admin/admin/people")({
  loader: async ({ context }) => {
    const [people, usage] = await Promise.all([
      context.queryClient.ensureQueryData(context.adminOrpc.people.list.queryOptions()),
      context.queryClient.ensureQueryData(context.adminOrpc.usage.get.queryOptions()),
    ]);

    return { people, usage };
  },
  component: AdminPeopleRoute,
});

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function buildPersonUsageKey(accountId: string, githubUserId: number | null): string {
  return `${accountId}:${githubUserId ?? "unattributed"}`;
}

function AdminPeopleRoute() {
  const { people, usage } = Route.useLoaderData();
  const usageByKey = new Map(
    usage.aiByPerson.map((row) => [buildPersonUsageKey(row.accountId, row.githubUserId), row]),
  );
  const unattributedRows = usage.aiByPerson.filter((row) => row.githubUserId === null);

  return (
    <>
      <AdminPageIntro
        title="People"
        description="Direct Sigvelo sign-in users and GitHub actors observed across accounts."
      />
      <Card>
        <div className="admin-table">
          <div className="admin-table__header">
            <span>Actor</span>
            <span>Account</span>
            <span>Relationship</span>
            <span>Last signed in</span>
            <span>Last active</span>
            <span>Turns</span>
            <span>AI cost</span>
          </div>
          {people.people.map((person) => {
            const usageRow =
              usageByKey.get(buildPersonUsageKey(person.accountId, person.githubUserId)) ?? null;

            return (
              <div key={`${person.accountId}:${person.githubUserId}`} className="admin-table__row">
                <span>{person.login}</span>
                <span>{person.accountLogin}</span>
                <span>{person.relationship}</span>
                <span>
                  {person.lastSignedInAt ? new Date(person.lastSignedInAt).toLocaleString() : "—"}
                </span>
                <span>
                  {person.lastActiveAt ? new Date(person.lastActiveAt).toLocaleString() : "—"}
                </span>
                <span>{usageRow?.turnCount ?? 0}</span>
                <span>{formatUsd(usageRow?.estimatedCostUsd ?? 0)}</span>
              </div>
            );
          })}
          {unattributedRows.map((row) => (
            <div key={buildPersonUsageKey(row.accountId, null)} className="admin-table__row">
              <span>{row.login}</span>
              <span>{row.accountLogin}</span>
              <span>—</span>
              <span>—</span>
              <span>—</span>
              <span>{row.turnCount}</span>
              <span>{formatUsd(row.estimatedCostUsd)}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
