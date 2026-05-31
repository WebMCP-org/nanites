/**
 * Installation snapshot persistence commands.
 *
 * Ownership:
 * - Keep GitHub-originated wrapper shapes local to this file.
 * - When a value becomes table-shaped, convert it to a `db/zod`-derived insert type before
 *   handing it to Drizzle.
 * - Do not define API schemas here.
 */
import { eq } from "drizzle-orm";
import type { InstallationStatus } from "@nanites/domain/business";
import type { DbClient } from "../client.ts";
import { installations } from "../schema/installations.ts";
import type { PersistedInstallationInsert } from "../zod/installations.ts";

type Defined<T> = Exclude<T, undefined>;

export type UpsertInstallationSnapshotAccountInput = {
  readonly id: Defined<PersistedInstallationInsert["githubAccountId"]>;
  readonly login: Defined<PersistedInstallationInsert["githubAccountLogin"]>;
  readonly type: Defined<PersistedInstallationInsert["githubAccountType"]>;
  readonly avatarUrl: Exclude<
    PersistedInstallationInsert["githubAccountAvatarUrl"],
    null | undefined
  >;
};

export type UpsertInstallationSnapshotInput = {
  readonly id: Defined<PersistedInstallationInsert["githubInstallationId"]>;
  readonly account: UpsertInstallationSnapshotAccountInput;
  readonly suspendedAt: string | null;
};

function toInstallationStatus(
  installation: UpsertInstallationSnapshotInput,
): Extract<InstallationStatus, "active" | "suspended"> {
  return installation.suspendedAt ? "suspended" : "active";
}

type PersistedInstallationSnapshotUpdate = Pick<
  PersistedInstallationInsert,
  | "githubAccountId"
  | "githubAccountLogin"
  | "githubAccountType"
  | "githubAccountAvatarUrl"
  | "status"
  | "updatedAt"
>;

function buildInstallationInsertValues(
  installation: UpsertInstallationSnapshotInput,
  now: Date,
): PersistedInstallationInsert {
  return {
    id: crypto.randomUUID(),
    githubInstallationId: installation.id,
    githubAccountId: installation.account.id,
    githubAccountLogin: installation.account.login,
    githubAccountType: installation.account.type,
    githubAccountAvatarUrl: installation.account.avatarUrl,
    status: toInstallationStatus(installation),
    createdAt: now,
    updatedAt: now,
  };
}

function buildInstallationUpdateValues(
  installation: UpsertInstallationSnapshotInput,
  now: Date,
): PersistedInstallationSnapshotUpdate {
  return {
    githubAccountId: installation.account.id,
    githubAccountLogin: installation.account.login,
    githubAccountType: installation.account.type,
    githubAccountAvatarUrl: installation.account.avatarUrl,
    status: toInstallationStatus(installation),
    updatedAt: now,
  };
}

export async function persistInstallationSnapshots(
  db: DbClient,
  snapshots: readonly UpsertInstallationSnapshotInput[],
): Promise<void> {
  for (const snapshot of snapshots) {
    const now = new Date();

    await db
      .insert(installations)
      .values(buildInstallationInsertValues(snapshot, now))
      .onConflictDoUpdate({
        target: installations.githubInstallationId,
        set: buildInstallationUpdateValues(snapshot, now),
      })
      .run();
  }
}

export async function markInstallationSnapshotRemoved(
  db: DbClient,
  githubInstallationId: number,
): Promise<void> {
  await db
    .update(installations)
    .set({
      status: "removed",
      updatedAt: new Date(),
    })
    .where(eq(installations.githubInstallationId, githubInstallationId))
    .run();
}
