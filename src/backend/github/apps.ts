/**
 * GitHub App registry for this deployment.
 *
 * App identity is explicit data in the `github_apps` table — there is no
 * deployment-global "the app". Every credential lookup names the app it wants;
 * the only sanctioned singleton is the primary app, which serves browser/MCP
 * OAuth login. Each app's secrets live under per-app worker secret bindings
 * (`GITHUB_APP_<APP_ID>_*`) recorded on its row, so registering or retiring an
 * app can never clobber another app's credentials.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbClient } from "#/backend/db/index.ts";
import { githubApps, type GitHubAppStatus } from "#/backend/db/schema.ts";
import { normalizeGitHubAppPrivateKeyToPkcs8 } from "#/backend/github/private-key.ts";
import { AppError } from "#/backend/errors.ts";

export const AUTH_COOKIE_SECRET_BINDING = "AUTH_COOKIE_SECRET";

export type GitHubAppSecretBindings = {
  readonly privateKeyBinding: string;
  readonly clientSecretBinding: string;
  readonly webhookSecretBinding: string;
};

export type GitHubAppMetadata = {
  readonly appId: number;
  readonly slug: string;
  readonly htmlUrl: string;
  readonly ownerLogin: string | null;
  readonly ownerType: string | null;
  readonly clientId: string;
  readonly permissions: Record<string, string>;
  readonly events: readonly string[];
  readonly isPrimary: boolean;
  readonly status: GitHubAppStatus;
  readonly secretBindings: GitHubAppSecretBindings;
  readonly configUpdatedAt: Date;
};

export type GitHubAppCredentials = GitHubAppMetadata & {
  readonly clientSecret: string;
  readonly webhookSecret: string;
  readonly privateKey: string;
};

export type RegisterGitHubAppInput = {
  readonly appId: number;
  readonly slug: string;
  readonly htmlUrl: string;
  readonly ownerLogin: string | null;
  readonly ownerType: string | null;
  readonly clientId: string;
  readonly permissions: Record<string, string>;
  readonly events: readonly string[];
};

export function buildGitHubAppSecretBindings(appId: number): GitHubAppSecretBindings {
  return {
    privateKeyBinding: `GITHUB_APP_${appId}_PRIVATE_KEY`,
    clientSecretBinding: `GITHUB_APP_${appId}_CLIENT_SECRET`,
    webhookSecretBinding: `GITHUB_APP_${appId}_WEBHOOK_SECRET`,
  };
}

const githubAppPermissionsJsonSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((record): Record<string, string> => {
    const permissions: Record<string, string> = {};
    for (const [permission, access] of Object.entries(record)) {
      if (typeof access === "string") {
        permissions[permission] = access;
      }
    }
    return permissions;
  });

const githubAppEventsJsonSchema = z
  .array(z.unknown())
  .catch([])
  .transform((events): readonly string[] =>
    events.filter((event): event is string => typeof event === "string"),
  );

type GitHubAppRow = typeof githubApps.$inferSelect;

function toGitHubAppMetadata(row: GitHubAppRow): GitHubAppMetadata {
  return {
    appId: row.appId,
    slug: row.slug,
    htmlUrl: row.htmlUrl,
    ownerLogin: row.ownerLogin,
    ownerType: row.ownerType,
    clientId: row.clientId,
    permissions: githubAppPermissionsJsonSchema.parse(JSON.parse(row.permissionsJson)),
    events: githubAppEventsJsonSchema.parse(JSON.parse(row.eventsJson)),
    isPrimary: row.isPrimary,
    status: row.status,
    secretBindings: {
      privateKeyBinding: row.privateKeyBinding,
      clientSecretBinding: row.clientSecretBinding,
      webhookSecretBinding: row.webhookSecretBinding,
    },
    configUpdatedAt: row.updatedAt,
  };
}

/**
 * Secret bindings are dynamic per-app names written by the setup flow, so
 * they are not part of the generated `Env` type.
 */
