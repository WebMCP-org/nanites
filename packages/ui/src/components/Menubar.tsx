import * as React from "react";
import { Menubar as BaseMenubar } from "@base-ui/react/menubar";
import { Menu as BaseMenu } from "@base-ui/react/menu";

/**
 * Props for the Menubar component.
 */
export interface MenubarProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenubar>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menubar.Menu component.
 */
export interface MenubarMenuProps extends React.ComponentPropsWithoutRef<typeof BaseMenu.Root> {}

/**
 * Props for the Menubar.Trigger component.
 */
export interface MenubarTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Trigger>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menubar.Portal component.
 */
export interface MenubarPortalProps extends React.ComponentPropsWithoutRef<
  typeof BaseMenu.Portal
> {}

/**
 * Props for the Menubar.Positioner component.
 */
export interface MenubarPositionerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Positioner>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menubar.Popup component.
 */
export interface MenubarPopupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Popup>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menubar.Item component.
 */
export interface MenubarItemProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Item>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menubar.Separator component.
 */
export interface MenubarSeparatorProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Separator>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menubar.Group component.
 */
export interface MenubarGroupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Group>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menubar.GroupLabel component.
 */
export interface MenubarGroupLabelProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.GroupLabel>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Root menubar container.
 *
 * @example
 * ```tsx
 * <Menubar.Root>
 *   <Menubar.Menu>
 *     <Menubar.Trigger>File</Menubar.Trigger>
 *     <Menubar.Portal>
 *       <Menubar.Positioner>
 *         <Menubar.Popup>
 *           <Menubar.Item>New</Menubar.Item>
 *           <Menubar.Item>Open</Menubar.Item>
 *           <Menubar.Item>Save</Menubar.Item>
 *         </Menubar.Popup>
 *       </Menubar.Positioner>
 *     </Menubar.Portal>
 *   </Menubar.Menu>
 * </Menubar.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/menubar | Base UI Menubar}
 */
function MenubarRoot({
  className = "",
  ref,
  ...props
}: MenubarProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menubar", className].filter(Boolean).join(" ");
  return <BaseMenubar ref={ref} className={classes} {...props} />;
}

/**
 * Individual menu within the menubar.
 */
const MenubarMenu = (props: MenubarMenuProps) => {
  return <BaseMenu.Root {...props} />;
};

/**
 * Button that opens the menu.
 */
function MenubarTrigger({
  className = "",
  ref,
  ...props
}: MenubarTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["menubar__trigger", className].filter(Boolean).join(" ");
  return <BaseMenu.Trigger ref={ref} className={classes} {...props} />;
}

/**
 * Renders menu content in a portal.
 */
const MenubarPortal = (props: MenubarPortalProps) => {
  return <BaseMenu.Portal {...props} />;
};

/**
 * Positions the menu popup.
 */
function MenubarPositioner({
  className = "",
  ref,
  ...props
}: MenubarPositionerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menubar__positioner", className].filter(Boolean).join(" ");
  return <BaseMenu.Positioner ref={ref} className={classes} {...props} />;
}

/**
 * Container for menu items.
 */
function MenubarPopup({
  className = "",
  ref,
  ...props
}: MenubarPopupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menubar__popup", className].filter(Boolean).join(" ");
  return <BaseMenu.Popup ref={ref} className={classes} {...props} />;
}

/**
 * Interactive menu item.
 */
function MenubarItem({
  className = "",
  ref,
  ...props
}: MenubarItemProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menubar__item", className].filter(Boolean).join(" ");
  return <BaseMenu.Item ref={ref} className={classes} {...props} />;
}

/**
 * Visual separator between menu sections.
 */
function MenubarSeparator({
  className = "",
  ref,
  ...props
}: MenubarSeparatorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menubar__separator", className].filter(Boolean).join(" ");
  return <BaseMenu.Separator ref={ref} className={classes} {...props} />;
}

/**
 * Groups related menu items.
 */
function MenubarGroup({
  className = "",
  ref,
  ...props
}: MenubarGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menubar__group", className].filter(Boolean).join(" ");
  return <BaseMenu.Group ref={ref} className={classes} {...props} />;
}

/**
 * Label for a menu item group.
 */
function MenubarGroupLabel({
  className = "",
  ref,
  ...props
}: MenubarGroupLabelProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menubar__group-label", className].filter(Boolean).join(" ");
  return <BaseMenu.GroupLabel ref={ref} className={classes} {...props} />;
}

/**
 * A horizontal menu bar component typically used for application menus.
 * Provides keyboard navigation and supports nested submenus.
 *
 * @example
 * ```tsx
 * // Application menubar
 * <Menubar.Root>
 *   <Menubar.Menu>
 *     <Menubar.Trigger>File</Menubar.Trigger>
 *     <Menubar.Portal>
 *       <Menubar.Positioner>
 *         <Menubar.Popup>
 *           <Menubar.Item onClick={() => newFile()}>New</Menubar.Item>
 *           <Menubar.Item onClick={() => openFile()}>Open</Menubar.Item>
 *           <Menubar.Separator />
 *           <Menubar.Item onClick={() => saveFile()}>Save</Menubar.Item>
 *         </Menubar.Popup>
 *       </Menubar.Positioner>
 *     </Menubar.Portal>
 *   </Menubar.Menu>
 *   <Menubar.Menu>
 *     <Menubar.Trigger>Edit</Menubar.Trigger>
 *     <Menubar.Portal>
 *       <Menubar.Positioner>
 *         <Menubar.Popup>
 *           <Menubar.Item>Undo</Menubar.Item>
 *           <Menubar.Item>Redo</Menubar.Item>
 *           <Menubar.Separator />
 *           <Menubar.Item>Cut</Menubar.Item>
 *           <Menubar.Item>Copy</Menubar.Item>
 *           <Menubar.Item>Paste</Menubar.Item>
 *         </Menubar.Popup>
 *       </Menubar.Positioner>
 *     </Menubar.Portal>
 *   </Menubar.Menu>
 * </Menubar.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/menubar | Base UI Menubar}
 */
export const Menubar = {
  Root: MenubarRoot,
  Menu: MenubarMenu,
  Trigger: MenubarTrigger,
  Portal: MenubarPortal,
  Positioner: MenubarPositioner,
  Popup: MenubarPopup,
  Item: MenubarItem,
  Separator: MenubarSeparator,
  Group: MenubarGroup,
  GroupLabel: MenubarGroupLabel,
};
