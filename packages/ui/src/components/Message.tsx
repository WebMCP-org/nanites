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
import { ArrowLeftIcon, ArrowRightIcon } from "./_internal/icons.js";

export type MessageRole = "user" | "assistant" | "system" | "tool" | (string & {});

export interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The originating role of the message. Controls alignment and styling via
   * the `data-from` attribute (e.g. user messages align end).
   */
  from?: MessageRole;
}

/**
 * A chat message row. Aligns and styles itself based on {@link from}.
 *
 * Compose with {@link MessageContent} for the bubble, {@link MessageActions}
 * for toolbar actions, and {@link MessageBranch} for multi-version responses.
 *
 * @example
 * ```tsx
 * <Message from="assistant">
 *   <MessageContent>Hello there!</MessageContent>
 *   <MessageActions>
 *     <MessageAction label="Copy" tooltip="Copy to clipboard">
 *       <CopyIcon />
 *     </MessageAction>
 *   </MessageActions>
 * </Message>
 * ```
 */
export function Message({
  className,
  from = "assistant",
  children,
  ref,
  ...props
}: MessageProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("message", className)} data-from={from} {...props}>
      {children}
    </div>
  );
}

export interface MessageContentProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * The visible bubble/body of a message. Styled differently based on the
 * parent {@link Message}'s `from` attribute.
 */
export function MessageContent({
  className,
  children,
  ref,
  ...props
}: MessageContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("message__content", className)} {...props}>
      {children}
    </div>
  );
}

export interface MessageActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Horizontal list of action buttons (copy, retry, thumbs-up, etc.) shown
 * alongside or beneath a message.
 */
export function MessageActions({
  className,
  children,
  ref,
  ...props
}: MessageActionsProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("message__actions", className)} role="toolbar" {...props}>
      {children}
    </div>
  );
}

export interface MessageActionProps extends Omit<ButtonProps, "children" | "className"> {
  className?: string;
  /** Accessible name for the button. Required when no visible text children. */
  label: string;
  /** Optional tooltip text shown on hover/focus. Defaults to {@link label}. */
  tooltip?: string;
  children?: React.ReactNode;
}

/**
 * A single icon button inside {@link MessageActions}. Always has an accessible
 * name; shows a tooltip on hover/focus when {@link tooltip} is set.
 */
export function MessageAction({
  className,
  label,
  tooltip,
  variant = "ghost",
  color = "neutral",
  size = "sm",
  children,
  ref,
  ...props
}: MessageActionProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const button = (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      color={color}
      size={size}
      className={cx("message__action", className)}
      aria-label={label}
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPortal>
        <TooltipPositioner sideOffset={6}>
          <TooltipPopup>{tooltip}</TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
}

export interface MessageToolbarProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Horizontal container that places children in a row with space between —
 * typically a {@link MessageBranchSelector} on one side and
 * {@link MessageActions} on the other.
 */
export function MessageToolbar({
  className,
  children,
  ref,
  ...props
}: MessageToolbarProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("message__toolbar", className)} {...props}>
      {children}
    </div>
  );
}

interface MessageBranchContextValue {
  branchIndex: number;
  branchCount: number;
  setBranchIndex: (index: number) => void;
  registerCount: (count: number) => void;
}

const MessageBranchContext = React.createContext<MessageBranchContextValue | null>(null);

function useMessageBranch(component: string): MessageBranchContextValue {
  const ctx = React.useContext(MessageBranchContext);
  if (!ctx) {
    throw new Error(`${component} must be used inside a <MessageBranch>.`);
  }
  return ctx;
}

export interface MessageBranchProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Zero-based index of the initially selected branch. */
  defaultBranch?: number;
  /** Controlled branch index. */
  branch?: number;
  /** Called when the selected branch changes. */
  onBranchChange?: (branchIndex: number) => void;
}

/**
 * Container for a message response with multiple versions. Tracks which
 * branch is active and exposes navigation through {@link MessageBranchSelector},
 * {@link MessageBranchPrevious}, {@link MessageBranchNext}, and {@link MessageBranchPage}.
 */
