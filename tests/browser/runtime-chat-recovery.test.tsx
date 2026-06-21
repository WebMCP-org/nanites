import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "ai";
import { afterEach } from "vite-plus/test";
import { RuntimeConversation } from "#/frontend/routes/_authenticated/nanites/-runtime-chat.tsx";
import { expect, test } from "../helpers/browser-test.ts";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function buttonByLabel(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function submitPrompt(text: string): void {
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) throw new Error("Expected runtime prompt textarea to render.");
  textarea.value = text;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    }),
  );
}

function clickButton(label: string): void {
  const button = buttonByLabel(label);
  if (!button) throw new Error(`Expected ${label} button to render.`);
  button.click();
}

function renderConversation(props: Parameters<typeof RuntimeConversation>[0]) {
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }

  flushSync(() => {
    root?.render(<RuntimeConversation {...props} />);
  });
}

afterEach(() => {
  flushSync(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

test("runtime conversation stays busy while recovering", () => {
  const submittedMessages: string[] = [];
  let clearCount = 0;
  let regenerateCount = 0;
  let stopCount = 0;
  const messages = [
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "I am checking the current run." }],
    },
  ] as UIMessage[];

  renderConversation({
    agentMessages: messages,
    isRecovering: true,
    isStreaming: false,
    onClearConversation: () => {
      clearCount += 1;
    },
    onRegenerate: () => {
      regenerateCount += 1;
    },
    onStop: () => {
      stopCount += 1;
    },
    onSubmit: (text) => {
      submittedMessages.push(text);
    },
  });

  expect(buttonByLabel("Send message")).toBeNull();
  expect(buttonByLabel("Stop response")).not.toBeNull();
  expect(buttonByLabel("Reset chat")?.disabled).toBe(true);
  expect(buttonByLabel("Regenerate response")).toBeNull();

  submitPrompt("please continue");
  clickButton("Stop response");

  expect(submittedMessages).toEqual([]);
  expect(clearCount).toBe(0);
  expect(regenerateCount).toBe(0);
  expect(stopCount).toBe(1);

  renderConversation({
    agentMessages: messages,
    isRecovering: false,
    isStreaming: false,
    onClearConversation: () => {
      clearCount += 1;
    },
    onRegenerate: () => {
      regenerateCount += 1;
    },
    onStop: () => {
      stopCount += 1;
    },
    onSubmit: (text) => {
      submittedMessages.push(text);
    },
  });

  expect(buttonByLabel("Send message")).not.toBeNull();
  expect(buttonByLabel("Stop response")).toBeNull();
  expect(buttonByLabel("Reset chat")?.disabled).toBe(false);
  expect(buttonByLabel("Regenerate response")).not.toBeNull();

  submitPrompt("please continue");
  clickButton("Regenerate response");
  clickButton("Reset chat");

  expect(submittedMessages).toEqual(["please continue"]);
  expect(clearCount).toBe(1);
  expect(regenerateCount).toBe(1);
  expect(stopCount).toBe(1);
});
