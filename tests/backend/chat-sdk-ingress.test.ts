import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getAgentByName } from "agents";
import worker, { ChatSdkStateAgent, SigveloChatIngress } from "#/server.ts";
import type { SigveloManagerConversationAgent } from "#/backend/nanites/manager-conversation-agent.ts";
import { GITHUB_WEBHOOK_PATH } from "#/shared/constants/routes.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";

const textEncoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signGitHubWebhookBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `sha256=${toHex(await crypto.subtle.sign("HMAC", key, textEncoder.encode(body)))}`;
}

function buildGitHubApiJsonResponse(path: string, payload: unknown, init?: ResponseInit): Response {
  const response = Response.json(payload, init);
  Object.defineProperty(response, "url", {
    configurable: true,
    value: `https://api.github.com${path}`,
  });
  return response;
}

async function waitForGitHubRequests(isReady: () => boolean, timeoutMs = 1000): Promise<void> {
  await expect.poll(isReady, { interval: 10, timeout: timeoutMs }).toBe(true);
}

async function waitForManagerSubmission(
  isReady: () => Promise<boolean>,
  timeoutMs = 1000,
): Promise<void> {
  await expect.poll(isReady, { interval: 10, timeout: timeoutMs }).toBe(true);
}

type GitHubIssueCommentCreatedPayload = EmitterWebhookEvent<"issue_comment.created">["payload"];

function buildIssueCommentPayload(): GitHubIssueCommentCreatedPayload {
  const createdAt = "2026-05-23T00:00:00Z";
  return {
    action: "created",
    installation: { id: 1 },
    repository: {
      id: 101,
      name: "nanites",
      full_name: "WebMCP-org/nanites",
      owner: {
        id: 201,
        login: "WebMCP-org",
        type: "Organization",
      },
    },
    issue: {
      number: 21,
      title: "Test PR",
      pull_request: {
        url: "https://api.github.com/repos/WebMCP-org/nanites/pulls/21",
      },
    },
    comment: {
      id: 1001,
      body: "@sigvelo status",
      html_url: "https://github.com/WebMCP-org/nanites/pull/21#issuecomment-1001",
      created_at: createdAt,
      updated_at: createdAt,
      user: {
        id: 301,
        login: "alex",
        type: "User",
      },
    },
    sender: {
      id: 301,
      login: "alex",
      type: "User",
    },
  } as GitHubIssueCommentCreatedPayload;
}

test("server exports the Chat SDK ingress Agent classes", () => {
  expect(SigveloChatIngress).toBeDefined();
  expect(ChatSdkStateAgent).toBeDefined();
});

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

