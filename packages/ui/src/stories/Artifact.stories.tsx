import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactClose,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "../components/Artifact";
import { CopyIcon, RefreshIcon } from "../components/_internal/icons";

const meta = {
  title: "Components/Artifact",
  component: Artifact,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Artifact>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "34rem" }}>
      <Artifact>
        <ArtifactHeader>
          <div>
            <ArtifactTitle>Q1 Sales Report</ArtifactTitle>
            <ArtifactDescription>
              Generated from revenue data, segmented by region
            </ArtifactDescription>
          </div>
          <ArtifactActions>
            <ArtifactAction
              label="Regenerate"
              tooltip="Regenerate report"
              icon={<RefreshIcon />}
              onClick={fn()}
            />
            <ArtifactAction
              label="Copy"
              tooltip="Copy to clipboard"
              icon={<CopyIcon />}
              onClick={fn()}
            />
            <ArtifactClose onClick={fn()} />
          </ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent>
          <p style={{ margin: 0 }}>
            In Q1, total revenue grew 18% quarter-over-quarter, driven primarily by expansion in
            EMEA and steady growth in North America. APAC underperformed against forecast but
            remains on track for full-year targets.
          </p>
        </ArtifactContent>
      </Artifact>
    </div>
  ),
};

export const WithoutDescription: Story = {
  render: () => (
    <div style={{ width: "30rem" }}>
      <Artifact>
        <ArtifactHeader>
          <ArtifactTitle>Meeting notes</ArtifactTitle>
          <ArtifactActions>
            <ArtifactClose onClick={fn()} />
          </ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent>Short content with just a title and close button.</ArtifactContent>
      </Artifact>
    </div>
  ),
};
