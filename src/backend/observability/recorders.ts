import { and, eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { LanguageModelUsage } from "ai";
import type { DbClient } from "#/backend/db/index.ts";
import { findAccountIdByInstallationId, touchAccountActivity } from "#/backend/db/facts.ts";
import {
  aiUsageFacts,
  auditEvents,
  naniteCatalog,
  naniteRunFacts,
  type AuditEventOutcome,
  type AuditTargetType,
  type NaniteEventSourceType,
  type ObservabilityActorKind,
  type ObservabilityActorSource,
  type RunConclusion,
  type RunPhase,
  type RunStatus,
  type RunTriggerKind,
} from "#/backend/db/schema.ts";
import type { GitHubPullRequestImpact } from "#/backend/github/index.ts";
import type {
  ManagedNanite,
  NaniteManifest,
  NaniteRunRecord,
  NaniteTriggerEvent,
} from "#/backend/agents/SigveloNaniteManager.ts";
import {
  getGitHubWebhookInstallationId,
  getGitHubWebhookEventName,
  getGitHubWebhookPullRequestNumber,
  getGitHubWebhookRepositoryFullName,
  getGitHubWebhookRepositoryId,
} from "#/github.ts";

type AiUsageFactInsert = InferInsertModel<typeof aiUsageFacts>;
type NaniteCatalogInsert = InferInsertModel<typeof naniteCatalog>;
type AuditEventInsert = InferInsertModel<typeof auditEvents>;
type NaniteRunFactInsert = InferInsertModel<typeof naniteRunFacts>;

const sensitiveMetadataKeyPattern =
  /token|secret|password|authorization|cookie|private[_-]?key|body|prompt|response|output|(?:^|[_-])source(?:$|[_-])|sourceCode|generatedSource|rawSource/i;
const maxMetadataDepth = 3;
const maxMetadataStringLength = 500;
const maxMetadataArrayItems = 25;
const maxMetadataObjectEntries = 50;
const aiGatewayMetadataFieldLimit = 5;
const githubActorIdPattern = /^github:(\d+)$/;

export type ObservabilityActor = {
  kind: ObservabilityActorKind;
  source: ObservabilityActorSource;
  githubUserId?: number | null;
  githubLogin?: string | null;
  actorId?: string | null;
  actorLogin?: string | null;
};

export type NaniteBillingAttribution = {
  githubUserId: number | null;
  githubLogin: string | null;
  basis: string | null;
};

export type RecordNaniteCatalogProjectionInput = {
  accountId?: string | null;
  githubInstallationId: number;
  nanite: ManagedNanite;
  actor?: ObservabilityActor | null;
};

export type RecordAuditEventInput = {
  id?: string;
  occurredAt?: Date;
  eventName: string;
  accountId?: string | null;
  githubInstallationId?: number | null;
  githubRepositoryId?: number | null;
  repositoryFullName?: string | null;
  naniteId?: string | null;
  runKey?: string | null;
  actor: ObservabilityActor;
  billing?: NaniteBillingAttribution | null;
  surface?: ObservabilityActorSource;
  targetType: AuditTargetType;
  targetId?: string | null;
  outcome: AuditEventOutcome;
  reasonCode?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

export type RecordNaniteRunFactInput = {
  accountId?: string | null;
  githubInstallationId: number;
  run: NaniteRunRecord;
  nanite?: ManagedNanite | null;
  actor?: ObservabilityActor | null;
  billing?: NaniteBillingAttribution | null;
  outputPullRequest?: GitHubPullRequestImpact | null;
};

export type RecordAiUsageFactInput = {
  accountId?: string | null;
  githubInstallationId: number;
  githubRepositoryId?: number | null;
  naniteId?: string | null;
  runKey?: string | null;
  requestId: string;
  provider?: string | null;
  model: string;
  sessionAffinity?: string | null;
  isContinuation?: boolean;
  stepCount?: number;
  finishReason?: string | null;
  usage: LanguageModelUsage;
  providerMetadata?: unknown;
  providerBilledTotalCostUsdMicros?: number | null;
  aiGatewayId?: string | null;
  aiGatewayLogId?: string | null;
  aiGatewayEventId?: string | null;
  actor?: ObservabilityActor | null;
  billing?: NaniteBillingAttribution | null;
  startedAt?: Date;
  completedAt?: Date;
};

type BuildAiUsageFactInsertInput = {
  input: RecordAiUsageFactInput;
  accountId: string;
  billing: NaniteBillingAttribution;
  startedAt: Date;
  completedAt: Date;
};

function stableCatalogId(githubInstallationId: number, naniteId: string): string {
  return `nanite-catalog:${githubInstallationId}:${naniteId}`;
}

async function resolveOptionalAccountId(
  db: DbClient,
  input: { accountId?: string | null; githubInstallationId?: number | null },
): Promise<string | null> {
  if (input.accountId !== undefined) {
    return input.accountId;
  }

  return input.githubInstallationId
    ? findAccountIdByInstallationId(db, input.githubInstallationId)
    : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return typeof value === "string" && value.length > maxMetadataStringLength
      ? `${value.slice(0, maxMetadataStringLength)}...`
      : value;
  }

  if (Array.isArray(value)) {
    if (depth >= maxMetadataDepth) {
      return `[array:${value.length}]`;
    }

    return value
      .slice(0, maxMetadataArrayItems)
      .map((item) => sanitizeMetadataValue(item, depth + 1));
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  if (depth >= maxMetadataDepth) {
    return "[object]";
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveMetadataKeyPattern.test(key))
      .slice(0, maxMetadataObjectEntries)
      .map(([key, nestedValue]) => [key, sanitizeMetadataValue(nestedValue, depth + 1)]),
  );
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata ?? {})
      .filter(([key]) => !sensitiveMetadataKeyPattern.test(key))
      .slice(0, maxMetadataObjectEntries)
      .map(([key, nestedValue]) => [key, sanitizeMetadataValue(nestedValue, 1)]),
  );
}

function stringifyJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
}

function collectNaniteRepositories(manifest: NaniteManifest): string[] {
  const repositories = new Set(manifest.permissions.github?.repositories ?? []);
  if (manifest.eventSource.type === "github") {
    for (const repository of manifest.eventSource.repositories ?? []) {
      repositories.add(repository);
    }
  }

  return [...repositories].sort();
}

function countNaniteTriggerEvents(manifest: NaniteManifest): number {
  return manifest.eventSource.type === "github" ? (manifest.eventSource.events?.length ?? 0) : 1;
}

function countNanitePermissions(manifest: NaniteManifest): number {
  return Object.keys(manifest.permissions.github?.appPermissions ?? {}).length;
}

function readEventSourceType(manifest: NaniteManifest): NaniteEventSourceType {
  return manifest.eventSource.type;
}

function actorGithubUserId(actor: ObservabilityActor | null | undefined): number | null {
  return actor?.githubUserId ?? null;
}

function actorGithubLogin(actor: ObservabilityActor | null | undefined): string | null {
  return actor?.githubLogin ?? null;
}

export function githubUserActor(input: {
  source: Extract<ObservabilityActorSource, "browser" | "mcp" | "manager_chat">;
  githubUserId: number;
  githubLogin: string;
}): ObservabilityActor {
  return {
    kind: "github_user",
    source: input.source,
    githubUserId: input.githubUserId,
    githubLogin: input.githubLogin,
    actorId: `github:${input.githubUserId}`,
    actorLogin: input.githubLogin,
  };
}

export function systemActor(source: ObservabilityActorSource): ObservabilityActor {
  return {
    kind: "system",
    source,
    actorId: "system",
    actorLogin: "system",
  };
}

export function triggerActor(
  triggerType: "github_webhook" | "schedule" | "agent",
): ObservabilityActor {
  return {
    kind: triggerType,
    source:
      triggerType === "github_webhook"
        ? "github_webhook"
        : triggerType === "schedule"
          ? "schedule"
          : "maintenance",
    actorId: triggerType,
    actorLogin: triggerType,
  };
}

