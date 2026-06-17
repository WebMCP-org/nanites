import * as React from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { cx } from "./_internal/class-names.js";

/**
 * Props for the Popover.Root component.
 */
export interface PopoverProps extends React.ComponentPropsWithoutRef<typeof BasePopover.Root> {}

/**
 * Props for the Popover.Trigger component.
 */
export interface PopoverTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePopover.Trigger>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Popover.Portal component.
 */
export interface PopoverPortalProps extends React.ComponentPropsWithoutRef<
  typeof BasePopover.Portal
> {}

/**
 * Props for the Popover.Backdrop component.
 */
export interface PopoverBackdropProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePopover.Backdrop>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Popover.Positioner component.
 */
export interface PopoverPositionerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePopover.Positioner>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Popover.Popup component.
 */
export interface PopoverPopupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePopover.Popup>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Popover.Arrow component.
 */
export interface PopoverArrowProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePopover.Arrow>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Popover.Title component.
 */
export interface PopoverTitleProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePopover.Title>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Popover.Description component.
 */
export interface PopoverDescriptionProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePopover.Description>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Popover.Close component.
 */
export interface PopoverCloseProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePopover.Close>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Controls the popover's open state and manages triggers.
 *
 * @example
 * ```tsx
 * <Popover.Root>
 *   <Popover.Trigger>Open</Popover.Trigger>
 *   <Popover.Portal>
 *     <Popover.Positioner>
 *       <Popover.Popup>
 *         <Popover.Title>Popover Title</Popover.Title>
 *         <Popover.Description>Content here</Popover.Description>
 *       </Popover.Popup>
 *     </Popover.Positioner>
 *   </Popover.Portal>
 * </Popover.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/popover | Base UI Popover}
 */
const PopoverRoot = (props: PopoverProps) => {
  return <BasePopover.Root {...props} />;
};

/**
 * Button that toggles the popover visibility.
 * Renders a `<button>` element.
 */
function PopoverTrigger({
  className = "",
  ref,
  ...props
}: PopoverTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = cx("popover__trigger", className);
  return <BasePopover.Trigger ref={ref} className={classes} {...props} />;
}

/**
 * Renders popover content in a portal outside the DOM hierarchy.
 */
const PopoverPortal = (props: PopoverPortalProps) => {
  return <BasePopover.Portal {...props} />;
};

/**
 * Optional backdrop that appears behind the popover.
 */
function PopoverBackdrop({
  className = "",
  ref,
  ...props
}: PopoverBackdropProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = cx("popover__backdrop", className);
  return <BasePopover.Backdrop ref={ref} className={classes} {...props} />;
}

/**
 * Positions the popup relative to the trigger element.
 *
 * @example
 * ```tsx
 * // Position on the right with offset
 * <Popover.Positioner side="right" sideOffset={8}>
 *   <Popover.Popup>...</Popover.Popup>
 * </Popover.Positioner>
 * ```
 */
function PopoverPositioner({
  className = "",
  ref,
  ...props
}: PopoverPositionerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = cx("popover__positioner", className);
  return <BasePopover.Positioner ref={ref} className={classes} {...props} />;
}

/**
 * The popup container that holds the popover content.
 */
function PopoverPopup({
  className = "",
  ref,
  ...props
}: PopoverPopupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = cx("popover__popup", className);
  return <BasePopover.Popup ref={ref} className={classes} {...props} />;
}

/**
 * Directional arrow pointing to the trigger element.
 */
function PopoverArrow({
  className = "",
  ref,
  ...props
}: PopoverArrowProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = cx("popover__arrow", className);
  return <BasePopover.Arrow ref={ref} className={classes} {...props} />;
}

/**
 * Semantic title for the popover content.
 * Renders an `<h2>` element.
 */
function PopoverTitle({
  className = "",
  ref,
  ...props
}: PopoverTitleProps & { ref?: React.Ref<HTMLHeadingElement> }) {
  const classes = cx("popover__title", className);
  return <BasePopover.Title ref={ref} className={classes} {...props} />;
}

/**
 * Description text for the popover content.
 * Renders a `<p>` element.
 */
function PopoverDescription({
  className = "",
  ref,
  ...props
}: PopoverDescriptionProps & { ref?: React.Ref<HTMLParagraphElement> }) {
  const classes = cx("popover__description", className);
  return <BasePopover.Description ref={ref} className={classes} {...props} />;
}

/**
 * Button that closes the popover.
 */
function PopoverClose({
  className = "",
  ref,
  ...props
}: PopoverCloseProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = cx("popover__close", className);
  return <BasePopover.Close ref={ref} className={classes} {...props} />;
}

/**
 * An accessible popup anchored to a trigger button.
 * Supports flexible positioning, animations, and optional backdrop.
 *
 * @example
 * ```tsx
 * // Basic popover
 * <Popover.Root>
 *   <Popover.Trigger>Click me</Popover.Trigger>
 *   <Popover.Portal>
 *     <Popover.Positioner>
 *       <Popover.Popup>
 *         <Popover.Title>Settings</Popover.Title>
 *         <Popover.Description>
 *           Configure your preferences here.
 *         </Popover.Description>
 *         <Popover.Close>Close</Popover.Close>
 *       </Popover.Popup>
 *     </Popover.Positioner>
 *   </Popover.Portal>
 * </Popover.Root>
 * ```
 *
 * @example
 * ```tsx
 * // With arrow and custom positioning
 * <Popover.Root>
 *   <Popover.Trigger>Info</Popover.Trigger>
 *   <Popover.Portal>
 *     <Popover.Positioner side="right" sideOffset={8}>
 *       <Popover.Popup>
 *         <Popover.Arrow />
 *         <p>Additional information</p>
 *       </Popover.Popup>
 *     </Popover.Positioner>
 *   </Popover.Portal>
 * </Popover.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/popover | Base UI Popover}
 */
export const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Portal: PopoverPortal,
  Backdrop: PopoverBackdrop,
  Positioner: PopoverPositioner,
  Popup: PopoverPopup,
  Arrow: PopoverArrow,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: PopoverClose,
};
