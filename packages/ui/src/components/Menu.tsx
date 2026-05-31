import * as React from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";

/**
 * Props for the Menu.Root component.
 */
export interface MenuProps extends React.ComponentPropsWithoutRef<typeof BaseMenu.Root> {}

/**
 * Props for the Menu.Trigger component.
 */
export interface MenuTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Trigger>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.Portal component.
 */
export interface MenuPortalProps extends React.ComponentPropsWithoutRef<typeof BaseMenu.Portal> {}

/**
 * Props for the Menu.Positioner component.
 */
export interface MenuPositionerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Positioner>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.Popup component.
 */
export interface MenuPopupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Popup>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.Item component.
 */
export interface MenuItemProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Item>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.Group component.
 */
export interface MenuGroupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Group>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.GroupLabel component.
 */
export interface MenuGroupLabelProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.GroupLabel>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.Arrow component.
 */
export interface MenuArrowProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Arrow>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.Separator component.
 */
export interface MenuSeparatorProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.Separator>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.RadioGroup component.
 */
export interface MenuRadioGroupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.RadioGroup>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.RadioItem component.
 */
export interface MenuRadioItemProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.RadioItem>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.RadioItemIndicator component.
 */
export interface MenuRadioItemIndicatorProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.RadioItemIndicator>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.CheckboxItem component.
 */
export interface MenuCheckboxItemProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.CheckboxItem>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.CheckboxItemIndicator component.
 */
export interface MenuCheckboxItemIndicatorProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.CheckboxItemIndicator>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Menu.SubmenuTrigger component.
 */
