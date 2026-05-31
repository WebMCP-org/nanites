import * as React from "react";
import { Fieldset as BaseFieldset } from "@base-ui/react/fieldset";

/**
 * Props for the Fieldset.Root component.
 */
export interface FieldsetRootProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseFieldset.Root>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Fieldset.Legend component.
 */
export interface FieldsetLegendProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseFieldset.Legend>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Groups the fieldset legend and associated fields.
 * Renders a `<fieldset>` element.
 *
 * @example
 * ```tsx
 * <Fieldset.Root>
 *   <Fieldset.Legend>Contact Information</Fieldset.Legend>
 *   <Field.Root>
 *     <Field.Label>Email</Field.Label>
 *     <Field.Control type="email" />
 *   </Field.Root>
 * </Fieldset.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/fieldset | Base UI Fieldset}
 */
function FieldsetRoot({
  className = "",
  ref,
  ...props
}: FieldsetRootProps & { ref?: React.Ref<HTMLFieldSetElement> }) {
  const classes = ["fieldset", className].filter(Boolean).join(" ");
  return <BaseFieldset.Root ref={ref} className={classes} {...props} />;
}

/**
 * Accessible label for the fieldset, automatically associated with it.
 * Renders a `<div>` element (styled as legend).
 */
function FieldsetLegend({
  className = "",
  ref,
  ...props
}: FieldsetLegendProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["fieldset__legend", className].filter(Boolean).join(" ");
  return <BaseFieldset.Legend ref={ref} className={classes} {...props} />;
}

/**
 * A native fieldset element with an easily stylable legend.
 * Useful for grouping related form controls.
 *
 * @example
 * ```tsx
 * // Basic fieldset
 * <Fieldset.Root>
 *   <Fieldset.Legend>Personal Information</Fieldset.Legend>
 *   <Field.Root name="firstName">
 *     <Field.Label>First Name</Field.Label>
 *     <Field.Control />
 *   </Field.Root>
 *   <Field.Root name="lastName">
 *     <Field.Label>Last Name</Field.Label>
 *     <Field.Control />
 *   </Field.Root>
 * </Fieldset.Root>
 * ```
 *
 * @example
 * ```tsx
 * // With checkbox group
 * <Fieldset.Root>
 *   <Fieldset.Legend>Notification Preferences</Fieldset.Legend>
 *   <CheckboxGroup>
 *     <label><Checkbox name="email" /> Email</label>
 *     <label><Checkbox name="sms" /> SMS</label>
 *   </CheckboxGroup>
 * </Fieldset.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/fieldset | Base UI Fieldset}
 */
export const Fieldset = {
  Root: FieldsetRoot,
  Legend: FieldsetLegend,
};
