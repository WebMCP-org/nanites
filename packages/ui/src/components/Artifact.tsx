import * as React from "react";
import { Button, type ButtonProps } from "./Button.js";
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipTrigger,
} from "./Tooltip.js";
import { cx } from "./_internal/class-names.js";
import { XIcon } from "./_internal/icons.js";

export interface ArtifactProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * A container for generated content (code, documents, outputs) with a header
 * containing a title, description, and action buttons.
 *
 * @example
 * ```tsx
 * <Artifact>
 *   <ArtifactHeader>
 *     <div>
 *       <ArtifactTitle>Project report</ArtifactTitle>
 *       <ArtifactDescription>Generated from Q1 data</ArtifactDescription>
 *     </div>
 *     <ArtifactActions>
 *       <ArtifactAction label="Copy" tooltip="Copy to clipboard" icon={<CopyIcon />} />
 *       <ArtifactClose onClick={close} />
 *     </ArtifactActions>
 *   </ArtifactHeader>
 *   <ArtifactContent>…</ArtifactContent>
 * </Artifact>
 * ```
 */
export function Artifact({
  className,
  children,
  ref,
  ...props
}: ArtifactProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("artifact", className)} {...props}>
      {children}
    </div>
  );
}

export interface ArtifactHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ArtifactHeader({
  className,
  children,
  ref,
  ...props
}: ArtifactHeaderProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("artifact__header", className)} {...props}>
      {children}
    </div>
  );
}

export interface ArtifactTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

export function ArtifactTitle({
  className,
  children,
  ref,
  ...props
}: ArtifactTitleProps & { ref?: React.Ref<HTMLHeadingElement> }) {
  return (
    <h3 ref={ref} className={cx("artifact__title", className)} {...props}>
      {children}
    </h3>
  );
}

export interface ArtifactDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

export function ArtifactDescription({
  className,
  children,
  ref,
  ...props
}: ArtifactDescriptionProps & { ref?: React.Ref<HTMLParagraphElement> }) {
  return (
    <p ref={ref} className={cx("artifact__description", className)} {...props}>
      {children}
    </p>
  );
}

export interface ArtifactActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ArtifactActions({
  className,
  children,
  ref,
  ...props
}: ArtifactActionsProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("artifact__actions", className)} {...props}>
      {children}
    </div>
  );
}

export interface ArtifactActionProps extends Omit<
  ButtonProps,
  "children" | "variant" | "size" | "color" | "className"
> {
  className?: string;
  /** Accessible label for the button. */
  label: string;
  /** Tooltip text shown on hover. Defaults to label. */
  tooltip?: string;
  /** The icon to render inside the button. */
  icon: React.ReactNode;
}

export function ArtifactAction({ className, label, tooltip, icon, ...props }: ArtifactActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cx("artifact__action", className)}
            {...props}
          >
            {icon}
          </Button>
        }
      />
      <TooltipPortal>
        <TooltipPositioner>
          <TooltipPopup>{tooltip ?? label}</TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
}

export interface ArtifactCloseProps extends Omit<
  ButtonProps,
  "children" | "variant" | "size" | "color" | "className"
> {
  className?: string;
  /** Accessible label for the close button. */
  label?: string;
}

export function ArtifactClose({ className, label = "Close", ...props }: ArtifactCloseProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cx("artifact__close", className)}
            {...props}
          >
            <XIcon />
          </Button>
        }
      />
      <TooltipPortal>
        <TooltipPositioner>
          <TooltipPopup>{label}</TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
}

export interface ArtifactContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ArtifactContent({
  className,
  children,
  ref,
  ...props
}: ArtifactContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("artifact__content", className)} {...props}>
      {children}
    </div>
  );
}
