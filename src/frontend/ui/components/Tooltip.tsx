import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cx } from "./_internal/class-names.js";

export interface TooltipPopupProps extends Omit<BaseTooltip.Popup.Props, "className"> {
  className?: string;
}

export interface TooltipPositionerProps extends Omit<BaseTooltip.Positioner.Props, "className"> {
  className?: string;
}

/**
 * A tooltip component for displaying helpful information on hover.
 *
 * @example
 * ```tsx
 * <Tooltip>
 *   <TooltipTrigger>
 *     <Button>Hover me</Button>
 *   </TooltipTrigger>
 *   <TooltipPortal>
 *     <TooltipPositioner>
 *       <TooltipPopup>
 *         <TooltipArrow />
 *         Helpful information
 *       </TooltipPopup>
 *     </TooltipPositioner>
 *   </TooltipPortal>
 * </Tooltip>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/tooltip | Base UI Tooltip}
 */
export const Tooltip = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;
export const TooltipPortal = BaseTooltip.Portal;

export function TooltipPositioner({
  className = "",
  ref,
  ...props
}: TooltipPositionerProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = cx("tooltip__positioner", className);
  return <BaseTooltip.Positioner ref={ref} className={classes} {...props} />;
}

export function TooltipPopup({
  className = "",
  ref,
  ...props
}: TooltipPopupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = cx("tooltip__popup", className);
  return <BaseTooltip.Popup ref={ref} className={classes} {...props} />;
}
