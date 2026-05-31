import * as React from "react";
import { Field as BaseField } from "@base-ui/react/field";

/**
 * Props for the Field.Root component.
 */
export interface FieldRootProps extends React.ComponentPropsWithoutRef<typeof BaseField.Root> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Field.Label component.
 */
export interface FieldLabelProps extends React.ComponentPropsWithoutRef<typeof BaseField.Label> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Field.Control component.
 */
export interface FieldControlProps extends React.ComponentPropsWithoutRef<
  typeof BaseField.Control
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Field.Description component.
 */
export interface FieldDescriptionProps extends React.ComponentPropsWithoutRef<
  typeof BaseField.Description
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Field.Error component.
 */
export interface FieldErrorProps extends React.ComponentPropsWithoutRef<typeof BaseField.Error> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Field.Validity component.
 */
export interface FieldValidityProps extends React.ComponentPropsWithoutRef<
  typeof BaseField.Validity
> {}

/**
 * Container that groups all field parts together.
 * Provides context for label association and validation state.
 *
 * @example
 * ```tsx
 * <Field.Root>
 *   <Field.Label>Username</Field.Label>
 *   <Field.Control placeholder="Enter username" />
 *   <Field.Description>Choose a unique username</Field.Description>
 * </Field.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/field | Base UI Field}
 */
function FieldRoot({
  className = "",
  ref,
  ...props
}: FieldRootProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["field", className].filter(Boolean).join(" ");
  return <BaseField.Root ref={ref} className={classes} {...props} />;
}

/**
 * Accessible label that is automatically associated with the field control.
 * No need to manually wire up `htmlFor` and `id` attributes.
 *
 * @example
 * ```tsx
 * <Field.Root>
 *   <Field.Label>Email address</Field.Label>
 *   <Field.Control type="email" />
 * </Field.Root>
 * ```
 */
function FieldLabel({
  className = "",
  ref,
  ...props
}: FieldLabelProps & { ref?: React.Ref<HTMLLabelElement> }) {
  const classes = ["field__label", className].filter(Boolean).join(" ");
  return <BaseField.Label ref={ref} className={classes} {...props} />;
}

/**
 * The input control element. Renders an `<input>` by default.
 * Can be replaced with other form controls using the `render` prop.
 *
 * @example
 * ```tsx
 * // Default input
 * <Field.Control placeholder="Enter text" />
 *
 * // With custom input component
 * <Field.Control render={<Textarea />} />
 * ```
 */
function FieldControl({
  className = "",
  ref,
  ...props
}: FieldControlProps & { ref?: React.Ref<HTMLInputElement> }) {
  const classes = ["field__control", className].filter(Boolean).join(" ");
  return <BaseField.Control ref={ref} className={classes} {...props} />;
}

/**
 * Supplementary helper text that describes the field.
 * Automatically associated with the control for accessibility.
 *
 * @example
 * ```tsx
 * <Field.Root>
 *   <Field.Label>Password</Field.Label>
 *   <Field.Control type="password" />
 *   <Field.Description>Must be at least 8 characters</Field.Description>
 * </Field.Root>
 * ```
 */
function FieldDescription({
  className = "",
  ref,
  ...props
}: FieldDescriptionProps & { ref?: React.Ref<HTMLParagraphElement> }) {
  const classes = ["field__description", className].filter(Boolean).join(" ");
  return <BaseField.Description ref={ref} className={classes} {...props} />;
}

/**
 * Displays validation error messages when the field is invalid.
 * Use the `match` prop to show different messages for different validity states.
 *
 * @example
 * ```tsx
 * <Field.Root>
 *   <Field.Label>Email</Field.Label>
 *   <Field.Control type="email" required />
 *   <Field.Error match="valueMissing">Email is required</Field.Error>
 *   <Field.Error match="typeMismatch">Please enter a valid email</Field.Error>
 * </Field.Root>
 * ```
 *
 * Common `match` values:
 * - `valueMissing` - Required field is empty
 * - `typeMismatch` - Value doesn't match input type (e.g., invalid email)
 * - `tooShort` - Value is shorter than `minLength`
 * - `tooLong` - Value is longer than `maxLength`
 * - `patternMismatch` - Value doesn't match the `pattern` regex
 * - `rangeUnderflow` - Number is less than `min`
 * - `rangeOverflow` - Number is greater than `max`
 */
function FieldError({
  className = "",
  ref,
  ...props
}: FieldErrorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["field__error", className].filter(Boolean).join(" ");
  return <BaseField.Error ref={ref} className={classes} {...props} />;
}

/**
 * Renders custom content based on the field's validity state.
 * Uses a render function that receives the validity state object.
 *
 * @example
 * ```tsx
 * <Field.Root>
 *   <Field.Label>Username</Field.Label>
 *   <Field.Control required minLength={3} />
 *   <Field.Validity>
 *     {(validity) => {
 *       if (validity.valueMissing) return <span>Username is required</span>;
 *       if (validity.tooShort) return <span>Username is too short</span>;
 *       return null;
 *     }}
 *   </Field.Validity>
 * </Field.Root>
 * ```
 */
const FieldValidity = BaseField.Validity;

/**
 * A form field component that provides labeling, description, and validation
 * for form controls. Automatically handles accessibility associations between
 * labels, inputs, descriptions, and error messages.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Field.Root>
 *   <Field.Label>Name</Field.Label>
 *   <Field.Control placeholder="Enter your name" />
 * </Field.Root>
 *
 * // With validation
 * <Field.Root>
 *   <Field.Label>Email</Field.Label>
 *   <Field.Control type="email" required />
 *   <Field.Error match="valueMissing">Email is required</Field.Error>
 *   <Field.Error match="typeMismatch">Enter a valid email</Field.Error>
 *   <Field.Description>We'll never share your email</Field.Description>
 * </Field.Root>
 *
 * // With custom validation
 * <Field.Root validate={(value) => value === 'admin' ? 'Username taken' : null}>
 *   <Field.Label>Username</Field.Label>
 *   <Field.Control required />
 *   <Field.Error />
 * </Field.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/field | Base UI Field}
 */
export const Field = {
  Root: FieldRoot,
  Label: FieldLabel,
  Control: FieldControl,
  Description: FieldDescription,
  Error: FieldError,
  Validity: FieldValidity,
};
