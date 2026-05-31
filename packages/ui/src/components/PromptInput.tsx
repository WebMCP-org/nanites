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
import { ArrowUpIcon, SpinnerIcon, SquareIcon, WarningIcon } from "./_internal/icons.js";

/** The payload produced when the prompt input is submitted. */
export interface PromptInputMessage {
  text: string;
}

/** Lifecycle status of an in-flight model request. */
export type PromptInputStatus = "ready" | "submitted" | "streaming" | "error";

interface PromptInputContextValue {
  formId: string;
  submit: () => void;
}

const PromptInputContext = React.createContext<PromptInputContextValue | null>(null);

function usePromptInputContext(component: string): PromptInputContextValue {
  const ctx = React.useContext(PromptInputContext);
  if (!ctx) {
    throw new Error(`${component} must be used inside a <PromptInput>.`);
  }
  return ctx;
}

export interface PromptInputProps extends Omit<
  React.FormHTMLAttributes<HTMLFormElement>,
  "onSubmit"
> {
  /** Called with the trimmed message text when the form is submitted. */
  onSubmit?: (message: PromptInputMessage, event: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * Chat-style composer form. Wraps a textarea and footer controls, with
 * Enter-to-submit semantics and auto-resizing behavior on children.
 *
 * @example
 * ```tsx
 * <PromptInput onSubmit={(m) => send(m.text)}>
 *   <PromptInputBody>
 *     <PromptInputTextarea />
 *   </PromptInputBody>
 *   <PromptInputFooter>
 *     <PromptInputTools>
 *       <PromptInputButton tooltip="Search"><SearchIcon /></PromptInputButton>
 *     </PromptInputTools>
 *     <PromptInputSubmit status={status} />
 *   </PromptInputFooter>
 * </PromptInput>
 * ```
 */
export function PromptInput({
  className,
  onSubmit,
  children,
  id,
  ref,
  ...props
}: PromptInputProps & { ref?: React.Ref<HTMLFormElement> }) {
  const generatedId = React.useId();
  const formId = id ?? generatedId;
  const formRef = React.useRef<HTMLFormElement | null>(null);

  React.useImperativeHandle(ref, () => formRef.current as HTMLFormElement, []);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      const form = event.currentTarget;
      const textarea = form.querySelector<HTMLTextAreaElement>(
        'textarea[data-prompt-input-textarea="true"]',
      );
      const text = textarea?.value.trim() ?? "";
      onSubmit?.({ text }, event);
      event.preventDefault();
      if (textarea && text.length > 0) {
        textarea.value = "";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    [onSubmit],
  );

  const submit = React.useCallback(() => {
    formRef.current?.requestSubmit();
  }, []);

  const ctx = React.useMemo<PromptInputContextValue>(() => ({ formId, submit }), [formId, submit]);

  return (
    <PromptInputContext.Provider value={ctx}>
      <form
        ref={formRef}
        id={formId}
        className={cx("prompt-input", className)}
        onSubmit={handleSubmit}
        {...props}
      >
        {children}
      </form>
    </PromptInputContext.Provider>
  );
}

export interface PromptInputHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Optional top row, above the textarea. Useful for context chips,
 * breadcrumbs, or attachment previews.
 */
export function PromptInputHeader({
  className,
  children,
  ref,
  ...props
}: PromptInputHeaderProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("prompt-input__header", className)} {...props}>
      {children}
    </div>
  );
}

export interface PromptInputBodyProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Wrapper around the textarea; spans the full width of the prompt input.
 */
export function PromptInputBody({
  className,
  children,
  ref,
  ...props
}: PromptInputBodyProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("prompt-input__body", className)} {...props}>
      {children}
    </div>
  );
}

export interface PromptInputFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Bottom row for tool buttons and the submit control. Children are laid out
 * horizontally with space-between alignment.
 */
export function PromptInputFooter({
  className,
  children,
  ref,
  ...props
}: PromptInputFooterProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("prompt-input__footer", className)} {...props}>
      {children}
    </div>
  );
}

export interface PromptInputToolsProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Left-aligned cluster of buttons inside {@link PromptInputFooter}.
 */
export function PromptInputTools({
  className,
  children,
  ref,
  ...props
}: PromptInputToolsProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("prompt-input__tools", className)} {...props}>
      {children}
    </div>
  );
}

const MIN_TEXTAREA_HEIGHT_PX = 48;
const MAX_TEXTAREA_HEIGHT_PX = 240;

export interface PromptInputTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Minimum height of the textarea in pixels. Defaults to 48. */
  minHeight?: number;
  /** Maximum height before the textarea starts scrolling. Defaults to 240. */
  maxHeight?: number;
}

/**
 * Auto-resizing textarea. Submits on Enter; inserts a newline on Shift+Enter.
 * Height grows with the content between {@link minHeight} and {@link maxHeight}.
 */
