import * as React from "react";
import { Badge, type BadgeProps } from "#/frontend/ui/components/Badge.tsx";
import { Button, type ButtonProps } from "#/frontend/ui/components/Button.tsx";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTrigger,
} from "#/frontend/ui/components/Dialog.tsx";
import { cx } from "#/frontend/ui/components/_internal/class-names.ts";
import { ChevronDownIcon, SearchIcon } from "#/frontend/ui/components/_internal/icons.tsx";
import { ProviderLogo } from "#/frontend/ui/components/_internal/provider-logos.tsx";

interface ModelSelectorContextValue {
  query: string;
  setQuery: (q: string) => void;
  onSelectItem: () => void;
}

const ModelSelectorContext = React.createContext<ModelSelectorContextValue | null>(null);

function useModelSelectorContext(): ModelSelectorContextValue {
  const context = React.useContext(ModelSelectorContext);
  if (!context) {
    throw new Error("ModelSelector subcomponents must be used inside <ModelSelector>.");
  }
  return context;
}

export interface ModelSelectorProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ModelSelector({
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
  ref,
  ...props
}: ModelSelectorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const [query, setQuery] = React.useState("");
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : internalOpen;

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
      if (!next) {
        setQuery("");
      }
    },
    [isControlled, onOpenChange],
  );

  const onSelectItem = React.useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const contextValue = React.useMemo<ModelSelectorContextValue>(
    () => ({ query, setQuery, onSelectItem }),
    [query, onSelectItem],
  );

  return (
    <ModelSelectorContext.Provider value={contextValue}>
      <div ref={ref} className={cx("model-selector", className)} {...props}>
        <Dialog open={currentOpen} onOpenChange={handleOpenChange}>
          {children}
        </Dialog>
      </div>
    </ModelSelectorContext.Provider>
  );
}

export interface ModelSelectorTriggerProps extends Omit<
  ButtonProps,
  "variant" | "color" | "className"
> {
  className?: string;
}

export function ModelSelectorTrigger({ className, children, ...props }: ModelSelectorTriggerProps) {
  return (
    <DialogTrigger
      render={
        <Button
          variant="outline"
          color="neutral"
          className={cx("model-selector__trigger", className)}
          {...props}
        >
          {children}
          <span className="model-selector__trigger-chevron" aria-hidden="true">
            <ChevronDownIcon />
          </span>
        </Button>
      }
    />
  );
}

export interface ModelSelectorContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ModelSelectorContent({ children, ...props }: ModelSelectorContentProps) {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogPopup {...props}>{children}</DialogPopup>
    </DialogPortal>
  );
}

export interface ModelSelectorDialogProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ModelSelectorDialog({
  className,
  children,
  ref,
  ...props
}: ModelSelectorDialogProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("model-selector__dialog", className)} {...props}>
      {children}
    </div>
  );
}

export interface ModelSelectorInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> {}

export function ModelSelectorInput({
  className,
  placeholder = "Search models...",
  ref,
  ...props
}: ModelSelectorInputProps & { ref?: React.Ref<HTMLInputElement> }) {
  const { query, setQuery } = useModelSelectorContext();
  return (
    <div className="model-selector__search">
      <span className="model-selector__search-icon" aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        ref={ref}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className={cx("model-selector__input", className)}
        {...props}
      />
    </div>
  );
}

export interface ModelSelectorListProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ModelSelectorList({
  className,
  children,
  ref,
  ...props
}: ModelSelectorListProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("model-selector__list", className)} {...props}>
      {children}
    </div>
  );
}

export interface ModelSelectorGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
}

export function ModelSelectorGroup({
  className,
  label,
  children,
  ref,
  ...props
}: ModelSelectorGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { query } = useModelSelectorContext();
  const childArray = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<ModelSelectorItemProps> =>
      React.isValidElement<ModelSelectorItemProps>(child),
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? childArray.filter((child) => {
        const value = String(child.props.value ?? "").toLowerCase();
        const keywords = String(child.props.keywords ?? "").toLowerCase();
        return value.includes(normalizedQuery) || keywords.includes(normalizedQuery);
      })
    : childArray;

  if (filtered.length === 0) {
    return null;
  }

  return (
    <div ref={ref} aria-label={label} className={cx("model-selector__group", className)} {...props}>
      <div className="model-selector__group-label">{label}</div>
      {filtered}
    </div>
  );
}

export interface ModelSelectorItemProps extends Omit<
  React.HTMLAttributes<HTMLButtonElement>,
  "onSelect"
> {
  value: string;
  keywords?: string;
  selected?: boolean;
  onSelect?: (value: string) => void;
}

export function ModelSelectorItem({
  className,
  value,
  keywords,
  selected,
  onSelect,
  children,
  onClick,
  ref,
  ...props
}: ModelSelectorItemProps & { ref?: React.Ref<HTMLButtonElement> }) {
  void keywords;
  const { onSelectItem } = useModelSelectorContext();
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onSelect?.(value);
    onSelectItem();
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type="button"
      data-selected={selected ? "" : undefined}
      className={cx("model-selector__item", className)}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  );
}

export interface ModelSelectorItemContentProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function ModelSelectorItemContent({
  className,
  children,
  ref,
  ...props
}: ModelSelectorItemContentProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("model-selector__item-content", className)} {...props}>
      {children}
    </span>
  );
}

export interface ModelSelectorDescriptionProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function ModelSelectorDescription({
  className,
  children,
  ref,
  ...props
}: ModelSelectorDescriptionProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("model-selector__description", className)} {...props}>
      {children}
    </span>
  );
}

export interface ModelSelectorMetaProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function ModelSelectorMeta({
  className,
  children,
  ref,
  ...props
}: ModelSelectorMetaProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("model-selector__meta", className)} {...props}>
      {children}
    </span>
  );
}

export interface ModelSelectorBadgeProps extends BadgeProps {}

export function ModelSelectorBadge({
  className,
  variant = "outline",
  color = "neutral",
  size = "sm",
  ...props
}: ModelSelectorBadgeProps) {
  return (
    <Badge
      variant={variant}
      color={color}
      size={size}
      className={cx("model-selector__badge", className)}
      {...props}
    />
  );
}

export interface ModelSelectorEmptyProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ModelSelectorEmpty({
  className,
  children = "No models found",
  ref,
  ...props
}: ModelSelectorEmptyProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("model-selector__empty", className)} {...props}>
      {children}
    </div>
  );
}

export interface ModelSelectorLogoProps extends React.SVGAttributes<SVGSVGElement> {
  provider: string;
}

export function ModelSelectorLogo({ className, provider, ...props }: ModelSelectorLogoProps) {
  return (
    <span className={cx("model-selector__logo", className)} data-provider={provider}>
      <ProviderLogo provider={provider} {...props} />
    </span>
  );
}

export interface ModelSelectorNameProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function ModelSelectorName({
  className,
  children,
  ref,
  ...props
}: ModelSelectorNameProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("model-selector__name", className)} {...props}>
      {children}
    </span>
  );
}
