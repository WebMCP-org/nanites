import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { getAgentByName } from "agents";
import worker from "#/server.ts";
import type { SigveloManagerConversationAgent } from "#/backend/agents/SigveloManagerConversationAgent.ts";
import { encodeHex } from "#/backend/crypto.ts";
import { GITHUB_WEBHOOK_PATH } from "#/github.ts";
import { buildNaniteManagerKey } from "#/nanites.ts";
import {
  TEST_GITHUB_APP_ID,
  ensureD1BaselineSchema,
  saveTestGitHubApp,
} from "../helpers/d1-baseline.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";

const textEncoder = new TextEncoder();

async function signGitHubWebhookBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `sha256=${encodeHex(await crypto.subtle.sign("HMAC", key, textEncoder.encode(body)))}`;
}

function requireTestGitHubWebhookSecret(): string {
  const secret = Reflect.get(env, `GITHUB_APP_${TEST_GITHUB_APP_ID}_WEBHOOK_SECRET`);
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("The test GitHub App webhook secret is required for webhook signature tests.");
  }

  return secret;
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
type CapturedGitHubRequest = { method: string; path: string; body: string };

type GitHubIssueCommentFixture = {
  authorId: number;
  authorLogin: string;
  body: string;
  prNumber: number;
  statusCommentId: number;
  userCommentId: number;
};

function buildIssueCommentPayload(
  fixture: GitHubIssueCommentFixture = {
    authorId: 301,
    authorLogin: "alex",
    body: "@nanites-test status",
    prNumber: 21,
    statusCommentId: 1002,
    userCommentId: 1001,
  },
): GitHubIssueCommentCreatedPayload {
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
      number: fixture.prNumber,
      title: "Test PR",
      pull_request: {
        url: `https://api.github.com/repos/WebMCP-org/nanites/pulls/${fixture.prNumber}`,
      },
    },
    comment: {
      id: fixture.userCommentId,
      body: fixture.body,
      html_url: `https://github.com/WebMCP-org/nanites/pull/${fixture.prNumber}#issuecomment-${fixture.userCommentId}`,
      created_at: createdAt,
      updated_at: createdAt,
      user: {
        id: fixture.authorId,
        login: fixture.authorLogin,
        type: "User",
      },
    },
    sender: {
      id: fixture.authorId,
      login: fixture.authorLogin,
      type: "User",
    },
  } as GitHubIssueCommentCreatedPayload;
}

function mockManagerConversationGitHubApi(
  githubRequests: CapturedGitHubRequest[],
  fixture: GitHubIssueCommentFixture = {
    authorId: 301,
    authorLogin: "alex",
    body: "@nanites-test status",
    prNumber: 21,
    statusCommentId: 1002,
    userCommentId: 1001,
  },
) {
  return mockGitHubApi([
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
      path: `/repos/WebMCP-org/nanites/issues/comments/${fixture.userCommentId}/reactions`,
      response: async (request) => {
        githubRequests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: await request.text(),
        });
        return buildGitHubApiJsonResponse(
          `/repos/WebMCP-org/nanites/issues/comments/${fixture.userCommentId}/reactions`,
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
      path: `/repos/WebMCP-org/nanites/issues/${fixture.prNumber}/comments`,
      response: async (request) => {
        githubRequests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: await request.text(),
        });
        return buildGitHubApiJsonResponse(
          `/repos/WebMCP-org/nanites/issues/${fixture.prNumber}/comments`,
          {
            id: fixture.statusCommentId,
            body: "SigVelo manager received this in `WebMCP-org/nanites`.",
            html_url: `https://github.com/WebMCP-org/nanites/pull/${fixture.prNumber}#issuecomment-${fixture.statusCommentId}`,
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
      path: `/repos/WebMCP-org/nanites/issues/${fixture.prNumber}/comments?per_page=50`,
      response: () =>
        buildGitHubApiJsonResponse(
          `/repos/WebMCP-org/nanites/issues/${fixture.prNumber}/comments?per_page=50`,
          [
            {
              id: fixture.userCommentId,
              body: fixture.body,
              html_url: `https://github.com/WebMCP-org/nanites/pull/${fixture.prNumber}#issuecomment-${fixture.userCommentId}`,
              created_at: "2026-05-23T00:00:00Z",
              updated_at: "2026-05-23T00:00:00Z",
              user: {
                id: fixture.authorId,
                login: fixture.authorLogin,
                type: "User",
              },
            },
            {
              id: fixture.statusCommentId,
              body: "SigVelo manager accepted this message and is queueing a Think turn.",
              html_url: `https://github.com/WebMCP-org/nanites/pull/${fixture.prNumber}#issuecomment-${fixture.statusCommentId}`,
              created_at: "2026-05-23T00:00:01Z",
              updated_at: "2026-05-23T00:00:01Z",
              user: {
                id: 999,
                login: "sigvelo[bot]",
                type: "Bot",
              },
            },
          ],
        ),
    },
    {
      method: "PATCH",
      path: `/repos/WebMCP-org/nanites/issues/comments/${fixture.statusCommentId}`,
      response: async (request) => {
        githubRequests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: await request.text(),
        });
        return buildGitHubApiJsonResponse(
          `/repos/WebMCP-org/nanites/issues/comments/${fixture.statusCommentId}`,
          {
            id: fixture.statusCommentId,
            body: "edited manager reply",
            html_url: `https://github.com/WebMCP-org/nanites/pull/${fixture.prNumber}#issuecomment-${fixture.statusCommentId}`,
            created_at: "2026-05-23T00:00:01Z",
            updated_at: "2026-05-23T00:00:02Z",
            user: {
              id: 999,
              login: "sigvelo[bot]",
              type: "Bot",
            },
          },
        );
      },
    },
  ]);
}