export function manualActorFromId(actorId: string | null): ObservabilityActor | null {
  if (!actorId) {
    return null;
  }

  const githubUserMatch = githubActorIdPattern.exec(actorId);
  if (githubUserMatch) {
    return {
      kind: "github_user",
      source: "mcp",
      githubUserId: Number(githubUserMatch[1]),
      githubLogin: null,
      actorId,
      actorLogin: null,
    };
  }

  return {
    kind: "system",
    source: "maintenance",
    actorId,
    actorLogin: actorId,
  };
}

export function naniteTriggerActor(trigger: NaniteTriggerEvent): ObservabilityActor {
  switch (trigger.type) {
    case "manual":
      return manualActorFromId(trigger.actorId) ?? systemActor("maintenance");
    case "schedule":
      return triggerActor("schedule");
    case "github":
      return triggerActor("github_webhook");
  }
}

export async function resolveNaniteBillingAttribution(
  db: DbClient,
  input: {
    githubInstallationId: number;
    naniteId: string;
    actor?: ObservabilityActor | null;
  },
): Promise<NaniteBillingAttribution> {
  const actorId = actorGithubUserId(input.actor);
  if (input.actor?.kind === "github_user" && actorId !== null) {
    return {
      githubUserId: actorId,
      githubLogin: actorGithubLogin(input.actor),
      basis: "direct_actor",
    };
  }

  const catalogRow = await db.query.naniteCatalog.findFirst({
    columns: {
      createdByGithubUserId: true,
      createdByGithubLogin: true,
    },
    where: and(
      eq(naniteCatalog.githubInstallationId, input.githubInstallationId),
      eq(naniteCatalog.naniteId, input.naniteId),
    ),
  });

  if (catalogRow?.createdByGithubUserId) {
    return {
      githubUserId: catalogRow.createdByGithubUserId,
      githubLogin: catalogRow.createdByGithubLogin,
      basis: "nanite_creator",
    };
  }

  return {
    githubUserId: null,
    githubLogin: null,
    basis: null,
  };
}

export function buildNaniteAiGatewayMetadata(input: {
  githubInstallationId: number;
  naniteId: string;
  runKey: string;
  billingGithubUserId?: number | null;
  repository?: string | null;
}): Record<string, string> {
  const metadataEntries: Array<[string, string]> = [
    ["installation_id", String(input.githubInstallationId)],
    ["nanite_id", input.naniteId],
    ["run_key", input.runKey],
  ];

  if (input.billingGithubUserId) {
    metadataEntries.push(["billing_user_id", String(input.billingGithubUserId)]);
  }

  if (input.repository) {
    metadataEntries.push(["repo", input.repository]);
  }

  return Object.fromEntries(metadataEntries.slice(0, aiGatewayMetadataFieldLimit));
}

