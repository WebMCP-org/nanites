import * as React from "react";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";

/**
 * Props for the Toggle component.
 */
export interface ToggleProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToggle>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * A two-state button that can be on (pressed) or off.
 * Useful for toggling a setting or mode.
 *
 * @example
 * ```tsx
 * // Basic toggle
 * <Toggle>
 *   Bold
 * </Toggle>
 * ```
 *
 * @example
 * ```tsx
 * // Controlled toggle
 * const [pressed, setPressed] = useState(false);
 *
 * <Toggle pressed={pressed} onPressedChange={setPressed}>
 *   {pressed ? 'On' : 'Off'}
 * </Toggle>
 * ```
 *
 * @example
 * ```tsx
 * // With icons
 * <Toggle>
 *   {({ pressed }) => pressed ? <BoldIcon filled /> : <BoldIcon />}
 * </Toggle>
 * ```
 *
 * @example
 * ```tsx
 * // Default pressed state
 * <Toggle defaultPressed>
 *   Enabled
 * </Toggle>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/toggle | Base UI Toggle}
 */
export function Toggle({
  className = "",
  ref,
  ...props
}: ToggleProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["toggle", className].filter(Boolean).join(" ");
  return <BaseToggle ref={ref} className={classes} {...props} />;
}
