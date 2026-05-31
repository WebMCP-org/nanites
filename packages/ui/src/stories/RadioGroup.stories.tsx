import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { RadioGroup, Radio, RadioIndicator } from "../components/RadioGroup";
import { Label } from "../components/Label";
import { Card } from "../components/Card";

const meta: Meta<typeof RadioGroup> = {
  title: "Components/RadioGroup",
  component: RadioGroup,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    orientation: {
      control: "select",
      options: ["vertical", "horizontal"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof RadioGroup>;

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="option1" aria-label="Select an option">
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Radio value="option1" aria-label="Option 1">
          <RadioIndicator />
        </Radio>
        <Label>Option 1</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Radio value="option2" aria-label="Option 2">
          <RadioIndicator />
        </Radio>
        <Label>Option 2</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Radio value="option3" aria-label="Option 3">
          <RadioIndicator />
        </Radio>
        <Label>Option 3</Label>
      </div>
    </RadioGroup>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <RadioGroup defaultValue="small" orientation="horizontal" aria-label="Select size">
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Radio value="small" aria-label="Small">
          <RadioIndicator />
        </Radio>
        <Label>Small</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Radio value="medium" aria-label="Medium">
          <RadioIndicator />
        </Radio>
        <Label>Medium</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Radio value="large" aria-label="Large">
          <RadioIndicator />
        </Radio>
        <Label>Large</Label>
      </div>
    </RadioGroup>
  ),
};

export const WithDisabled: Story = {
  render: () => (
    <RadioGroup defaultValue="option1" aria-label="Select an option">
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Radio value="option1" aria-label="Available option">
          <RadioIndicator />
        </Radio>
        <Label>Available option</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Radio value="option2" disabled aria-label="Disabled option">
          <RadioIndicator />
        </Radio>
        <Label data-disabled>Disabled option</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Radio value="option3" aria-label="Another available option">
          <RadioIndicator />
        </Radio>
        <Label>Another available option</Label>
      </div>
    </RadioGroup>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = React.useState("comfortable");
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <RadioGroup
          value={value}
          onValueChange={(v) => setValue(v as string)}
          aria-label="Select density"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Radio value="compact" aria-label="Compact">
              <RadioIndicator />
            </Radio>
            <Label>Compact</Label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Radio value="comfortable" aria-label="Comfortable">
              <RadioIndicator />
            </Radio>
            <Label>Comfortable</Label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Radio value="spacious" aria-label="Spacious">
              <RadioIndicator />
            </Radio>
            <Label>Spacious</Label>
          </div>
        </RadioGroup>
        <p style={{ fontSize: "0.875rem", color: "hsl(var(--muted-foreground))" }}>
          Selected: {value}
        </p>
      </div>
    );
  },
};

export const PlanSelection: Story = {
  name: "Plan Selection Cards",
  render: () => {
    const [plan, setPlan] = React.useState("pro");

    const plans = [
      {
        value: "starter",
        name: "Starter",
        price: "$9",
        description: "Perfect for individuals",
      },
      {
        value: "pro",
        name: "Pro",
        price: "$29",
        description: "Best for small teams",
        popular: true,
      },
      {
        value: "enterprise",
        name: "Enterprise",
        price: "$99",
        description: "For large organizations",
      },
    ];

    return (
      <RadioGroup
        value={plan}
        onValueChange={(v) => setPlan(v as string)}
        style={{ width: "320px" }}
        aria-label="Select a plan"
      >
        {plans.map((p) => (
          <label
            key={p.value}
            style={{
              display: "block",
              cursor: "pointer",
            }}
          >
            <Card
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.75rem",
                padding: "1rem",
                borderColor: plan === p.value ? "hsl(var(--primary))" : undefined,
                backgroundColor: plan === p.value ? "hsl(var(--primary) / 0.05)" : undefined,
              }}
            >
              <Radio value={p.value} style={{ marginTop: "0.125rem" }} aria-label={p.name}>
                <RadioIndicator />
              </Radio>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span
                    style={{
                      fontWeight: 600,
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    {p.name}
                  </span>
                  {p.popular && (
                    <span
                      style={{
                        fontSize: "0.625rem",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        padding: "0.125rem 0.375rem",
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                        borderRadius: "9999px",
                      }}
                    >
                      Popular
                    </span>
                  )}
                </div>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "hsl(var(--muted-foreground))",
                    margin: "0.25rem 0 0",
                  }}
                >
                  {p.description}
                </p>
              </div>
              <span
                style={{
                  fontWeight: 600,
                  fontSize: "1.125rem",
                  color: "hsl(var(--foreground))",
                }}
              >
                {p.price}
                <span
                  style={{
                    fontWeight: 400,
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  /mo
                </span>
              </span>
            </Card>
          </label>
        ))}
      </RadioGroup>
    );
  },
};
