import * as React from "react";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Button } from "./Button.js";
import { CheckIcon, SearchIcon } from "./_internal/icons.js";
import { cx } from "./_internal/class-names.js";

export type ModelSelectorProps = React.ComponentProps<typeof BaseCombobox.Root>;

export const ModelSelector = (props: ModelSelectorProps) => <BaseCombobox.Root {...props} />;

export interface ModelSelectorTriggerProps extends Omit<
  React.ComponentProps<typeof BaseCombobox.Trigger>,
  "className"
> {
  className?: string;
  size?: "sm" | "md";
}

export function ModelSelectorTrigger({
  className,
  ref,
  size = "md",
  ...props
}: ModelSelectorTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <BaseCombobox.Trigger
      ref={ref}
      className={cx(
        "select__trigger",
        "model-selector__trigger",
        size !== "md" && `select__trigger--${size}`,
        className,
      )}
      {...props}
    />
  );
}

type ModelSelectorContentPositionProps = Pick<
  React.ComponentProps<typeof BaseCombobox.Positioner>,
  "align" | "side" | "sideOffset"
>;

export interface ModelSelectorContentProps
  extends
    Omit<React.ComponentProps<typeof BaseCombobox.Popup>, "className" | "title">,
    ModelSelectorContentPositionProps {
  className?: string;
  heading?: React.ReactNode;
}

export function ModelSelectorContent({
  align = "start",
  children,
  className,
  heading = "Model Selector",
  side = "top",
  sideOffset = 8,
  ref,
  ...props
}: ModelSelectorContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner
        align={align}
        className="select__positioner model-selector__positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <BaseCombobox.Popup
          ref={ref}
          className={cx("select__popup", "model-selector__content", className)}
          {...props}
        >
          <h2 className="visually-hidden">{heading}</h2>
          {children}
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  );
}

export interface ModelSelectorInputProps extends Omit<
  React.ComponentProps<typeof BaseCombobox.Input>,
  "className"
> {
  className?: string;
  groupClassName?: string;
}

export function ModelSelectorInput({
  className,
  groupClassName,
  ref,
  ...props
}: ModelSelectorInputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <BaseCombobox.InputGroup className={cx("model-selector__input-group", groupClassName)}>
      <SearchIcon className="model-selector__input-icon" size={14} />
      <BaseCombobox.Input ref={ref} className={cx("model-selector__input", className)} {...props} />
    </BaseCombobox.InputGroup>
  );
}

export interface ModelSelectorListProps extends Omit<
  React.ComponentProps<typeof BaseCombobox.List>,
  "className"
> {
  className?: string;
}

export function ModelSelectorList({
  className,
  ref,
  ...props
}: ModelSelectorListProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCombobox.List
      ref={ref}
      className={cx("select__list", "model-selector__list", className)}
      {...props}
    />
  );
}

export interface ModelSelectorEmptyProps extends Omit<
  React.ComponentProps<typeof BaseCombobox.Empty>,
  "className"
> {
  className?: string;
}

export function ModelSelectorEmpty({
  className,
  ref,
  ...props
}: ModelSelectorEmptyProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCombobox.Empty ref={ref} className={cx("model-selector__empty", className)} {...props} />
  );
}

export interface ModelSelectorGroupProps extends Omit<
  React.ComponentProps<typeof BaseCombobox.Group>,
  "children" | "className"
> {
  children?: React.ReactNode | ((item: unknown, index: number) => React.ReactNode);
  className?: string;
  heading?: React.ReactNode;
}

export function ModelSelectorGroup({
  children,
  className,
  heading,
  ref,
  ...props
}: ModelSelectorGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCombobox.Group
      ref={ref}
      className={cx("select__option-group", "model-selector__group", className)}
      {...props}
    >
      {heading ? (
        <BaseCombobox.GroupLabel className="select__group-label model-selector__group-label">
          {heading}
        </BaseCombobox.GroupLabel>
      ) : null}
      {typeof children === "function" ? (
        <BaseCombobox.Collection>{children}</BaseCombobox.Collection>
      ) : (
        children
      )}
    </BaseCombobox.Group>
  );
}

export interface ModelSelectorItemProps extends Omit<
  React.ComponentProps<typeof BaseCombobox.Item>,
  "className" | "onSelect"
> {
  className?: string;
}

export function ModelSelectorItem({
  className,
  ref,
  ...props
}: ModelSelectorItemProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCombobox.Item
      ref={ref}
      className={cx("select__option", "model-selector__item", className)}
      {...props}
    />
  );
}

export interface ModelSelectorShortcutProps extends React.ComponentProps<"span"> {}

export function ModelSelectorShortcut({ className, ...props }: ModelSelectorShortcutProps) {
  return <span className={cx("model-selector__shortcut", className)} {...props} />;
}

export interface ModelSelectorSeparatorProps extends Omit<
  React.ComponentProps<typeof BaseCombobox.Separator>,
  "className"
> {
  className?: string;
}

export function ModelSelectorSeparator({
  className,
  ref,
  ...props
}: ModelSelectorSeparatorProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCombobox.Separator
      ref={ref}
      className={cx("model-selector__separator", className)}
      {...props}
    />
  );
}

export interface ModelSelectorLogoProps extends Omit<React.ComponentProps<"img">, "alt" | "src"> {
  provider: string;
}

export function ModelSelectorLogo({ className, provider, ...props }: ModelSelectorLogoProps) {
  return (
    <img
      alt={`${provider} logo`}
      className={cx("model-selector__logo", className)}
      height={16}
      src={`https://models.dev/logos/${provider}.svg`}
      width={16}
      {...props}
    />
  );
}

export interface ModelSelectorLogoGroupProps extends React.ComponentProps<"div"> {}

