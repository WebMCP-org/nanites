import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DbClient } from "#/backend/db/index.ts";
import { deploymentGitHubAppConfig } from "#/backend/db/schema.ts";
import { normalizeGitHubAppPrivateKeyToPkcs8 } from "#/backend/github/private-key.ts";
import { AppError } from "#/backend/errors.ts";

const DEPLOYMENT_GITHUB_APP_CONFIG_ID = "current";
export const AUTH_COOKIE_SECRET_BINDING = "AUTH_COOKIE_SECRET";
export const GITHUB_CLIENT_SECRET_BINDING = "GITHUB_CLIENT_SECRET";
export const GITHUB_WEBHOOK_SECRET_BINDING = "GITHUB_WEBHOOK_SECRET";
export const GITHUB_APP_PRIVATE_KEY_BINDING = "GITHUB_APP_PRIVATE_KEY";

export type DeploymentGitHubAppMetadata = {
  readonly appId: number;
  readonly slug: string;
  readonly htmlUrl: string;
  readonly ownerLogin: string | null;
  readonly ownerType: string | null;
  readonly selectedGithubInstallationId: number | null;
  readonly clientId: string;
  readonly permissions: Record<string, string>;
  readonly events: readonly string[];
  readonly configUpdatedAt: Date;
};

export type DeploymentGitHubAppConfig = DeploymentGitHubAppMetadata & {
  readonly clientSecret: string;
  readonly webhookSecret: string;
  readonly privateKey: string;
};

export type SaveDeploymentGitHubAppConfigInput = {
  readonly appId: number;
  readonly slug: string;
  readonly htmlUrl: string;
  readonly ownerLogin: string | null;
  readonly ownerType: string | null;
  readonly clientId: string;
  readonly permissions: Record<string, string>;
  readonly events: readonly string[];
};

const deploymentGitHubAppPermissionsJsonSchema = z
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

const deploymentGitHubAppEventsJsonSchema = z
  .array(z.unknown())
  .catch([])
  .transform((events): readonly string[] =>
    events.filter((event): event is string => typeof event === "string"),
  );

function readConfiguredSecret(env: Env, key: keyof Env): string | null {
  const value = env[key];
  const trimmedValue = typeof value === "string" ? value.trim() : "";
  return trimmedValue.length > 0 && !trimmedValue.startsWith("replace-with-") ? trimmedValue : null;
}

export async function readDeploymentGitHubAppMetadata(
  db: DbClient,
): Promise<DeploymentGitHubAppMetadata | null> {
  const rows = await db
    .select()
    .from(deploymentGitHubAppConfig)
    .where(eq(deploymentGitHubAppConfig.id, DEPLOYMENT_GITHUB_APP_CONFIG_ID))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    appId: row.appId,
    slug: row.slug,
    htmlUrl: row.htmlUrl,
    ownerLogin: row.ownerLogin,
    ownerType: row.ownerType,
    selectedGithubInstallationId: row.selectedGithubInstallationId,
    clientId: row.clientId,
    permissions: deploymentGitHubAppPermissionsJsonSchema.parse(JSON.parse(row.permissionsJson)),
    events: deploymentGitHubAppEventsJsonSchema.parse(JSON.parse(row.eventsJson)),
    configUpdatedAt: row.updatedAt,
  };
}

export async function readDeploymentGitHubAppConfig(
  db: DbClient,
  env: Env,
): Promise<DeploymentGitHubAppConfig | null> {
  const metadata = await readDeploymentGitHubAppMetadata(db);
  if (!metadata) {
    return null;
  }

  const clientSecret = readConfiguredSecret(env, GITHUB_CLIENT_SECRET_BINDING);
  const webhookSecret = readConfiguredSecret(env, GITHUB_WEBHOOK_SECRET_BINDING);
  const privateKey = readConfiguredSecret(env, GITHUB_APP_PRIVATE_KEY_BINDING);
  const authCookieSecret = readConfiguredSecret(env, AUTH_COOKIE_SECRET_BINDING);
  if (!clientSecret || !webhookSecret || !privateKey || !authCookieSecret) {
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

export async function requireDeploymentGitHubAppConfig(
  db: DbClient,
  env: Env,
): Promise<DeploymentGitHubAppConfig> {
  const config = await readDeploymentGitHubAppConfig(db, env);
  if (!config) {
    throw new AppError("deploymentGitHubAppSetupRequired");
  }

  return config;
}

export async function requireDeploymentGitHubAppConfigTableReady(db: DbClient): Promise<void> {
  try {
    await db.select().from(deploymentGitHubAppConfig).limit(1);
  } catch (error) {
    throw new AppError("setupDatabaseMigrationRequired", {
      cause: error,
      details: { table: "deployment_github_app_config" },
    });
  }
}

export async function saveDeploymentGitHubAppConfig(
  db: DbClient,
  input: SaveDeploymentGitHubAppConfigInput,
): Promise<void> {
  const now = new Date();
  await db
    .insert(deploymentGitHubAppConfig)
    .values({
      id: DEPLOYMENT_GITHUB_APP_CONFIG_ID,
      appId: input.appId,
      slug: input.slug,
      htmlUrl: input.htmlUrl,
      ownerLogin: input.ownerLogin,
      ownerType: input.ownerType,
      selectedGithubInstallationId: null,
      clientId: input.clientId,
      clientSecretBinding: GITHUB_CLIENT_SECRET_BINDING,
      webhookSecretBinding: GITHUB_WEBHOOK_SECRET_BINDING,
      privateKeyBinding: GITHUB_APP_PRIVATE_KEY_BINDING,
      permissionsJson: JSON.stringify(input.permissions),
      eventsJson: JSON.stringify(input.events),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: deploymentGitHubAppConfig.id,
      set: {
        appId: input.appId,
        slug: input.slug,
        htmlUrl: input.htmlUrl,
        ownerLogin: input.ownerLogin,
        ownerType: input.ownerType,
        selectedGithubInstallationId: null,
        clientId: input.clientId,
        clientSecretBinding: GITHUB_CLIENT_SECRET_BINDING,
        webhookSecretBinding: GITHUB_WEBHOOK_SECRET_BINDING,
        privateKeyBinding: GITHUB_APP_PRIVATE_KEY_BINDING,
        permissionsJson: JSON.stringify(input.permissions),
        eventsJson: JSON.stringify(input.events),
        updatedAt: now,
      },
    });
}

export async function saveDeploymentGitHubAppSelectedInstallation(
  db: DbClient,
  githubInstallationId: number | null,
): Promise<void> {
  const now = new Date();
  await db
    .update(deploymentGitHubAppConfig)
    .set({
      selectedGithubInstallationId: githubInstallationId,
      updatedAt: now,
    })
    .where(eq(deploymentGitHubAppConfig.id, DEPLOYMENT_GITHUB_APP_CONFIG_ID));
}