export function PromptInputTextarea({
  className,
  placeholder = "How can I help?",
  rows = 1,
  minHeight = MIN_TEXTAREA_HEIGHT_PX,
  maxHeight = MAX_TEXTAREA_HEIGHT_PX,
  onKeyDown,
  onInput,
  ref,
  ...props
}: PromptInputTextareaProps & { ref?: React.Ref<HTMLTextAreaElement> }) {
  const { submit } = usePromptInputContext("PromptInputTextarea");
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement, []);

  const resize = React.useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxHeight, minHeight]);

  React.useLayoutEffect(() => {
    resize();
  }, [resize, props.value, props.defaultValue]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const handleInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    onInput?.(event as React.InputEvent<HTMLTextAreaElement>);
    resize();
  };

  return (
    <textarea
      ref={innerRef}
      data-prompt-input-textarea="true"
      className={cx("prompt-input__textarea", className)}
      placeholder={placeholder}
      rows={rows}
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      style={{ minHeight, maxHeight, ...props.style }}
      {...props}
    />
  );
}

type TooltipSide = "top" | "right" | "bottom" | "left";

/** Tooltip options accepted by {@link PromptInputButton}. */
export interface PromptInputTooltipConfig {
  content: React.ReactNode;
  shortcut?: string;
  side?: TooltipSide;
}

export interface PromptInputButtonProps extends Omit<ButtonProps, "children" | "className"> {
  className?: string;
  /** Tooltip text, or an object with content, keyboard shortcut, and side. */
  tooltip?: string | PromptInputTooltipConfig;
  children?: React.ReactNode;
}

/**
 * Icon button for the prompt input toolbar. Supports an optional tooltip
 * with keyboard shortcut hint.
 *
 * @example
 * ```tsx
 * <PromptInputButton tooltip={{ content: "Search", shortcut: "⌘K" }}>
 *   <SearchIcon />
 * </PromptInputButton>
 * ```
 */
export function PromptInputButton({
  className,
  tooltip,
  variant = "ghost",
  color = "neutral",
  size = "sm",
  children,
  "aria-label": ariaLabel,
  ref,
  ...props
}: PromptInputButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const tooltipConfig: PromptInputTooltipConfig | undefined =
    typeof tooltip === "string" ? { content: tooltip } : tooltip;

  const fallbackLabel =
    ariaLabel ?? (typeof tooltipConfig?.content === "string" ? tooltipConfig.content : undefined);

  const button = (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      color={color}
      size={size}
      className={cx("prompt-input__button", className)}
      aria-label={fallbackLabel}
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltipConfig) return button;

  const { content, shortcut, side } = tooltipConfig;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPortal>
        <TooltipPositioner side={side} sideOffset={6}>
          <TooltipPopup>
            <span className="prompt-input__tooltip-content">{content}</span>
            {shortcut ? <kbd className="prompt-input__tooltip-shortcut">{shortcut}</kbd> : null}
          </TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
}

export interface PromptInputSubmitProps extends Omit<
  ButtonProps,
  "children" | "className" | "type"
> {
  className?: string;
  /** Current lifecycle state of the request; controls the button icon. */
  status?: PromptInputStatus;
  /**
   * Called when the button is clicked during `submitted` or `streaming`
   * status. Use this to cancel an in-flight request.
   */
  onStop?: () => void;
  children?: React.ReactNode;
  /** Accessible label for the button. */
  label?: string;
}

function defaultSubmitIcon(status: PromptInputStatus) {
  switch (status) {
    case "submitted":
      return <SpinnerIcon className="prompt-input__submit-spinner" />;
    case "streaming":
      return <SquareIcon />;
    case "error":
      return <WarningIcon />;
    default:
      return <ArrowUpIcon />;
  }
}

function defaultSubmitLabel(status: PromptInputStatus) {
  switch (status) {
    case "submitted":
      return "Sending";
    case "streaming":
      return "Stop response";
    case "error":
      return "Retry";
    default:
      return "Send message";
  }
}

/**
 * Submit button with an icon that tracks the current {@link status}. During
 * `streaming` the button becomes a Stop control that calls {@link onStop}
 * instead of submitting.
 */
export function PromptInputSubmit({
  className,
  status = "ready",
  onStop,
  variant = "normal",
  color = "primary",
  size = "icon",
  onClick,
  children,
  label,
  ref,
  ...props
}: PromptInputSubmitProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const isStopping = status === "submitted" || status === "streaming";
  const resolvedLabel = label ?? defaultSubmitLabel(status);

  return (
    <Button
      ref={ref}
      type={isStopping ? "button" : "submit"}
      variant={variant}
      color={color}
      size={size}
      className={cx("prompt-input__submit", className)}
      data-status={status}
      aria-label={resolvedLabel}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (isStopping) {
          event.preventDefault();
          onStop?.();
        }
      }}
      {...props}
    >
      {children ?? defaultSubmitIcon(status)}
    </Button>
  );
}
