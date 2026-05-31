import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Switch, SwitchThumb } from "../components/Switch";
import { Label } from "../components/Label";

const meta: Meta<typeof Switch> = {
  title: "Components/Switch",
  component: Switch,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    disabled: {
      control: "boolean",
    },
    defaultChecked: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {
  render: (args) => (
    <Switch {...args} aria-label="Toggle switch">
      <SwitchThumb />
    </Switch>
  ),
};

export const Checked: Story = {
  render: (args) => (
    <Switch {...args} defaultChecked aria-label="Toggle switch">
      <SwitchThumb />
    </Switch>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Switch size="sm" defaultChecked aria-label="Small switch">
          <SwitchThumb />
        </Switch>
        <Label>Small</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Switch size="md" defaultChecked aria-label="Medium switch">
          <SwitchThumb />
        </Switch>
        <Label>Medium</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Switch size="lg" defaultChecked aria-label="Large switch">
          <SwitchThumb />
        </Switch>
        <Label>Large</Label>
      </div>
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <Switch id="notifications" aria-label="Enable notifications">
        <SwitchThumb />
      </Switch>
      <Label htmlFor="notifications">Enable notifications</Label>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <Switch disabled aria-label="Disabled switch off">
          <SwitchThumb />
        </Switch>
        <Label data-disabled>Disabled off</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <Switch disabled defaultChecked aria-label="Disabled switch on">
          <SwitchThumb />
        </Switch>
        <Label data-disabled>Disabled on</Label>
      </div>
    </div>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = React.useState(false);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Switch checked={checked} onCheckedChange={setChecked} aria-label="Airplane mode">
            <SwitchThumb />
          </Switch>
          <Label>Airplane mode</Label>
        </div>
        <p style={{ fontSize: "0.875rem", color: "hsl(var(--muted-foreground))" }}>
          Status: {checked ? "On" : "Off"}
        </p>
      </div>
    );
  },
};

export const BillingToggle: Story = {
  name: "Billing Period Toggle",
  render: () => {
    const [yearly, setYearly] = React.useState(false);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: yearly ? 400 : 600,
            color: yearly ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
          }}
        >
          Monthly
        </span>
        <Switch checked={yearly} onCheckedChange={setYearly} aria-label="Toggle billing period">
          <SwitchThumb />
        </Switch>
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: yearly ? 600 : 400,
            color: yearly ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
          }}
        >
          Yearly
          <span
            style={{
              marginLeft: "0.5rem",
              fontSize: "0.75rem",
              color: "hsl(var(--primary))",
              fontWeight: 500,
            }}
          >
            Save 20%
          </span>
        </span>
      </div>
    );
  },
};
