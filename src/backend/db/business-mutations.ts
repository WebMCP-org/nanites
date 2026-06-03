import { eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import type { DbClient } from "./client.ts";
import {
  accounts,
  accountInstallations,
  authFunnelFacts,
  platformUsageFacts,
} from "./business-schema.ts";

type Defined<T> = Exclude<T, undefined>;
type PlatformUsageFactInsert = InferInsertModel<typeof platformUsageFacts>;
type AuthFunnelFactInsert = InferInsertModel<typeof authFunnelFacts>;

type AuthFunnelFactInput = {
  accountId?: AuthFunnelFactInsert["accountId"];
  githubInstallationId?: AuthFunnelFactInsert["githubInstallationId"];
  githubRepositoryId?: AuthFunnelFactInsert["githubRepositoryId"];
  githubUserId?: AuthFunnelFactInsert["githubUserId"];
  githubLogin?: AuthFunnelFactInsert["githubLogin"];
  eventType: Defined<AuthFunnelFactInsert["eventType"]>;
  metadata?: Record<string, unknown>;
  occurredAt?: Defined<AuthFunnelFactInsert["occurredAt"]>;
};

type PlatformUsageFactInput = {
  accountId?: PlatformUsageFactInsert["accountId"];
  githubInstallationId?: PlatformUsageFactInsert["githubInstallationId"];
  githubRepositoryId?: PlatformUsageFactInsert["githubRepositoryId"];
  runKey?: PlatformUsageFactInsert["runKey"];
  category: Defined<PlatformUsageFactInsert["category"]>;
  eventKey: Defined<PlatformUsageFactInsert["eventKey"]>;
  status?: PlatformUsageFactInsert["status"];
  quantity?: PlatformUsageFactInsert["quantity"];
  durationMs?: PlatformUsageFactInsert["durationMs"];
  metadata?: Record<string, unknown>;
  occurredAt?: Defined<PlatformUsageFactInsert["occurredAt"]>;
};

async function findAccountIdByInstallationId(
  db: DbClient,
  githubInstallationId: number,
): Promise<string | null> {
  const row = await db.query.accountInstallations.findFirst({
    columns: {
      accountId: true,
    },
    where: eq(accountInstallations.githubInstallationId, githubInstallationId),
  });

  return row?.accountId ?? null;
}

async function normalizeOptionalInstallationScope(
  db: DbClient,
  input: {
    accountId?: string | null;
    githubInstallationId?: number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{
  accountId: string | null;
  githubInstallationId: number | null;
  metadata: Record<string, unknown> | undefined;
}> {
  let accountId = input.accountId ?? null;
  let githubInstallationId = input.githubInstallationId ?? null;
  let metadata = input.metadata;

  if (githubInstallationId === null) {
    return {
      accountId,
      githubInstallationId,
      metadata,
    };
  }

  const mappedAccountId = await findAccountIdByInstallationId(db, githubInstallationId);
  if (mappedAccountId) {
    return {
      accountId: accountId ?? mappedAccountId,
      githubInstallationId,
      metadata,
    };
  }

  metadata = Object.assign({}, metadata, {
    unresolvedGithubInstallationId: githubInstallationId,
  });
  githubInstallationId = null;

  return {
    accountId,
    githubInstallationId,
    metadata,
  };
}

async function touchAccountActivity(db: DbClient, accountId: string, at: Date): Promise<void> {
  await db
    .update(accounts)
    .set({
      lastActiveAt: at,
      updatedAt: at,
    })
    .where(eq(accounts.id, accountId))
    .run();
}

export async function recordAuthFunnelFact(
  db: DbClient,
  input: AuthFunnelFactInput,
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const normalizedScope = await normalizeOptionalInstallationScope(db, {
    accountId: input.accountId ?? null,
    githubInstallationId: input.githubInstallationId ?? null,
    metadata: input.metadata,
  });

  await db
    .insert(authFunnelFacts)
    .values({
      id: crypto.randomUUID(),
      accountId: normalizedScope.accountId,
      githubInstallationId: normalizedScope.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId ?? null,
      githubUserId: input.githubUserId ?? null,
      githubLogin: input.githubLogin ?? null,
      eventType: input.eventType,
      metadataJson: JSON.stringify(normalizedScope.metadata ?? {}),
      occurredAt,
    })
    .run();

  await recordPlatformUsageFact(db, {
    accountId: normalizedScope.accountId,
    githubInstallationId: normalizedScope.githubInstallationId,
    githubRepositoryId: input.githubRepositoryId ?? null,
    category: "auth",
    eventKey: input.eventType,
    metadata: normalizedScope.metadata,
    occurredAt,
  });

  if (normalizedScope.accountId) {
    await touchAccountActivity(db, normalizedScope.accountId, occurredAt);
  }
}

export async function recordPlatformUsageFact(
  db: DbClient,
  input: PlatformUsageFactInput,
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const normalizedScope = await normalizeOptionalInstallationScope(db, {
    accountId: input.accountId ?? null,
    githubInstallationId: input.githubInstallationId ?? null,
    metadata: input.metadata,
  });

  await db
    .insert(platformUsageFacts)
    .values({
      id: crypto.randomUUID(),
      accountId: normalizedScope.accountId,
      githubInstallationId: normalizedScope.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId ?? null,
      runKey: input.runKey ?? null,
      category: input.category,
      eventKey: input.eventKey,
      status: input.status ?? null,
      quantity: input.quantity ?? 1,
      durationMs: input.durationMs ?? null,
      metadataJson: JSON.stringify(normalizedScope.metadata ?? {}),
      occurredAt,
    })
    .run();

  if (normalizedScope.accountId) {
    await touchAccountActivity(db, normalizedScope.accountId, occurredAt);
  }
}