export function readConfiguredSecret(env: Env, bindingName: string): string | null {
  const value = (env as unknown as Record<string, unknown>)[bindingName];
  const trimmedValue = typeof value === "string" ? value.trim() : "";
  return trimmedValue.length > 0 && !trimmedValue.startsWith("replace-with-") ? trimmedValue : null;
}

export function readAuthCookieSecret(env: Env): string | null {
  return readConfiguredSecret(env, AUTH_COOKIE_SECRET_BINDING);
}

// "Newest" means most recently registered or re-registered (updated_at),
// with app id as a deterministic tiebreaker for same-second registrations.
export async function listGitHubApps(db: DbClient): Promise<GitHubAppMetadata[]> {
  const rows = await db
    .select()
    .from(githubApps)
    .orderBy(desc(githubApps.updatedAt), desc(githubApps.appId));
  return rows.map(toGitHubAppMetadata);
}

export async function listActiveGitHubApps(db: DbClient): Promise<GitHubAppMetadata[]> {
  const rows = await db
    .select()
    .from(githubApps)
    .where(eq(githubApps.status, "active"))
    .orderBy(desc(githubApps.updatedAt), desc(githubApps.appId));
  return rows.map(toGitHubAppMetadata);
}

export async function readGitHubAppMetadata(
  db: DbClient,
  appId: number,
): Promise<GitHubAppMetadata | null> {
  const rows = await db.select().from(githubApps).where(eq(githubApps.appId, appId)).limit(1);
  const row = rows[0];
  return row ? toGitHubAppMetadata(row) : null;
}

export async function readPrimaryGitHubAppMetadata(
  db: DbClient,
): Promise<GitHubAppMetadata | null> {
  const rows = await db
    .select()
    .from(githubApps)
    .where(and(eq(githubApps.isPrimary, true), eq(githubApps.status, "active")))
    .limit(1);
  const row = rows[0];
  return row ? toGitHubAppMetadata(row) : null;
}

/**
 * The app the setup wizard is currently working with: the most recently
 * registered active app. Registering another app never edits earlier rows, so
 * "newest active" is stable for the duration of a wizard pass.
 */
export async function readNewestActiveGitHubAppMetadata(
  db: DbClient,
): Promise<GitHubAppMetadata | null> {
  const apps = await listActiveGitHubApps(db);
  return apps[0] ?? null;
}

function withResolvedSecrets(metadata: GitHubAppMetadata, env: Env): GitHubAppCredentials | null {
  const clientSecret = readConfiguredSecret(env, metadata.secretBindings.clientSecretBinding);
  const webhookSecret = readConfiguredSecret(env, metadata.secretBindings.webhookSecretBinding);
  const privateKey = readConfiguredSecret(env, metadata.secretBindings.privateKeyBinding);
  if (!clientSecret || !webhookSecret || !privateKey) {
    return null;
  }

  return {
    ...metadata,
    clientSecret,
    webhookSecret,
    // Secrets written before the PKCS#8 conversion existed may still hold the
    // PKCS#1 PEM GitHub issued, so normalize on read as well as on write.
    privateKey: normalizeGitHubAppPrivateKeyToPkcs8(privateKey),
  };
}

export async function resolveGitHubApp(
  db: DbClient,
  env: Env,
  appId: number,
): Promise<GitHubAppCredentials | null> {
  const metadata = await readGitHubAppMetadata(db, appId);
  if (!metadata || metadata.status !== "active") {
    return null;
  }

  return withResolvedSecrets(metadata, env);
}

export async function requireGitHubApp(
  db: DbClient,
  env: Env,
  appId: number,
): Promise<GitHubAppCredentials> {
  const app = await resolveGitHubApp(db, env, appId);
  if (!app) {
    throw new AppError("githubAppNotFound", { details: { githubAppId: appId } });
  }

  return app;
}

