/**
 * GitHub App registry for this deployment.
 *
 * App identity is explicit data in the `github_apps` table, but a deployment
 * may have exactly one active app. Each app's secrets live under per-app worker
 * secret bindings (`GITHUB_APP_<APP_ID>_*`) recorded on its row. Retired rows
 * can remain as history; runtime auth always resolves the singleton active app.
 */
import { desc, eq } from "drizzle-orm";
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

async function readSingletonActiveGitHubAppMetadata(
  db: DbClient,
): Promise<GitHubAppMetadata | null> {
  const apps = await listActiveGitHubApps(db);
  if (apps.length > 1) {
    throw new AppError("deploymentGitHubAppConflict", {
      details: { githubAppIds: apps.map((app) => app.appId) },
    });
  }

  return apps[0] ?? null;
}

export async function readGitHubAppMetadata(
  db: DbClient,
  appId: number,
): Promise<GitHubAppMetadata | null> {
  const rows = await db.select().from(githubApps).where(eq(githubApps.appId, appId)).limit(1);
  const row = rows[0];
  return row ? toGitHubAppMetadata(row) : null;
}

export async function readDeploymentGitHubAppMetadata(
  db: DbClient,
): Promise<GitHubAppMetadata | null> {
  return readSingletonActiveGitHubAppMetadata(db);
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

export async function resolveDeploymentGitHubApp(
  db: DbClient,
  env: Env,
): Promise<GitHubAppCredentials | null> {
  const metadata = await readDeploymentGitHubAppMetadata(db);
  if (!metadata || !readAuthCookieSecret(env)) {
    return null;
  }

  return withResolvedSecrets(metadata, env);
}

export async function requireDeploymentGitHubApp(
  db: DbClient,
  env: Env,
): Promise<GitHubAppCredentials> {
  const app = await resolveDeploymentGitHubApp(db, env);
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
 * Throws `deploymentGitHubAppConflict` if a different app already owns the
 * single deployment slot. Callers can run this before performing expensive,
 * hard-to-unwind side effects (e.g. writing Worker secrets) so a conflicting
 * app is rejected before those side effects happen, not after.
 */
export async function assertDeploymentGitHubAppRegistrable(
  db: DbClient,
  appId: number,
): Promise<void> {
  const existingDeploymentApp = await readDeploymentGitHubAppMetadata(db);
  if (existingDeploymentApp && existingDeploymentApp.appId !== appId) {
    throw new AppError("deploymentGitHubAppConflict", {
      details: { githubAppIds: [existingDeploymentApp.appId, appId] },
    });
  }
}

/**
 * Adds or refreshes the singleton deployment app row.
 */
export async function registerGitHubApp(
  db: DbClient,
  input: RegisterGitHubAppInput,
): Promise<GitHubAppMetadata> {
  const now = new Date();
  const secretBindings = buildGitHubAppSecretBindings(input.appId);
  await assertDeploymentGitHubAppRegistrable(db, input.appId);
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
