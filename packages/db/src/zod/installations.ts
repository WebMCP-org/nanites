/**
 * Drizzle-to-Zod bridge for persisted installation snapshots.
 *
 * Ownership:
 * - `schema/installations.ts` owns the table shape.
 * - This file derives row and insert schemas from that table and adds field semantics.
 * - Mutation helpers should use the derived insert types for table-shaped writes instead of
 *   re-declaring insert payloads by hand.
 */
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { installations } from "../schema/installations.ts";

/**
 * Canonical persisted installation row derived mechanically from the Drizzle table definition.
 *
 * This preserves the source-of-truth chain:
 * GitHub installation payload -> persisted `installations` row -> Drizzle-derived Zod schema.
 */
export const persistedInstallationRowSchema = createSelectSchema(installations, {
  id: (schema) => schema.describe("Internal Nanites installation identifier."),
  githubInstallationId: (schema) =>
    schema.describe("GitHub App installation identifier persisted from GitHub installation APIs."),
  githubAccountId: (schema) =>
    schema.describe("GitHub account identifier for the installation owner."),
  githubAccountLogin: (schema) =>
    schema.describe("GitHub account login for the installation owner."),
  githubAccountType: (schema) => schema.describe("GitHub account type for the installation owner."),
  githubAccountAvatarUrl: (schema) =>
    schema.describe("GitHub avatar URL for the installation owner, served from GitHub's CDN."),
  status: (schema) =>
    schema.describe(
      "Persisted Nanites lifecycle state normalized from GitHub installation visibility and lifecycle signals.",
    ),
  createdAt: (schema) =>
    schema.describe("Timestamp when the local installation snapshot row was created."),
  updatedAt: (schema) =>
    schema.describe("Timestamp when the local installation snapshot row was last updated."),
}).describe("Persisted installation row derived directly from the Drizzle schema.");

export const persistedInstallationOwnerRowSchema = persistedInstallationRowSchema
  .pick({
    githubAccountId: true,
    githubAccountLogin: true,
    githubAccountType: true,
    githubAccountAvatarUrl: true,
  })
  .describe(
    "Installation owner snapshot derived directly from the Drizzle schema and ultimately sourced from GitHub installation payloads.",
  );

export const persistedInstallationInsertSchema = createInsertSchema(installations).describe(
  "Insert values for the persisted installation row, derived directly from the Drizzle schema.",
);

export type PersistedInstallationRow = import("zod").infer<typeof persistedInstallationRowSchema>;
export type PersistedInstallationOwnerRow = import("zod").infer<
  typeof persistedInstallationOwnerRowSchema
>;
export type PersistedInstallationInsert = import("zod").input<
  typeof persistedInstallationInsertSchema
>;
