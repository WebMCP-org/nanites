import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Avatar } from "../components/Avatar";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Separator } from "../components/Separator";
import { ScrollArea } from "../components/ScrollArea";

const meta: Meta = {
  title: "Examples/Learn Page",
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj;

const LogoIcon = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="8" fill="hsl(var(--primary))" />
    <path
      d="M8 12L16 8L24 12V20L16 24L8 20V12Z"
      stroke="hsl(var(--primary-foreground))"
      strokeWidth="2"
      fill="none"
    />
    <path
      d="M16 8V24M8 12L24 20M24 12L8 20"
      stroke="hsl(var(--primary-foreground))"
      strokeWidth="1.5"
    />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const CircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
  </svg>
);

const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const TerminalIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

interface NavItem {
  id: string;
  title: string;
  completed?: boolean;
  active?: boolean;
  type: "chapter" | "lesson";
  children?: NavItem[];
}

const tutorialNav: NavItem[] = [
  {
    id: "1",
    title: "Getting Started",
    type: "chapter",
    children: [
      { id: "1-1", title: "Introduction", type: "lesson", completed: true },
      { id: "1-2", title: "Installation", type: "lesson", completed: true },
      { id: "1-3", title: "Your First Component", type: "lesson", active: true },
    ],
  },
  {
    id: "2",
    title: "Core Concepts",
    type: "chapter",
    children: [
      { id: "2-1", title: "Props and State", type: "lesson" },
      { id: "2-2", title: "Event Handling", type: "lesson" },
      { id: "2-3", title: "Conditional Rendering", type: "lesson" },
    ],
  },
  {
    id: "3",
    title: "Advanced Topics",
    type: "chapter",
    children: [
      { id: "3-1", title: "Custom Hooks", type: "lesson" },
      { id: "3-2", title: "Context API", type: "lesson" },
      { id: "3-3", title: "Performance Optimization", type: "lesson" },
    ],
  },
];

