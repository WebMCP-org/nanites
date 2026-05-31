import * as React from "react";
import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";

/**
 * Props for the Toolbar.Root component.
 */
export interface ToolbarRootProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Root>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toolbar.Button component.
 */
export interface ToolbarButtonProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Button>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toolbar.Link component.
 */
export interface ToolbarLinkProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Link>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toolbar.Group component.
 */
export interface ToolbarGroupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Group>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toolbar.Separator component.
 */
export interface ToolbarSeparatorProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Separator>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toolbar.Input component.
 */
export interface ToolbarInputProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToolbar.Input>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Container for grouping toolbar buttons and controls.
 *
 * @example
 * ```tsx
 * <Toolbar.Root>
 *   <Toolbar.Button>Bold</Toolbar.Button>
 *   <Toolbar.Button>Italic</Toolbar.Button>
 *   <Toolbar.Separator />
 *   <Toolbar.Button>Align Left</Toolbar.Button>
 * </Toolbar.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/toolbar | Base UI Toolbar}
 */
function ToolbarRoot({
  className = "",
  ref,
  ...props
}: ToolbarRootProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["toolbar", className].filter(Boolean).join(" ");
  return <BaseToolbar.Root ref={ref} className={classes} {...props} />;
}

/**
 * A clickable button within the toolbar.
 */
function ToolbarButton({
  className = "",
  ref,
  ...props
}: ToolbarButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["toolbar__button", className].filter(Boolean).join(" ");
  return <BaseToolbar.Button ref={ref} className={classes} {...props} />;
}

/**
 * A link element within the toolbar.
 */
function ToolbarLink({
  className = "",
  ref,
  ...props
}: ToolbarLinkProps & { ref?: React.Ref<HTMLAnchorElement> }) {
  const classes = ["toolbar__link", className].filter(Boolean).join(" ");
  return <BaseToolbar.Link ref={ref} className={classes} {...props} />;
}

/**
 * Groups toolbar items together.
 */
function ToolbarGroup({
  className = "",
  ref,
  ...props
}: ToolbarGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["toolbar__group", className].filter(Boolean).join(" ");
  return <BaseToolbar.Group ref={ref} className={classes} {...props} />;
}

/**
 * Visual separator between toolbar sections.
 */
function ToolbarSeparator({
  className = "",
  ref,
  ...props
}: ToolbarSeparatorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["toolbar__separator", className].filter(Boolean).join(" ");
  return <BaseToolbar.Separator ref={ref} className={classes} {...props} />;
}

/**
 * Input element within the toolbar.
 */
function ToolbarInput({
  className = "",
  ref,
  ...props
}: ToolbarInputProps & { ref?: React.Ref<HTMLInputElement> }) {
  const classes = ["toolbar__input", className].filter(Boolean).join(" ");
  return <BaseToolbar.Input ref={ref} className={classes} {...props} />;
}

/**
 * A container for grouping buttons and controls.
 * Provides keyboard navigation between items.
 *
 * @example
 * ```tsx
 * // Text formatting toolbar
 * <Toolbar.Root>
 *   <Toolbar.Group>
 *     <Toolbar.Button>Bold</Toolbar.Button>
 *     <Toolbar.Button>Italic</Toolbar.Button>
 *     <Toolbar.Button>Underline</Toolbar.Button>
 *   </Toolbar.Group>
 *   <Toolbar.Separator />
 *   <Toolbar.Group>
 *     <Toolbar.Button>Left</Toolbar.Button>
 *     <Toolbar.Button>Center</Toolbar.Button>
 *     <Toolbar.Button>Right</Toolbar.Button>
 *   </Toolbar.Group>
 * </Toolbar.Root>
 * ```
 *
 * @example
 * ```tsx
 * // Vertical toolbar
 * <Toolbar.Root orientation="vertical">
 *   <Toolbar.Button>Item 1</Toolbar.Button>
 *   <Toolbar.Button>Item 2</Toolbar.Button>
 *   <Toolbar.Button>Item 3</Toolbar.Button>
 * </Toolbar.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/toolbar | Base UI Toolbar}
 */
export const Toolbar = {
  Root: ToolbarRoot,
  Button: ToolbarButton,
  Link: ToolbarLink,
  Group: ToolbarGroup,
  Separator: ToolbarSeparator,
  Input: ToolbarInput,
};
