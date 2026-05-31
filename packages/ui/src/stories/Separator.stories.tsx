import type { Meta, StoryObj } from "@storybook/react";
import { Separator } from "../components/Separator";
import { Card } from "../components/Card";
import { Button } from "../components/Button";

const meta = {
  title: "Components/Separator",
  component: Separator,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    orientation: {
      table: {
        disable: true,
      },
    },
  },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  args: {
    orientation: "horizontal",
  },
  render: (args) => (
    <div style={{ width: "300px" }}>
      <p style={{ margin: "0 0 1rem 0" }}>Content above separator</p>
      <Separator {...args} />
      <p style={{ margin: "1rem 0 0 0" }}>Content below separator</p>
    </div>
  ),
};

export const Vertical: Story = {
  args: {
    orientation: "vertical",
  },
  render: (args) => (
    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
      <span>Left content</span>
      <Separator {...args} style={{ height: "24px" }} />
      <span>Right content</span>
    </div>
  ),
};

export const InCard: Story = {
  args: {
    orientation: "horizontal",
  },
  render: (args) => (
    <Card style={{ width: "350px" }}>
      <h3 style={{ marginTop: 0 }}>Card Title</h3>
      <p style={{ marginBottom: "1rem", color: "var(--text-secondary)" }}>
        This is some content above the separator.
      </p>
      <Separator {...args} style={{ marginBottom: "1rem" }} />
      <p style={{ margin: 0, color: "var(--text-secondary)" }}>
        This is content below the separator.
      </p>
    </Card>
  ),
};

export const BetweenSections: Story = {
  args: {
    orientation: "horizontal",
  },
  render: (args) => (
    <Card style={{ width: "400px" }}>
      <div>
        <h3 style={{ marginTop: 0 }}>Map Statistics</h3>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
          }}
        >
          <span style={{ color: "var(--text-secondary)" }}>Total Features:</span>
          <strong>247</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-secondary)" }}>Collaborators:</span>
          <strong>5</strong>
        </div>
      </div>

      <Separator {...args} style={{ margin: "1.5rem 0" }} />

      <div>
        <h3 style={{ marginTop: 0 }}>Recent Activity</h3>
        <p
          style={{
            margin: 0,
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
          }}
        >
          Last edited 2 hours ago by Sarah
        </p>
      </div>
    </Card>
  ),
};

export const VerticalNavigation: Story = {
  args: {
    orientation: "vertical",
  },
  render: (args) => (
    <Card>
      <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
        <Button variant="ghost" size="sm">
          Dashboard
        </Button>
        <Separator {...args} style={{ height: "24px" }} />
        <Button variant="ghost" size="sm">
          Maps
        </Button>
        <Separator {...args} style={{ height: "24px" }} />
        <Button variant="ghost" size="sm">
          Settings
        </Button>
      </div>
    </Card>
  ),
};

export const FormSections: Story = {
  args: {
    orientation: "horizontal",
  },
  render: (args) => (
    <Card style={{ width: "400px" }}>
      <div>
        <h3 style={{ marginTop: 0, marginBottom: "1rem" }}>Basic Information</h3>
        <div style={{ marginBottom: "0.75rem" }}>
          <label
            style={{
              display: "block",
              marginBottom: "0.25rem",
              fontSize: "0.875rem",
            }}
          >
            Project Name
          </label>
          <input
            type="text"
            placeholder="My Map Project"
            style={{
              width: "100%",
              padding: "0.5rem",
              border: "1px solid var(--border-color)",
              borderRadius: "0.375rem",
              backgroundColor: "var(--bg-primary)",
              color: "var(--text-primary)",
            }}
          />
        </div>
        <div>
          <label
            style={{
              display: "block",
              marginBottom: "0.25rem",
              fontSize: "0.875rem",
            }}
          >
            Description
          </label>
          <textarea
            placeholder="Enter description..."
            rows={3}
            style={{
              width: "100%",
              padding: "0.5rem",
              border: "1px solid var(--border-color)",
              borderRadius: "0.375rem",
              backgroundColor: "var(--bg-primary)",
              color: "var(--text-primary)",
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
        </div>
      </div>

      <Separator {...args} style={{ margin: "1.5rem 0" }} />

      <div>
        <h3 style={{ marginTop: 0, marginBottom: "1rem" }}>Advanced Settings</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" id="public" />
          <label htmlFor="public" style={{ fontSize: "0.875rem" }}>
            Make this map public
          </label>
        </div>
      </div>

      <Separator {...args} style={{ margin: "1.5rem 0" }} />

      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
        <Button variant="ghost" size="sm">
          Cancel
        </Button>
        <Button color="primary" size="sm">
          Create Map
        </Button>
      </div>
    </Card>
  ),
};

export const ListItems: Story = {
  args: {
    orientation: "horizontal",
  },
  render: (args) => (
    <Card style={{ width: "350px", padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "1rem 1.5rem" }}>
        <h4 style={{ margin: "0 0 0.25rem 0" }}>Urban Planning Project</h4>
        <p
          style={{
            margin: 0,
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
          }}
        >
          42 features • 3 collaborators
        </p>
      </div>

      <Separator {...args} />

      <div style={{ padding: "1rem 1.5rem" }}>
        <h4 style={{ margin: "0 0 0.25rem 0" }}>Wildlife Conservation Areas</h4>
        <p
          style={{
            margin: 0,
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
          }}
        >
          18 features • 2 collaborators
        </p>
      </div>

      <Separator {...args} />

      <div style={{ padding: "1rem 1.5rem" }}>
        <h4 style={{ margin: "0 0 0.25rem 0" }}>Delivery Route Optimization</h4>
        <p
          style={{
            margin: 0,
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
          }}
        >
          67 features • 5 collaborators
        </p>
      </div>
    </Card>
  ),
};

export const WithCustomStyles: Story = {
  args: {
    orientation: "horizontal",
  },
  render: (args) => (
    <div style={{ width: "300px" }}>
      <h4 style={{ marginTop: 0 }}>Custom Separator Styles</h4>

      <p
        style={{
          margin: "1rem 0 0.5rem 0",
          fontSize: "0.875rem",
          color: "var(--text-secondary)",
        }}
      >
        Default separator:
      </p>
      <Separator {...args} />

      <p
        style={{
          margin: "1rem 0 0.5rem 0",
          fontSize: "0.875rem",
          color: "var(--text-secondary)",
        }}
      >
        Thicker separator:
      </p>
      <Separator {...args} style={{ height: "2px" }} />

      <p
        style={{
          margin: "1rem 0 0.5rem 0",
          fontSize: "0.875rem",
          color: "var(--text-secondary)",
        }}
      >
        Accent color separator:
      </p>
      <Separator {...args} style={{ backgroundColor: "var(--accent)" }} />

      <p
        style={{
          margin: "1rem 0 0.5rem 0",
          fontSize: "0.875rem",
          color: "var(--text-secondary)",
        }}
      >
        With margin:
      </p>
      <Separator {...args} style={{ margin: "1.5rem 0" }} />
    </div>
  ),
};
