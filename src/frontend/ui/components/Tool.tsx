import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { Badge, type BadgeColor } from "./Badge.js";
import { CodeBlock, CodeBlockContainer, CodeBlockContent } from "./CodeBlock.js";
import { formatStructuredCodeDisplay } from "../code-display/structured-code.js";
import { cx } from "./_internal/class-names.js";
import { ChevronRightIcon } from "./_internal/icons.js";

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

const STATE_TO_COLOR: Record<ToolState, BadgeColor> = {
  "input-streaming": "primary",
  "input-available": "neutral",
  "approval-requested": "warning",
  "approval-responded": "neutral",
  "output-available": "success",
  "output-error": "destructive",
  "output-denied": "destructive",
};

const STATE_LABEL: Record<ToolState, string> = {
  "input-streaming": "Pending",
  "input-available": "Running",
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "output-available": "Completed",
  "output-error": "Error",
  "output-denied": "Denied",
};

interface ToolContextValue {
  state: ToolState;
}

const ToolContext = React.createContext<ToolContextValue | null>(null);

function useToolContext(): ToolContextValue {
  const ctx = React.use(ToolContext);
  if (!ctx) {
    throw new Error("Tool subcomponents must be used inside <Tool>.");
  }
  return ctx;
}

export interface ToolProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Root>,
  "className"
> {
  className?: string;
  /** Current state of the tool invocation. */
  state: ToolState;
}

/**
 * Displays a collapsible tool invocation (name, input, output, state).
 * The state drives the status badge color and default open behavior —
 * `output-available`, `output-error`, and `output-denied` auto-open.
 *
 * @example
 * ```tsx
 * <Tool state="output-available">
 *   <ToolHeader type="function" toolName="search_web" />
 *   <ToolContent>
 *     <ToolInput input={{ query: "weather in Tokyo" }} />
 *     <ToolOutput output={<pre>{JSON.stringify(result, null, 2)}</pre>} />
 *   </ToolContent>
 * </Tool>
 * ```
 */
export function Tool({
  className,
  state,
  defaultOpen,
  ref,
  ...props
}: ToolProps & { ref?: React.Ref<HTMLDivElement> }) {
  const autoOpen =
    state === "output-available" || state === "output-error" || state === "output-denied";
  const ctx = React.useMemo<ToolContextValue>(() => ({ state }), [state]);

  return (
    <ToolContext.Provider value={ctx}>
      <BaseCollapsible.Root
        ref={ref}
        className={cx("tool", className)}
        defaultOpen={defaultOpen ?? autoOpen}
        data-state={state}
        {...props}
      />
    </ToolContext.Provider>
  );
}

export interface ToolHeaderProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Trigger>,
  "className" | "type"
> {
  className?: string;
  /** The tool "type" (e.g. "function", "retrieval"). */
  type: string;
  /** The specific tool invoked (e.g. "search_web"). */
  toolName?: string;
  /** Optional human-readable title shown alongside the tool name. */
  title?: string;
}

/**
 * Clickable header that shows the tool type, name, and state badge.
 */
export function ToolHeader({
  className,
  type,
  toolName,
  title,
  ref,
  ...props
}: ToolHeaderProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const { state } = useToolContext();

  return (
    <BaseCollapsible.Trigger ref={ref} className={cx("tool__header", className)} {...props}>
      <span className="tool__header-icon" aria-hidden="true">
        <ChevronRightIcon />
      </span>
      <span className="tool__header-type">{type}</span>
      {toolName ? <span className="tool__header-name">{toolName}</span> : null}
      {title ? <span className="tool__header-title">{title}</span> : null}
      <span className="tool__header-spacer" />
      <Badge color={STATE_TO_COLOR[state]} size="sm" className="tool__header-badge">
        {STATE_LABEL[state]}
      </Badge>
    </BaseCollapsible.Trigger>
  );
}

export interface ToolContentProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Panel>,
  "className"
> {
  className?: string;
}

/**
 * Collapsible panel holding ToolInput and ToolOutput.
 */
export function ToolContent({
  className,
  children,
  ref,
  ...props
}: ToolContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCollapsible.Panel ref={ref} className={cx("tool__content", className)} {...props}>
      <div className="tool__content-inner">{children}</div>
    </BaseCollapsible.Panel>
  );
}

export interface ToolInputProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The input passed to the tool (rendered as a JSON code block). */
  input: unknown;
}

/**
 * Displays the tool input as a JSON code block.
 */
export function ToolInput({
  className,
  input,
  ref,
  ...props
}: ToolInputProps & { ref?: React.Ref<HTMLDivElement> }) {
  const formattedInput = React.useMemo(() => formatStructuredCodeDisplay(input), [input]);

  return (
    <div ref={ref} className={cx("tool__section", className)} {...props}>
      <div className="tool__section-label">Input</div>
      <CodeBlock
        code={formattedInput.code}
        language={formattedInput.language}
        className="tool__code-block"
      >
        <CodeBlockContainer>
          <CodeBlockContent />
        </CodeBlockContainer>
      </CodeBlock>
    </div>
  );
}

export interface ToolOutputProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The tool output (any React node). Mutually exclusive with errorText. */
  output?: React.ReactNode;
  /** Error message, rendered with destructive styling. */
  errorText?: string;
}

/**
 * Displays the tool output or error text.
 */
export function ToolOutput({
  className,
  children,
  output,
  errorText,
  ref,
  ...props
}: ToolOutputProps & { ref?: React.Ref<HTMLDivElement> }) {
  const isError = errorText !== undefined;
  return (
    <div
      ref={ref}
      className={cx("tool__section", isError && "tool__section--error", className)}
      {...props}
    >
      <div className="tool__section-label">{isError ? "Error" : "Output"}</div>
      {isError ? (
        <div className="tool__error-text">{errorText}</div>
      ) : (
        <div>{children ?? output}</div>
      )}
    </div>
  );
}
