import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Toggle } from "../components/Toggle";

const meta = {
  title: "Components/Toggle",
  component: Toggle,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <Toggle>Toggle</Toggle>,
};

export const DefaultPressed: Story = {
  render: () => <Toggle defaultPressed>Enabled</Toggle>,
};

export const Controlled: Story = {
  render: function Controlled() {
    const [pressed, setPressed] = useState(false);

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
        <Toggle pressed={pressed} onPressedChange={setPressed}>
          {pressed ? "On" : "Off"}
        </Toggle>
        <span style={{ fontSize: "0.875rem", color: "hsl(var(--muted-foreground))" }}>
          Status: {pressed ? "Pressed" : "Not pressed"}
        </span>
      </div>
    );
  },
};

export const WithIcons: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <Toggle aria-label="Toggle bold">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
          <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
        </svg>
      </Toggle>

      <Toggle aria-label="Toggle italic">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="19" y1="4" x2="10" y2="4" />
          <line x1="14" y1="20" x2="5" y2="20" />
          <line x1="15" y1="4" x2="9" y2="20" />
        </svg>
      </Toggle>

      <Toggle aria-label="Toggle underline">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" />
          <line x1="4" y1="21" x2="20" y2="21" />
        </svg>
      </Toggle>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <Toggle disabled>Disabled</Toggle>
      <Toggle disabled defaultPressed>
        Disabled (Pressed)
      </Toggle>
    </div>
  ),
};

export const TextFormatting: Story = {
  render: function TextFormatting() {
    const [bold, setBold] = useState(false);
    const [italic, setItalic] = useState(false);
    const [underline, setUnderline] = useState(false);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          <Toggle pressed={bold} onPressedChange={setBold} aria-label="Bold">
            B
          </Toggle>
          <Toggle pressed={italic} onPressedChange={setItalic} aria-label="Italic">
            <em>I</em>
          </Toggle>
          <Toggle pressed={underline} onPressedChange={setUnderline} aria-label="Underline">
            <u>U</u>
          </Toggle>
        </div>
        <p
          style={{
            fontWeight: bold ? "bold" : "normal",
            fontStyle: italic ? "italic" : "normal",
            textDecoration: underline ? "underline" : "none",
            margin: 0,
          }}
        >
          Sample text with formatting
        </p>
      </div>
    );
  },
};

export const WithLabel: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <Toggle defaultPressed>Notifications</Toggle>
      <span style={{ fontSize: "0.875rem", color: "hsl(var(--muted-foreground))" }}>
        Receive email notifications
      </span>
    </div>
  ),
};
