/**
 * Drizzle-to-Zod bridge for persisted business tables.
 *
 * Ownership:
 * - `schema/` owns Drizzle tables, columns, defaults, and relational structure.
 * - `zod/` derives runtime schemas from those tables and adds contract-facing field semantics.
 * - `mutations/` owns persistence commands and should consume these derived row/insert types for
 *   table-shaped writes.
 *
 * Rules:
 * - Prefer `createSelectSchema` and `createInsertSchema` over handwritten row or insert types.
 * - Keep API command shapes out of this file; this layer is for persisted table shapes only.
 * - When semantics matter to downstream consumers, annotate the derived schema here rather than
 *   re-documenting the same field in parallel elsewhere.
 */
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import {
  accountEntitlements,
  accountInstallations,
  accountInstallationRepositoryMap,
  accountPeople,
  accountRepositories,
  accounts,
  aiPricingSnapshots,
  aiUsageFacts,
  authFunnelFacts,
  naniteRunFacts,
  platformUsageFacts,
} from "../schema/business.ts";

export const accountRowSchema = createSelectSchema(accounts, {
  id: (schema) => schema.describe("Internal commercial account identifier."),
  githubAccountId: (schema) =>
    schema.describe("GitHub account identifier for the installation owner."),
  githubAccountLogin: (schema) => schema.describe("GitHub login for the installation owner."),
  githubAccountType: (schema) => schema.describe("GitHub owner type for the installation owner."),
  githubAccountAvatarUrl: (schema) =>
    schema.describe("GitHub avatar URL for the installation owner, when known."),
  lastActiveAt: (schema) =>
    schema.describe("Most recent observed activity timestamp for the account."),
  firstSeenAt: (schema) => schema.describe("Timestamp when Sigvelo first observed the account."),
  createdAt: (schema) => schema.describe("Timestamp when the local account row was created."),
  updatedAt: (schema) => schema.describe("Timestamp when the local account row was last updated."),
}).describe("Persisted commercial account row derived directly from the Drizzle business schema.");

export const accountInstallationRowSchema = createSelectSchema(accountInstallations, {
  id: (schema) => schema.describe("Internal account-installation row identifier."),
  accountId: (schema) => schema.describe("Internal commercial account identifier."),
  githubInstallationId: (schema) => schema.describe("GitHub App installation identifier."),
  status: (schema) => schema.describe("Persisted GitHub App installation lifecycle state."),
  firstSeenAt: (schema) =>
    schema.describe("Timestamp when Sigvelo first observed the installation."),
  lastSeenAt: (schema) =>
    schema.describe("Timestamp when Sigvelo most recently observed the installation."),
  suspendedAt: (schema) =>
    schema.describe("Timestamp when GitHub reported the installation as suspended, if any."),
  removedAt: (schema) =>
    schema.describe("Timestamp when Sigvelo marked the installation as removed, if any."),
  createdAt: (schema) => schema.describe("Timestamp when the local installation row was created."),
  updatedAt: (schema) =>
    schema.describe("Timestamp when the local installation row was last updated."),
}).describe(
  "Persisted account-installation row derived directly from the Drizzle business schema.",
);

export const accountRepositoryRowSchema = createSelectSchema(accountRepositories, {
  id: (schema) => schema.describe("Internal account-repository row identifier."),
  accountId: (schema) => schema.describe("Internal commercial account identifier."),
  githubInstallationId: (schema) =>
    schema.describe("GitHub App installation identifier that grants repo access."),
  githubRepositoryId: (schema) => schema.describe("GitHub repository identifier."),
  name: (schema) => schema.describe("Repository name without the owner prefix."),
  fullName: (schema) => schema.describe("GitHub full repository name in owner/name form."),
  ownerLogin: (schema) => schema.describe("GitHub owner login for the repository."),
  defaultBranch: (schema) => schema.describe("Default branch recorded for the repository."),
  private: (schema) => schema.describe("Whether the repository is private on GitHub."),
  permissionTier: (schema) =>
    schema.describe("Highest repository permission tier observed for the active actor."),
  configSource: (schema) =>
    schema.describe("Where the effective Nanites config snapshot came from."),
  configEnabled: (schema) => schema.describe("Whether the repo-level Nanites config is enabled."),
  configuredNaniteCount: (schema) =>
    schema.describe("Number of configured Nanites discovered for the repo."),
  mcpServerCount: (schema) =>
    schema.describe("Number of MCP servers required by the effective config."),
  missingSoulDocumentCount: (schema) => schema.describe("Number of missing soul prompt documents."),
  missingSkillDocumentCount: (schema) =>
    schema.describe("Number of missing skill prompt documents."),
  brokenPromptConfig: (schema) =>
    schema.describe("Whether the effective prompt configuration could not be resolved."),
  lastConfigFetchedAt: (schema) =>
    schema.describe("Timestamp when the effective config was last refreshed."),
  lastViewedAt: (schema) => schema.describe("Timestamp when the repo was last viewed in the UI."),
  lastRunAt: (schema) => schema.describe("Timestamp when a Nanite run last executed for the repo."),
  lastActiveAt: (schema) =>
    schema.describe("Most recent observed activity timestamp for the repo."),
  firstSeenAt: (schema) => schema.describe("Timestamp when Sigvelo first observed the repo."),
  lastSeenAt: (schema) =>
    schema.describe("Timestamp when Sigvelo most recently observed the repo."),
  createdAt: (schema) => schema.describe("Timestamp when the local repo row was created."),
  updatedAt: (schema) => schema.describe("Timestamp when the local repo row was last updated."),
}).describe("Persisted account-repository row derived directly from the Drizzle business schema.");

