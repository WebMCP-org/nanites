import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, within } from "storybook/test";
import { PreviewCard } from "../components/PreviewCard";

const meta = {
  title: "Components/PreviewCard",
  component: PreviewCard.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PreviewCard.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <p style={{ fontSize: "0.875rem" }}>
      Check out{" "}
      <PreviewCard.Root>
        <PreviewCard.Trigger href="#">@johndoe</PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner sideOffset={8}>
            <PreviewCard.Popup>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      backgroundColor: "hsl(var(--muted))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.25rem",
                      fontWeight: 600,
                    }}
                  >
                    JD
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>John Doe</div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "hsl(var(--muted-foreground))",
                      }}
                    >
                      @johndoe
                    </div>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: "0.875rem" }}>
                  Software Engineer. Building awesome things with React.
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "1rem",
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  <span>
                    <strong style={{ color: "hsl(var(--foreground))" }}>1.2k</strong> followers
                  </span>
                  <span>
                    <strong style={{ color: "hsl(var(--foreground))" }}>856</strong> following
                  </span>
                </div>
              </div>
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>{" "}
      for updates.
    </p>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(canvas.getByText("@johndoe"));

    await expect(await screen.findByText("John Doe")).toBeInTheDocument();
    await expect(
      screen.getByText("Software Engineer. Building awesome things with React."),
    ).toBeInTheDocument();
  },
};

export const ArticlePreview: Story = {
  render: () => (
    <p style={{ fontSize: "0.875rem", maxWidth: "400px" }}>
      Read more about{" "}
      <PreviewCard.Root>
        <PreviewCard.Trigger href="#">Building Accessible Components</PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner sideOffset={8}>
            <PreviewCard.Popup>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div
                  style={{
                    height: "100px",
                    backgroundColor: "hsl(var(--muted))",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14,2 14,8 20,8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <h4 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600 }}>
                  Building Accessible Components
                </h4>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Learn best practices for creating accessible React components that work for
                  everyone.
                </p>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  5 min read
                </div>
              </div>
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>{" "}
      to improve your web applications.
    </p>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(canvas.getByText("Building Accessible Components"));

    await expect(await screen.findByText("5 min read")).toBeInTheDocument();
  },
};

export const WithArrow: Story = {
  render: () => (
    <p style={{ fontSize: "0.875rem" }}>
      Hover over{" "}
      <PreviewCard.Root>
        <PreviewCard.Trigger href="#">this link</PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner sideOffset={12}>
            <PreviewCard.Popup>
              <PreviewCard.Arrow />
              <p style={{ margin: 0, fontSize: "0.875rem" }}>
                This preview card has an arrow pointing to the trigger.
              </p>
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>{" "}
      to see the preview with an arrow.
    </p>
  ),
};

export const ProductPreview: Story = {
  render: () => (
    <div style={{ padding: "2rem" }}>
      <p style={{ fontSize: "0.875rem" }}>
        Check out the{" "}
        <PreviewCard.Root>
          <PreviewCard.Trigger href="#">Premium Plan</PreviewCard.Trigger>
          <PreviewCard.Portal>
            <PreviewCard.Positioner sideOffset={8} side="right">
              <PreviewCard.Popup>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    width: "240px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Premium</h4>
                    <span
                      style={{
                        padding: "0.25rem 0.5rem",
                        backgroundColor: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                      }}
                    >
                      Popular
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>$29</span>
                    <span
                      style={{
                        fontSize: "0.875rem",
                        color: "hsl(var(--muted-foreground))",
                      }}
                    >
                      /month
                    </span>
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      fontSize: "0.75rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.25rem",
                    }}
                  >
                    <li>Unlimited projects</li>
                    <li>Priority support</li>
                    <li>Advanced analytics</li>
                    <li>Custom integrations</li>
                  </ul>
                </div>
              </PreviewCard.Popup>
            </PreviewCard.Positioner>
          </PreviewCard.Portal>
        </PreviewCard.Root>{" "}
        for more features.
      </p>
    </div>
  ),
};
