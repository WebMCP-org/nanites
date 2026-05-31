import * as React from "react";
import { NavigationMenu as BaseNavigationMenu } from "@base-ui/react/navigation-menu";

/**
 * Props for the NavigationMenu.Root component.
 */
export interface NavigationMenuProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Root>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.List component.
 */
export interface NavigationMenuListProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.List>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.Item component.
 */
export interface NavigationMenuItemProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Item>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.Trigger component.
 */
export interface NavigationMenuTriggerProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Trigger>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.Icon component.
 */
export interface NavigationMenuIconProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Icon>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.Content component.
 */
export interface NavigationMenuContentProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Content>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.Link component.
 */
export interface NavigationMenuLinkProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Link>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.Portal component.
 */
export type NavigationMenuPortalProps = React.ComponentPropsWithoutRef<
  typeof BaseNavigationMenu.Portal
>;

/**
 * Props for the NavigationMenu.Positioner component.
 */
export interface NavigationMenuPositionerProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Positioner>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.Popup component.
 */
export interface NavigationMenuPopupProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Popup>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.Viewport component.
 */
export interface NavigationMenuViewportProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Viewport>,
  "className"
> {
  className?: string;
}

/**
 * Props for the NavigationMenu.Arrow component.
 */
export interface NavigationMenuArrowProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseNavigationMenu.Arrow>,
  "className"
> {
  className?: string;
}

// Styled wrapper components

function Root({
  className = "",
  ref,
  ...props
}: NavigationMenuProps & { ref?: React.Ref<HTMLElement> }) {
  const classes = ["navigation-menu", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Root ref={ref} render={<nav />} className={classes} {...props} />;
}

function List({
  className = "",
  ref,
  ...props
}: NavigationMenuListProps & { ref?: React.Ref<HTMLUListElement> }) {
  const classes = ["navigation-menu__list", className].filter(Boolean).join(" ");
  return (
    <BaseNavigationMenu.List
      ref={ref}
      className={classes}
      // Override aria-orientation as it's not permitted on <ul> elements (role="list")
      // See: https://dequeuniversity.com/rules/axe/4.11/aria-allowed-attr
      aria-orientation={undefined}
      {...props}
    />
  );
}

function Item({
  className = "",
  ref,
  ...props
}: NavigationMenuItemProps & { ref?: React.Ref<HTMLLIElement> }) {
  const classes = ["navigation-menu__item", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Item ref={ref} className={classes} {...props} />;
}

function Trigger({
  className = "",
  ref,
  ...props
}: NavigationMenuTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["navigation-menu__trigger", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Trigger ref={ref} className={classes} {...props} />;
}

function Icon({
  className = "",
  ref,
  ...props
}: NavigationMenuIconProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["navigation-menu__icon", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Icon ref={ref} className={classes} {...props} />;
}

function Content({
  className = "",
  ref,
  ...props
}: NavigationMenuContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["navigation-menu__content", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Content ref={ref} className={classes} {...props} />;
}

function Link({
  className = "",
  ref,
  ...props
}: NavigationMenuLinkProps & { ref?: React.Ref<HTMLAnchorElement> }) {
  const classes = ["navigation-menu__link", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Link ref={ref} className={classes} {...props} />;
}

function Positioner({
  className = "",
  ref,
  ...props
}: NavigationMenuPositionerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["navigation-menu__positioner", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Positioner ref={ref} className={classes} {...props} />;
}

function Popup({
  className = "",
  ref,
  ...props
}: NavigationMenuPopupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["navigation-menu__popup", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Popup ref={ref} className={classes} {...props} />;
}

function Viewport({
  className = "",
  ref,
  ...props
}: NavigationMenuViewportProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["navigation-menu__viewport", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Viewport ref={ref} className={classes} {...props} />;
}

function Arrow({
  className = "",
  ref,
  ...props
}: NavigationMenuArrowProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["navigation-menu__arrow", className].filter(Boolean).join(" ");
  return <BaseNavigationMenu.Arrow ref={ref} className={classes} {...props} />;
}

/**
 * A navigation menu component for website navigation with dropdown support.
 * Provides keyboard navigation and supports nested submenus.
 *
 * @example
 * ```tsx
 * // Basic navigation menu
 * <NavigationMenu.Root>
 *   <NavigationMenu.List>
 *     <NavigationMenu.Item>
 *       <NavigationMenu.Trigger>
 *         Products
 *         <NavigationMenu.Icon>
 *           <ChevronDownIcon />
 *         </NavigationMenu.Icon>
 *       </NavigationMenu.Trigger>
 *       <NavigationMenu.Content>
 *         <NavigationMenu.Link href="/products/analytics">
 *           Analytics
 *         </NavigationMenu.Link>
 *         <NavigationMenu.Link href="/products/automation">
 *           Automation
 *         </NavigationMenu.Link>
 *       </NavigationMenu.Content>
 *     </NavigationMenu.Item>
 *     <NavigationMenu.Item>
 *       <NavigationMenu.Link href="/about">About</NavigationMenu.Link>
 *     </NavigationMenu.Item>
 *   </NavigationMenu.List>
 *   <NavigationMenu.Portal>
 *     <NavigationMenu.Positioner>
 *       <NavigationMenu.Popup>
 *         <NavigationMenu.Viewport />
 *       </NavigationMenu.Popup>
 *     </NavigationMenu.Positioner>
 *   </NavigationMenu.Portal>
 * </NavigationMenu.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/navigation-menu | Base UI NavigationMenu}
 */
export const NavigationMenu = {
  Root,
  List,
  Item,
  Trigger,
  Icon,
  Content,
  Link,
  Portal: BaseNavigationMenu.Portal,
  Positioner,
  Popup,
  Viewport,
  Arrow,
};
