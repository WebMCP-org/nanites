import baselineMigrationSql from "#/backend/db/migrations/0000_baseline.sql?raw";
import { createDbClient } from "#/backend/db/index.ts";
import { saveDeploymentGitHubAppConfig } from "#/backend/github/app-config.ts";

const initializedDatabases = new WeakSet<D1Database>();

function buildIdempotentBaselineMigrationStatements(): readonly string[] {
  return baselineMigrationSql
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .replaceAll("CREATE TABLE `", "CREATE TABLE IF NOT EXISTS `")
        .replaceAll("CREATE UNIQUE INDEX `", "CREATE UNIQUE INDEX IF NOT EXISTS `")
        .replaceAll(/\s+/g, " ")
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}

export async function ensureD1BaselineSchema(db: D1Database): Promise<void> {
  if (initializedDatabases.has(db)) {
    return;
  }

  for (const statement of buildIdempotentBaselineMigrationStatements()) {
    await db.exec(statement);
  }
  initializedDatabases.add(db);
}

export async function resetDeploymentGitHubAppConfigTable(db: D1Database): Promise<void> {
  await ensureD1BaselineSchema(db);
  await db.exec("DELETE FROM deployment_github_app_config;");
}

export async function saveTestDeploymentGitHubAppMetadata(
  db: D1Database,
  input: { readonly appId?: number; readonly slug?: string; readonly htmlUrl?: string } = {},
): Promise<void> {
  await ensureD1BaselineSchema(db);
  await saveDeploymentGitHubAppConfig(createDbClient(db), {
    appId: input.appId ?? 12345,
    slug: input.slug ?? "nanites-test",
    htmlUrl: input.htmlUrl ?? "https://github.com/apps/nanites-test",
    ownerLogin: "WebMCP-org",
    ownerType: "Organization",
    clientId: "generated-client-id",
    permissions: {},
    events: [],
  });
}
