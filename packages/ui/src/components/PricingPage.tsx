import * as React from "react";
import { Badge } from "./Badge.js";
import { Button } from "./Button.js";
import { Card } from "./Card.js";
import { Switch, SwitchThumb } from "./Switch.js";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup.js";
import { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb } from "./Slider.js";
import { Progress, ProgressTrack, ProgressIndicator } from "./Progress.js";
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "./Accordion.js";
import {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from "./AlertDialog.js";
import { Separator } from "./Separator.js";
import {
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipPositioner,
  TooltipPopup,
} from "./Tooltip.js";
import { Checkbox } from "./Checkbox.js";
import { Label } from "./Label.js";

/**
 * Plan feature definition
 */
export interface PlanFeature {
  name: string;
  included: boolean;
  tooltip?: string;
  limit?: string;
}

/**
 * Plan definition for the pricing page
 */
export interface Plan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: PlanFeature[];
  popular?: boolean;
  cta?: string;
}

/**
 * FAQ item definition
 */
export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * Usage tier for calculator
 */
export interface UsageTier {
  limit: number;
  price: number;
  label: string;
}

export interface PricingPageProps {
  /**
   * The title of the pricing page
   * @default 'Simple, transparent pricing'
   */
  title?: string;
  /**
   * The subtitle/description
   */
  subtitle?: string;
  /**
   * Array of plan definitions
   */
  plans: Plan[];
  /**
   * FAQ items to display
   */
  faq?: FAQItem[];
  /**
   * Whether to show the usage calculator
   * @default false
   */
  showUsageCalculator?: boolean;
  /**
   * Usage tiers for the calculator
   */
  usageTiers?: UsageTier[];
  /**
   * Maximum usage value for the slider
   * @default 100000
   */
  maxUsage?: number;
  /**
   * Usage unit label
   * @default 'API calls'
   */
  usageUnit?: string;
  /**
   * Callback when a plan is selected
   */
  onSelectPlan?: (planId: string, billingPeriod: "monthly" | "yearly") => void;
  /**
   * Callback when upgrade is confirmed
   */
  onConfirmUpgrade?: (planId: string, billingPeriod: "monthly" | "yearly") => void;
  /**
   * Additional class name
   */
  className?: string;
  /**
   * Style variant for the billing period toggle.
   * When set, hides the style switcher checkbox.
   * @default undefined (shows style switcher for demos)
   */
  billingToggleVariant?: "switch" | "buttons";
  /**
   * Maps plan ID → Polar product IDs for checkout.
   * When provided, clicking a plan triggers a checkout redirect.
   */
  productIds?: Record<string, { monthly: string; yearly: string }>;
  /**
   * The Polar product ID of the user's current plan, or null if not subscribed.
   */
  currentProductId?: string | null;
  /**
   * Whether the user has an active subscription.
   */
  isSubscribed?: boolean;
  /**
   * URL for the checkout API endpoint.
   * @default '/api/checkout'
   */
  checkoutUrl?: string;
  /**
   * URL for the switch-plan API endpoint (used for existing subscribers).
   * @default '/api/switch-plan'
   */
  switchPlanUrl?: string;
  /**
   * URL for the customer portal (used when subscription can't be updated inline).
   * @default '/api/portal'
   */
  portalUrl?: string;
  /**
   * Whether the user is logged in. When false, clicking a paid plan
   * redirects to the login page instead of checkout.
   */
  isLoggedIn?: boolean;
  /**
   * URL to redirect unauthenticated users to.
   * @default '/auth/login'
   */
  loginUrl?: string;
  /**
   * Whether the user has a real Polar customer account (has been through checkout before).
   * When true, plan changes go through the customer portal instead of fresh checkout.
   * @default false
   */
  hasPolarAccount?: boolean;
  /**
   * Custom checkout handler. When provided, called instead of `window.location.href = checkoutUrl`.
   * Should return the redirect URL or navigate directly.
   */
  onCheckout?: (productId: string) => Promise<void>;
  /**
   * Custom switch-plan handler. When provided, called instead of `fetch(switchPlanUrl)`.
   * Should return the response status to determine next action.
   */
  onSwitchPlan?: (productId: string) => Promise<{ ok: boolean; status: number }>;
  /**
   * Custom portal redirect handler. When provided, called instead of `window.location.href = portalUrl`.
   */
  onPortalRedirect?: () => Promise<void>;
}

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M13.5 4.5L6.5 11.5L3 8"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const MinusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const InfoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 6V10M7 4.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * A comprehensive pricing page component that demonstrates all pricing-related
 * components working together.
 *
 * @example
 * ```tsx
 * <PricingPage
 *   title="Choose your plan"
 *   subtitle="Start free, upgrade when you need more"
 *   plans={[
 *     { id: 'free', name: 'Free', ... },
 *     { id: 'pro', name: 'Pro', popular: true, ... },
 *     { id: 'enterprise', name: 'Enterprise', ... },
 *   ]}
 *   faq={[
 *     { question: 'Can I cancel anytime?', answer: 'Yes...' },
 *   ]}
 *   onSelectPlan={(planId, period) => console.log(planId, period)}
 * />
 * ```
 */

