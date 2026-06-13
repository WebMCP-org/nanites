/**
 * Authoritative Drizzle schema for SigVelo business and reporting tables.
 *
 * Ownership:
 * - This file owns persistence structure: table names, columns, defaults, constraints, and enum
 *   domains used by the business warehouse tables.
 * - Business enum domains live with the schema until another owner earns them.
 * - API semantics and mutation command shapes do not belong here.
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { GitHubInstallationRepository } from "#/backend/github/index.ts";

export const GITHUB_ACCOUNT_TYPES = ["User", "Organization"] as const;
export const GITHUB_APP_STATUSES = ["active", "retired"] as const;
export const INSTALLATION_STATUSES = ["active", "suspended", "removed"] as const;
export const PERSON_RELATIONSHIPS = ["sign_in_user", "github_actor"] as const;
export const RUN_TRIGGER_KINDS = [
  "manual",
  "github",
  "github-pull-request",
  "schedule",
  "scheduleEvery",
] as const;
export const CONFIG_SOURCES = ["default"] as const;
export const RUN_STATUSES = [
  "running",
  "waiting_for_human",
  "complete",
  "no_change",
  "fail",
  "canceled",
] as const;
export const RUN_CONCLUSIONS = [
  "success",
  "failure",
  "no_change",
  "waiting_for_human",
  "canceled",
] as const;
export const RUN_PHASES = [
  "queued",
  "preparing",
  "investigating",
  "editing",
  "verifying",
  "publishing",
  "awaiting_checks",
  "completed",
] as const;
export const NANITE_VARIANTS = ["workspace", "workspace-browser"] as const;
export const PLATFORM_USAGE_CATEGORIES = [
  "github-api",
  "workspace-hydration",
  "browser-verification",
  "run-phase",
  "mcp-readiness",
  "auth",
  "ui",
] as const;
export const NANITE_EVENT_SOURCE_TYPES = ["manual", "github", "schedule", "scheduleEvery"] as const;
export const OBSERVABILITY_ACTOR_KINDS = [
  "github_user",
  "github_webhook",
  "schedule",
  "system",
  "agent",
] as const;
export const OBSERVABILITY_ACTOR_SOURCES = [
  "browser",
  "mcp",
  "manager_chat",
  "github_webhook",
  "schedule",
  "maintenance",
] as const;
export const AUDIT_EVENT_OUTCOMES = ["success", "failure", "denied", "noop"] as const;
export const NANITE_MODEL_RUNTIME_PATHS = ["workers_ai_gateway"] as const;
export const AUDIT_TARGET_TYPES = [
  "nanite",
  "run",
  "trigger_source",
  "permissions",
  "auth",
  "installation",
] as const;

export type GitHubAccountType = (typeof GITHUB_ACCOUNT_TYPES)[number];
export type GitHubAppStatus = (typeof GITHUB_APP_STATUSES)[number];
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];
export type PersonRelationship = (typeof PERSON_RELATIONSHIPS)[number];
export type RunTriggerKind = (typeof RUN_TRIGGER_KINDS)[number];
export type ConfigSource = (typeof CONFIG_SOURCES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunConclusion = (typeof RUN_CONCLUSIONS)[number];
export type RunPhase = (typeof RUN_PHASES)[number];
export type NaniteVariant = (typeof NANITE_VARIANTS)[number];
export type PlatformUsageCategory = (typeof PLATFORM_USAGE_CATEGORIES)[number];
export type NaniteEventSourceType = (typeof NANITE_EVENT_SOURCE_TYPES)[number];
export type ObservabilityActorKind = (typeof OBSERVABILITY_ACTOR_KINDS)[number];
export type ObservabilityActorSource = (typeof OBSERVABILITY_ACTOR_SOURCES)[number];
export type AuditEventOutcome = (typeof AUDIT_EVENT_OUTCOMES)[number];
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

function observabilityActorColumns() {
  return {
    actorKind: text("actor_kind", { enum: OBSERVABILITY_ACTOR_KINDS }),
    actorGithubUserId: integer("actor_github_user_id"),
    actorGithubLogin: text("actor_github_login"),
    actorSource: text("actor_source", { enum: OBSERVABILITY_ACTOR_SOURCES }),
  };
}

function billingAttributionColumns() {
  return {
    billingGithubUserId: integer("billing_github_user_id"),
    billingGithubLogin: text("billing_github_login"),
    billingAttributionBasis: text("billing_attribution_basis"),
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
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
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
    githubAppId: integer("github_app_id")
      .notNull()
      .references(() => githubApps.appId),
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
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // An installation id belongs to exactly one app; the single-column unique
    // keeps the cross-table FK target valid, the composite states the pair
    // invariant every (app, installation) reference relies on.
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
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("account_repositories_account_repo_unique").on(
      table.accountId,
      table.githubRepositoryId,
    ),
  ],
);

export const accountPeople = sqliteTable(
  "account_people",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    githubUserId: integer("github_user_id").notNull(),
    githubLogin: text("github_login").notNull(),
    relationship: text("relationship", { enum: PERSON_RELATIONSHIPS }).notNull(),
    lastSignedInAt: integer("last_signed_in_at", { mode: "timestamp" }),
    lastActiveAt: integer("last_active_at", { mode: "timestamp" }),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("account_people_account_user_unique").on(table.accountId, table.githubUserId),
  ],
);

/**
 * Every GitHub App this deployment can authenticate as.
 *
 * App identity is explicit data: each row owns its worker secret binding
 * names, and every installation-bearing row records which app it belongs to.
 * A deployment may have exactly one active GitHub App. Retired rows can remain
 * as history, but runtime auth and setup fail closed if more than one active
 * row is present.
 */