export const accountPersonRowSchema = createSelectSchema(accountPeople, {
  id: (schema) => schema.describe("Internal account-person row identifier."),
  accountId: (schema) => schema.describe("Internal commercial account identifier."),
  githubUserId: (schema) => schema.describe("GitHub user identifier for the observed human actor."),
  githubLogin: (schema) => schema.describe("GitHub login for the observed human actor."),
  relationship: (schema) =>
    schema.describe("How the person was observed in relation to the account."),
  lastSignedInAt: (schema) =>
    schema.describe("Timestamp when the person last signed in through GitHub, if known."),
  lastActiveAt: (schema) =>
    schema.describe("Most recent observed activity timestamp for the person."),
  firstSeenAt: (schema) => schema.describe("Timestamp when Sigvelo first observed the person."),
  createdAt: (schema) => schema.describe("Timestamp when the local person row was created."),
  updatedAt: (schema) => schema.describe("Timestamp when the local person row was last updated."),
}).describe("Persisted account-person row derived directly from the Drizzle business schema.");

export const naniteRunFactRowSchema = createSelectSchema(naniteRunFacts, {
  id: (schema) => schema.describe("Internal persisted run-fact identifier."),
  accountId: (schema) => schema.describe("Internal commercial account identifier."),
  githubInstallationId: (schema) =>
    schema.describe("GitHub App installation identifier for the run."),
  githubRepositoryId: (schema) => schema.describe("GitHub repository identifier for the run."),
  repositoryFullName: (schema) =>
    schema.describe("GitHub full repository name in owner/name form."),
  runKey: (schema) => schema.describe("Stable Nanite run key."),
  naniteId: (schema) => schema.describe("Configured Nanite identifier for the run."),
  variant: (schema) => schema.describe("Execution substrate used for the run."),
  triggerKind: (schema) => schema.describe("How the run was triggered."),
  triggerPullRequestNumber: (schema) =>
    schema.describe("GitHub pull request number when the run was PR-triggered."),
  triggeredByGithubUserId: (schema) =>
    schema.describe("GitHub user identifier for the human who started the run, if any."),
  triggeredByGithubLogin: (schema) =>
    schema.describe("GitHub login for the human who started the run, if any."),
  status: (schema) => schema.describe("Persisted lifecycle status for the run."),
  conclusion: (schema) => schema.describe("Terminal conclusion for the run, if any."),
  phase: (schema) => schema.describe("High-signal execution phase for the run."),
  task: (schema) => schema.describe("Concrete task text given to the run."),
  summary: (schema) => schema.describe("High-level summary recorded for the run, if any."),
  configSource: (schema) =>
    schema.describe("Where the effective Nanites config snapshot came from."),
  implicitFailureReason: (schema) =>
    schema.describe("Best-effort inferred failure reason, if any."),
  startedAt: (schema) => schema.describe("Timestamp when the run started."),
  completedAt: (schema) => schema.describe("Timestamp when the run completed, if any."),
  lastUpdatedAt: (schema) => schema.describe("Timestamp when the run fact was last refreshed."),
  createdAt: (schema) => schema.describe("Timestamp when the local run-fact row was created."),
  updatedAt: (schema) => schema.describe("Timestamp when the local run-fact row was last updated."),
}).describe("Persisted Nanite run fact row derived directly from the Drizzle business schema.");

export const aiPricingSnapshotRowSchema = createSelectSchema(aiPricingSnapshots).describe(
  "Persisted AI pricing snapshot row derived directly from the Drizzle business schema.",
);

export const aiUsageFactRowSchema = createSelectSchema(aiUsageFacts).describe(
  "Persisted AI usage fact row derived directly from the Drizzle business schema.",
);

export const platformUsageFactRowSchema = createSelectSchema(platformUsageFacts).describe(
  "Persisted platform usage fact row derived directly from the Drizzle business schema.",
);