export async function resolvePrimaryGitHubApp(
  db: DbClient,
  env: Env,
): Promise<GitHubAppCredentials | null> {
  const metadata = await readPrimaryGitHubAppMetadata(db);
  if (!metadata || !readAuthCookieSecret(env)) {
    return null;
  }

  return withResolvedSecrets(metadata, env);
}

export async function requirePrimaryGitHubApp(
  db: DbClient,
  env: Env,
): Promise<GitHubAppCredentials> {
  const app = await resolvePrimaryGitHubApp(db, env);
  if (!app) {
    throw new AppError("deploymentGitHubAppSetupRequired");
  }

  return app;
}

export async function requireGitHubAppsTableReady(db: DbClient): Promise<void> {
  try {
    await db.select().from(githubApps).limit(1);
  } catch (error) {
    throw new AppError("setupDatabaseMigrationRequired", {
      cause: error,
      details: { table: "github_apps" },
    });
  }
}

/**
 * Adds (or refreshes) one app row. Never touches other rows: the incident
 * class where setup replaced the deployment's app identity is unrepresentable.
 * The first active app becomes the primary login app automatically.
 */
export async function registerGitHubApp(
  db: DbClient,
  input: RegisterGitHubAppInput,
): Promise<GitHubAppMetadata> {
  const now = new Date();
  const secretBindings = buildGitHubAppSecretBindings(input.appId);
  const existingPrimary = await readPrimaryGitHubAppMetadata(db);
  const isPrimary = existingPrimary === null || existingPrimary.appId === input.appId;
  await db
    .insert(githubApps)
    .values({
      appId: input.appId,
      slug: input.slug,
      htmlUrl: input.htmlUrl,
      ownerLogin: input.ownerLogin,
      ownerType: input.ownerType,
      clientId: input.clientId,
      privateKeyBinding: secretBindings.privateKeyBinding,
      clientSecretBinding: secretBindings.clientSecretBinding,
      webhookSecretBinding: secretBindings.webhookSecretBinding,
      permissionsJson: JSON.stringify(input.permissions),
      eventsJson: JSON.stringify(input.events),
      isPrimary,
      status: "active",
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: githubApps.appId,
      set: {
        slug: input.slug,
        htmlUrl: input.htmlUrl,
        ownerLogin: input.ownerLogin,
        ownerType: input.ownerType,
        clientId: input.clientId,
        privateKeyBinding: secretBindings.privateKeyBinding,
        clientSecretBinding: secretBindings.clientSecretBinding,
        webhookSecretBinding: secretBindings.webhookSecretBinding,
        permissionsJson: JSON.stringify(input.permissions),
        eventsJson: JSON.stringify(input.events),
        isPrimary,
        status: "active",
        retiredAt: null,
        updatedAt: now,
      },
    });

  const registered = await readGitHubAppMetadata(db, input.appId);
  if (!registered) {
    throw new AppError("githubAppNotFound", { details: { githubAppId: input.appId } });
  }

  return registered;
}

export async function retireGitHubApp(db: DbClient, appId: number): Promise<void> {
  const now = new Date();
  await db
    .update(githubApps)
    .set({
      status: "retired",
      isPrimary: false,
      retiredAt: now,
      updatedAt: now,
    })
    .where(eq(githubApps.appId, appId));
}

export async function setPrimaryGitHubApp(db: DbClient, appId: number): Promise<void> {
  const target = await readGitHubAppMetadata(db, appId);
  if (!target || target.status !== "active") {
    throw new AppError("githubAppNotFound", { details: { githubAppId: appId } });
  }

  const now = new Date();
  // Clear-then-set in one batch so the partial unique index never sees two
  // primaries; D1 batches run atomically.
  await db.batch([
    db
      .update(githubApps)
      .set({ isPrimary: false, updatedAt: now })
      .where(and(eq(githubApps.isPrimary, true), eq(githubApps.status, "active"))),
    db
      .update(githubApps)
      .set({ isPrimary: true, updatedAt: now })
      .where(eq(githubApps.appId, appId)),
  ]);
}