function managerConversationNameFor(fixture: GitHubIssueCommentFixture): string {
  return `github-manager-chat-v4:github:WebMCP-org/nanites:${fixture.prNumber}:user:${fixture.authorId}`;
}

beforeAll(async () => {
  await ensureD1BaselineSchema(env.DB);
});

beforeEach(async () => {
  await saveTestGitHubApp(env.DB);
});

test("GitHub issue comments route through Chat SDK ingress", async () => {
  const githubRequests: CapturedGitHubRequest[] = [];
  const restoreFetch = mockManagerConversationGitHubApi(githubRequests);

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
          "x-github-hook-installation-target-id": String(TEST_GITHUB_APP_ID),
          "x-github-hook-installation-target-type": "integration",
          "x-hub-signature-256": await signGitHubWebhookBody(
            body,
            requireTestGitHubWebhookSecret(),
          ),
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
      managerConversationNameFor({
        authorId: 301,
        authorLogin: "alex",
        body: "@nanites-test status",
        prNumber: 21,
        statusCommentId: 1002,
        userCommentId: 1001,
      }),
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
          "x-github-hook-installation-target-id": String(TEST_GITHUB_APP_ID),
          "x-github-hook-installation-target-type": "integration",
          "x-hub-signature-256": await signGitHubWebhookBody(
            body,
            requireTestGitHubWebhookSecret(),
          ),
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
    restoreFetch();
  }
});

test("GitHub and browser manager chats share the manager conversation behavior", async () => {
  const fixture: GitHubIssueCommentFixture = {
    authorId: 302,
    authorLogin: "alex",
    body: "@nanites-test are you the same manager?",
    prNumber: 22,
    statusCommentId: 2002,
    userCommentId: 2001,
  };
  const githubRequests: CapturedGitHubRequest[] = [];
  const restoreFetch = mockManagerConversationGitHubApi(githubRequests, fixture);

  try {
    const body = JSON.stringify(buildIssueCommentPayload(fixture));
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request(`http://example.com${GITHUB_WEBHOOK_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "chat-sdk-delivery-same-manager",
          "x-github-event": "issue_comment",
          "x-github-hook-installation-target-id": String(TEST_GITHUB_APP_ID),
          "x-github-hook-installation-target-type": "integration",
          "x-hub-signature-256": await signGitHubWebhookBody(
            body,
            requireTestGitHubWebhookSecret(),
          ),
        },
        body,
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const githubConversation = await getAgentByName<Env, SigveloManagerConversationAgent>(
      env.SigveloManagerConversationAgent,
      managerConversationNameFor(fixture),
    );
    await waitForManagerSubmission(async () => {
      return githubConversation.hasManagerSubmission(`github:${fixture.userCommentId}`);
    }, 5_000);

    const browserConversation = await getAgentByName<Env, SigveloManagerConversationAgent>(
      env.SigveloManagerConversationAgent,
      `${buildNaniteManagerKey({ githubAppId: TEST_GITHUB_APP_ID, githubInstallationId: 1 })}:manager:${fixture.authorId}`,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    const githubClear = await githubConversation.clearConversation();
    expect(githubClear.clearedMessages).toBe(true);
    expect(githubClear.deletedSubmissions).toBeGreaterThanOrEqual(1);
    await expect(
      githubConversation.hasManagerSubmission(`github:${fixture.userCommentId}`),
    ).resolves.toBe(false);

    await expect(browserConversation.clearConversation()).resolves.toEqual({
      clearedMessages: true,
      deletedSubmissions: 0,
    });
  } finally {
    restoreFetch();
  }
});

test("GitHub webhook ping requires a valid signature", async () => {
  const body = JSON.stringify({
    zen: "Approachable is better than simple.",
    hook_id: 123,
    repository: {
      id: 456,
      name: "nanites",
      full_name: "WebMCP-org/nanites",
    },
    sender: {
      id: 789,
      login: "alice",
      type: "User",
    },
  });
  const unsignedResponse = await worker.fetch(
    new Request(`http://example.com${GITHUB_WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "ping-unsigned",
        "x-github-event": "ping",
        "x-github-hook-installation-target-id": String(TEST_GITHUB_APP_ID),
        "x-github-hook-installation-target-type": "integration",
      },
      body,
    }),
    env,
    createExecutionContext(),
  );

  expect(unsignedResponse.status).not.toBe(200);

  const signedResponse = await worker.fetch(
    new Request(`http://example.com${GITHUB_WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "ping-signed",
        "x-github-event": "ping",
        "x-github-hook-installation-target-id": String(TEST_GITHUB_APP_ID),
        "x-github-hook-installation-target-type": "integration",
        "x-hub-signature-256": await signGitHubWebhookBody(body, requireTestGitHubWebhookSecret()),
      },
      body,
    }),
    env,
    createExecutionContext(),
  );

  expect(signedResponse.status).toBe(200);
  expect(await signedResponse.text()).toBe("pong");
});
