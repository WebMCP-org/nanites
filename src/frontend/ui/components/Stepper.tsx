import * as React from "react";
import { cx } from "./_internal/class-names.js";
import { CheckIcon, SpinnerIcon } from "./_internal/icons.js";

export type StepperOrientation = "horizontal" | "vertical";
export type StepperState = "active" | "completed" | "inactive" | "loading";

export type StepIndicators = {
  active?: React.ReactNode;
  completed?: React.ReactNode;
  inactive?: React.ReactNode;
  loading?: React.ReactNode;
};

const defaultStepIndicators: StepIndicators = {};

export interface StepperContextValue {
  activeStep: number;
  setActiveStep: (step: number) => void;
  stepsCount: number;
  orientation: StepperOrientation;
  indicators: StepIndicators;
  idPrefix: string;
  registerTrigger: (step: number, node: HTMLButtonElement | null) => void;
  focusNext: (step: number) => void;
  focusPrev: (step: number) => void;
  focusFirst: () => void;
  focusLast: () => void;
}

export interface StepItemContextValue {
  step: number;
  state: StepperState;
  isDisabled: boolean;
  isLoading: boolean;
}

const StepperContext = React.createContext<StepperContextValue | undefined>(undefined);
const StepItemContext = React.createContext<StepItemContextValue | undefined>(undefined);

export function useStepper() {
  const context = React.use(StepperContext);

  if (!context) {
    throw new Error("useStepper must be used within a Stepper");
  }

  return context;
}

export function useStepItem() {
  const context = React.use(StepItemContext);

  if (!context) {
    throw new Error("useStepItem must be used within a StepperItem");
  }

  return context;
}

export interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: number;
  value?: number;
  onValueChange?: (value: number) => void;
  orientation?: StepperOrientation;
  indicators?: StepIndicators;
}

export function Stepper({
  defaultValue = 1,
  value,
  onValueChange,
  orientation = "horizontal",
  indicators = defaultStepIndicators,
  className,
  children,
  ref,
  ...props
}: StepperProps & { ref?: React.Ref<HTMLDivElement> }) {
  const generatedId = React.useId();
  const idPrefix = `stepper-${generatedId}`;
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const triggerNodesRef = React.useRef<Map<number, HTMLButtonElement> | null>(null);
  if (triggerNodesRef.current === null) {
    triggerNodesRef.current = new Map<number, HTMLButtonElement>();
  }
  const triggerNodes = triggerNodesRef.current;
  const [triggerSteps, setTriggerSteps] = React.useState<number[]>([]);
  const activeStep = value ?? uncontrolledValue;

  const setActiveStep = React.useCallback(
    (step: number) => {
      if (value === undefined) {
        setUncontrolledValue(step);
      }

      onValueChange?.(step);
    },
    [onValueChange, value],
  );

  const registerTrigger = React.useCallback(
    (step: number, node: HTMLButtonElement | null) => {
      if (node) {
        triggerNodes.set(step, node);
        setTriggerSteps((steps) => (steps.includes(step) ? steps : [...steps, step]));
        return;
      }

      triggerNodes.delete(step);
      setTriggerSteps((steps) => steps.filter((currentStep) => currentStep !== step));
    },
    [triggerNodes],
  );

  const focusStep = React.useCallback(
    (step: number) => {
      triggerNodes.get(step)?.focus();
    },
    [triggerNodes],
  );

  const getEnabledSteps = React.useCallback(
    () =>
      triggerSteps.filter((step) => {
        const node = triggerNodes.get(step);
        return node && !node.disabled;
      }),
    [triggerNodes, triggerSteps],
  );

  const focusNext = React.useCallback(
    (step: number) => {
      const enabledSteps = getEnabledSteps();
      const currentIndex = enabledSteps.indexOf(step);

      if (currentIndex === -1 || enabledSteps.length === 0) {
        return;
      }

      focusStep(enabledSteps[(currentIndex + 1) % enabledSteps.length]);
    },
    [focusStep, getEnabledSteps],
  );

  const focusPrev = React.useCallback(
    (step: number) => {
      const enabledSteps = getEnabledSteps();
      const currentIndex = enabledSteps.indexOf(step);

      if (currentIndex === -1 || enabledSteps.length === 0) {
        return;
      }

      focusStep(enabledSteps[(currentIndex - 1 + enabledSteps.length) % enabledSteps.length]);
    },
    [focusStep, getEnabledSteps],
  );

  const focusFirst = React.useCallback(() => {
    const [firstStep] = getEnabledSteps();

    if (firstStep !== undefined) {
      focusStep(firstStep);
    }
  }, [focusStep, getEnabledSteps]);

  const focusLast = React.useCallback(() => {
    const enabledSteps = getEnabledSteps();
    const lastStep = enabledSteps[enabledSteps.length - 1];

    if (lastStep !== undefined) {
      focusStep(lastStep);
    }
  }, [focusStep, getEnabledSteps]);

  const contextValue = React.useMemo<StepperContextValue>(
    () => ({
      activeStep,
      setActiveStep,
      stepsCount: triggerSteps.length,
      orientation,
      indicators,
      idPrefix,
      registerTrigger,
      focusNext,
      focusPrev,
      focusFirst,
      focusLast,
    }),
    [
      activeStep,
      focusFirst,
      focusLast,
      focusNext,
      focusPrev,
      idPrefix,
      indicators,
      orientation,
      registerTrigger,
      setActiveStep,
      triggerSteps.length,
    ],
  );

  return (
    <StepperContext.Provider value={contextValue}>
      <div ref={ref} className={cx("stepper", className)} data-orientation={orientation} {...props}>
        {children}
      </div>
    </StepperContext.Provider>
  );
}

