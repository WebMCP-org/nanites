import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { DbClient } from "@nanites/db/client";
import { accountPeople, accounts, aiUsageFacts, naniteRunFacts } from "@nanites/db/schema/business";

function microsToUsd(value: number | null | undefined): number {
  return value == null ? 0 : value / 1_000_000;
}

export function buildAiUsageMonthSql() {
  return sql<string>`strftime('%Y-%m', ${aiUsageFacts.completedAt}, 'unixepoch')`;
}

export function buildResolvedAiCostUsdMicrosSql() {
  return sql<number>`coalesce(${aiUsageFacts.providerBilledTotalCostUsdMicros}, ${aiUsageFacts.estimatedTotalCostUsdMicros}, 0)`;
}

export function buildResolvedAiCostUsdMicrosSumSql() {
  return sql<number>`coalesce(sum(${buildResolvedAiCostUsdMicrosSql()}), 0)`;
}

function buildAiUsageRunFactJoinSql() {
  return and(
    eq(aiUsageFacts.accountId, naniteRunFacts.accountId),
    eq(aiUsageFacts.githubInstallationId, naniteRunFacts.githubInstallationId),
    eq(aiUsageFacts.githubRepositoryId, naniteRunFacts.githubRepositoryId),
    eq(aiUsageFacts.runKey, naniteRunFacts.runKey),
  );
}

export async function listAccountAiUsageByMonth(db: DbClient, accountId: string) {
  const aiUsageMonth = buildAiUsageMonthSql();

  const aiUsageRows = await db
    .select({
      month: aiUsageMonth,
      inputTokens: sql<number>`coalesce(sum(${aiUsageFacts.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageFacts.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiUsageFacts.totalTokens}), 0)`,
      estimatedCostUsdMicros: buildResolvedAiCostUsdMicrosSumSql(),
    })
    .from(aiUsageFacts)
    .where(eq(aiUsageFacts.accountId, accountId))
    .groupBy(aiUsageMonth)
    .orderBy(desc(aiUsageMonth))
    .limit(6);

  return aiUsageRows
    .map((row) => ({
      month: row.month,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      estimatedCostUsd: microsToUsd(row.estimatedCostUsdMicros),
    }))
    .sort((left, right) => right.month.localeCompare(left.month));
}

export async function listAccountAiUsageByPerson(db: DbClient, accountId: string) {
  const rows = await db
    .select({
      githubUserId: naniteRunFacts.triggeredByGithubUserId,
      login: sql<string>`coalesce(${naniteRunFacts.triggeredByGithubLogin}, 'Unattributed')`.as(
        "login",
      ),
      relationship: accountPeople.relationship,
      turnCount: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${aiUsageFacts.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageFacts.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiUsageFacts.totalTokens}), 0)`,
      estimatedCostUsdMicros: buildResolvedAiCostUsdMicrosSumSql(),
    })
    .from(aiUsageFacts)
    .leftJoin(naniteRunFacts, buildAiUsageRunFactJoinSql())
    .leftJoin(
      accountPeople,
      and(
        eq(accountPeople.accountId, aiUsageFacts.accountId),
        eq(accountPeople.githubUserId, naniteRunFacts.triggeredByGithubUserId),
      ),
    )
    .where(eq(aiUsageFacts.accountId, accountId))
    .groupBy(
      naniteRunFacts.triggeredByGithubUserId,
      naniteRunFacts.triggeredByGithubLogin,
      accountPeople.relationship,
    )
    .orderBy(desc(buildResolvedAiCostUsdMicrosSumSql()), desc(sql`count(*)`));

  return rows.map((row) => ({
    githubUserId: row.githubUserId,
    login: row.login,
    relationship: row.relationship,
    turnCount: row.turnCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    estimatedCostUsd: microsToUsd(row.estimatedCostUsdMicros),
  }));
}

export async function listAdminAiUsageByPerson(db: DbClient) {
  const rows = await db
    .select({
      accountId: aiUsageFacts.accountId,
      accountLogin: accounts.githubAccountLogin,
      githubUserId: naniteRunFacts.triggeredByGithubUserId,
      login: sql<string>`coalesce(${naniteRunFacts.triggeredByGithubLogin}, 'Unattributed')`.as(
        "login",
      ),
      turnCount: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${aiUsageFacts.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageFacts.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiUsageFacts.totalTokens}), 0)`,
      estimatedCostUsdMicros: buildResolvedAiCostUsdMicrosSumSql(),
    })
    .from(aiUsageFacts)
    .innerJoin(accounts, eq(aiUsageFacts.accountId, accounts.id))
    .leftJoin(naniteRunFacts, buildAiUsageRunFactJoinSql())
    .groupBy(
      aiUsageFacts.accountId,
      accounts.githubAccountLogin,
      naniteRunFacts.triggeredByGithubUserId,
      naniteRunFacts.triggeredByGithubLogin,
    )
    .orderBy(desc(buildResolvedAiCostUsdMicrosSumSql()), desc(sql`count(*)`));

  return rows.map((row) => ({
    accountId: row.accountId,
    accountLogin: row.accountLogin,
    githubUserId: row.githubUserId,
    login: row.login,
    turnCount: row.turnCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    estimatedCostUsd: microsToUsd(row.estimatedCostUsdMicros),
  }));
}

