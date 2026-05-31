import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Toolbar } from "../components/Toolbar";

const meta = {
  title: "Components/Toolbar",
  component: Toolbar.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Toolbar.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Toolbar.Root>
      <Toolbar.Button>Button 1</Toolbar.Button>
      <Toolbar.Button>Button 2</Toolbar.Button>
      <Toolbar.Separator />
      <Toolbar.Button>Button 3</Toolbar.Button>
    </Toolbar.Root>
  ),
};

export const TextFormatting: Story = {
  render: function TextFormatting() {
    const [bold, setBold] = useState(false);
    const [italic, setItalic] = useState(false);
    const [underline, setUnderline] = useState(false);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Toolbar.Root aria-label="Text formatting">
          <Toolbar.Group>
            <Toolbar.Button
              aria-label="Bold"
              aria-pressed={bold}
              onClick={() => setBold(!bold)}
              style={{
                fontWeight: bold ? "bold" : "normal",
                backgroundColor: bold ? "hsl(var(--accent))" : undefined,
              }}
            >
              B
            </Toolbar.Button>
            <Toolbar.Button
              aria-label="Italic"
              aria-pressed={italic}
              onClick={() => setItalic(!italic)}
              style={{
                fontStyle: italic ? "italic" : "normal",
                backgroundColor: italic ? "hsl(var(--accent))" : undefined,
              }}
            >
              I
            </Toolbar.Button>
            <Toolbar.Button
              aria-label="Underline"
              aria-pressed={underline}
              onClick={() => setUnderline(!underline)}
              style={{
                textDecoration: underline ? "underline" : "none",
                backgroundColor: underline ? "hsl(var(--accent))" : undefined,
              }}
            >
              U
            </Toolbar.Button>
          </Toolbar.Group>
          <Toolbar.Separator />
          <Toolbar.Group>
            <Toolbar.Button aria-label="Align left">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <line x1="17" y1="10" x2="3" y2="10" />
                <line x1="21" y1="6" x2="3" y2="6" />
                <line x1="21" y1="14" x2="3" y2="14" />
                <line x1="17" y1="18" x2="3" y2="18" />
              </svg>
            </Toolbar.Button>
            <Toolbar.Button aria-label="Align center">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <line x1="18" y1="10" x2="6" y2="10" />
                <line x1="21" y1="6" x2="3" y2="6" />
                <line x1="21" y1="14" x2="3" y2="14" />
                <line x1="18" y1="18" x2="6" y2="18" />
              </svg>
            </Toolbar.Button>
            <Toolbar.Button aria-label="Align right">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <line x1="21" y1="10" x2="7" y2="10" />
                <line x1="21" y1="6" x2="3" y2="6" />
                <line x1="21" y1="14" x2="3" y2="14" />
                <line x1="21" y1="18" x2="7" y2="18" />
              </svg>
            </Toolbar.Button>
          </Toolbar.Group>
        </Toolbar.Root>
        <p
          style={{
            fontWeight: bold ? "bold" : "normal",
            fontStyle: italic ? "italic" : "normal",
            textDecoration: underline ? "underline" : "none",
            padding: "1rem",
            border: "1px solid hsl(var(--border))",
            borderRadius: "var(--radius)",
            margin: 0,
          }}
        >
          Sample text to format
        </p>
      </div>
    );
  },
};

export const WithIcons: Story = {
  render: () => (
    <Toolbar.Root>
      <Toolbar.Button aria-label="Undo">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
        </svg>
      </Toolbar.Button>
      <Toolbar.Button aria-label="Redo">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7" />
        </svg>
      </Toolbar.Button>
      <Toolbar.Separator />
      <Toolbar.Button aria-label="Cut">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <line x1="20" y1="4" x2="8.12" y2="15.88" />
          <line x1="14.47" y1="14.48" x2="20" y2="20" />
          <line x1="8.12" y1="8.12" x2="12" y2="12" />
        </svg>
      </Toolbar.Button>
      <Toolbar.Button aria-label="Copy">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      </Toolbar.Button>
      <Toolbar.Button aria-label="Paste">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" />
        </svg>
      </Toolbar.Button>
    </Toolbar.Root>
  ),
};

export const Vertical: Story = {
  render: () => (
    <Toolbar.Root orientation="vertical" aria-label="Drawing tools">
      <Toolbar.Button aria-label="Selection tool">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <path d="M2 2l7.586 7.586" />
        </svg>
      </Toolbar.Button>
      <Toolbar.Button aria-label="Draw rectangle">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      </Toolbar.Button>
      <Toolbar.Button aria-label="Draw circle">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
        </svg>
      </Toolbar.Button>
      <Toolbar.Separator />
      <Toolbar.Button aria-label="Draw line">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </Toolbar.Button>
    </Toolbar.Root>
  ),
};

export const WithLinks: Story = {
  render: () => (
    <Toolbar.Root>
      <Toolbar.Link href="#home">Home</Toolbar.Link>
      <Toolbar.Link href="#about">About</Toolbar.Link>
      <Toolbar.Link href="#contact">Contact</Toolbar.Link>
      <Toolbar.Separator />
      <Toolbar.Button>Settings</Toolbar.Button>
    </Toolbar.Root>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Toolbar.Root disabled>
      <Toolbar.Button>Button 1</Toolbar.Button>
      <Toolbar.Button>Button 2</Toolbar.Button>
      <Toolbar.Separator />
      <Toolbar.Button>Button 3</Toolbar.Button>
    </Toolbar.Root>
  ),
};
