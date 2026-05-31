import * as React from "react";
import { Badge, type BadgeColor } from "./Badge.js";
import { Button, type ButtonProps } from "./Button.js";
import { ScrollArea } from "./ScrollArea.js";
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipTrigger,
} from "./Tooltip.js";
import { cx } from "./_internal/class-names.js";
import { type AnsiSegment, parseAnsi } from "./_internal/ansi.js";
import { CheckIcon, CopyIcon, XIcon } from "./_internal/icons.js";

interface TerminalContextValue {
  output: string;
  isStreaming: boolean;
  autoScroll: boolean;
  onClear?: () => void;
}

const TerminalContext = React.createContext<TerminalContextValue | null>(null);

function useTerminalContext(): TerminalContextValue {
  const ctx = React.useContext(TerminalContext);
  if (!ctx) {
    throw new Error("Terminal subcomponents must be used inside <Terminal>.");
  }
  return ctx;
}

export interface TerminalProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Terminal output; may include ANSI escape codes. */
  output: string;
  /** Whether output is actively streaming. Shows a blinking cursor. */
  isStreaming?: boolean;
  /** Whether to auto-scroll to bottom when output changes. */
  autoScroll?: boolean;
  /** Called when the clear button is pressed. */
  onClear?: () => void;
}

/**
 * A console output viewer with ANSI color support, auto-scroll, and a
 * streaming cursor. Compose with TerminalHeader and TerminalContent.
 *
 * @example
 * ```tsx
 * <Terminal output={logs} isStreaming>
 *   <TerminalHeader>
 *     <TerminalTitle>build.log</TerminalTitle>
 *     <TerminalStatus status="running" />
 *     <TerminalActions>
 *       <TerminalCopyButton />
 *       <TerminalClearButton />
 *     </TerminalActions>
 *   </TerminalHeader>
 *   <TerminalContent />
 * </Terminal>
 * ```
 */
export function Terminal({
  className,
  output,
  isStreaming = false,
  autoScroll = true,
  onClear,
  children,
  ref,
  ...props
}: TerminalProps & { ref?: React.Ref<HTMLDivElement> }) {
  const ctxValue = React.useMemo<TerminalContextValue>(
    () => ({ output, isStreaming, autoScroll, onClear }),
    [output, isStreaming, autoScroll, onClear],
  );

  return (
    <TerminalContext.Provider value={ctxValue}>
      <div
        ref={ref}
        className={cx("terminal", className)}
        data-streaming={isStreaming ? "" : undefined}
        {...props}
      >
        {children}
      </div>
    </TerminalContext.Provider>
  );
}

export interface TerminalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function TerminalHeader({
  className,
  children,
  ref,
  ...props
}: TerminalHeaderProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("terminal__header", className)} {...props}>
      {children}
    </div>
  );
}

export interface TerminalTitleProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function TerminalTitle({
  className,
  children,
  ref,
  ...props
}: TerminalTitleProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("terminal__title", className)} {...props}>
      {children}
    </span>
  );
}

export type TerminalStatusValue = "idle" | "running" | "success" | "error";

const STATUS_COLOR: Record<TerminalStatusValue, BadgeColor> = {
  idle: "neutral",
  running: "primary",
  success: "success",
  error: "destructive",
};

export interface TerminalStatusProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
  status: TerminalStatusValue;
}

export function TerminalStatus({
  className,
  status,
  ref,
  ...props
}: TerminalStatusProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <Badge
      {...props}
      ref={ref}
      color={STATUS_COLOR[status]}
      size="sm"
      className={cx("terminal__status", className)}
    >
      {status}
    </Badge>
  );
}

export interface TerminalActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

export function TerminalActions({
  className,
  children,
  ref,
  ...props
}: TerminalActionsProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("terminal__actions", className)} {...props}>
      {children}
    </div>
  );
}

export interface TerminalContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function TerminalContent({
  className,
  ref,
  ...props
}: TerminalContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { output, isStreaming, autoScroll } = useTerminalContext();
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = React.useState(true);

  // Parse ANSI to styled segments.
  const segments = React.useMemo<AnsiSegment[]>(() => parseAnsi(output), [output]);

  // Auto-scroll to bottom while sticking.
  React.useEffect(() => {
    if (!autoScroll || !stickToBottom) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [output, autoScroll, stickToBottom]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 8;
    setStickToBottom(atBottom);
  };

  return (
    <ScrollArea.Root ref={ref} className={cx("terminal__content", className)} {...props}>
      <ScrollArea.Viewport
        ref={viewportRef}
        className="terminal__content-viewport"
        onScroll={handleScroll}
      >
        <pre className="terminal__output">
          {segments.map((seg, i) => (
            <span
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              style={{
                color: seg.fg,
                backgroundColor: seg.bg,
                fontWeight: seg.bold ? "bold" : undefined,
                fontStyle: seg.italic ? "italic" : undefined,
                textDecoration: seg.underline
                  ? "underline"
                  : seg.strikethrough
                    ? "line-through"
                    : undefined,
                opacity: seg.dim ? 0.7 : undefined,
              }}
            >
              {seg.content}
            </span>
          ))}
          {isStreaming ? <span className="terminal__cursor" aria-hidden="true" /> : null}
        </pre>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

export interface TerminalCopyButtonProps extends Omit<
  ButtonProps,
  "children" | "variant" | "size" | "color" | "className" | "onClick"
> {
  className?: string;
  label?: string;
  /** Milliseconds to show "Copied" before reverting. Default 2000. */
  timeout?: number;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export function TerminalCopyButton({
  className,
  label = "Copy output",
  timeout = 2000,
  onClick,
  ...props
}: TerminalCopyButtonProps) {
  const { output } = useTerminalContext();
  const [copied, setCopied] = React.useState(false);

  // Strip ANSI before copying so pastes are clean.
  const plain = React.useMemo(() => stripAnsi(output), [output]);

  const handleClick = React.useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      try {
        await navigator.clipboard.writeText(plain);
        setCopied(true);
        window.setTimeout(() => setCopied(false), timeout);
      } catch {
        /* ignore */
      }
      onClick?.(e);
    },
    [plain, timeout, onClick],
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cx("terminal__copy", className)}
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

export interface TerminalClearButtonProps extends Omit<
  ButtonProps,
  "children" | "variant" | "size" | "color" | "className" | "onClick"
> {
  className?: string;
  label?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export function TerminalClearButton({
  className,
  label = "Clear terminal",
  onClick,
  ...props
}: TerminalClearButtonProps) {
  const { onClear } = useTerminalContext();

  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClear?.();
      onClick?.(e);
    },
    [onClear, onClick],
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cx("terminal__clear", className)}
            {...props}
            onClick={handleClick}
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

// Matches all common ANSI escape sequences (SGR, cursor, etc.).
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\u001b\[[0-9;?]*[a-zA-Z]/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
}