export type StepperNavProps = React.ComponentPropsWithoutRef<"nav">;

export function StepperNav({
  className,
  ref,
  role,
  ...props
}: StepperNavProps & { ref?: React.Ref<HTMLElement> }) {
  const { activeStep, orientation } = useStepper();

  return (
    <nav
      ref={ref}
      role={role ?? "tablist"}
      aria-orientation={orientation}
      className={cx("stepper__nav", className)}
      data-active-step={activeStep}
      data-orientation={orientation}
      {...props}
    />
  );
}

export interface StepperItemProps extends React.HTMLAttributes<HTMLDivElement> {
  step: number;
  completed?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

export function StepperItem({
  step,
  completed = false,
  disabled = false,
  loading = false,
  className,
  ref,
  ...props
}: StepperItemProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { activeStep } = useStepper();
  const isLoading = loading && step === activeStep;
  const state: StepperState = isLoading
    ? "loading"
    : activeStep === step
      ? "active"
      : completed || step < activeStep
        ? "completed"
        : "inactive";

  return (
    <StepItemContext.Provider value={{ step, state, isDisabled: disabled, isLoading }}>
      <div
        ref={ref}
        role="presentation"
        className={cx("stepper__item", className)}
        data-disabled={disabled ? "" : undefined}
        data-loading={isLoading ? "" : undefined}
        data-state={state}
        {...props}
      />
    </StepItemContext.Provider>
  );
}

export type StepperTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function StepperTrigger({
  className,
  children,
  disabled,
  id,
  "aria-controls": ariaControls,
  tabIndex,
  onClick,
  onKeyDown,
  ref,
  ...props
}: StepperTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const {
    activeStep,
    focusFirst,
    focusLast,
    focusNext,
    focusPrev,
    idPrefix,
    registerTrigger,
    setActiveStep,
  } = useStepper();
  const { isDisabled, isLoading, state, step } = useStepItem();
  const isSelected = activeStep === step;
  const triggerId = id ?? `${idPrefix}-trigger-${step}`;
  const panelId = ariaControls ?? `${idPrefix}-panel-${step}`;

  const setTriggerRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      registerTrigger(step, node);
      assignRef(ref, node);
    },
    [ref, registerTrigger, step],
  );

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);

    if (!event.defaultPrevented) {
      setActiveStep(step);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);

    if (event.defaultPrevented) {
      return;
    }

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        focusNext(step);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusPrev(step);
        break;
      case "End":
        event.preventDefault();
        focusLast();
        break;
      case "Home":
        event.preventDefault();
        focusFirst();
        break;
      case " ":
      case "Enter":
        event.preventDefault();
        setActiveStep(step);
        break;
    }
  };

  return (
    <button
      type="button"
      ref={setTriggerRef}
      role="tab"
      id={triggerId}
      aria-controls={panelId}
      aria-selected={isSelected}
      className={cx("stepper__trigger", className)}
      data-loading={isLoading ? "" : undefined}
      data-state={state}
      disabled={disabled ?? isDisabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={typeof tabIndex === "number" ? tabIndex : isSelected ? 0 : -1}
      {...props}
    >
      {children}
    </button>
  );
}