function getSavings(plan: Plan) {
  const yearlyTotal = plan.yearlyPrice * 12;
  const monthlyTotal = plan.monthlyPrice * 12;
  return monthlyTotal - yearlyTotal;
}

function formatNumber(num: number) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
  return num.toString();
}

export function PricingPage({
  title = "Simple, transparent pricing",
  subtitle,
  plans,
  faq,
  showUsageCalculator = false,
  usageTiers = [],
  maxUsage = 100000,
  usageUnit = "API calls",
  onSelectPlan,
  onConfirmUpgrade,
  className = "",
  billingToggleVariant,
  productIds,
  currentProductId,
  isSubscribed = false,
  checkoutUrl = "/api/checkout",
  switchPlanUrl = "/api/switch-plan",
  portalUrl = "/api/portal",
  isLoggedIn = false,
  loginUrl = "/auth/login",
  hasPolarAccount = false,
  onCheckout,
  onSwitchPlan,
  onPortalRedirect,
}: PricingPageProps) {
  const [billingPeriod, setBillingPeriod] = React.useState<"monthly" | "yearly">("monthly");
  const [useSwitchToggle, setUseSwitchToggle] = React.useState(true);

  // Use prop if set, otherwise use internal state for demo purposes
  const showSwitch = billingToggleVariant ? billingToggleVariant === "switch" : useSwitchToggle;
  const [selectedPlan, setSelectedPlan] = React.useState<Plan | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);
  const [usage, setUsage] = React.useState(50000);

  const isYearly = billingPeriod === "yearly";

  const getPrice = (plan: Plan) => {
    return isYearly ? plan.yearlyPrice : plan.monthlyPrice;
  };

  // Calculate average yearly savings percentage across paid plans
  const yearlySavingsPercent = React.useMemo(() => {
    const paidPlans = plans.filter((p) => p.monthlyPrice > 0);
    if (paidPlans.length === 0) return 0;

    const totalPercent = paidPlans.reduce((sum, plan) => {
      const savings = ((plan.monthlyPrice - plan.yearlyPrice) / plan.monthlyPrice) * 100;
      return sum + savings;
    }, 0);

    return Math.round(totalPercent / paidPlans.length);
  }, [plans]);

  const isCurrentPlan = (plan: Plan): boolean => {
    if (!currentProductId || !productIds) return false;
    const ids = productIds[plan.id];
    if (!ids) return false;
    return ids.monthly === currentProductId || ids.yearly === currentProductId;
  };

  const currentPlan = isSubscribed ? plans.find((p) => isCurrentPlan(p)) : undefined;

  const getSwitchDirection = (target: Plan): "upgrade" | "downgrade" | "switch" => {
    if (!currentPlan) return "upgrade";
    const currentPrice = getPrice(currentPlan);
    const targetPrice = getPrice(target);
    if (targetPrice > currentPrice) return "upgrade";
    if (targetPrice < currentPrice) return "downgrade";
    return "switch";
  };

  const getProductIdForPlan = (plan: Plan): string | undefined => {
    if (!productIds) return undefined;
    const ids = productIds[plan.id];
    if (!ids) return undefined;
    return isYearly ? ids.yearly : ids.monthly;
  };

  const doCheckout = async (productId: string) => {
    if (onCheckout) {
      await onCheckout(productId);
    } else {
      window.location.href = `${checkoutUrl}?products=${productId}`;
    }
  };

  const doSwitchPlan = async (productId: string) => {
    if (onSwitchPlan) {
      return onSwitchPlan(productId);
    }
    return fetch(switchPlanUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
  };

  const doPortalRedirect = async () => {
    if (onPortalRedirect) {
      await onPortalRedirect();
    } else {
      window.location.href = portalUrl;
    }
  };

  const handleSelectPlan = (plan: Plan) => {
    if (isCurrentPlan(plan)) return;

    // Require login before subscribing to a paid plan.
    // After login, redirect straight to checkout with the selected product.
    if (!isLoggedIn && plan.monthlyPrice > 0) {
      const productId = getProductIdForPlan(plan);
      const checkoutPath = productId
        ? `${checkoutUrl}?products=${productId}`
        : window.location.pathname;
      window.location.href = `${loginUrl}?redirect=${encodeURIComponent(checkoutPath)}`;
      return;
    }

    setSelectedPlan(plan);
    setConfirmDialogOpen(true);
  };

  const handleConfirmUpgrade = async () => {
    if (!selectedPlan) {
      setConfirmDialogOpen(false);
      return;
    }

    onConfirmUpgrade?.(selectedPlan.id, billingPeriod);
    onSelectPlan?.(selectedPlan.id, billingPeriod);

    if (productIds) {
      const productId = getProductIdForPlan(selectedPlan);
      if (!productId) return;

      if (isSubscribed) {
        // New customer on free tier (never been through checkout) — fresh checkout
        if (!hasPolarAccount) {
          await doCheckout(productId);
          return;
        }

        // Has Polar account — try switch-plan API (handles upgrades, downgrades, and reactivation)
        setSwitching(true);
        try {
          const res = await doSwitchPlan(productId);
          if (res.ok) {
            window.location.reload();
            return;
          }
          // No Polar subscription found — fall back to checkout
          if (res.status === 404) {
            await doCheckout(productId);
            return;
          }
          // Subscription fully ended on Polar's side — redirect to portal
          if (res.status === 409) {
            await doPortalRedirect();
            return;
          }
        } finally {
          setSwitching(false);
        }
      } else {
        await doCheckout(productId);
        return;
      }
    }

    setConfirmDialogOpen(false);
  };

  const calculateUsagePrice = (currentUsage: number) => {
    for (let i = usageTiers.length - 1; i >= 0; i--) {
      if (currentUsage >= usageTiers[i].limit) {
        return usageTiers[i].price;
      }
    }
    return usageTiers[0]?.price ?? 0;
  };

  const classes = ["pricing-page", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      {/* Header */}
      <div className="pricing-page__header">
        <h1 className="pricing-page__title">{title}</h1>
        {subtitle && <p className="pricing-page__subtitle">{subtitle}</p>}

        {/* Billing Toggle */}
        <div className="pricing-page__billing-toggle">
          {!billingToggleVariant && (
            <div className="pricing-page__toggle-options">
              <Checkbox
                checked={useSwitchToggle}
                onCheckedChange={(checked) => setUseSwitchToggle(!!checked)}
                id="toggle-type"
                aria-label="Use switch style"
              />
              <Label htmlFor="toggle-type" style={{ fontSize: "0.75rem" }}>
                Use switch style
              </Label>
            </div>
          )}

          {showSwitch ? (
            <div className="pricing-page__switch-container">
              <span
                className={`pricing-page__period-label ${!isYearly ? "pricing-page__period-label--active" : ""}`}
              >
                Monthly
              </span>
              <Switch
                checked={isYearly}
                onCheckedChange={(checked) => setBillingPeriod(checked ? "yearly" : "monthly")}
                aria-label="Toggle yearly billing"
              >
                <SwitchThumb />
              </Switch>
              <span
                className={`pricing-page__period-label ${isYearly ? "pricing-page__period-label--active" : ""}`}
              >
                Yearly
                <Badge color="success" size="sm" style={{ marginLeft: "0.5rem" }}>
                  Save {yearlySavingsPercent}%
                </Badge>
              </span>
            </div>
          ) : (
            <ToggleGroup
              value={[billingPeriod]}
              onValueChange={(v) => v.length > 0 && setBillingPeriod(v[0] as "monthly" | "yearly")}
            >
              <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
              <ToggleGroupItem value="yearly">
                Yearly
                <Badge color="success" size="sm" style={{ marginLeft: "0.375rem" }}>
                  -{yearlySavingsPercent}%
                </Badge>
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      </div>

      {/* Plans Grid */}
      <div className="pricing-page__plans">
        {plans.map((plan) => (
          <Card
            hover
            key={plan.id}
            className={`pricing-page__plan ${plan.popular ? "pricing-page__plan--popular" : ""}`}
          >
            {plan.popular && (
              <Badge color="success" className="pricing-page__popular-badge">
                Most Popular
              </Badge>
            )}

            <div className="pricing-page__plan-header">
              <h2 className="pricing-page__plan-name">{plan.name}</h2>
              <p className="pricing-page__plan-description">{plan.description}</p>
            </div>

            <div className="pricing-page__plan-price">
              <span className="pricing-page__price-amount">${getPrice(plan)}</span>
              <span className="pricing-page__price-period">/month</span>
              {isYearly && getSavings(plan) > 0 && (
                <span className="pricing-page__price-savings">Save ${getSavings(plan)}/year</span>
              )}
            </div>

            <Button
              variant={isCurrentPlan(plan) ? "outline" : plan.popular ? "normal" : "outline"}
              className="pricing-page__plan-cta"
              onClick={() => handleSelectPlan(plan)}
              disabled={isCurrentPlan(plan)}
            >
              {isCurrentPlan(plan)
                ? "Current Plan"
                : isSubscribed
                  ? getSwitchDirection(plan) === "upgrade"
                    ? "Upgrade"
                    : getSwitchDirection(plan) === "downgrade"
                      ? "Downgrade"
                      : "Switch Plan"
                  : plan.cta || "Get Started"}
            </Button>

            <Separator className="pricing-page__features-separator" />

            <ul className="pricing-page__features">
              {plan.features.map((feature, index) => (
                <li
                  key={index}
                  className={`pricing-page__feature ${!feature.included ? "pricing-page__feature--disabled" : ""}`}
                >
                  <span
                    className={`pricing-page__feature-icon ${feature.included ? "pricing-page__feature-icon--included" : ""}`}
                  >
                    {feature.included ? <CheckIcon /> : <MinusIcon />}
                  </span>
                  <span className="pricing-page__feature-name">
                    {feature.name}
                    {feature.limit && (
                      <span className="pricing-page__feature-limit">({feature.limit})</span>
                    )}
                  </span>
                  {feature.tooltip && (
                    <Tooltip>
                      <TooltipTrigger
                        className="pricing-page__feature-info"
                        aria-label={`More information about ${feature.name}`}
                      >
                        <InfoIcon />
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipPositioner>
                          <TooltipPopup>{feature.tooltip}</TooltipPopup>
                        </TooltipPositioner>
                      </TooltipPortal>
                    </Tooltip>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {/* Usage Calculator */}
      {showUsageCalculator && usageTiers.length > 0 && (
        <Card className="pricing-page__calculator">
          <h2 className="pricing-page__calculator-title">Estimate your usage</h2>
          <p className="pricing-page__calculator-description">
            Adjust the slider to see pricing based on your expected {usageUnit}
          </p>

          <Slider
            value={usage}
            onValueChange={(v) => setUsage(Array.isArray(v) ? v[0] : v)}
            min={0}
            max={maxUsage}
            step={Math.ceil(maxUsage / 100)}
            className="pricing-page__calculator-slider"
          >
            <div className="pricing-page__calculator-labels">
              <Label>Monthly {usageUnit}</Label>
              <span className="pricing-page__calculator-value">{formatNumber(usage)}</span>
            </div>
            <SliderControl>
              <SliderTrack>
                <SliderIndicator />
                <SliderThumb aria-label={`Monthly ${usageUnit}`} />
              </SliderTrack>
            </SliderControl>
            <div className="pricing-page__calculator-range">
              <span>0</span>
              <span>{formatNumber(maxUsage)}</span>
            </div>
          </Slider>

          <Separator style={{ margin: "1.5rem 0" }} />

          <div className="pricing-page__calculator-result">
            <span className="pricing-page__calculator-result-label">Estimated monthly cost</span>
            <div className="pricing-page__calculator-result-price">
              <span className="pricing-page__calculator-amount">${calculateUsagePrice(usage)}</span>
              <span className="pricing-page__calculator-period">/month</span>
            </div>
          </div>

          {/* Usage tiers visualization */}
          <div className="pricing-page__tiers">
            {usageTiers.map((tier, index) => {
              const isActive = usage >= tier.limit;
              return (
                <div key={index} className="pricing-page__tier">
                  <div className="pricing-page__tier-info">
                    <span className="pricing-page__tier-label">{tier.label}</span>
                    <span className="pricing-page__tier-price">${tier.price}/mo</span>
                  </div>
                  <Progress
                    aria-label={`Progress toward ${tier.label}`}
                    value={isActive ? 100 : tier.limit > 0 ? (usage / tier.limit) * 100 : 0}
                    color={isActive ? "success" : "primary"}
                  >
                    <ProgressTrack>
                      <ProgressIndicator />
                    </ProgressTrack>
                  </Progress>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* FAQ Section */}
      {faq && faq.length > 0 && (
        <div className="pricing-page__faq">
          <h2 className="pricing-page__faq-title">Frequently Asked Questions</h2>
          <Accordion className="pricing-page__faq-accordion">
            {faq.map((item, index) => (
              <AccordionItem key={index} value={`faq-${index}`}>
                <AccordionTrigger>{item.question}</AccordionTrigger>
                <AccordionPanel>
                  <p>{item.answer}</p>
                </AccordionPanel>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogPortal>
          <AlertDialogBackdrop />
          <AlertDialogPopup>
            <AlertDialogTitle>
              {isSubscribed && selectedPlan
                ? `${getSwitchDirection(selectedPlan) === "upgrade" ? "Upgrade" : getSwitchDirection(selectedPlan) === "downgrade" ? "Downgrade" : "Switch"} to ${selectedPlan.name}?`
                : `Subscribe to ${selectedPlan?.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isSubscribed && selectedPlan
                ? getSwitchDirection(selectedPlan) === "downgrade"
                  ? `You'll be downgraded to the ${selectedPlan.name} plan. A prorated credit will be applied to your next invoice.`
                  : `You'll be upgraded to the ${selectedPlan.name} plan. The prorated difference will be added to your next invoice.`
                : `You're about to subscribe to the ${selectedPlan?.name} plan at $${selectedPlan ? getPrice(selectedPlan) : 0}/month${isYearly ? " (billed yearly)" : ""}.`}
            </AlertDialogDescription>

            {selectedPlan && (
              <div className="pricing-page__confirm-summary">
                <div className="pricing-page__confirm-row">
                  <span>
                    {selectedPlan.name} Plan ({isYearly ? "Yearly" : "Monthly"})
                  </span>
                  <span>${getPrice(selectedPlan)}/mo</span>
                </div>
                {isYearly && (
                  <div className="pricing-page__confirm-row pricing-page__confirm-row--savings">
                    <span>Annual savings</span>
                    <span>-${getSavings(selectedPlan)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="pricing-page__confirm-actions">
              <AlertDialogClose disabled={switching}>Cancel</AlertDialogClose>
              <Button color="primary" onClick={handleConfirmUpgrade} disabled={switching}>
                {switching
                  ? "Switching…"
                  : isSubscribed && selectedPlan
                    ? `Confirm ${getSwitchDirection(selectedPlan) === "upgrade" ? "Upgrade" : getSwitchDirection(selectedPlan) === "downgrade" ? "Downgrade" : "Switch"}`
                    : "Confirm"}
              </Button>
            </div>
          </AlertDialogPopup>
        </AlertDialogPortal>
      </AlertDialog>
    </div>
  );
}
