import baselineMigrationSql from "#/backend/db/migrations/0000_baseline.sql?raw";
import singletonDeploymentGitHubAppMigrationSql from "#/backend/db/migrations/0001_lovely_jazinda.sql?raw";
import removeLegacyPrimaryGitHubAppMigrationSql from "#/backend/db/migrations/0002_purple_morlun.sql?raw";
import {
  buildBrowserSessionExpiration,
  githubUserTokenSchema,
  nanitesSessionSchema,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
  type SessionInstallationSnapshot,
} from "#/backend/auth/session.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { registerGitHubApp } from "#/backend/github/apps.ts";

/**
 * The GitHub App id used across backend tests. The test wrangler config
 * provides this app's per-app worker secrets
 * (`GITHUB_APP_12345_PRIVATE_KEY` and friends).
 */
export const TEST_GITHUB_APP_ID = 12345;

const initializedDatabases = new WeakSet<D1Database>();

const migrationSqlSources = [
  baselineMigrationSql,
  singletonDeploymentGitHubAppMigrationSql,
  removeLegacyPrimaryGitHubAppMigrationSql,
] as const;

function buildIdempotentMigrationStatements(): readonly string[] {
  return migrationSqlSources
    .flatMap((migrationSql) => migrationSql.split("--> statement-breakpoint"))
    .map((statement) =>
      statement
        .replaceAll("CREATE TABLE `", "CREATE TABLE IF NOT EXISTS `")
        .replaceAll("CREATE UNIQUE INDEX `", "CREATE UNIQUE INDEX IF NOT EXISTS `")
        .replaceAll("DROP INDEX `", "DROP INDEX IF EXISTS `")
        .replaceAll(/\s+/g, " ")
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}

async function d1TableHasColumn(
  db: D1Database,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all<{ readonly name: string }>();
  return result.results.some((column) => column.name === columnName);
}

async function shouldSkipIdempotentMigrationStatement(
  db: D1Database,
  statement: string,
): Promise<boolean> {
  if (!statement.includes("is_primary") || statement.startsWith("CREATE TABLE")) {
    return false;
  }

  return !(await d1TableHasColumn(db, "github_apps", "is_primary"));
}

export async function ensureD1BaselineSchema(db: D1Database): Promise<void> {
  if (initializedDatabases.has(db)) {
    return;
  }

  for (const statement of buildIdempotentMigrationStatements()) {
    if (await shouldSkipIdempotentMigrationStatement(db, statement)) {
      continue;
    }
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

export async function buildTestBrowserAuthCookieHeader(
  env: Env,
  request: Request,
  input: {
    readonly githubViewer: { readonly id: number; readonly login: string };
    readonly activeGithubInstallationId: number | null;
    readonly sessionInstallationSnapshot?: SessionInstallationSnapshot | null;
    readonly githubAppId?: number;
    readonly githubUserToken?: string;
  },
): Promise<string> {
  const githubAppId = input.githubAppId ?? TEST_GITHUB_APP_ID;
  const session = nanitesSessionSchema.parse({
    githubViewer: input.githubViewer,
    activeGithubAppId: githubAppId,
    activeGithubInstallationId: input.activeGithubInstallationId,
    sessionInstallationSnapshot: input.sessionInstallationSnapshot ?? null,
    expiresAt: buildBrowserSessionExpiration(),
  });
  const githubUserToken = githubUserTokenSchema.parse({
    accessToken: input.githubUserToken ?? "test-github-user-token",
    expiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    githubAppId,
    githubAppClientId: "generated-client-id",
  });

  return [
    await sealSessionCookie(session, request, env),
    await sealGitHubUserTokenCookie(githubUserToken, request, env),
  ]
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}