export const githubApps = sqliteTable(
  "github_apps",
  {
    appId: integer("app_id").primaryKey(),
    slug: text("slug").notNull(),
    htmlUrl: text("html_url").notNull(),
    ownerLogin: text("owner_login"),
    ownerType: text("owner_type"),
    clientId: text("client_id").notNull(),
    privateKeyBinding: text("private_key_binding").notNull(),
    clientSecretBinding: text("client_secret_binding").notNull(),
    webhookSecretBinding: text("webhook_secret_binding").notNull(),
    permissionsJson: text("permissions_json").notNull(),
    eventsJson: text("events_json").notNull(),
    status: text("status", { enum: GITHUB_APP_STATUSES }).notNull().default("active"),
    retiredAt: integer("retired_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("github_apps_active_unique")
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
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
    variant: text("variant", { enum: NANITE_VARIANTS }).notNull(),
    triggerKind: text("trigger_kind", { enum: RUN_TRIGGER_KINDS }).notNull(),
    triggerPullRequestNumber: integer("trigger_pull_request_number"),
    triggeredByGithubUserId: integer("triggered_by_github_user_id"),
    triggeredByGithubLogin: text("triggered_by_github_login"),
    ...observabilityActorColumns(),
    ...billingAttributionColumns(),
    status: text("status", { enum: RUN_STATUSES }).notNull(),
    conclusion: text("conclusion", { enum: RUN_CONCLUSIONS }),
    phase: text("phase", { enum: RUN_PHASES }).notNull(),
    task: text("task").notNull(),
    summary: text("summary"),
    outputUrl: text("output_url"),
    outputPullRequestNumber: integer("output_pull_request_number"),
    outputPullRequestMerged: integer("output_pull_request_merged", { mode: "boolean" }),
    outputPullRequestMergedAt: integer("output_pull_request_merged_at", { mode: "timestamp" }),
    outputAdditions: integer("output_additions"),
    outputDeletions: integer("output_deletions"),
    outputChangedFiles: integer("output_changed_files"),
    modelRuntimePath: text("model_runtime_path", { enum: NANITE_MODEL_RUNTIME_PATHS }),
    effectiveModelId: text("effective_model_id"),
    effectiveGatewayId: text("effective_gateway_id"),
    modelManifestVersionId: text("model_manifest_version_id"),
    modelResolvedAt: integer("model_resolved_at", { mode: "timestamp" }),
    configSource: text("config_source", { enum: CONFIG_SOURCES }),
    implicitFailureReason: text("implicit_failure_reason"),
    missingExitToolReminderCount: integer("missing_exit_tool_reminder_count").notNull().default(0),
    totalMessageCount: integer("total_message_count").notNull().default(0),
    runtimeActivityPartCount: integer("runtime_activity_part_count").notNull().default(0),
    reasoningBlockCount: integer("reasoning_block_count").notNull().default(0),
    toolInvocationCount: integer("tool_invocation_count").notNull().default(0),
    toolFailureCount: integer("tool_failure_count").notNull().default(0),
    modelTurnCount: integer("model_turn_count").notNull().default(0),
    continuationTurnCount: integer("continuation_turn_count").notNull().default(0),
    workspaceFileCount: integer("workspace_file_count"),
    workspaceDirectoryCount: integer("workspace_directory_count"),
    workspaceTotalBytes: integer("workspace_total_bytes"),
    workspaceHydrationDurationMs: integer("workspace_hydration_duration_ms"),
    workspaceHydrationHeartbeatCount: integer("workspace_hydration_heartbeat_count"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    lastUpdatedAt: integer("last_updated_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
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
    naniteId: text("nanite_id"),
    runKey: text("run_key"),
    requestId: text("request_id").notNull(),
    provider: text("provider"),
    model: text("model").notNull(),
    sessionAffinity: text("session_affinity"),
    isContinuation: integer("is_continuation", { mode: "boolean" }).notNull().default(false),
    stepCount: integer("step_count").notNull().default(1),
    finishReason: text("finish_reason"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    rawUsageJson: text("raw_usage_json"),
    providerMetadataJson: text("provider_metadata_json"),
    providerBilledTotalCostUsdMicros: integer("provider_billed_total_cost_usd_micros"),
    aiGatewayId: text("ai_gateway_id"),
    aiGatewayLogId: text("ai_gateway_log_id"),
    aiGatewayEventId: text("ai_gateway_event_id"),
    ...observabilityActorColumns(),
    ...billingAttributionColumns(),
    estimatedInputCostUsdMicros: integer("estimated_input_cost_usd_micros"),
    estimatedOutputCostUsdMicros: integer("estimated_output_cost_usd_micros"),
    estimatedTotalCostUsdMicros: integer("estimated_total_cost_usd_micros"),
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
    accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
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
  accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
  githubAppId: integer("github_app_id"),
  githubInstallationId: integer("github_installation_id"),
  githubRepositoryId: integer("github_repository_id"),
  repositoryFullName: text("repository_full_name"),
  naniteId: text("nanite_id"),
  runKey: text("run_key"),
  actorKind: text("actor_kind", { enum: OBSERVABILITY_ACTOR_KINDS }).notNull(),
  actorId: text("actor_id"),
  actorLogin: text("actor_login"),
  actorGithubUserId: integer("actor_github_user_id"),
  actorGithubLogin: text("actor_github_login"),
  billingGithubUserId: integer("billing_github_user_id"),
  billingGithubLogin: text("billing_github_login"),
  billingBasis: text("billing_basis"),
  surface: text("surface", { enum: OBSERVABILITY_ACTOR_SOURCES }).notNull(),
  targetType: text("target_type", { enum: AUDIT_TARGET_TYPES }).notNull(),
  targetId: text("target_id"),
  outcome: text("outcome", { enum: AUDIT_EVENT_OUTCOMES }).notNull(),
  reasonCode: text("reason_code"),
  requestId: text("request_id"),
  metadataJson: text("metadata_json").notNull().default("{}"),
});

export const platformUsageFacts = sqliteTable("platform_usage_facts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  githubAppId: integer("github_app_id"),
  githubInstallationId: integer("github_installation_id").references(
    () => accountInstallations.githubInstallationId,
    { onDelete: "cascade" },
  ),
  githubRepositoryId: integer("github_repository_id"),
  runKey: text("run_key"),
  category: text("category", { enum: PLATFORM_USAGE_CATEGORIES }).notNull(),
  eventKey: text("event_key").notNull(),
  status: text("status"),
  quantity: integer("quantity").notNull().default(1),
  durationMs: integer("duration_ms"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  occurredAt: integer("occurred_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const authFunnelFacts = sqliteTable("auth_funnel_facts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  githubAppId: integer("github_app_id"),
  githubInstallationId: integer("github_installation_id").references(
    () => accountInstallations.githubInstallationId,
    { onDelete: "cascade" },
  ),
  githubRepositoryId: integer("github_repository_id"),
  githubUserId: integer("github_user_id"),
  githubLogin: text("github_login"),
  eventType: text("event_type").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  occurredAt: integer("occurred_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const accountEntitlements = sqliteTable("account_entitlements", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().default("internal"),
  billingProvider: text("billing_provider"),
  externalBillingAccountId: text("external_billing_account_id"),
  seatCap: integer("seat_cap"),
  repoCap: integer("repo_cap"),
  runCap: integer("run_cap"),
  aiTokenAllowance: integer("ai_token_allowance"),
  browserVerificationAllowance: integer("browser_verification_allowance"),
  aiTokenOverageCount: integer("ai_token_overage_count").notNull().default(0),
  browserVerificationOverageCount: integer("browser_verification_overage_count")
    .notNull()
    .default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
