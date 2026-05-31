import * as React from "react";

export type BadgeVariant = "normal" | "outline";
export type BadgeColor = "neutral" | "primary" | "success" | "destructive" | "warning";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * The visual rendering style of the badge.
   * @default 'normal'
   */
  variant?: BadgeVariant;
  /**
   * The semantic color intent of the badge.
   * @default 'primary'
   */
  color?: BadgeColor;
  /**
   * The size of the badge.
   * @default 'md'
   */
  size?: "sm" | "md";
}

/**
 * A badge component for highlighting status, labels, or categories.
 *
 * @example
 * ```tsx
 * <Badge>Default</Badge>
 * <Badge color="success">Active</Badge>
 * <Badge color="warning">Pending</Badge>
 * <Badge variant="outline">Info</Badge>
 * ```
 */
export function Badge({
  variant = "normal",
  color = "primary",
  size = "md",
  className = "",
  children,
  ref,
  ...props
}: BadgeProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = [
    "badge",
    `badge--${variant}`,
    `badge--${color}`,
    size !== "md" && `badge--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span ref={ref} className={classes} {...props}>
      {children}
    </span>
  );
}
