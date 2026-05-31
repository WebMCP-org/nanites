import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { Button } from "../components/Button";
import {
  Queue,
  QueueItem,
  QueueItemActions,
  QueueItemAttachment,
  QueueItemContent,
  QueueItemDescription,
  QueueItemFile,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "../components/Queue";
import { XIcon } from "../components/_internal/icons";

const meta = {
  title: "Components/Queue",
  component: Queue,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Queue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "28rem" }}>
      <Queue>
        <QueueSection>
          <QueueSectionTrigger>
            <QueueSectionLabel count={3}>Todos</QueueSectionLabel>
          </QueueSectionTrigger>
          <QueueList>
            <QueueItem status="complete">
              <QueueItemIndicator status="complete" />
              <QueueItemContent>Draft response to the user</QueueItemContent>
            </QueueItem>
            <QueueItem status="active">
              <QueueItemIndicator status="active" />
              <QueueItemContent>
                Search the web for sources
                <QueueItemDescription>
                  Looking across the last 24 hours of news results
                </QueueItemDescription>
              </QueueItemContent>
            </QueueItem>
            <QueueItem status="pending">
              <QueueItemIndicator status="pending" />
              <QueueItemContent>Summarize the findings</QueueItemContent>
              <QueueItemActions>
                <Button variant="ghost" size="icon" aria-label="Remove" onClick={fn()}>
                  <XIcon />
                </Button>
              </QueueItemActions>
            </QueueItem>
          </QueueList>
        </QueueSection>

        <QueueSection>
          <QueueSectionTrigger>
            <QueueSectionLabel count={2}>Attachments</QueueSectionLabel>
          </QueueSectionTrigger>
          <QueueList>
            <QueueItem>
              <QueueItemIndicator />
              <QueueItemContent>
                brief.pdf
                <QueueItemAttachment>
                  <QueueItemFile name="brief.pdf" size="238 KB" />
                </QueueItemAttachment>
              </QueueItemContent>
            </QueueItem>
            <QueueItem>
              <QueueItemIndicator />
              <QueueItemContent>
                data.csv
                <QueueItemAttachment>
                  <QueueItemFile name="data.csv" size="1.4 MB" />
                </QueueItemAttachment>
              </QueueItemContent>
            </QueueItem>
          </QueueList>
        </QueueSection>
      </Queue>
    </div>
  ),
};

export const CollapsedSection: Story = {
  render: () => (
    <div style={{ width: "28rem" }}>
      <Queue>
        <QueueSection defaultOpen>
          <QueueSectionTrigger>
            <QueueSectionLabel count={1}>Active</QueueSectionLabel>
          </QueueSectionTrigger>
          <QueueList>
            <QueueItem status="active">
              <QueueItemIndicator status="active" />
              <QueueItemContent>Running tests</QueueItemContent>
            </QueueItem>
          </QueueList>
        </QueueSection>
        <QueueSection defaultOpen={false}>
          <QueueSectionTrigger>
            <QueueSectionLabel count={4}>Completed</QueueSectionLabel>
          </QueueSectionTrigger>
          <QueueList>
            <QueueItem status="complete">
              <QueueItemIndicator status="complete" />
              <QueueItemContent>Setup project</QueueItemContent>
            </QueueItem>
            <QueueItem status="complete">
              <QueueItemIndicator status="complete" />
              <QueueItemContent>Install deps</QueueItemContent>
            </QueueItem>
          </QueueList>
        </QueueSection>
      </Queue>
    </div>
  ),
};
