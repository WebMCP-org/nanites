import * as React from "react";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";

/**
 * Props for the ContextMenu.Root component.
 */
export interface ContextMenuProps extends React.ComponentPropsWithoutRef<
  typeof BaseContextMenu.Root
> {}

/**
 * Props for the ContextMenu.Trigger component.
 */
export interface ContextMenuTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseContextMenu.Trigger>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the ContextMenu.Portal component.
 */
export interface ContextMenuPortalProps extends React.ComponentPropsWithoutRef<
  typeof BaseContextMenu.Portal
> {}

/**
 * Props for the ContextMenu.Positioner component.
 */
export interface ContextMenuPositionerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseContextMenu.Positioner>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the ContextMenu.Popup component.
 */
export interface ContextMenuPopupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseContextMenu.Popup>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the ContextMenu.Item component.
 */
export interface ContextMenuItemProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseContextMenu.Item>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the ContextMenu.Separator component.
 */
export interface ContextMenuSeparatorProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseContextMenu.Separator>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Root component that manages context menu state.
 *
 * @example
 * ```tsx
 * <ContextMenu.Root>
 *   <ContextMenu.Trigger>Right click here</ContextMenu.Trigger>
 *   <ContextMenu.Portal>
 *     <ContextMenu.Positioner>
 *       <ContextMenu.Popup>
 *         <ContextMenu.Item>Cut</ContextMenu.Item>
 *         <ContextMenu.Item>Copy</ContextMenu.Item>
 *         <ContextMenu.Item>Paste</ContextMenu.Item>
 *       </ContextMenu.Popup>
 *     </ContextMenu.Positioner>
 *   </ContextMenu.Portal>
 * </ContextMenu.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/context-menu | Base UI ContextMenu}
 */
const ContextMenuRoot = (props: ContextMenuProps) => {
  return <BaseContextMenu.Root {...props} />;
};

/**
 * Interactive area that activates the menu on right-click or long-press.
 */
function ContextMenuTrigger({
  className = "",
  ref,
  ...props
}: ContextMenuTriggerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["context-menu__trigger", className].filter(Boolean).join(" ");
  return <BaseContextMenu.Trigger ref={ref} className={classes} {...props} />;
}

/**
 * Renders menu content in a portal.
 */
const ContextMenuPortal = (props: ContextMenuPortalProps) => {
  return <BaseContextMenu.Portal {...props} />;
};

/**
 * Positions the menu at the pointer location.
 */
function ContextMenuPositioner({
  className = "",
  ref,
  ...props
}: ContextMenuPositionerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["context-menu__positioner", className].filter(Boolean).join(" ");
  return <BaseContextMenu.Positioner ref={ref} className={classes} {...props} />;
}

/**
 * Container for menu items.
 */
function ContextMenuPopup({
  className = "",
  ref,
  ...props
}: ContextMenuPopupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["context-menu__popup", className].filter(Boolean).join(" ");
  return <BaseContextMenu.Popup ref={ref} className={classes} {...props} />;
}

/**
 * Interactive menu item.
 */
function ContextMenuItem({
  className = "",
  ref,
  ...props
}: ContextMenuItemProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["context-menu__item", className].filter(Boolean).join(" ");
  return <BaseContextMenu.Item ref={ref} className={classes} {...props} />;
}

/**
 * Visual separator between menu sections.
 */
function ContextMenuSeparator({
  className = "",
  ref,
  ...props
}: ContextMenuSeparatorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["context-menu__separator", className].filter(Boolean).join(" ");
  return <BaseContextMenu.Separator ref={ref} className={classes} {...props} />;
}

/**
 * A context menu that appears at the pointer on right-click or long-press.
 * Provides keyboard navigation and supports nested submenus.
 *
 * @example
 * ```tsx
 * // Basic context menu
 * <ContextMenu.Root>
 *   <ContextMenu.Trigger>
 *     <div style={{ padding: '2rem', border: '1px dashed gray' }}>
 *       Right-click here
 *     </div>
 *   </ContextMenu.Trigger>
 *   <ContextMenu.Portal>
 *     <ContextMenu.Positioner>
 *       <ContextMenu.Popup>
 *         <ContextMenu.Item onClick={() => console.log('Cut')}>Cut</ContextMenu.Item>
 *         <ContextMenu.Item onClick={() => console.log('Copy')}>Copy</ContextMenu.Item>
 *         <ContextMenu.Item onClick={() => console.log('Paste')}>Paste</ContextMenu.Item>
 *         <ContextMenu.Separator />
 *         <ContextMenu.Item onClick={() => console.log('Delete')}>Delete</ContextMenu.Item>
 *       </ContextMenu.Popup>
 *     </ContextMenu.Positioner>
 *   </ContextMenu.Portal>
 * </ContextMenu.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/context-menu | Base UI ContextMenu}
 */
export const ContextMenu = {
  Root: ContextMenuRoot,
  Trigger: ContextMenuTrigger,
  Portal: ContextMenuPortal,
  Positioner: ContextMenuPositioner,
  Popup: ContextMenuPopup,
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
};
