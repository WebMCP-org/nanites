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

export type ObservabilityFilterSelectItem = {
  readonly label: string;
  readonly value: string;
};

export function ObservabilityFilterSelectControl({
  label,
  value,
  items,
  onValueChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly items: readonly ObservabilityFilterSelectItem[];
  readonly onValueChange: (value: string) => void;
}) {
  return (
    <div className="observability-filter">
      <span>{label}</span>
      <Select
        value={value}
        items={items}
        onValueChange={(next: unknown) => {
          if (typeof next === "string") {
            onValueChange(next);
          }
        }}
      >
        <SelectTrigger size="sm" aria-label={label}>
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
