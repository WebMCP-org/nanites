import * as React from "react";
import { NumberField as BaseNumberField } from "@base-ui/react/number-field";

/**
 * Props for the NumberField.Root component.
 */
export interface NumberFieldRootProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseNumberField.Root>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the NumberField.Group component.
 */
export interface NumberFieldGroupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseNumberField.Group>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the NumberField.Input component.
 */
export interface NumberFieldInputProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseNumberField.Input>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the NumberField.Increment component.
 */
export interface NumberFieldIncrementProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseNumberField.Increment>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the NumberField.Decrement component.
 */
export interface NumberFieldDecrementProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseNumberField.Decrement>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the NumberField.ScrubArea component.
 */
export interface NumberFieldScrubAreaProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseNumberField.ScrubArea>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Container that groups all parts and manages state. Renders a `<div>` element.
 *
 * @example
 * ```tsx
 * <NumberField.Root defaultValue={50} min={0} max={100}>
 *   <NumberField.Group>
 *     <NumberField.Decrement>-</NumberField.Decrement>
 *     <NumberField.Input />
 *     <NumberField.Increment>+</NumberField.Increment>
 *   </NumberField.Group>
 * </NumberField.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/number-field | Base UI NumberField}
 */
function NumberFieldRoot({
  className = "",
  ref,
  ...props
}: NumberFieldRootProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["number-field", className].filter(Boolean).join(" ");
  return <BaseNumberField.Root ref={ref} className={classes} {...props} />;
}

/**
 * Groups the input with increment and decrement buttons.
 */
function NumberFieldGroup({
  className = "",
  ref,
  ...props
}: NumberFieldGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["number-field__group", className].filter(Boolean).join(" ");
  return <BaseNumberField.Group ref={ref} className={classes} {...props} />;
}

/**
 * The native input control for the number field.
 */
function NumberFieldInput({
  className = "",
  ref,
  ...props
}: NumberFieldInputProps & { ref?: React.Ref<HTMLInputElement> }) {
  const classes = ["number-field__input", className].filter(Boolean).join(" ");
  return <BaseNumberField.Input ref={ref} className={classes} {...props} />;
}

/**
 * Button that increases the value.
 */
function NumberFieldIncrement({
  className = "",
  ref,
  ...props
}: NumberFieldIncrementProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["number-field__increment", className].filter(Boolean).join(" ");
  return <BaseNumberField.Increment ref={ref} className={classes} {...props} />;
}

/**
 * Button that decreases the value.
 */
function NumberFieldDecrement({
  className = "",
  ref,
  ...props
}: NumberFieldDecrementProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["number-field__decrement", className].filter(Boolean).join(" ");
  return <BaseNumberField.Decrement ref={ref} className={classes} {...props} />;
}

/**
 * Interactive area for click-and-drag value changes.
 */
function NumberFieldScrubArea({
  className = "",
  ref,
  ...props
}: NumberFieldScrubAreaProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = ["number-field__scrub-area", className].filter(Boolean).join(" ");
  return <BaseNumberField.ScrubArea ref={ref} className={classes} {...props} />;
}

/**
 * A numeric input with increment/decrement buttons and optional scrub area.
 * Supports keyboard modifiers for different step sizes and locale formatting.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <NumberField.Root defaultValue={0}>
 *   <NumberField.Group>
 *     <NumberField.Decrement>-</NumberField.Decrement>
 *     <NumberField.Input />
 *     <NumberField.Increment>+</NumberField.Increment>
 *   </NumberField.Group>
 * </NumberField.Root>
 * ```
 *
 * @example
 * ```tsx
 * // With min/max constraints
 * <NumberField.Root defaultValue={50} min={0} max={100} step={5}>
 *   <NumberField.Group>
 *     <NumberField.Decrement>-</NumberField.Decrement>
 *     <NumberField.Input />
 *     <NumberField.Increment>+</NumberField.Increment>
 *   </NumberField.Group>
 * </NumberField.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/number-field | Base UI NumberField}
 */
export const NumberField = {
  Root: NumberFieldRoot,
  Group: NumberFieldGroup,
  Input: NumberFieldInput,
  Increment: NumberFieldIncrement,
  Decrement: NumberFieldDecrement,
  ScrubArea: NumberFieldScrubArea,
};
