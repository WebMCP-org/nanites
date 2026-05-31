import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { Avatar } from "./Avatar.js";
import { Badge, type BadgeColor } from "./Badge.js";
import { Button, type ButtonProps } from "./Button.js";
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipTrigger,
} from "./Tooltip.js";
import { cx } from "./_internal/class-names.js";
import { CheckIcon, ChevronRightIcon, CopyIcon, FileIcon } from "./_internal/icons.js";

export type CommitFileStatusValue = "added" | "modified" | "deleted" | "renamed";

const FILE_STATUS_COLOR: Record<CommitFileStatusValue, BadgeColor> = {
  added: "success",
  modified: "warning",
  deleted: "destructive",
  renamed: "primary",
};

const FILE_STATUS_LABEL: Record<CommitFileStatusValue, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

export interface CommitProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Root>,
  "className"
> {
  className?: string;
}

/**
 * A collapsible git commit card. Compose CommitHeader with metadata
 * (CommitAuthor, CommitInfo, etc.) and CommitContent with a CommitFiles list.
 */
export function Commit({
  className,
  ref,
  ...props
}: CommitProps & { ref?: React.Ref<HTMLDivElement> }) {
  return <BaseCollapsible.Root ref={ref} className={cx("commit", className)} {...props} />;
}

export interface CommitHeaderProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Trigger>,
  "className"
> {
  className?: string;
}

export function CommitHeader({
  className,
  children,
  ref,
  ...props
}: CommitHeaderProps & { ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <BaseCollapsible.Trigger ref={ref} className={cx("commit__header", className)} {...props}>
      <span className="commit__header-icon" aria-hidden="true">
        <ChevronRightIcon />
      </span>
      <span className="commit__header-body">{children}</span>
    </BaseCollapsible.Trigger>
  );
}

export interface CommitAuthorProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CommitAuthor({
  className,
  children,
  ref,
  ...props
}: CommitAuthorProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("commit__author", className)} {...props}>
      {children}
    </div>
  );
}

export interface CommitAuthorAvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  initials: string;
  src?: string;
  alt?: string;
}

export function CommitAuthorAvatar({
  className,
  initials,
  src,
  alt,
  ref,
  ...props
}: CommitAuthorAvatarProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <Avatar.Root ref={ref} className={cx("commit__author-avatar", className)} {...props}>
      {src ? <Avatar.Image src={src} alt={alt ?? initials} /> : null}
      <Avatar.Fallback>{initials}</Avatar.Fallback>
    </Avatar.Root>
  );
}

export interface CommitInfoProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CommitInfo({
  className,
  children,
  ref,
  ...props
}: CommitInfoProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("commit__info", className)} {...props}>
      {children}
    </div>
  );
}

export interface CommitHashProps extends React.HTMLAttributes<HTMLSpanElement> {
  hash: string;
}

export function CommitHash({
  className,
  hash,
  ref,
  ...props
}: CommitHashProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("commit__hash", className)} {...props}>
      {hash.slice(0, 7)}
    </span>
  );
}

export interface CommitCopyButtonProps extends Omit<
  ButtonProps,
  "children" | "variant" | "size" | "color" | "className" | "onClick"
> {
  hash: string;
  label?: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export function CommitCopyButton({
  className,
  hash,
  label = "Copy hash",
  onClick,
  ...props
}: CommitCopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  const handleClick = React.useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(hash);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        /* ignore */
      }
      onClick?.(e);
    },
    [hash, onClick],
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cx("commit__copy", className)}
            {...props}
            onClick={handleClick}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        }
      />
      <TooltipPortal>
        <TooltipPositioner>
          <TooltipPopup>{copied ? "Copied" : label}</TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
}

export interface CommitTimestampProps extends React.HTMLAttributes<HTMLTimeElement> {
  date: Date;
}

export function CommitTimestamp({
  className,
  date,
  ref,
  ...props
}: CommitTimestampProps & { ref?: React.Ref<HTMLTimeElement> }) {
  const iso = date.toISOString();
  return (
    <time
      ref={ref}
      dateTime={iso}
      className={cx("commit__timestamp", className)}
      title={date.toLocaleString()}
      {...props}
    >
      {formatRelative(date)}
    </time>
  );
}

export interface CommitActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CommitActions({
  className,
  children,
  ref,
  ...props
}: CommitActionsProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("commit__actions", className)} {...props}>
      {children}
    </div>
  );
}

export interface CommitContentProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Panel>,
  "className"
> {
  className?: string;
}

export function CommitContent({
  className,
  children,
  ref,
  ...props
}: CommitContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCollapsible.Panel ref={ref} className={cx("commit__content", className)} {...props}>
      <div className="commit__content-inner">{children}</div>
    </BaseCollapsible.Panel>
  );
}

export interface CommitFilesProps extends React.HTMLAttributes<HTMLUListElement> {}

export function CommitFiles({
  className,
  children,
  ref,
  ...props
}: CommitFilesProps & { ref?: React.Ref<HTMLUListElement> }) {
  return (
    <ul ref={ref} className={cx("commit__files", className)} {...props}>
      {children}
    </ul>
  );
}

export interface CommitFileProps extends React.LiHTMLAttributes<HTMLLIElement> {}

export function CommitFile({
  className,
  children,
  ref,
  ...props
}: CommitFileProps & { ref?: React.Ref<HTMLLIElement> }) {
  return (
    <li ref={ref} className={cx("commit__file", className)} {...props}>
      {children}
    </li>
  );
}

export interface CommitFileStatusProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "color"
> {
  status: CommitFileStatusValue;
}

export function CommitFileStatus({
  className,
  status,
  ref,
  ...props
}: CommitFileStatusProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <Badge
      {...props}
      ref={ref}
      color={FILE_STATUS_COLOR[status]}
      size="sm"
      className={cx("commit__file-status", className)}
      aria-label={status}
    >
      {FILE_STATUS_LABEL[status]}
    </Badge>
  );
}

export interface CommitFileIconProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function CommitFileIcon({
  className,
  ref,
  ...props
}: CommitFileIconProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("commit__file-icon", className)} aria-hidden="true" {...props}>
      <FileIcon />
    </span>
  );
}

export interface CommitFilePathProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function CommitFilePath({
  className,
  children,
  ref,
  ...props
}: CommitFilePathProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("commit__file-path", className)} {...props}>
      {children}
    </span>
  );
}

export interface CommitFileAdditionsProps extends React.HTMLAttributes<HTMLSpanElement> {
  count: number;
}

export function CommitFileAdditions({
  className,
  count,
  ref,
  ...props
}: CommitFileAdditionsProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span
      ref={ref}
      className={cx("commit__file-additions", className)}
      aria-label={`${count} additions`}
      {...props}
    >
      +{count}
    </span>
  );
}

export interface CommitFileDeletionsProps extends React.HTMLAttributes<HTMLSpanElement> {
  count: number;
}

export function CommitFileDeletions({
  className,
  count,
  ref,
  ...props
}: CommitFileDeletionsProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span
      ref={ref}
      className={cx("commit__file-deletions", className)}
      aria-label={`${count} deletions`}
      {...props}
    >
      -{count}
    </span>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  const diffYr = Math.round(diffMo / 12);
  return `${diffYr}y ago`;
}
