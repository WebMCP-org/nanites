import type { Meta, StoryObj } from "@storybook/react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from "../components/Accordion";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Checkbox } from "../components/Checkbox";
import { Input } from "../components/Input";
import { Label } from "../components/Label";
import { Progress, ProgressTrack, ProgressIndicator } from "../components/Progress";
import { Separator } from "../components/Separator";
import { Switch, SwitchThumb } from "../components/Switch";
import { Tabs, TabsList, Tab, TabPanel } from "../components/Tabs";
import { Toggle } from "../components/Toggle";

/**
 * Accessibility-focused stories that exercise common WCAG failure points.
 * Each story is a targeted a11y regression test -- axe-core runs automatically
 * via the Storybook a11y addon (configured with `test: 'error'`).
 */
const meta = {
  title: "A11y/Regression Tests",
  parameters: {
    layout: "padded",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/**
 * Form controls with proper label associations.
 * Catches: missing labels, placeholder-only inputs, broken for/id links.
 */
export const FormLabels: Story = {
  render: () => (
    <form>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <Label htmlFor="a11y-name">Full name</Label>
          <Input id="a11y-name" type="text" placeholder="Jane Doe" />
        </div>
        <div>
          <Label htmlFor="a11y-email">Email address</Label>
          <Input id="a11y-email" type="email" placeholder="jane@example.com" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Checkbox id="a11y-terms" />
          <Label htmlFor="a11y-terms">I agree to the terms of service</Label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Label htmlFor="a11y-notifications">Enable notifications</Label>
          <Switch id="a11y-notifications">
            <SwitchThumb />
          </Switch>
        </div>
        <Button type="submit" color="primary">
          Submit form
        </Button>
      </div>
    </form>
  ),
};

/**
 * Buttons must always have accessible names.
 * Catches: empty buttons, icon-only buttons without aria-label.
 */
export const ButtonAccessibleNames: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <Button color="primary">Save changes</Button>
      <Button color="neutral" variant="outline">
        Cancel
      </Button>
      <Button color="destructive" variant="ghost" aria-label="Delete item" size="icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" />
        </svg>
      </Button>
    </div>
  ),
};

/**
 * Color contrast across all variant/color combinations.
 * Catches: insufficient contrast on ghost, outline, or neutral variants.
 */
export const ColorContrastMatrix: Story = {
  render: () => {
    const variants = ["normal", "outline", "ghost"] as const;
    const colors = ["primary", "neutral", "destructive"] as const;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {variants.map((variant) => (
          <div key={variant} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ width: "4rem", fontSize: "0.75rem" }}>{variant}</span>
            {colors.map((color) => (
              <Button key={`${variant}-${color}`} variant={variant} color={color}>
                {color}
              </Button>
            ))}
          </div>
        ))}
      </div>
    );
  },
};

/**
 * Badge contrast across all semantic colors.
 * Catches: low contrast on soft background fills.
 */
export const BadgeContrast: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      <Badge color="primary">Primary</Badge>
      <Badge color="neutral">Neutral</Badge>
      <Badge color="success">Success</Badge>
      <Badge color="warning">Warning</Badge>
      <Badge color="destructive">Destructive</Badge>
      <Badge color="primary" variant="outline">
        Outline
      </Badge>
    </div>
  ),
};

/**
 * Keyboard navigation through composite widgets.
 * Catches: tabs without proper ARIA roles, accordion without keyboard support.
 */
export const CompositeWidgets: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <section aria-label="Tab navigation test">
        <Tabs defaultValue="tab1">
          <TabsList>
            <Tab value="tab1">Account</Tab>
            <Tab value="tab2">Security</Tab>
            <Tab value="tab3">Notifications</Tab>
          </TabsList>
          <TabPanel value="tab1">Account settings content.</TabPanel>
          <TabPanel value="tab2">Security settings content.</TabPanel>
          <TabPanel value="tab3">Notification preferences content.</TabPanel>
        </Tabs>
      </section>

      <Separator />

      <section aria-label="Accordion navigation test">
        <Accordion>
          <AccordionItem value="faq-1">
            <AccordionTrigger>What is this service?</AccordionTrigger>
            <AccordionPanel>A description of the service.</AccordionPanel>
          </AccordionItem>
          <AccordionItem value="faq-2">
            <AccordionTrigger>How do I get started?</AccordionTrigger>
            <AccordionPanel>Step-by-step instructions here.</AccordionPanel>
          </AccordionItem>
        </Accordion>
      </section>
    </div>
  ),
};

/**
 * Card with interactive content must maintain focus order.
 * Catches: cards that swallow focus, missing interactive element semantics.
 */
export const InteractiveCards: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "1rem",
        maxWidth: "40rem",
      }}
    >
      <Card>
        <h3 style={{ margin: "0 0 0.5rem" }}>Plan A</h3>
        <p style={{ margin: "0 0 1rem" }}>Basic features for individuals.</p>
        <Button color="primary" variant="outline">
          Select plan
        </Button>
      </Card>
      <Card>
        <h3 style={{ margin: "0 0 0.5rem" }}>Plan B</h3>
        <p style={{ margin: "0 0 1rem" }}>Advanced features for teams.</p>
        <Button color="primary">Select plan</Button>
      </Card>
    </div>
  ),
};

/**
 * Toggle buttons must have aria-pressed.
 * Catches: toggle buttons missing pressed state.
 */
export const ToggleStates: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <Toggle aria-label="Bold">
        <strong>B</strong>
      </Toggle>
      <Toggle aria-label="Italic">
        <em>I</em>
      </Toggle>
    </div>
  ),
};

/**
 * Progress indicators need accessible names.
 * Catches: progress bars missing aria-label.
 */
export const ProgressWithLabel: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "20rem" }}>
      <div>
        <span id="upload-label">Upload progress</span>
        <Progress value={65} aria-labelledby="upload-label">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>
      <div>
        <span id="course-label">Course completion</span>
        <Progress value={30} color="success" aria-labelledby="course-label">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>
    </div>
  ),
};
