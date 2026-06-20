import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentPropsWithoutRef } from "react";

/**
 * The visual rendering style of the button.
 *
 * - `normal` - Filled background (default)
 * - `outline` - Low-emphasis with border, transparent background
 * - `ghost` - Minimal style, background appears on hover
 * - `link` - Appears as a text link with underline on hover
 */
export type ButtonVariant = "normal" | "outline" | "ghost" | "link";

/**
 * The semantic color intent of the button.
 *
 * - `neutral` - Medium-emphasis actions, muted background
 * - `primary` - High-emphasis actions, uses primary brand color
 * - `destructive` - Dangerous or irreversible actions
 */
export type ButtonColor = "neutral" | "primary" | "destructive";

/**
 * Available button sizes.
 *
 * - `xs` - Extra small, 1.75rem height
 * - `sm` - Small, 2rem height
 * - `md` - Medium (default), 2.5rem height
 * - `lg` - Large, 2.75rem height
 * - `xl` - Extra large, 3.25rem height
 * - `icon` - Square button for icon-only content
 */
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl" | "icon";

/**
 * Props for the Button component.
 */
export interface ButtonProps extends ComponentPropsWithoutRef<typeof BaseButton> {
  /**
   * The visual rendering style of the button.
   * @default 'normal'
   */
  variant?: ButtonVariant;

  /**
   * The semantic color intent of the button.
   * @default 'primary'
   */
  color?: ButtonColor;

  /**
   * The size of the button.
   * @default 'md'
   */
  size?: ButtonSize;
}

/**
 * A button component built on Base UI with semantic styling variants.
 *
 * Separates visual style (`variant`) from color intent (`color`) for
 * maximum flexibility. Supports keyboard navigation, focus management, and
 * accessibility out of the box.
 *
 * @example
 * ```tsx
 * <Button color="primary">Save changes</Button>
 * <Button color="destructive">Delete account</Button>
 * <Button variant="outline">Cancel</Button>
 * <Button variant="ghost" size="icon"><SearchIcon /></Button>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/button | Base UI Button}
 */
export function Button({
  variant = "normal",
  color = "primary",
  size = "md",
  className,
  ref,
  type = "button",
  ...props
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["button", `button--${variant}`, `button--${color}`, `button--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return <BaseButton ref={ref} type={type} className={classes} {...props} />;
}
