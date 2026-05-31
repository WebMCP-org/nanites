import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, within } from "storybook/test";
import { ContextMenu } from "../components/ContextMenu";

const meta = {
  title: "Components/ContextMenu",
  component: ContextMenu.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ContextMenu.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <div
          style={{
            padding: "3rem 4rem",
            border: "2px dashed hsl(var(--border))",
            borderRadius: "var(--radius)",
            textAlign: "center",
            color: "hsl(var(--muted-foreground))",
            fontSize: "0.875rem",
          }}
        >
          Right-click here
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            <ContextMenu.Item onClick={() => console.log("Cut")}>Cut</ContextMenu.Item>
            <ContextMenu.Item onClick={() => console.log("Copy")}>Copy</ContextMenu.Item>
            <ContextMenu.Item onClick={() => console.log("Paste")}>Paste</ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => console.log("Delete")}>Delete</ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByText("Right-click here");
    await userEvent.pointer({ keys: "[MouseRight]", target: trigger });

    await expect(await screen.findByText("Cut")).toBeInTheDocument();
    await expect(screen.getByText("Copy")).toBeInTheDocument();
    await expect(screen.getByText("Paste")).toBeInTheDocument();
    await expect(screen.getByText("Delete")).toBeInTheDocument();
  },
};

export const FileActions: Story = {
  render: () => (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "1rem",
            border: "1px solid hsl(var(--border))",
            borderRadius: "var(--radius)",
            cursor: "context-menu",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
          <div>
            <div style={{ fontWeight: 500 }}>document.pdf</div>
            <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))" }}>2.4 MB</div>
          </div>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            <ContextMenu.Item onClick={() => console.log("Open")}>Open</ContextMenu.Item>
            <ContextMenu.Item onClick={() => console.log("Open with...")}>
              Open with...
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => console.log("Download")}>Download</ContextMenu.Item>
            <ContextMenu.Item onClick={() => console.log("Share")}>Share</ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => console.log("Rename")}>Rename</ContextMenu.Item>
            <ContextMenu.Item onClick={() => console.log("Move to trash")}>
              Move to trash
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByText("document.pdf");
    await userEvent.pointer({ keys: "[MouseRight]", target: trigger });

    await expect(await screen.findByText("Open")).toBeInTheDocument();
    await expect(screen.getByText("Download")).toBeInTheDocument();
  },
};

export const WithDisabledItems: Story = {
  render: () => (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <div
          style={{
            padding: "3rem 4rem",
            border: "2px dashed hsl(var(--border))",
            borderRadius: "var(--radius)",
            textAlign: "center",
            color: "hsl(var(--muted-foreground))",
            fontSize: "0.875rem",
          }}
        >
          Right-click here
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            <ContextMenu.Item>Undo</ContextMenu.Item>
            <ContextMenu.Item disabled>Redo (nothing to redo)</ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item>Cut</ContextMenu.Item>
            <ContextMenu.Item>Copy</ContextMenu.Item>
            <ContextMenu.Item disabled>Paste (clipboard empty)</ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  ),
};

export const ImageContext: Story = {
  render: () => (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <img
          src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&h=200&fit=crop"
          alt="Mountain landscape"
          style={{
            borderRadius: "var(--radius)",
            display: "block",
          }}
        />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            <ContextMenu.Item onClick={() => console.log("View full size")}>
              View full size
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => console.log("Save image")}>
              Save image as...
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => console.log("Copy image")}>
              Copy image
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => console.log("Set as wallpaper")}>
              Set as wallpaper
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  ),
};
