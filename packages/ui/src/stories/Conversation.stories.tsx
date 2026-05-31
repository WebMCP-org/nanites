import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationEmptyState,
  ConversationScrollButton,
  type ConversationMessage,
} from "../components/Conversation";
import { Message, MessageContent } from "../components/Message";

const meta = {
  title: "Components/Conversation",
  component: Conversation,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Conversation>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_MESSAGES: ConversationMessage[] = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "Hello, how are you?" }] },
  {
    id: "m2",
    role: "assistant",
    parts: [{ type: "text", text: "I'm good, thank you! How can I assist you today?" }],
  },
  {
    id: "m3",
    role: "user",
    parts: [{ type: "text", text: "I'm looking for information about your services." }],
  },
  {
    id: "m4",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Sure! We offer a variety of AI solutions. What are you interested in?",
      },
    ],
  },
  {
    id: "m5",
    role: "user",
    parts: [{ type: "text", text: "I'm interested in natural language processing tools." }],
  },
  {
    id: "m6",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Great choice! We have several NLP APIs. Would you like a demo?",
      },
    ],
  },
  { id: "m7", role: "user", parts: [{ type: "text", text: "Yes, a demo would be helpful." }] },
  {
    id: "m8",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Here is a sample: 'I love this product!' → Positive sentiment.",
      },
    ],
  },
  {
    id: "m9",
    role: "user",
    parts: [{ type: "text", text: "Impressive! Can it handle multiple languages?" }],
  },
  {
    id: "m10",
    role: "assistant",
    parts: [{ type: "text", text: "Absolutely, our models support over 20 languages." }],
  },
  { id: "m11", role: "user", parts: [{ type: "text", text: "How do I get started?" }] },
  {
    id: "m12",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Sign up on our website to get an API key instantly. We offer a 14-day free trial with full access and 24/7 support.",
      },
    ],
  },
];

function messageText(message: ConversationMessage): string {
  if (message.parts) {
    return message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }
  return message.content ?? "";
}

function Bubble({ message }: { message: ConversationMessage }) {
  return (
    <Message from={message.role}>
      <MessageContent>{messageText(message)}</MessageContent>
    </Message>
  );
}

const ChatIcon = () => (
  <svg
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const FrameBox = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      width: "min(40rem, 90vw)",
      height: "28rem",
      border:
        "var(--sigvelo-border-style) var(--sigvelo-border-width) var(--sigvelo-neutral-stroke-softer)",
      borderRadius: "var(--sigvelo-border-radius-md)",
      background: "var(--sigvelo-paper-color)",
      overflow: "hidden",
      position: "relative",
    }}
  >
    {children}
  </div>
);

export const Default: Story = {
  render: () => (
    <FrameBox>
      <Conversation>
        <ConversationContent>
          {SAMPLE_MESSAGES.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </FrameBox>
  ),
};

export const EmptyState: Story = {
  render: () => (
    <FrameBox>
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState
            icon={<ChatIcon />}
            title="Start a conversation"
            description="Messages will appear here as you chat."
          />
        </ConversationContent>
      </Conversation>
    </FrameBox>
  ),
};

export const WithDownload: Story = {
  render: () => (
    <FrameBox>
      <Conversation>
        <ConversationContent>
          {SAMPLE_MESSAGES.slice(0, 6).map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
        </ConversationContent>
        <ConversationDownload messages={SAMPLE_MESSAGES.slice(0, 6)} filename="chat.md" />
        <ConversationScrollButton />
      </Conversation>
    </FrameBox>
  ),
};

export const Streaming: Story = {
  render: function StreamingStory() {
    const [visible, setVisible] = useState<ConversationMessage[]>([]);

    useEffect(() => {
      let i = 0;
      const interval = setInterval(() => {
        const next = SAMPLE_MESSAGES[i];
        if (!next) {
          clearInterval(interval);
          return;
        }
        setVisible((prev) => [...prev, next]);
        i += 1;
      }, 600);
      return () => clearInterval(interval);
    }, []);

    return (
      <FrameBox>
        <Conversation>
          <ConversationContent>
            {visible.length === 0 ? (
              <ConversationEmptyState
                icon={<ChatIcon />}
                title="Waiting for a reply"
                description="Messages will stream in shortly."
              />
            ) : (
              visible.map((message) => <Bubble key={message.id} message={message} />)
            )}
          </ConversationContent>
          <ConversationDownload messages={visible} />
          <ConversationScrollButton />
        </Conversation>
      </FrameBox>
    );
  },
};
