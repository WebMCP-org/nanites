import { GithubLogoIcon } from "@phosphor-icons/react";
import type { SessionInstallationSnapshot } from "#/frontend/lib/auth.ts";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { Card } from "#/frontend/ui/components/Card.tsx";

export function ObservabilityInstallationRequiredState({
  installations,
  onSelectInstallation,
}: {
  readonly installations: readonly SessionInstallationSnapshot[];
  readonly onSelectInstallation: (installationId: number) => void;
}) {
  return (
    <Card className="observability-panel">
      <div className="observability-panel__header">
        <h2>
          <GithubLogoIcon size={17} aria-hidden="true" />
          Choose an installation
        </h2>
      </div>
      {installations.length === 0 ? (
        <p className="observability-empty-row">
          GitHub is not reporting a Nanites installation for any account you can access.
        </p>
      ) : (
        <div className="observability-github-actions">
          {installations.map((installation) => (
            <Button
              key={installation.id}
              type="button"
              variant="outline"
              color="neutral"
              size="sm"
              onClick={() => onSelectInstallation(installation.id)}
            >
              <GithubLogoIcon size={15} aria-hidden="true" />
              {installation.account.login}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}
