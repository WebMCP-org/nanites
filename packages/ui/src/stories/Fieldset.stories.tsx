import type { Meta, StoryObj } from "@storybook/react";
import { Fieldset } from "../components/Fieldset";
import { Field } from "../components/Field";
import { Button } from "../components/Button";

const meta = {
  title: "Components/Fieldset",
  component: Fieldset.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Fieldset.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Fieldset.Root style={{ width: "320px" }}>
      <Fieldset.Legend>Personal Information</Fieldset.Legend>
      <Field.Root name="firstName">
        <Field.Label>First Name</Field.Label>
        <Field.Control placeholder="John" />
      </Field.Root>
      <Field.Root name="lastName">
        <Field.Label>Last Name</Field.Label>
        <Field.Control placeholder="Doe" />
      </Field.Root>
    </Fieldset.Root>
  ),
};

export const ContactDetails: Story = {
  render: () => (
    <Fieldset.Root style={{ width: "320px" }}>
      <Fieldset.Legend>Contact Details</Fieldset.Legend>
      <Field.Root name="email">
        <Field.Label>Email</Field.Label>
        <Field.Control type="email" placeholder="john@example.com" />
      </Field.Root>
      <Field.Root name="phone">
        <Field.Label>Phone</Field.Label>
        <Field.Control type="tel" placeholder="+1 (555) 000-0000" />
      </Field.Root>
      <Field.Root name="website">
        <Field.Label>Website</Field.Label>
        <Field.Control type="url" placeholder="https://example.com" />
        <Field.Description>Optional</Field.Description>
      </Field.Root>
    </Fieldset.Root>
  ),
};

export const BillingInformation: Story = {
  render: () => (
    <Fieldset.Root style={{ width: "360px" }}>
      <Fieldset.Legend>Billing Information</Fieldset.Legend>
      <Field.Root name="cardName">
        <Field.Label>Name on Card</Field.Label>
        <Field.Control placeholder="John Doe" required />
        <Field.Error match="valueMissing">Name is required</Field.Error>
      </Field.Root>
      <Field.Root name="cardNumber">
        <Field.Label>Card Number</Field.Label>
        <Field.Control placeholder="4242 4242 4242 4242" required />
        <Field.Error match="valueMissing">Card number is required</Field.Error>
      </Field.Root>
      <div style={{ display: "flex", gap: "1rem" }}>
        <Field.Root name="expiry" style={{ flex: 1 }}>
          <Field.Label>Expiry</Field.Label>
          <Field.Control placeholder="MM/YY" required />
        </Field.Root>
        <Field.Root name="cvc" style={{ flex: 1 }}>
          <Field.Label>CVC</Field.Label>
          <Field.Control placeholder="123" required />
        </Field.Root>
      </div>
    </Fieldset.Root>
  ),
};

export const MultipleFieldsets: Story = {
  render: () => (
    <form
      style={{
        width: "360px",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      <Fieldset.Root>
        <Fieldset.Legend>Account</Fieldset.Legend>
        <Field.Root name="username">
          <Field.Label>Username</Field.Label>
          <Field.Control placeholder="johndoe" required />
        </Field.Root>
        <Field.Root name="email">
          <Field.Label>Email</Field.Label>
          <Field.Control type="email" placeholder="john@example.com" required />
        </Field.Root>
      </Fieldset.Root>

      <Fieldset.Root>
        <Fieldset.Legend>Security</Fieldset.Legend>
        <Field.Root name="password">
          <Field.Label>Password</Field.Label>
          <Field.Control type="password" placeholder="Enter password" required />
        </Field.Root>
        <Field.Root name="confirmPassword">
          <Field.Label>Confirm Password</Field.Label>
          <Field.Control type="password" placeholder="Confirm password" required />
        </Field.Root>
      </Fieldset.Root>

      <Button type="submit" color="primary">
        Create Account
      </Button>
    </form>
  ),
};
