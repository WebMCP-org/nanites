import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../components/Badge";

const meta: Meta<typeof Badge> = {
  title: "Components/Badge",
  component: Badge,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["normal", "outline"],
    },
    color: {
      control: "select",
      options: ["neutral", "primary", "success", "destructive", "warning"],
    },
    size: {
      control: "select",
      options: ["sm", "md"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    children: "Badge",
  },
};

export const Colors: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      <Badge color="primary">Primary</Badge>
      <Badge color="neutral">Neutral</Badge>
      <Badge color="success">Success</Badge>
      <Badge color="warning">Warning</Badge>
      <Badge color="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <Badge size="sm">Small</Badge>
      <Badge size="md">Medium</Badge>
    </div>
  ),
};

export const Outline: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      <Badge variant="outline" color="neutral">
        Neutral
      </Badge>
      <Badge variant="outline" color="primary">
        Primary
      </Badge>
      <Badge variant="outline" color="success">
        Success
      </Badge>
      <Badge variant="outline" color="warning">
        Warning
      </Badge>
      <Badge variant="outline" color="destructive">
        Destructive
      </Badge>
    </div>
  ),
};

export const PricingBadges: Story = {
  name: "Pricing Page Badges",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Badge color="success">Popular</Badge>
        <Badge color="primary">Best Value</Badge>
        <Badge color="warning">Limited Time</Badge>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Badge color="success" size="sm">
          Save 20%
        </Badge>
        <Badge color="neutral" size="sm">
          New
        </Badge>
        <Badge variant="outline" size="sm">
          Beta
        </Badge>
      </div>
    </div>
  ),
};

export const StatusBadges: Story = {
  name: "Status Indicators",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Badge color="success">Active</Badge>
        <span style={{ fontSize: "0.875rem", color: "var(--sigvelo-text-muted)" }}>
          Subscription is active
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Badge color="warning">Pending</Badge>
        <span style={{ fontSize: "0.875rem", color: "var(--sigvelo-text-muted)" }}>
          Payment processing
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Badge color="destructive">Expired</Badge>
        <span style={{ fontSize: "0.875rem", color: "var(--sigvelo-text-muted)" }}>
          Subscription ended
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Badge color="neutral">Trial</Badge>
        <span style={{ fontSize: "0.875rem", color: "var(--sigvelo-text-muted)" }}>
          14 days remaining
        </span>
      </div>
    </div>
  ),
};

export const InContext: Story = {
  name: "In Context",
  render: () => (
    <div
      style={{
        padding: "1.5rem",
        border: "1px solid var(--sigvelo-neutral-stroke-soft)",
        borderRadius: "var(--sigvelo-border-radius-md)",
        maxWidth: "300px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <h3 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Pro Plan</h3>
        <Badge color="success">Popular</Badge>
      </div>
      <p style={{ fontSize: "0.875rem", color: "var(--sigvelo-text-muted)", margin: 0 }}>
        Best for growing teams
      </p>
      <div style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "2rem", fontWeight: 700 }}>$29</span>
        <span style={{ fontSize: "0.875rem", color: "var(--sigvelo-text-muted)" }}>/month</span>
      </div>
    </div>
  ),
};
