import * as React from "react";
import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";

/**
 * Props for the CheckboxGroup component.
 */
export interface CheckboxGroupProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCheckboxGroup>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Provides shared state management for a series of checkboxes.
 * Works in conjunction with individual Checkbox components.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <CheckboxGroup defaultValue={['option1']}>
 *   <label>
 *     <Checkbox name="option1" />
 *     Option 1
 *   </label>
 *   <label>
 *     <Checkbox name="option2" />
 *     Option 2
 *   </label>
 * </CheckboxGroup>
 * ```
 *
 * @example
 * ```tsx
 * // Controlled state
 * const [values, setValues] = useState(['email']);
 *
 * <CheckboxGroup value={values} onValueChange={setValues}>
 *   <label>
 *     <Checkbox name="email" />
 *     Email notifications
 *   </label>
 *   <label>
 *     <Checkbox name="sms" />
 *     SMS notifications
 *   </label>
 * </CheckboxGroup>
 * ```
 *
 * @example
 * ```tsx
 * // With Fieldset for accessibility
 * <Fieldset.Root>
 *   <Fieldset.Legend>Notifications</Fieldset.Legend>
 *   <CheckboxGroup defaultValue={['updates']}>
 *     <label>
 *       <Checkbox name="updates" />
 *       Product updates
 *     </label>
 *     <label>
 *       <Checkbox name="newsletter" />
 *       Newsletter
 *     </label>
 *   </CheckboxGroup>
 * </Fieldset.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/checkbox-group | Base UI CheckboxGroup}
 */
export function CheckboxGroup({
  className = "",
  ref,
  ...props
}: CheckboxGroupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["checkbox-group", className].filter(Boolean).join(" ");
  return <BaseCheckboxGroup ref={ref} className={classes} {...props} />;
}
