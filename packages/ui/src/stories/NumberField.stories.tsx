import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { NumberField } from "../components/NumberField";
import { Label } from "../components/Label";

const meta = {
  title: "Components/NumberField",
  component: NumberField.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof NumberField.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "180px" }}>
      <NumberField.Root defaultValue={0}>
        <NumberField.Group>
          <NumberField.Decrement aria-label="Decrease value">-</NumberField.Decrement>
          <NumberField.Input aria-label="Number input" />
          <NumberField.Increment aria-label="Increase value">+</NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <div style={{ width: "180px" }}>
      <Label id="quantity-label" style={{ marginBottom: "0.375rem", display: "block" }}>
        Quantity
      </Label>
      <NumberField.Root defaultValue={1} min={1}>
        <NumberField.Group>
          <NumberField.Decrement aria-label="Decrease quantity">-</NumberField.Decrement>
          <NumberField.Input aria-labelledby="quantity-label" />
          <NumberField.Increment aria-label="Increase quantity">+</NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </div>
  ),
};

export const WithMinMax: Story = {
  render: () => (
    <div style={{ width: "180px" }}>
      <Label id="rating-label" style={{ marginBottom: "0.375rem", display: "block" }}>
        Rating (1-10)
      </Label>
      <NumberField.Root defaultValue={5} min={1} max={10}>
        <NumberField.Group>
          <NumberField.Decrement aria-label="Decrease rating">-</NumberField.Decrement>
          <NumberField.Input aria-labelledby="rating-label" />
          <NumberField.Increment aria-label="Increase rating">+</NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </div>
  ),
};

export const WithStep: Story = {
  render: () => (
    <div style={{ width: "180px" }}>
      <Label id="price-label" style={{ marginBottom: "0.375rem", display: "block" }}>
        Price ($)
      </Label>
      <NumberField.Root defaultValue={10} step={0.5} min={0}>
        <NumberField.Group>
          <NumberField.Decrement aria-label="Decrease price">-</NumberField.Decrement>
          <NumberField.Input aria-labelledby="price-label" />
          <NumberField.Increment aria-label="Increase price">+</NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </div>
  ),
};

export const Controlled: Story = {
  render: function Controlled() {
    const [value, setValue] = useState<number | null>(50);

    return (
      <div style={{ width: "180px" }}>
        <Label id="percentage-label" style={{ marginBottom: "0.375rem", display: "block" }}>
          Percentage: {value}%
        </Label>
        <NumberField.Root value={value} onValueChange={setValue} min={0} max={100}>
          <NumberField.Group>
            <NumberField.Decrement aria-label="Decrease percentage">-</NumberField.Decrement>
            <NumberField.Input aria-labelledby="percentage-label" />
            <NumberField.Increment aria-label="Increase percentage">+</NumberField.Increment>
          </NumberField.Group>
        </NumberField.Root>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div style={{ width: "180px" }}>
      <NumberField.Root defaultValue={42} disabled>
        <NumberField.Group>
          <NumberField.Decrement aria-label="Decrease value">-</NumberField.Decrement>
          <NumberField.Input aria-label="Disabled number field" />
          <NumberField.Increment aria-label="Increase value">+</NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </div>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <div style={{ width: "180px" }}>
      <NumberField.Root defaultValue={0}>
        <NumberField.Group>
          <NumberField.Decrement aria-label="Decrease value">
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
          </NumberField.Decrement>
          <NumberField.Input aria-label="Number with icons" />
          <NumberField.Increment aria-label="Increase value">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </div>
  ),
};

export const CurrencyFormatting: Story = {
  render: () => (
    <div style={{ width: "200px" }}>
      <Label id="amount-label" style={{ marginBottom: "0.375rem", display: "block" }}>
        Amount
      </Label>
      <NumberField.Root
        defaultValue={99.99}
        step={0.01}
        min={0}
        format={{ style: "currency", currency: "USD" }}
      >
        <NumberField.Group>
          <NumberField.Decrement aria-label="Decrease amount">-</NumberField.Decrement>
          <NumberField.Input aria-labelledby="amount-label" />
          <NumberField.Increment aria-label="Increase amount">+</NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </div>
  ),
};

export const LargeStep: Story = {
  render: () => (
    <div style={{ width: "180px" }}>
      <Label id="large-step-label" style={{ marginBottom: "0.375rem", display: "block" }}>
        Hold Shift for +10
      </Label>
      <NumberField.Root defaultValue={0} step={1} largeStep={10}>
        <NumberField.Group>
          <NumberField.Decrement aria-label="Decrease value">-</NumberField.Decrement>
          <NumberField.Input aria-labelledby="large-step-label" />
          <NumberField.Increment aria-label="Increase value">+</NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </div>
  ),
};
