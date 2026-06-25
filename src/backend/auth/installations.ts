import { createDbClient } from "#/backend/db/index.ts";
import { AppError } from "#/backend/errors.ts";
import { requireDeploymentGitHubApp } from "#/backend/github/apps.ts";
import { buildNaniteManagerKey, type NaniteManagerKey } from "#/shared/utils/nanites.ts";
import { and, eq } from "drizzle-orm";
import { accountInstallations, accountRepositories, accounts } from "#/backend/db/schema.ts";
import type { GitHubInstallationRepository } from "#/backend/github/index.ts";

type DeploymentGitHubInstallationAccount = {
  readonly id: number;
  readonly login: string;
  readonly type: string;
  readonly avatar_url: string | null;
};

export type DeploymentGitHubInstallation = {
  readonly githubAppId: number;
  readonly githubInstallationId: number;
  readonly account: DeploymentGitHubInstallationAccount;
  readonly repositories: readonly GitHubInstallationRepository[];
  readonly managerName: NaniteManagerKey;
};

export async function requireDeploymentGitHubInstallation(
  env: Env,
): Promise<DeploymentGitHubInstallation> {
  const db = createDbClient(env.DB);
  const deploymentGitHubApp = await requireDeploymentGitHubApp(db, env);
  const rows = await db
    .select({
      githubAppId: accountInstallations.githubAppId,
      githubInstallationId: accountInstallations.githubInstallationId,
      accountId: accounts.githubAccountId,
      accountLogin: accounts.githubAccountLogin,
      accountType: accounts.githubAccountType,
      accountAvatarUrl: accounts.githubAccountAvatarUrl,
    })
    .from(accountInstallations)
    .innerJoin(accounts, eq(accountInstallations.accountId, accounts.id))
    .where(
      and(
        eq(accountInstallations.githubAppId, deploymentGitHubApp.appId),
        eq(accountInstallations.status, "active"),
      ),
    );

  if (rows.length === 0) {
    throw new AppError("deploymentGitHubInstallationRequired");
  }
  if (rows.length > 1) {
    throw new AppError("deploymentGitHubInstallationConflict", {
      details: {
        githubInstallationIds: rows.map((row) => row.githubInstallationId),
      },
    });
  }

  const installation = rows[0];
  const repositories = await db
    .select({
      githubRepository: accountRepositories.githubRepository,
    })
    .from(accountRepositories)
    .where(
      and(
        eq(accountRepositories.githubAppId, installation.githubAppId),
        eq(accountRepositories.githubInstallationId, installation.githubInstallationId),
      ),
    );
  const managerName = buildNaniteManagerKey({
    githubAppId: installation.githubAppId,
    githubInstallationId: installation.githubInstallationId,
  });

  return {
    githubAppId: installation.githubAppId,
    githubInstallationId: installation.githubInstallationId,
    account: {
      id: installation.accountId,
      login: installation.accountLogin,
      type: installation.accountType,
      avatar_url: installation.accountAvatarUrl,
    },
    repositories: repositories.map((row) => row.githubRepository),
    managerName,
  };
}
