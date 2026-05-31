import type { Meta, StoryObj } from "@storybook/react";
import { Meter } from "../components/Meter";

const meta = {
  title: "Components/Meter",
  component: Meter.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Meter.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { value: 60 },
  render: () => (
    <div style={{ width: "300px" }}>
      <Meter.Root value={60} aria-label="Progress meter">
        <Meter.Track>
          <Meter.Indicator />
        </Meter.Track>
      </Meter.Root>
    </div>
  ),
};

export const WithLabelAndValue: Story = {
  args: { value: 24 },
  render: () => (
    <div style={{ width: "300px" }}>
      <Meter.Root value={24}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
          }}
        >
          <Meter.Label>Storage Used</Meter.Label>
          <Meter.Value />
        </div>
        <Meter.Track>
          <Meter.Indicator />
        </Meter.Track>
      </Meter.Root>
    </div>
  ),
};

export const Percentage: Story = {
  args: { value: 0.75 },
  render: () => (
    <div style={{ width: "300px" }}>
      <Meter.Root value={0.75} min={0} max={1} format={{ style: "percent" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
          }}
        >
          <Meter.Label>Progress</Meter.Label>
          <Meter.Value />
        </div>
        <Meter.Track>
          <Meter.Indicator />
        </Meter.Track>
      </Meter.Root>
    </div>
  ),
};

export const StorageIndicator: Story = {
  args: { value: 78.5 },
  render: () => (
    <div style={{ width: "300px" }}>
      <Meter.Root value={78.5} max={100} getAriaValueText={(value) => `${value} GB of 100 GB used`}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
          }}
        >
          <Meter.Label>Storage</Meter.Label>
          <Meter.Value>{(_, value) => `${value} GB / 100 GB`}</Meter.Value>
        </div>
        <Meter.Track>
          <Meter.Indicator />
        </Meter.Track>
      </Meter.Root>
    </div>
  ),
};

export const BatteryLevel: Story = {
  args: { value: 35 },
  render: () => (
    <div style={{ width: "200px" }}>
      <Meter.Root value={35} max={100}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="1" y="6" width="18" height="12" rx="2" />
            <line x1="23" y1="10" x2="23" y2="14" />
          </svg>
          <Meter.Label>Battery</Meter.Label>
          <Meter.Value style={{ marginLeft: "auto" }} />
        </div>
        <Meter.Track>
          <Meter.Indicator
            style={{
              backgroundColor: "hsl(var(--warning))",
            }}
          />
        </Meter.Track>
      </Meter.Root>
    </div>
  ),
};

export const MultipleMeters: Story = {
  args: { value: 92 },
  render: () => (
    <div
      style={{
        width: "300px",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      <Meter.Root value={92}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
          }}
        >
          <Meter.Label>CPU Usage</Meter.Label>
          <Meter.Value />
        </div>
        <Meter.Track>
          <Meter.Indicator style={{ backgroundColor: "hsl(var(--destructive))" }} />
        </Meter.Track>
      </Meter.Root>

      <Meter.Root value={67}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
          }}
        >
          <Meter.Label>Memory</Meter.Label>
          <Meter.Value />
        </div>
        <Meter.Track>
          <Meter.Indicator style={{ backgroundColor: "hsl(var(--warning))" }} />
        </Meter.Track>
      </Meter.Root>

      <Meter.Root value={23}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "0.5rem",
          }}
        >
          <Meter.Label>Disk</Meter.Label>
          <Meter.Value />
        </div>
        <Meter.Track>
          <Meter.Indicator style={{ backgroundColor: "hsl(var(--success))" }} />
        </Meter.Track>
      </Meter.Root>
    </div>
  ),
};

export const SkillLevel: Story = {
  args: { value: 90 },
  render: () => {
    const skills = [
      { name: "React", level: 90 },
      { name: "TypeScript", level: 85 },
      { name: "CSS", level: 80 },
      { name: "Node.js", level: 70 },
      { name: "GraphQL", level: 60 },
    ];

    return (
      <div
        style={{
          width: "300px",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {skills.map((skill) => (
          <Meter.Root key={skill.name} value={skill.level}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "0.25rem",
                fontSize: "0.875rem",
              }}
            >
              <Meter.Label>{skill.name}</Meter.Label>
              <Meter.Value />
            </div>
            <Meter.Track style={{ height: "0.375rem" }}>
              <Meter.Indicator />
            </Meter.Track>
          </Meter.Root>
        ))}
      </div>
    );
  },
};
