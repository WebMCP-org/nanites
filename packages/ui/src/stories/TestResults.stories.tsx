import type { Meta, StoryObj } from "@storybook/react";
import { Test, TestError, TestResults, TestSuite } from "../components/TestResults";

const meta = {
  title: "Components/TestResults",
  component: TestResults,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    summary: { passed: 47, failed: 2, skipped: 3, total: 52, duration: 3420 },
  },
} satisfies Meta<typeof TestResults>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div style={{ width: "36rem" }}>
      <TestResults {...args}>
        <TestSuite name="src/auth/session.test.ts" status="passed">
          <Test name="creates a session" status="passed" duration={12} />
          <Test name="refreshes expired tokens" status="passed" duration={8} />
          <Test name="rejects malformed tokens" status="passed" duration={5} />
        </TestSuite>
        <TestSuite name="src/auth/login.test.ts" status="failed">
          <Test name="logs in with valid credentials" status="passed" duration={22} />
          <Test name="rejects bad password" status="failed" duration={19}>
            <TestError
              message={`AssertionError: expected 401 but got 500
    at login.test.ts:42:20
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`}
            />
          </Test>
          <Test name="handles lockout after 5 failures" status="failed" duration={31}>
            <TestError message="Timeout of 30000ms exceeded" />
          </Test>
          <Test name="supports OAuth flow" status="skipped" />
        </TestSuite>
        <TestSuite name="src/ui/button.test.ts" status="passed">
          <Test name="renders with default variant" status="passed" duration={3} />
          <Test name="disables on click" status="passed" duration={4} />
        </TestSuite>
      </TestResults>
    </div>
  ),
};

export const AllPassed: Story = {
  args: {
    summary: { passed: 12, failed: 0, skipped: 0, total: 12, duration: 890 },
  },
  render: (args) => (
    <div style={{ width: "32rem" }}>
      <TestResults {...args}>
        <TestSuite name="utils.test.ts" status="passed">
          <Test name="cx merges classNames" status="passed" duration={1} />
          <Test name="cx skips falsy values" status="passed" duration={1} />
        </TestSuite>
      </TestResults>
    </div>
  ),
};

export const Running: Story = {
  args: {
    summary: { passed: 5, failed: 0, skipped: 0, total: 12, duration: 0 },
  },
  render: (args) => (
    <div style={{ width: "32rem" }}>
      <TestResults {...args}>
        <TestSuite name="auth.test.ts" status="running" defaultOpen>
          <Test name="logs in" status="passed" duration={12} />
          <Test name="refreshes token" status="running" />
          <Test name="handles logout" status="skipped" />
        </TestSuite>
      </TestResults>
    </div>
  ),
};
