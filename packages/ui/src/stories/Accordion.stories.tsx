import type { Meta, StoryObj } from "@storybook/react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from "../components/Accordion";

const meta: Meta<typeof Accordion> = {
  title: "Components/Accordion",
  component: Accordion,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Accordion>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "400px" }}>
      <Accordion>
        <AccordionItem value="item-1">
          <AccordionTrigger>Is it accessible?</AccordionTrigger>
          <AccordionPanel>
            <p>Yes. It adheres to the WAI-ARIA design pattern.</p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Is it styled?</AccordionTrigger>
          <AccordionPanel>
            <p>
              Yes. It comes with default styles that match the design system. You can also customize
              it with your own styles.
            </p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="item-3">
          <AccordionTrigger>Is it animated?</AccordionTrigger>
          <AccordionPanel>
            <p>Yes. It uses CSS animations for smooth expand/collapse transitions.</p>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  ),
};

export const DefaultExpanded: Story = {
  render: () => (
    <div style={{ width: "400px" }}>
      <Accordion defaultValue={["item-1"]}>
        <AccordionItem value="item-1">
          <AccordionTrigger>First item (expanded by default)</AccordionTrigger>
          <AccordionPanel>
            <p>This item is expanded when the accordion first renders.</p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Second item</AccordionTrigger>
          <AccordionPanel>
            <p>This item starts collapsed.</p>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  ),
};

export const MultipleExpanded: Story = {
  name: "Multiple Items Open",
  render: () => (
    <div style={{ width: "400px" }}>
      <Accordion multiple>
        <AccordionItem value="item-1">
          <AccordionTrigger>First section</AccordionTrigger>
          <AccordionPanel>
            <p>Multiple items can be open at the same time.</p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Second section</AccordionTrigger>
          <AccordionPanel>
            <p>Try opening this while keeping the first one open.</p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="item-3">
          <AccordionTrigger>Third section</AccordionTrigger>
          <AccordionPanel>
            <p>All three can be open simultaneously.</p>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  ),
};

export const FAQ: Story = {
  name: "Pricing FAQ",
  render: () => (
    <div style={{ width: "500px" }}>
      <h3
        style={{
          fontSize: "1.25rem",
          fontWeight: 600,
          marginBottom: "1.5rem",
          color: "hsl(var(--foreground))",
        }}
      >
        Frequently Asked Questions
      </h3>
      <Accordion>
        <AccordionItem value="trial">
          <AccordionTrigger>Do you offer a free trial?</AccordionTrigger>
          <AccordionPanel>
            <p>
              Yes! We offer a 14-day free trial on all plans. No credit card required. You can
              upgrade to a paid plan at any time during or after your trial.
            </p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="cancel">
          <AccordionTrigger>Can I cancel my subscription anytime?</AccordionTrigger>
          <AccordionPanel>
            <p>
              Absolutely. You can cancel your subscription at any time from your account settings.
              Your access will continue until the end of your current billing period.
            </p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="upgrade">
          <AccordionTrigger>How do I upgrade or downgrade my plan?</AccordionTrigger>
          <AccordionPanel>
            <p>
              You can change your plan at any time from your account settings. When upgrading,
              you&apos;ll be charged the prorated difference. When downgrading, the new rate applies
              at your next billing cycle.
            </p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="payment">
          <AccordionTrigger>What payment methods do you accept?</AccordionTrigger>
          <AccordionPanel>
            <p>
              We accept all major credit cards (Visa, MasterCard, American Express), PayPal, and
              bank transfers for annual plans. Enterprise customers can also pay via invoice.
            </p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="refund">
          <AccordionTrigger>What is your refund policy?</AccordionTrigger>
          <AccordionPanel>
            <p>
              We offer a 30-day money-back guarantee on all plans. If you&apos;re not satisfied with
              our service, contact support within 30 days of your purchase for a full refund.
            </p>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ width: "400px" }}>
      <Accordion>
        <AccordionItem value="item-1">
          <AccordionTrigger>Available section</AccordionTrigger>
          <AccordionPanel>
            <p>This section can be expanded and collapsed.</p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="item-2" disabled>
          <AccordionTrigger>Disabled section</AccordionTrigger>
          <AccordionPanel>
            <p>This content is not accessible.</p>
          </AccordionPanel>
        </AccordionItem>
        <AccordionItem value="item-3">
          <AccordionTrigger>Another available section</AccordionTrigger>
          <AccordionPanel>
            <p>This section works normally.</p>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  ),
};