export const Default: Story = {
  name: "Learn Page Layout",
  render: () => {
    const [activeLesson, setActiveLesson] = React.useState("1-3");
    const [expandedChapters, setExpandedChapters] = React.useState<string[]>(["1", "2", "3"]);

    const toggleChapter = (id: string) => {
      setExpandedChapters((prev) =>
        prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
      );
    };

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          backgroundColor: "hsl(var(--background))",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.75rem 1.5rem",
            borderBottom: "1px solid hsl(var(--border))",
            backgroundColor: "hsl(var(--background))",
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <LogoIcon />
            <span
              style={{
                fontSize: "1.125rem",
                fontWeight: 600,
                color: "hsl(var(--foreground))",
              }}
            >
              Sigvelo
            </span>
            <Badge color="neutral">Beta</Badge>
          </div>

          {/* Right side */}
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <Button variant="ghost" size="sm">
              Learning plan
            </Button>
            <Separator orientation="vertical" style={{ height: "24px" }} />
            <Avatar.Root style={{ width: "32px", height: "32px", cursor: "pointer" }}>
              <Avatar.Image src="https://i.pravatar.cc/150?u=tutorial-user" alt="User" />
              <Avatar.Fallback>U</Avatar.Fallback>
            </Avatar.Root>
          </div>
        </header>

        {/* Main Content */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Sidebar Navigation */}
          <aside
            style={{
              width: "280px",
              borderRight: "1px solid hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "1rem 1rem 0.5rem",
                borderBottom: "1px solid hsl(var(--border))",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Course Content
              </h2>
            </div>
            <ScrollArea.Root style={{ flex: 1 }}>
              <ScrollArea.Viewport style={{ height: "100%" }}>
                <nav style={{ padding: "0.5rem" }}>
                  {tutorialNav.map((chapter) => (
                    <div key={chapter.id} style={{ marginBottom: "0.25rem" }}>
                      <button
                        onClick={() => toggleChapter(chapter.id)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.5rem 0.75rem",
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          borderRadius: "var(--radius)",
                          color: "hsl(var(--foreground))",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                          textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            transform: expandedChapters.includes(chapter.id)
                              ? "rotate(90deg)"
                              : "rotate(0deg)",
                            transition: "transform 0.2s",
                            display: "flex",
                          }}
                        >
                          <ChevronRightIcon />
                        </span>
                        {chapter.title}
                      </button>
                      {expandedChapters.includes(chapter.id) && chapter.children && (
                        <div style={{ marginLeft: "1.5rem" }}>
                          {chapter.children.map((lesson) => (
                            <button
                              key={lesson.id}
                              onClick={() => setActiveLesson(lesson.id)}
                              style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                padding: "0.5rem 0.75rem",
                                border: "none",
                                background:
                                  activeLesson === lesson.id ? "hsl(var(--primary) / 0.1)" : "none",
                                cursor: "pointer",
                                borderRadius: "var(--radius)",
                                color:
                                  activeLesson === lesson.id
                                    ? "hsl(var(--primary))"
                                    : "hsl(var(--muted-foreground))",
                                fontSize: "0.8125rem",
                                textAlign: "left",
                              }}
                            >
                              <span
                                style={{
                                  color: lesson.completed
                                    ? "hsl(var(--primary))"
                                    : "hsl(var(--muted-foreground))",
                                }}
                              >
                                {lesson.completed ? <CheckCircleIcon /> : <CircleIcon />}
                              </span>
                              {lesson.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </nav>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar orientation="vertical">
                <ScrollArea.Thumb />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>

            {/* Progress */}
            <div
              style={{
                padding: "1rem",
                borderTop: "1px solid hsl(var(--border))",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "0.5rem",
                  fontSize: "0.75rem",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                <span>Progress</span>
                <span>2 of 9 lessons</span>
              </div>
              <div
                style={{
                  height: "4px",
                  backgroundColor: "hsl(var(--muted))",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "22%",
                    height: "100%",
                    backgroundColor: "hsl(var(--primary))",
                    borderRadius: "2px",
                  }}
                />
              </div>
            </div>
          </aside>

          {/* Main Panel - Split View */}
          <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Content / Instructions */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid hsl(var(--border))",
              }}
            >
              <div
                style={{
                  padding: "1.5rem 2rem",
                  borderBottom: "1px solid hsl(var(--border))",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "0.5rem",
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  <span>Getting Started</span>
                  <ChevronRightIcon />
                  <span style={{ color: "hsl(var(--foreground))" }}>Your First Component</span>
                </div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: "1.5rem",
                    fontWeight: 600,
                    color: "hsl(var(--foreground))",
                  }}
                >
                  Your First Component
                </h1>
              </div>

              <ScrollArea.Root style={{ flex: 1 }}>
                <ScrollArea.Viewport>
                  <div style={{ padding: "1.5rem 2rem" }}>
                    <p
                      style={{
                        margin: "0 0 1rem",
                        color: "hsl(var(--foreground))",
                        lineHeight: 1.7,
                      }}
                    >
                      Now that you have your development environment set up, let's create your first
                      React component. Components are the building blocks of any React application.
                    </p>

                    <h2
                      style={{
                        margin: "1.5rem 0 1rem",
                        fontSize: "1.125rem",
                        fontWeight: 600,
                        color: "hsl(var(--foreground))",
                      }}
                    >
                      Creating a Button Component
                    </h2>

                    <p
                      style={{
                        margin: "0 0 1rem",
                        color: "hsl(var(--foreground))",
                        lineHeight: 1.7,
                      }}
                    >
                      Open the file{" "}
                      <code
                        style={{
                          padding: "0.125rem 0.375rem",
                          backgroundColor: "hsl(var(--muted))",
                          borderRadius: "var(--radius)",
                          fontSize: "0.875rem",
                        }}
                      >
                        src/Button.tsx
                      </code>{" "}
                      in the editor on the right and add the following code:
                    </p>

                    <Card
                      style={{
                        padding: "1rem",
                        backgroundColor: "hsl(220 13% 10%)",
                        marginBottom: "1rem",
                      }}
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: "0.8125rem",
                          color: "#e2e8f0",
                          fontFamily: "monospace",
                          overflow: "auto",
                        }}
                      >
                        {`export function Button({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="btn-primary"
    >
      {children}
    </button>
  );
}`}
                      </pre>
                    </Card>

                    <h2
                      style={{
                        margin: "1.5rem 0 1rem",
                        fontSize: "1.125rem",
                        fontWeight: 600,
                        color: "hsl(var(--foreground))",
                      }}
                    >
                      Try it out
                    </h2>

                    <p
                      style={{
                        margin: "0 0 1rem",
                        color: "hsl(var(--foreground))",
                        lineHeight: 1.7,
                      }}
                    >
                      After adding the code, you should see the button rendered in the preview
                      panel. Try clicking it to see the interaction!
                    </p>

                    <div
                      style={{
                        display: "flex",
                        gap: "0.75rem",
                        marginTop: "2rem",
                      }}
                    >
                      <Button variant="outline">Previous</Button>
                      <Button>
                        Continue
                        <ChevronRightIcon />
                      </Button>
                    </div>
                  </div>
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar orientation="vertical">
                  <ScrollArea.Thumb />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
            </div>

            {/* Preview / Visualization Panel */}
            <div
              style={{
                width: "50%",
                display: "flex",
                flexDirection: "column",
                backgroundColor: "hsl(220 13% 10%)",
              }}
            >
              {/* Editor Tabs */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  borderBottom: "1px solid hsl(220 13% 18%)",
                  backgroundColor: "hsl(220 13% 12%)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 1rem",
                    backgroundColor: "hsl(220 13% 10%)",
                    borderRight: "1px solid hsl(220 13% 18%)",
                    color: "#e2e8f0",
                    fontSize: "0.8125rem",
                  }}
                >
                  <FileIcon />
                  Button.tsx
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 1rem",
                    color: "#94a3b8",
                    fontSize: "0.8125rem",
                    cursor: "pointer",
                  }}
                >
                  <FileIcon />
                  App.tsx
                </div>
              </div>

              {/* File Tree + Editor */}
              <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                {/* File Tree */}
                <div
                  style={{
                    width: "180px",
                    borderRight: "1px solid hsl(220 13% 18%)",
                    padding: "0.5rem",
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      padding: "0.25rem 0.5rem",
                    }}
                  >
                    <FolderIcon />
                    <span>src</span>
                  </div>
                  <div style={{ marginLeft: "1rem" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        padding: "0.25rem 0.5rem",
                        backgroundColor: "hsl(220 13% 18%)",
                        borderRadius: "var(--radius)",
                        color: "#e2e8f0",
                      }}
                    >
                      <FileIcon />
                      <span>Button.tsx</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        padding: "0.25rem 0.5rem",
                      }}
                    >
                      <FileIcon />
                      <span>App.tsx</span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        padding: "0.25rem 0.5rem",
                      }}
                    >
                      <FileIcon />
                      <span>styles.css</span>
                    </div>
                  </div>
                </div>

                {/* Code Editor */}
                <div style={{ flex: 1, overflow: "auto" }} tabIndex={0}>
                  <pre
                    style={{
                      margin: 0,
                      padding: "1rem",
                      fontSize: "0.8125rem",
                      color: "#e2e8f0",
                      fontFamily: "monospace",
                      lineHeight: 1.6,
                    }}
                  >
                    <code>
                      <span style={{ color: "#c792ea" }}>export function</span>{" "}
                      <span style={{ color: "#82aaff" }}>Button</span>
                      {"({ "}
                      <span style={{ color: "#f78c6c" }}>children</span>,{" "}
                      <span style={{ color: "#f78c6c" }}>onClick</span>
                      {" }) {\n"}
                      {"  "}
                      <span style={{ color: "#c792ea" }}>return</span> {"(\n"}
                      {"    "}
                      <span style={{ color: "#89ddff" }}>&lt;</span>
                      <span style={{ color: "#f07178" }}>button</span>
                      {"\n"}
                      {"      "}
                      <span style={{ color: "#c792ea" }}>onClick</span>
                      <span style={{ color: "#89ddff" }}>=</span>
                      {"{"}
                      <span style={{ color: "#f78c6c" }}>onClick</span>
                      {"}\n"}
                      {"      "}
                      <span style={{ color: "#c792ea" }}>className</span>
                      <span style={{ color: "#89ddff" }}>=</span>
                      <span style={{ color: "#c3e88d" }}>"btn-primary"</span>
                      {"\n"}
                      {"    "}
                      <span style={{ color: "#89ddff" }}>&gt;</span>
                      {"\n"}
                      {"      {"}
                      <span style={{ color: "#f78c6c" }}>children</span>
                      {"}\n"}
                      {"    "}
                      <span style={{ color: "#89ddff" }}>&lt;/</span>
                      <span style={{ color: "#f07178" }}>button</span>
                      <span style={{ color: "#89ddff" }}>&gt;</span>
                      {"\n"}
                      {"  );\n"}
                      {"}"}
                    </code>
                  </pre>
                </div>
              </div>

              {/* Terminal / Preview Toggle */}
              <div
                style={{
                  borderTop: "1px solid hsl(220 13% 18%)",
                  backgroundColor: "hsl(220 13% 8%)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0.5rem 1rem",
                    borderBottom: "1px solid hsl(220 13% 18%)",
                    gap: "1rem",
                  }}
                >
                  <button
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      padding: "0.25rem 0.5rem",
                      border: "none",
                      background: "none",
                      color: "#e2e8f0",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <PlayIcon />
                    Preview
                  </button>
                  <button
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      padding: "0.25rem 0.5rem",
                      border: "none",
                      background: "none",
                      color: "#94a3b8",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <TerminalIcon />
                    Terminal
                  </button>
                </div>
                <div
                  style={{
                    padding: "2rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "120px",
                    backgroundColor: "#ffffff",
                  }}
                >
                  <button
                    style={{
                      padding: "0.625rem 1.25rem",
                      backgroundColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary-foreground))",
                      border: "none",
                      borderRadius: "var(--radius)",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Click me!
                  </button>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  },
};
