import type { Meta, StoryObj } from "@storybook/react";
import { Label } from "../components/Label";
import { Input } from "../components/Input";

const meta = {
  title: "Components/Label",
  component: Label,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    htmlFor: {
      control: "text",
      description: "ID of the associated form element",
    },
  },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Label Text",
  },
  argTypes: {
    htmlFor: {
      table: {
        disable: true,
      },
    },
  },
};

export const WithInput: Story = {
  args: {
    htmlFor: "email",
  },
  render: (args) => (
    <div style={{ width: "300px" }}>
      <Label {...args}>Email Address</Label>
      <Input type="email" id="email" placeholder="you@example.com" />
    </div>
  ),
};

export const FormExample: Story = {
  argTypes: {
    htmlFor: {
      table: {
        disable: true,
      },
    },
  },
  render: () => (
    <div style={{ width: "300px", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <Label htmlFor="name">Full Name</Label>
        <Input type="text" id="name" placeholder="John Doe" />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input type="email" id="email" placeholder="john@example.com" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input type="password" id="password" placeholder="Enter password" />
      </div>
    </div>
  ),
};

export const Disabled: Story = {
  argTypes: {
    htmlFor: {
      table: {
        disable: true,
      },
    },
  },
  render: () => (
    <div style={{ width: "300px" }}>
      <Label htmlFor="disabled-input" data-disabled>
        Disabled Field
      </Label>
      <Input type="text" id="disabled-input" placeholder="Cannot edit" disabled />
    </div>
  ),
};
