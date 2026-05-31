import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";

export interface TooltipProps extends BaseTooltip.Root.Props {}
export interface TooltipTriggerProps extends BaseTooltip.Trigger.Props {}
export interface TooltipPortalProps extends BaseTooltip.Portal.Props {}
export interface TooltipPositionerProps extends BaseTooltip.Positioner.Props {}

export interface TooltipPopupProps extends Omit<BaseTooltip.Popup.Props, "className"> {
  className?: string;
}

export interface TooltipArrowProps extends Omit<BaseTooltip.Arrow.Props, "className"> {
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
export const TooltipPositioner = BaseTooltip.Positioner;

export function TooltipPopup({
  className = "",
  ref,
  ...props
}: TooltipPopupProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["tooltip__popup", className].filter(Boolean).join(" ");
  return <BaseTooltip.Popup ref={ref} className={classes} {...props} />;
}

export function TooltipArrow({
  className = "",
  ref,
  ...props
}: TooltipArrowProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["tooltip__arrow", className].filter(Boolean).join(" ");
  return <BaseTooltip.Arrow ref={ref} className={classes} {...props} />;
}
