import * as React from "react";
import { Separator as BaseSeparator } from "@base-ui/react/separator";

/**
 * Props for the Separator component.
 */
export interface SeparatorProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseSeparator>,
  "className"
> {
  /**
   * Additional CSS class names.
   */
  className?: string;
}

/**
 * A visual divider component that separates content sections.
 *
 * @example
 * ```tsx
 * <Separator />
 *
 * <nav style={{ display: 'flex', alignItems: 'center' }}>
 *   <a href="/home">Home</a>
 *   <Separator orientation="vertical" />
 *   <a href="/about">About</a>
 * </nav>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/separator | Base UI Separator}
 */
export function Separator({
  orientation = "horizontal",
  className = "",
  ref,
  ...props
}: SeparatorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["separator", `separator--${orientation}`, className].filter(Boolean).join(" ");

  return <BaseSeparator ref={ref} orientation={orientation} className={classes} {...props} />;
}
