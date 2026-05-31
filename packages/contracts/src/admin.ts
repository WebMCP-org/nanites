import { z } from "zod";
import {
  githubAccountTypeSchema,
  installationStatusSchema,
  naniteVariantSchema,
  personRelationshipSchema,
  platformUsageCategorySchema,
  repositoryPermissionTierSchema,
  runConclusionSchema,
  runPhaseSchema,
  runStatusSchema,
  runTriggerKindSchema,
} from "@nanites/domain/business";
import { isoDateTimeSchema } from "./auth.ts";
import { naniteRunKeySchema } from "./nanites.ts";
import {
  accountIdSchema,
  githubAccountIdSchema,
  githubInstallationIdSchema,
  githubRepositoryIdSchema,
  githubUserIdSchema,
} from "./ids.ts";

const countSchema = z.number().int().nonnegative();
const optionalIsoDateTimeSchema = isoDateTimeSchema.nullable();

export const adminMeSchema = z
  .object({
    email: z.string().email(),
  })
  .describe("Resolved admin actor identity for the current request.");

export const adminRefreshSchema = z
  .object({
    syncedAt: isoDateTimeSchema,
  })
  .describe("Timestamp of the latest explicit admin refresh.");

export const ADMIN_ERROR_CODES = {
  cloudflareAccessRequired: "cloudflare_access_required",
} as const;

export const cloudflareAccessRequiredErrorSchema = z
  .object({
    code: z.literal(ADMIN_ERROR_CODES.cloudflareAccessRequired),
    message: z.literal("Cloudflare Access is required for admin routes."),
  })
  .describe("The admin route requires a valid Cloudflare Access token.");

export const adminProcedureErrors = {
  UNAUTHORIZED: {
    message: cloudflareAccessRequiredErrorSchema.shape.message.value,
    data: cloudflareAccessRequiredErrorSchema,
  },
} as const;

export const adminOverviewSnapshotSchema = z
  .object({
    syncedAt: isoDateTimeSchema,
    installsTotal: countSchema,
    activeInstalls: countSchema,
    connectedRepos: countSchema,
    activePeople30d: countSchema,
    monthlyRuns: countSchema,
    estimatedMonthlyAiCostUsd: z.number().nonnegative(),
    authFunnel: z.object({
      oauthStarted: countSchema,
      oauthSucceeded: countSchema,
      oauthFailed: countSchema,
      installationRevoked: countSchema,
      zeroRepoViews: countSchema,
    }),
    quality: z.object({
      runFailureRate: z.number().min(0).max(1),
      topImplicitFailureReasons: z.array(
        z.object({
          reason: z.string().min(1),
          count: countSchema,
        }),
      ),
    }),
  })
  .describe("Top-line internal business and quality metrics for the Sigvelo admin overview.");

export const adminAccountListItemSchema = z
  .object({
    accountId: accountIdSchema,
    githubAccountId: githubAccountIdSchema,
    login: z.string().min(1),
    ownerType: githubAccountTypeSchema,
    avatarUrl: z.string().nullable(),
    installState: installationStatusSchema,
    repoCount: countSchema,
    memberCount: countSchema,
    activeUserCount30d: countSchema,
    lastActiveAt: optionalIsoDateTimeSchema,
    monthlyRunCount: countSchema,
    monthlyAiCostUsd: z.number().nonnegative(),
    riskFlags: z.array(z.string().min(1)),
  })
  .describe("One row in the internal accounts list.");

export const adminAccountsListSchema = z
  .object({
    accounts: z.array(adminAccountListItemSchema),
  })
  .describe("Internal admin accounts list.");

export const adminAccountInputSchema = z
  .object({
    accountId: accountIdSchema,
  })
  .describe("Look up one commercial account by its internal identifier.");

export const adminAccountInstallationSchema = z
  .object({
    githubInstallationId: githubInstallationIdSchema,
    status: installationStatusSchema,
    firstSeenAt: isoDateTimeSchema,
    lastSeenAt: isoDateTimeSchema,
    suspendedAt: optionalIsoDateTimeSchema,
    removedAt: optionalIsoDateTimeSchema,
  })
  .describe("Persisted GitHub App installation lifecycle for one account.");

