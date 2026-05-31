import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { githubInstallationIdSchema } from "@nanites/contracts/ids";
import type { NaniteManager } from "#/backend/nanites/host.ts";
import { buildNaniteManagerKey } from "#/shared/nanites.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";

beforeAll(async () => {
  await env.DB.exec(
    [
      "PRAGMA foreign_keys = ON;",
      "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, last_active_at INTEGER, updated_at INTEGER);",
      "CREATE TABLE IF NOT EXISTS account_installations (account_id TEXT, github_installation_id INTEGER PRIMARY KEY, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE);",
      "CREATE TABLE IF NOT EXISTS platform_usage_facts (id TEXT PRIMARY KEY, account_id TEXT, github_installation_id INTEGER, github_repository_id INTEGER, run_key TEXT, category TEXT NOT NULL, event_key TEXT NOT NULL, status TEXT, quantity INTEGER NOT NULL DEFAULT 1, duration_ms INTEGER, metadata_json TEXT NOT NULL DEFAULT '{}', occurred_at INTEGER NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE, FOREIGN KEY(github_installation_id) REFERENCES account_installations(github_installation_id) ON DELETE CASCADE);",
    ].join("\n"),
  );
});

beforeEach(async () => {
  await env.DB.exec(
    [
      "DELETE FROM platform_usage_facts;",
      "DELETE FROM account_installations;",
      "DELETE FROM accounts;",
    ].join("\n"),
  );
});

function buildGitHubApiJsonResponse(path: string, payload: unknown, init?: ResponseInit): Response {
  const response = Response.json(payload, init);
  Object.defineProperty(response, "url", {
    configurable: true,
    value: `https://api.github.com${path}`,
  });
  return response;
}

function buildInstallationTokenRoute(githubInstallationId: number) {
  return {
    method: "POST",
    path: `/app/installations/${githubInstallationId}/access_tokens`,
    response: () =>
      buildGitHubApiJsonResponse(`/app/installations/${githubInstallationId}/access_tokens`, {
        token: "test-installation-token",
        expires_at: "2026-05-17T00:00:00Z",
        permissions: {
          contents: "write",
        },
        repository_selection: "selected",
      }),
  };
}

function buildInstallationRepositoriesRoute(repositories: string[]) {
  return {
    path: /\/installation\/repositories(\?.*)?$/,
    response: () =>
      buildGitHubApiJsonResponse("/installation/repositories", {
        total_count: repositories.length,
        repositories: repositories.map((fullName, index) => {
          const [owner, name] = fullName.split("/", 2);
          return {
            id: 9000 + index,
            name,
            full_name: fullName,
            default_branch: "main",
            private: true,
            owner: {
              login: owner,
            },
            permissions: {
              admin: false,
              pull: true,
              push: true,
            },
          };
        }),
      }),
  };
}

test("manager trigger testing is callable directly for browser and adapter surfaces", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(642024);
  const managerName = buildNaniteManagerKey(githubInstallationId);
  const restoreFetch = mockGitHubApi([
    buildInstallationTokenRoute(githubInstallationId),
    buildInstallationRepositoriesRoute(["WebMCP-org/nanites"]),
  ]);
  try {
    const manager = await getAgentByName(
      env.SigveloNaniteManager as DurableObjectNamespace<NaniteManager>,
      managerName,
    );
    const now = Date.now();
    await env.DB.prepare("INSERT INTO accounts (id, last_active_at, updated_at) VALUES (?, ?, ?)")
      .bind("acct-trigger-test", now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO account_installations (account_id, github_installation_id) VALUES (?, ?)",
    )
      .bind("acct-trigger-test", githubInstallationId)
      .run();

    await manager.registerNanite({
      manifest: {
        id: "docs-syncer",
        name: "Docs syncer",
        description: "Updates repo B documentation after repo A changes on main.",
        trigger: {
          type: "github",
          event: "pull_request",
          repositories: ["WebMCP-org/nanites"],
          actions: ["opened"],
        },
        inboundTrigger: {
          sourceCode: `
export default {
  async handle(event, ctx) {
    if (event.type !== "github.pull_request") {
      return ctx.noop("Not a pull request event.");
    }

    if (event.payload.action !== "opened") {
      return ctx.noop("Only opened pull requests wake this Nanite.");
    }

    return ctx.dispatchSelf({
      reason: "Generated trigger accepted opened pull request.",
      repository: event.payload.repository.full_name,
      pullNumber: event.payload.pull_request.number,
    });
  },
};
`,
        },
        permissions: {
          github: {
            repositories: ["WebMCP-org/nanites"],
            appPermissions: {},
          },
        },
      },
    });

    const output = await manager.testNaniteTrigger({
      naniteId: "docs-syncer",
      actorId: "github:101",
      requestId: "direct-manager-trigger-test",
      event: {
        fixture: "github.pull_request.opened",
        overrides: {
          repository: {
            full_name: "WebMCP-org/nanites",
            name: "nanites",
            owner: { login: "WebMCP-org" },
          },
        },
      },
      waitForTerminalOutcome: false,
    });

    expect(output).toMatchObject({
      ok: true,
      managerName,
      naniteId: "docs-syncer",
      acceptance: {
        fixtureBuilt: true,
        triggerAcceptedEvent: true,
        runCreated: true,
        modelDispatched: true,
        terminalOutcomeReached: false,
      },
    });
    expect(output.event).toMatchObject({
      fixture: "github.pull_request.opened",
      repository: "WebMCP-org/nanites",
      pullNumber: 21,
      action: "opened",
    });
    expect(output.runs).toHaveLength(1);
    expect(output.runs[0]).toMatchObject({
      naniteId: "docs-syncer",
      status: "running",
      trigger: {
        type: "github",
        event: "pull_request",
        repository: "WebMCP-org/nanites",
      },
    });
  } finally {
    restoreFetch();
  }
});
