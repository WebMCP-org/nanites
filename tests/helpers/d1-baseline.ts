import baselineMigrationSql from "#/backend/db/migrations/0000_baseline.sql?raw";
import {
  buildBrowserSessionExpiration,
  githubUserTokenSchema,
  nanitesSessionSchema,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
} from "#/backend/auth/session.ts";

export const TEST_GITHUB_APP_ID = 12345;
export const TEST_GITHUB_APP_CLIENT_ID = "generated-client-id";

const initializedDatabases = new WeakSet<D1Database>();
const baselineTables = [
  "ai_usage_facts",
  "audit_events",
  "nanite_run_facts",
  "nanite_catalog",
  "account_repositories",
  "account_installations",
  "accounts",
] as const;
function buildMigrationStatements(): readonly string[] {
  return baselineMigrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.replaceAll(/\s+/g, " ").trim())
    .filter((statement) => statement.length > 0);
}

function idempotentCreateStatement(statement: string): string {
  return statement
    .replaceAll("CREATE TABLE `", "CREATE TABLE IF NOT EXISTS `")
    .replaceAll("CREATE UNIQUE INDEX `", "CREATE UNIQUE INDEX IF NOT EXISTS `");
}

async function resetBaselineTables(db: D1Database): Promise<void> {
  await db.exec("PRAGMA foreign_keys = OFF;");
  try {
    for (const tableName of baselineTables) {
      await db.exec(`DROP TABLE IF EXISTS \`${tableName}\`;`);
    }
  } finally {
    await db.exec("PRAGMA foreign_keys = ON;");
  }
}

export async function ensureD1BaselineSchema(db: D1Database): Promise<void> {
  if (initializedDatabases.has(db)) {
    return;
  }

  await resetBaselineTables(db);
  for (const statement of buildMigrationStatements()) {
    await db.exec(idempotentCreateStatement(statement));
  }
  initializedDatabases.add(db);
}

export async function seedTestDeploymentInstallation(
  db: D1Database,
  input: {
    readonly githubInstallationId: number;
    readonly accountId?: string;
    readonly githubAccountId?: number;
    readonly githubAccountLogin?: string;
    readonly githubAccountType?: "Organization" | "User";
    readonly githubAppId?: number;
  },
): Promise<void> {
  const now = Date.now();
  const accountId = input.accountId ?? `github-account:${input.githubInstallationId}`;
  const githubAppId = input.githubAppId ?? TEST_GITHUB_APP_ID;
  const githubAccountId = input.githubAccountId ?? input.githubInstallationId;

  await db
    .prepare(
      `INSERT INTO accounts (
        id,
        github_account_id,
        github_account_login,
        github_account_type,
        github_account_avatar_url,
        last_active_at,
        first_seen_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      accountId,
      githubAccountId,
      input.githubAccountLogin ?? "WebMCP-org",
      input.githubAccountType ?? "Organization",
      null,
      now,
      now,
      now,
      now,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO account_installations (
        id,
        account_id,
        github_app_id,
        github_installation_id,
        status,
        first_seen_at,
        last_seen_at,
        suspended_at,
        removed_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `github-installation:${input.githubInstallationId}`,
      accountId,
      githubAppId,
      input.githubInstallationId,
      "active",
      now,
      now,
      null,
      null,
      now,
      now,
    )
    .run();
}

export async function buildTestBrowserAuthCookieHeader(
  env: Env,
  request: Request,
  input: {
    readonly githubViewer: { readonly id: number; readonly login: string };
    readonly githubAppId?: number;
    readonly githubUserToken?: string;
  },
): Promise<string> {
  const githubAppId = input.githubAppId ?? TEST_GITHUB_APP_ID;
  const session = nanitesSessionSchema.parse({
    githubViewer: input.githubViewer,
    expiresAt: buildBrowserSessionExpiration(),
  });
  const githubUserToken = githubUserTokenSchema.parse({
    accessToken: input.githubUserToken ?? "test-github-user-token",
    expiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    githubAppId,
    githubAppClientId: TEST_GITHUB_APP_CLIENT_ID,
  });

  return [
    await sealSessionCookie(session, request, env),
    await sealGitHubUserTokenCookie(githubUserToken, request, env),
  ]
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}