export async function recordNaniteCatalogProjection(
  db: DbClient,
  input: RecordNaniteCatalogProjectionInput,
): Promise<void> {
  const accountId = await resolveOptionalAccountId(db, input);
  const repositories = collectNaniteRepositories(input.nanite.manifest);
  const existing = await db.query.naniteCatalog.findFirst({
    where: and(
      eq(naniteCatalog.githubInstallationId, input.githubInstallationId),
      eq(naniteCatalog.naniteId, input.nanite.manifest.id),
    ),
  });
  const createdByGithubUserId =
    existing?.createdByGithubUserId ?? actorGithubUserId(input.actor) ?? null;
  const createdByGithubLogin =
    existing?.createdByGithubLogin ?? actorGithubLogin(input.actor) ?? null;
  const values: NaniteCatalogInsert = {
    id: stableCatalogId(input.githubInstallationId, input.nanite.manifest.id),
    accountId,
    githubInstallationId: input.githubInstallationId,
    naniteId: input.nanite.manifest.id,
    name: input.nanite.manifest.name,
    enabled: input.nanite.enabled,
    eventSourceType: readEventSourceType(input.nanite.manifest),
    latestVersionId: input.nanite.latestVersion.versionId,
    modelId: input.nanite.manifest.model,
    repositoryFullNamesJson: JSON.stringify(repositories),
    repositoryCount: repositories.length,
    triggerEventCount: countNaniteTriggerEvents(input.nanite.manifest),
    permissionCount: countNanitePermissions(input.nanite.manifest),
    lastRunAt: existing?.lastRunAt ?? null,
    lastRunStatus: existing?.lastRunStatus ?? null,
    createdByGithubUserId,
    createdByGithubLogin,
    updatedByGithubUserId: actorGithubUserId(input.actor),
    updatedByGithubLogin: actorGithubLogin(input.actor),
    createdAt: new Date(input.nanite.createdAt),
    updatedAt: new Date(input.nanite.updatedAt),
  };

  await db
    .insert(naniteCatalog)
    .values(values)
    .onConflictDoUpdate({
      target: [naniteCatalog.githubInstallationId, naniteCatalog.naniteId],
      set: {
        accountId: values.accountId,
        name: values.name,
        enabled: values.enabled,
        eventSourceType: values.eventSourceType,
        latestVersionId: values.latestVersionId,
        modelId: values.modelId,
        repositoryFullNamesJson: values.repositoryFullNamesJson,
        repositoryCount: values.repositoryCount,
        triggerEventCount: values.triggerEventCount,
        permissionCount: values.permissionCount,
        updatedByGithubUserId: values.updatedByGithubUserId,
        updatedByGithubLogin: values.updatedByGithubLogin,
        updatedAt: values.updatedAt,
      },
    })
    .run();

  if (accountId) {
    await touchAccountActivity(db, accountId, values.updatedAt);
  }
}

export async function deleteNaniteCatalogProjection(
  db: DbClient,
  input: { githubInstallationId: number; naniteId: string },
): Promise<void> {
  await db
    .delete(naniteCatalog)
    .where(
      and(
        eq(naniteCatalog.githubInstallationId, input.githubInstallationId),
        eq(naniteCatalog.naniteId, input.naniteId),
      ),
    )
    .run();
}

export async function recordAuditEvent(db: DbClient, input: RecordAuditEventInput): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const accountId = await resolveOptionalAccountId(db, input);
  const actorId =
    input.actor.actorId ??
    (input.actor.githubUserId ? `github:${input.actor.githubUserId}` : input.actor.kind);
  const values: AuditEventInsert = {
    id: input.id ?? crypto.randomUUID(),
    occurredAt,
    eventName: input.eventName,
    accountId,
    githubInstallationId: input.githubInstallationId ?? null,
    githubRepositoryId: input.githubRepositoryId ?? null,
    repositoryFullName: input.repositoryFullName ?? null,
    naniteId: input.naniteId ?? null,
    runKey: input.runKey ?? null,
    actorKind: input.actor.kind,
    actorId,
    actorLogin: input.actor.actorLogin ?? actorGithubLogin(input.actor),
    actorGithubUserId: actorGithubUserId(input.actor),
    actorGithubLogin: actorGithubLogin(input.actor),
    billingGithubUserId: input.billing?.githubUserId ?? null,
    billingGithubLogin: input.billing?.githubLogin ?? null,
    billingBasis: input.billing?.basis ?? null,
    surface: input.surface ?? input.actor.source,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    outcome: input.outcome,
    reasonCode: input.reasonCode ?? null,
    requestId: input.requestId ?? null,
    metadataJson: JSON.stringify(sanitizeMetadata(input.metadata)),
  };

  await db.insert(auditEvents).values(values).run();

  if (accountId) {
    await touchAccountActivity(db, accountId, occurredAt);
  }
}

function triggerKindForRun(run: NaniteRunRecord): RunTriggerKind {
  switch (run.trigger.type) {
    case "manual":
      return "manual";
    case "schedule":
      return run.trigger.eventSource.type;
    case "github":
      return getGitHubWebhookEventName(run.trigger.event).startsWith("pull_request")
        ? "github-pull-request"
        : "github";
  }
}

