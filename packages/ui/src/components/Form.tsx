import * as React from "react";
import { Form as BaseForm } from "@base-ui/react/form";

/**
 * Props for the Form component.
 */
export interface FormProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseForm>,
  "className" | "onFormSubmit" | "onSubmit"
> {
  /** Additional CSS class names */
  className?: string;
  /**
   * Callback fired when the form is submitted.
   * Receives form values as a plain object with field names as keys.
   * Automatically calls `preventDefault()` on the event.
   *
   * @example
   * ```tsx
   * <Form onSubmit={(values) => console.log(values)}>
   *   <Field.Root name="email">
   *     <Field.Control type="email" />
   *   </Field.Root>
   * </Form>
   * // On submit: { email: "user@example.com" }
   * ```
   */
  onSubmit?: (values: Record<string, FormDataEntryValue>) => void;
}

/**
 * A form component that provides consolidated error handling and validation
 * for form controls. Works seamlessly with the Field component.
 *
 * @example
 * ```tsx
 * // Basic usage with Field components
 * <Form onSubmit={(values) => console.log(values)}>
 *   <Field.Root name="username">
 *     <Field.Label>Username</Field.Label>
 *     <Field.Control required />
 *     <Field.Error match="valueMissing">Username is required</Field.Error>
 *   </Field.Root>
 *
 *   <Field.Root name="email">
 *     <Field.Label>Email</Field.Label>
 *     <Field.Control type="email" required />
 *     <Field.Error match="valueMissing">Email is required</Field.Error>
 *     <Field.Error match="typeMismatch">Invalid email format</Field.Error>
 *   </Field.Root>
 *
 *   <Button type="submit">Submit</Button>
 * </Form>
 * ```
 *
 * @example
 * ```tsx
 * // With external/server errors
 * const [errors, setErrors] = useState({});
 *
 * async function handleSubmit(values) {
 *   const result = await api.submit(values);
 *   if (result.errors) {
 *     setErrors(result.errors); // { email: "Already registered" }
 *   }
 * }
 *
 * <Form errors={errors} onSubmit={handleSubmit}>
 *   <Field.Root name="email">
 *     <Field.Control type="email" />
 *     <Field.Error />
 *   </Field.Root>
 * </Form>
 * ```
 *
 * @example
 * ```tsx
 * // With validation modes
 * // Fields validate when they lose focus
 * <Form validationMode="onBlur">
 *   ...
 * </Form>
 *
 * // Fields validate as user types
 * <Form validationMode="onChange">
 *   ...
 * </Form>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/form | Base UI Form}
 */
export function Form({
  className = "",
  onSubmit,
  ref,
  ...props
}: FormProps & { ref?: React.Ref<HTMLFormElement> }) {
  const classes = ["form", className].filter(Boolean).join(" ");

  return <BaseForm ref={ref} className={classes} onFormSubmit={onSubmit} {...props} />;
}
