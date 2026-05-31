import type { Meta, StoryObj } from "@storybook/react";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../components/Tool";

const meta = {
  title: "Components/Tool",
  component: Tool,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    state: "output-available",
  },
  argTypes: {
    state: {
      control: "select",
      options: [
        "input-streaming",
        "input-available",
        "approval-requested",
        "approval-responded",
        "output-available",
        "output-error",
        "output-denied",
      ],
    },
  },
} satisfies Meta<typeof Tool>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_INPUT = {
  query: "latest news on AI regulations",
  max_results: 5,
  locale: "en-US",
};

const SAMPLE_OUTPUT = [
  { title: "EU AI Act enters force", url: "https://example.com/eu-ai" },
  { title: "US federal AI guidance", url: "https://example.com/us-ai" },
];

export const Default: Story = {
  render: (args) => (
    <div style={{ width: "32rem" }}>
      <Tool {...args}>
        <ToolHeader type="function" toolName="search_web" />
        <ToolContent>
          <ToolInput input={SAMPLE_INPUT} />
          <ToolOutput
            output={
              <pre style={{ margin: 0, fontSize: "0.75rem", whiteSpace: "pre-wrap" }}>
                {JSON.stringify(SAMPLE_OUTPUT, null, 2)}
              </pre>
            }
          />
        </ToolContent>
      </Tool>
    </div>
  ),
};

export const InputStreaming: Story = {
  args: { state: "input-streaming", defaultOpen: true },
  render: (args) => (
    <div style={{ width: "32rem" }}>
      <Tool {...args}>
        <ToolHeader type="function" toolName="search_web" />
        <ToolContent>
          <ToolInput input={{ query: "latest news on AI regu" }} />
        </ToolContent>
      </Tool>
    </div>
  ),
};

export const InputReady: Story = {
  args: { state: "input-available" },
  render: (args) => (
    <div style={{ width: "32rem" }}>
      <Tool {...args}>
        <ToolHeader type="function" toolName="fetch_weather" />
        <ToolContent>
          <ToolInput input={{ city: "Tokyo", unit: "celsius" }} />
        </ToolContent>
      </Tool>
    </div>
  ),
};

export const AwaitingApproval: Story = {
  args: { state: "approval-requested" },
  render: (args) => (
    <div style={{ width: "32rem" }}>
      <Tool {...args}>
        <ToolHeader type="function" toolName="delete_file" title="Remove temp cache" />
        <ToolContent>
          <ToolInput input={{ path: "/tmp/cache", recursive: true }} />
        </ToolContent>
      </Tool>
    </div>
  ),
};

export const ApprovalResponded: Story = {
  args: { state: "approval-responded" },
  render: (args) => (
    <div style={{ width: "32rem" }}>
      <Tool {...args}>
        <ToolHeader type="function" toolName="delete_file" title="Remove temp cache" />
        <ToolContent>
          <ToolInput input={{ path: "/tmp/cache", recursive: true }} />
        </ToolContent>
      </Tool>
    </div>
  ),
};

export const OutputDenied: Story = {
  args: { state: "output-denied" },
  render: (args) => (
    <div style={{ width: "32rem" }}>
      <Tool {...args}>
        <ToolHeader type="function" toolName="delete_file" title="Remove temp cache" />
        <ToolContent>
          <ToolInput input={{ path: "/tmp/cache", recursive: true }} />
          <ToolOutput errorText="Tool invocation was denied by the user." />
        </ToolContent>
      </Tool>
    </div>
  ),
};

export const OutputError: Story = {
  args: { state: "output-error" },
  render: (args) => (
    <div style={{ width: "32rem" }}>
      <Tool {...args}>
        <ToolHeader type="function" toolName="read_file" title="Read project config" />
        <ToolContent>
          <ToolInput input={{ path: "/etc/shadow" }} />
          <ToolOutput errorText="EACCES: permission denied, open '/etc/shadow'" />
        </ToolContent>
      </Tool>
    </div>
  ),
};
