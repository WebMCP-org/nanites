import type { Meta, StoryObj } from "@storybook/react";
import { Tabs, TabsList, Tab, TabPanel } from "../components/Tabs";
import { Card } from "../components/Card";
import { useState } from "react";

const meta = {
  title: "Components/Tabs",
  component: Tabs,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="tab1" style={{ width: "400px" }}>
      <TabsList>
        <Tab value="tab1">Tab 1</Tab>
        <Tab value="tab2">Tab 2</Tab>
        <Tab value="tab3">Tab 3</Tab>
      </TabsList>

      <TabPanel value="tab1">
        <p>Content for Tab 1</p>
      </TabPanel>
      <TabPanel value="tab2">
        <p>Content for Tab 2</p>
      </TabPanel>
      <TabPanel value="tab3">
        <p>Content for Tab 3</p>
      </TabPanel>
    </Tabs>
  ),
};

export const WithCards: Story = {
  render: () => (
    <Tabs defaultValue="overview" style={{ width: "500px" }}>
      <TabsList>
        <Tab value="overview">Overview</Tab>
        <Tab value="analytics">Analytics</Tab>
        <Tab value="settings">Settings</Tab>
      </TabsList>

      <TabPanel value="overview">
        <Card>
          <h3
            style={{
              margin: "0 0 0.5rem 0",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Overview
          </h3>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            View a summary of your account activity and key metrics.
          </p>
        </Card>
      </TabPanel>

      <TabPanel value="analytics">
        <Card>
          <h3
            style={{
              margin: "0 0 0.5rem 0",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Analytics
          </h3>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            Detailed analytics and insights about your data.
          </p>
        </Card>
      </TabPanel>

      <TabPanel value="settings">
        <Card>
          <h3
            style={{
              margin: "0 0 0.5rem 0",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Settings
          </h3>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            Configure your account preferences and settings.
          </p>
        </Card>
      </TabPanel>
    </Tabs>
  ),
};

export const ManyTabs: Story = {
  render: () => (
    <Tabs defaultValue="monday" style={{ width: "600px" }}>
      <TabsList>
        <Tab value="monday">Monday</Tab>
        <Tab value="tuesday">Tuesday</Tab>
        <Tab value="wednesday">Wednesday</Tab>
        <Tab value="thursday">Thursday</Tab>
        <Tab value="friday">Friday</Tab>
        <Tab value="saturday">Saturday</Tab>
        <Tab value="sunday">Sunday</Tab>
      </TabsList>

      <TabPanel value="monday">
        <p>Monday schedule</p>
      </TabPanel>
      <TabPanel value="tuesday">
        <p>Tuesday schedule</p>
      </TabPanel>
      <TabPanel value="wednesday">
        <p>Wednesday schedule</p>
      </TabPanel>
      <TabPanel value="thursday">
        <p>Thursday schedule</p>
      </TabPanel>
      <TabPanel value="friday">
        <p>Friday schedule</p>
      </TabPanel>
      <TabPanel value="saturday">
        <p>Saturday schedule</p>
      </TabPanel>
      <TabPanel value="sunday">
        <p>Sunday schedule</p>
      </TabPanel>
    </Tabs>
  ),
};

export const LayersAndClassify: Story = {
  render: () => (
    <Tabs defaultValue="layers" style={{ width: "350px" }}>
      <TabsList>
        <Tab value="layers">Layers</Tab>
        <Tab value="classify">Classify</Tab>
      </TabsList>

      <TabPanel value="layers">
        <div style={{ padding: "1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div
              style={{
                padding: "0.75rem",
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Layer 1: US States
            </div>
            <div
              style={{
                padding: "0.75rem",
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Layer 2: Counties
            </div>
            <div
              style={{
                padding: "0.75rem",
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Layer 3: Cities
            </div>
          </div>
        </div>
      </TabPanel>

      <TabPanel value="classify">
        <div style={{ padding: "1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.25rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Method
              </label>
              <select
                aria-label="Classification method"
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                }}
              >
                <option>Quantile</option>
                <option>Equal Interval</option>
                <option>Natural Breaks</option>
              </select>
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.25rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Classes
              </label>
              <input
                type="range"
                min="3"
                max="9"
                defaultValue="5"
                aria-label="Number of classes"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </div>
      </TabPanel>
    </Tabs>
  ),
};

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = useState("tab1");

    return (
      <div style={{ width: "400px" }}>
        <p
          style={{
            marginBottom: "1rem",
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
          }}
        >
          Current tab: <strong>{value}</strong>
        </p>

        <Tabs value={value} onValueChange={(val) => setValue(val as string)}>
          <TabsList>
            <Tab value="tab1">Tab 1</Tab>
            <Tab value="tab2">Tab 2</Tab>
            <Tab value="tab3">Tab 3</Tab>
          </TabsList>

          <TabPanel value="tab1">
            <p>You are viewing Tab 1</p>
          </TabPanel>
          <TabPanel value="tab2">
            <p>You are viewing Tab 2</p>
          </TabPanel>
          <TabPanel value="tab3">
            <p>You are viewing Tab 3</p>
          </TabPanel>
        </Tabs>
      </div>
    );
  },
};
