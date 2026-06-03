export const GITHUB_ACCOUNT_TYPES = ["User", "Organization"] as const;
export const INSTALLATION_STATUSES = ["active", "suspended", "removed"] as const;
export const PERSON_RELATIONSHIPS = ["sign_in_user", "github_actor"] as const;
export const RUN_TRIGGER_KINDS = ["manual", "github-pull-request"] as const;
export const CONFIG_SOURCES = ["default"] as const;
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
export const PLATFORM_USAGE_CATEGORIES = [
  "github-api",
  "workspace-hydration",
  "browser-verification",
  "run-phase",
  "mcp-readiness",
  "auth",
  "ui",
] as const;

export type GitHubAccountType = (typeof GITHUB_ACCOUNT_TYPES)[number];
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];
export type PersonRelationship = (typeof PERSON_RELATIONSHIPS)[number];
export type RunTriggerKind = (typeof RUN_TRIGGER_KINDS)[number];
export type ConfigSource = (typeof CONFIG_SOURCES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunConclusion = (typeof RUN_CONCLUSIONS)[number];
export type RunPhase = (typeof RUN_PHASES)[number];
export type NaniteVariant = (typeof NANITE_VARIANTS)[number];
export type PlatformUsageCategory = (typeof PLATFORM_USAGE_CATEGORIES)[number];
