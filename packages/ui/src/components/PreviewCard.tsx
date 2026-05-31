import * as React from "react";
import { PreviewCard as BasePreviewCard } from "@base-ui/react/preview-card";

/**
 * Props for the PreviewCard.Root component.
 */
export interface PreviewCardProps extends React.ComponentPropsWithoutRef<
  typeof BasePreviewCard.Root
> {}

/**
 * Props for the PreviewCard.Trigger component.
 */
export interface PreviewCardTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePreviewCard.Trigger>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the PreviewCard.Portal component.
 */
export interface PreviewCardPortalProps extends React.ComponentPropsWithoutRef<
  typeof BasePreviewCard.Portal
> {}

/**
 * Props for the PreviewCard.Backdrop component.
 */
export interface PreviewCardBackdropProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePreviewCard.Backdrop>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the PreviewCard.Positioner component.
 */
export interface PreviewCardPositionerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePreviewCard.Positioner>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the PreviewCard.Popup component.
 */
export interface PreviewCardPopupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePreviewCard.Popup>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the PreviewCard.Arrow component.
 */
export interface PreviewCardArrowProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BasePreviewCard.Arrow>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Root component that manages preview card state.
 *
 * @example
 * ```tsx
 * <PreviewCard.Root>
 *   <PreviewCard.Trigger href="/profile">
 *     View Profile
 *   </PreviewCard.Trigger>
 *   <PreviewCard.Portal>
 *     <PreviewCard.Positioner>
 *       <PreviewCard.Popup>
 *         <img src="/avatar.jpg" alt="User avatar" />
 *         <h3>John Doe</h3>
 *         <p>Software Engineer</p>
 *       </PreviewCard.Popup>
 *     </PreviewCard.Positioner>
 *   </PreviewCard.Portal>
 * </PreviewCard.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/preview-card | Base UI PreviewCard}
 */
const PreviewCardRoot = (props: PreviewCardProps) => {
  return <BasePreviewCard.Root {...props} />;
};

/**
 * Link element that triggers the preview card on hover.
 */
function PreviewCardTrigger({
  className = "",
  ref,
  ...props
}: PreviewCardTriggerProps & { ref?: React.Ref<HTMLAnchorElement> }) {
  const classes = ["preview-card__trigger", className].filter(Boolean).join(" ");
  return <BasePreviewCard.Trigger ref={ref} className={classes} {...props} />;
}

/**
 * Renders preview card content in a portal.
 */
const PreviewCardPortal = (props: PreviewCardPortalProps) => {
  return <BasePreviewCard.Portal {...props} />;
};

/**
 * Optional backdrop behind the preview card.
 */
function PreviewCardBackdrop({
  className = "",
  ref,
  ...props
}: PreviewCardBackdropProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["preview-card__backdrop", className].filter(Boolean).join(" ");
  return <BasePreviewCard.Backdrop ref={ref} className={classes} {...props} />;
}

/**
 * Positions the preview card relative to the trigger.
 */
function PreviewCardPositioner({
  className = "",
  ref,
  ...props
}: PreviewCardPositionerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["preview-card__positioner", className].filter(Boolean).join(" ");
  return <BasePreviewCard.Positioner ref={ref} className={classes} {...props} />;
}

/**
 * Container for preview card content.
 */
function PreviewCardPopup({
  className = "",
  ref,
  ...props
}: PreviewCardPopupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["preview-card__popup", className].filter(Boolean).join(" ");
  return <BasePreviewCard.Popup ref={ref} className={classes} {...props} />;
}

/**
 * Decorative arrow pointing to the trigger.
 */
function PreviewCardArrow({
  className = "",
  ref,
  ...props
}: PreviewCardArrowProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["preview-card__arrow", className].filter(Boolean).join(" ");
  return <BasePreviewCard.Arrow ref={ref} className={classes} {...props} />;
}

/**
 * A popup that appears when a link is hovered, showing a preview for sighted users.
 * Useful for showing user profiles, link previews, or additional context.
 *
 * @example
 * ```tsx
 * // Basic preview card
 * <PreviewCard.Root>
 *   <PreviewCard.Trigger href="/users/john">
 *     @johndoe
 *   </PreviewCard.Trigger>
 *   <PreviewCard.Portal>
 *     <PreviewCard.Positioner sideOffset={8}>
 *       <PreviewCard.Popup>
 *         <PreviewCard.Arrow />
 *         <div className="preview-content">
 *           <img src="/john-avatar.jpg" alt="" />
 *           <h4>John Doe</h4>
 *           <p>Software Engineer at Acme Corp</p>
 *         </div>
 *       </PreviewCard.Popup>
 *     </PreviewCard.Positioner>
 *   </PreviewCard.Portal>
 * </PreviewCard.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/preview-card | Base UI PreviewCard}
 */
export const PreviewCard = {
  Root: PreviewCardRoot,
  Trigger: PreviewCardTrigger,
  Portal: PreviewCardPortal,
  Backdrop: PreviewCardBackdrop,
  Positioner: PreviewCardPositioner,
  Popup: PreviewCardPopup,
  Arrow: PreviewCardArrow,
};
