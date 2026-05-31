import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Collapsible } from "../components/Collapsible";

const meta = {
  title: "Components/Collapsible",
  component: Collapsible.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Collapsible.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Collapsible.Root style={{ width: "320px" }}>
      <Collapsible.Trigger>Show more information</Collapsible.Trigger>
      <Collapsible.Panel>
        <div>
          This is the hidden content that appears when you click the trigger. It can contain any
          content you want.
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  ),
};

export const DefaultOpen: Story = {
  render: () => (
    <Collapsible.Root defaultOpen style={{ width: "320px" }}>
      <Collapsible.Trigger>Collapse this section</Collapsible.Trigger>
      <Collapsible.Panel>
        <div>This content is visible by default. Click the trigger to hide it.</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  ),
};

export const Controlled: Story = {
  render: function Controlled() {
    const [open, setOpen] = useState(false);

    return (
      <div style={{ width: "320px" }}>
        <div style={{ marginBottom: "1rem" }}>
          <button onClick={() => setOpen(!open)}>{open ? "Close" : "Open"} externally</button>
        </div>
        <Collapsible.Root open={open} onOpenChange={setOpen}>
          <Collapsible.Trigger>{open ? "Hide" : "Show"} details</Collapsible.Trigger>
          <Collapsible.Panel>
            <div>
              This collapsible is controlled externally. You can toggle it using either the button
              above or the trigger.
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
      </div>
    );
  },
};

export const WithList: Story = {
  render: () => (
    <Collapsible.Root style={{ width: "320px" }}>
      <Collapsible.Trigger>Recovery keys</Collapsible.Trigger>
      <Collapsible.Panel>
        <div>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li>alien-bean-pasta</li>
            <li>wild-irish-burrito</li>
            <li>horse-battery-staple</li>
            <li>correct-horse-battery</li>
          </ul>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  ),
};

export const Multiple: Story = {
  render: () => (
    <div style={{ width: "320px", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <Collapsible.Root>
        <Collapsible.Trigger>Section 1</Collapsible.Trigger>
        <Collapsible.Panel>
          <div>Content for section 1. Each collapsible works independently.</div>
        </Collapsible.Panel>
      </Collapsible.Root>

      <Collapsible.Root>
        <Collapsible.Trigger>Section 2</Collapsible.Trigger>
        <Collapsible.Panel>
          <div>Content for section 2. Multiple sections can be open at once.</div>
        </Collapsible.Panel>
      </Collapsible.Root>

      <Collapsible.Root>
        <Collapsible.Trigger>Section 3</Collapsible.Trigger>
        <Collapsible.Panel>
          <div>
            Content for section 3. Unlike accordion, collapsibles don't close other sections.
          </div>
        </Collapsible.Panel>
      </Collapsible.Root>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Collapsible.Root disabled style={{ width: "320px" }}>
      <Collapsible.Trigger>Disabled collapsible</Collapsible.Trigger>
      <Collapsible.Panel>
        <div>You can't see this content because the collapsible is disabled.</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  ),
};

export const NestedContent: Story = {
  render: () => (
    <Collapsible.Root style={{ width: "360px" }}>
      <Collapsible.Trigger>Project details</Collapsible.Trigger>
      <Collapsible.Panel>
        <div>
          <h4 style={{ margin: "0 0 0.75rem" }}>Overview</h4>
          <p style={{ margin: "0 0 0.75rem", color: "hsl(var(--muted-foreground))" }}>
            This project contains various components and utilities for building modern user
            interfaces.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.5rem",
              fontSize: "0.875rem",
            }}
          >
            <div>
              <strong>Status:</strong> Active
            </div>
            <div>
              <strong>Version:</strong> 1.0.0
            </div>
            <div>
              <strong>License:</strong> Apache-2.0
            </div>
            <div>
              <strong>Stars:</strong> 1,234
            </div>
          </div>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  ),
};
