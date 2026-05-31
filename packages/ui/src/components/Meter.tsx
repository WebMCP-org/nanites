import * as React from "react";
import { Meter as BaseMeter } from "@base-ui/react/meter";

/**
 * Props for the Meter.Root component.
 */
export interface MeterRootProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMeter.Root>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Meter.Track component.
 */
export interface MeterTrackProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMeter.Track>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Meter.Indicator component.
 */
export interface MeterIndicatorProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMeter.Indicator>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Meter.Label component.
 */
export interface MeterLabelProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMeter.Label>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Meter.Value component.
 */
export interface MeterValueProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseMeter.Value>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Container that groups all meter parts. Renders a `<div>` element.
 *
 * @example
 * ```tsx
 * <Meter.Root value={75}>
 *   <Meter.Label>Progress</Meter.Label>
 *   <Meter.Value />
 *   <Meter.Track>
 *     <Meter.Indicator />
 *   </Meter.Track>
 * </Meter.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/meter | Base UI Meter}
 */
function MeterRoot({
  className = "",
  ref,
  ...props
}: MeterRootProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["meter", className].filter(Boolean).join(" ");
  return <BaseMeter.Root ref={ref} className={classes} {...props} />;
}

/**
 * The track that contains the indicator. Represents the full range.
 */
function MeterTrack({
  className = "",
  ref,
  ...props
}: MeterTrackProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["meter__track", className].filter(Boolean).join(" ");
  return <BaseMeter.Track ref={ref} className={classes} {...props} />;
}

/**
 * The indicator that visualizes the current value.
 */
function MeterIndicator({
  className = "",
  ref,
  ...props
}: MeterIndicatorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["meter__indicator", className].filter(Boolean).join(" ");
  return <BaseMeter.Indicator ref={ref} className={classes} {...props} />;
}

/**
 * Accessible label for the meter.
 */
function MeterLabel({
  className = "",
  ref,
  ...props
}: MeterLabelProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = ["meter__label", className].filter(Boolean).join(" ");
  return <BaseMeter.Label ref={ref} className={classes} {...props} />;
}

/**
 * Displays the current value as text.
 */
function MeterValue({
  className = "",
  ref,
  ...props
}: MeterValueProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const classes = ["meter__value", className].filter(Boolean).join(" ");
  return <BaseMeter.Value ref={ref} className={classes} {...props} />;
}

/**
 * A graphical display of a numeric value within a range.
 * Unlike Progress, Meter is for displaying a value, not task completion.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Meter.Root value={75}>
 *   <Meter.Track>
 *     <Meter.Indicator />
 *   </Meter.Track>
 * </Meter.Root>
 * ```
 *
 * @example
 * ```tsx
 * // With label and value display
 * <Meter.Root value={24} max={100}>
 *   <div style={{ display: 'flex', justifyContent: 'space-between' }}>
 *     <Meter.Label>Storage Used</Meter.Label>
 *     <Meter.Value />
 *   </div>
 *   <Meter.Track>
 *     <Meter.Indicator />
 *   </Meter.Track>
 * </Meter.Root>
 * ```
 *
 * @example
 * ```tsx
 * // With custom formatting
 * <Meter.Root value={0.75} min={0} max={1} format={{ style: 'percent' }}>
 *   <Meter.Track>
 *     <Meter.Indicator />
 *   </Meter.Track>
 * </Meter.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/meter | Base UI Meter}
 */
export const Meter = {
  Root: MeterRoot,
  Track: MeterTrack,
  Indicator: MeterIndicator,
  Label: MeterLabel,
  Value: MeterValue,
};
