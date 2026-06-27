/**
 * Authoritative Drizzle schema for SigVelo business and reporting tables.
 *
 * Ownership:
 * - This file owns persistence structure: table names, columns, defaults, constraints, and enum
 *   domains used by the business warehouse tables.
 * - Business enum domains live with the schema until another owner earns them.
 * - API semantics and mutation command shapes do not belong here.
 */
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { GitHubInstallationRepository } from "#/backend/github/index.ts";

export const GITHUB_ACCOUNT_TYPES = ["User", "Organization"] as const;
const INSTALLATION_STATUSES = ["active", "suspended", "removed"] as const;
const RUN_TRIGGER_KINDS = [
  "manual",
  "github",
  "github-pull-request",
  "schedule",
  "scheduleEvery",
] as const;
const RUN_STATUSES = [
  "running",
  "waiting_for_manager",
  "complete",
  "no_change",
  "fail",
  "canceled",
] as const;
const RUN_CONCLUSIONS = [
  "success",
  "failure",
  "no_change",
  "waiting_for_manager",
  "canceled",
] as const;
const NANITE_EVENT_SOURCE_TYPES = ["manual", "github", "schedule", "scheduleEvery"] as const;
const OBSERVABILITY_ACTOR_KINDS = [
  "github_user",
  "github_webhook",
  "schedule",
  "system",
  "agent",
] as const;
const OBSERVABILITY_ACTOR_SOURCES = [
  "browser",
  "mcp",
  "manager_chat",
  "github_webhook",
  "schedule",
  "maintenance",
] as const;
const AUDIT_EVENT_OUTCOMES = ["success", "failure", "denied", "noop"] as const;
const NANITE_MODEL_RUNTIME_PATHS = ["workers_ai_gateway"] as const;
const AUDIT_TARGET_TYPES = [
  "nanite",
  "run",
  "trigger_source",
  "permissions",
  "auth",
  "installation",
] as const;

export type GitHubAccountType = (typeof GITHUB_ACCOUNT_TYPES)[number];
export type RunTriggerKind = (typeof RUN_TRIGGER_KINDS)[number];
export type RunConclusion = (typeof RUN_CONCLUSIONS)[number];
export type ObservabilityActorKind = (typeof OBSERVABILITY_ACTOR_KINDS)[number];
export type ObservabilityActorSource = (typeof OBSERVABILITY_ACTOR_SOURCES)[number];
export type AuditEventOutcome = (typeof AUDIT_EVENT_OUTCOMES)[number];
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

function observabilityActorColumns() {
  return {
    actorKind: text("actor_kind", { enum: OBSERVABILITY_ACTOR_KINDS }).notNull(),
    actorGithubUserId: integer("actor_github_user_id"),
    actorGithubLogin: text("actor_github_login"),
    actorSource: text("actor_source", { enum: OBSERVABILITY_ACTOR_SOURCES }).notNull(),
  };
}

function costAttributionColumns() {
  return {
    costAttributedGithubUserId: integer("cost_attributed_github_user_id"),
    costAttributedGithubLogin: text("cost_attributed_github_login"),
    costAttributionBasis: text("cost_attribution_basis"),
  };
}

function timestampColumns() {
  return {
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  };
}

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    githubAccountId: integer("github_account_id").notNull().unique(),
    githubAccountLogin: text("github_account_login").notNull(),
    githubAccountType: text("github_account_type", { enum: GITHUB_ACCOUNT_TYPES }).notNull(),
    githubAccountAvatarUrl: text("github_account_avatar_url"),
    lastActiveAt: integer("last_active_at", { mode: "timestamp" }),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    ...timestampColumns(),
  },
  (table) => [uniqueIndex("accounts_github_account_id_unique").on(table.githubAccountId)],
);

export const accountInstallations = sqliteTable(
  "account_installations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    githubAppId: integer("github_app_id").notNull(),
    githubInstallationId: integer("github_installation_id").notNull().unique(),
    status: text("status", { enum: INSTALLATION_STATUSES }).notNull(),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    suspendedAt: integer("suspended_at", { mode: "timestamp" }),
    removedAt: integer("removed_at", { mode: "timestamp" }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("account_installations_github_installation_id_unique").on(
      table.githubInstallationId,
    ),
    uniqueIndex("account_installations_app_installation_unique").on(
      table.githubAppId,
      table.githubInstallationId,
    ),
  ],
);

export const accountRepositories = sqliteTable(
  "account_repositories",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    githubAppId: integer("github_app_id").notNull(),
    githubInstallationId: integer("github_installation_id")
      .notNull()
      .references(() => accountInstallations.githubInstallationId, { onDelete: "cascade" }),
    githubRepositoryId: integer("github_repository_id").notNull(),
    githubRepository: text("github_repository", { mode: "json" })
      .$type<GitHubInstallationRepository>()
      .notNull(),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("account_repositories_account_repo_unique").on(
      table.accountId,
      table.githubRepositoryId,
    ),
  ],
);