test("GitHub issue comments route through Chat SDK ingress", async () => {
  const githubRequests: Array<{ method: string; path: string; body: string }> = [];
  const previousDisableGitHubMcp = Reflect.get(env, "MANAGER_CONVERSATION_DISABLE_GITHUB_MCP");
  Reflect.set(env, "MANAGER_CONVERSATION_DISABLE_GITHUB_MCP", "true");
  const restoreFetch = mockGitHubApi([
    {
      method: "POST",
      path: "/app/installations/1/access_tokens",
      response: async (request) => {
        githubRequests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: await request.text(),
        });
        return buildGitHubApiJsonResponse("/app/installations/1/access_tokens", {
          token: "test-installation-token",
          expires_at: "2026-05-23T01:00:00Z",
          permissions: {
            issues: "write",
            pull_requests: "write",
          },
        });
      },
    },
    {
      path: "/user",
      response: () =>
        buildGitHubApiJsonResponse("/user", {
          id: 999,
          login: "sigvelo[bot]",
          type: "Bot",
        }),
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
    {
      method: "POST",
      path: "/repos/WebMCP-org/nanites/issues/comments/1001/reactions",
      response: async (request) => {
        githubRequests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: await request.text(),
        });
        return buildGitHubApiJsonResponse(
          "/repos/WebMCP-org/nanites/issues/comments/1001/reactions",
          {
            id: 4001,
            content: "eyes",
          },
          { status: 201 },
        );
      },
    },
    {
      method: "POST",
      path: "/repos/WebMCP-org/nanites/issues/21/comments",
      response: async (request) => {
        githubRequests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: await request.text(),
        });
        return buildGitHubApiJsonResponse(
          "/repos/WebMCP-org/nanites/issues/21/comments",
          {
            id: 1002,
            body: "Sigvelo manager received this in `WebMCP-org/nanites`.",
            html_url: "https://github.com/WebMCP-org/nanites/pull/21#issuecomment-1002",
            created_at: "2026-05-23T00:00:01Z",
            updated_at: "2026-05-23T00:00:01Z",
            user: {
              id: 999,
              login: "sigvelo[bot]",
              type: "Bot",
            },
          },
          { status: 201 },
        );
      },
    },
    {
      method: "GET",
      path: "/repos/WebMCP-org/nanites/issues/21/comments?per_page=50",
      response: () =>
        buildGitHubApiJsonResponse("/repos/WebMCP-org/nanites/issues/21/comments?per_page=50", [
          {
            id: 1001,
            body: "@sigvelo status",
            html_url: "https://github.com/WebMCP-org/nanites/pull/21#issuecomment-1001",
            created_at: "2026-05-23T00:00:00Z",
            updated_at: "2026-05-23T00:00:00Z",
            user: {
              id: 301,
              login: "alex",
              type: "User",
            },
          },
          {
            id: 1002,
            body: "Sigvelo manager accepted this message and is queueing a Think turn.",
            html_url: "https://github.com/WebMCP-org/nanites/pull/21#issuecomment-1002",
            created_at: "2026-05-23T00:00:01Z",
            updated_at: "2026-05-23T00:00:01Z",
            user: {
              id: 999,
              login: "sigvelo[bot]",
              type: "Bot",
            },
          },
        ]),
    },
    {
      method: "PATCH",
      path: "/repos/WebMCP-org/nanites/issues/comments/1002",
      response: async (request) => {
        githubRequests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: await request.text(),
        });
        return buildGitHubApiJsonResponse("/repos/WebMCP-org/nanites/issues/comments/1002", {
          id: 1002,
          body: "edited manager reply",
          html_url: "https://github.com/WebMCP-org/nanites/pull/21#issuecomment-1002",
          created_at: "2026-05-23T00:00:01Z",
          updated_at: "2026-05-23T00:00:02Z",
          user: {
            id: 999,
            login: "sigvelo[bot]",
            type: "Bot",
          },
        });
      },
    },
  ]);

  try {
    const body = JSON.stringify(buildIssueCommentPayload());
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request(`http://example.com${GITHUB_WEBHOOK_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "chat-sdk-delivery-1",
          "x-github-event": "issue_comment",
          "x-hub-signature-256": await signGitHubWebhookBody(body, env.GITHUB_WEBHOOK_SECRET),
        },
        body,
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    await waitForGitHubRequests(
      () =>
        githubRequests.some(
          (request) => request.path === "/repos/WebMCP-org/nanites/issues/comments/1001/reactions",
        ) &&
        githubRequests.some(
          (request) => request.path === "/repos/WebMCP-org/nanites/issues/21/comments",
        ) &&
        githubRequests.some(
          (request) => request.path === "/repos/WebMCP-org/nanites/issues/comments/1002",
        ),
      5_000,
    );
    const conversation = await getAgentByName<Env, SigveloManagerConversationAgent>(
      env.SigveloManagerConversationAgent,
      "github-manager-chat-v4:github:WebMCP-org/nanites:21:user:301",
    );
    await waitForManagerSubmission(async () => {
      return conversation.hasManagerSubmission("github:1001");
    }, 5_000);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(githubRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/repos/WebMCP-org/nanites/issues/comments/1001/reactions",
          body: JSON.stringify({ content: "eyes" }),
        }),
        expect.objectContaining({
          method: "POST",
          path: "/repos/WebMCP-org/nanites/issues/21/comments",
          body: expect.stringContaining("body"),
        }),
        expect.objectContaining({
          method: "PATCH",
          path: "/repos/WebMCP-org/nanites/issues/comments/1002",
          body: expect.stringContaining("body"),
        }),
      ]),
    );

    const duplicateCtx = createExecutionContext();
    const duplicateResponse = await worker.fetch(
      new Request(`http://example.com${GITHUB_WEBHOOK_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "chat-sdk-delivery-2",
          "x-github-event": "issue_comment",
          "x-hub-signature-256": await signGitHubWebhookBody(body, env.GITHUB_WEBHOOK_SECRET),
        },
        body,
      }),
      env,
      duplicateCtx,
    );
    await waitOnExecutionContext(duplicateCtx);

    expect(duplicateResponse.status).toBe(200);
    expect(
      githubRequests.filter(
        (request) => request.path === "/repos/WebMCP-org/nanites/issues/21/comments",
      ),
    ).toHaveLength(1);
  } finally {
    Reflect.set(env, "MANAGER_CONVERSATION_DISABLE_GITHUB_MCP", previousDisableGitHubMcp);
    restoreFetch();
  }
});

test("GitHub webhook ping is handled before webhook body consumers", async () => {
  const response = await worker.fetch(
    new Request(`http://example.com${GITHUB_WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "x-github-event": "ping",
      },
      body: "not-json-and-not-signed",
    }),
    env,
    createExecutionContext(),
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("pong");
});
