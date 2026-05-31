import * as React from "react";

const DEFAULT_STICK_SLACK_PX = 160;

export interface UseStickToBottomOptions {
  /**
   * How close to the bottom (in pixels) still counts as "at bottom" for the
   * sticky behavior. Larger values keep the viewport pinned through small
   * scroll jitter.
   */
  slackPx?: number;
}

export interface UseStickToBottomResult {
  /** Attach to the scrolling element. */
  viewportRef: (element: HTMLElement | null) => void;
  /**
   * Attach to the element whose size determines whether the viewport
   * overflows. Typically the immediate child of the viewport.
   */
  contentRef: (element: HTMLElement | null) => void;
  /** True while the viewport is pinned within `slackPx` of the bottom. */
  isAtBottom: boolean;
  /** Imperatively scroll the viewport to its bottom. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

/**
 * Pin a scrollable viewport to the bottom as its content grows, unless the
 * user has scrolled up. Used by the conversation log and the workspace code
 * inspector to keep streaming output in view without fighting user intent.
 */
export function useStickToBottom(options: UseStickToBottomOptions = {}): UseStickToBottomResult {
  const slackPx = options.slackPx ?? DEFAULT_STICK_SLACK_PX;

  const viewportElementRef = React.useRef<HTMLElement | null>(null);
  const contentElementRef = React.useRef<HTMLElement | null>(null);
  const [viewportElement, setViewportElement] = React.useState<HTMLElement | null>(null);
  const [contentElement, setContentElement] = React.useState<HTMLElement | null>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);
  const isAtBottomRef = React.useRef(true);
  const didInitialScrollRef = React.useRef(false);

  const viewportRef = React.useCallback((element: HTMLElement | null) => {
    viewportElementRef.current = element;
    setViewportElement((prev) => (prev === element ? prev : element));
  }, []);

  const contentRef = React.useCallback((element: HTMLElement | null) => {
    contentElementRef.current = element;
    setContentElement((prev) => (prev === element ? prev : element));
  }, []);

  React.useLayoutEffect(() => {
    const el = viewportElement;
    const observed = contentElement ?? (el?.firstElementChild as HTMLElement | null);
    if (!el || !observed) return;

    if (!didInitialScrollRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      didInitialScrollRef.current = true;
    }

    const readIsAtBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < slackPx;

    const updateIsAtBottom = () => {
      const next = readIsAtBottom();
      if (isAtBottomRef.current === next) return;
      isAtBottomRef.current = next;
      setIsAtBottom(next);
    };

    let resizeFrameId: number | null = null;
    const flushResize = () => {
      resizeFrameId = null;
      if (!isAtBottomRef.current) {
        updateIsAtBottom();
        return;
      }
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      updateIsAtBottom();
    };

    const scheduleResize = () => {
      if (resizeFrameId !== null) return;
      resizeFrameId = window.requestAnimationFrame(flushResize);
    };

    const handleScroll = () => {
      updateIsAtBottom();
    };

    handleScroll();
    el.addEventListener("scroll", handleScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      scheduleResize();
    });
    observer.observe(observed);

    return () => {
      if (resizeFrameId !== null) {
        window.cancelAnimationFrame(resizeFrameId);
      }
      el.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [contentElement, viewportElement, slackPx]);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = viewportElementRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  return { viewportRef, contentRef, isAtBottom, scrollToBottom };
}
