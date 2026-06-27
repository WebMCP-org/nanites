import { and, eq, notInArray } from "drizzle-orm";
import type { DbClient } from "./index.ts";
import {
  accounts,
  accountInstallations,
  accountRepositories,
  type GitHubAccountType,
} from "./schema.ts";
import type {
  GitHubInstallationRepository,
  GitHubVisibleInstallation,
} from "#/backend/github/index.ts";

type VisibleInstallationProjection = {
  id: number;
  githubAppId: number;
  account: {
    id: number;
    login: string;
    type: string;
    avatar_url: string | null;
  };
};

type GitHubVisibleInstallationAccount = NonNullable<GitHubVisibleInstallation["account"]>;

function readGitHubAccountLogin(account: GitHubVisibleInstallationAccount): string | null {
  if ("login" in account && typeof account.login === "string" && account.login.length > 0) {
    return account.login;
  }
  if ("slug" in account && typeof account.slug === "string" && account.slug.length > 0) {
    return account.slug;
  }
  if ("name" in account && typeof account.name === "string" && account.name.length > 0) {
    return account.name;
  }

  return null;
}

function readVisibleInstallationProjection(
  installation: GitHubVisibleInstallation,
  githubAppId: number,
): VisibleInstallationProjection | null {
  if (installation.suspended_at || !installation.account) {
    return null;
  }

  const accountLogin = readGitHubAccountLogin(installation.account);
  if (!accountLogin || !Number.isInteger(installation.account.id) || installation.account.id <= 0) {
    return null;
  }

  return {
    id: installation.id,
    githubAppId,
    account: {
      id: installation.account.id,
      login: accountLogin,
      type:
        "type" in installation.account &&
        typeof installation.account.type === "string" &&
        installation.account.type.length > 0
          ? installation.account.type
          : "slug" in installation.account
            ? "Enterprise"
            : "Account",
      avatar_url: installation.account.avatar_url ?? null,
    },
  };
}

export async function requireInstallationAccount(
  db: DbClient,
  githubInstallationId: number,
): Promise<{ githubAccountLogin: string; githubAccountType: GitHubAccountType }> {
  const row = await db
    .select({
      githubAccountLogin: accounts.githubAccountLogin,
      githubAccountType: accounts.githubAccountType,
    })
    .from(accountInstallations)
    .innerJoin(accounts, eq(accountInstallations.accountId, accounts.id))
    .where(eq(accountInstallations.githubInstallationId, githubInstallationId))
    .limit(1)
    .get();

  if (!row) {
    throw new Error(`No account mapped for GitHub installation ${githubInstallationId}.`);
  }

  return row;
}

export async function requireAccountIdByInstallationId(
  db: DbClient,
  githubInstallationId: number,
): Promise<string> {
  const row = await db.query.accountInstallations.findFirst({
    columns: {
      accountId: true,
    },
    where: eq(accountInstallations.githubInstallationId, githubInstallationId),
  });

  if (!row) {
    throw new Error(`No account mapped for GitHub installation ${githubInstallationId}.`);
  }

  return row.accountId;
}

export async function touchAccountActivity(
  db: DbClient,
  accountId: string,
  at: Date,
): Promise<void> {
  await db
    .update(accounts)
    .set({
      lastActiveAt: at,
      updatedAt: at,
    })
    .where(eq(accounts.id, accountId))
    .run();
}

export async function recordVisibleInstallationSnapshots(
  db: DbClient,
  input: {
    githubAppId: number;
    installations: readonly GitHubVisibleInstallation[];
  },
  observedAt = new Date(),
): Promise<number> {
  let recorded = 0;
  for (const rawInstallation of input.installations) {
    const installation = readVisibleInstallationProjection(rawInstallation, input.githubAppId);
    if (!installation) {
      continue;
    }
    recorded += 1;

    const accountId = `github-account:${installation.account.id}`;
    await db
      .insert(accounts)
      .values({
        id: accountId,
        githubAccountId: installation.account.id,
        githubAccountLogin: installation.account.login,
        githubAccountType: installation.account.type === "Organization" ? "Organization" : "User",
        githubAccountAvatarUrl: installation.account.avatar_url,
        lastActiveAt: observedAt,
        firstSeenAt: observedAt,
        createdAt: observedAt,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: accounts.githubAccountId,
        set: {
          githubAccountLogin: installation.account.login,
          githubAccountType: installation.account.type === "Organization" ? "Organization" : "User",
          githubAccountAvatarUrl: installation.account.avatar_url,
          lastActiveAt: observedAt,
          updatedAt: observedAt,
        },
      })
      .run();

    await db
      .insert(accountInstallations)
      .values({
        id: `github-installation:${installation.id}`,
        accountId,
        githubAppId: installation.githubAppId,
        githubInstallationId: installation.id,
        status: "active",
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        createdAt: observedAt,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: accountInstallations.githubInstallationId,
        set: {
          accountId,
          githubAppId: installation.githubAppId,
          status: "active",
          lastSeenAt: observedAt,
          removedAt: null,
          updatedAt: observedAt,
        },
      })
      .run();
  }

  return recorded;
}

export async function recordInstallationRepositorySnapshots(
  db: DbClient,
  input: {
    githubAppId: number;
    githubInstallationId: number;
    repositories: readonly GitHubInstallationRepository[];
  },
  observedAt = new Date(),
): Promise<void> {
  const installation = await db.query.accountInstallations.findFirst({
    columns: {
      accountId: true,
    },
    where: and(
      eq(accountInstallations.githubAppId, input.githubAppId),
      eq(accountInstallations.githubInstallationId, input.githubInstallationId),
    ),
  });

  if (!installation) {
    throw new Error(`No account mapped for GitHub installation ${input.githubInstallationId}.`);
  }

  const repositoryIds = [...new Set(input.repositories.map((repository) => repository.id))];
  for (const repository of input.repositories) {
    await db
      .insert(accountRepositories)
      .values({
        id: `github-repository:${input.githubAppId}:${input.githubInstallationId}:${repository.id}`,
        accountId: installation.accountId,
        githubAppId: input.githubAppId,
        githubInstallationId: input.githubInstallationId,
        githubRepositoryId: repository.id,
        githubRepository: repository,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        createdAt: observedAt,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: [accountRepositories.accountId, accountRepositories.githubRepositoryId],
        set: {
          githubAppId: input.githubAppId,
          githubInstallationId: input.githubInstallationId,
          githubRepository: repository,
          lastSeenAt: observedAt,
          updatedAt: observedAt,
        },
      })
      .run();
  }

  const staleRepositoryFilter =
    repositoryIds.length > 0
      ? and(
          eq(accountRepositories.githubAppId, input.githubAppId),
          eq(accountRepositories.githubInstallationId, input.githubInstallationId),
          notInArray(accountRepositories.githubRepositoryId, repositoryIds),
        )
      : and(
          eq(accountRepositories.githubAppId, input.githubAppId),
          eq(accountRepositories.githubInstallationId, input.githubInstallationId),
        );

  await db.delete(accountRepositories).where(staleRepositoryFilter).run();
}
