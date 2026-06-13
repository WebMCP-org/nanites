import "./observability.css";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  ChartBarIcon,
  CoinVerticalIcon,
  GitPullRequestIcon,
  GitBranchIcon,
  GithubLogoIcon,
  ListMagnifyingGlassIcon,
  PulseIcon,
  RobotIcon,
  TableIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RoutePendingPage } from "#/frontend/lib/route-state.tsx";
import type { BrowserNanitesContext, SessionInstallationSnapshot } from "#/frontend/lib/auth.ts";
import { useBrowserInstallationSelection } from "#/frontend/lib/browser-installation-selection.ts";
import { Avatar } from "#/frontend/ui/components/Avatar.tsx";
import { Badge, type BadgeColor } from "#/frontend/ui/components/Badge.tsx";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { Card } from "#/frontend/ui/components/Card.tsx";
import {
  Select,
  SelectList,
  SelectOption,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "#/frontend/ui/components/Select.tsx";
import {
  fetchObservabilityEventDetail,
  fetchObservabilityDashboard,
  observabilityDashboardQueryKey,
  observabilityEventDetailQueryKey,
  type ObservabilityDashboardData,
} from "./-queries.ts";
import {
  OBSERVABILITY_SEARCH_RANGES,
  OBSERVABILITY_SEARCH_TABS,
  cleanObservabilitySearch,
  observabilitySearchSchema,
  type ObservabilitySearch,
} from "./-search.ts";
import { InstallationFilterSelect } from "./-installation-filter-select.tsx";
import { ObservabilityInstallationRequiredState } from "./-installation-required-state.tsx";
import { ObservabilityFilterSelectControl } from "./-filter-select-control.tsx";
import type {
  AuditFeedRow,
  CostPoint,
  ImpactTrendPoint,
  KpiMetric,
  NaniteCreatorPoint,
  NaniteCatalogRow,
  ObservabilityDashboardFilterOptions,
  ObservabilityEventDetail,
  ObservabilityEventRow,
  ObservabilityImpactSummary,
  RunActorPoint,
  RunFeedRow,
  RunOutcomePoint,
  RunTrendPoint,
} from "#/backend/observability/queries.ts";

const allFilterValue = "__all_observability_values__";
const dashboardTableRowLimit = 12;
const repositoryPreviewLimit = 2;
const liveRefreshIntervalMs = 30_000;
const defaultRange: ObservabilitySearch["range"] = "7d";
const rangeLabels = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
} as const satisfies Record<ObservabilitySearch["range"], string>;
const emptyFilterOptions: ObservabilityDashboardFilterOptions = {
  repositories: [],
  nanites: [],
  creators: [],
  outcomes: [],
  surfaces: [],
};
const tabLabels = {
  overview: "Overview",
  impact: "Impact",
  people: "People",
  nanites: "Nanites",
  runs: "Runs",
  audit: "Audit",
} as const satisfies Record<ObservabilitySearch["tab"], string>;
const costChartColor = "var(--app-control-dark)";
const chartColors = [
  "var(--app-control-dark)",
  "var(--app-accent)",
  "var(--sigvelo-success-fill-mid)",
  "var(--sigvelo-warning-fill-mid)",
  "var(--sigvelo-destructive-fill-mid)",
  "var(--app-chat-muted)",
] as const;

const numberFormatter = new Intl.NumberFormat();
const usdFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const preciseUsdFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const summaryMetricKeys = [
  "successful-runs",
  "merged-prs",
  "lines-changed",
  "active-nanites",
  "waiting-runs",
  "estimated-cost",
] as const;

type SearchPatch = Partial<ObservabilitySearch>;
type ChartPoint = {
  key: string;
  label: string;
  value: number;
  formattedValue: string;
};
type ObservabilityTableColumn<TRow> = {
  header: string;
  render: (row: TRow) => ReactNode;
};
type SummaryMetricKey = (typeof summaryMetricKeys)[number];
type SummaryMetric = {
  key: SummaryMetricKey;
  metric: KpiMetric;
};
type GitHubIdentityPerson = {
  eyebrow: string;
  title: string;
  fallback: string;
  avatarUrl: string | undefined;
  profileLogin?: string;
  detail?: string;
};

export const Route = createFileRoute("/_authenticated/observability")({
  validateSearch: observabilitySearchSchema,
  component: ObservabilityRoute,
  pendingComponent: RoutePendingPage,
});

function formatUsd(value: number): string {
  return (Math.abs(value) < 1 ? preciseUsdFormatter : usdFormatter).format(value);
}

function formatUsdMicros(value: number): string {
  return formatUsd(value / 1_000_000);
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatKpi(metric: KpiMetric): string {
  return metric.unit === "usd-micros" ? formatUsdMicros(metric.value) : formatNumber(metric.value);
}

function withAvatarSize(avatarUrl: string | null | undefined, size: number): string | undefined {
  if (!avatarUrl) {
    return undefined;
  }

  try {
    const url = new URL(avatarUrl);
    url.searchParams.set("s", String(size));
    return url.toString();
  } catch {
    return avatarUrl;
  }
}

function githubProfileUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}`;
}

function avatarFallback(value: string | null | undefined): string {
  return (value ?? "?").slice(0, 2).toUpperCase();
}

function actorAvatarUrl(session: BrowserNanitesContext | null | undefined): string | null {
  const actor = session?.actor;
  return actor && "avatar_url" in actor && typeof actor.avatar_url === "string"
    ? actor.avatar_url
    : null;
}

function actorIdentityPerson(
  session: BrowserNanitesContext | null | undefined,
): GitHubIdentityPerson {
  const login = session?.actor.login;

  return {
    eyebrow: "Signed in",
    title: login ?? "GitHub user",
    fallback: avatarFallback(login),
    avatarUrl: withAvatarSize(actorAvatarUrl(session), 64),
    profileLogin: login,
  };
}

function installationIdentityPerson(
  installation: SessionInstallationSnapshot | null | undefined,
): GitHubIdentityPerson {
  const login = installation?.account.login;

  return {
    eyebrow: "Installation",
    title: login ?? "No installation selected",
    fallback: avatarFallback(login),
    avatarUrl: withAvatarSize(installation?.account.avatar_url, 64),
    detail: installation ? `#${installation.id}` : "Choose a GitHub installation",
  };
}

function tabSearch(
  search: ObservabilitySearch,
  tab: ObservabilitySearch["tab"],
): ObservabilitySearch {
  return observabilitySearchSchema.parse({
    ...search,
    tab,
    cursor: undefined,
    selectedEvent: undefined,
  });
}

function readKpi(metrics: readonly KpiMetric[], key: string): KpiMetric | null {
  return metrics.find((metric) => metric.key === key) ?? null;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateFormatter.format(date);
}

