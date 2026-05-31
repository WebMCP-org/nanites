import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import type { ActiveInstallation } from "@nanites/contracts/auth";
import { githubAccountIdSchema } from "@nanites/contracts/ids";

export type GitHubVisibleInstallation =
  RestEndpointMethodTypes["apps"]["listInstallationsForAuthenticatedUser"]["response"]["data"]["installations"][number];

type GitHubInstallationAccount = ActiveInstallation["account"];

function toGitHubAccountType(accountType: string | null | undefined): "Organization" | "User" {
  return accountType === "User" ? "User" : "Organization";
}

/**
 * Normalizes Octokit's installation account payload into the contract shape SigVelo uses in the
 * live auth and installation boundaries.
 *
 * GitHub returns slightly different account identifiers across user and organization
 * installations. Keep that normalization in one place so the rest of the auth/control-plane
 * code can stay on contract types instead of re-implementing GitHub account heuristics.
 *
 * @see https://docs.github.com/en/rest/apps/installations
 * @see ./browser-auth/session.ts
 */
export function toGitHubInstallationAccount(
  account: GitHubVisibleInstallation["account"],
): GitHubInstallationAccount {
  if (!account || typeof account.id !== "number") {
    throw new Error("GitHub installation account payload is missing an id.");
  }

  const githubAccountLogin =
    ("login" in account ? account.login : undefined) ??
    ("slug" in account ? account.slug : undefined) ??
    account.name;
  if (typeof githubAccountLogin !== "string" || githubAccountLogin.length === 0) {
    throw new Error("GitHub installation account payload is missing a login-like identifier.");
  }

  const avatarUrl = account.avatar_url;
  if (typeof avatarUrl !== "string" || avatarUrl.length === 0) {
    throw new Error("GitHub installation account payload is missing an avatar_url.");
  }

  return {
    id: githubAccountIdSchema.parse(account.id),
    login: githubAccountLogin,
    type: toGitHubAccountType("type" in account ? account.type : undefined),
    avatar_url: avatarUrl,
  };
}