function runConclusionForStatus(status: NaniteRunRecord["status"]): RunConclusion | null {
  switch (status) {
    case "complete":
      return "success";
    case "fail":
      return "failure";
    case "no_change":
      return "no_change";
    case "waiting_for_human":
      return "waiting_for_human";
    case "canceled":
      return "canceled";
    case "running":
      return null;
  }
}

function runPhaseForStatus(status: NaniteRunRecord["status"]): RunPhase {
  if (status === "running") {
    return "investigating";
  }

  return "completed";
}

function runStatusForFact(status: NaniteRunRecord["status"]): RunStatus {
  return status;
}

function readRunRepository(run: NaniteRunRecord): {
  githubRepositoryId: number;
  repositoryFullName: string;
} {
  if (run.trigger.type === "github") {
    const githubInstallationId = getGitHubWebhookInstallationId(run.trigger.event);
    return {
      githubRepositoryId: getGitHubWebhookRepositoryId(run.trigger.event) ?? 0,
      repositoryFullName:
        getGitHubWebhookRepositoryFullName(run.trigger.event) ??
        (githubInstallationId ? `installation:${githubInstallationId}` : "installation"),
    };
  }

  return {
    githubRepositoryId: 0,
    repositoryFullName: "installation",
  };
}

function readRunTask(run: NaniteRunRecord): string {
  if (run.trigger.type === "manual") {
    return run.trigger.message ?? "Manual Nanite run";
  }

  if (run.trigger.type === "schedule") {
    return `${run.trigger.eventSource.type} Nanite run`;
  }

  return getGitHubWebhookEventName(run.trigger.event);
}

export async function recordNaniteRunFact(
  db: DbClient,
  input: RecordNaniteRunFactInput,
): Promise<void> {
  const accountId = await resolveOptionalAccountId(db, input);
  if (!accountId) {
    return;
  }

  const billing =
    input.billing ??
    (await resolveNaniteBillingAttribution(db, {
      githubInstallationId: input.githubInstallationId,
      naniteId: input.run.naniteId,
      actor: input.actor,
    }));
  const repository = readRunRepository(input.run);
  const updatedAt = new Date(input.run.updatedAt);
  const values: NaniteRunFactInsert = {
    id: `nanite-run:${input.githubInstallationId}:${repository.githubRepositoryId}:${input.run.runId}`,
    accountId,
    githubInstallationId: input.githubInstallationId,
    githubRepositoryId: repository.githubRepositoryId,
    repositoryFullName: repository.repositoryFullName,
    runKey: input.run.runId,
    naniteId: input.run.naniteId,
    variant: "workspace",
    triggerKind: triggerKindForRun(input.run),
    triggerPullRequestNumber:
      input.run.trigger.type === "github"
        ? getGitHubWebhookPullRequestNumber(input.run.trigger.event)
        : null,
    triggeredByGithubUserId: actorGithubUserId(input.actor),
    triggeredByGithubLogin: actorGithubLogin(input.actor),
    actorKind: input.actor?.kind ?? null,
    actorGithubUserId: actorGithubUserId(input.actor),
    actorGithubLogin: actorGithubLogin(input.actor),
    actorSource: input.actor?.source ?? null,
    billingGithubUserId: billing.githubUserId,
    billingGithubLogin: billing.githubLogin,
    billingAttributionBasis: billing.basis,
    status: runStatusForFact(input.run.status),
    conclusion: runConclusionForStatus(input.run.status),
    phase: runPhaseForStatus(input.run.status),
    task: readRunTask(input.run),
    summary: input.run.summary,
    outputUrl: input.run.outputUrl,
    outputPullRequestNumber: input.outputPullRequest?.pullRequestNumber ?? null,
    outputPullRequestMerged: input.outputPullRequest?.merged ?? null,
    outputPullRequestMergedAt: input.outputPullRequest?.mergedAt
      ? new Date(input.outputPullRequest.mergedAt)
      : null,
    outputAdditions: input.outputPullRequest?.additions ?? null,
    outputDeletions: input.outputPullRequest?.deletions ?? null,
    outputChangedFiles: input.outputPullRequest?.changedFiles ?? null,
    modelRuntimePath: input.run.model.runtimePath,
    effectiveModelId: input.run.model.effectiveModelId,
    effectiveGatewayId: input.run.model.effectiveGatewayId,
    modelManifestVersionId: input.run.model.manifestVersionId,
    modelResolvedAt: new Date(input.run.model.resolvedAt),
    configSource: "default",
    implicitFailureReason: input.run.dispatchError,
    startedAt: new Date(input.run.startedAt),
    completedAt: input.run.completedAt ? new Date(input.run.completedAt) : null,
    lastUpdatedAt: updatedAt,
    createdAt: new Date(input.run.startedAt),
    updatedAt,
  };

  await db
    .insert(naniteRunFacts)
    .values(values)
    .onConflictDoUpdate({
      target: [
        naniteRunFacts.githubInstallationId,
        naniteRunFacts.githubRepositoryId,
        naniteRunFacts.runKey,
      ],
      set: {
        status: values.status,
        conclusion: values.conclusion,
        phase: values.phase,
        summary: values.summary,
        outputUrl: values.outputUrl,
        outputPullRequestNumber: values.outputPullRequestNumber,
        outputPullRequestMerged: values.outputPullRequestMerged,
        outputPullRequestMergedAt: values.outputPullRequestMergedAt,
        outputAdditions: values.outputAdditions,
        outputDeletions: values.outputDeletions,
        outputChangedFiles: values.outputChangedFiles,
        modelRuntimePath: values.modelRuntimePath,
        effectiveModelId: values.effectiveModelId,
        effectiveGatewayId: values.effectiveGatewayId,
        modelManifestVersionId: values.modelManifestVersionId,
        modelResolvedAt: values.modelResolvedAt,
        implicitFailureReason: values.implicitFailureReason,
        completedAt: values.completedAt,
        lastUpdatedAt: values.lastUpdatedAt,
        updatedAt: values.updatedAt,
      },
    })
    .run();

  await db
    .update(naniteCatalog)
    .set({
      lastRunAt: values.startedAt,
      lastRunStatus: values.status,
      updatedAt: values.updatedAt,
    })
    .where(
      and(
        eq(naniteCatalog.githubInstallationId, input.githubInstallationId),
        eq(naniteCatalog.naniteId, input.run.naniteId),
      ),
    )
    .run();

  await touchAccountActivity(db, accountId, updatedAt);
}

