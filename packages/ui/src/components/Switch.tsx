import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";

export interface SwitchProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseSwitch.Root>,
  "className"
> {
  className?: string;
  /**
   * The size of the switch.
   * @default 'md'
   */
  size?: "sm" | "md" | "lg";
}

export interface SwitchThumbProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseSwitch.Thumb>,
  "className"
> {
  className?: string;
}

/**
 * A toggle switch component for binary choices.
 *
 * @example
 * ```tsx
 * <Switch defaultChecked>
 *   <SwitchThumb />
 * </Switch>
 * ```
 *
 * @example
 * ```tsx
 * // Controlled
 * const [checked, setChecked] = React.useState(false);
 * <Switch checked={checked} onCheckedChange={setChecked}>
 *   <SwitchThumb />
 * </Switch>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/switch | Base UI Switch}
 */
export function Switch({
  size = "md",
  className = "",
  ref,
  ...props
}: SwitchProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["switch", size !== "md" && `switch--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return <BaseSwitch.Root ref={ref} className={classes} {...props} />;
}

/**
 * The thumb indicator for the Switch component.
 */
export function SwitchThumb({
  className = "",
  ref,
  ...props
}: SwitchThumbProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = ["switch__thumb", className].filter(Boolean).join(" ");
  return <BaseSwitch.Thumb ref={ref} className={classes} {...props} />;
}
