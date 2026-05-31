import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";

/**
 * Props for the Collapsible.Root component.
 */
export interface CollapsibleRootProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Root>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Collapsible.Trigger component.
 */
export interface CollapsibleTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Trigger>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Collapsible.Panel component.
 */
export interface CollapsiblePanelProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Panel>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Container that groups all collapsible parts. Renders a `<div>` element.
 *
 * @example
 * ```tsx
 * <Collapsible.Root>
 *   <Collapsible.Trigger>Show more</Collapsible.Trigger>
 *   <Collapsible.Panel>Hidden content here</Collapsible.Panel>
 * </Collapsible.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/collapsible | Base UI Collapsible}
 */
function CollapsibleRoot({
  className = "",
  ref,
  ...props
}: CollapsibleRootProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["collapsible", className].filter(Boolean).join(" ");
  return <BaseCollapsible.Root ref={ref} className={classes} {...props} />;
}

/**
 * Button that toggles the panel visibility. Renders a `<button>` element.
 */
function CollapsibleTrigger({
  className = "",
  ref,
  ...props
}: CollapsibleTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["collapsible__trigger", className].filter(Boolean).join(" ");
  return <BaseCollapsible.Trigger ref={ref} className={classes} {...props} />;
}

/**
 * The collapsible panel containing hidden content. Renders a `<div>` element.
 * Supports CSS animations via `--collapsible-panel-height` variable.
 */
function CollapsiblePanel({
  className = "",
  ref,
  ...props
}: CollapsiblePanelProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["collapsible__panel", className].filter(Boolean).join(" ");
  return <BaseCollapsible.Panel ref={ref} className={classes} {...props} />;
}

/**
 * A collapsible panel controlled by a button.
 * Useful for progressive disclosure of content.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Collapsible.Root>
 *   <Collapsible.Trigger>Toggle content</Collapsible.Trigger>
 *   <Collapsible.Panel>
 *     <p>This content can be shown or hidden.</p>
 *   </Collapsible.Panel>
 * </Collapsible.Root>
 * ```
 *
 * @example
 * ```tsx
 * // Controlled state
 * const [open, setOpen] = useState(false);
 *
 * <Collapsible.Root open={open} onOpenChange={setOpen}>
 *   <Collapsible.Trigger>
 *     {open ? 'Hide' : 'Show'} details
 *   </Collapsible.Trigger>
 *   <Collapsible.Panel>
 *     <p>Detailed information here.</p>
 *   </Collapsible.Panel>
 * </Collapsible.Root>
 * ```
 *
 * @example
 * ```tsx
 * // Default open
 * <Collapsible.Root defaultOpen>
 *   <Collapsible.Trigger>Collapse</Collapsible.Trigger>
 *   <Collapsible.Panel>
 *     <p>Initially visible content.</p>
 *   </Collapsible.Panel>
 * </Collapsible.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/collapsible | Base UI Collapsible}
 */
export const Collapsible = {
  Root: CollapsibleRoot,
  Trigger: CollapsibleTrigger,
  Panel: CollapsiblePanel,
};