function emptyBillingAttribution(): NaniteBillingAttribution {
  return { githubUserId: null, githubLogin: null, basis: null };
}

async function resolveAiUsageBilling(
  db: DbClient,
  input: RecordAiUsageFactInput,
): Promise<NaniteBillingAttribution> {
  if (input.billing) {
    return input.billing;
  }

  if (!input.naniteId) {
    return emptyBillingAttribution();
  }

  return resolveNaniteBillingAttribution(db, {
    githubInstallationId: input.githubInstallationId,
    naniteId: input.naniteId,
    actor: input.actor,
  });
}

function nullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function valueOr<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}

function firstPresent<T>(left: T | null | undefined, right: T | null | undefined): T | null {
  return left ?? right ?? null;
}

function buildAiUsageFactInsert(input: BuildAiUsageFactInsertInput): AiUsageFactInsert {
  const usage = input.input.usage;
  const actor = input.input.actor;

  return {
    id: `ai-usage:${input.input.requestId}`,
    accountId: input.accountId,
    githubInstallationId: input.input.githubInstallationId,
    githubRepositoryId: nullable(input.input.githubRepositoryId),
    naniteId: nullable(input.input.naniteId),
    runKey: nullable(input.input.runKey),
    requestId: input.input.requestId,
    provider: nullable(input.input.provider),
    model: input.input.model,
    sessionAffinity: nullable(input.input.sessionAffinity),
    isContinuation: valueOr(input.input.isContinuation, false),
    stepCount: valueOr(input.input.stepCount, 1),
    finishReason: nullable(input.input.finishReason),
    inputTokens: nullable(usage.inputTokens),
    outputTokens: nullable(usage.outputTokens),
    totalTokens: nullable(usage.totalTokens),
    reasoningTokens: firstPresent(usage.outputTokenDetails?.reasoningTokens, usage.reasoningTokens),
    cachedInputTokens: firstPresent(
      usage.inputTokenDetails?.cacheReadTokens,
      usage.cachedInputTokens,
    ),
    cacheWriteTokens: nullable(usage.inputTokenDetails?.cacheWriteTokens),
    rawUsageJson: stringifyJson(usage.raw),
    providerMetadataJson: stringifyJson(input.input.providerMetadata),
    providerBilledTotalCostUsdMicros: nullable(input.input.providerBilledTotalCostUsdMicros),
    aiGatewayId: nullable(input.input.aiGatewayId),
    aiGatewayLogId: nullable(input.input.aiGatewayLogId),
    aiGatewayEventId: nullable(input.input.aiGatewayEventId),
    actorKind: nullable(actor?.kind),
    actorGithubUserId: actorGithubUserId(actor),
    actorGithubLogin: actorGithubLogin(actor),
    actorSource: nullable(actor?.source),
    billingGithubUserId: input.billing.githubUserId,
    billingGithubLogin: input.billing.githubLogin,
    billingAttributionBasis: input.billing.basis,
    estimatedInputCostUsdMicros: null,
    estimatedOutputCostUsdMicros: null,
    estimatedTotalCostUsdMicros: null,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    createdAt: input.completedAt,
  };
}