function formatOutcome(value: string): string {
  return value.replaceAll("_", " ");
}

function outcomeBadgeColor(value: string | null): BadgeColor {
  switch (value) {
    case "success":
    case "complete":
      return "success";
    case "failure":
    case "fail":
    case "denied":
      return "destructive";
    case "waiting_for_human":
    case "running":
      return "warning";
    default:
      return "neutral";
  }
}

function outcomeColor(value: string, index: number): string {
  switch (value) {
    case "success":
    case "complete":
      return "var(--sigvelo-success-fill-mid)";
    case "failure":
    case "fail":
    case "denied":
      return "var(--sigvelo-destructive-fill-mid)";
    case "waiting_for_human":
    case "running":
      return "var(--sigvelo-warning-fill-mid)";
    default:
      return chartColors[index % chartColors.length];
  }
}

function includeSelectedOption(options: readonly string[], selected: string | undefined): string[] {
  if (!selected || options.includes(selected)) {
    return [...options];
  }

  return [selected, ...options];
}

function hasResettableFilters(search: ObservabilitySearch): boolean {
  return Boolean(
    search.repository ??
    search.naniteId ??
    search.creator ??
    search.outcome ??
    search.surface ??
    search.search,
  );
}

function resetFiltersPatch(): SearchPatch {
  return {
    range: defaultRange,
    repository: undefined,
    naniteId: undefined,
    creator: undefined,
    outcome: undefined,
    surface: undefined,
    search: undefined,
    selectedEvent: undefined,
  };
}

function costChartPoints(points: readonly CostPoint[]): ChartPoint[] {
  return points.map((point) => {
    const value = point.estimatedCostUsdMicros / 1_000_000;
    return {
      key: point.key,
      label: point.label,
      value,
      formattedValue: formatUsd(value),
    };
  });
}

function runTrendChartPoints(points: readonly RunTrendPoint[]) {
  return points.map((point) => ({
    label: point.label,
    runs: point.runCount,
    successful: point.successfulRuns,
    failed: point.failedRuns,
    waiting: point.waitingRuns,
    noChange: point.noChangeRuns,
  }));
}

function impactTrendChartPoints(points: readonly ImpactTrendPoint[]) {
  return points.map((point) => ({
    label: point.label,
    linesChanged: point.outputLinesChanged,
    outputPullRequests: point.outputPullRequests,
    mergedPullRequests: point.mergedPullRequests,
    outputLinkedRuns: point.outputLinkedRuns,
    changedFiles: point.outputChangedFiles,
  }));
}

function countChartPoints(points: readonly CostPoint[]): ChartPoint[] {
  return points.map((point) => ({
    key: point.key,
    label: point.label,
    value: point.count,
    formattedValue: formatNumber(point.count),
  }));
}

function creatorChartPoints(points: readonly NaniteCreatorPoint[]): ChartPoint[] {
  return points.map((point) => ({
    key: point.key,
    label: point.label,
    value: point.naniteCount,
    formattedValue: formatNumber(point.naniteCount),
  }));
}

function actorChartPoints(points: readonly RunActorPoint[]): ChartPoint[] {
  return points.map((point) => ({
    key: point.key,
    label: point.label,
    value: point.runCount,
    formattedValue: formatNumber(point.runCount),
  }));
}

function OutcomeBadge({ value }: { readonly value: string | null }) {
  const label = value ? formatOutcome(value) : "unknown";
  return (
    <Badge variant="outline" color={outcomeBadgeColor(value)} size="sm">
      {label}
    </Badge>
  );
}

function SummaryMetricIcon({ metricKey }: { readonly metricKey: SummaryMetricKey }) {
  switch (metricKey) {
    case "successful-runs":
      return <PulseIcon size={18} aria-hidden="true" />;
    case "merged-prs":
      return <GitBranchIcon size={18} aria-hidden="true" />;
    case "lines-changed":
      return <ChartBarIcon size={18} aria-hidden="true" />;
    case "waiting-runs":
      return <ArrowClockwiseIcon size={18} aria-hidden="true" />;
    case "active-nanites":
      return <RobotIcon size={18} aria-hidden="true" />;
    case "estimated-cost":
      return <CoinVerticalIcon size={18} aria-hidden="true" />;
  }
}

function KpiStrip({ metrics }: { readonly metrics: readonly KpiMetric[] }) {
  const primaryMetric = readKpi(metrics, "runs");
  const secondaryMetrics = summaryMetricKeys.flatMap((key) => {
    const metric = readKpi(metrics, key);
    return metric ? [{ key, metric }] : [];
  });

  return (
    <Card className="observability-summary" aria-label="Observability metrics">
      <div className="observability-summary__primary">
        <span className="observability-summary__eyebrow">Nanite usage</span>
        <strong>{primaryMetric ? formatKpi(primaryMetric) : formatNumber(0)}</strong>
        <span>Runs in the selected range</span>
      </div>
      <div className="observability-summary__metrics">
        {secondaryMetrics.map(({ key, metric }: SummaryMetric) => (
          <article className="observability-summary-metric" key={key}>
            <span className="observability-summary-metric__icon">
              <SummaryMetricIcon metricKey={key} />
            </span>
            <span>{metric.label}</span>
            <strong>{formatKpi(metric)}</strong>
          </article>
        ))}
      </div>
    </Card>
  );
}

function ChartPanel({
  title,
  icon,
  children,
  className = "",
}: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <Card className={`observability-panel ${className}`.trim()}>
      <div className="observability-panel__header">
        <h2>
          {icon}
          {title}
        </h2>
      </div>
      {children}
    </Card>
  );
}

function EmptyChart({ children = "No data in scope." }: { readonly children?: ReactNode }) {
  return <div className="observability-empty-row observability-empty-row--chart">{children}</div>;
}

