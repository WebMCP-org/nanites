/**
 * Neutral business-domain enums and Zod schemas shared across package boundaries.
 *
 * Ownership:
 * - Put cross-package business vocabulary here when both `db` and `contracts` need it.
 * - Do not put Drizzle tables, persistence workflows, or API command shapes here.
 * - Keep this package dependency-light so it can remain below both `db` and `contracts`.
 */
import { z } from "zod";

export const GITHUB_ACCOUNT_TYPES = ["User", "Organization"] as const;
export const INSTALLATION_STATUSES = ["active", "suspended", "removed"] as const;
export const REPOSITORY_PERMISSION_TIERS = ["admin", "push", "read"] as const;
export const PERSON_RELATIONSHIPS = ["sign_in_user", "github_actor"] as const;
export const RUN_TRIGGER_KINDS = ["manual", "github-pull-request"] as const;
export const CONFIG_SOURCES = ["default"] as const;
export const NANITE_REPO_BINDING_ROLES = ["source", "target"] as const;
export const RUN_STATUSES = ["queued", "in_progress", "completed", "stale"] as const;
export const RUN_CONCLUSIONS = ["success", "failure", "neutral"] as const;
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
export const NANITE_EXECUTION_BACKENDS = ["workspace"] as const;
export const PLATFORM_USAGE_CATEGORIES = [
  "github-api",
  "workspace-hydration",
  "browser-verification",
  "run-phase",
  "mcp-readiness",
  "auth",
  "ui",
] as const;

export const githubAccountTypeSchema = z
  .enum(GITHUB_ACCOUNT_TYPES)
  .describe("GitHub account owner type for an app installation.");

export const installationStatusSchema = z
  .enum(INSTALLATION_STATUSES)
  .describe("Persisted installation lifecycle state derived from GitHub.");

export const repositoryPermissionTierSchema = z
  .enum(REPOSITORY_PERMISSION_TIERS)
  .describe("Highest repository permission the current actor has inside an installation.");

export const personRelationshipSchema = z
  .enum(PERSON_RELATIONSHIPS)
  .describe("How a person was observed in relation to an account.");

export const runTriggerKindSchema = z
  .enum(RUN_TRIGGER_KINDS)
  .describe("How a run was triggered at the business-reporting layer.");

export const configSourceSchema = z
  .enum(CONFIG_SOURCES)
  .describe("Where the effective repo configuration snapshot came from.");

export const naniteRepoBindingRoleSchema = z
  .enum(NANITE_REPO_BINDING_ROLES)
  .describe("How a configured Nanite instance participates in a repository.");

export const runStatusSchema = z
  .enum(RUN_STATUSES)
  .describe("Lifecycle state for a repo-scoped Nanites run.");

export const runConclusionSchema = z
  .enum(RUN_CONCLUSIONS)
  .describe("Terminal conclusion for a Nanites run or GitHub result surface.");

export const runPhaseSchema = z
  .enum(RUN_PHASES)
  .describe(
    "Internal Nanites runtime phase retained for telemetry and transcript notes; product surfaces should prefer the simpler run status.",
  );

export const naniteVariantSchema = z
  .enum(NANITE_VARIANTS)
  .describe("Execution substrate currently supported by the Nanites shell.");

export const naniteExecutionBackendSchema = z
  .enum(NANITE_EXECUTION_BACKENDS)
  .describe("Actual execution backend used for one Nanites run.");

export const platformUsageCategorySchema = z
  .enum(PLATFORM_USAGE_CATEGORIES)
  .describe("Canonical platform-usage category recorded in business reporting.");

export type GitHubAccountType = z.infer<typeof githubAccountTypeSchema>;
export type InstallationStatus = z.infer<typeof installationStatusSchema>;
export type RepositoryPermissionTier = z.infer<typeof repositoryPermissionTierSchema>;
export type PersonRelationship = z.infer<typeof personRelationshipSchema>;
export type RunTriggerKind = z.infer<typeof runTriggerKindSchema>;
export type ConfigSource = z.infer<typeof configSourceSchema>;
export type NaniteRepoBindingRole = z.infer<typeof naniteRepoBindingRoleSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunConclusion = z.infer<typeof runConclusionSchema>;
export type RunPhase = z.infer<typeof runPhaseSchema>;
export type NaniteVariant = z.infer<typeof naniteVariantSchema>;
export type NaniteExecutionBackend = z.infer<typeof naniteExecutionBackendSchema>;
export type PlatformUsageCategory = z.infer<typeof platformUsageCategorySchema>;
