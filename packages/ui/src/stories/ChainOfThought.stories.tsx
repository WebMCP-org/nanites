import type { Meta, StoryObj } from "@storybook/react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "../components/ChainOfThought";

const meta = {
  title: "Components/ChainOfThought",
  component: ChainOfThought,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ChainOfThought>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "36rem" }}>
      <ChainOfThought defaultOpen>
        <ChainOfThoughtHeader>Thinking</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep
            status="complete"
            label="Parse request"
            description="The user is asking for a summary of the latest AI regulations."
          />
          <ChainOfThoughtStep
            status="complete"
            label="Search the web"
            description="Found 3 relevant pages."
          >
            <ChainOfThoughtSearchResults>
              <ChainOfThoughtSearchResult
                title="EU AI Act — Official Journal"
                href="https://example.com/eu-ai"
              />
              <ChainOfThoughtSearchResult
                title="NIST AI Risk Management Framework"
                href="https://example.com/nist"
              />
              <ChainOfThoughtSearchResult
                title="White House Executive Order on AI"
                href="https://example.com/eo"
              />
            </ChainOfThoughtSearchResults>
          </ChainOfThoughtStep>
          <ChainOfThoughtStep status="active" label="Drafting response" />
          <ChainOfThoughtStep status="pending" label="Formatting final answer" />
        </ChainOfThoughtContent>
      </ChainOfThought>
    </div>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <div style={{ width: "36rem" }}>
      <ChainOfThought>
        <ChainOfThoughtHeader>Thought for 8s</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep status="complete" label="Analyzed the problem" />
          <ChainOfThoughtStep status="complete" label="Generated the fix" />
        </ChainOfThoughtContent>
      </ChainOfThought>
    </div>
  ),
};

export const AllPending: Story = {
  render: () => (
    <div style={{ width: "36rem" }}>
      <ChainOfThought defaultOpen>
        <ChainOfThoughtHeader>Planning</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep status="pending" label="Gather inputs" />
          <ChainOfThoughtStep status="pending" label="Design solution" />
          <ChainOfThoughtStep status="pending" label="Write tests" />
          <ChainOfThoughtStep status="pending" label="Implement" />
        </ChainOfThoughtContent>
      </ChainOfThought>
    </div>
  ),
};
