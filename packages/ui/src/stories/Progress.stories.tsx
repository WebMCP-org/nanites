import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Progress, ProgressTrack, ProgressIndicator } from "../components/Progress";
import { Label } from "../components/Label";

const meta: Meta<typeof Progress> = {
  title: "Components/Progress",
  component: Progress,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    color: {
      control: "select",
      options: ["primary", "success", "warning", "destructive"],
    },
    value: {
      control: { type: "range", min: 0, max: 100, step: 1 },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Progress>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "300px" }}>
      <Progress value={60} aria-label="Progress indicator">
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
    </div>
  ),
};

export const WithLabel: Story = {
  render: () => (
    <div style={{ width: "300px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <Label id="progress-label">Progress</Label>
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            color: "var(--sigvelo-text-muted)",
          }}
        >
          60%
        </span>
      </div>
      <Progress value={60} aria-labelledby="progress-label">
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
    </div>
  ),
};

export const Colors: Story = {
  render: () => (
    <div style={{ width: "300px", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <Label id="default-progress-label">Default</Label>
          <span style={{ fontSize: "0.75rem", color: "var(--sigvelo-text-muted)" }}>45%</span>
        </div>
        <Progress value={45} aria-labelledby="default-progress-label">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <Label id="success-progress-label">Success</Label>
          <span style={{ fontSize: "0.75rem", color: "var(--sigvelo-text-muted)" }}>100%</span>
        </div>
        <Progress value={100} color="success" aria-labelledby="success-progress-label">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <Label id="warning-progress-label">Warning</Label>
          <span style={{ fontSize: "0.75rem", color: "var(--sigvelo-text-muted)" }}>78%</span>
        </div>
        <Progress value={78} color="warning" aria-labelledby="warning-progress-label">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <Label id="destructive-progress-label">Destructive</Label>
          <span style={{ fontSize: "0.75rem", color: "var(--sigvelo-text-muted)" }}>92%</span>
        </div>
        <Progress value={92} color="destructive" aria-labelledby="destructive-progress-label">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>
    </div>
  ),
};

export const Indeterminate: Story = {
  render: () => (
    <div style={{ width: "300px" }}>
      <Label id="loading-label" style={{ display: "block", marginBottom: "0.5rem" }}>
        Loading...
      </Label>
      <Progress value={null} aria-labelledby="loading-label">
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
    </div>
  ),
};

export const Animated: Story = {
  render: () => {
    const [progress, setProgress] = React.useState(0);

    React.useEffect(() => {
      const timer = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) return 0;
          return prev + 5;
        });
      }, 300);
      return () => clearInterval(timer);
    }, []);

    return (
      <div style={{ width: "300px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <Label id="upload-label">Uploading...</Label>
          <span
            style={{
              fontSize: "0.875rem",
              fontWeight: 500,
              fontVariantNumeric: "tabular-nums",
              color: "var(--sigvelo-text-muted)",
            }}
          >
            {progress}%
          </span>
        </div>
        <Progress value={progress} aria-labelledby="upload-label">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>
    );
  },
};

function getColor(percentage: number) {
  if (percentage >= 90) return "destructive" as const;
  if (percentage >= 75) return "warning" as const;
  return "primary" as const;
}

export const UsageLimits: Story = {
  name: "Feature Usage Limits",
  render: () => {
    const usageData = [
      { label: "API Calls", used: 8500, limit: 10000, unit: "calls" },
      { label: "Storage", used: 4.2, limit: 5, unit: "GB" },
      { label: "Team Members", used: 3, limit: 5, unit: "members" },
      { label: "Projects", used: 9, limit: 10, unit: "projects" },
    ];

    return (
      <div
        style={{
          width: "350px",
          padding: "1.5rem",
          border: "1px solid var(--sigvelo-neutral-stroke-soft)",
          borderRadius: "var(--sigvelo-border-radius-md)",
          backgroundColor: "var(--sigvelo-paper-color)",
        }}
      >
        <h3
          style={{
            fontSize: "1rem",
            fontWeight: 600,
            marginBottom: "1.25rem",
            color: "var(--sigvelo-text-body)",
          }}
        >
          Usage This Month
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {usageData.map((item) => {
            const percentage = (item.used / item.limit) * 100;
            return (
              <div key={item.label}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "0.375rem",
                  }}
                >
                  <Label style={{ fontSize: "0.8125rem" }}>{item.label}</Label>
                  <span
                    style={{
                      fontSize: "0.8125rem",
                      fontVariantNumeric: "tabular-nums",
                      color:
                        percentage >= 90
                          ? "var(--sigvelo-destructive-text-colorful)"
                          : "var(--sigvelo-text-muted)",
                    }}
                  >
                    {item.used.toLocaleString()} / {item.limit.toLocaleString()} {item.unit}
                  </span>
                </div>
                <Progress
                  value={percentage}
                  color={getColor(percentage)}
                  aria-label={`${item.label} usage: ${item.used} of ${item.limit} ${item.unit}`}
                >
                  <ProgressTrack>
                    <ProgressIndicator />
                  </ProgressTrack>
                </Progress>
              </div>
            );
          })}
        </div>
        <p
          style={{
            marginTop: "1.25rem",
            fontSize: "0.75rem",
            color: "var(--sigvelo-text-muted)",
          }}
        >
          Resets in 12 days
        </p>
      </div>
    );
  },
};
