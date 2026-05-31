import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageToolbar,
} from "../components/Message";
import { CopyIcon, RefreshIcon } from "../components/_internal/icons";

const meta = {
  title: "Components/Message",
  component: Message,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Message>;

export default meta;
type Story = StoryObj<typeof meta>;

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      width: "min(40rem, 90vw)",
      display: "flex",
      flexDirection: "column",
      gap: "1rem",
    }}
  >
    {children}
  </div>
);

const ThumbUpIcon = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 14V7l3-4.5a1.5 1.5 0 0 1 2.7 1l-1 3.5h3a1.5 1.5 0 0 1 1.5 1.75l-.75 4.5A1.5 1.5 0 0 1 13 14H6Z" />
    <path d="M3 7h3v7H3z" />
  </svg>
);

const ThumbDownIcon = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 2v7l-3 4.5a1.5 1.5 0 0 1-2.7-1l1-3.5H2.3a1.5 1.5 0 0 1-1.5-1.75l.75-4.5A1.5 1.5 0 0 1 3 2h7Z" />
    <path d="M10 2h3v7h-3z" />
  </svg>
);

export const Default: Story = {
  render: () => (
    <Frame>
      <Message from="user">
        <MessageContent>How do React hooks work?</MessageContent>
      </Message>
      <Message from="assistant">
        <MessageContent>
          React hooks let you use state and lifecycle features in function components. The most
          common are useState, useEffect, and useContext.
        </MessageContent>
      </Message>
    </Frame>
  ),
};

export const WithActions: Story = {
  render: function WithActionsStory() {
    const [liked, setLiked] = useState(false);
    const [disliked, setDisliked] = useState(false);
    const content = "React hooks let you use state and lifecycle features in function components.";

    return (
      <Frame>
        <Message from="assistant">
          <MessageContent>{content}</MessageContent>
          <MessageActions>
            <MessageAction label="Retry" tooltip="Regenerate response">
              <RefreshIcon />
            </MessageAction>
            <MessageAction
              label={liked ? "Remove like" : "Like"}
              tooltip="Like this response"
              onClick={() => setLiked((v) => !v)}
              aria-pressed={liked}
            >
              <ThumbUpIcon />
            </MessageAction>
            <MessageAction
              label={disliked ? "Remove dislike" : "Dislike"}
              tooltip="Dislike this response"
              onClick={() => setDisliked((v) => !v)}
              aria-pressed={disliked}
            >
              <ThumbDownIcon />
            </MessageAction>
            <MessageAction
              label="Copy"
              tooltip="Copy to clipboard"
              onClick={() => navigator.clipboard.writeText(content)}
            >
              <CopyIcon />
            </MessageAction>
          </MessageActions>
        </Message>
      </Frame>
    );
  },
};

const BRANCHES = [
  "React hooks are special functions that let you use React features in function components. The most common ones are useState, useEffect, useContext, and useRef.",
  "Hooks solve a few problems: they remove the need for class components, make stateful logic reusable via custom hooks, and let related code live together.",
  "The hook model has two rules: only call hooks at the top level (not inside conditions or loops), and only call them from React functions.",
];

export const Branching: Story = {
  render: () => (
    <Frame>
      <Message from="user">
        <MessageContent>How do React hooks work?</MessageContent>
      </Message>
      <Message from="assistant">
        <MessageBranch defaultBranch={0}>
          <MessageBranchContent>
            {BRANCHES.map((text, i) => (
              <MessageContent key={i}>{text}</MessageContent>
            ))}
          </MessageBranchContent>
          <MessageToolbar>
            <MessageBranchSelector>
              <MessageBranchPrevious />
              <MessageBranchPage />
              <MessageBranchNext />
            </MessageBranchSelector>
            <MessageActions>
              <MessageAction label="Retry" tooltip="Regenerate">
                <RefreshIcon />
              </MessageAction>
              <MessageAction label="Copy" tooltip="Copy">
                <CopyIcon />
              </MessageAction>
            </MessageActions>
          </MessageToolbar>
        </MessageBranch>
      </Message>
    </Frame>
  ),
};

export const System: Story = {
  render: () => (
    <Frame>
      <Message from="system">
        <MessageContent>Conversation started — model: gpt-4o</MessageContent>
      </Message>
      <Message from="user">
        <MessageContent>Hello!</MessageContent>
      </Message>
    </Frame>
  ),
};