export type StepperIndicatorProps = React.ComponentPropsWithoutRef<"span">;

export function StepperIndicator({
  className,
  children,
  ref,
  ...props
}: StepperIndicatorProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const { indicators } = useStepper();
  const { isLoading, state, step } = useStepItem();
  const indicator = getIndicatorContent({ children, indicators, isLoading, state, step });

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cx("stepper__indicator", className)}
      data-loading={isLoading ? "" : undefined}
      data-state={state}
      {...props}
    >
      <span className="stepper__indicator-content">{indicator}</span>
    </span>
  );
}

export type StepperSeparatorProps = React.ComponentPropsWithoutRef<"span">;

export function StepperSeparator({
  className,
  ref,
  ...props
}: StepperSeparatorProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const { state } = useStepItem();

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cx("stepper__separator", className)}
      data-state={state}
      {...props}
    />
  );
}

export type StepperTitleProps = React.ComponentPropsWithoutRef<"h3">;

export function StepperTitle({
  className,
  children,
  ref,
  ...props
}: StepperTitleProps & { ref?: React.Ref<HTMLHeadingElement> }) {
  const { state } = useStepItem();

  return (
    <h3 ref={ref} className={cx("stepper__title", className)} data-state={state} {...props}>
      {children}
    </h3>
  );
}

export type StepperDescriptionProps = React.ComponentPropsWithoutRef<"div">;

export function StepperDescription({
  className,
  ref,
  ...props
}: StepperDescriptionProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { state } = useStepItem();

  return (
    <div
      ref={ref}
      className={cx("stepper__description", className)}
      data-state={state}
      {...props}
    />
  );
}

export type StepperPanelProps = React.ComponentPropsWithoutRef<"div">;

export function StepperPanel({
  className,
  ref,
  ...props
}: StepperPanelProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { activeStep } = useStepper();

  return (
    <div
      ref={ref}
      className={cx("stepper__panel", className)}
      data-active-step={activeStep}
      {...props}
    />
  );
}

export interface StepperContentProps extends React.ComponentPropsWithoutRef<"div"> {
  value: number;
  forceMount?: boolean;
}

export function StepperContent({
  value,
  forceMount = false,
  className,
  children,
  id,
  "aria-labelledby": ariaLabelledBy,
  ref,
  ...props
}: StepperContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { activeStep, idPrefix } = useStepper();
  const isActive = activeStep === value;

  if (!forceMount && !isActive) {
    return null;
  }

  return (
    <div
      ref={ref}
      role="tabpanel"
      id={id ?? `${idPrefix}-panel-${value}`}
      aria-labelledby={ariaLabelledBy ?? `${idPrefix}-trigger-${value}`}
      className={cx("stepper__content", !isActive && "stepper__content--hidden", className)}
      data-state={isActive ? "active" : "inactive"}
      hidden={!isActive}
      tabIndex={0}
      {...props}
    >
      {children}
    </div>
  );
}

type GetIndicatorContentArgs = {
  children: React.ReactNode;
  indicators: StepIndicators;
  isLoading: boolean;
  state: StepperState;
  step: number;
};

function getIndicatorContent({
  children,
  indicators,
  isLoading,
  state,
  step,
}: GetIndicatorContentArgs) {
  if (isLoading && indicators.loading !== undefined) {
    return indicators.loading;
  }

  if (state === "completed" && indicators.completed !== undefined) {
    return indicators.completed;
  }

  if (state === "active" && indicators.active !== undefined) {
    return indicators.active;
  }

  if (state === "inactive" && indicators.inactive !== undefined) {
    return indicators.inactive;
  }

  if (children !== undefined && children !== null) {
    return children;
  }

  if (isLoading) {
    return <SpinnerIcon />;
  }

  if (state === "completed") {
    return <CheckIcon />;
  }

  return step;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    (ref as React.MutableRefObject<T | null>).current = value;
  }
}
