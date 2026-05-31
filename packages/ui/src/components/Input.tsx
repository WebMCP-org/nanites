import * as React from "react";
import { Input as BaseInput } from "@base-ui/react/input";
import type { InputProps as BaseInputProps } from "@base-ui/react/input";

/**
 * Props for the Input component.
 */
export interface InputProps extends Omit<BaseInputProps, "className"> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * An accessible text input component with consistent styling.
 *
 * @example
 * ```tsx
 * <Input type="text" placeholder="Enter your name" />
 *
 * <Label htmlFor="email">Email</Label>
 * <Input id="email" type="email" placeholder="user@example.com" />
 * ```
 *
 * @see {@link https://base-ui.com/react/components/input | Base UI Input}
 */
export function Input({
  className = "",
  ref,
  ...props
}: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  const classes = ["input", className].filter(Boolean).join(" ");

  return <BaseInput ref={ref} className={classes} {...props} />;
}
