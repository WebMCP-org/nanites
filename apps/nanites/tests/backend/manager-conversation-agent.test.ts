import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { githubInstallationIdSchema } from "@nanites/contracts/ids";
import {
  buildManagerSystemPrompt,
  formatNanitesAuthoringSources,
  type SigveloManagerConversationAgent,
} from "#/backend/manager-conversation-agent.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";

function buildGitHubApiJsonResponse(path: string, payload: unknown, init?: ResponseInit): Response {
  const response = Response.json(payload, init);
  Object.defineProperty(response, "url", {
    configurable: true,
    value: `https://api.github.com${path}`,
  });
  return response;
}

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

test("manager conversation agent exposes workspace git tooling and Nanite authoring references", async () => {
  const conversation = await getAgentByName<Env, SigveloManagerConversationAgent>(
    env.SigveloManagerConversationAgent,
    "manager-conversation-tooling-smoke",
  );

  const prompt = buildManagerSystemPrompt();
  expect(prompt).toContain("execute with git.*");
  expect(prompt).toContain("WebMCP-org/nanites");
  expect(prompt).toContain("plugins/nanites/skills/nanites/SKILL.md");
  expect(formatNanitesAuthoringSources()).toContain(
    "/repos/WebMCP-org/nanites/plugins/nanites/skills/nanites/references/authoring.md",
  );

  await expect(conversation.hasManagerSubmission("missing-submission")).resolves.toBe(false);
});

test("manager conversation agent connects to Sigvelo MCP over DO RPC and accepts a submission", async () => {
  const tokenRequestBodies: unknown[] = [];
  const previousDisableGitHubMcp = Reflect.get(env, "MANAGER_CONVERSATION_DISABLE_GITHUB_MCP");
  Reflect.set(env, "MANAGER_CONVERSATION_DISABLE_GITHUB_MCP", "true");
  const restoreFetch = mockGitHubApi([
    {
      method: "POST",
      path: "/app/installations/1/access_tokens",
      response: async (request) => {
        tokenRequestBodies.push(JSON.parse((await request.text()) || "{}"));
        return buildGitHubApiJsonResponse("/app/installations/1/access_tokens", {
          token: `manager-token-${tokenRequestBodies.length}`,
          expires_at: "2026-05-23T01:00:00Z",
          repository_selection: "selected",
          repositories: [{ name: "nanites" }],
          permissions: {
            contents: "write",
            issues: "write",
            pull_requests: "write",
          },
        });
      },
    },
    {
      path: /^\/installation\/repositories\?(?:page=1&per_page=100|per_page=100&page=1)$/,
      response: () =>
        buildGitHubApiJsonResponse("/installation/repositories?per_page=100&page=1", {
          total_count: 1,
          repository_selection: "selected",
          repositories: [
            {
              id: 101,
              name: "nanites",
              full_name: "WebMCP-org/nanites",
              private: false,
              default_branch: "main",
              owner: {
                login: "WebMCP-org",
              },
              permissions: {
                admin: true,
                pull: true,
                push: true,
              },
            },
          ],
        }),
    },
  ]);

  const conversation = await getAgentByName<Env, SigveloManagerConversationAgent>(
    env.SigveloManagerConversationAgent,
    "github:WebMCP-org/nanites:manager-conversation-rpc-smoke",
  );

  try {
    await expect(
      conversation.answerGitHubMessage({
        installationId: githubInstallationIdSchema.parse(1),
        surface: {
          type: "github",
          threadId: "github:WebMCP-org/nanites:21",
          messageId: "1001",
          repository: "WebMCP-org/nanites",
          prNumber: 21,
          threadType: "pr",
        },
        author: {
          userId: "301",
          userName: "alex",
          isBot: false,
        },
        text: "@sigvelo status",
      }),
    ).resolves.toMatchObject({
      accepted: true,
      status: "pending",
      submissionId: "github:1001",
      userMessageId: "github:1001",
    });

    await expect(conversation.hasManagerSubmission("github:1001")).resolves.toBe(true);
    expect(tokenRequestBodies).toEqual([{}]);
  } finally {
    Reflect.set(env, "MANAGER_CONVERSATION_DISABLE_GITHUB_MCP", previousDisableGitHubMcp);
    restoreFetch();
  }
});
