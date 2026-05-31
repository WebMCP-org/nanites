import * as React from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";

export interface SliderProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseSlider.Root>,
  "className"
> {
  className?: string;
}

export interface SliderControlProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseSlider.Control>,
  "className"
> {
  className?: string;
}

export interface SliderTrackProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseSlider.Track>,
  "className"
> {
  className?: string;
}

export interface SliderIndicatorProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseSlider.Indicator>,
  "className"
> {
  className?: string;
}

export interface SliderThumbProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseSlider.Thumb>,
  "className"
> {
  className?: string;
}

export interface SliderOutputProps extends Omit<
  React.HTMLAttributes<HTMLOutputElement>,
  "children"
> {
  className?: string;
  children?: (value: number) => React.ReactNode;
}

/**
 * A slider component for selecting values from a range.
 *
 * @example
 * ```tsx
 * <Slider defaultValue={50}>
 *   <SliderControl>
 *     <SliderTrack>
 *       <SliderIndicator />
 *       <SliderThumb />
 *     </SliderTrack>
 *   </SliderControl>
 * </Slider>
 * ```
 *
 * @example
 * ```tsx
 * // With output value display
 * <Slider defaultValue={50}>
 *   <SliderOutput />
 *   <SliderControl>
 *     <SliderTrack>
 *       <SliderIndicator />
 *       <SliderThumb />
 *     </SliderTrack>
 *   </SliderControl>
 * </Slider>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/slider | Base UI Slider}
 */
export function Slider({
  className = "",
  ref,
  ...props
}: SliderProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["slider", className].filter(Boolean).join(" ");
  return <BaseSlider.Root ref={ref} className={classes} {...props} />;
}

/**
 * The control area for the Slider (handles interactions).
 */
export function SliderControl({
  className = "",
  ref,
  ...props
}: SliderControlProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["slider__control", className].filter(Boolean).join(" ");
  return <BaseSlider.Control ref={ref} className={classes} {...props} />;
}

/**
 * The track container for the Slider.
 */
export function SliderTrack({
  className = "",
  ref,
  ...props
}: SliderTrackProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["slider__track", className].filter(Boolean).join(" ");
  return <BaseSlider.Track ref={ref} className={classes} {...props} />;
}

/**
 * The filled indicator showing current value position.
 */
export function SliderIndicator({
  className = "",
  ref,
  ...props
}: SliderIndicatorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["slider__indicator", className].filter(Boolean).join(" ");
  return <BaseSlider.Indicator ref={ref} className={classes} {...props} />;
}

/**
 * The draggable thumb for the Slider.
 */
export function SliderThumb({
  className = "",
  ref,
  ...props
}: SliderThumbProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["slider__thumb", className].filter(Boolean).join(" ");
  return <BaseSlider.Thumb ref={ref} className={classes} {...props} />;
}

/**
 * Displays the current value of the Slider.
 * Note: This must be used inside a Slider component to access the value context.
 */
export function SliderOutput({
  className = "",
  children,
  ref,
  ...props
}: SliderOutputProps & { ref?: React.Ref<HTMLOutputElement> }) {
  const classes = ["slider__output", className].filter(Boolean).join(" ");
  return (
    <BaseSlider.Value ref={ref}>
      {(state) => {
        const value = Array.isArray(state) ? state[0] : 0;
        return (
          <output className={classes} {...props}>
            {typeof children === "function" ? children(value) : value}
          </output>
        );
      }}
    </BaseSlider.Value>
  );
}
