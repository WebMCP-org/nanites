import { createRoot, type Root } from "react-dom/client";
import {
  NaniteLifecycleToolCard,
  type NaniteLifecycleOutcome,
} from "#/frontend/features/nanites/nanite-runtime-chat.tsx";
import { expect, page, test } from "../helpers/browser-test.ts";

function renderLifecycleCards(outcomes: readonly NaniteLifecycleOutcome[]) {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  root.render(
    <>
      {outcomes.map((outcome) => (
        <NaniteLifecycleToolCard key={outcome.title} outcome={outcome} />
      ))}
    </>,
  );

  return {
    cleanup: () => {
      root.unmount();
      document.body.innerHTML = "";
    },
  };
}

test("Nanite runtime chat renders custom lifecycle cards for all ending tools", async () => {
  const app = renderLifecycleCards([
    {
      title: "Work complete",
      statusLabel: "Complete",
      tone: "success",
      summary: "Created a docs PR.",
      outputUrl: "https://github.com/WebMCP-org/docs/pull/1",
      requestedScopes: [],
    },
    {
      title: "No change needed",
      statusLabel: "No change",
      tone: "neutral",
      summary: "Everything was already current.",
      outputUrl: null,
      requestedScopes: [],
    },
    {
      title: "Run failed",
      statusLabel: "Failed",
      tone: "danger",
      summary: "GitHub rejected the push.",
      outputUrl: null,
      requestedScopes: [],
    },
    {
      title: "Human decision needed",
      statusLabel: "Needs human",
      tone: "warning",
      summary: "Need approval for broader access.",
      outputUrl: null,
      requestedScopes: ["contents:write"],
    },
  ]);

  try {
    await page.getByText("Work complete").findElement();
    await page.getByText("No change needed").findElement();
    await page.getByText("Run failed").findElement();
    await page.getByText("Human decision needed").findElement();
    await page.getByRole("link", { name: "Open change proposal" }).findElement();
    await page.getByText("contents:write").findElement();

    await expect
      .poll(() => document.querySelectorAll('[data-testid="nanite-lifecycle-tool"]').length)
      .toBe(4);
  } finally {
    app.cleanup();
  }
});