export const adminAccountRepositorySchema = z
  .object({
    githubRepositoryId: githubRepositoryIdSchema,
    name: z.string().min(1),
    fullName: z.string().min(1),
    private: z.boolean(),
    permissionTier: repositoryPermissionTierSchema.nullable(),
    configEnabled: z.boolean(),
    configuredNaniteCount: countSchema,
    mcpServerCount: countSchema,
    missingSoulDocumentCount: countSchema,
    missingSkillDocumentCount: countSchema,
    brokenPromptConfig: z.boolean(),
    lastViewedAt: optionalIsoDateTimeSchema,
    lastRunAt: optionalIsoDateTimeSchema,
    lastActiveAt: optionalIsoDateTimeSchema,
    runCount: countSchema,
  })
  .describe("Repo inventory and activation state for one commercial account.");

export const adminAccountPersonSchema = z
  .object({
    githubUserId: githubUserIdSchema,
    login: z.string().min(1),
    relationship: personRelationshipSchema,
    lastSignedInAt: optionalIsoDateTimeSchema,
    lastActiveAt: optionalIsoDateTimeSchema,
  })
  .describe("Human actor observed for one commercial account.");

export const adminRecentRunSchema = z
  .object({
    runKey: naniteRunKeySchema,
    repositoryFullName: z.string().min(1),
    naniteId: z.string().min(1),
    variant: naniteVariantSchema,
    triggerKind: runTriggerKindSchema,
    status: runStatusSchema,
    conclusion: runConclusionSchema.nullable(),
    phase: runPhaseSchema,
    summary: z.string().nullable(),
    implicitFailureReason: z.string().nullable(),
    estimatedCostUsd: z.number().nonnegative(),
    startedAt: isoDateTimeSchema,
    completedAt: optionalIsoDateTimeSchema,
  })
  .describe("Recent run summary shown on an account detail page.");

export const adminMonthlyAiUsagePointSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    inputTokens: countSchema,
    outputTokens: countSchema,
    totalTokens: countSchema,
    estimatedCostUsd: z.number().nonnegative(),
  })
  .describe("Monthly AI usage point for one account.");

export const adminPlatformUsagePointSchema = z
  .object({
    category: platformUsageCategorySchema,
    eventCount: countSchema,
    totalDurationMs: countSchema,
  })
  .describe("Platform-usage aggregate bucket for one account.");

export const adminAccountAiUsageByPersonSchema = z
  .object({
    githubUserId: githubUserIdSchema.nullable(),
    login: z.string().min(1),
    relationship: personRelationshipSchema.nullable(),
    turnCount: countSchema,
    inputTokens: countSchema,
    outputTokens: countSchema,
    totalTokens: countSchema,
    estimatedCostUsd: z.number().nonnegative(),
  })
  .describe("Account-scoped AI usage aggregate grouped by resolved human attribution.");

export const adminAccountDetailSchema = z
  .object({
    account: adminAccountListItemSchema.pick({
      accountId: true,
      githubAccountId: true,
      login: true,
      ownerType: true,
      avatarUrl: true,
      installState: true,
      lastActiveAt: true,
      riskFlags: true,
    }),
    installations: z.array(adminAccountInstallationSchema),
    repositories: z.array(adminAccountRepositorySchema),
    people: z.array(adminAccountPersonSchema),
    recentRuns: z.array(adminRecentRunSchema),
    aiUsageByMonth: z.array(adminMonthlyAiUsagePointSchema),
    aiUsageByPerson: z.array(adminAccountAiUsageByPersonSchema),
    platformUsage: z.array(adminPlatformUsagePointSchema),
  })
  .describe("Full internal admin account detail snapshot.");

