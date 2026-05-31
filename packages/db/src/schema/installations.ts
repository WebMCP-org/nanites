/**
 * Authoritative Drizzle schema for persisted installation snapshots.
 *
 * Ownership:
 * - This file owns the persisted installation table shape.
 * - Derived row and insert schemas belong in `zod/installations.ts`.
 * - GitHub command inputs and persistence workflows belong in `mutations/installations.ts`.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { GITHUB_ACCOUNT_TYPES, INSTALLATION_STATUSES } from "@nanites/domain/business";

/**
 * Persisted installation snapshot.
 *
 * GitHub-originated fields:
 * - `githubInstallationId`
 * - `githubAccountId`
 * - `githubAccountLogin`
 * - `githubAccountType`
 * - `githubAccountAvatarUrl`
 * - `status`
 *
 * Nanites-owned fields:
 * - `id`
 * - `createdAt`
 * - `updatedAt`
 *
 * The GitHub-originated fields are normalized from GitHub installation APIs and then persisted
 * locally so later requests can trust the database snapshot instead of calling GitHub every time.
 */
export const installations = sqliteTable("installations", {
  id: text("id").primaryKey(),
  githubInstallationId: integer("github_installation_id").notNull().unique(),
  githubAccountId: integer("github_account_id").notNull(),
  githubAccountLogin: text("github_account_login").notNull(),
  githubAccountType: text("github_account_type", { enum: GITHUB_ACCOUNT_TYPES }).notNull(),
  githubAccountAvatarUrl: text("github_account_avatar_url").notNull().default(""),
  status: text("status", { enum: INSTALLATION_STATUSES }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