function TrendAreaChart({
  data,
  initialDimension,
  yAxisWidth,
  tickFormatter,
  tooltipFormatter,
  children,
}: {
  readonly data: readonly object[];
  readonly initialDimension: { readonly width: number; readonly height: number };
  readonly yAxisWidth: number;
  readonly tickFormatter?: (value: number) => string;
  readonly tooltipFormatter: (value: number, name: string) => string;
  readonly children: ReactNode;
}) {
  return (
    <div className="observability-chart observability-chart--area">
      <ResponsiveContainer width="100%" height="100%" initialDimension={initialDimension}>
        <AreaChart data={[...data]} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--app-border-soft)" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tickMargin={12}
            minTickGap={28}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tickMargin={10}
            width={yAxisWidth}
            allowDecimals={false}
            tickFormatter={tickFormatter}
          />
          <RechartsTooltip
            formatter={(value, name) => [
              tooltipFormatter(Number(value), String(name)),
              String(name),
            ]}
            labelFormatter={(label) => String(label)}
          />
          {children}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendArea({
  dataKey,
  name,
  color,
  fillOpacity,
  stackId,
  strokeWidth = 2,
  dot = false,
}: {
  readonly dataKey: string;
  readonly name: string;
  readonly color: string;
  readonly fillOpacity: number;
  readonly stackId?: string;
  readonly strokeWidth?: number;
  readonly dot?: boolean;
}) {
  return (
    <Area
      type="monotone"
      dataKey={dataKey}
      name={name}
      stackId={stackId}
      stroke={color}
      strokeWidth={strokeWidth}
      fill={color}
      fillOpacity={fillOpacity}
      dot={dot ? { fill: color, r: 3, strokeWidth: 0 } : false}
      activeDot={dot ? { r: 5, strokeWidth: 0 } : false}
      isAnimationActive={false}
    />
  );
}

function costPointTotals(points: readonly CostPoint[]) {
  return points.reduce(
    (totals, point) => ({
      estimatedCostUsdMicros: totals.estimatedCostUsdMicros + point.estimatedCostUsdMicros,
      totalTokens: totals.totalTokens + point.totalTokens,
      count: totals.count + point.count,
    }),
    { estimatedCostUsdMicros: 0, totalTokens: 0, count: 0 },
  );
}

function CostOverTimeChart({ points }: { readonly points: readonly CostPoint[] }) {
  const chartData = useMemo(() => costChartPoints(points), [points]);
  const totals = useMemo(() => costPointTotals(points), [points]);

  return (
    <ChartPanel title="Cost over time" icon={<CoinVerticalIcon size={17} aria-hidden="true" />}>
      {chartData.length ? (
        <>
          <TrendAreaChart
            data={chartData}
            initialDimension={{ width: 880, height: 320 }}
            yAxisWidth={76}
            tickFormatter={formatUsd}
            tooltipFormatter={formatUsd}
          >
            <TrendArea
              dataKey="value"
              name="Estimated cost"
              color={costChartColor}
              fillOpacity={0.16}
              strokeWidth={2.75}
              dot
            />
          </TrendAreaChart>
          <div className="observability-chart-stats" aria-label="Cost trend totals">
            <span>
              <strong>{formatUsdMicros(totals.estimatedCostUsdMicros)}</strong>
              <small>Total cost</small>
            </span>
            <span>
              <strong>{formatNumber(totals.totalTokens)}</strong>
              <small>Tokens</small>
            </span>
            <span>
              <strong>{formatNumber(totals.count)}</strong>
              <small>Requests</small>
            </span>
          </div>
        </>
      ) : (
        <EmptyChart>No usage in range.</EmptyChart>
      )}
    </ChartPanel>
  );
}

function runTrendTotals(points: readonly RunTrendPoint[]) {
  return points.reduce(
    (totals, point) => ({
      runs: totals.runs + point.runCount,
      successful: totals.successful + point.successfulRuns,
      failed: totals.failed + point.failedRuns,
    }),
    { runs: 0, successful: 0, failed: 0 },
  );
}

function UsageTrendChart({ points }: { readonly points: readonly RunTrendPoint[] }) {
  const chartData = useMemo(() => runTrendChartPoints(points), [points]);
  const totals = useMemo(() => runTrendTotals(points), [points]);

  return (
    <ChartPanel
      title="Runs over time"
      icon={<ActivityIcon size={17} aria-hidden="true" />}
      className="observability-panel--hero"
    >
      {chartData.length ? (
        <>
          <TrendAreaChart
            data={chartData}
            initialDimension={{ width: 880, height: 320 }}
            yAxisWidth={56}
            tooltipFormatter={formatNumber}
          >
            <TrendArea
              dataKey="successful"
              name="Successful"
              color="var(--sigvelo-success-fill-mid)"
              fillOpacity={0.24}
              stackId="runs"
            />
            <TrendArea
              dataKey="waiting"
              name="Waiting"
              color="var(--sigvelo-warning-fill-mid)"
              fillOpacity={0.2}
              stackId="runs"
            />
            <TrendArea
              dataKey="failed"
              name="Failed"
              color="var(--sigvelo-destructive-fill-mid)"
              fillOpacity={0.18}
              stackId="runs"
            />
            <TrendArea
              dataKey="noChange"
              name="No change"
              color="var(--app-chat-muted)"
              fillOpacity={0.14}
              stackId="runs"
            />
          </TrendAreaChart>
          <div className="observability-chart-stats" aria-label="Run trend totals">
            <span>
              <strong>{formatNumber(totals.runs)}</strong>
              <small>Total runs</small>
            </span>
            <span>
              <strong>{formatNumber(totals.successful)}</strong>
              <small>Successful</small>
            </span>
            <span>
              <strong>{formatNumber(totals.failed)}</strong>
              <small>Failed</small>
            </span>
          </div>
        </>
      ) : (
        <EmptyChart>No runs in range.</EmptyChart>
      )}
    </ChartPanel>
  );
}

function impactTrendTotals(points: readonly ImpactTrendPoint[]) {
  return points.reduce(
    (totals, point) => ({
      linesChanged: totals.linesChanged + point.outputLinesChanged,
      outputPullRequests: totals.outputPullRequests + point.outputPullRequests,
      mergedPullRequests: totals.mergedPullRequests + point.mergedPullRequests,
    }),
    { linesChanged: 0, outputPullRequests: 0, mergedPullRequests: 0 },
  );
}

function ImpactTrendChart({ points }: { readonly points: readonly ImpactTrendPoint[] }) {
  const chartData = useMemo(() => impactTrendChartPoints(points), [points]);
  const totals = useMemo(() => impactTrendTotals(points), [points]);

  return (
    <ChartPanel
      title="Nanite output over time"
      icon={<GitPullRequestIcon size={17} aria-hidden="true" />}
    >
      {chartData.length ? (
        <>
          <TrendAreaChart
            data={chartData}
            initialDimension={{ width: 520, height: 260 }}
            yAxisWidth={64}
            tooltipFormatter={formatNumber}
          >
            <TrendArea
              dataKey="linesChanged"
              name="Lines changed"
              color="var(--app-control-dark)"
              fillOpacity={0.14}
              strokeWidth={2.75}
              dot
            />
          </TrendAreaChart>
          <div className="observability-chart-stats" aria-label="Impact trend totals">
            <span>
              <strong>{formatNumber(totals.linesChanged)}</strong>
              <small>Lines changed</small>
            </span>
            <span>
              <strong>{formatNumber(totals.outputPullRequests)}</strong>
              <small>Output PRs</small>
            </span>
            <span>
              <strong>{formatNumber(totals.mergedPullRequests)}</strong>
              <small>Merged PRs</small>
            </span>
          </div>
        </>
      ) : (
        <EmptyChart>No output PR impact recorded.</EmptyChart>
      )}
    </ChartPanel>
  );
}

function MetricBarList({
  title,
  points,
  emptyText,
  selectedKey,
  onSelect,
}: {
  readonly title: string;
  readonly points: readonly ChartPoint[];
  readonly emptyText: string;
  readonly selectedKey?: string | undefined;
  readonly onSelect?: (point: ChartPoint) => void;
}) {
  const max = points.reduce((value, point) => Math.max(value, point.value), 0);

  return (
    <section className="observability-bar-section">
      <h3>{title}</h3>
      {points.length ? (
        <ol className="observability-bar-list">
          {points.map((point) => {
            const width = max > 0 ? Math.max(6, Math.round((point.value / max) * 100)) : 0;
            const label = (
              <div className="observability-bar-list__label">
                <span>{point.label}</span>
                <strong>{point.formattedValue}</strong>
              </div>
            );
            return (
              <li key={point.key} data-selected={selectedKey === point.key || undefined}>
                {onSelect ? (
                  <button
                    type="button"
                    className="observability-bar-list__button"
                    onClick={() => onSelect(point)}
                  >
                    {label}
                  </button>
                ) : (
                  label
                )}
                <div className="observability-bar-list__track">
                  <span style={{ inlineSize: `${width}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="observability-empty-row">{emptyText}</div>
      )}
    </section>
  );
}

function RunOutcomeChart({ points }: { readonly points: readonly RunOutcomePoint[] }) {
  const total = points.reduce((sum, point) => sum + point.count, 0);

  return (
    <ChartPanel title="Run outcomes" icon={<ActivityIcon size={17} aria-hidden="true" />}>
      {points.length ? (
        <div className="observability-outcome-chart">
          <div className="observability-chart observability-chart--donut">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 320, height: 224 }}
            >
              <PieChart>
                <RechartsTooltip
                  formatter={(value) => [formatNumber(Number(value)), "Runs"]}
                  labelFormatter={(label) => formatOutcome(String(label))}
                />
                <Pie
                  data={points}
                  dataKey="count"
                  nameKey="outcome"
                  innerRadius={52}
                  outerRadius={84}
                  paddingAngle={2}
                  stroke="var(--sigvelo-paper-color)"
                  isAnimationActive={false}
                >
                  {points.map((point, index) => (
                    <Cell key={point.outcome} fill={outcomeColor(point.outcome, index)} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="observability-donut-total" aria-label={`${formatNumber(total)} runs`}>
              <strong>{formatNumber(total)}</strong>
              <span>runs</span>
            </div>
          </div>
          <ul className="observability-chart-legend">
            {points.map((point, index) => (
              <li key={point.outcome}>
                <span style={{ backgroundColor: outcomeColor(point.outcome, index) }} />
                <span>{formatOutcome(point.outcome)}</span>
                <strong>{formatNumber(point.count)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyChart>No run outcomes recorded.</EmptyChart>
      )}
    </ChartPanel>
  );
}

function BreakdownBoard({
  costByNanite,
  costByRepository,
  costByModel,
  topNanitesByRunCount,
}: {
  readonly costByNanite: readonly ChartPoint[];
  readonly costByRepository: readonly ChartPoint[];
  readonly costByModel: readonly ChartPoint[];
  readonly topNanitesByRunCount: readonly ChartPoint[];
}) {
  return (
    <Card className="observability-breakdown-board">
      <div className="observability-panel__header">
        <h2>
          <ChartBarIcon size={17} aria-hidden="true" />
          Cost and usage breakdown
        </h2>
      </div>
      <div className="observability-breakdown-grid">
        <MetricBarList
          title="Cost by Nanite"
          points={costByNanite}
          emptyText="No Nanite costs in scope."
        />
        <MetricBarList
          title="Cost by repository"
          points={costByRepository}
          emptyText="No repository costs in scope."
        />
        <MetricBarList
          title="Cost by model"
          points={costByModel}
          emptyText="No model costs in scope."
        />
        <MetricBarList
          title="Top by run count"
          points={topNanitesByRunCount}
          emptyText="No runs in scope."
        />
      </div>
    </Card>
  );
}

function ObservabilityTabs({ search }: { readonly search: ObservabilitySearch }) {
  return (
    <nav className="observability-tabs" aria-label="Observability sections">
      {OBSERVABILITY_SEARCH_TABS.map((tab) => (
        <Link
          key={tab}
          to="/observability"
          search={tabSearch(search, tab)}
          className="observability-tab"
          data-active={search.tab === tab || undefined}
        >
          {tabLabels[tab]}
        </Link>
      ))}
    </nav>
  );
}

function GitHubIdentityPanel({
  session,
  selectedInstallation,
  creator,
  onSelectCreator,
}: {
  readonly session: BrowserNanitesContext | null | undefined;
  readonly selectedInstallation: SessionInstallationSnapshot | null;
  readonly creator: string | undefined;
  readonly onSelectCreator: (creator: string | undefined) => void;
}) {
  const actorLogin = session?.actor.login;

  return (
    <Card className="observability-github-panel">
      <GitHubIdentityPersonRow person={actorIdentityPerson(session)} />
      <GitHubIdentityPersonRow person={installationIdentityPerson(selectedInstallation)} />
      <GitHubIdentityActions
        actorLogin={actorLogin}
        creator={creator}
        onSelectCreator={onSelectCreator}
      />
    </Card>
  );
}

function GitHubIdentityPersonRow({ person }: { readonly person: GitHubIdentityPerson }) {
  return (
    <div className="observability-github-person">
      <Avatar.Root className="observability-github-avatar">
        {person.avatarUrl ? <Avatar.Image src={person.avatarUrl} alt="" /> : null}
        <Avatar.Fallback>{person.fallback}</Avatar.Fallback>
      </Avatar.Root>
      <div>
        <span>{person.eyebrow}</span>
        <strong>{person.title}</strong>
        {person.profileLogin ? (
          <a href={githubProfileUrl(person.profileLogin)} target="_blank" rel="noreferrer">
            <GithubLogoIcon size={14} aria-hidden="true" />
            Profile
          </a>
        ) : null}
        {person.detail ? <small>{person.detail}</small> : null}
      </div>
    </div>
  );
}

function GitHubIdentityActions({
  actorLogin,
  creator,
  onSelectCreator,
}: {
  readonly actorLogin: string | undefined;
  readonly creator: string | undefined;
  readonly onSelectCreator: (creator: string | undefined) => void;
}) {
  const actorSelected = Boolean(actorLogin && creator === actorLogin);

  return (
    <div className="observability-github-actions">
      <Button
        type="button"
        variant={actorSelected ? "normal" : "outline"}
        color={actorSelected ? "primary" : "neutral"}
        size="sm"
        disabled={!actorLogin}
        onClick={() => onSelectCreator(actorSelected ? undefined : actorLogin)}
      >
        <UsersIcon size={15} aria-hidden="true" />
        My Nanites
      </Button>
      {creator ? (
        <Button
          type="button"
          variant="ghost"
          color="neutral"
          size="sm"
          onClick={() => onSelectCreator(undefined)}
        >
          Clear creator
        </Button>
      ) : null}
    </div>
  );
}

function ImpactBoard({ impact }: { readonly impact: ObservabilityImpactSummary }) {
  const items = [
    {
      key: "pr-triggered",
      label: "PR-triggered runs",
      value: impact.prTriggeredRuns,
      icon: <GitPullRequestIcon size={18} aria-hidden="true" />,
    },
    {
      key: "successful-pr",
      label: "Successful PR runs",
      value: impact.successfulPrRuns,
      icon: <PulseIcon size={18} aria-hidden="true" />,
    },
    {
      key: "output-linked",
      label: "Output links",
      value: impact.outputLinkedRuns,
      icon: <ArrowSquareOutIcon size={18} aria-hidden="true" />,
    },
    {
      key: "output-prs",
      label: "Output PRs",
      value: impact.outputPullRequests,
      icon: <GitPullRequestIcon size={18} aria-hidden="true" />,
    },
    {
      key: "merged-prs",
      label: "Merged PRs",
      value: impact.mergedPullRequests,
      icon: <GitBranchIcon size={18} aria-hidden="true" />,
    },
    {
      key: "lines-changed",
      label: "Lines changed",
      value: impact.outputLinesChanged,
      icon: <ChartBarIcon size={18} aria-hidden="true" />,
    },
    {
      key: "files-changed",
      label: "Files changed",
      value: impact.outputChangedFiles,
      icon: <TableIcon size={18} aria-hidden="true" />,
    },
    {
      key: "no-change",
      label: "No-change runs",
      value: impact.noChangeRuns,
      icon: <RobotIcon size={18} aria-hidden="true" />,
    },
  ] as const;

  return (
    <Card className="observability-impact-board">
      <div className="observability-panel__header">
        <h2>
          <GitPullRequestIcon size={17} aria-hidden="true" />
          Nanite impact
        </h2>
        <Badge variant="outline" color="neutral">
          {formatNumber(impact.completedRuns)} completed
        </Badge>
      </div>
      <div className="observability-impact-grid">
        {items.map((item) => (
          <article className="observability-impact-metric" key={item.key}>
            <span>{item.icon}</span>
            <strong>{formatNumber(item.value)}</strong>
            <small>{item.label}</small>
          </article>
        ))}
      </div>
    </Card>
  );
}

function PeopleBoard({
  creatorPoints,
  actorPoints,
  costByActor,
  costByBillingUser,
  selectedCreator,
  onSelectCreator,
}: {
  readonly creatorPoints: readonly ChartPoint[];
  readonly actorPoints: readonly ChartPoint[];
  readonly costByActor: readonly ChartPoint[];
  readonly costByBillingUser: readonly ChartPoint[];
  readonly selectedCreator: string | undefined;
  readonly onSelectCreator: (creator: string | undefined) => void;
}) {
  return (
    <Card className="observability-breakdown-board">
      <div className="observability-panel__header">
        <h2>
          <UsersIcon size={17} aria-hidden="true" />
          GitHub activity
        </h2>
      </div>
      <div className="observability-breakdown-grid">
        <MetricBarList
          title="Nanites by creator"
          points={creatorPoints}
          emptyText="No creators in scope."
          selectedKey={selectedCreator}
          onSelect={(point) =>
            onSelectCreator(selectedCreator === point.key ? undefined : point.key)
          }
        />
        <MetricBarList title="Runs by actor" points={actorPoints} emptyText="No runs in scope." />
        <MetricBarList
          title="Cost by actor"
          points={costByActor}
          emptyText="No actor costs in scope."
        />
        <MetricBarList
          title="Cost by billing user"
          points={costByBillingUser}
          emptyText="No billing costs in scope."
        />
      </div>
    </Card>
  );
}

function EventRail({
  events,
  selectedEvent,
  onSelect,
}: {
  readonly events: readonly ObservabilityEventRow[];
  readonly selectedEvent: string | undefined;
  readonly onSelect: (eventId: string | undefined) => void;
}) {
  return (
    <Card className="observability-event-panel">
      <div className="observability-panel__header">
        <h2>
          <ListMagnifyingGlassIcon size={17} aria-hidden="true" />
          Recent events
        </h2>
      </div>
      <div className="observability-events">
        {events.length ? (
          events.map((event) => (
            <Button
              type="button"
              variant="ghost"
              color="neutral"
              className="observability-event"
              data-selected={selectedEvent === event.id}
              key={event.id}
              onClick={() => onSelect(selectedEvent === event.id ? undefined : event.id)}
            >
              <span>{formatDate(event.occurredAt)}</span>
              <strong>{event.title}</strong>
              <small>{event.subtitle}</small>
            </Button>
          ))
        ) : (
          <EmptyChart>No events recorded.</EmptyChart>
        )}
      </div>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly options: readonly string[];
  readonly allLabel: string;
  readonly onChange: (value: string | undefined) => void;
}) {
  const items = useMemo(
    () => [
      { label: allLabel, value: allFilterValue },
      ...options.map((option) => ({ label: option, value: option })),
    ],
    [allLabel, options],
  );

  return (
    <ObservabilityFilterSelectControl
      label={label}
      value={value ?? allFilterValue}
      items={items}
      onValueChange={(next) => onChange(next === allFilterValue ? undefined : next)}
    />
  );
}

function ObservabilityFilters({
  search,
  options,
  selectedInstallation,
  installations,
  onInstallationChange,
  onChange,
}: {
  readonly search: ObservabilitySearch;
  readonly options: ObservabilityDashboardFilterOptions;
  readonly selectedInstallation: SessionInstallationSnapshot | null;
  readonly installations: readonly SessionInstallationSnapshot[];
  readonly onInstallationChange: (installationId: number) => void;
  readonly onChange: (patch: SearchPatch) => void;
}) {
  const rangeItems = OBSERVABILITY_SEARCH_RANGES.map((range) => ({
    value: range,
    label: rangeLabels[range],
  }));

  return (
    <section className="observability-filters" aria-label="Observability filters">
      <InstallationFilterSelect
        selectedInstallation={selectedInstallation}
        installations={installations}
        onChange={onInstallationChange}
      />
      <div className="observability-filter">
        <span>Range</span>
        <Select
          value={search.range}
          items={rangeItems}
          onValueChange={(next: unknown) => {
            if (next === "24h" || next === "7d" || next === "30d") {
              onChange({ range: next });
            }
          }}
        >
          <SelectTrigger size="sm" aria-label="Range">
            <SelectValue />
          </SelectTrigger>
          <SelectPortal>
            <SelectPositioner>
              <SelectPopup>
                <SelectList>
                  {rangeItems.map((range) => (
                    <SelectOption key={range.value} value={range.value}>
                      {range.label}
                    </SelectOption>
                  ))}
                </SelectList>
              </SelectPopup>
            </SelectPositioner>
          </SelectPortal>
        </Select>
      </div>
      <FilterSelect
        label="Repository"
        value={search.repository}
        options={includeSelectedOption(options.repositories, search.repository)}
        allLabel="All repositories"
        onChange={(repository) => onChange({ repository })}
      />
      <FilterSelect
        label="Nanite"
        value={search.naniteId}
        options={includeSelectedOption(options.nanites, search.naniteId)}
        allLabel="All Nanites"
        onChange={(naniteId) => onChange({ naniteId })}
      />
      <FilterSelect
        label="Creator"
        value={search.creator}
        options={includeSelectedOption(options.creators, search.creator)}
        allLabel="All creators"
        onChange={(creator) => onChange({ creator })}
      />
      <FilterSelect
        label="Outcome"
        value={search.outcome}
        options={includeSelectedOption(options.outcomes, search.outcome)}
        allLabel="All outcomes"
        onChange={(outcome) => onChange({ outcome })}
      />
      <FilterSelect
        label="Surface"
        value={search.surface}
        options={includeSelectedOption(options.surfaces, search.surface)}
        allLabel="All surfaces"
        onChange={(surface) => onChange({ surface })}
      />
      <div className="observability-filter-actions">
        <Button
          type="button"
          variant={search.live ? "normal" : "outline"}
          color={search.live ? "primary" : "neutral"}
          size="sm"
          data-active={search.live || undefined}
          onClick={() => onChange({ live: !search.live })}
        >
          <ArrowClockwiseIcon size={15} aria-hidden="true" />
          Live
        </Button>
        <Button
          type="button"
          variant="ghost"
          color="neutral"
          size="sm"
          disabled={!hasResettableFilters(search) && search.range === defaultRange}
          onClick={() => onChange(resetFiltersPatch())}
        >
          Clear
        </Button>
      </div>
    </section>
  );
}

function ActiveFilterChips({
  search,
  onChange,
}: {
  readonly search: ObservabilitySearch;
  readonly onChange: (patch: SearchPatch) => void;
}) {
  const chips = [
    search.repository ? { key: "repository", label: `Repo: ${search.repository}` } : null,
    search.naniteId ? { key: "naniteId", label: `Nanite: ${search.naniteId}` } : null,
    search.creator ? { key: "creator", label: `Creator: ${search.creator}` } : null,
    search.outcome ? { key: "outcome", label: `Outcome: ${formatOutcome(search.outcome)}` } : null,
    search.surface ? { key: "surface", label: `Surface: ${search.surface}` } : null,
    search.search ? { key: "search", label: `Search: ${search.search}` } : null,
  ].filter((chip): chip is { key: keyof ObservabilitySearch; label: string } => chip !== null);

  if (chips.length === 0) {
    return null;
  }

  return (
    <ul className="observability-filter-chips" aria-label="Active filters">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Button
            type="button"
            variant="outline"
            color="neutral"
            size="xs"
            onClick={() => onChange({ [chip.key]: undefined })}
          >
            {chip.label}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function ObservabilityTablePanel({
  title,
  icon,
  children,
}: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card className="observability-table-panel">
      <h2>
        {icon}
        {title}
      </h2>
      <div className="observability-table-wrap">{children}</div>
    </Card>
  );
}

function ObservabilityDataTable<TRow extends { readonly id: string }>({
  rows,
  columns,
}: {
  readonly rows: readonly TRow[];
  readonly columns: readonly ObservabilityTableColumn<TRow>[];
}) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.header}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, dashboardTableRowLimit).map((row) => (
          <tr key={row.id}>
            {columns.map((column) => (
              <td key={column.header}>{column.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PrimaryDetailCell({
  primary,
  secondary,
}: {
  readonly primary: ReactNode;
  readonly secondary: ReactNode;
}) {
  return (
    <>
      <strong>{primary}</strong>
      <span>{secondary}</span>
    </>
  );
}

function NaniteTable({ rows }: { readonly rows: readonly NaniteCatalogRow[] }) {
  const columns: readonly ObservabilityTableColumn<NaniteCatalogRow>[] = [
    {
      header: "Name",
      render: (row) => <PrimaryDetailCell primary={row.name} secondary={row.naniteId} />,
    },
    { header: "Source", render: (row) => row.eventSourceType },
    {
      header: "Repos",
      render: (row) =>
        row.repositories.slice(0, repositoryPreviewLimit).join(", ") || row.repositoryCount,
    },
    { header: "Runs", render: (row) => formatNumber(row.runCount) },
    { header: "Cost", render: (row) => formatUsdMicros(row.estimatedCostUsdMicros) },
    { header: "Creator", render: (row) => row.creator ?? "Unknown" },
  ];

  return (
    <ObservabilityTablePanel title="Nanites" icon={<RobotIcon size={17} aria-hidden="true" />}>
      <ObservabilityDataTable rows={rows} columns={columns} />
    </ObservabilityTablePanel>
  );
}

function RunImpactCell({ row }: { readonly row: RunFeedRow }) {
  if (!row.outputPullRequestNumber) {
    return "No PR stats";
  }

  const linesChanged = (row.outputAdditions ?? 0) + (row.outputDeletions ?? 0);
  return (
    <PrimaryDetailCell
      primary={`PR #${row.outputPullRequestNumber} ${
        row.outputPullRequestMerged ? "merged" : "not merged"
      }`}
      secondary={`${formatNumber(linesChanged)} lines, ${formatNumber(row.outputChangedFiles ?? 0)} files`}
    />
  );
}

function RunTable({ rows }: { readonly rows: readonly RunFeedRow[] }) {
  const columns: readonly ObservabilityTableColumn<RunFeedRow>[] = [
    {
      header: "Run",
      render: (row) => <PrimaryDetailCell primary={row.naniteId} secondary={row.triggerKind} />,
    },
    { header: "Repository", render: (row) => row.repository },
    { header: "Status", render: (row) => <OutcomeBadge value={row.conclusion ?? row.status} /> },
    { header: "Actor", render: (row) => row.actor ?? "Unknown" },
    { header: "Cost", render: (row) => formatUsdMicros(row.estimatedCostUsdMicros) },
    { header: "Impact", render: (row) => <RunImpactCell row={row} /> },
    {
      header: "Result",
      render: (row) =>
        row.outputUrl ? (
          <a
            className="observability-table-link"
            href={row.outputUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open
            <ArrowSquareOutIcon size={13} aria-hidden="true" />
          </a>
        ) : (
          "None"
        ),
    },
    { header: "Started", render: (row) => formatDate(row.startedAt) },
  ];

  return (
    <ObservabilityTablePanel title="Runs" icon={<GitBranchIcon size={17} aria-hidden="true" />}>
      <ObservabilityDataTable rows={rows} columns={columns} />
    </ObservabilityTablePanel>
  );
}

function AuditTable({ rows }: { readonly rows: readonly AuditFeedRow[] }) {
  const columns: readonly ObservabilityTableColumn<AuditFeedRow>[] = [
    { header: "Event", render: (row) => row.eventName },
    { header: "Actor", render: (row) => row.actor ?? "Unknown" },
    { header: "Surface", render: (row) => row.surface },
    { header: "Target", render: (row) => row.targetId ?? row.targetType },
    { header: "Outcome", render: (row) => <OutcomeBadge value={row.outcome} /> },
    { header: "Time", render: (row) => formatDate(row.occurredAt) },
  ];

  return (
    <ObservabilityTablePanel title="Audit" icon={<TableIcon size={17} aria-hidden="true" />}>
      <ObservabilityDataTable rows={rows} columns={columns} />
    </ObservabilityTablePanel>
  );
}

function Dashboard({
  data,
  search,
  session,
  selectedInstallation,
  onSearchChange,
  onSelectEvent,
}: {
  readonly data: ObservabilityDashboardData;
  readonly search: ObservabilitySearch;
  readonly session: BrowserNanitesContext | null | undefined;
  readonly selectedInstallation: SessionInstallationSnapshot | null;
  readonly onSearchChange: (patch: SearchPatch) => void;
  readonly onSelectEvent: (eventId: string | undefined) => void;
}) {
  const costByNanite = useMemo(() => costChartPoints(data.overview.costByNanite), [data]);
  const costByRepository = useMemo(() => costChartPoints(data.overview.costByRepository), [data]);
  const costByModel = useMemo(() => costChartPoints(data.overview.costByModel), [data]);
  const costByActor = useMemo(() => costChartPoints(data.overview.costByActor), [data]);
  const costByBillingUser = useMemo(() => costChartPoints(data.overview.costByBillingUser), [data]);
  const creatorPoints = useMemo(() => creatorChartPoints(data.overview.nanitesByCreator), [data]);
  const actorPoints = useMemo(() => actorChartPoints(data.overview.runsByActor), [data]);
  const topNanitesByRunCount = useMemo(
    () => countChartPoints(data.overview.topNanitesByRunCount),
    [data],
  );

  switch (search.tab) {
    case "impact":
      return (
        <>
          <GitHubIdentityPanel
            session={session}
            selectedInstallation={selectedInstallation}
            creator={search.creator}
            onSelectCreator={(creator) => onSearchChange({ creator })}
          />
          <ImpactBoard impact={data.overview.impact} />
          <div className="observability-focus-grid">
            <ImpactTrendChart points={data.overview.impactTrend} />
            <RunOutcomeChart points={data.overview.runsByOutcome} />
          </div>
          <BreakdownBoard
            costByNanite={costByNanite}
            costByRepository={costByRepository}
            costByModel={costByModel}
            topNanitesByRunCount={topNanitesByRunCount}
          />
        </>
      );
    case "people":
      return (
        <>
          <GitHubIdentityPanel
            session={session}
            selectedInstallation={selectedInstallation}
            creator={search.creator}
            onSelectCreator={(creator) => onSearchChange({ creator })}
          />
          <PeopleBoard
            creatorPoints={creatorPoints}
            actorPoints={actorPoints}
            costByActor={costByActor}
            costByBillingUser={costByBillingUser}
            selectedCreator={search.creator}
            onSelectCreator={(creator) => onSearchChange({ creator })}
          />
          <div className="observability-tables">
            <NaniteTable rows={data.nanites} />
            <RunTable rows={data.runs} />
          </div>
        </>
      );
    case "nanites":
      return (
        <>
          <PeopleBoard
            creatorPoints={creatorPoints}
            actorPoints={actorPoints}
            costByActor={costByActor}
            costByBillingUser={costByBillingUser}
            selectedCreator={search.creator}
            onSelectCreator={(creator) => onSearchChange({ creator })}
          />
          <div className="observability-tables">
            <NaniteTable rows={data.nanites} />
          </div>
        </>
      );
    case "runs":
      return (
        <>
          <UsageTrendChart points={data.overview.runTrend} />
          <div className="observability-focus-grid">
            <RunOutcomeChart points={data.overview.runsByOutcome} />
            <ImpactBoard impact={data.overview.impact} />
          </div>
          <div className="observability-tables">
            <RunTable rows={data.runs} />
          </div>
        </>
      );
    case "audit":
      return (
        <>
          <EventRail
            events={data.overview.recentEvents}
            selectedEvent={search.selectedEvent}
            onSelect={onSelectEvent}
          />
          <div className="observability-tables">
            <AuditTable rows={data.audit} />
          </div>
        </>
      );
    case "overview":
      return (
        <>
          <KpiStrip metrics={data.overview.kpis} />
          <UsageTrendChart points={data.overview.runTrend} />
          <div className="observability-focus-grid">
            <ImpactTrendChart points={data.overview.impactTrend} />
            <RunOutcomeChart points={data.overview.runsByOutcome} />
          </div>
          <ImpactBoard impact={data.overview.impact} />
          <CostOverTimeChart points={data.overview.costOverTime} />
          <BreakdownBoard
            costByNanite={costByNanite}
            costByRepository={costByRepository}
            costByModel={costByModel}
            topNanitesByRunCount={topNanitesByRunCount}
          />
          <EventRail
            events={data.overview.recentEvents}
            selectedEvent={search.selectedEvent}
            onSelect={onSelectEvent}
          />
        </>
      );
  }
}

function ObservabilityHeader({ search }: { readonly search: ObservabilitySearch }) {
  return (
    <header className="observability-header">
      <div>
        <h1>Observability</h1>
        <nav aria-label="Authenticated app">
          <Link
            to="/nanites"
            search={
              search.installationId
                ? {
                    installationId: search.installationId,
                  }
                : undefined
            }
          >
            Nanites
          </Link>
          <Link to="/observability" activeProps={{ "data-active": true }}>
            Observability
          </Link>
        </nav>
      </div>
      <div className="observability-header__meta">
        <Badge variant="outline" color="neutral">
          {rangeLabels[search.range]}
        </Badge>
        {search.live ? <Badge color="success">Live</Badge> : null}
      </div>
    </header>
  );
}

function ObservabilityDashboardState({
  data,
  isPending,
  search,
  session,
  selectedInstallation,
  onSearchChange,
  onSelectEvent,
}: {
  readonly data: ObservabilityDashboardData | undefined;
  readonly isPending: boolean;
  readonly search: ObservabilitySearch;
  readonly session: BrowserNanitesContext | null | undefined;
  readonly selectedInstallation: SessionInstallationSnapshot | null;
  readonly onSearchChange: (patch: SearchPatch) => void;
  readonly onSelectEvent: (eventId: string | undefined) => void;
}) {
  if (isPending || !data) {
    return <RoutePendingPage />;
  }

  return (
    <Dashboard
      data={data}
      search={search}
      session={session}
      selectedInstallation={selectedInstallation}
      onSearchChange={onSearchChange}
      onSelectEvent={onSelectEvent}
    />
  );
}

function SelectedEventDetail({
  event,
  isPending,
  onClose,
}: {
  readonly event: ObservabilityEventDetail | null | undefined;
  readonly isPending: boolean;
  readonly onClose: () => void;
}) {
  if (isPending) {
    return (
      <Card className="observability-detail" aria-label="Selected event">
        <Button type="button" variant="outline" color="neutral" size="sm" onClick={onClose}>
          Close
        </Button>
        <p>Loading event...</p>
      </Card>
    );
  }

  if (!event) {
    return null;
  }

  return (
    <Card className="observability-detail" aria-label="Selected event">
      <Button type="button" variant="outline" color="neutral" size="sm" onClick={onClose}>
        Close
      </Button>
      <pre>{JSON.stringify(event, null, 2)}</pre>
    </Card>
  );
}

function useObservabilityDashboardQueries({
  scopedSearch,
  selectedInstallation,
  shouldCanonicalizeInstallation,
}: {
  readonly scopedSearch: ObservabilitySearch;
  readonly selectedInstallation: SessionInstallationSnapshot | null;
  readonly shouldCanonicalizeInstallation: boolean;
}) {
  const selectedEventId = scopedSearch.selectedEvent;
  const dataEnabled = selectedInstallation !== null && !shouldCanonicalizeInstallation;
  const { data: dashboard, isPending: isDashboardPending } = useQuery({
    queryKey: observabilityDashboardQueryKey(scopedSearch),
    queryFn: () => fetchObservabilityDashboard(scopedSearch),
    enabled: dataEnabled,
    refetchInterval: scopedSearch.live ? liveRefreshIntervalMs : false,
    throwOnError: true,
  });
  const { data: selectedEvent, isPending: selectedEventQueryPending } = useQuery({
    queryKey: observabilityEventDetailQueryKey(scopedSearch, selectedEventId),
    queryFn: () =>
      selectedEventId
        ? fetchObservabilityEventDetail(scopedSearch, selectedEventId)
        : Promise.resolve(null),
    enabled: dataEnabled && Boolean(selectedEventId),
    throwOnError: true,
  });

  return {
    dashboard,
    isDashboardPending,
    isSelectedEventPending: Boolean(selectedEventId) && selectedEventQueryPending,
    selectedEvent,
  };
}

function ObservabilityRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const normalizedSearch = useMemo(() => observabilitySearchSchema.parse(search), [search]);
  const { session, visibleInstallations, installationSelection, isPending } =
    useBrowserInstallationSelection(normalizedSearch.installationId);
  const selectedInstallation = installationSelection.installation;
  const selectedInstallationId = selectedInstallation?.id;
  const shouldCanonicalizeInstallation = installationSelection.canonicalInstallationId !== null;
  const scopedSearch = useMemo(
    () =>
      observabilitySearchSchema.parse({
        ...normalizedSearch,
        installationId: selectedInstallationId ?? normalizedSearch.installationId,
      }),
    [normalizedSearch, selectedInstallationId],
  );
  const selectedEventId = scopedSearch.selectedEvent;
  const { dashboard, isDashboardPending, selectedEvent, isSelectedEventPending } =
    useObservabilityDashboardQueries({
      scopedSearch,
      selectedInstallation,
      shouldCanonicalizeInstallation,
    });
  const setSearch = (patch: SearchPatch) => {
    void navigate({
      search: (previous) =>
        cleanObservabilitySearch({
          ...observabilitySearchSchema.parse(previous),
          ...patch,
          cursor: undefined,
        }),
      replace: true,
    });
  };
  const selectInstallation = (installationId: number) => {
    void navigate({
      search: (previous) =>
        cleanObservabilitySearch({
          ...observabilitySearchSchema.parse(previous),
          installationId,
          repository: undefined,
          naniteId: undefined,
          creator: undefined,
          outcome: undefined,
          surface: undefined,
          search: undefined,
          selectedEvent: undefined,
          cursor: undefined,
        }),
    });
  };

  if (isPending) {
    return <RoutePendingPage />;
  }

  if (installationSelection.canonicalInstallationId !== null) {
    return (
      <Navigate
        to="/observability"
        search={cleanObservabilitySearch({
          ...normalizedSearch,
          installationId: installationSelection.canonicalInstallationId,
        })}
        replace
      />
    );
  }

  if (!selectedInstallation) {
    return (
      <main className="observability-shell">
        <ObservabilityHeader search={scopedSearch} />
        <ObservabilityFilters
          search={scopedSearch}
          options={emptyFilterOptions}
          selectedInstallation={null}
          installations={visibleInstallations}
          onInstallationChange={selectInstallation}
          onChange={setSearch}
        />
        <ObservabilityInstallationRequiredState
          installations={visibleInstallations}
          onSelectInstallation={selectInstallation}
        />
      </main>
    );
  }

  return (
    <main className="observability-shell">
      <ObservabilityHeader search={scopedSearch} />
      <ObservabilityFilters
        search={scopedSearch}
        options={dashboard?.filterOptions ?? emptyFilterOptions}
        selectedInstallation={selectedInstallation}
        installations={visibleInstallations}
        onInstallationChange={selectInstallation}
        onChange={setSearch}
      />
      <ObservabilityTabs search={scopedSearch} />
      <ActiveFilterChips search={scopedSearch} onChange={setSearch} />
      <ObservabilityDashboardState
        data={dashboard}
        isPending={isDashboardPending}
        search={scopedSearch}
        session={session}
        selectedInstallation={selectedInstallation}
        onSearchChange={setSearch}
        onSelectEvent={(eventId) => setSearch({ selectedEvent: eventId })}
      />
      <SelectedEventDetail
        event={selectedEvent}
        isPending={Boolean(selectedEventId) && isSelectedEventPending}
        onClose={() => setSearch({ selectedEvent: undefined })}
      />
      <footer className="observability-footer">
        <CoinVerticalIcon size={15} aria-hidden="true" />
        Estimated AI cost only
      </footer>
    </main>
  );
}
