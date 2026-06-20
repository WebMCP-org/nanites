import type { SessionInstallationSnapshot } from "#/frontend/lib/auth.ts";
import { Avatar } from "#/frontend/ui/components/Avatar.tsx";
import { Card } from "#/frontend/ui/components/Card.tsx";
import { NaniteScene } from "#/frontend/ui/components/NaniteScene.tsx";

export function NanitesChooseInstallationState({
  installations,
  onSelectInstallation,
}: {
  readonly installations: readonly SessionInstallationSnapshot[];
  readonly onSelectInstallation: (installationId: number) => void;
}) {
  return (
    <div className="dashboard">
      <Card>
        <div className="dashboard__zero-install">
          <NaniteScene className="dashboard__setup-nanite" mode="solo" variant="working" />
          <h1 className="dashboard__heading">Choose where Nanites can work</h1>
          <p className="dashboard__subtext">
            GitHub says this deployment app is installed on these accounts visible to your signed-in
            user. Pick the account that owns the repository you want to connect.
          </p>
          <ul className="dashboard__installation-list" aria-label="Available GitHub installations">
            {installations.map((installation) => {
              const account = installation.account;
              const accountLogin = account?.login ?? "Unknown account";
              return (
                <li key={installation.id}>
                  <button
                    type="button"
                    className="dashboard__installation-option"
                    onClick={() => onSelectInstallation(installation.id)}
                  >
                    <Avatar.Root className="dashboard__installation-avatar">
                      {account?.avatar_url ? (
                        <Avatar.Image src={account.avatar_url} alt="" width={56} height={56} />
                      ) : null}
                      <Avatar.Fallback>{accountLogin.slice(0, 2).toUpperCase()}</Avatar.Fallback>
                    </Avatar.Root>
                    <span className="dashboard__installation-copy">
                      <span className="dashboard__installation-login">{accountLogin}</span>
                      <span className="dashboard__installation-type">
                        {account?.type ?? "Account"}
                      </span>
                    </span>
                    <span className="dashboard__installation-cta">Use account</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
    </div>
  );
}