export const naniteRunFacts = sqliteTable(
  "nanite_run_facts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    githubAppId: integer("github_app_id").notNull(),
    githubInstallationId: integer("github_installation_id")
      .notNull()
      .references(() => accountInstallations.githubInstallationId, { onDelete: "cascade" }),
    githubRepositoryId: integer("github_repository_id").notNull(),
    repositoryFullName: text("full_name").notNull(),
    runKey: text("run_key").notNull(),
    naniteId: text("nanite_id").notNull(),
    triggerKind: text("trigger_kind", { enum: RUN_TRIGGER_KINDS }).notNull(),
    triggerPullRequestNumber: integer("trigger_pull_request_number"),
    triggeredByGithubUserId: integer("triggered_by_github_user_id"),
    triggeredByGithubLogin: text("triggered_by_github_login"),
    ...observabilityActorColumns(),
    ...costAttributionColumns(),
    status: text("status", { enum: RUN_STATUSES }).notNull(),
    conclusion: text("conclusion", { enum: RUN_CONCLUSIONS }),
    task: text("task").notNull(),
    summary: text("summary"),
    outputUrl: text("output_url"),
    outputPullRequestNumber: integer("output_pull_request_number"),
    outputPullRequestMerged: integer("output_pull_request_merged", { mode: "boolean" }),
    outputPullRequestMergedAt: integer("output_pull_request_merged_at", { mode: "timestamp" }),
    outputAdditions: integer("output_additions"),
    outputDeletions: integer("output_deletions"),
    outputChangedFiles: integer("output_changed_files"),
    modelRuntimePath: text("model_runtime_path", { enum: NANITE_MODEL_RUNTIME_PATHS }).notNull(),
    effectiveModelId: text("effective_model_id").notNull(),
    effectiveGatewayId: text("effective_gateway_id").notNull(),
    modelManifestVersionId: text("model_manifest_version_id").notNull(),
    modelResolvedAt: integer("model_resolved_at", { mode: "timestamp" }).notNull(),
    implicitFailureReason: text("implicit_failure_reason"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    lastUpdatedAt: integer("last_updated_at", { mode: "timestamp" }).notNull(),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("nanite_run_facts_installation_repo_run_unique").on(
      table.githubInstallationId,
      table.githubRepositoryId,
      table.runKey,
    ),
  ],
);

export const aiUsageFacts = sqliteTable(
  "ai_usage_facts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    githubAppId: integer("github_app_id").notNull(),
    githubInstallationId: integer("github_installation_id")
      .notNull()
      .references(() => accountInstallations.githubInstallationId, { onDelete: "cascade" }),
    githubRepositoryId: integer("github_repository_id"),
    naniteId: text("nanite_id").notNull(),
    runKey: text("run_key").notNull(),
    requestId: text("request_id").notNull(),
    provider: text("provider"),
    model: text("model").notNull(),
    sessionAffinity: text("session_affinity").notNull(),
    isContinuation: integer("is_continuation", { mode: "boolean" }).notNull().default(false),
    stepCount: integer("step_count").notNull().default(1),
    finishReason: text("finish_reason"),
    aiGatewayId: text("ai_gateway_id").notNull(),
    aiGatewayLogId: text("ai_gateway_log_id").notNull(),
    ...observabilityActorColumns(),
    ...costAttributionColumns(),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("ai_usage_facts_request_id_unique").on(table.requestId)],
);

export const naniteCatalog = sqliteTable(
  "nanite_catalog",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    githubAppId: integer("github_app_id").notNull(),
    githubInstallationId: integer("github_installation_id").notNull(),
    naniteId: text("nanite_id").notNull(),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    eventSourceType: text("event_source_type", { enum: NANITE_EVENT_SOURCE_TYPES }).notNull(),
    latestVersionId: text("latest_version_id").notNull(),
    modelId: text("model_id").notNull().default(""),
    repositoryFullNamesJson: text("repository_full_names_json").notNull().default("[]"),
    repositoryCount: integer("repository_count").notNull().default(0),
    triggerEventCount: integer("trigger_event_count").notNull().default(0),
    permissionCount: integer("permission_count").notNull().default(0),
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    lastRunStatus: text("last_run_status", { enum: RUN_STATUSES }),
    createdByGithubUserId: integer("created_by_github_user_id"),
    createdByGithubLogin: text("created_by_github_login"),
    updatedByGithubUserId: integer("updated_by_github_user_id"),
    updatedByGithubLogin: text("updated_by_github_login"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("nanite_catalog_installation_nanite_unique").on(
      table.githubInstallationId,
      table.naniteId,
    ),
  ],
);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
  eventName: text("event_name").notNull(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  githubAppId: integer("github_app_id").notNull(),
  githubInstallationId: integer("github_installation_id").notNull(),
  githubRepositoryId: integer("github_repository_id"),
  repositoryFullName: text("repository_full_name"),
  naniteId: text("nanite_id").notNull(),
  runKey: text("run_key"),
  actorKind: text("actor_kind", { enum: OBSERVABILITY_ACTOR_KINDS }).notNull(),
  actorId: text("actor_id"),
  actorLogin: text("actor_login"),
  actorGithubUserId: integer("actor_github_user_id"),
  actorGithubLogin: text("actor_github_login"),
  costAttributedGithubUserId: integer("cost_attributed_github_user_id"),
  costAttributedGithubLogin: text("cost_attributed_github_login"),
  costAttributionBasis: text("cost_attribution_basis"),
  surface: text("surface", { enum: OBSERVABILITY_ACTOR_SOURCES }).notNull(),
  targetType: text("target_type", { enum: AUDIT_TARGET_TYPES }).notNull(),
  targetId: text("target_id").notNull(),
  outcome: text("outcome", { enum: AUDIT_EVENT_OUTCOMES }).notNull(),
  reasonCode: text("reason_code"),
  requestId: text("request_id"),
  metadataJson: text("metadata_json").notNull().default("{}"),
});
