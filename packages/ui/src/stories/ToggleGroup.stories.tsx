import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";

const meta: Meta<typeof ToggleGroup> = {
  title: "Components/ToggleGroup",
  component: ToggleGroup,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof ToggleGroup>;

export const Default: Story = {
  render: () => (
    <ToggleGroup defaultValue={["center"]}>
      <ToggleGroupItem value="left">Left</ToggleGroupItem>
      <ToggleGroupItem value="center">Center</ToggleGroupItem>
      <ToggleGroupItem value="right">Right</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "flex-start" }}
    >
      <ToggleGroup size="sm" defaultValue={["monthly"]}>
        <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
        <ToggleGroupItem value="yearly">Yearly</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup size="md" defaultValue={["monthly"]}>
        <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
        <ToggleGroupItem value="yearly">Yearly</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup size="lg" defaultValue={["monthly"]}>
        <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
        <ToggleGroupItem value="yearly">Yearly</ToggleGroupItem>
      </ToggleGroup>
    </div>
  ),
};

export const MultipleSelection: Story = {
  name: "Multiple Selection",
  render: () => (
    <ToggleGroup multiple defaultValue={["bold"]}>
      <ToggleGroupItem value="bold">
        <strong>B</strong>
      </ToggleGroupItem>
      <ToggleGroupItem value="italic">
        <em>I</em>
      </ToggleGroupItem>
      <ToggleGroupItem value="underline">
        <u>U</u>
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const BillingPeriod: Story = {
  name: "Billing Period Selector",
  render: () => {
    const [period, setPeriod] = React.useState<string[]>(["monthly"]);
    const prices = {
      monthly: { starter: 9, pro: 29, enterprise: 99 },
      yearly: { starter: 7, pro: 23, enterprise: 79 },
    };

    const currentPeriod = (period[0] as "monthly" | "yearly") || "monthly";

    return (
      <div
        style={{ display: "flex", flexDirection: "column", gap: "1.5rem", alignItems: "center" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <ToggleGroup value={period} onValueChange={(v) => v.length > 0 && setPeriod(v)}>
            <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
            <ToggleGroupItem value="yearly">
              Yearly
              <span
                style={{
                  marginLeft: "0.375rem",
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  padding: "0.125rem 0.375rem",
                  backgroundColor: "hsl(var(--success))",
                  color: "hsl(var(--success-foreground))",
                  borderRadius: "9999px",
                }}
              >
                -20%
              </span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div style={{ display: "flex", gap: "1rem" }}>
          {(["starter", "pro", "enterprise"] as const).map((plan) => (
            <div
              key={plan}
              style={{
                padding: "1rem",
                textAlign: "center",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                minWidth: "100px",
              }}
            >
              <div
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  textTransform: "capitalize",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                {plan}
              </div>
              <div
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: "hsl(var(--foreground))",
                  marginTop: "0.25rem",
                }}
              >
                ${prices[currentPeriod][plan]}
                <span
                  style={{
                    fontSize: "0.875rem",
                    fontWeight: 400,
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  /mo
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

export const WithDisabled: Story = {
  render: () => (
    <ToggleGroup defaultValue={["option1"]}>
      <ToggleGroupItem value="option1">Option 1</ToggleGroupItem>
      <ToggleGroupItem value="option2" disabled>
        Option 2
      </ToggleGroupItem>
      <ToggleGroupItem value="option3">Option 3</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = React.useState<string[]>(["grid"]);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
        <ToggleGroup value={value} onValueChange={(v) => v.length > 0 && setValue(v)}>
          <ToggleGroupItem value="list" aria-label="List view">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="1" y="2" width="14" height="2" rx="0.5" />
              <rect x="1" y="7" width="14" height="2" rx="0.5" />
              <rect x="1" y="12" width="14" height="2" rx="0.5" />
            </svg>
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="1" y="1" width="6" height="6" rx="1" />
              <rect x="9" y="1" width="6" height="6" rx="1" />
              <rect x="1" y="9" width="6" height="6" rx="1" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
            </svg>
          </ToggleGroupItem>
        </ToggleGroup>
        <p style={{ fontSize: "0.875rem", color: "hsl(var(--muted-foreground))" }}>
          View: {value[0]}
        </p>
      </div>
    );
  },
};
