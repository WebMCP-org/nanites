import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { DbClient } from "#/backend/db/index.ts";
import { aiUsageFacts, auditEvents, naniteCatalog, naniteRunFacts } from "#/backend/db/schema.ts";

export const OBSERVABILITY_RANGES = ["24h", "7d", "30d"] as const;

export type ObservabilityRange = (typeof OBSERVABILITY_RANGES)[number];

export type ObservabilityFilters = {
  range: ObservabilityRange;
  environment?: string;
  installationId?: number;
  repository?: string;
  naniteId?: string;
  creator?: string;
  outcome?: string;
  surface?: string;
  search?: string;
  selectedEvent?: string;
  cursor?: string;
  live?: boolean;
};

export type ObservabilityVisibilityScope = {
  githubInstallationId: number;
  visibleRepositoryIds: readonly number[];
  visibleRepositoryFullNames: readonly string[];
  filters: ObservabilityFilters;
  now?: Date;
};

export type KpiMetric = {
  key: string;
  label: string;
  value: number;
  deltaLabel?: string;
  unit?: "count" | "usd-micros";
};

export type CostPoint = {
  key: string;
  label: string;
  estimatedCostUsdMicros: number;
  providerBilledCostUsdMicros: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  count: number;
};

export type RunOutcomePoint = {
  outcome: string;
  count: number;
};

export type RunTrendPoint = {
  bucket: string;
  label: string;
  runCount: number;
  successfulRuns: number;
  failedRuns: number;
  waitingRuns: number;
  noChangeRuns: number;
};

export type ImpactTrendPoint = {
  bucket: string;
  label: string;
  outputLinkedRuns: number;
  outputPullRequests: number;
  mergedPullRequests: number;
  outputLinesChanged: number;
  outputChangedFiles: number;
};

export type ObservabilityImpactSummary = {
  prTriggeredRuns: number;
  successfulPrRuns: number;
  outputLinkedRuns: number;
  outputPullRequests: number;
  mergedPullRequests: number;
  outputAdditions: number;
  outputDeletions: number;
  outputLinesChanged: number;
  outputChangedFiles: number;
  completedRuns: number;
  noChangeRuns: number;
};

export type NaniteCreatorPoint = {
  key: string;
  label: string;
  naniteCount: number;
};

export type RunActorPoint = {
  key: string;
  label: string;
  runCount: number;
  successfulRunCount: number;
  failedRunCount: number;
  waitingRunCount: number;
};

export type ObservabilityEventRow = {
  id: string;
  kind: "audit" | "run" | "ai_usage";
  occurredAt: string;
  title: string;
  subtitle: string;
  outcome: string | null;
};

export type ObservabilityOverviewResponse = {
  range: ObservabilityRange;
  githubInstallationId: number;
  generatedAt: string;
  kpis: KpiMetric[];
  costOverTime: CostPoint[];
  costByNanite: CostPoint[];
  costByRepository: CostPoint[];
  costByModel: CostPoint[];
  costByActor: CostPoint[];
  costByBillingUser: CostPoint[];
  runTrend: RunTrendPoint[];
  impactTrend: ImpactTrendPoint[];
  runsByOutcome: RunOutcomePoint[];
  topNanitesByRunCount: CostPoint[];
  topNanitesByEstimatedCost: CostPoint[];
  impact: ObservabilityImpactSummary;
  nanitesByCreator: NaniteCreatorPoint[];
  runsByActor: RunActorPoint[];
  recentEvents: ObservabilityEventRow[];
};

export type NaniteCatalogRow = {
  id: string;
  naniteId: string;
  name: string;
  enabled: boolean;
  eventSourceType: string;
  repositories: string[];
  repositoryCount: number;
  creator: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  runCount: number;
  estimatedCostUsdMicros: number;
};

type RunFeedFields = {
  id: string;
  runKey: string;
  naniteId: string;
  repository: string;
  triggerKind: string;
  status: string;
  conclusion: string | null;
  actor: string | null;
  billing: string | null;
  summary: string | null;
  outputUrl: string | null;
  outputPullRequestNumber: number | null;
  outputPullRequestMerged: boolean | null;
  outputAdditions: number | null;
  outputDeletions: number | null;
  outputChangedFiles: number | null;
};

export type RunFeedRow = RunFeedFields & {
  estimatedCostUsdMicros: number;
  startedAt: string;
  completedAt: string | null;
};

export type AuditFeedRow = {
  id: string;
  eventName: string;
  occurredAt: string;
  actor: string | null;
  surface: string;
  targetType: string;
  targetId: string | null;
  outcome: string;
  reasonCode: string | null;
  requestId: string | null;
};

export type CostBreakdownResponse = {
  byNanite: CostPoint[];
  byRun: CostPoint[];
  byRepository: CostPoint[];
  byModel: CostPoint[];
  byActor: CostPoint[];
  byBillingUser: CostPoint[];
};

export type ObservabilityEventDetail =
  | {
      kind: "audit";
      row: AuditFeedRow & { metadata: Record<string, unknown> };
    }
  | {
      kind: "run";
      row: RunFeedRow;
    }
  | {
      kind: "ai_usage";
      row: {
        id: string;
        requestId: string;
        naniteId: string | null;
        runKey: string | null;
        provider: string;
        model: string;
        estimatedCostUsdMicros: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        completedAt: string;
      };
    };

type AiUsageRow = typeof aiUsageFacts.$inferSelect;
type AuditRow = typeof auditEvents.$inferSelect;
type DrizzleExpression = SQL<unknown> | AnySQLiteColumn;
type TimeWindow = { now: Date; start: Date };

type CostPointDbRow = {
  key: unknown;
  label: unknown;
  estimatedCostUsdMicros: number | null;
  providerBilledCostUsdMicros: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  count: number;
};

type RunOutcomeDbRow = {
  outcome: string | null;
  count: number;
};

type RunTrendDbRow = RunTrendPoint;
type ImpactTrendDbRow = ImpactTrendPoint;

type OverviewKpiTotals = {
  estimatedCostUsdMicros: number;
  runCount: number;
  successfulRuns: number;
  failedRuns: number;
  noChangeRuns: number;
  waitingRunFacts: number;
  waitingCatalogRows: number;
  activeNanites: number;
  newNanites: number;
};

