import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, within } from "storybook/test";
import { Menubar } from "../components/Menubar";

const meta = {
  title: "Components/Menubar",
  component: Menubar.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Menubar.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Menubar.Root>
      <Menubar.Menu>
        <Menubar.Trigger>File</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Positioner sideOffset={4}>
            <Menubar.Popup>
              <Menubar.Item onClick={() => console.log("New")}>
                New
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl+N
                </span>
              </Menubar.Item>
              <Menubar.Item onClick={() => console.log("Open")}>
                Open
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl+O
                </span>
              </Menubar.Item>
              <Menubar.Item onClick={() => console.log("Save")}>
                Save
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl+S
                </span>
              </Menubar.Item>
              <Menubar.Separator />
              <Menubar.Item onClick={() => console.log("Exit")}>Exit</Menubar.Item>
            </Menubar.Popup>
          </Menubar.Positioner>
        </Menubar.Portal>
      </Menubar.Menu>
      <Menubar.Menu>
        <Menubar.Trigger>Edit</Menubar.Trigger>

        <Menubar.Portal>
          <Menubar.Positioner sideOffset={4}>
            <Menubar.Popup>
              <Menubar.Item onClick={() => console.log("Undo")}>
                Undo
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl+Z
                </span>
              </Menubar.Item>
              <Menubar.Item onClick={() => console.log("Redo")}>
                Redo
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl+Y
                </span>
              </Menubar.Item>
              <Menubar.Separator />
              <Menubar.Item onClick={() => console.log("Cut")}>
                Cut
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl+X
                </span>
              </Menubar.Item>
              <Menubar.Item onClick={() => console.log("Copy")}>
                Copy
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl+C
                </span>
              </Menubar.Item>
              <Menubar.Item onClick={() => console.log("Paste")}>
                Paste
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl+V
                </span>
              </Menubar.Item>
            </Menubar.Popup>
          </Menubar.Positioner>
        </Menubar.Portal>
      </Menubar.Menu>
      <Menubar.Menu>
        <Menubar.Trigger>View</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Positioner sideOffset={4}>
            <Menubar.Popup>
              <Menubar.Item onClick={() => console.log("Zoom In")}>
                Zoom In
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl++
                </span>
              </Menubar.Item>
              <Menubar.Item onClick={() => console.log("Zoom Out")}>
                Zoom Out
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  Ctrl+-
                </span>
              </Menubar.Item>
              <Menubar.Separator />
              <Menubar.Item onClick={() => console.log("Full Screen")}>
                Full Screen
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "0.75rem" }}>
                  F11
                </span>
              </Menubar.Item>
            </Menubar.Popup>
          </Menubar.Positioner>
        </Menubar.Portal>
      </Menubar.Menu>
      <Menubar.Menu>
        <Menubar.Trigger>Help</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Positioner sideOffset={4}>
            <Menubar.Popup>
              <Menubar.Item onClick={() => console.log("Documentation")}>
                Documentation
              </Menubar.Item>
              <Menubar.Item onClick={() => console.log("Report Issue")}>Report Issue</Menubar.Item>
              <Menubar.Separator />
              <Menubar.Item onClick={() => console.log("About")}>About</Menubar.Item>
            </Menubar.Popup>
          </Menubar.Positioner>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("File"));

    await expect(await screen.findByText("Exit")).toBeInTheDocument();
  },
};

export const TextEditor: Story = {
  render: () => (
    <div style={{ width: "100%", maxWidth: "600px" }}>
      <Menubar.Root>
        <Menubar.Menu>
          <Menubar.Trigger>Format</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Positioner sideOffset={4}>
              <Menubar.Popup>
                <Menubar.Group>
                  <Menubar.GroupLabel>Text Style</Menubar.GroupLabel>
                  <Menubar.Item>Bold</Menubar.Item>
                  <Menubar.Item>Italic</Menubar.Item>
                  <Menubar.Item>Underline</Menubar.Item>
                  <Menubar.Item>Strikethrough</Menubar.Item>
                </Menubar.Group>
                <Menubar.Separator />
                <Menubar.Group>
                  <Menubar.GroupLabel>Alignment</Menubar.GroupLabel>
                  <Menubar.Item>Align Left</Menubar.Item>
                  <Menubar.Item>Align Center</Menubar.Item>
                  <Menubar.Item>Align Right</Menubar.Item>
                  <Menubar.Item>Justify</Menubar.Item>
                </Menubar.Group>
              </Menubar.Popup>
            </Menubar.Positioner>
          </Menubar.Portal>
        </Menubar.Menu>
        <Menubar.Menu>
          <Menubar.Trigger>Insert</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Positioner sideOffset={4}>
              <Menubar.Popup>
                <Menubar.Item>Image</Menubar.Item>
                <Menubar.Item>Table</Menubar.Item>
                <Menubar.Item>Link</Menubar.Item>
                <Menubar.Separator />
                <Menubar.Item>Horizontal Rule</Menubar.Item>
                <Menubar.Item>Page Break</Menubar.Item>
              </Menubar.Popup>
            </Menubar.Positioner>
          </Menubar.Portal>
        </Menubar.Menu>
        <Menubar.Menu>
          <Menubar.Trigger>Tools</Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Positioner sideOffset={4}>
              <Menubar.Popup>
                <Menubar.Item>Spell Check</Menubar.Item>
                <Menubar.Item>Word Count</Menubar.Item>
                <Menubar.Separator />
                <Menubar.Item>Find and Replace</Menubar.Item>
              </Menubar.Popup>
            </Menubar.Positioner>
          </Menubar.Portal>
        </Menubar.Menu>
      </Menubar.Root>
      <div
        style={{
          marginTop: "1rem",
          padding: "1rem",
          border: "1px solid hsl(var(--border))",
          borderRadius: "var(--radius)",
          minHeight: "200px",
        }}
      >
        <p style={{ margin: 0, color: "hsl(var(--muted-foreground))" }}>Start typing here...</p>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Format"));

    await expect(await screen.findByText("Text Style")).toBeInTheDocument();
    await expect(screen.getByText("Bold")).toBeInTheDocument();
  },
};

export const WithDisabledItems: Story = {
  render: () => (
    <Menubar.Root>
      <Menubar.Menu>
        <Menubar.Trigger>File</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Positioner sideOffset={4}>
            <Menubar.Popup>
              <Menubar.Item>New</Menubar.Item>
              <Menubar.Item>Open</Menubar.Item>
              <Menubar.Item disabled>Save (no changes)</Menubar.Item>
              <Menubar.Separator />
              <Menubar.Item>Close</Menubar.Item>
            </Menubar.Popup>
          </Menubar.Positioner>
        </Menubar.Portal>
      </Menubar.Menu>
      <Menubar.Menu>
        <Menubar.Trigger>Edit</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Positioner sideOffset={4}>
            <Menubar.Popup>
              <Menubar.Item disabled>Undo (nothing to undo)</Menubar.Item>
              <Menubar.Item disabled>Redo (nothing to redo)</Menubar.Item>
              <Menubar.Separator />
              <Menubar.Item>Select All</Menubar.Item>
            </Menubar.Popup>
          </Menubar.Positioner>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
  ),
};
