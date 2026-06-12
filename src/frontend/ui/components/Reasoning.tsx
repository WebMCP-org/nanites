import * as React from "react";
import {
  Collapsible as BaseCollapsible,
  type CollapsibleRootChangeEventDetails,
} from "@base-ui/react/collapsible";
import { cx } from "./_internal/class-names.js";
import { ChevronRightIcon } from "./_internal/icons.js";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration?: number;
}

const ReasoningContext = React.createContext<ReasoningContextValue | null>(null);

const AUTO_CLOSE_DELAY_MS = 1_000;
const MS_IN_S = 1_000;

export function useReasoning(): ReasoningContextValue {
  const ctx = React.use(ReasoningContext);
  if (!ctx) {
    throw new Error("Reasoning subcomponents must be used inside <Reasoning>.");
  }
  return ctx;
}

export interface ReasoningProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Root>,
  "className" | "onOpenChange"
> {
  className?: string;
  /**
   * Whether the model is currently generating reasoning. When true the
   * component auto-opens; it auto-closes once streaming ends.
   */
  isStreaming?: boolean;
  /**
   * Elapsed reasoning time in seconds, shown in the trigger when finished.
   * When omitted, the component measures the duration automatically.
   */
  duration?: number;
  /** Called when the open state changes. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * A collapsible "thinking" block for showing model reasoning (e.g. DeepSeek
 * R1, OpenAI o-series). Auto-expands while streaming and collapses when done.
 *
 * @example
 * ```tsx
 * <Reasoning isStreaming={isThinking} duration={elapsed}>
 *   <ReasoningTrigger />
 *   <ReasoningContent>{reasoningText}</ReasoningContent>
 * </Reasoning>
 * ```
 */
export function Reasoning({
  className,
  isStreaming = false,
  duration,
  open,
  defaultOpen,
  onOpenChange,
  children,
  ref,
  ...props
}: ReasoningProps & { ref?: React.Ref<HTMLDivElement> }) {
  const [internalOpen, setInternalOpen] = React.useState<boolean>(defaultOpen ?? isStreaming);
  const [internalDuration, setInternalDuration] = React.useState<number | undefined>(duration);
  const previousStreamingRef = React.useRef(isStreaming);
  const startTimeRef = React.useRef<number | null>(isStreaming ? Date.now() : null);
  const hasEverStreamedRef = React.useRef(isStreaming);
  const hasAutoClosedRef = React.useRef(false);

  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : internalOpen;
  const preventAutoOpen = defaultOpen === false && !isControlled;
  const resolvedDuration = duration ?? internalDuration;

  const setOpenState = React.useCallback(
    (next: boolean) => {
      if (next === currentOpen) {
        return;
      }
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [currentOpen, isControlled, onOpenChange],
  );

  React.useEffect(() => {
    if (duration !== undefined) {
      setInternalDuration(duration);
    }
  }, [duration]);

  React.useEffect(() => {
    if (isStreaming) {
      hasEverStreamedRef.current = true;
      hasAutoClosedRef.current = false;
      if (duration === undefined) {
        setInternalDuration(undefined);
      }
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }
      return;
    }

    if (startTimeRef.current !== null) {
      if (duration === undefined) {
        setInternalDuration(Math.max(1, Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S)));
      }
      startTimeRef.current = null;
    }
  }, [duration, isStreaming]);

  React.useEffect(() => {
    const wasStreaming = previousStreamingRef.current;

    if (isStreaming && !wasStreaming && !preventAutoOpen) {
      setOpenState(true);
    }

    if (
      !isStreaming &&
      wasStreaming &&
      hasEverStreamedRef.current &&
      currentOpen &&
      !hasAutoClosedRef.current
    ) {
      const closeTimer = window.setTimeout(() => {
        setOpenState(false);
        hasAutoClosedRef.current = true;
      }, AUTO_CLOSE_DELAY_MS);

      previousStreamingRef.current = isStreaming;
      return () => window.clearTimeout(closeTimer);
    }

    previousStreamingRef.current = isStreaming;
  }, [currentOpen, isStreaming, preventAutoOpen, setOpenState]);

  const handleOpenChange = React.useCallback(
    (next: boolean, _eventDetails: CollapsibleRootChangeEventDetails) => {
      setOpenState(next);
    },
    [setOpenState],
  );

  const ctx = React.useMemo<ReasoningContextValue>(
    () => ({
      isStreaming,
      isOpen: currentOpen,
      setIsOpen: setOpenState,
      duration: resolvedDuration,
    }),
    [currentOpen, isStreaming, resolvedDuration, setOpenState],
  );

  return (
    <ReasoningContext.Provider value={ctx}>
      <BaseCollapsible.Root
        ref={ref}
        className={cx("reasoning", className)}
        open={currentOpen}
        onOpenChange={handleOpenChange}
        data-streaming={isStreaming ? "" : undefined}
        {...props}
      >
        {children}
      </BaseCollapsible.Root>
    </ReasoningContext.Provider>
  );
}

export interface ReasoningTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Trigger>,
  "className"
> {
  className?: string;
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => React.ReactNode;
}

function defaultGetThinkingMessage(isStreaming: boolean, duration?: number) {
  if (isStreaming || duration === 0) {
    return "Thinking...";
  }

  if (duration === undefined) {
    return "Thought for a few seconds";
  }

  return `Thought for ${duration} second${duration === 1 ? "" : "s"}`;
}

/**
 * Trigger that toggles the reasoning panel. Shows "Thinking..." while
 * streaming and "Thought for Ns" afterward.
 */
export function ReasoningTrigger({
  className,
  children,
  getThinkingMessage = defaultGetThinkingMessage,
  ref,
  ...props
}: ReasoningTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const { isStreaming, duration } = useReasoning();
  const label = children ?? getThinkingMessage(isStreaming, duration);

  return (
    <BaseCollapsible.Trigger
      ref={ref}
      className={cx("reasoning__trigger", className)}
      data-streaming={isStreaming ? "" : undefined}
      {...props}
    >
      <span className="reasoning__trigger-icon" aria-hidden="true">
        <ChevronRightIcon />
      </span>
      <span className="reasoning__trigger-label">{label}</span>
    </BaseCollapsible.Trigger>
  );
}

export interface ReasoningContentProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Panel>,
  "className"
> {
  className?: string;
}

/**
 * The reasoning text panel. Accepts any React node but is optimized for
 * long-form text; a muted left border visually distinguishes the block.
 */
export function ReasoningContent({
  className,
  children,
  ref,
  ...props
}: ReasoningContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCollapsible.Panel ref={ref} className={cx("reasoning__content", className)} {...props}>
      <div className="reasoning__text">{children}</div>
    </BaseCollapsible.Panel>
  );
}