export interface MenuSubmenuTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMenu.SubmenuTrigger>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Root component that manages menu state.
 *
 * @example
 * ```tsx
 * <Menu.Root>
 *   <Menu.Trigger>Actions</Menu.Trigger>
 *   <Menu.Portal>
 *     <Menu.Positioner>
 *       <Menu.Popup>
 *         <Menu.Item>Edit</Menu.Item>
 *         <Menu.Item>Delete</Menu.Item>
 *       </Menu.Popup>
 *     </Menu.Positioner>
 *   </Menu.Portal>
 * </Menu.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/menu | Base UI Menu}
 */
const MenuRoot = (props: MenuProps) => {
  return <BaseMenu.Root {...props} />;
};

/**
 * Button that toggles the menu visibility.
 */
function MenuTrigger({
  className = "",
  ref,
  ...props
}: MenuTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["menu__trigger", className].filter(Boolean).join(" ");
  return <BaseMenu.Trigger ref={ref} className={classes} {...props} />;
}

/**
 * Renders menu content in a portal.
 */
const MenuPortal = (props: MenuPortalProps) => {
  return <BaseMenu.Portal {...props} />;
};

/**
 * Positions the menu popup relative to the trigger.
 */
function MenuPositioner({
  className = "",
  ref,
  ...props
}: MenuPositionerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__positioner", className].filter(Boolean).join(" ");
  return <BaseMenu.Positioner ref={ref} className={classes} {...props} />;
}

/**
 * Container for menu items.
 */
function MenuPopup({
  className = "",
  ref,
  ...props
}: MenuPopupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__popup", className].filter(Boolean).join(" ");
  return <BaseMenu.Popup ref={ref} className={classes} {...props} />;
}

/**
 * Interactive menu item.
 */
function MenuItem({
  className = "",
  ref,
  ...props
}: MenuItemProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__item", className].filter(Boolean).join(" ");
  return <BaseMenu.Item ref={ref} className={classes} {...props} />;
}

/**
 * Groups related menu items.
 */
function MenuGroup({
  className = "",
  ref,
  ...props
}: MenuGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__group", className].filter(Boolean).join(" ");
  return <BaseMenu.Group ref={ref} className={classes} {...props} />;
}

/**
 * Label for a group of menu items.
 */
function MenuGroupLabel({
  className = "",
  ref,
  ...props
}: MenuGroupLabelProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__group-label", className].filter(Boolean).join(" ");
  return <BaseMenu.GroupLabel ref={ref} className={classes} {...props} />;
}

/**
 * Arrow pointing to the trigger.
 */
function MenuArrow({
  className = "",
  ref,
  ...props
}: MenuArrowProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__arrow", className].filter(Boolean).join(" ");
  return <BaseMenu.Arrow ref={ref} className={classes} {...props} />;
}

/**
 * Visual separator between menu sections.
 */
function MenuSeparator({
  className = "",
  ref,
  ...props
}: MenuSeparatorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__separator", className].filter(Boolean).join(" ");
  return <BaseMenu.Separator ref={ref} className={classes} {...props} />;
}

/**
 * Group for exclusive radio selection.
 */
function MenuRadioGroup({
  className = "",
  ref,
  ...props
}: MenuRadioGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__radio-group", className].filter(Boolean).join(" ");
  return <BaseMenu.RadioGroup ref={ref} className={classes} {...props} />;
}

/**
 * Radio item for exclusive selection.
 */
function MenuRadioItem({
  className = "",
  ref,
  ...props
}: MenuRadioItemProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__radio-item", className].filter(Boolean).join(" ");
  return <BaseMenu.RadioItem ref={ref} className={classes} {...props} />;
}

/**
 * Indicator for selected radio item.
 */
function MenuRadioItemIndicator({
  className = "",
  ref,
  ...props
}: MenuRadioItemIndicatorProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = ["menu__radio-indicator", className].filter(Boolean).join(" ");
  return <BaseMenu.RadioItemIndicator ref={ref} className={classes} {...props} />;
}

/**
 * Checkbox item for toggling options.
 */
function MenuCheckboxItem({
  className = "",
  ref,
  ...props
}: MenuCheckboxItemProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__checkbox-item", className].filter(Boolean).join(" ");
  return <BaseMenu.CheckboxItem ref={ref} className={classes} {...props} />;
}

/**
 * Indicator for checked checkbox item.
 */
function MenuCheckboxItemIndicator({
  className = "",
  ref,
  ...props
}: MenuCheckboxItemIndicatorProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = ["menu__checkbox-indicator", className].filter(Boolean).join(" ");
  return <BaseMenu.CheckboxItemIndicator ref={ref} className={classes} {...props} />;
}

/**
 * Trigger that opens a submenu.
 */
function MenuSubmenuTrigger({
  className = "",
  ref,
  ...props
}: MenuSubmenuTriggerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["menu__submenu-trigger", className].filter(Boolean).join(" ");
  return <BaseMenu.SubmenuTrigger ref={ref} className={classes} {...props} />;
}

/**
 * A dropdown menu with keyboard navigation support.
 * Provides items, groups, checkboxes, radio selections, and nested submenus.
 *
 * @example
 * ```tsx
 * // Basic menu
 * <Menu.Root>
 *   <Menu.Trigger>Actions</Menu.Trigger>
 *   <Menu.Portal>
 *     <Menu.Positioner>
 *       <Menu.Popup>
 *         <Menu.Item onClick={() => console.log('Edit')}>Edit</Menu.Item>
 *         <Menu.Item onClick={() => console.log('Copy')}>Copy</Menu.Item>
 *         <Menu.Separator />
 *         <Menu.Item onClick={() => console.log('Delete')}>Delete</Menu.Item>
 *       </Menu.Popup>
 *     </Menu.Positioner>
 *   </Menu.Portal>
 * </Menu.Root>
 * ```
 *
 * @example
 * ```tsx
 * // Menu with checkbox items
 * <Menu.Root>
 *   <Menu.Trigger>View Options</Menu.Trigger>
 *   <Menu.Portal>
 *     <Menu.Positioner>
 *       <Menu.Popup>
 *         <Menu.CheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
 *           <Menu.CheckboxItemIndicator />
 *           Show Grid
 *         </Menu.CheckboxItem>
 *       </Menu.Popup>
 *     </Menu.Positioner>
 *   </Menu.Portal>
 * </Menu.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/menu | Base UI Menu}
 */
export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Portal: MenuPortal,
  Positioner: MenuPositioner,
  Popup: MenuPopup,
  Item: MenuItem,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  Arrow: MenuArrow,
  Separator: MenuSeparator,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  RadioItemIndicator: MenuRadioItemIndicator,
  CheckboxItem: MenuCheckboxItem,
  CheckboxItemIndicator: MenuCheckboxItemIndicator,
  SubmenuTrigger: MenuSubmenuTrigger,
};
