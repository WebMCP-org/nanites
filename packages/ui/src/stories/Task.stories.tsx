import type { Meta, StoryObj } from "@storybook/react";
import { Task, TaskContent, TaskItem, TaskItemFile, TaskTrigger } from "../components/Task";

const meta = {
  title: "Components/Task",
  component: Task,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Task>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "32rem" }}>
      <Task defaultOpen>
        <TaskTrigger title="Refactoring authentication module" />
        <TaskContent>
          <TaskItem>
            Updated <TaskItemFile name="auth.ts" /> to export the new SessionProvider interface
          </TaskItem>
          <TaskItem>
            Migrated all call sites in <TaskItemFile name="middleware/auth.ts" /> and{" "}
            <TaskItemFile name="routes/login.ts" />
          </TaskItem>
          <TaskItem>
            Added regression tests covering expired tokens in <TaskItemFile name="auth.test.ts" />
          </TaskItem>
          <TaskItem>Removed the deprecated legacy-session shim</TaskItem>
        </TaskContent>
      </Task>
    </div>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <div style={{ width: "32rem" }}>
      <Task>
        <TaskTrigger title="Generate report (12 steps)" />
        <TaskContent>
          <TaskItem>Gather input from the database</TaskItem>
          <TaskItem>Compile metrics for Q1-Q4</TaskItem>
          <TaskItem>Render charts and export PDF</TaskItem>
        </TaskContent>
      </Task>
    </div>
  ),
};

export const Multiple: Story = {
  render: () => (
    <div style={{ width: "32rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <Task defaultOpen>
        <TaskTrigger title="Fix styling bug" />
        <TaskContent>
          <TaskItem>
            Located the issue in <TaskItemFile name="styles/button.css" />
          </TaskItem>
          <TaskItem>Updated the affected selector</TaskItem>
        </TaskContent>
      </Task>
      <Task>
        <TaskTrigger title="Run tests" />
        <TaskContent>
          <TaskItem>Lint pass</TaskItem>
          <TaskItem>Unit test pass</TaskItem>
          <TaskItem>Integration test pass</TaskItem>
        </TaskContent>
      </Task>
    </div>
  ),
};
