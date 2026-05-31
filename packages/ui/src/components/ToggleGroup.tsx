import * as React from "react";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";

export interface ToggleGroupProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseToggleGroup>,
  "className"
> {
  className?: string;
  /**
   * The size of the toggle group.
   * @default 'md'
   */
  size?: "sm" | "md" | "lg";
}

export interface ToggleGroupItemProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseToggle>,
  "className"
> {
  className?: string;
}

/**
 * A toggle group component for selecting one or multiple options.
 *
 * @example
 * ```tsx
 * // Single selection (defaultValue is an array)
 * <ToggleGroup defaultValue={["center"]}>
 *   <ToggleGroupItem value="left">Left</ToggleGroupItem>
 *   <ToggleGroupItem value="center">Center</ToggleGroupItem>
 *   <ToggleGroupItem value="right">Right</ToggleGroupItem>
 * </ToggleGroup>
 * ```
 *
 * @example
 * ```tsx
 * // Multiple selection
 * <ToggleGroup multiple defaultValue={["bold", "italic"]}>
 *   <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
 *   <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
 *   <ToggleGroupItem value="underline">Underline</ToggleGroupItem>
 * </ToggleGroup>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/toggle-group | Base UI Toggle Group}
 */
export function ToggleGroup({
  size = "md",
  className = "",
  ref,
  ...props
}: ToggleGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["toggle-group", size !== "md" && `toggle-group--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return <BaseToggleGroup ref={ref} className={classes} {...props} />;
}

/**
 * A single toggle item within a ToggleGroup.
 */
export function ToggleGroupItem({
  className = "",
  ref,
  ...props
}: ToggleGroupItemProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["toggle-group__item", className].filter(Boolean).join(" ");
  return <BaseToggle ref={ref} className={classes} {...props} />;
}
