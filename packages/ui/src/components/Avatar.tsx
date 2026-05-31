import * as React from "react";
import { Avatar as BaseAvatar } from "@base-ui/react/avatar";

/**
 * Props for the Avatar.Root component.
 */
export interface AvatarRootProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseAvatar.Root>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Avatar.Image component.
 */
export interface AvatarImageProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseAvatar.Image>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Avatar.Fallback component.
 */
export interface AvatarFallbackProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseAvatar.Fallback>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Container for the avatar. Renders a `<span>` element.
 *
 * @example
 * ```tsx
 * <Avatar.Root>
 *   <Avatar.Image src="/photo.jpg" alt="User" />
 *   <Avatar.Fallback>JD</Avatar.Fallback>
 * </Avatar.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/avatar | Base UI Avatar}
 */
function AvatarRoot({
  className = "",
  ref,
  ...props
}: AvatarRootProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = ["avatar", className].filter(Boolean).join(" ");
  return <BaseAvatar.Root ref={ref} className={classes} {...props} />;
}

/**
 * Displays the avatar image. Renders an `<img>` element.
 */
function AvatarImage({
  className = "",
  ref,
  ...props
}: AvatarImageProps & { ref?: React.Ref<HTMLImageElement> }) {
  const classes = ["avatar__image", className].filter(Boolean).join(" ");
  return <BaseAvatar.Image ref={ref} className={classes} {...props} />;
}

/**
 * Displays when the image fails to load or isn't provided.
 * Typically contains initials or an icon. Renders a `<span>` element.
 */
function AvatarFallback({
  className = "",
  ref,
  ...props
}: AvatarFallbackProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = ["avatar__fallback", className].filter(Boolean).join(" ");
  return <BaseAvatar.Fallback ref={ref} className={classes} {...props} />;
}

/**
 * An avatar component for displaying user profile pictures with fallback support.
 * Shows initials or an icon when the image fails to load or isn't provided.
 *
 * @example
 * ```tsx
 * // With image
 * <Avatar.Root>
 *   <Avatar.Image src="/profile.jpg" alt="John Doe" />
 *   <Avatar.Fallback>JD</Avatar.Fallback>
 * </Avatar.Root>
 * ```
 *
 * @example
 * ```tsx
 * // Fallback only (no image)
 * <Avatar.Root>
 *   <Avatar.Fallback>AB</Avatar.Fallback>
 * </Avatar.Root>
 * ```
 *
 * @example
 * ```tsx
 * // With delayed fallback
 * <Avatar.Root>
 *   <Avatar.Image src="/slow-loading.jpg" alt="User" />
 *   <Avatar.Fallback delay={500}>?</Avatar.Fallback>
 * </Avatar.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/avatar | Base UI Avatar}
 */
export const Avatar = {
  Root: AvatarRoot,
  Image: AvatarImage,
  Fallback: AvatarFallback,
};
