import * as React from "react";

/**
 * Props for the Card component.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Enable hover animation effects.
   * @default false
   */
  hover?: boolean;
}

/**
 * A container component that provides consistent styling and elevation.
 *
 * @example
 * ```tsx
 * <Card>
 *   <h3>Title</h3>
 *   <p>Content</p>
 * </Card>
 *
 * <Card hover onClick={() => navigate('/details')}>
 *   Clickable card
 * </Card>
 * ```
 */
export function Card({
  hover = false,
  className = "",
  children,
  ref,
  ...props
}: CardProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["card", hover && "card--hover", className].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={classes} {...props}>
      {children}
    </div>
  );
}
