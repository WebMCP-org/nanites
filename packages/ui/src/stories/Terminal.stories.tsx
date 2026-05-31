import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import {
  Terminal,
  TerminalActions,
  TerminalClearButton,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from "../components/Terminal";

const meta = {
  title: "Components/Terminal",
  component: Terminal,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    output: "",
  },
} satisfies Meta<typeof Terminal>;

export default meta;
type Story = StoryObj<typeof meta>;

const STATIC_OUTPUT = `\u001b[32m✓\u001b[0m  src/components/Button.test.ts  (12 tests) 38ms
\u001b[32m✓\u001b[0m  src/components/Input.test.ts   (8 tests)  21ms
\u001b[31m✗\u001b[0m  src/components/Form.test.ts    (1 failed | 6 passed) 14ms
    \u001b[31mAssertionError: expected 'loading' to be 'idle'\u001b[0m
      at Form.test.ts:42:15

 Test Files  \u001b[31m1 failed\u001b[0m | \u001b[32m2 passed\u001b[0m (3)
      Tests  \u001b[31m1 failed\u001b[0m | \u001b[32m26 passed\u001b[0m (27)
   Duration  \u001b[33m73ms\u001b[0m`;

export const Default: Story = {
  args: {
    output: STATIC_OUTPUT,
  },
  render: (args) => (
    <div style={{ width: "36rem" }}>
      <Terminal {...args}>
        <TerminalHeader>
          <TerminalTitle>vitest.log</TerminalTitle>
          <TerminalStatus status="error" />
          <TerminalActions>
            <TerminalCopyButton />
          </TerminalActions>
        </TerminalHeader>
        <TerminalContent />
      </Terminal>
    </div>
  ),
};

export const Streaming: Story = {
  render: function Streaming() {
    const [output, setOutput] = useState("");
    const [isStreaming, setIsStreaming] = useState(true);

    useEffect(() => {
      if (!isStreaming) return;
      let i = 0;
      const lines = STATIC_OUTPUT.split("\n");
      const interval = setInterval(() => {
        if (i >= lines.length) {
          clearInterval(interval);
          setIsStreaming(false);
          return;
        }
        setOutput((prev) => prev + (prev ? "\n" : "") + lines[i]);
        i += 1;
      }, 300);
      return () => clearInterval(interval);
    }, [isStreaming]);

    return (
      <div style={{ width: "36rem" }}>
        <Terminal output={output} isStreaming={isStreaming} onClear={() => setOutput("")}>
          <TerminalHeader>
            <TerminalTitle>build.log</TerminalTitle>
            <TerminalStatus status={isStreaming ? "running" : "success"} />
            <TerminalActions>
              <TerminalCopyButton />
              <TerminalClearButton />
            </TerminalActions>
          </TerminalHeader>
          <TerminalContent />
        </Terminal>
      </div>
    );
  },
};
