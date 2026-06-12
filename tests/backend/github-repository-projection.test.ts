import { env } from "cloudflare:test";
import { listInstallationRepositories } from "#/backend/github/index.ts";
import {
  TEST_GITHUB_APP_ID,
  ensureD1BaselineSchema,
  resetGitHubAppTables,
  saveTestGitHubApp,
} from "../helpers/d1-baseline.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";

const TEST_ACCOUNT_ID = "github-account:456";
const TEST_INSTALLATION_ID = 122769206;
const TEST_REPOSITORY_ID = 987;

beforeEach(async () => {
  await ensureD1BaselineSchema(env.DB);
  await env.DB.exec("DELETE FROM account_repositories;");
  await env.DB.exec("DELETE FROM account_installations;");
  await env.DB.exec("DELETE FROM account_people;");
  await resetGitHubAppTables(env.DB);
  await env.DB.exec("DELETE FROM accounts;");
  await saveTestGitHubApp(env.DB);
});

function buildRepository(input: { id: number; fullName: string }) {
  const [, name = input.fullName] = input.fullName.split("/", 2);

  return {
    id: input.id,
    name,
    full_name: input.fullName,
    owner: {
      id: 456,
      login: "WebMCP-org",
      type: "Organization",
      avatar_url: null,
    },
  };
}

async function seedInstallationProjection(): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
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
    .bind(TEST_ACCOUNT_ID, 456, "WebMCP-org", "Organization", null, now, now, now, now)
    .run();
  await env.DB.prepare(
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
      `github-installation:${TEST_INSTALLATION_ID}`,
      TEST_ACCOUNT_ID,
      TEST_GITHUB_APP_ID,
      TEST_INSTALLATION_ID,
      "active",
      now,
      now,
      null,
      null,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO account_repositories (
      id,
      account_id,
      github_app_id,
      github_installation_id,
      github_repository_id,
      github_repository,
      first_seen_at,
      last_seen_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      "stale-repository",
      TEST_ACCOUNT_ID,
      TEST_GITHUB_APP_ID,
      TEST_INSTALLATION_ID,
      999,
      JSON.stringify(buildRepository({ id: 999, fullName: "WebMCP-org/stale" })),
      now,
      now,
      now,
      now,
    )
    .run();
}

test("repository listing refreshes the D1 repository projection for the installation", async () => {
  await seedInstallationProjection();
  const repository = buildRepository({
    id: TEST_REPOSITORY_ID,
    fullName: "WebMCP-org/nanites",
  });
  const restore = mockGitHubApi([
    {
      path: new RegExp(`^/user/installations/${TEST_INSTALLATION_ID}/repositories\\?`),
      response: () =>
        Response.json({
          total_count: 1,
          repositories: [repository],
        }),
    },
  ]);

  try {
    await expect(
      listInstallationRepositories("test-user-token", TEST_INSTALLATION_ID, {
        env,
        githubAppId: TEST_GITHUB_APP_ID,
      }),
    ).resolves.toMatchObject([{ id: TEST_REPOSITORY_ID, full_name: "WebMCP-org/nanites" }]);
  } finally {
    restore();
  }

  const rows = await env.DB.prepare(
    "SELECT github_repository_id, github_repository FROM account_repositories ORDER BY github_repository_id",
  ).all<{ github_repository_id: number; github_repository: string }>();

  expect(
    rows.results.map((row) => ({
      id: row.github_repository_id,
      fullName: JSON.parse(row.github_repository).full_name,
    })),
  ).toEqual([{ id: TEST_REPOSITORY_ID, fullName: "WebMCP-org/nanites" }]);
});
