import * as React from "react";
import { Button, type ButtonProps } from "./Button.js";
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal, DialogTrigger } from "./Dialog.js";
import { cx } from "./_internal/class-names.js";
import { ChevronDownIcon, SearchIcon } from "./_internal/icons.js";
import { ProviderLogo } from "./_internal/provider-logos.js";

interface ModelSelectorContextValue {
  query: string;
  setQuery: (q: string) => void;
  onSelectItem: () => void;
}

const ModelSelectorContext = React.createContext<ModelSelectorContextValue | null>(null);

function useModelSelectorContext(): ModelSelectorContextValue {
  const ctx = React.useContext(ModelSelectorContext);
  if (!ctx) {
    throw new Error("ModelSelector subcomponents must be used inside <ModelSelector>.");
  }
  return ctx;
}

export interface ModelSelectorProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A searchable model picker. Click the trigger to open a dialog containing a
 * search input and a grouped list of available models.
 *
 * @example
 * ```tsx
 * <ModelSelector>
 *   <ModelSelectorTrigger>
 *     <ModelSelectorLogo provider="anthropic" />
 *     <ModelSelectorName>Claude Opus 4.6</ModelSelectorName>
 *   </ModelSelectorTrigger>
 *   <ModelSelectorContent>
 *     <ModelSelectorDialog>
 *       <ModelSelectorInput placeholder="Search models…" />
 *       <ModelSelectorList>
 *         <ModelSelectorGroup label="Anthropic">
 *           <ModelSelectorItem value="claude-opus-4-6" onSelect={…}>
 *             <ModelSelectorLogo provider="anthropic" />
 *             <ModelSelectorName>Claude Opus 4.6</ModelSelectorName>
 *           </ModelSelectorItem>
 *         </ModelSelectorGroup>
 *       </ModelSelectorList>
 *     </ModelSelectorDialog>
 *   </ModelSelectorContent>
 * </ModelSelector>
 * ```
 */
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
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
      if (!next) setQuery("");
    },
    [isControlled, onOpenChange],
  );

  const onSelectItem = React.useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const ctxValue = React.useMemo<ModelSelectorContextValue>(
    () => ({ query, setQuery, onSelectItem }),
    [query, onSelectItem],
  );

  return (
    <ModelSelectorContext.Provider value={ctxValue}>
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
  placeholder = "Search models…",
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
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className={cx("model-selector__input", className)}
        autoFocus
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
    <div ref={ref} role="listbox" className={cx("model-selector__list", className)} {...props}>
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

  // Filter children by query; group is hidden if all children are filtered out.
  const childArray = React.Children.toArray(children).filter(
    (child): child is React.ReactElement<ModelSelectorItemProps> =>
      React.isValidElement<ModelSelectorItemProps>(child),
  );
  const q = query.trim().toLowerCase();
  const filtered = q
    ? childArray.filter((child) => {
        const value = String(child.props.value ?? "").toLowerCase();
        const keywords = String(child.props.keywords ?? "").toLowerCase();
        return value.includes(q) || keywords.includes(q);
      })
    : childArray;

  if (filtered.length === 0) return null;

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={cx("model-selector__group", className)}
      {...props}
    >
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
  /** Extra keywords for search matching. */
  keywords?: string;
  /** Whether this item is the currently selected one. */
  selected?: boolean;
  /** Called when the item is chosen. */
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
  // keywords is only used by parent for filtering; suppress unused prop warning
  void keywords;
  const { onSelectItem } = useModelSelectorContext();
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onSelect?.(value);
    onSelectItem();
    onClick?.(e);
  };
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      data-selected={selected ? "" : undefined}
      className={cx("model-selector__item", className)}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
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

export interface ModelSelectorSeparatorProps extends React.HTMLAttributes<HTMLHRElement> {}

export function ModelSelectorSeparator({
  className,
  ref,
  ...props
}: ModelSelectorSeparatorProps & { ref?: React.Ref<HTMLHRElement> }) {
  return <hr ref={ref} className={cx("model-selector__separator", className)} {...props} />;
}

export interface ModelSelectorLogoProps extends React.SVGAttributes<SVGSVGElement> {
  provider: string;
}

export function ModelSelectorLogo({ className, provider, ...props }: ModelSelectorLogoProps) {
  return (
    <span className={cx("model-selector__logo", className)}>
      <ProviderLogo provider={provider} {...props} />
    </span>
  );
}

export interface ModelSelectorLogoGroupProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ModelSelectorLogoGroup({
  className,
  children,
  ref,
  ...props
}: ModelSelectorLogoGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("model-selector__logo-group", className)} {...props}>
      {children}
    </div>
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

export interface ModelSelectorShortcutProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function ModelSelectorShortcut({
  className,
  children,
  ref,
  ...props
}: ModelSelectorShortcutProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <kbd ref={ref} className={cx("model-selector__shortcut", className)} {...props}>
      {children}
    </kbd>
  );
}
