import { useId, useMemo } from "react";
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

const allFilterValue = "__all_observability_values__";
const installationFilterEmptyValue = "__observability_installation_unset__";

export function ObservabilityInstallationFilterSelect({
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
    <ObservabilityValueSelect
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

export function ObservabilityValueFilterSelect({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly options: readonly string[];
  readonly allLabel: string;
  readonly onChange: (value: string | undefined) => void;
}) {
  const items = useMemo(
    () => [
      { label: allLabel, value: allFilterValue },
      ...options.map((option) => ({ label: option, value: option })),
    ],
    [allLabel, options],
  );

  return (
    <ObservabilityValueSelect
      label={label}
      value={value ?? allFilterValue}
      items={items}
      onValueChange={(next) => onChange(next === allFilterValue ? undefined : next)}
    />
  );
}

function ObservabilityValueSelect({
  label,
  value,
  items,
  onValueChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly items: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly onValueChange: (value: string) => void;
}) {
  const labelId = useId();

  return (
    <div className="observability-filter">
      <span id={labelId}>{label}</span>
      <Select
        value={value}
        items={items}
        onValueChange={(next: unknown) => {
          if (typeof next === "string") {
            onValueChange(next);
          }
        }}
      >
        <SelectTrigger size="sm" aria-labelledby={labelId}>
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