export const authFunnelFactRowSchema = createSelectSchema(authFunnelFacts).describe(
  "Persisted auth-funnel fact row derived directly from the Drizzle business schema.",
);

export const accountEntitlementRowSchema = createSelectSchema(accountEntitlements).describe(
  "Persisted account entitlement row derived directly from the Drizzle business schema.",
);

export const accountInstallationRepositoryMapRowSchema = createSelectSchema(
  accountInstallationRepositoryMap,
  {
    githubInstallationId: (schema) => schema.describe("GitHub App installation identifier."),
    githubRepositoryId: (schema) => schema.describe("GitHub repository identifier."),
  },
).describe(
  "Persisted installation-to-repository mapping row derived directly from the Drizzle business schema.",
);

export const accountInsertSchema = createInsertSchema(accounts).describe(
  "Insert values for the persisted account row, derived directly from the Drizzle business schema.",
);
export const accountInstallationInsertSchema = createInsertSchema(accountInstallations).describe(
  "Insert values for the persisted account-installation row, derived directly from the Drizzle business schema.",
);
export const accountRepositoryInsertSchema = createInsertSchema(accountRepositories).describe(
  "Insert values for the persisted account-repository row, derived directly from the Drizzle business schema.",
);
export const accountPersonInsertSchema = createInsertSchema(accountPeople).describe(
  "Insert values for the persisted account-person row, derived directly from the Drizzle business schema.",
);
export const naniteRunFactInsertSchema = createInsertSchema(naniteRunFacts).describe(
  "Insert values for the persisted Nanite run-fact row, derived directly from the Drizzle business schema.",
);
export const aiPricingSnapshotInsertSchema = createInsertSchema(aiPricingSnapshots).describe(
  "Insert values for the persisted AI pricing snapshot row, derived directly from the Drizzle business schema.",
);
export const aiUsageFactInsertSchema = createInsertSchema(aiUsageFacts).describe(
  "Insert values for the persisted AI usage fact row, derived directly from the Drizzle business schema.",
);
export const platformUsageFactInsertSchema = createInsertSchema(platformUsageFacts).describe(
  "Insert values for the persisted platform-usage fact row, derived directly from the Drizzle business schema.",
);
export const authFunnelFactInsertSchema = createInsertSchema(authFunnelFacts).describe(
  "Insert values for the persisted auth-funnel fact row, derived directly from the Drizzle business schema.",
);
export const accountEntitlementInsertSchema = createInsertSchema(accountEntitlements).describe(
  "Insert values for the persisted account entitlement row, derived directly from the Drizzle business schema.",
);
export const accountInstallationRepositoryMapInsertSchema = createInsertSchema(
  accountInstallationRepositoryMap,
).describe(
  "Insert values for the persisted installation-to-repository mapping row, derived directly from the Drizzle business schema.",
);

export type AccountRow = z.infer<typeof accountRowSchema>;
export type AccountInstallationRow = z.infer<typeof accountInstallationRowSchema>;
export type AccountRepositoryRow = z.infer<typeof accountRepositoryRowSchema>;
export type AccountPersonRow = z.infer<typeof accountPersonRowSchema>;
export type NaniteRunFactRow = z.infer<typeof naniteRunFactRowSchema>;
export type AiPricingSnapshotRow = z.infer<typeof aiPricingSnapshotRowSchema>;
export type AiUsageFactRow = z.infer<typeof aiUsageFactRowSchema>;
export type PlatformUsageFactRow = z.infer<typeof platformUsageFactRowSchema>;
export type AuthFunnelFactRow = z.infer<typeof authFunnelFactRowSchema>;
export type AccountEntitlementRow = z.infer<typeof accountEntitlementRowSchema>;
export type AccountInstallationRepositoryMapRow = z.infer<
  typeof accountInstallationRepositoryMapRowSchema
>;

export type AccountInsert = z.input<typeof accountInsertSchema>;
export type AccountInstallationInsert = z.input<typeof accountInstallationInsertSchema>;
export type AccountRepositoryInsert = z.input<typeof accountRepositoryInsertSchema>;
export type AccountPersonInsert = z.input<typeof accountPersonInsertSchema>;
export type NaniteRunFactInsert = z.input<typeof naniteRunFactInsertSchema>;
export type AiPricingSnapshotInsert = z.input<typeof aiPricingSnapshotInsertSchema>;
export type AiUsageFactInsert = z.input<typeof aiUsageFactInsertSchema>;
export type PlatformUsageFactInsert = z.input<typeof platformUsageFactInsertSchema>;
export type AuthFunnelFactInsert = z.input<typeof authFunnelFactInsertSchema>;
export type AccountEntitlementInsert = z.input<typeof accountEntitlementInsertSchema>;
export type AccountInstallationRepositoryMapInsert = z.input<
  typeof accountInstallationRepositoryMapInsertSchema
>;
