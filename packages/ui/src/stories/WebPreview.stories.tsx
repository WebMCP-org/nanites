import type { Meta, StoryObj } from "@storybook/react";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewConsole,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from "../components/WebPreview";

const meta = {
  title: "Components/WebPreview",
  component: WebPreview,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof WebPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_LOGS = [
  {
    level: "info" as const,
    message: "Page loaded",
    timestamp: new Date(),
  },
  {
    level: "warn" as const,
    message: "Deprecated API usage in app.js:42",
    timestamp: new Date(),
  },
  {
    level: "error" as const,
    message: "TypeError: Cannot read properties of undefined (reading 'foo')",
    timestamp: new Date(),
  },
];

export const Default: Story = {
  render: () => (
    <div style={{ width: "42rem" }}>
      <WebPreview defaultUrl="https://base-ui.com/">
        <WebPreviewNavigation>
          <WebPreviewNavigationButton action="back" />
          <WebPreviewNavigationButton action="forward" />
          <WebPreviewNavigationButton action="reload" />
          <WebPreviewUrl />
        </WebPreviewNavigation>
        <WebPreviewBody />
      </WebPreview>
    </div>
  ),
};

export const WithConsole: Story = {
  render: () => (
    <div style={{ width: "42rem" }}>
      <WebPreview defaultUrl="https://example.com/">
        <WebPreviewNavigation>
          <WebPreviewNavigationButton action="back" />
          <WebPreviewNavigationButton action="forward" />
          <WebPreviewNavigationButton action="reload" />
          <WebPreviewUrl />
        </WebPreviewNavigation>
        <WebPreviewBody />
        <WebPreviewConsole logs={SAMPLE_LOGS} />
      </WebPreview>
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div style={{ width: "42rem" }}>
      <WebPreview>
        <WebPreviewNavigation>
          <WebPreviewNavigationButton action="back" />
          <WebPreviewNavigationButton action="forward" />
          <WebPreviewNavigationButton action="reload" />
          <WebPreviewUrl />
        </WebPreviewNavigation>
        <WebPreviewBody />
      </WebPreview>
    </div>
  ),
};
