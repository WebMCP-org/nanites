import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { Source, Sources, SourcesContent, SourcesTrigger } from "../components/Sources";

const meta = {
  title: "Components/Sources",
  component: Sources,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Sources>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "28rem" }}>
      <Sources>
        <SourcesTrigger count={3} />
        <SourcesContent>
          <Source
            href="https://developer.mozilla.org/en-US/docs/Web/API/fetch"
            title="Using the Fetch API"
            description="An interface for fetching resources across the network."
          />
          <Source
            href="https://react.dev/reference/react/useEffect"
            title="useEffect – React"
            description="Lets you synchronize a component with an external system."
          />
          <Source
            href="https://base-ui.com/react/components/collapsible"
            title="Collapsible – Base UI"
            description="Accessible disclosure component with smooth height transitions."
          />
        </SourcesContent>
      </Sources>
    </div>
  ),
};

export const DefaultOpen: Story = {
  render: () => (
    <div style={{ width: "28rem" }}>
      <Sources defaultOpen>
        <SourcesTrigger count={2} />
        <SourcesContent>
          <Source
            href="https://www.w3.org/TR/wai-aria-practices-1.2/#disclosure"
            title="WAI-ARIA Authoring Practices: Disclosure"
          />
          <Source
            href="https://www.w3.org/TR/wai-aria-1.2/"
            title="Accessible Rich Internet Applications (WAI-ARIA) 1.2"
          />
        </SourcesContent>
      </Sources>
    </div>
  ),
};

export const SingleSource: Story = {
  render: () => (
    <div style={{ width: "28rem" }}>
      <Sources>
        <SourcesTrigger count={1} />
        <SourcesContent>
          <Source
            href="https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)"
            title="Transformer (deep learning architecture)"
            description="A deep learning model introduced in 2017 that adopts the mechanism of self-attention."
          />
        </SourcesContent>
      </Sources>
    </div>
  ),
};

export const Interactive: Story = {
  render: () => (
    <div style={{ width: "28rem" }}>
      <Sources>
        <SourcesTrigger count={2}>Used 2 sources</SourcesTrigger>
        <SourcesContent>
          <Source href="https://example.com/a" title="Example A" />
          <Source href="https://example.com/b" title="Example B" />
        </SourcesContent>
      </Sources>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /used 2 sources/i });
    await userEvent.click(trigger);
    await expect(canvas.getByText("Example A")).toBeVisible();
  },
};
