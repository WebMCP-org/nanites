import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, within } from "storybook/test";
import { useState } from "react";
import { Popover } from "../components/Popover";
import { Button } from "../components/Button";

const meta = {
  title: "Components/Popover",
  component: Popover.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Popover.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Popover.Root>
      <Popover.Trigger>Open Popover</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup>
            <Popover.Title>Popover Title</Popover.Title>
            <Popover.Description>
              This is a popover with some helpful information.
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Open Popover"));

    await expect(await screen.findByText("Popover Title")).toBeInTheDocument();
    await expect(
      screen.getByText("This is a popover with some helpful information."),
    ).toBeInTheDocument();
  },
};

export const WithArrow: Story = {
  render: () => (
    <Popover.Root>
      <Popover.Trigger>With Arrow</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={12}>
          <Popover.Popup>
            <Popover.Arrow />
            <Popover.Title>Arrow Popover</Popover.Title>
            <Popover.Description>
              This popover has an arrow pointing to the trigger.
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("With Arrow"));
    await expect(await screen.findByText("Arrow Popover")).toBeInTheDocument();
  },
};

export const WithCloseButton: Story = {
  render: () => (
    <Popover.Root>
      <Popover.Trigger>Click to Open</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup>
            <Popover.Title>Settings</Popover.Title>
            <Popover.Description>Configure your notification preferences here.</Popover.Description>
            <Popover.Close>Dismiss</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Click to Open"));

    await expect(await screen.findByText("Settings")).toBeInTheDocument();
    await expect(screen.getByText("Dismiss")).toBeInTheDocument();
  },
};

export const Positions: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
      <Popover.Root>
        <Popover.Trigger>Top</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" sideOffset={8}>
            <Popover.Popup>
              <Popover.Arrow />
              <Popover.Description>Positioned on top</Popover.Description>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <Popover.Root>
        <Popover.Trigger>Bottom</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" sideOffset={8}>
            <Popover.Popup>
              <Popover.Arrow />
              <Popover.Description>Positioned on bottom</Popover.Description>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <Popover.Root>
        <Popover.Trigger>Left</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="left" sideOffset={8}>
            <Popover.Popup>
              <Popover.Arrow />
              <Popover.Description>Positioned on left</Popover.Description>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <Popover.Root>
        <Popover.Trigger>Right</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="right" sideOffset={8}>
            <Popover.Popup>
              <Popover.Arrow />
              <Popover.Description>Positioned on right</Popover.Description>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  ),
};

export const Alignment: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "1rem" }}>
      <Popover.Root>
        <Popover.Trigger>Align Start</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={8}>
            <Popover.Popup>
              <Popover.Description>Aligned to start</Popover.Description>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <Popover.Root>
        <Popover.Trigger>Align Center</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="center" sideOffset={8}>
            <Popover.Popup>
              <Popover.Description>Aligned to center</Popover.Description>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <Popover.Root>
        <Popover.Trigger>Align End</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8}>
            <Popover.Popup>
              <Popover.Description>Aligned to end</Popover.Description>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  ),
};

export const Controlled: Story = {
  render: function Controlled() {
    const [open, setOpen] = useState(false);

    return (
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <Button color="neutral" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Open"} Externally
        </Button>

        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger>Controlled Popover</Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={8}>
              <Popover.Popup>
                <Popover.Title>Controlled State</Popover.Title>
                <Popover.Description>
                  This popover's state is controlled externally.
                </Popover.Description>
                <Popover.Close>Close</Popover.Close>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    );
  },
};

export const WithBackdrop: Story = {
  render: () => (
    <Popover.Root>
      <Popover.Trigger>Open with Backdrop</Popover.Trigger>
      <Popover.Portal>
        <Popover.Backdrop />
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup>
            <Popover.Title>Modal Popover</Popover.Title>
            <Popover.Description>
              This popover has a backdrop that dims the rest of the page.
            </Popover.Description>
            <Popover.Close>Dismiss</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Open with Backdrop"));
    await expect(await screen.findByText("Modal Popover")).toBeInTheDocument();
  },
};

export const WithCustomContent: Story = {
  render: () => (
    <Popover.Root>
      <Popover.Trigger>User Settings</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup>
            <Popover.Title>Quick Settings</Popover.Title>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                marginTop: "0.75rem",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                }}
              >
                <input type="checkbox" defaultChecked />
                Enable notifications
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                }}
              >
                <input type="checkbox" />
                Dark mode
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                }}
              >
                <input type="checkbox" defaultChecked />
                Auto-save
              </label>
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                marginTop: "1rem",
                justifyContent: "flex-end",
              }}
            >
              <Popover.Close>Cancel</Popover.Close>
              <Button color="primary" size="sm">
                Save
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ),
};

export const OpenOnHover: Story = {
  render: () => (
    <Popover.Root>
      <Popover.Trigger openOnHover delay={200}>
        Hover me
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup>
            <Popover.Arrow />
            <Popover.Title>Hover Popover</Popover.Title>
            <Popover.Description>
              This popover opens when you hover over the trigger.
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ),
};
