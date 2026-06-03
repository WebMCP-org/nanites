/**
 * Authoritative Drizzle schema for Sigvelo business and reporting tables.
 *
 * Ownership:
 * - This file owns persistence structure: table names, columns, defaults, constraints, and enum
 *   domains used by the business warehouse tables.
 * - Shared business enums that are also needed outside DB live in `src/shared/domain`.
 * - API semantics and mutation command shapes do not belong here.
 */
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  CONFIG_SOURCES,
  GITHUB_ACCOUNT_TYPES,
  INSTALLATION_STATUSES,
  NANITE_VARIANTS,
  PERSON_RELATIONSHIPS,
  PLATFORM_USAGE_CATEGORIES,
  RUN_CONCLUSIONS,
  RUN_PHASES,
  RUN_STATUSES,
  RUN_TRIGGER_KINDS,
} from "#/shared/domain/business.ts";
import type { GitHubInstallationRepository } from "#/backend/github.ts";

export {
  CONFIG_SOURCES,
  GITHUB_ACCOUNT_TYPES,
  INSTALLATION_STATUSES,
  NANITE_VARIANTS,
  PERSON_RELATIONSHIPS,
  PLATFORM_USAGE_CATEGORIES,
  RUN_CONCLUSIONS,
  RUN_PHASES,
  RUN_STATUSES,
  RUN_TRIGGER_KINDS,
} from "#/shared/domain/business.ts";
export type {
  ConfigSource,
  GitHubAccountType,
  InstallationStatus,
  NaniteVariant,
  PersonRelationship,
  PlatformUsageCategory,
  RunConclusion,
  RunPhase,
  RunStatus,
  RunTriggerKind,
} from "#/shared/domain/business.ts";

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
    uniqueIndex("account_installations_github_installation_id_unique").on(
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

export const naniteRunFacts = sqliteTable(
  "nanite_run_facts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    githubInstallationId: integer("github_installation_id")
      .notNull()
      .references(() => accountInstallations.githubInstallationId, { onDelete: "cascade" }),
    githubRepositoryId: integer("github_repository_id").notNull(),
    full_name: text("full_name").notNull(),
    runKey: text("run_key").notNull(),
    naniteId: text("nanite_id").notNull(),
    variant: text("variant", { enum: NANITE_VARIANTS }).notNull(),
    triggerKind: text("trigger_kind", { enum: RUN_TRIGGER_KINDS }).notNull(),
    triggerPullRequestNumber: integer("trigger_pull_request_number"),
    triggeredByGithubUserId: integer("triggered_by_github_user_id"),
    triggeredByGithubLogin: text("triggered_by_github_login"),
    status: text("status", { enum: RUN_STATUSES }).notNull(),
    conclusion: text("conclusion", { enum: RUN_CONCLUSIONS }),
    phase: text("phase", { enum: RUN_PHASES }).notNull(),
    task: text("task").notNull(),
    summary: text("summary"),
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

export const aiPricingSnapshots = sqliteTable(
  "ai_pricing_snapshots",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    effectiveAt: integer("effective_at", { mode: "timestamp" }).notNull(),
    inputTokenCostPerMillionUsdMicros: integer("input_token_cost_per_million_usd_micros").notNull(),
    cachedInputTokenCostPerMillionUsdMicros: integer(
      "cached_input_token_cost_per_million_usd_micros",
    ),
    outputTokenCostPerMillionUsdMicros: integer(
      "output_token_cost_per_million_usd_micros",
    ).notNull(),
    reasoningTokenCostPerMillionUsdMicros: integer("reasoning_token_cost_per_million_usd_micros"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_pricing_snapshots_provider_model_effective_unique").on(
      table.provider,
      table.model,
      table.effectiveAt,
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
    githubInstallationId: integer("github_installation_id")
      .notNull()
      .references(() => accountInstallations.githubInstallationId, { onDelete: "cascade" }),
    githubRepositoryId: integer("github_repository_id"),
    runKey: text("run_key"),
    requestId: text("request_id").notNull(),
    provider: text("provider").notNull(),
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

export const platformUsageFacts = sqliteTable("platform_usage_facts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
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