export const adminPeopleListItemSchema = z
  .object({
    accountId: accountIdSchema,
    accountLogin: z.string().min(1),
    githubUserId: githubUserIdSchema,
    login: z.string().min(1),
    relationship: personRelationshipSchema,
    lastSignedInAt: optionalIsoDateTimeSchema,
    lastActiveAt: optionalIsoDateTimeSchema,
  })
  .describe("One row in the internal people directory.");

export const adminPeopleListSchema = z
  .object({
    people: z.array(adminPeopleListItemSchema),
  })
  .describe("Internal people directory for admin review.");

export const adminAiUsageByModelSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    turnCount: countSchema,
    inputTokens: countSchema,
    outputTokens: countSchema,
    totalTokens: countSchema,
    estimatedCostUsd: z.number().nonnegative(),
  })
  .describe("AI usage aggregate grouped by provider and model.");

export const adminAiUsageByAccountSchema = z
  .object({
    accountId: accountIdSchema,
    accountLogin: z.string().min(1),
    turnCount: countSchema,
    inputTokens: countSchema,
    outputTokens: countSchema,
    totalTokens: countSchema,
    estimatedCostUsd: z.number().nonnegative(),
  })
  .describe("AI usage aggregate grouped by commercial account.");

export const adminAiUsageByPersonSchema = z
  .object({
    accountId: accountIdSchema,
    accountLogin: z.string().min(1),
    githubUserId: githubUserIdSchema.nullable(),
    login: z.string().min(1),
    turnCount: countSchema,
    inputTokens: countSchema,
    outputTokens: countSchema,
    totalTokens: countSchema,
    estimatedCostUsd: z.number().nonnegative(),
  })
  .describe("AI usage aggregate grouped by commercial account and resolved human attribution.");

export const adminAiUsageByRunSchema = z
  .object({
    accountId: accountIdSchema,
    accountLogin: z.string().min(1),
    githubRepositoryId: githubRepositoryIdSchema.nullable(),
    repositoryFullName: z.string().min(1),
    runKey: z.string().min(1),
    naniteId: z.string().min(1).nullable(),
    turnCount: countSchema,
    inputTokens: countSchema,
    outputTokens: countSchema,
    totalTokens: countSchema,
    estimatedCostUsd: z.number().nonnegative(),
  })
  .describe("AI usage aggregate grouped by commercial account and run.");

export const adminPlatformUsageByAccountSchema = z
  .object({
    accountId: accountIdSchema,
    accountLogin: z.string().min(1),
    githubOperationCount: countSchema,
    browserVerificationCount: countSchema,
    workspaceHydrationCount: countSchema,
    totalWorkspaceHydrationMs: countSchema,
  })
  .describe("Platform usage aggregate grouped by commercial account.");

export const adminValueByAccountSchema = z
  .object({
    accountId: accountIdSchema,
    accountLogin: z.string().min(1),
    runCount: countSchema,
  })
  .describe("Delivered-value aggregate grouped by commercial account.");

export const adminUsageSnapshotSchema = z
  .object({
    aiByModel: z.array(adminAiUsageByModelSchema),
    aiByAccount: z.array(adminAiUsageByAccountSchema),
    aiByPerson: z.array(adminAiUsageByPersonSchema),
    aiByRun: z.array(adminAiUsageByRunSchema),
    platformByAccount: z.array(adminPlatformUsageByAccountSchema),
    valueByAccount: z.array(adminValueByAccountSchema),
  })
  .describe("Internal usage and cost aggregates for the admin usage views.");

export type AdminMe = z.infer<typeof adminMeSchema>;
export type AdminRefresh = z.infer<typeof adminRefreshSchema>;
export type AdminOverviewSnapshot = z.infer<typeof adminOverviewSnapshotSchema>;
export type AdminAccountsList = z.infer<typeof adminAccountsListSchema>;
export type AdminAccountDetail = z.infer<typeof adminAccountDetailSchema>;
export type AdminPeopleList = z.infer<typeof adminPeopleListSchema>;
export type AdminUsageSnapshot = z.infer<typeof adminUsageSnapshotSchema>;
