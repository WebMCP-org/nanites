// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vite-plus/test";
import { Tool, ToolContent, ToolHeader, ToolInput } from "./Tool.js";

test("renders tool input inside a code block", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);

  act(() => {
    root.render(
      <Tool state="input-available" open>
        <ToolHeader type="function" toolName="browser_eval" />
        <ToolContent>
          <ToolInput input={{ path: "/tmp/file.txt", recursive: false }} />
        </ToolContent>
      </Tool>,
    );
  });

  const codeBlock = container.querySelector(".tool__code-block");
  const codeText = container.querySelector(".tool__code-block code")?.textContent ?? "";

  expect(codeBlock).not.toBeNull();
  expect(codeText).toContain('"path": "/tmp/file.txt"');
  expect(codeText).toContain('"recursive": false');

  act(() => {
    root.unmount();
  });
  container.remove();
});

test("renders multiline string input with real line breaks", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);
  const script = ["async ({ page }) => {", "  return page.url();", "}"].join("\n");

  act(() => {
    root.render(
      <Tool state="input-available" open>
        <ToolHeader type="function" toolName="browser_eval" />
        <ToolContent>
          <ToolInput input={{ script }} />
        </ToolContent>
      </Tool>,
    );
  });

  const codeText = container.querySelector(".tool__code-block code")?.textContent ?? "";

  expect(codeText).toContain(script);
  expect(codeText).not.toContain("\\n");

  act(() => {
    root.unmount();
  });
  container.remove();
});