type CatalogFeedDbRow = {
  id: string;
  naniteId: string;
  name: string;
  enabled: boolean;
  eventSourceType: string;
  repositoryFullNamesJson: string;
  repositoryCount: number;
  creator: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  runCount: number | null;
  estimatedCostUsdMicros: number | null;
};

type RunFeedDbRow = RunFeedFields & {
  estimatedCostUsdMicros: number | null;
  startedAt: Date;
  completedAt: Date | null;
};

type RecentEventDbRow = {
  id: string;
  kind: string;
  occurredAt: string;
  title: string;
  subtitle: string;
  outcome: string | null;
};

type AiUsageCostColumns = {
  providerBilledTotalCostUsdMicros: AiUsageRow["providerBilledTotalCostUsdMicros"];
  estimatedTotalCostUsdMicros: AiUsageRow["estimatedTotalCostUsdMicros"];
};

type NaniteCreatorDbRow = {
  key: string | null;
  label: string | null;
  naniteCount: number;
};

type RunActorDbRow = {
  key: string | null;
  label: string | null;
  runCount: number;
  successfulRunCount: number;
  failedRunCount: number;
  waitingRunCount: number;
};

type ImpactSummaryDbRow = {
  prTriggeredRuns: number;
  successfulPrRuns: number;
  outputLinkedRuns: number;
  outputPullRequests: number;
  mergedPullRequests: number;
  outputAdditions: number;
  outputDeletions: number;
  outputLinesChanged: number;
  outputChangedFiles: number;
  completedRuns: number;
  noChangeRuns: number;
};

const observabilityDayMs = 24 * 60 * 60 * 1000;
const defaultCostGroupLimit = 8;
const costOverTimeLimit = 30;
const topNaniteLimit = 8;
const recentEventLimit = 12;
const feedRowLimit = 100;
const emptyImpactSummary: ObservabilityImpactSummary = {
  prTriggeredRuns: 0,
  successfulPrRuns: 0,
  outputLinkedRuns: 0,
  outputPullRequests: 0,
  mergedPullRequests: 0,
  outputAdditions: 0,
  outputDeletions: 0,
  outputLinesChanged: 0,
  outputChangedFiles: 0,
  completedRuns: 0,
  noChangeRuns: 0,
};

function rangeStart(range: ObservabilityRange, now: Date): Date {
  switch (range) {
    case "24h":
      return new Date(now.getTime() - observabilityDayMs);
    case "7d":
      return new Date(now.getTime() - 7 * observabilityDayMs);
    case "30d":
      return new Date(now.getTime() - 30 * observabilityDayMs);
  }
}

function resolveWindow(scope: ObservabilityVisibilityScope): TimeWindow {
  const now = scope.now ?? new Date();
  return { now, start: rangeStart(scope.filters.range, now) };
}

function costMicros(row: AiUsageCostColumns): number {
  return row.providerBilledTotalCostUsdMicros ?? row.estimatedTotalCostUsdMicros ?? 0;
}

function whereAll(conditions: readonly (SQL<unknown> | undefined)[]): SQL<unknown> | undefined {
  const active = conditions.filter(
    (condition): condition is SQL<unknown> => condition !== undefined,
  );
  return active.length ? and(...active) : undefined;
}

function requireWhere(condition: SQL<unknown> | undefined): SQL<unknown> {
  return condition ?? sql`1 = 1`;
}

function whereAny(conditions: readonly (SQL<unknown> | undefined)[]): SQL<unknown> | undefined {
  const active = conditions.filter(
    (condition): condition is SQL<unknown> => condition !== undefined,
  );
  return active.length ? or(...active) : undefined;
}

