import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CheckboxGroup } from "../components/CheckboxGroup";
import { Checkbox } from "../components/Checkbox";
import { Label } from "../components/Label";

const meta = {
  title: "Components/CheckboxGroup",
  component: CheckboxGroup,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CheckboxGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <CheckboxGroup defaultValue={["option1"]}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Checkbox name="option1" aria-label="Option 1" />
          <span>Option 1</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Checkbox name="option2" aria-label="Option 2" />
          <span>Option 2</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Checkbox name="option3" aria-label="Option 3" />
          <span>Option 3</span>
        </label>
      </div>
    </CheckboxGroup>
  ),
};

export const Controlled: Story = {
  render: function Controlled() {
    const [values, setValues] = useState<string[]>(["email"]);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <CheckboxGroup value={values} onValueChange={setValues}>
          <Label style={{ fontWeight: 600 }}>Notification Preferences</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Checkbox name="email" aria-label="Email notifications" />
              <span>Email notifications</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Checkbox name="sms" aria-label="SMS notifications" />
              <span>SMS notifications</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Checkbox name="push" aria-label="Push notifications" />
              <span>Push notifications</span>
            </label>
          </div>
        </CheckboxGroup>
        <div style={{ fontSize: "0.875rem", color: "hsl(var(--muted-foreground))" }}>
          Selected: {values.length > 0 ? values.join(", ") : "none"}
        </div>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <CheckboxGroup defaultValue={["option1"]} disabled>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Checkbox name="option1" aria-label="Option 1 (selected)" />
          <span>Option 1 (selected)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Checkbox name="option2" aria-label="Option 2" />
          <span>Option 2</span>
        </label>
      </div>
    </CheckboxGroup>
  ),
};

export const FormExample: Story = {
  render: function FormExample() {
    const [interests, setInterests] = useState<string[]>([]);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      alert(`Selected interests: ${interests.join(", ") || "none"}`);
    };

    return (
      <form onSubmit={handleSubmit} style={{ width: "300px" }}>
        <CheckboxGroup value={interests} onValueChange={setInterests}>
          <Label style={{ fontWeight: 600, marginBottom: "0.75rem", display: "block" }}>
            Select your interests
          </Label>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Checkbox name="technology" aria-label="Technology" />
              <span>Technology</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Checkbox name="design" aria-label="Design" />
              <span>Design</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Checkbox name="business" aria-label="Business" />
              <span>Business</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Checkbox name="science" aria-label="Science" />
              <span>Science</span>
            </label>
          </div>
        </CheckboxGroup>
        <button
          type="submit"
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
            border: "none",
            borderRadius: "var(--radius)",
            cursor: "pointer",
          }}
        >
          Submit
        </button>
      </form>
    );
  },
};
