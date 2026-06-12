import baselineMigrationSql from "#/backend/db/migrations/0000_baseline.sql?raw";
import { createDbClient } from "#/backend/db/index.ts";
import { registerGitHubApp } from "#/backend/github/apps.ts";

/**
 * The GitHub App id used across backend tests. The test wrangler config
 * provides this app's per-app worker secrets
 * (`GITHUB_APP_12345_PRIVATE_KEY` and friends).
 */
export const TEST_GITHUB_APP_ID = 12345;

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

export async function resetGitHubAppTables(db: D1Database): Promise<void> {
  await ensureD1BaselineSchema(db);
  // account_installations references github_apps, so clear it first.
  await db.exec("DELETE FROM account_installations;");
  await db.exec("DELETE FROM github_apps;");
}

export async function saveTestGitHubApp(
  db: D1Database,
  input: { readonly appId?: number; readonly slug?: string; readonly htmlUrl?: string } = {},
): Promise<void> {
  await ensureD1BaselineSchema(db);
  await registerGitHubApp(createDbClient(db), {
    appId: input.appId ?? TEST_GITHUB_APP_ID,
    slug: input.slug ?? "nanites-test",
    htmlUrl: input.htmlUrl ?? "https://github.com/apps/nanites-test",
    ownerLogin: "WebMCP-org",
    ownerType: "Organization",
    clientId: "generated-client-id",
    permissions: {},
    events: [],
  });
}