export function MessageBranch({
  className,
  defaultBranch = 0,
  branch,
  onBranchChange,
  children,
  ref,
  ...props
}: MessageBranchProps & { ref?: React.Ref<HTMLDivElement> }) {
  const [internalIndex, setInternalIndex] = React.useState(defaultBranch);
  const [branchCount, setBranchCount] = React.useState(0);

  const isControlled = branch !== undefined;
  const branchIndex = isControlled ? branch : internalIndex;

  const setBranchIndex = React.useCallback(
    (next: number) => {
      if (!isControlled) setInternalIndex(next);
      onBranchChange?.(next);
    },
    [isControlled, onBranchChange],
  );

  const ctx = React.useMemo<MessageBranchContextValue>(
    () => ({
      branchIndex,
      branchCount,
      setBranchIndex,
      registerCount: setBranchCount,
    }),
    [branchCount, branchIndex, setBranchIndex],
  );

  return (
    <MessageBranchContext.Provider value={ctx}>
      <div ref={ref} className={cx("message__branch", className)} {...props}>
        {children}
      </div>
    </MessageBranchContext.Provider>
  );
}

export interface MessageBranchContentProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Renders only the active branch's child. Expects siblings to represent
 * alternative versions of the same response.
 */
export function MessageBranchContent({
  className,
  children,
  ref,
  ...props
}: MessageBranchContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { branchIndex, registerCount } = useMessageBranch("MessageBranchContent");
  const items = React.Children.toArray(children);

  React.useEffect(() => {
    registerCount(items.length);
  }, [items.length, registerCount]);

  const safeIndex = items.length === 0 ? 0 : Math.min(Math.max(branchIndex, 0), items.length - 1);
  const active = items[safeIndex] ?? null;

  return (
    <div ref={ref} className={cx("message__branch-content", className)} {...props}>
      {active}
    </div>
  );
}

export interface MessageBranchSelectorProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Inline group containing branch navigation controls (previous / page /
 * next). Hidden automatically when there is only one branch.
 */
export function MessageBranchSelector({
  className,
  children,
  ref,
  ...props
}: MessageBranchSelectorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { branchCount } = useMessageBranch("MessageBranchSelector");
  if (branchCount <= 1) return null;

  return (
    <div ref={ref} className={cx("message__branch-selector", className)} {...props}>
      {children}
    </div>
  );
}

export interface MessageBranchPreviousProps extends Omit<ButtonProps, "children" | "className"> {
  className?: string;
  label?: string;
  children?: React.ReactNode;
}

/** Button that selects the previous branch. Disabled at the first branch. */
export function MessageBranchPrevious({
  className,
  label = "Previous response",
  variant = "ghost",
  color = "neutral",
  size = "sm",
  children,
  onClick,
  ref,
  ...props
}: MessageBranchPreviousProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const { branchIndex, branchCount, setBranchIndex } = useMessageBranch("MessageBranchPrevious");
  const disabled = branchIndex <= 0;

  return (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      color={color}
      size={size}
      disabled={disabled || branchCount === 0}
      className={cx("message__branch-prev", className)}
      aria-label={label}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setBranchIndex(Math.max(0, branchIndex - 1));
        }
      }}
      {...props}
    >
      {children ?? <ArrowLeftIcon />}
    </Button>
  );
}

export interface MessageBranchNextProps extends Omit<ButtonProps, "children" | "className"> {
  className?: string;
  label?: string;
  children?: React.ReactNode;
}

/** Button that selects the next branch. Disabled at the last branch. */
export function MessageBranchNext({
  className,
  label = "Next response",
  variant = "ghost",
  color = "neutral",
  size = "sm",
  children,
  onClick,
  ref,
  ...props
}: MessageBranchNextProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const { branchIndex, branchCount, setBranchIndex } = useMessageBranch("MessageBranchNext");
  const disabled = branchIndex >= branchCount - 1;

  return (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      color={color}
      size={size}
      disabled={disabled || branchCount === 0}
      className={cx("message__branch-next", className)}
      aria-label={label}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setBranchIndex(Math.min(branchCount - 1, branchIndex + 1));
        }
      }}
      {...props}
    >
      {children ?? <ArrowRightIcon />}
    </Button>
  );
}

export interface MessageBranchPageProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Customize the displayed text. Defaults to `{index} / {count}`. */
  format?: (currentIndex: number, total: number) => React.ReactNode;
}

/** Page indicator (e.g. "1 / 3") for the current branch selection. */
export function MessageBranchPage({
  className,
  format,
  ref,
  ...props
}: MessageBranchPageProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const { branchIndex, branchCount } = useMessageBranch("MessageBranchPage");
  const label = format
    ? format(branchIndex + 1, branchCount)
    : `${branchIndex + 1} / ${branchCount}`;

  return (
    <span ref={ref} className={cx("message__branch-page", className)} aria-live="polite" {...props}>
      {label}
    </span>
  );
}
