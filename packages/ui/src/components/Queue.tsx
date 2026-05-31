import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { Badge } from "./Badge.js";
import { cx } from "./_internal/class-names.js";
import { CheckIcon, ChevronRightIcon, DotIcon, FileIcon } from "./_internal/icons.js";

export interface QueueProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Container for a grouped list of queue items (e.g. messages, todos,
 * attachments). Compose with QueueSection as direct children.
 */
export function Queue({
  className,
  children,
  ref,
  ...props
}: QueueProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("queue", className)} {...props}>
      {children}
    </div>
  );
}

export interface QueueSectionProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Root>,
  "className"
> {
  className?: string;
}

/**
 * A collapsible section within a Queue. Holds a trigger label and a list
 * of QueueItem children.
 */
export function QueueSection({
  className,
  defaultOpen = true,
  ref,
  ...props
}: QueueSectionProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCollapsible.Root
      ref={ref}
      className={cx("queue__section", className)}
      defaultOpen={defaultOpen}
      {...props}
    />
  );
}

export interface QueueSectionTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Trigger>,
  "className"
> {
  className?: string;
}

export function QueueSectionTrigger({
  className,
  children,
  ref,
  ...props
}: QueueSectionTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <BaseCollapsible.Trigger
      ref={ref}
      className={cx("queue__section-trigger", className)}
      {...props}
    >
      <span className="queue__section-icon" aria-hidden="true">
        <ChevronRightIcon />
      </span>
      {children}
    </BaseCollapsible.Trigger>
  );
}

export interface QueueSectionLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Optional count rendered as a trailing badge. */
  count?: number;
}

export function QueueSectionLabel({
  className,
  children,
  count,
  ref,
  ...props
}: QueueSectionLabelProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("queue__section-label", className)} {...props}>
      <span>{children}</span>
      {count !== undefined ? (
        <Badge color="neutral" size="sm" className="queue__section-count">
          {count}
        </Badge>
      ) : null}
    </span>
  );
}

export interface QueueListProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Panel>,
  "className"
> {
  className?: string;
}

export function QueueList({
  className,
  children,
  ref,
  ...props
}: QueueListProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCollapsible.Panel ref={ref} className={cx("queue__list", className)} {...props}>
      <ul className="queue__list-inner">{children}</ul>
    </BaseCollapsible.Panel>
  );
}

export type QueueItemStatus = "pending" | "active" | "complete";

export interface QueueItemProps extends React.LiHTMLAttributes<HTMLLIElement> {
  status?: QueueItemStatus;
}

export function QueueItem({
  className,
  status = "pending",
  children,
  ref,
  ...props
}: QueueItemProps & { ref?: React.Ref<HTMLLIElement> }) {
  return (
    <li
      ref={ref}
      className={cx("queue__item", `queue__item--${status}`, className)}
      data-status={status}
      {...props}
    >
      {children}
    </li>
  );
}

export interface QueueItemIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: QueueItemStatus;
}

export function QueueItemIndicator({
  className,
  status = "pending",
  ref,
  ...props
}: QueueItemIndicatorProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const icon = status === "complete" ? <CheckIcon /> : <DotIcon />;
  return (
    <span
      ref={ref}
      className={cx("queue__item-indicator", `queue__item-indicator--${status}`, className)}
      aria-hidden="true"
      {...props}
    >
      {icon}
    </span>
  );
}

export interface QueueItemContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function QueueItemContent({
  className,
  children,
  ref,
  ...props
}: QueueItemContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("queue__item-content", className)} {...props}>
      {children}
    </div>
  );
}

export interface QueueItemDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

export function QueueItemDescription({
  className,
  children,
  ref,
  ...props
}: QueueItemDescriptionProps & { ref?: React.Ref<HTMLParagraphElement> }) {
  return (
    <p ref={ref} className={cx("queue__item-description", className)} {...props}>
      {children}
    </p>
  );
}

export interface QueueItemActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

export function QueueItemActions({
  className,
  children,
  ref,
  ...props
}: QueueItemActionsProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("queue__item-actions", className)} {...props}>
      {children}
    </div>
  );
}

export interface QueueItemAttachmentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function QueueItemAttachment({
  className,
  children,
  ref,
  ...props
}: QueueItemAttachmentProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("queue__item-attachment", className)} {...props}>
      {children}
    </div>
  );
}

export interface QueueItemImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {}

export function QueueItemImage({
  className,
  alt = "",
  ref,
  ...props
}: QueueItemImageProps & { ref?: React.Ref<HTMLImageElement> }) {
  return <img ref={ref} alt={alt} className={cx("queue__item-image", className)} {...props} />;
}

export interface QueueItemFileProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  size?: string;
}

export function QueueItemFile({
  className,
  name,
  size,
  ref,
  ...props
}: QueueItemFileProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("queue__item-file", className)} {...props}>
      <span className="queue__item-file-icon" aria-hidden="true">
        <FileIcon />
      </span>
      <span className="queue__item-file-name">{name}</span>
      {size ? <span className="queue__item-file-size">{size}</span> : null}
    </div>
  );
}
