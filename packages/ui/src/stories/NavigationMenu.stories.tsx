import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, within } from "storybook/test";
import { NavigationMenu } from "../components/NavigationMenu";

const meta = {
  title: "Components/NavigationMenu",
  component: NavigationMenu.Root,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof NavigationMenu.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const ChevronDownIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const Default: Story = {
  render: () => (
    <NavigationMenu.Root aria-label="Main navigation">
      <NavigationMenu.List>
        <NavigationMenu.Item value="products">
          <NavigationMenu.Trigger>
            Products
            <NavigationMenu.Icon>
              <ChevronDownIcon />
            </NavigationMenu.Icon>
          </NavigationMenu.Trigger>
          <NavigationMenu.Content>
            <NavigationMenu.Link href="#analytics">Analytics</NavigationMenu.Link>
            <NavigationMenu.Link href="#automation">Automation</NavigationMenu.Link>
            <NavigationMenu.Link href="#integrations">Integrations</NavigationMenu.Link>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
        <NavigationMenu.Item value="resources">
          <NavigationMenu.Trigger>
            Resources
            <NavigationMenu.Icon>
              <ChevronDownIcon />
            </NavigationMenu.Icon>
          </NavigationMenu.Trigger>
          <NavigationMenu.Content>
            <NavigationMenu.Link href="#docs">Documentation</NavigationMenu.Link>
            <NavigationMenu.Link href="#tutorials">Tutorials</NavigationMenu.Link>
            <NavigationMenu.Link href="#blog">Blog</NavigationMenu.Link>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
        <NavigationMenu.Item>
          <NavigationMenu.Link href="#pricing">Pricing</NavigationMenu.Link>
        </NavigationMenu.Item>
      </NavigationMenu.List>
      <NavigationMenu.Portal>
        <NavigationMenu.Positioner sideOffset={4}>
          <NavigationMenu.Popup>
            <NavigationMenu.Viewport />
          </NavigationMenu.Popup>
        </NavigationMenu.Positioner>
      </NavigationMenu.Portal>
    </NavigationMenu.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Products"));

    await expect(await screen.findByText("Analytics")).toBeInTheDocument();
    await expect(screen.getByText("Automation")).toBeInTheDocument();
  },
};

export const WithDescriptions: Story = {
  render: () => (
    <NavigationMenu.Root aria-label="Documentation navigation">
      <NavigationMenu.List>
        <NavigationMenu.Item value="getting-started">
          <NavigationMenu.Trigger>
            Getting Started
            <NavigationMenu.Icon>
              <ChevronDownIcon />
            </NavigationMenu.Icon>
          </NavigationMenu.Trigger>
          <NavigationMenu.Content>
            <div style={{ display: "grid", gap: "0.5rem", minWidth: "280px" }}>
              <NavigationMenu.Link href="#introduction">
                <div style={{ fontWeight: 500 }}>Introduction</div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Learn the basics of our platform
                </div>
              </NavigationMenu.Link>
              <NavigationMenu.Link href="#installation">
                <div style={{ fontWeight: 500 }}>Installation</div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Step-by-step setup guide
                </div>
              </NavigationMenu.Link>
              <NavigationMenu.Link href="#quickstart">
                <div style={{ fontWeight: 500 }}>Quickstart</div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Build your first project
                </div>
              </NavigationMenu.Link>
            </div>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
        <NavigationMenu.Item value="components">
          <NavigationMenu.Trigger>
            Components
            <NavigationMenu.Icon>
              <ChevronDownIcon />
            </NavigationMenu.Icon>
          </NavigationMenu.Trigger>
          <NavigationMenu.Content>
            <div style={{ display: "grid", gap: "0.5rem", minWidth: "280px" }}>
              <NavigationMenu.Link href="#buttons">
                <div style={{ fontWeight: 500 }}>Buttons</div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Interactive button components
                </div>
              </NavigationMenu.Link>
              <NavigationMenu.Link href="#forms">
                <div style={{ fontWeight: 500 }}>Forms</div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Input and form controls
                </div>
              </NavigationMenu.Link>
              <NavigationMenu.Link href="#modals">
                <div style={{ fontWeight: 500 }}>Modals</div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  Dialog and overlay components
                </div>
              </NavigationMenu.Link>
            </div>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
      </NavigationMenu.List>
      <NavigationMenu.Portal>
        <NavigationMenu.Positioner sideOffset={4}>
          <NavigationMenu.Popup>
            <NavigationMenu.Viewport />
          </NavigationMenu.Popup>
        </NavigationMenu.Positioner>
      </NavigationMenu.Portal>
    </NavigationMenu.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Getting Started"));

    await expect(await screen.findByText("Introduction")).toBeInTheDocument();
    await expect(screen.getByText("Installation")).toBeInTheDocument();
  },
};

export const SimpleLinks: Story = {
  render: () => (
    <NavigationMenu.Root aria-label="Site navigation">
      <NavigationMenu.List>
        <NavigationMenu.Item>
          <NavigationMenu.Link href="#home">Home</NavigationMenu.Link>
        </NavigationMenu.Item>
        <NavigationMenu.Item>
          <NavigationMenu.Link href="#about">About</NavigationMenu.Link>
        </NavigationMenu.Item>
        <NavigationMenu.Item>
          <NavigationMenu.Link href="#services">Services</NavigationMenu.Link>
        </NavigationMenu.Item>
        <NavigationMenu.Item>
          <NavigationMenu.Link href="#contact">Contact</NavigationMenu.Link>
        </NavigationMenu.Item>
      </NavigationMenu.List>
    </NavigationMenu.Root>
  ),
};