export function ModelSelectorLogoGroup({ className, ...props }: ModelSelectorLogoGroupProps) {
  return <div className={cx("model-selector__logo-group", className)} {...props} />;
}

export interface ModelSelectorNameProps extends React.ComponentProps<"span"> {}

export function ModelSelectorName({ className, ...props }: ModelSelectorNameProps) {
  return <span className={cx("model-selector__name", className)} {...props} />;
}

export type CloudflareModelSelectorGroup = {
  readonly provider: string;
  readonly models: readonly string[];
};

type ModelComboboxGroup = {
  readonly provider: string;
  readonly items: readonly string[];
};

export interface CloudflareModelSelectorProps {
  readonly label: React.ReactNode;
  readonly value: string | null;
  readonly groups: readonly CloudflareModelSelectorGroup[];
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly error?: React.ReactNode;
  readonly customModelLabel?: React.ReactNode;
  readonly customModelPlaceholder?: string;
  readonly gatewayModelsHref?: string | null;
  readonly gatewayModelsLabel?: React.ReactNode;
  readonly searchAriaLabel?: string;
  readonly onValueChange: (modelId: string) => void;
}

export function CloudflareModelSelector({
  customModelLabel = "AI Gateway model ID",
  customModelPlaceholder = "openai/gpt-5.5",
  disabled = false,
  error,
  gatewayModelsHref,
  gatewayModelsLabel = "Find AI Gateway models",
  groups,
  label,
  loading = false,
  onValueChange,
  searchAriaLabel,
  value,
}: CloudflareModelSelectorProps) {
  const labelId = React.useId();
  const customModelId = React.useId();
  const customModelLabelId = React.useId();
  const [customModel, setCustomModel] = React.useState("");
  const [modelSearch, setModelSearch] = React.useState("");
  const selectedModel = value ?? "";
  const controlDisabled = disabled || loading;

  const visibleGroups = React.useMemo(() => {
    if (!selectedModel) {
      return groups;
    }

    const hasSelectedModel = groups.some((group) =>
      group.models.some((model) => model === selectedModel),
    );
    return hasSelectedModel
      ? groups
      : [{ provider: "Current", models: [selectedModel] }, ...groups];
  }, [groups, selectedModel]);

  const comboboxGroups = React.useMemo(
    () =>
      visibleGroups.map((group) => ({
        provider: group.provider,
        items: group.models,
      })),
    [visibleGroups],
  );

  const selectModel = (next: string) => {
    if (!next || next === selectedModel) {
      return;
    }

    onValueChange(next);
  };

  return (
    <div className="cloudflare-model-selector">
      <span id={labelId} className="cloudflare-model-selector__label">
        {label}
      </span>
      <ModelSelector
        value={selectedModel || null}
        items={comboboxGroups}
        disabled={controlDisabled}
        inputValue={modelSearch}
        itemToStringLabel={(model) => String(model)}
        onInputValueChange={setModelSearch}
        onOpenChange={(open) => {
          if (open) {
            setModelSearch("");
          }
        }}
        onValueChange={(next) => {
          if (typeof next === "string") {
            selectModel(next);
          }
        }}
        autoHighlight
      >
        <ModelSelectorTrigger size="sm" aria-labelledby={labelId}>
          <ModelSelectorName>
            {selectedModel || (loading ? "Loading models..." : "Select a model")}
          </ModelSelectorName>
        </ModelSelectorTrigger>
        <ModelSelectorContent heading={label} sideOffset={4}>
          <ModelSelectorInput
            aria-label={
              searchAriaLabel ?? (typeof label === "string" ? `${label} search` : "Search models")
            }
            placeholder="Search models..."
          />
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          <ModelSelectorList>
            {(group: ModelComboboxGroup) => (
              <ModelSelectorGroup key={group.provider} heading={group.provider} items={group.items}>
                {(model) => {
                  const modelId = String(model);
                  return (
                    <ModelSelectorItem key={modelId} value={modelId}>
                      <ModelSelectorName>{modelId}</ModelSelectorName>
                      {selectedModel === modelId ? (
                        <CheckIcon className="cloudflare-model-selector__check" size={14} />
                      ) : (
                        <span className="cloudflare-model-selector__check" aria-hidden="true" />
                      )}
                    </ModelSelectorItem>
                  );
                }}
              </ModelSelectorGroup>
            )}
          </ModelSelectorList>
        </ModelSelectorContent>
      </ModelSelector>
      <form
        className="cloudflare-model-selector__custom-form"
        onSubmit={(event) => {
          event.preventDefault();
          const next = customModel.trim();
          if (next) {
            selectModel(next);
            setCustomModel("");
          }
        }}
      >
        <label
          id={customModelLabelId}
          className="cloudflare-model-selector__custom-label"
          htmlFor={customModelId}
        >
          {customModelLabel}
        </label>
        <div className="cloudflare-model-selector__custom-row">
          <input
            id={customModelId}
            aria-labelledby={customModelLabelId}
            className="cloudflare-model-selector__custom-input"
            disabled={disabled}
            placeholder={customModelPlaceholder}
            value={customModel}
            onChange={(event) => setCustomModel(event.currentTarget.value)}
          />
          <Button
            color="neutral"
            disabled={disabled || customModel.trim().length === 0}
            size="sm"
            type="submit"
            variant="outline"
          >
            Use
          </Button>
        </div>
      </form>
      {gatewayModelsHref ? (
        <a
          className="cloudflare-model-selector__link"
          href={gatewayModelsHref}
          target="_blank"
          rel="noreferrer"
        >
          {gatewayModelsLabel}
        </a>
      ) : null}
      {error ? (
        <p className="cloudflare-model-selector__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
