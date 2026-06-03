// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Message, MessageContent } from "./Message.js";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./Reasoning.js";
import { Conversation, ConversationContent, ConversationScrollButton } from "./Conversation.js";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./Tool.js";

type ResizeObserverRecord = {
  callback: ResizeObserverCallback;
  elements: Set<Element>;
};

const resizeObserverRecords: ResizeObserverRecord[] = [];
const animationFrameQueue: Array<FrameRequestCallback | null> = [];
const originalResizeObserver = globalThis.ResizeObserver;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const originalScrollToDescriptor = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  "scrollTo",
);
const originalConsoleError = console.error;

class MockResizeObserver implements ResizeObserver {
  private readonly record: ResizeObserverRecord;

  constructor(callback: ResizeObserverCallback) {
    this.record = {
      callback,
      elements: new Set(),
    };
    resizeObserverRecords.push(this.record);
  }

  disconnect(): void {
    this.record.elements.clear();
  }

  observe(target: Element): void {
    this.record.elements.add(target);
  }

  unobserve(target: Element): void {
    this.record.elements.delete(target);
  }
}

function notifyResize(target: Element) {
  for (const record of resizeObserverRecords) {
    if (!record.elements.has(target)) continue;
    record.callback([{ target } as ResizeObserverEntry], {} as ResizeObserver);
  }
}

function flushAnimationFrames() {
  while (animationFrameQueue.length > 0) {
    const callback = animationFrameQueue.shift();
    callback?.(0);
  }
}

function setViewportMetrics(viewport: HTMLDivElement, scrollHeight: number) {
  let scrollTop = viewport.scrollTop ?? 0;

  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    get: () => 240,
  });
  Object.defineProperty(viewport, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(viewport, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
}

function mount(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });

  return {
    container,
    root,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function getConsoleErrors(messages: readonly string[]) {
  return messages.join("\n");
}

function buildStreamingConversation(text: string) {
  return (
    <Conversation>
      <ConversationContent>
        <Message from="assistant">
          <MessageContent>{text}</MessageContent>
        </Message>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function buildRichConversation(step: number) {
  return (
    <Conversation>
      <ConversationContent>
        <Message from="user">
          <MessageContent>Open the page.</MessageContent>
        </Message>
        <Message from="assistant">
          <MessageContent>
            <Reasoning isStreaming={step < 3}>
              <ReasoningTrigger />
              <ReasoningContent>{`Thinking step ${step}`}</ReasoningContent>
            </Reasoning>
            <Tool state={step < 3 ? "input-streaming" : "output-available"} open>
              <ToolHeader type="function" toolName="browser_eval" />
              <ToolContent>
                <ToolInput input={{ step }} />
                {step >= 3 ? (
                  <ToolOutput output={<pre>{JSON.stringify({ step, ok: true }, null, 2)}</pre>} />
                ) : null}
              </ToolContent>
            </Tool>
            <div>{`Assistant update ${step}`}</div>
          </MessageContent>
        </Message>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

beforeEach(() => {
  resizeObserverRecords.length = 0;
  animationFrameQueue.length = 0;

  globalThis.ResizeObserver = MockResizeObserver;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    animationFrameQueue.push(callback);
    return animationFrameQueue.length;
  };
  globalThis.cancelAnimationFrame = (handle: number) => {
    animationFrameQueue[handle - 1] = null;
  };

  Object.defineProperty(window.HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options?: ScrollToOptions) {
      if (options?.top !== undefined) {
        (this as HTMLElement & { scrollTop: number }).scrollTop = options.top;
      }

      this.dispatchEvent(new Event("scroll"));

      if (options?.behavior === "smooth" && this.firstElementChild) {
        notifyResize(this.firstElementChild);
      }
    },
  });
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  console.error = originalConsoleError;
  if (originalScrollToDescriptor) {
    Object.defineProperty(window.HTMLElement.prototype, "scrollTo", originalScrollToDescriptor);
  }
  document.body.innerHTML = "";
});

test("keeps streaming content growth from recursing through resize-driven auto-scroll", () => {
  const consoleErrors: string[] = [];
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map((value) => String(value)).join(" "));
  };
  const mounted = mount(buildStreamingConversation("alpha"));
  const viewport = mounted.container.querySelector(".conversation");
  const content = mounted.container.querySelector(".conversation__content");

  if (!(viewport instanceof HTMLDivElement) || !(content instanceof HTMLDivElement)) {
    throw new Error("Conversation test DOM did not render as expected.");
  }

  setViewportMetrics(viewport, 640);

  act(() => {
    notifyResize(content);
    flushAnimationFrames();
  });

  act(() => {
    mounted.root.render(buildStreamingConversation("alpha beta gamma delta"));
  });

  setViewportMetrics(viewport, 1280);

  act(() => {
    notifyResize(content);
    notifyResize(content);
    flushAnimationFrames();
  });

  console.error = originalConsoleError;
  expect(getConsoleErrors(consoleErrors)).not.toContain("Maximum update depth exceeded");
  mounted.cleanup();
});

test("stays stable while reasoning, tool panels, and text all grow during streaming", () => {
  const consoleErrors: string[] = [];
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map((value) => String(value)).join(" "));
  };
  const mounted = mount(buildRichConversation(1));
  const viewport = mounted.container.querySelector(".conversation");
  const content = mounted.container.querySelector(".conversation__content");

  if (!(viewport instanceof HTMLDivElement) || !(content instanceof HTMLDivElement)) {
    throw new Error("Conversation test DOM did not render as expected.");
  }

  for (const step of [1, 2, 3, 4]) {
    act(() => {
      mounted.root.render(buildRichConversation(step));
    });
    setViewportMetrics(viewport, 700 + step * 180);
    act(() => {
      notifyResize(content);
      flushAnimationFrames();
    });
  }

  console.error = originalConsoleError;
  expect(getConsoleErrors(consoleErrors)).not.toContain("Maximum update depth exceeded");
  expect(mounted.container.textContent).toContain("Assistant update 4");
  mounted.cleanup();
});