function aiUsageFactUpdate(values: AiUsageFactInsert) {
  return {
    githubRepositoryId: values.githubRepositoryId,
    naniteId: values.naniteId,
    runKey: values.runKey,
    provider: values.provider,
    model: values.model,
    sessionAffinity: values.sessionAffinity,
    isContinuation: values.isContinuation,
    stepCount: values.stepCount,
    finishReason: values.finishReason,
    inputTokens: values.inputTokens,
    outputTokens: values.outputTokens,
    totalTokens: values.totalTokens,
    reasoningTokens: values.reasoningTokens,
    cachedInputTokens: values.cachedInputTokens,
    cacheWriteTokens: values.cacheWriteTokens,
    rawUsageJson: values.rawUsageJson,
    providerMetadataJson: values.providerMetadataJson,
    providerBilledTotalCostUsdMicros: values.providerBilledTotalCostUsdMicros,
    aiGatewayId: values.aiGatewayId,
    aiGatewayLogId: values.aiGatewayLogId,
    aiGatewayEventId: values.aiGatewayEventId,
    actorKind: values.actorKind,
    actorGithubUserId: values.actorGithubUserId,
    actorGithubLogin: values.actorGithubLogin,
    actorSource: values.actorSource,
    billingGithubUserId: values.billingGithubUserId,
    billingGithubLogin: values.billingGithubLogin,
    billingAttributionBasis: values.billingAttributionBasis,
    estimatedInputCostUsdMicros: values.estimatedInputCostUsdMicros,
    estimatedOutputCostUsdMicros: values.estimatedOutputCostUsdMicros,
    estimatedTotalCostUsdMicros: values.estimatedTotalCostUsdMicros,
    completedAt: values.completedAt,
  };
}

export async function recordAiUsageFact(
  db: DbClient,
  input: RecordAiUsageFactInput,
): Promise<void> {
  const completedAt = input.completedAt ?? new Date();
  const startedAt = input.startedAt ?? completedAt;
  const accountId = await resolveOptionalAccountId(db, input);
  if (!accountId) {
    return;
  }

  const billing = await resolveAiUsageBilling(db, input);
  const values = buildAiUsageFactInsert({
    input,
    accountId,
    billing,
    startedAt,
    completedAt,
  });

  await db
    .insert(aiUsageFacts)
    .values(values)
    .onConflictDoUpdate({
      target: aiUsageFacts.requestId,
      set: aiUsageFactUpdate(values),
    })
    .run();

  await touchAccountActivity(db, accountId, completedAt);
}
