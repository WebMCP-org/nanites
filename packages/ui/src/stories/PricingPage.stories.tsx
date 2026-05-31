import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { PricingPage } from "../components/PricingPage";
import type { Plan, FAQItem, UsageTier } from "../components/PricingPage";

const meta: Meta<typeof PricingPage> = {
  title: "Examples/PricingPage",
  component: PricingPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof PricingPage>;

const defaultPlans: Plan[] = [
  {
    id: "free",
    name: "Free",
    description: "Perfect for trying out our platform",
    monthlyPrice: 0,
    yearlyPrice: 0,
    cta: "Get Started Free",
    features: [
      { name: "Up to 3 projects", included: true },
      { name: "Basic analytics", included: true },
      { name: "Community support", included: true },
      { name: "API access", included: true, limit: "1K calls/mo" },
      { name: "Custom domains", included: false },
      { name: "Priority support", included: false },
      { name: "SSO", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "Best for growing teams and businesses",
    monthlyPrice: 29,
    yearlyPrice: 23,
    popular: true,
    cta: "Start Free Trial",
    features: [
      { name: "Unlimited projects", included: true },
      {
        name: "Advanced analytics",
        included: true,
        tooltip: "Includes cohort analysis, funnels, and custom reports",
      },
      { name: "Priority email support", included: true },
      { name: "API access", included: true, limit: "100K calls/mo" },
      { name: "Custom domains", included: true },
      { name: "Team collaboration", included: true, limit: "Up to 10 members" },
      { name: "SSO", included: false },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For large organizations with advanced needs",
    monthlyPrice: 99,
    yearlyPrice: 79,
    cta: "Contact Sales",
    features: [
      { name: "Unlimited everything", included: true },
      { name: "Custom analytics", included: true },
      { name: "24/7 phone support", included: true },
      { name: "Unlimited API access", included: true },
      { name: "Custom domains", included: true },
      { name: "Unlimited team members", included: true },
      {
        name: "SSO & SAML",
        included: true,
        tooltip: "Enterprise-grade security with single sign-on",
      },
    ],
  },
];

const defaultFAQ: FAQItem[] = [
  {
    question: "Do you offer a free trial?",
    answer:
      "Yes! We offer a 14-day free trial on all paid plans. No credit card required to start. You can upgrade to a paid plan at any time during or after your trial.",
  },
  {
    question: "Can I cancel my subscription anytime?",
    answer:
      "Absolutely. You can cancel your subscription at any time from your account settings. Your access will continue until the end of your current billing period. We don't believe in lock-in contracts.",
  },
  {
    question: "How do I upgrade or downgrade my plan?",
    answer:
      "You can change your plan at any time from your account settings. When upgrading, you'll be charged the prorated difference for the remainder of your billing cycle. When downgrading, the new rate applies at your next billing cycle.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "We accept all major credit cards (Visa, MasterCard, American Express, Discover), PayPal, and bank transfers for annual Enterprise plans. All payments are securely processed.",
  },
  {
    question: "Is there a discount for annual billing?",
    answer:
      "Yes! When you choose annual billing, you save 20% compared to monthly billing. This discount is automatically applied when you select the yearly option.",
  },
  {
    question: "What happens to my data if I cancel?",
    answer:
      "Your data remains accessible for 30 days after cancellation. During this period, you can export all your data. After 30 days, your data is permanently deleted from our servers in compliance with data protection regulations.",
  },
];

const usageTiers: UsageTier[] = [
  { limit: 0, price: 0, label: "Free tier (up to 10K)" },
  { limit: 10000, price: 29, label: "Starter (up to 50K)" },
  { limit: 50000, price: 79, label: "Growth (up to 200K)" },
  { limit: 200000, price: 199, label: "Scale (up to 500K)" },
];

export const Default: Story = {
  args: {
    title: "Simple, transparent pricing",
    subtitle: "Start free, upgrade when you need more. No hidden fees.",
    plans: defaultPlans,
    faq: defaultFAQ,
    onSelectPlan: (planId, period) => {
      console.log(`Selected plan: ${planId}, billing: ${period}`);
    },
    onConfirmUpgrade: (planId, period) => {
      console.log(`Confirmed upgrade to: ${planId}, billing: ${period}`);
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Toggle billing period
    const yearlyToggle = canvas.getByText("Yearly");
    await userEvent.click(yearlyToggle);
    // Open FAQ
    const firstFaq = canvas.getByText("Do you offer a free trial?");
    await userEvent.click(firstFaq);
    await expect(await canvas.findByText(/Yes! We offer a 14-day free trial/)).toBeInTheDocument();
  },
};

export const WithUsageCalculator: Story = {
  name: "With Usage Calculator",
  args: {
    title: "Pay as you grow",
    subtitle: "Flexible pricing that scales with your usage",
    plans: defaultPlans,
    faq: defaultFAQ,
    showUsageCalculator: true,
    usageTiers: usageTiers,
    maxUsage: 500000,
    usageUnit: "API calls",
    onSelectPlan: (planId, period) => {
      console.log(`Selected plan: ${planId}, billing: ${period}`);
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Interact with usage slider
    const slider = canvas.getByRole("slider");
    await userEvent.click(slider);
    // Toggle billing
    await userEvent.click(canvas.getByText("Yearly"));
  },
};

export const MinimalPlans: Story = {
  name: "Two Plans Only",
  args: {
    title: "Choose your plan",
    subtitle: "Simple pricing for individuals and teams",
    plans: [
      {
        id: "individual",
        name: "Individual",
        description: "For personal projects",
        monthlyPrice: 9,
        yearlyPrice: 7,
        features: [
          { name: "5 projects", included: true },
          { name: "Basic support", included: true },
          { name: "1GB storage", included: true },
        ],
      },
      {
        id: "team",
        name: "Team",
        description: "For collaborative work",
        monthlyPrice: 29,
        yearlyPrice: 23,
        popular: true,
        features: [
          { name: "Unlimited projects", included: true },
          { name: "Priority support", included: true },
          { name: "10GB storage", included: true },
          { name: "Team collaboration", included: true },
        ],
      },
    ],
    faq: [
      {
        question: "Can I switch plans later?",
        answer: "Yes, you can upgrade or downgrade at any time.",
      },
      {
        question: "Is there a free trial?",
        answer: "Yes, both plans come with a 14-day free trial.",
      },
    ],
  },
};

export const SaaSPricing: Story = {
  name: "SaaS Product Pricing",
  args: {
    title: "Pricing that grows with you",
    subtitle: "From startup to enterprise, we have a plan for every stage",
    plans: [
      {
        id: "starter",
        name: "Starter",
        description: "For small teams getting started",
        monthlyPrice: 19,
        yearlyPrice: 15,
        cta: "Start Free Trial",
        features: [
          { name: "Up to 5 team members", included: true },
          { name: "10 workflows", included: true },
          { name: "Basic integrations", included: true },
          { name: "Email support", included: true },
          { name: "API access", included: false },
          { name: "Custom branding", included: false },
          { name: "Audit logs", included: false },
        ],
      },
      {
        id: "business",
        name: "Business",
        description: "For growing teams that need more",
        monthlyPrice: 49,
        yearlyPrice: 39,
        popular: true,
        cta: "Start Free Trial",
        features: [
          { name: "Up to 20 team members", included: true },
          { name: "Unlimited workflows", included: true },
          {
            name: "Advanced integrations",
            included: true,
            tooltip: "Includes Salesforce, HubSpot, and 50+ more",
          },
          { name: "Priority support", included: true },
          { name: "API access", included: true, limit: "10K requests/day" },
          { name: "Custom branding", included: true },
          { name: "Audit logs", included: false },
        ],
      },
      {
        id: "enterprise",
        name: "Enterprise",
        description: "For organizations with complex needs",
        monthlyPrice: 149,
        yearlyPrice: 119,
        cta: "Contact Sales",
        features: [
          { name: "Unlimited team members", included: true },
          { name: "Unlimited workflows", included: true },
          { name: "Custom integrations", included: true },
          { name: "Dedicated support", included: true },
          { name: "Unlimited API access", included: true },
          { name: "White-label solution", included: true },
          {
            name: "Audit logs & compliance",
            included: true,
            tooltip: "SOC 2, HIPAA, and GDPR compliant",
          },
        ],
      },
    ],
    faq: [
      {
        question: "What counts as a team member?",
        answer:
          "A team member is anyone with login access to your workspace. You can add guests and external collaborators without counting toward your limit.",
      },
      {
        question: "Can I change my plan at any time?",
        answer:
          "Yes! Upgrade instantly or downgrade at the end of your billing cycle. No penalties or hidden fees.",
      },
      {
        question: "Do you offer discounts for nonprofits?",
        answer:
          "Yes, we offer 50% off for registered nonprofits and educational institutions. Contact us with proof of status.",
      },
      {
        question: "What&apos;s your uptime guarantee?",
        answer:
          "We guarantee 99.9% uptime for all paid plans. Enterprise customers receive 99.99% uptime with SLA.",
      },
    ],
  },
};

export const DeveloperPricing: Story = {
  name: "Developer Platform Pricing",
  args: {
    title: "Build without limits",
    subtitle: "Powerful APIs, fair pricing, world-class documentation",
    plans: [
      {
        id: "hobby",
        name: "Hobby",
        description: "For side projects and learning",
        monthlyPrice: 0,
        yearlyPrice: 0,
        cta: "Start Building",
        features: [
          { name: "10,000 API calls/month", included: true },
          { name: "Community support", included: true },
          { name: "Basic rate limiting", included: true },
          { name: "Public documentation", included: true },
          { name: "Webhooks", included: false },
          { name: "Priority queue", included: false },
        ],
      },
      {
        id: "developer",
        name: "Developer",
        description: "For professional developers",
        monthlyPrice: 25,
        yearlyPrice: 20,
        popular: true,
        cta: "Get API Key",
        features: [
          { name: "100,000 API calls/month", included: true },
          { name: "Email support", included: true },
          {
            name: "Higher rate limits",
            included: true,
            tooltip: "100 requests/second vs 10 for Hobby",
          },
          { name: "Full documentation", included: true },
          { name: "Webhooks", included: true },
          { name: "Priority queue", included: false },
        ],
      },
      {
        id: "scale",
        name: "Scale",
        description: "For production applications",
        monthlyPrice: 99,
        yearlyPrice: 79,
        cta: "Get Started",
        features: [
          { name: "1,000,000 API calls/month", included: true },
          { name: "Slack support", included: true },
          { name: "Unlimited rate limits", included: true },
          { name: "Full documentation", included: true },
          { name: "Webhooks", included: true },
          {
            name: "Priority queue",
            included: true,
            tooltip: "Your requests are processed first during high load",
          },
        ],
      },
    ],
    showUsageCalculator: true,
    usageTiers: [
      { limit: 0, price: 0, label: "Hobby (10K included)" },
      { limit: 10000, price: 25, label: "Developer (100K included)" },
      { limit: 100000, price: 99, label: "Scale (1M included)" },
      { limit: 1000000, price: 299, label: "Enterprise (custom)" },
    ],
    maxUsage: 2000000,
    usageUnit: "API calls",
    faq: [
      {
        question: "What happens if I exceed my API limit?",
        answer:
          "We'll notify you when you reach 80% of your limit. If you exceed it, requests will be rate-limited until the next billing cycle. You can upgrade anytime to increase your limit.",
      },
      {
        question: "Do unused API calls roll over?",
        answer:
          "No, API calls reset at the beginning of each billing cycle. However, you can purchase additional calls as needed.",
      },
      {
        question: "Can I get a custom plan?",
        answer:
          "Absolutely! Contact our sales team for custom pricing if you need more than 1M calls/month or have specific requirements.",
      },
    ],
  },
};