export async function listAdminAiUsageByRun(db: DbClient) {
  const rows = await db
    .select({
      accountId: aiUsageFacts.accountId,
      accountLogin: accounts.githubAccountLogin,
      githubRepositoryId: sql<
        number | null
      >`coalesce(${naniteRunFacts.githubRepositoryId}, ${aiUsageFacts.githubRepositoryId})`.as(
        "github_repository_id",
      ),
      repositoryFullName:
        sql<string>`coalesce(${naniteRunFacts.repositoryFullName}, 'Unknown repository')`.as(
          "repository_full_name",
        ),
      runKey: sql<string>`coalesce(${naniteRunFacts.runKey}, ${aiUsageFacts.runKey})`.as("run_key"),
      naniteId: naniteRunFacts.naniteId,
      turnCount: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${aiUsageFacts.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageFacts.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiUsageFacts.totalTokens}), 0)`,
      estimatedCostUsdMicros: buildResolvedAiCostUsdMicrosSumSql(),
    })
    .from(aiUsageFacts)
    .innerJoin(accounts, eq(aiUsageFacts.accountId, accounts.id))
    .leftJoin(naniteRunFacts, buildAiUsageRunFactJoinSql())
    .where(isNotNull(aiUsageFacts.runKey))
    .groupBy(
      aiUsageFacts.accountId,
      accounts.githubAccountLogin,
      naniteRunFacts.githubRepositoryId,
      aiUsageFacts.githubRepositoryId,
      naniteRunFacts.repositoryFullName,
      naniteRunFacts.runKey,
      aiUsageFacts.runKey,
      naniteRunFacts.naniteId,
    )
    .orderBy(desc(buildResolvedAiCostUsdMicrosSumSql()), desc(sql`count(*)`));

  return rows.map((row) => ({
    accountId: row.accountId,
    accountLogin: row.accountLogin,
    githubRepositoryId: row.githubRepositoryId,
    repositoryFullName: row.repositoryFullName,
    runKey: row.runKey,
    naniteId: row.naniteId,
    turnCount: row.turnCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    estimatedCostUsd: microsToUsd(row.estimatedCostUsdMicros),
  }));
}

export async function listAdminValueByAccount(db: DbClient) {
  return db
    .select({
      accountId: naniteRunFacts.accountId,
      accountLogin: accounts.githubAccountLogin,
      runCount: sql<number>`count(*)`,
    })
    .from(naniteRunFacts)
    .innerJoin(accounts, eq(naniteRunFacts.accountId, accounts.id))
    .groupBy(naniteRunFacts.accountId, accounts.githubAccountLogin)
    .orderBy(desc(sql`count(*)`));
}
