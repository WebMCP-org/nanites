import { useMemo } from "react";
import type { SessionInstallationSnapshot } from "#/frontend/lib/auth.ts";
import { ObservabilityFilterSelectControl } from "./-filter-select-control.tsx";

const installationFilterEmptyValue = "__observability_installation_unset__";

export function InstallationFilterSelect({
  selectedInstallation,
  installations,
  onChange,
}: {
  readonly selectedInstallation: SessionInstallationSnapshot | null;
  readonly installations: readonly SessionInstallationSnapshot[];
  readonly onChange: (installationId: number) => void;
}) {
  const items = useMemo(
    () => [
      { label: "Choose installation", value: installationFilterEmptyValue },
      ...installations.map((installation) => ({
        label: installation.account.login,
        value: String(installation.id),
      })),
    ],
    [installations],
  );

  return (
    <ObservabilityFilterSelectControl
      label="Installation"
      value={selectedInstallation ? String(selectedInstallation.id) : installationFilterEmptyValue}
      items={items}
      onValueChange={(next) => {
        if (next === installationFilterEmptyValue) {
          return;
        }

        const installationId = Number(next);
        if (Number.isInteger(installationId) && installationId > 0) {
          onChange(installationId);
        }
      }}
    />
  );
}
