import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../components/Reasoning";

const meta = {
  title: "Components/Reasoning",
  component: Reasoning,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Reasoning>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_REASONING = `The user is asking about how to implement a collapsible reasoning block. Let me think about this step by step.

First, I need a wrapper that exposes open/defaultOpen state, matching the shape of other disclosure components. Then a trigger that shows either "Thinking..." while streaming or the elapsed time once done.

Finally, the content panel holds the reasoning text. A muted left border visually separates it from the rest of the response.`;

export const Default: Story = {
  render: () => (
    <div style={{ width: "32rem" }}>
      <Reasoning duration={4}>
        <ReasoningTrigger />
        <ReasoningContent>{SAMPLE_REASONING}</ReasoningContent>
      </Reasoning>
    </div>
  ),
};

export const DefaultOpen: Story = {
  render: () => (
    <div style={{ width: "32rem" }}>
      <Reasoning defaultOpen duration={2}>
        <ReasoningTrigger />
        <ReasoningContent>{SAMPLE_REASONING}</ReasoningContent>
      </Reasoning>
    </div>
  ),
};

export const Streaming: Story = {
  render: function Streaming() {
    const [isStreaming, setIsStreaming] = useState(true);
    const [text, setText] = useState("");

    useEffect(() => {
      if (!isStreaming) return;
      let i = 0;
      const interval = setInterval(() => {
        i += 2;
        setText(SAMPLE_REASONING.slice(0, i));
        if (i >= SAMPLE_REASONING.length) {
          clearInterval(interval);
          setIsStreaming(false);
        }
      }, 30);
      return () => clearInterval(interval);
    }, [isStreaming]);

    return (
      <div style={{ width: "32rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Reasoning isStreaming={isStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{text}</ReasoningContent>
        </Reasoning>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setText("");
            setIsStreaming(true);
          }}
          style={{ alignSelf: "flex-start" }}
        >
          Restart
        </Button>
      </div>
    );
  },
};
