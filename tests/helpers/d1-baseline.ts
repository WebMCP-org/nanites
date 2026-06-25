import baselineMigrationSql from "#/backend/db/migrations/0000_baseline.sql?raw";
import {
  buildBrowserSessionExpiration,
  githubUserTokenSchema,
  nanitesSessionSchema,
  sealGitHubUserTokenCookie,
  sealSessionCookie,
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

function buildIdempotentMigrationStatements(): readonly string[] {
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

  for (const statement of buildIdempotentMigrationStatements()) {
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
  input: {
    readonly appId?: number;
    readonly slug?: string;
    readonly htmlUrl?: string;
    readonly setupOrigin?: string | null;
  } = {},
): Promise<void> {
  await ensureD1BaselineSchema(db);
  await registerGitHubApp(createDbClient(db), {
    appId: input.appId ?? TEST_GITHUB_APP_ID,
    slug: input.slug ?? "nanites-test",
    htmlUrl: input.htmlUrl ?? "https://github.com/apps/nanites-test",
    setupOrigin: input.setupOrigin ?? null,
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
    githubAppClientId: "generated-client-id",
  });

  return [
    await sealSessionCookie(session, request, env),
    await sealGitHubUserTokenCookie(githubUserToken, request, env),
  ]
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}
