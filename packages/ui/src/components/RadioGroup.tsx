import * as React from "react";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { Radio as BaseRadio } from "@base-ui/react/radio";

export interface RadioGroupProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseRadioGroup>,
  "className"
> {
  className?: string;
  /**
   * The orientation of the radio group.
   * @default 'vertical'
   */
  orientation?: "horizontal" | "vertical";
}

export interface RadioProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseRadio.Root>,
  "className"
> {
  className?: string;
}

export interface RadioIndicatorProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseRadio.Indicator>,
  "className"
> {
  className?: string;
}

/**
 * A radio group component for selecting one option from a list.
 *
 * @example
 * ```tsx
 * <RadioGroup defaultValue="option1">
 *   <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
 *     <Radio value="option1">
 *       <RadioIndicator />
 *     </Radio>
 *     <Label>Option 1</Label>
 *   </div>
 *   <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
 *     <Radio value="option2">
 *       <RadioIndicator />
 *     </Radio>
 *     <Label>Option 2</Label>
 *   </div>
 * </RadioGroup>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/radio-group | Base UI Radio Group}
 */
export function RadioGroup({
  orientation = "vertical",
  className = "",
  ref,
  ...props
}: RadioGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["radio-group", `radio-group--${orientation}`, className]
    .filter(Boolean)
    .join(" ");

  return <BaseRadioGroup ref={ref} className={classes} {...props} />;
}

/**
 * A single radio button within a RadioGroup.
 */
export function Radio({
  className = "",
  ref,
  ...props
}: RadioProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["radio", className].filter(Boolean).join(" ");
  return <BaseRadio.Root ref={ref} className={classes} {...props} />;
}

/**
 * The visual indicator for a Radio button.
 */
export function RadioIndicator({
  className = "",
  ref,
  ...props
}: RadioIndicatorProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = ["radio__indicator", className].filter(Boolean).join(" ");
  return <BaseRadio.Indicator ref={ref} className={classes} {...props} />;
}
