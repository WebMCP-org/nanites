import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { Badge, type BadgeColor } from "./Badge.js";
import { Progress, ProgressIndicator, ProgressTrack } from "./Progress.js";
import { cx } from "./_internal/class-names.js";
import { CheckIcon, ChevronRightIcon, SpinnerIcon, XIcon } from "./_internal/icons.js";

export type TestStatusValue = "passed" | "failed" | "skipped" | "running";

const STATUS_COLOR: Record<TestStatusValue, BadgeColor> = {
  passed: "success",
  failed: "destructive",
  skipped: "warning",
  running: "primary",
};

const STATUS_LABEL: Record<TestStatusValue, string> = {
  passed: "PASS",
  failed: "FAIL",
  skipped: "SKIP",
  running: "RUN",
};

export interface TestSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration?: number;
}

export interface TestResultsProps extends React.HTMLAttributes<HTMLDivElement> {
  summary: TestSummary;
}

/**
 * Displays a test suite report with summary stats, progress bar, and
 * collapsible per-suite results.
 */
export function TestResults({
  className,
  summary,
  children,
  ref,
  ...props
}: TestResultsProps & { ref?: React.Ref<HTMLDivElement> }) {
  const percent = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;
  const overall: TestStatusValue = summary.failed > 0 ? "failed" : "passed";

  return (
    <div ref={ref} className={cx("test-results", className)} data-status={overall} {...props}>
      <div className="test-results__header">
        <div className="test-results__summary">
          <Badge color={STATUS_COLOR[overall]} className="test-results__overall">
            {overall === "passed" ? "All tests passed" : `${summary.failed} failed`}
          </Badge>
          <span className="test-results__stats">
            <span className="test-results__stat test-results__stat--passed">
              {summary.passed} passed
            </span>
            <span className="test-results__stat test-results__stat--failed">
              {summary.failed} failed
            </span>
            <span className="test-results__stat test-results__stat--skipped">
              {summary.skipped} skipped
            </span>
            {summary.duration !== undefined ? (
              <span className="test-results__stat">{(summary.duration / 1000).toFixed(2)}s</span>
            ) : null}
          </span>
        </div>
        <Progress
          value={percent}
          color={overall === "failed" ? "destructive" : "success"}
          className="test-results__progress"
        >
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      </div>
      <div className="test-results__body">{children}</div>
    </div>
  );
}

export interface TestSuiteProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Root>,
  "className"
> {
  className?: string;
  name: string;
  status: TestStatusValue;
}

export function TestSuite({
  className,
  name,
  status,
  defaultOpen,
  children,
  ref,
  ...props
}: TestSuiteProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCollapsible.Root
      ref={ref}
      className={cx("test-results__suite", className)}
      defaultOpen={defaultOpen ?? status === "failed"}
      data-status={status}
      {...props}
    >
      <BaseCollapsible.Trigger className="test-results__suite-trigger">
        <span className="test-results__suite-icon" aria-hidden="true">
          <ChevronRightIcon />
        </span>
        <Badge color={STATUS_COLOR[status]} size="sm">
          {STATUS_LABEL[status]}
        </Badge>
        <span className="test-results__suite-name">{name}</span>
      </BaseCollapsible.Trigger>
      <BaseCollapsible.Panel className="test-results__suite-content">
        <ul className="test-results__suite-tests">{children}</ul>
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}

export interface TestProps extends React.LiHTMLAttributes<HTMLLIElement> {
  name: string;
  status: TestStatusValue;
  duration?: number;
}

export function Test({
  className,
  name,
  status,
  duration,
  children,
  ref,
  ...props
}: TestProps & { ref?: React.Ref<HTMLLIElement> }) {
  return (
    <li
      ref={ref}
      className={cx("test-results__test", `test-results__test--${status}`, className)}
      data-status={status}
      {...props}
    >
      <TestStatus status={status} />
      <span className="test-results__test-name">{name}</span>
      {duration !== undefined ? (
        <span className="test-results__test-duration">{duration}ms</span>
      ) : null}
      {children ? <div className="test-results__test-children">{children}</div> : null}
    </li>
  );
}

export interface TestStatusProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: TestStatusValue;
}

export function TestStatus({
  className,
  status,
  ref,
  ...props
}: TestStatusProps & { ref?: React.Ref<HTMLSpanElement> }) {
  const icon =
    status === "passed" ? (
      <CheckIcon />
    ) : status === "failed" ? (
      <XIcon />
    ) : status === "running" ? (
      <SpinnerIcon />
    ) : (
      <span aria-hidden="true">·</span>
    );

  return (
    <span
      ref={ref}
      className={cx("test-results__test-status", `test-results__test-status--${status}`, className)}
      aria-label={status}
      {...props}
    >
      {icon}
    </span>
  );
}

export interface TestErrorProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Error message or stack trace. */
  message: string;
}

export function TestError({
  className,
  message,
  ref,
  ...props
}: TestErrorProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("test-results__error", className)} {...props}>
      <pre className="test-results__error-text">{message}</pre>
    </div>
  );
}
