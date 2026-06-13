import { useMemo } from "react";
import type { SessionInstallationSnapshot } from "#/frontend/lib/auth.ts";
import {
  Select,
  SelectList,
  SelectOption,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "#/frontend/ui/components/Select.tsx";

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
    <div className="observability-filter">
      <span>Installation</span>
      <Select
        value={
          selectedInstallation ? String(selectedInstallation.id) : installationFilterEmptyValue
        }
        items={items}
        onValueChange={(next: unknown) => {
          if (typeof next !== "string" || next === installationFilterEmptyValue) {
            return;
          }

          const installationId = Number(next);
          if (Number.isInteger(installationId) && installationId > 0) {
            onChange(installationId);
          }
        }}
      >
        <SelectTrigger size="sm" aria-label="Installation">
          <SelectValue />
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner>
            <SelectPopup>
              <SelectList>
                {items.map((item) => (
                  <SelectOption key={item.value} value={item.value}>
                    {item.label}
                  </SelectOption>
                ))}
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </div>
  );
}
