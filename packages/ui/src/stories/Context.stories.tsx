import type { Meta, StoryObj } from "@storybook/react";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from "../components/Context";

const meta = {
  title: "Components/Context",
  component: Context,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    usedTokens: 42_300,
    maxTokens: 200_000,
  },
} satisfies Meta<typeof Context>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    usedTokens: 42_300,
    maxTokens: 200_000,
    modelId: "claude-opus-4-6",
    usage: {
      input: 30_000,
      output: 11_000,
      reasoning: 1_300,
    },
    totalCostUsd: 0.42,
  },
  render: (args) => (
    <Context {...args}>
      <ContextTrigger />
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody />
        <ContextContentFooter />
      </ContextContent>
    </Context>
  ),
};

export const NearlyFull: Story = {
  args: {
    usedTokens: 190_000,
    maxTokens: 200_000,
    modelId: "claude-opus-4-6",
    usage: {
      input: 180_000,
      output: 9_000,
      reasoning: 1_000,
    },
    totalCostUsd: 2.1,
  },
  render: (args) => (
    <Context {...args}>
      <ContextTrigger />
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody />
        <ContextContentFooter />
      </ContextContent>
    </Context>
  ),
};
