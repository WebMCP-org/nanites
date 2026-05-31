import { z } from "zod";

export const ACCOUNT_ID_DESCRIPTION =
  "Internal commercial account identifier derived from a GitHub installation owner.";
export const GITHUB_INSTALLATION_ID_DESCRIPTION = "GitHub App installation identifier.";
export const GITHUB_USER_ID_DESCRIPTION = "GitHub user identifier.";
export const GITHUB_ACCOUNT_ID_DESCRIPTION = "GitHub account identifier for an installation owner.";
export const GITHUB_REPOSITORY_ID_DESCRIPTION = "GitHub repository identifier.";

export const nanitesInstallationIdSchema = z
  .string()
  .min(1)
  .brand<"NanitesInstallationId">()
  .meta({ title: "NanitesInstallationId" })
  .describe("Internal Nanites installation identifier.");

export const accountIdSchema = z
  .string()
  .regex(/^account_\d+$/)
  .brand<"AccountId">()
  .meta({ title: "AccountId" })
  .describe(ACCOUNT_ID_DESCRIPTION);

export const githubInstallationIdSchema = z
  .number()
  .int()
  .positive()
  .brand<"GitHubInstallationId">()
  .meta({ title: "GitHubInstallationId" })
  .describe(GITHUB_INSTALLATION_ID_DESCRIPTION);

export const githubUserIdSchema = z
  .number()
  .int()
  .positive()
  .brand<"GitHubUserId">()
  .meta({ title: "GitHubUserId" })
  .describe(GITHUB_USER_ID_DESCRIPTION);

export const githubAccountIdSchema = z
  .number()
  .int()
  .positive()
  .brand<"GitHubAccountId">()
  .meta({ title: "GitHubAccountId" })
  .describe(GITHUB_ACCOUNT_ID_DESCRIPTION);

export const githubRepositoryIdSchema = z
  .number()
  .int()
  .positive()
  .brand<"GitHubRepositoryId">()
  .meta({ title: "GitHubRepositoryId" })
  .describe(GITHUB_REPOSITORY_ID_DESCRIPTION);

export type NanitesInstallationId = z.infer<typeof nanitesInstallationIdSchema>;
export type AccountId = z.infer<typeof accountIdSchema>;
export type GitHubInstallationId = z.infer<typeof githubInstallationIdSchema>;
export type GitHubUserId = z.infer<typeof githubUserIdSchema>;
export type GitHubAccountId = z.infer<typeof githubAccountIdSchema>;
export type GitHubRepositoryId = z.infer<typeof githubRepositoryIdSchema>;