function requireWhereAny(conditions: readonly (SQL<unknown> | undefined)[]): SQL<unknown> {
  return whereAny(conditions) ?? sql`0`;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSearch(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function likeValue(search: string): string {
  return `%${search}%`;
}

function textEquals(column: DrizzleExpression, value: string): SQL<unknown> {
  return sql`${column} = ${value}`;
}

function countMatching(condition: SQL<unknown>): SQL<number> {
  return sql<number>`cast(coalesce(sum(case when ${condition} then 1 else 0 end), 0) as int)`;
}

function sumInteger(column: DrizzleExpression): SQL<number> {
  return sql<number>`cast(coalesce(sum(coalesce(${column}, 0)), 0) as int)`;
}

function parseRepositories(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => (typeof item === "string" ? [item] : []))
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function visibleRepositoryCondition(
  column: typeof aiUsageFacts.githubRepositoryId | typeof auditEvents.githubRepositoryId,
  scope: ObservabilityVisibilityScope,
): SQL<unknown> {
  const visibleIdsCondition = scope.visibleRepositoryIds.length
    ? inArray(column, [...scope.visibleRepositoryIds])
    : undefined;

  return requireWhereAny([isNull(column), eq(column, 0), visibleIdsCondition]);
}

function visibleRequiredRepositoryCondition(
  column: typeof naniteRunFacts.githubRepositoryId,
  scope: ObservabilityVisibilityScope,
): SQL<unknown> {
  const visibleIdsCondition = scope.visibleRepositoryIds.length
    ? inArray(column, [...scope.visibleRepositoryIds])
    : undefined;

  return requireWhereAny([eq(column, 0), visibleIdsCondition]);
}

function repositoryIdForFilter(scope: ObservabilityVisibilityScope): number | null {
  if (!scope.filters.repository) {
    return null;
  }

  const index = scope.visibleRepositoryFullNames.indexOf(scope.filters.repository);
  return index >= 0 ? scope.visibleRepositoryIds[index] : null;
}

function repositoryLabelForKey(
  scope: ObservabilityVisibilityScope,
  key: string | number | null,
): string {
  if (key === null || key === "unscoped") {
    return "Unscoped";
  }

  if (key === 0 || key === "0") {
    return "installation";
  }

  const numericKey = typeof key === "number" ? key : Number(key);
  const index = Number.isNaN(numericKey) ? -1 : scope.visibleRepositoryIds.indexOf(numericKey);
  return index >= 0 ? scope.visibleRepositoryFullNames[index] : String(key);
}

function repositoryFilterCondition(scope: ObservabilityVisibilityScope) {
  const repositoryId = repositoryIdForFilter(scope);
  return repositoryId === null ? undefined : eq(aiUsageFacts.githubRepositoryId, repositoryId);
}

function searchCondition(search: string | null, columns: readonly DrizzleExpression[]) {
  if (!search) {
    return undefined;
  }

  const pattern = likeValue(search);
  return whereAny(columns.map((column) => like(sql`lower(${column})`, pattern)));
}

function catalogRepositoryJsonContains(repository: string): SQL<unknown> {
  return sql`exists (
    select 1
    from json_each(${naniteCatalog.repositoryFullNamesJson})
    where json_each.value = ${repository}
  )`;
}

function creatorNaniteCondition(
  naniteId: DrizzleExpression,
  scope: ObservabilityVisibilityScope,
): SQL<unknown> | undefined {
  if (!scope.filters.creator) {
    return undefined;
  }

  return sql`exists (
    select 1
    from ${naniteCatalog}
    where ${naniteCatalog.githubInstallationId} = ${scope.githubInstallationId}
      and ${naniteCatalog.naniteId} = ${naniteId}
      and ${naniteCatalog.createdByGithubLogin} = ${scope.filters.creator}
  )`;
}

function catalogVisibleRepositoryCondition(scope: ObservabilityVisibilityScope): SQL<unknown> {
  if (!scope.visibleRepositoryFullNames.length) {
    return eq(naniteCatalog.repositoryCount, 0);
  }

  const visibleNames = sql.join(
    scope.visibleRepositoryFullNames.map((repository) => sql`${repository}`),
    sql`, `,
  );

  return requireWhereAny([
    eq(naniteCatalog.repositoryCount, 0),
    sql`exists (
      select 1
      from json_each(${naniteCatalog.repositoryFullNamesJson})
      where json_each.value in (${visibleNames})
    )`,
  ]);
}

function catalogWhere(scope: ObservabilityVisibilityScope): SQL<unknown> | undefined {
  const search = normalizeSearch(scope.filters.search);

  return whereAll([
    eq(naniteCatalog.githubInstallationId, scope.githubInstallationId),
    catalogVisibleRepositoryCondition(scope),
    scope.filters.repository ? catalogRepositoryJsonContains(scope.filters.repository) : undefined,
    scope.filters.naniteId ? eq(naniteCatalog.naniteId, scope.filters.naniteId) : undefined,
    scope.filters.creator
      ? eq(naniteCatalog.createdByGithubLogin, scope.filters.creator)
      : undefined,
    searchCondition(search, [
      naniteCatalog.naniteId,
      naniteCatalog.name,
      naniteCatalog.createdByGithubLogin,
      naniteCatalog.updatedByGithubLogin,
    ]),
  ]);
}

function aiUsageWhere(scope: ObservabilityVisibilityScope): SQL<unknown> | undefined {
  const { now, start } = resolveWindow(scope);
  const search = normalizeSearch(scope.filters.search);

  return whereAll([
    eq(aiUsageFacts.githubInstallationId, scope.githubInstallationId),
    gte(aiUsageFacts.completedAt, start),
    lte(aiUsageFacts.completedAt, now),
    visibleRepositoryCondition(aiUsageFacts.githubRepositoryId, scope),
    repositoryFilterCondition(scope),
    scope.filters.naniteId ? eq(aiUsageFacts.naniteId, scope.filters.naniteId) : undefined,
    creatorNaniteCondition(aiUsageFacts.naniteId, scope),
    searchCondition(search, [
      aiUsageFacts.naniteId,
      aiUsageFacts.runKey,
      aiUsageFacts.provider,
      aiUsageFacts.model,
      aiUsageFacts.actorGithubLogin,
    ]),
  ]);
}

function runWhere(scope: ObservabilityVisibilityScope): SQL<unknown> | undefined {
  const { now, start } = resolveWindow(scope);
  const search = normalizeSearch(scope.filters.search);

  return whereAll([
    eq(naniteRunFacts.githubInstallationId, scope.githubInstallationId),
    gte(naniteRunFacts.startedAt, start),
    lte(naniteRunFacts.startedAt, now),
    visibleRequiredRepositoryCondition(naniteRunFacts.githubRepositoryId, scope),
    scope.filters.repository
      ? eq(naniteRunFacts.repositoryFullName, scope.filters.repository)
      : undefined,
    scope.filters.naniteId ? eq(naniteRunFacts.naniteId, scope.filters.naniteId) : undefined,
    creatorNaniteCondition(naniteRunFacts.naniteId, scope),
    scope.filters.outcome
      ? requireWhereAny([
          textEquals(naniteRunFacts.status, scope.filters.outcome),
          textEquals(naniteRunFacts.conclusion, scope.filters.outcome),
        ])
      : undefined,
    searchCondition(search, [
      naniteRunFacts.naniteId,
      naniteRunFacts.repositoryFullName,
      naniteRunFacts.triggerKind,
      naniteRunFacts.summary,
      naniteRunFacts.actorGithubLogin,
    ]),
  ]);
}

function auditWhere(scope: ObservabilityVisibilityScope): SQL<unknown> | undefined {
  const { now, start } = resolveWindow(scope);
  const search = normalizeSearch(scope.filters.search);

  return whereAll([
    eq(auditEvents.githubInstallationId, scope.githubInstallationId),
    gte(auditEvents.occurredAt, start),
    lte(auditEvents.occurredAt, now),
    visibleRepositoryCondition(auditEvents.githubRepositoryId, scope),
    scope.filters.repository
      ? eq(auditEvents.repositoryFullName, scope.filters.repository)
      : undefined,
    scope.filters.naniteId ? eq(auditEvents.naniteId, scope.filters.naniteId) : undefined,
    creatorNaniteCondition(auditEvents.naniteId, scope),
    scope.filters.outcome ? textEquals(auditEvents.outcome, scope.filters.outcome) : undefined,
    scope.filters.surface ? textEquals(auditEvents.surface, scope.filters.surface) : undefined,
    searchCondition(search, [
      auditEvents.eventName,
      auditEvents.naniteId,
      auditEvents.actorGithubLogin,
      auditEvents.targetId,
      auditEvents.reasonCode,
    ]),
  ]);
}

const estimatedCostSum = sql<number>`cast(coalesce(sum(coalesce(${aiUsageFacts.providerBilledTotalCostUsdMicros}, ${aiUsageFacts.estimatedTotalCostUsdMicros}, 0)), 0) as int)`;
const providerBilledCostSum = sql<number>`cast(coalesce(sum(coalesce(${aiUsageFacts.providerBilledTotalCostUsdMicros}, 0)), 0) as int)`;
const inputTokenSum = sql<number>`cast(coalesce(sum(coalesce(${aiUsageFacts.inputTokens}, 0)), 0) as int)`;
const outputTokenSum = sql<number>`cast(coalesce(sum(coalesce(${aiUsageFacts.outputTokens}, 0)), 0) as int)`;
const totalTokenSum = sql<number>`cast(coalesce(sum(coalesce(${aiUsageFacts.totalTokens}, 0)), 0) as int)`;
const aiUsageCount = sql<number>`cast(count(${aiUsageFacts.id}) as int)`;
const runCount = sql<number>`cast(count(${naniteRunFacts.id}) as int)`;
const costDayKey = sql<string>`date(${aiUsageFacts.completedAt}, 'unixepoch')`;
const runDayKey = sql<string>`date(${naniteRunFacts.startedAt}, 'unixepoch')`;
const impactDayKey = sql<string>`date(coalesce(${naniteRunFacts.outputPullRequestMergedAt}, ${naniteRunFacts.completedAt}, ${naniteRunFacts.startedAt}), 'unixepoch')`;
const modelKey = sql<string>`${aiUsageFacts.provider} || '/' || ${aiUsageFacts.model}`;
const actorKey = sql<string>`coalesce(${aiUsageFacts.actorGithubLogin}, ${aiUsageFacts.actorKind}, 'Unknown')`;
const billingKey = sql<string>`coalesce(${aiUsageFacts.billingGithubLogin}, cast(${aiUsageFacts.billingGithubUserId} as text), 'Unassigned')`;
const runOutcomeKey = sql<string>`coalesce(${naniteRunFacts.conclusion}, ${naniteRunFacts.status})`;
const runActorKey = sql<string>`coalesce(${naniteRunFacts.actorGithubLogin}, ${naniteRunFacts.triggeredByGithubLogin}, ${naniteRunFacts.actorKind}, 'Unknown')`;
const creatorKey = sql<string>`coalesce(${naniteCatalog.createdByGithubLogin}, 'Unknown')`;
const runSuccessCondition = sql`${runOutcomeKey} = 'success'`;
const runFailureCondition = sql`${runOutcomeKey} in ('failure', 'fail')`;
const runWaitingCondition = sql`${runOutcomeKey} in ('waiting_for_human', 'waiting')`;
const runNoChangeCondition = sql`${runOutcomeKey} = 'no_change'`;
const outputLinkedRunCondition = sql`${naniteRunFacts.outputUrl} is not null and ${naniteRunFacts.outputUrl} <> ''`;
const outputPullRequestCondition = sql`${naniteRunFacts.outputPullRequestNumber} is not null`;
const mergedPullRequestCondition = sql`${naniteRunFacts.outputPullRequestMerged} = true`;
const outputLinesChangedSum = sql<number>`cast(coalesce(sum(coalesce(${naniteRunFacts.outputAdditions}, 0) + coalesce(${naniteRunFacts.outputDeletions}, 0)), 0) as int)`;

function toCostPoint(
  row: CostPointDbRow,
  labelForKey?: (key: string | number | null) => string,
): CostPoint {
  const rawKey =
    typeof row.key === "string" || typeof row.key === "number" || row.key === null
      ? row.key
      : String(row.key);
  const label = labelForKey
    ? labelForKey(rawKey)
    : row.label === null || row.label === undefined
      ? "Unknown"
      : String(row.label);
  const key = labelForKey ? label : rawKey === null ? "unknown" : String(rawKey);

  return {
    key,
    label,
    estimatedCostUsdMicros: row.estimatedCostUsdMicros ?? 0,
    providerBilledCostUsdMicros: row.providerBilledCostUsdMicros ?? 0,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    totalTokens: row.totalTokens ?? 0,
    count: row.count,
  };
}

async function readAiCostGroup(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
  input: {
    key: DrizzleExpression;
    label: DrizzleExpression;
    groupBy: readonly DrizzleExpression[];
    labelForKey?: (key: string | number | null) => string;
    limit?: number;
    sort?: "cost" | "key";
  },
): Promise<CostPoint[]> {
  const limit = input.limit ?? defaultCostGroupLimit;
  const query = db
    .select({
      key: input.key,
      label: input.label,
      estimatedCostUsdMicros: estimatedCostSum,
      providerBilledCostUsdMicros: providerBilledCostSum,
      inputTokens: inputTokenSum,
      outputTokens: outputTokenSum,
      totalTokens: totalTokenSum,
      count: aiUsageCount,
    })
    .from(aiUsageFacts)
    .where(aiUsageWhere(scope))
    .groupBy(...input.groupBy);

  const rows =
    input.sort === "key"
      ? await query.orderBy(asc(input.key)).limit(limit).all()
      : await query.orderBy(desc(estimatedCostSum)).limit(limit).all();

  return rows.map((row) => toCostPoint(row, input.labelForKey));
}

async function readRunOutcomes(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<RunOutcomePoint[]> {
  const rows: RunOutcomeDbRow[] = await db
    .select({ outcome: runOutcomeKey, count: runCount })
    .from(naniteRunFacts)
    .where(runWhere(scope))
    .groupBy(runOutcomeKey)
    .orderBy(desc(runCount))
    .all();

  return rows.map((row) => ({ outcome: row.outcome ?? "unknown", count: row.count }));
}

async function readRunTrend(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<RunTrendPoint[]> {
  const rows: RunTrendDbRow[] = await db
    .select({
      bucket: runDayKey,
      label: runDayKey,
      runCount,
      successfulRuns: countMatching(runSuccessCondition),
      failedRuns: countMatching(runFailureCondition),
      waitingRuns: countMatching(runWaitingCondition),
      noChangeRuns: countMatching(runNoChangeCondition),
    })
    .from(naniteRunFacts)
    .where(runWhere(scope))
    .groupBy(runDayKey)
    .orderBy(asc(runDayKey))
    .limit(costOverTimeLimit)
    .all();

  return rows;
}

async function readImpactTrend(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<ImpactTrendPoint[]> {
  const rows: ImpactTrendDbRow[] = await db
    .select({
      bucket: impactDayKey,
      label: impactDayKey,
      outputLinkedRuns: countMatching(outputLinkedRunCondition),
      outputPullRequests: countMatching(outputPullRequestCondition),
      mergedPullRequests: countMatching(mergedPullRequestCondition),
      outputLinesChanged: outputLinesChangedSum,
      outputChangedFiles: sumInteger(naniteRunFacts.outputChangedFiles),
    })
    .from(naniteRunFacts)
    .where(runWhere(scope))
    .groupBy(impactDayKey)
    .orderBy(asc(impactDayKey))
    .limit(costOverTimeLimit)
    .all();

  return rows;
}

async function readImpactSummary(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<ObservabilityImpactSummary> {
  const prTriggeredCondition = requireWhereAny([
    textEquals(naniteRunFacts.triggerKind, "github-pull-request"),
    sql`${naniteRunFacts.triggerPullRequestNumber} is not null`,
  ]);
  const rows: ImpactSummaryDbRow[] = await db
    .select({
      prTriggeredRuns: countMatching(prTriggeredCondition),
      successfulPrRuns: countMatching(sql`(${prTriggeredCondition}) and ${runSuccessCondition}`),
      outputLinkedRuns: countMatching(outputLinkedRunCondition),
      outputPullRequests: countMatching(outputPullRequestCondition),
      mergedPullRequests: countMatching(mergedPullRequestCondition),
      outputAdditions: sumInteger(naniteRunFacts.outputAdditions),
      outputDeletions: sumInteger(naniteRunFacts.outputDeletions),
      outputLinesChanged: outputLinesChangedSum,
      outputChangedFiles: sumInteger(naniteRunFacts.outputChangedFiles),
      completedRuns: countMatching(sql`${naniteRunFacts.completedAt} is not null`),
      noChangeRuns: countMatching(runNoChangeCondition),
    })
    .from(naniteRunFacts)
    .where(runWhere(scope))
    .all();

  return rows[0] ?? emptyImpactSummary;
}

async function readNanitesByCreator(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<NaniteCreatorPoint[]> {
  const rows: NaniteCreatorDbRow[] = await db
    .select({
      key: creatorKey,
      label: creatorKey,
      naniteCount: sql<number>`cast(count(${naniteCatalog.id}) as int)`,
    })
    .from(naniteCatalog)
    .where(catalogWhere(scope))
    .groupBy(creatorKey)
    .orderBy(desc(sql<number>`cast(count(${naniteCatalog.id}) as int)`))
    .limit(defaultCostGroupLimit)
    .all();

  return rows.map((row) => ({
    key: row.key ?? "Unknown",
    label: row.label ?? "Unknown",
    naniteCount: row.naniteCount,
  }));
}

async function readRunsByActor(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<RunActorPoint[]> {
  const rows: RunActorDbRow[] = await db
    .select({
      key: runActorKey,
      label: runActorKey,
      runCount,
      successfulRunCount: countMatching(sql`${runOutcomeKey} = 'success'`),
      failedRunCount: countMatching(sql`${runOutcomeKey} = 'failure'`),
      waitingRunCount: countMatching(sql`${runOutcomeKey} = 'waiting_for_human'`),
    })
    .from(naniteRunFacts)
    .where(runWhere(scope))
    .groupBy(runActorKey)
    .orderBy(desc(runCount))
    .limit(defaultCostGroupLimit)
    .all();

  return rows.map((row) => ({
    key: row.key ?? "Unknown",
    label: row.label ?? "Unknown",
    runCount: row.runCount,
    successfulRunCount: row.successfulRunCount,
    failedRunCount: row.failedRunCount,
    waitingRunCount: row.waitingRunCount,
  }));
}

async function readTopNanitesByRunCount(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<CostPoint[]> {
  const rows = await db
    .select({
      key: naniteRunFacts.naniteId,
      label: naniteRunFacts.naniteId,
      count: runCount,
    })
    .from(naniteRunFacts)
    .where(runWhere(scope))
    .groupBy(naniteRunFacts.naniteId)
    .orderBy(desc(runCount))
    .limit(topNaniteLimit)
    .all();

  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    estimatedCostUsdMicros: 0,
    providerBilledCostUsdMicros: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    count: row.count,
  }));
}

async function readEstimatedCostTotal(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<number> {
  const row = (
    await db
      .select({ estimatedCostUsdMicros: estimatedCostSum })
      .from(aiUsageFacts)
      .where(aiUsageWhere(scope))
      .all()
  )[0];

  return row?.estimatedCostUsdMicros ?? 0;
}

async function readOverviewKpiTotals(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<OverviewKpiTotals> {
  const { start } = resolveWindow(scope);
  const [estimatedCostUsdMicros, runRow, catalogRow] = await Promise.all([
    readEstimatedCostTotal(db, scope),
    db
      .select({
        runCount,
        successfulRuns: countMatching(runSuccessCondition),
        failedRuns: countMatching(runFailureCondition),
        noChangeRuns: countMatching(runNoChangeCondition),
        waitingRunFacts: countMatching(runWaitingCondition),
      })
      .from(naniteRunFacts)
      .where(runWhere(scope))
      .all()
      .then((rows) => rows[0]),
    db
      .select({
        activeNanites: countMatching(sql`${naniteCatalog.enabled} = 1`),
        newNanites: countMatching(gte(naniteCatalog.createdAt, start)),
        waitingCatalogRows: countMatching(
          textEquals(naniteCatalog.lastRunStatus, "waiting_for_human"),
        ),
      })
      .from(naniteCatalog)
      .where(catalogWhere(scope))
      .all()
      .then((rows) => rows[0]),
  ]);

  return {
    estimatedCostUsdMicros,
    runCount: runRow?.runCount ?? 0,
    successfulRuns: runRow?.successfulRuns ?? 0,
    failedRuns: runRow?.failedRuns ?? 0,
    noChangeRuns: runRow?.noChangeRuns ?? 0,
    waitingRunFacts: runRow?.waitingRunFacts ?? 0,
    waitingCatalogRows: catalogRow?.waitingCatalogRows ?? 0,
    activeNanites: catalogRow?.activeNanites ?? 0,
    newNanites: catalogRow?.newNanites ?? 0,
  };
}

async function readRecentEvents(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<ObservabilityEventRow[]> {
  const rows = await db.all<RecentEventDbRow>(sql`
    select id, kind, occurredAt, title, subtitle, outcome
    from (
      select
        'audit:' || ${auditEvents.id} as id,
        'audit' as kind,
        strftime('%Y-%m-%dT%H:%M:%fZ', ${auditEvents.occurredAt}, 'unixepoch') as occurredAt,
        ${auditEvents.eventName} as title,
        coalesce(${auditEvents.actorGithubLogin}, ${auditEvents.actorLogin}, ${auditEvents.actorKind}, '')
          || case when ${auditEvents.targetType} is null or ${auditEvents.targetType} = '' then '' else ' · ' || ${auditEvents.targetType} end
          || case when ${auditEvents.targetId} is null or ${auditEvents.targetId} = '' then '' else ' · ' || ${auditEvents.targetId} end as subtitle,
        ${auditEvents.outcome} as outcome
      from ${auditEvents}
      where ${requireWhere(auditWhere(scope))}

      union all

      select
        'run:' || ${naniteRunFacts.id} as id,
        'run' as kind,
        strftime('%Y-%m-%dT%H:%M:%fZ', ${naniteRunFacts.startedAt}, 'unixepoch') as occurredAt,
        ${naniteRunFacts.naniteId} || ' ' || ${naniteRunFacts.status} as title,
        ${naniteRunFacts.repositoryFullName} as subtitle,
        coalesce(${naniteRunFacts.conclusion}, ${naniteRunFacts.status}) as outcome
      from ${naniteRunFacts}
      where ${requireWhere(runWhere(scope))}

      union all

      select
        'ai:' || ${aiUsageFacts.id} as id,
        'ai_usage' as kind,
        strftime('%Y-%m-%dT%H:%M:%fZ', ${aiUsageFacts.completedAt}, 'unixepoch') as occurredAt,
        ${aiUsageFacts.provider} || '/' || ${aiUsageFacts.model} as title,
        coalesce(${aiUsageFacts.naniteId}, ${aiUsageFacts.runKey}, 'Unscoped model request') as subtitle,
        ${aiUsageFacts.finishReason} as outcome
      from ${aiUsageFacts}
      where ${requireWhere(aiUsageWhere(scope))}
    )
    order by occurredAt desc
    limit ${recentEventLimit}
  `);

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind === "audit" || row.kind === "run" ? row.kind : "ai_usage",
    occurredAt: row.occurredAt,
    title: row.title,
    subtitle: row.subtitle,
    outcome: row.outcome,
  }));
}

function catalogNaniteRunCount(scope: ObservabilityVisibilityScope): SQL<number> {
  return sql<number>`(
    select cast(count(${naniteRunFacts.id}) as int)
    from ${naniteRunFacts}
    where ${requireWhere(
      whereAll([runWhere(scope), sql`${naniteRunFacts.naniteId} = ${naniteCatalog.naniteId}`]),
    )}
  )`;
}

function catalogNaniteCost(scope: ObservabilityVisibilityScope): SQL<number> {
  return sql<number>`(
    select ${estimatedCostSum}
    from ${aiUsageFacts}
    where ${requireWhere(
      whereAll([aiUsageWhere(scope), sql`${aiUsageFacts.naniteId} = ${naniteCatalog.naniteId}`]),
    )}
  )`;
}

async function readCatalogFeedRows(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<CatalogFeedDbRow[]> {
  return db
    .select({
      id: naniteCatalog.id,
      naniteId: naniteCatalog.naniteId,
      name: naniteCatalog.name,
      enabled: naniteCatalog.enabled,
      eventSourceType: naniteCatalog.eventSourceType,
      repositoryFullNamesJson: naniteCatalog.repositoryFullNamesJson,
      repositoryCount: naniteCatalog.repositoryCount,
      creator: naniteCatalog.createdByGithubLogin,
      updatedBy: naniteCatalog.updatedByGithubLogin,
      createdAt: naniteCatalog.createdAt,
      updatedAt: naniteCatalog.updatedAt,
      lastRunAt: naniteCatalog.lastRunAt,
      lastRunStatus: naniteCatalog.lastRunStatus,
      runCount: catalogNaniteRunCount(scope),
      estimatedCostUsdMicros: catalogNaniteCost(scope),
    })
    .from(naniteCatalog)
    .where(catalogWhere(scope))
    .orderBy(desc(naniteCatalog.updatedAt))
    .all();
}

function runCost(scope: ObservabilityVisibilityScope): SQL<number> {
  return sql<number>`(
    select ${estimatedCostSum}
    from ${aiUsageFacts}
    where ${requireWhere(
      whereAll([aiUsageWhere(scope), sql`${aiUsageFacts.runKey} = ${naniteRunFacts.runKey}`]),
    )}
  )`;
}

async function readRunFeedRows(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
  input: { id?: string; limit?: number } = {},
): Promise<RunFeedDbRow[]> {
  return db
    .select({
      id: naniteRunFacts.id,
      runKey: naniteRunFacts.runKey,
      naniteId: naniteRunFacts.naniteId,
      repository: naniteRunFacts.repositoryFullName,
      triggerKind: naniteRunFacts.triggerKind,
      status: naniteRunFacts.status,
      conclusion: naniteRunFacts.conclusion,
      actor: naniteRunFacts.actorGithubLogin,
      billing: naniteRunFacts.billingGithubLogin,
      summary: naniteRunFacts.summary,
      outputUrl: naniteRunFacts.outputUrl,
      outputPullRequestNumber: naniteRunFacts.outputPullRequestNumber,
      outputPullRequestMerged: naniteRunFacts.outputPullRequestMerged,
      outputAdditions: naniteRunFacts.outputAdditions,
      outputDeletions: naniteRunFacts.outputDeletions,
      outputChangedFiles: naniteRunFacts.outputChangedFiles,
      estimatedCostUsdMicros: runCost(scope),
      startedAt: naniteRunFacts.startedAt,
      completedAt: naniteRunFacts.completedAt,
    })
    .from(naniteRunFacts)
    .where(whereAll([runWhere(scope), input.id ? eq(naniteRunFacts.id, input.id) : undefined]))
    .orderBy(desc(naniteRunFacts.startedAt))
    .limit(input.limit ?? feedRowLimit)
    .all();
}

async function readAuditRows(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<AuditRow[]> {
  return db
    .select()
    .from(auditEvents)
    .where(auditWhere(scope))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(feedRowLimit)
    .all();
}

function mapRunFeedRow(row: RunFeedDbRow): RunFeedRow {
  return {
    id: row.id,
    runKey: row.runKey,
    naniteId: row.naniteId,
    repository: row.repository,
    triggerKind: row.triggerKind,
    status: row.status,
    conclusion: row.conclusion,
    actor: row.actor,
    billing: row.billing,
    summary: row.summary,
    outputUrl: row.outputUrl,
    outputPullRequestNumber: row.outputPullRequestNumber,
    outputPullRequestMerged: row.outputPullRequestMerged,
    outputAdditions: row.outputAdditions,
    outputDeletions: row.outputDeletions,
    outputChangedFiles: row.outputChangedFiles,
    estimatedCostUsdMicros: row.estimatedCostUsdMicros ?? 0,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function mapAuditFeedRow(row: AuditRow): AuditFeedRow {
  return {
    id: row.id,
    eventName: row.eventName,
    occurredAt: row.occurredAt.toISOString(),
    actor: row.actorGithubLogin ?? row.actorLogin,
    surface: row.surface,
    targetType: row.targetType,
    targetId: row.targetId,
    outcome: row.outcome,
    reasonCode: row.reasonCode,
    requestId: row.requestId,
  };
}

export async function getObservabilityOverview(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<ObservabilityOverviewResponse> {
  const { now } = resolveWindow(scope);
  const [
    kpiTotals,
    costOverTime,
    costByNanite,
    costByRepository,
    costByModel,
    costByActor,
    costByBillingUser,
    runTrend,
    impactTrend,
    runsByOutcome,
    topNanitesByRunCount,
    impact,
    nanitesByCreator,
    runsByActor,
    recentEvents,
  ] = await Promise.all([
    readOverviewKpiTotals(db, scope),
    readAiCostGroup(db, scope, {
      key: costDayKey,
      label: costDayKey,
      groupBy: [costDayKey],
      limit: costOverTimeLimit,
      sort: "key",
    }),
    readAiCostGroup(db, scope, {
      key: aiUsageFacts.naniteId,
      label: sql<string>`coalesce(${aiUsageFacts.naniteId}, 'Unknown')`,
      groupBy: [aiUsageFacts.naniteId],
    }),
    readAiCostGroup(db, scope, {
      key: sql<string>`coalesce(cast(${aiUsageFacts.githubRepositoryId} as text), 'unscoped')`,
      label: sql<string>`coalesce(cast(${aiUsageFacts.githubRepositoryId} as text), 'unscoped')`,
      groupBy: [aiUsageFacts.githubRepositoryId],
      labelForKey: (key) => repositoryLabelForKey(scope, key),
    }),
    readAiCostGroup(db, scope, {
      key: modelKey,
      label: modelKey,
      groupBy: [aiUsageFacts.provider, aiUsageFacts.model],
    }),
    readAiCostGroup(db, scope, {
      key: actorKey,
      label: actorKey,
      groupBy: [actorKey],
    }),
    readAiCostGroup(db, scope, {
      key: billingKey,
      label: billingKey,
      groupBy: [billingKey],
    }),
    readRunTrend(db, scope),
    readImpactTrend(db, scope),
    readRunOutcomes(db, scope),
    readTopNanitesByRunCount(db, scope),
    readImpactSummary(db, scope),
    readNanitesByCreator(db, scope),
    readRunsByActor(db, scope),
    readRecentEvents(db, scope),
  ]);
  const waitingRuns = kpiTotals.waitingRunFacts + kpiTotals.waitingCatalogRows;

  return {
    range: scope.filters.range,
    githubInstallationId: scope.githubInstallationId,
    generatedAt: now.toISOString(),
    kpis: [
      {
        key: "estimated-cost",
        label: "Estimated AI cost",
        value: kpiTotals.estimatedCostUsdMicros,
        unit: "usd-micros",
      },
      {
        key: "runs",
        label: "Runs",
        value: kpiTotals.runCount,
        unit: "count",
      },
      {
        key: "successful-runs",
        label: "Successful",
        value: kpiTotals.successfulRuns,
        unit: "count",
      },
      { key: "failed-runs", label: "Failed", value: kpiTotals.failedRuns, unit: "count" },
      { key: "no-change-runs", label: "No change", value: kpiTotals.noChangeRuns, unit: "count" },
      { key: "waiting-runs", label: "Waiting", value: waitingRuns, unit: "count" },
      {
        key: "active-nanites",
        label: "Active Nanites",
        value: kpiTotals.activeNanites,
        unit: "count",
      },
      {
        key: "new-nanites",
        label: "New Nanites",
        value: kpiTotals.newNanites,
        unit: "count",
      },
      {
        key: "merged-prs",
        label: "Merged PRs",
        value: impact.mergedPullRequests,
        unit: "count",
      },
      {
        key: "lines-changed",
        label: "Lines changed",
        value: impact.outputLinesChanged,
        unit: "count",
      },
      {
        key: "output-prs",
        label: "Output PRs",
        value: impact.outputPullRequests,
        unit: "count",
      },
    ],
    costOverTime,
    costByNanite,
    costByRepository,
    costByModel,
    costByActor,
    costByBillingUser,
    runTrend,
    impactTrend,
    runsByOutcome,
    topNanitesByRunCount,
    topNanitesByEstimatedCost: costByNanite,
    impact,
    nanitesByCreator,
    runsByActor,
    recentEvents,
  };
}

export async function getNaniteCostBreakdown(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<CostBreakdownResponse> {
  return {
    byNanite: await readAiCostGroup(db, scope, {
      key: aiUsageFacts.naniteId,
      label: sql<string>`coalesce(${aiUsageFacts.naniteId}, 'Unknown')`,
      groupBy: [aiUsageFacts.naniteId],
    }),
    byRun: await readAiCostGroup(db, scope, {
      key: aiUsageFacts.runKey,
      label: sql<string>`coalesce(${aiUsageFacts.runKey}, 'Unknown')`,
      groupBy: [aiUsageFacts.runKey],
    }),
    byRepository: await readAiCostGroup(db, scope, {
      key: sql<string>`coalesce(cast(${aiUsageFacts.githubRepositoryId} as text), 'unscoped')`,
      label: sql<string>`coalesce(cast(${aiUsageFacts.githubRepositoryId} as text), 'unscoped')`,
      groupBy: [aiUsageFacts.githubRepositoryId],
      labelForKey: (key) => repositoryLabelForKey(scope, key),
    }),
    byModel: await readAiCostGroup(db, scope, {
      key: modelKey,
      label: modelKey,
      groupBy: [aiUsageFacts.provider, aiUsageFacts.model],
    }),
    byActor: await readAiCostGroup(db, scope, {
      key: actorKey,
      label: actorKey,
      groupBy: [actorKey],
    }),
    byBillingUser: await readAiCostGroup(db, scope, {
      key: billingKey,
      label: billingKey,
      groupBy: [billingKey],
    }),
  };
}

export async function getNaniteCatalogRows(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<NaniteCatalogRow[]> {
  const catalogRows = await readCatalogFeedRows(db, scope);

  return catalogRows.map((row) => ({
    id: row.id,
    naniteId: row.naniteId,
    name: row.name,
    enabled: row.enabled,
    eventSourceType: row.eventSourceType,
    repositories: parseRepositories(row.repositoryFullNamesJson),
    repositoryCount: row.repositoryCount,
    creator: row.creator,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunStatus: row.lastRunStatus,
    runCount: row.runCount ?? 0,
    estimatedCostUsdMicros: row.estimatedCostUsdMicros ?? 0,
  }));
}

export async function getRunFeed(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<RunFeedRow[]> {
  const runRows = await readRunFeedRows(db, scope);

  return runRows.map(mapRunFeedRow);
}

export async function getAuditFeed(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<AuditFeedRow[]> {
  const auditRows = await readAuditRows(db, scope);

  return auditRows.map(mapAuditFeedRow);
}

export async function getObservabilityEventDetail(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
  eventId: string,
): Promise<ObservabilityEventDetail | null> {
  const separator = eventId.indexOf(":");
  if (separator < 1) {
    return null;
  }
  const kind = eventId.slice(0, separator);
  const id = eventId.slice(separator + 1);

  if (kind === "audit") {
    const row = await db.query.auditEvents.findFirst({
      where: whereAll([eq(auditEvents.id, id), auditWhere(scope)]),
    });
    if (!row) {
      return null;
    }

    return {
      kind: "audit",
      row: {
        id: row.id,
        eventName: row.eventName,
        occurredAt: row.occurredAt.toISOString(),
        actor: row.actorGithubLogin ?? row.actorLogin,
        surface: row.surface,
        targetType: row.targetType,
        targetId: row.targetId,
        outcome: row.outcome,
        reasonCode: row.reasonCode,
        requestId: row.requestId,
        metadata: parseJsonObject(row.metadataJson),
      },
    };
  }

  if (kind === "run") {
    const row = (await readRunFeedRows(db, scope, { id, limit: 1 }))[0];
    if (!row) {
      return null;
    }

    return {
      kind: "run",
      row: mapRunFeedRow(row),
    };
  }

  if (kind === "ai") {
    const row = await db.query.aiUsageFacts.findFirst({
      where: whereAll([eq(aiUsageFacts.id, id), aiUsageWhere(scope)]),
    });
    if (!row) {
      return null;
    }

    return {
      kind: "ai_usage",
      row: {
        id: row.id,
        requestId: row.requestId,
        naniteId: row.naniteId,
        runKey: row.runKey,
        provider: row.provider,
        model: row.model,
        estimatedCostUsdMicros: costMicros(row),
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        totalTokens: row.totalTokens ?? 0,
        completedAt: row.completedAt.toISOString(),
      },
    };
  }

  return null;
}

async function readNaniteIdFilterOptions(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: naniteCatalog.naniteId })
    .from(naniteCatalog)
    .where(catalogWhere(scope))
    .orderBy(asc(naniteCatalog.naniteId))
    .all();

  return rows.map((row) => row.value);
}

async function readCreatorFilterOptions(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: naniteCatalog.createdByGithubLogin })
    .from(naniteCatalog)
    .where(catalogWhere(scope))
    .orderBy(asc(naniteCatalog.createdByGithubLogin))
    .all();

  return rows.flatMap((row) => (row.value ? [row.value] : []));
}

async function readOutcomeFilterOptions(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<string[]> {
  const rows = await db.all<{ value: string | null }>(sql`
    select value
    from (
      select coalesce(${naniteRunFacts.conclusion}, ${naniteRunFacts.status}) as value
      from ${naniteRunFacts}
      where ${requireWhere(runWhere(scope))}

      union

      select ${auditEvents.outcome} as value
      from ${auditEvents}
      where ${requireWhere(auditWhere(scope))}
    )
    where value is not null
    order by value
  `);

  return rows.flatMap((row) => (row.value ? [row.value] : []));
}

async function readSurfaceFilterOptions(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: auditEvents.surface })
    .from(auditEvents)
    .where(auditWhere(scope))
    .orderBy(asc(auditEvents.surface))
    .all();

  return rows.map((row) => row.value);
}

export async function getObservabilityFilterOptions(
  db: DbClient,
  scope: ObservabilityVisibilityScope,
  filter: "repository" | "naniteId" | "creator" | "outcome" | "surface",
): Promise<{ options: string[] }> {
  switch (filter) {
    case "repository":
      return { options: [...scope.visibleRepositoryFullNames].sort() };
    case "naniteId":
      return { options: await readNaniteIdFilterOptions(db, scope) };
    case "creator":
      return { options: await readCreatorFilterOptions(db, scope) };
    case "outcome":
      return { options: await readOutcomeFilterOptions(db, scope) };
    case "surface":
      return { options: await readSurfaceFilterOptions(db, scope) };
  }
}
