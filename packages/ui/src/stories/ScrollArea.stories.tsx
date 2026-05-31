import type { Meta, StoryObj } from "@storybook/react";
import { ScrollArea } from "../components/ScrollArea";

const meta = {
  title: "Components/ScrollArea",
  component: ScrollArea.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ScrollArea.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const tags = [
  "React",
  "TypeScript",
  "JavaScript",
  "CSS",
  "HTML",
  "Node.js",
  "Next.js",
  "Tailwind",
  "GraphQL",
  "REST API",
  "PostgreSQL",
  "MongoDB",
  "Redis",
  "Docker",
  "Kubernetes",
];

export const Default: Story = {
  render: () => (
    <ScrollArea.Root
      style={{
        height: "200px",
        width: "250px",
        border: "1px solid hsl(var(--border))",
        borderRadius: "var(--radius)",
      }}
    >
      <ScrollArea.Viewport style={{ padding: "1rem" }}>
        <h4 style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>Tags</h4>
        {tags.map((tag) => (
          <div
            key={tag}
            style={{
              padding: "0.5rem 0",
              borderBottom: "1px solid hsl(var(--border))",
              fontSize: "0.875rem",
            }}
          >
            {tag}
          </div>
        ))}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  ),
};

export const HorizontalScroll: Story = {
  render: () => (
    <ScrollArea.Root
      style={{
        width: "300px",
        border: "1px solid hsl(var(--border))",
        borderRadius: "var(--radius)",
      }}
    >
      <ScrollArea.Viewport style={{ padding: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", width: "max-content" }}>
          {tags.map((tag) => (
            <div
              key={tag}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "hsl(var(--muted))",
                borderRadius: "var(--radius)",
                fontSize: "0.875rem",
                whiteSpace: "nowrap",
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="horizontal">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  ),
};

export const BothScrollbars: Story = {
  render: () => (
    <ScrollArea.Root
      style={{
        height: "200px",
        width: "300px",
        border: "1px solid hsl(var(--border))",
        borderRadius: "var(--radius)",
      }}
    >
      <ScrollArea.Viewport style={{ padding: "1rem" }}>
        <div style={{ width: "500px" }}>
          <h4 style={{ margin: "0 0 0.75rem", fontWeight: 600 }}>Wide Content Area</h4>
          {Array.from({ length: 20 }).map((_, i) => (
            <p
              key={i}
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.875rem",
                whiteSpace: "nowrap",
              }}
            >
              This is a long line of text that extends beyond the container width to demonstrate
              horizontal scrolling. Item {i + 1}.
            </p>
          ))}
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
      <ScrollArea.Scrollbar orientation="horizontal">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
      <ScrollArea.Corner />
    </ScrollArea.Root>
  ),
};

export const CodeBlock: Story = {
  render: () => (
    <ScrollArea.Root
      style={{
        height: "200px",
        width: "400px",
        backgroundColor: "hsl(var(--muted))",
        borderRadius: "var(--radius)",
      }}
    >
      <ScrollArea.Viewport>
        <pre
          style={{
            margin: 0,
            padding: "1rem",
            fontSize: "0.875rem",
            fontFamily: "monospace",
            lineHeight: 1.6,
          }}
        >
          {`import { ScrollArea } from '@nanites/ui';

function MyComponent() {
  return (
    <ScrollArea.Root>
      <ScrollArea.Viewport>
        {/* Your scrollable content */}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

export default MyComponent;`}
        </pre>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  ),
};

export const ChatMessages: Story = {
  render: () => {
    const messages = [
      { id: 1, sender: "Alice", text: "Hey, how are you?" },
      { id: 2, sender: "You", text: "I'm good, thanks! Working on some UI components." },
      { id: 3, sender: "Alice", text: "Nice! What are you building?" },
      { id: 4, sender: "You", text: "A scroll area component with custom scrollbars." },
      { id: 5, sender: "Alice", text: "That sounds cool! Is it hard to implement?" },
      { id: 6, sender: "You", text: "Not really, Base UI makes it pretty straightforward." },
      { id: 7, sender: "Alice", text: "I should check that out sometime." },
      { id: 8, sender: "You", text: "Definitely! The docs are really good." },
      { id: 9, sender: "Alice", text: "Thanks for the tip!" },
      { id: 10, sender: "You", text: "No problem!" },
    ];

    return (
      <ScrollArea.Root
        style={{
          height: "300px",
          width: "350px",
          border: "1px solid hsl(var(--border))",
          borderRadius: "var(--radius)",
        }}
      >
        <ScrollArea.Viewport style={{ padding: "1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  alignSelf: msg.sender === "You" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                    marginBottom: "0.25rem",
                  }}
                >
                  {msg.sender}
                </div>
                <div
                  style={{
                    padding: "0.5rem 0.75rem",
                    backgroundColor:
                      msg.sender === "You" ? "hsl(var(--primary))" : "hsl(var(--muted))",
                    color: msg.sender === "You" ? "hsl(var(--primary-foreground))" : "inherit",
                    borderRadius: "var(--radius)",
                    fontSize: "0.875rem",
                  }}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar>
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    );
  },
};
