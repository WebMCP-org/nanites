import * as React from "react";

/**
 * Props for the Label component.
 */
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}

/**
 * A semantic label component for form inputs.
 *
 * @example
 * ```tsx
 * <Label htmlFor="username">Username</Label>
 * <Input id="username" type="text" />
 *
 * <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
 *   <Checkbox id="newsletter" />
 *   <Label htmlFor="newsletter">Subscribe to newsletter</Label>
 * </div>
 * ```
 */
export function Label({
  className = "",
  children,
  ref,
  ...props
}: LabelProps & { ref?: React.Ref<HTMLLabelElement> }) {
  const classes = ["label", className].filter(Boolean).join(" ");

  return (
    <label ref={ref} className={classes} {...props}>
      {children}
    </label>
  );
}
