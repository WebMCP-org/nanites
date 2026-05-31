import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  type PromptInputStatus,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../components/PromptInput";
import { LinkIcon, SearchIcon, TerminalIcon } from "../components/_internal/icons";

const meta = {
  title: "Components/PromptInput",
  component: PromptInput,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PromptInput>;

export default meta;
type Story = StoryObj<typeof meta>;

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: "min(40rem, 90vw)" }}>{children}</div>
);

export const Default: Story = {
  render: function DefaultStory() {
    const [last, setLast] = useState("");
    return (
      <Frame>
        <PromptInput
          onSubmit={(message) => {
            setLast(message.text);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder="Ask anything..." />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit />
          </PromptInputFooter>
        </PromptInput>
        {last ? (
          <p
            style={{
              marginBlockStart: "0.75rem",
              fontSize: "0.8125rem",
              color: "var(--sigvelo-text-muted)",
            }}
          >
            Submitted: {last}
          </p>
        ) : null}
      </Frame>
    );
  },
};

export const WithTools: Story = {
  render: function WithToolsStory() {
    const [webSearch, setWebSearch] = useState(false);
    return (
      <Frame>
        <PromptInput onSubmit={() => undefined}>
          <PromptInputBody>
            <PromptInputTextarea placeholder="Plan, search, build anything" />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputButton
                tooltip={{ content: "Search the web", shortcut: "⌘K" }}
                onClick={() => setWebSearch((v) => !v)}
                aria-pressed={webSearch}
                color={webSearch ? "primary" : "neutral"}
                variant={webSearch ? "normal" : "ghost"}
              >
                <SearchIcon />
                <span>Search</span>
              </PromptInputButton>
              <PromptInputButton tooltip="Attach a link">
                <LinkIcon />
              </PromptInputButton>
              <PromptInputButton tooltip={{ content: "Open terminal", side: "bottom" }}>
                <TerminalIcon />
              </PromptInputButton>
            </PromptInputTools>
            <PromptInputSubmit />
          </PromptInputFooter>
        </PromptInput>
      </Frame>
    );
  },
};

export const WithHeader: Story = {
  render: () => (
    <Frame>
      <PromptInput onSubmit={() => undefined}>
        <PromptInputHeader>
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--sigvelo-text-muted)",
              fontWeight: "var(--sigvelo-font-weight-semibold)",
            }}
          >
            Context: 2 tabs
          </span>
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Describe your task..." />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputButton tooltip="Search">
              <SearchIcon />
            </PromptInputButton>
          </PromptInputTools>
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>
    </Frame>
  ),
};

export const SubmitStates: Story = {
  render: function SubmitStatesStory() {
    const [status, setStatus] = useState<PromptInputStatus>("ready");

    return (
      <Frame>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
            {(["ready", "submitted", "streaming", "error"] as PromptInputStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                style={{
                  padding: "0.25rem 0.625rem",
                  borderRadius: "var(--sigvelo-border-radius-sm)",
                  border:
                    "var(--sigvelo-border-style) var(--sigvelo-border-width) var(--sigvelo-neutral-stroke-softer)",
                  background:
                    status === s
                      ? "var(--sigvelo-primary-fill)"
                      : "var(--sigvelo-neutral-fill-softer)",
                  color:
                    status === s
                      ? "var(--sigvelo-primary-fill-contrast)"
                      : "var(--sigvelo-text-body)",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <PromptInput
            onSubmit={(message: PromptInputMessage) => {
              if (!message.text.trim()) return;
              setStatus("submitted");
              setTimeout(() => setStatus("streaming"), 200);
              setTimeout(() => setStatus("ready"), 1500);
            }}
          >
            <PromptInputBody>
              <PromptInputTextarea placeholder="Type a message..." />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit status={status} onStop={() => setStatus("ready")} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </Frame>
    );
  },
};
