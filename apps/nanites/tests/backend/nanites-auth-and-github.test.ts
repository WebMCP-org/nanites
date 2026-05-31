import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { getAgentByName } from "agents";
import { githubInstallationIdSchema, githubUserIdSchema } from "@nanites/contracts/ids";
import { authorizeAgentRequest } from "#/backend/agents/request-auth.ts";
import { buildBrowserSessionExpiration } from "#/backend/browser-auth/policy.ts";
import { sealGitHubUserTokenCookie, sealSessionCookie } from "#/backend/browser-auth/cookies.ts";
import {
  assertNaniteRepositoriesBelongToInstallation,
  NaniteRepositoryScopeError,
} from "#/backend/nanites/repository-scope.ts";
import {
  createGitHubInstallationGitCredentials,
  GITHUB_INSTALLATION_GIT_USERNAME,
  isGitHubAuthRejection,
  parseGitHubRepositoryFromGitConfig,
  parseGitHubRepositoryFromGitUrl,
  shouldInjectGitHubInstallationToken,
} from "#/backend/nanites/git-auth.ts";
import { resolveNaniteGitHubMcpCapability } from "#/backend/nanites/github-mcp-capabilities.ts";
import type { NaniteManager, NaniteRunRecord } from "#/backend/nanites/host.ts";
import { GITHUB_WEBHOOK_PATH } from "#/shared/constants/routes.ts";
import { NANITE_AGENT_NAME, NANITE_MANAGER_NAME } from "#/shared/constants/nanites.ts";
import { buildNaniteManagerKey } from "#/shared/nanites.ts";
import worker from "#/server.ts";
import {
  buildPullRequestWebhookPayload,
  buildPushWebhookPayload,
} from "../contracts/github-webhooks.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";

const textEncoder = new TextEncoder();
type NaniteManagerTestClient = Pick<NaniteManager, "getSnapshot" | "registerNanite">;

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

test("Nanite repository scope must belong to the installation", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(1);
  const restoreFetch = mockGitHubApi([
    buildInstallationTokenRoute(githubInstallationId),
    buildInstallationRepositoriesRoute(["WebMCP-org/nanites"]),
  ]);
  try {
    await expect(
      assertNaniteRepositoriesBelongToInstallation({
        env,
        githubInstallationId,
        manifest: {
          id: "wrong-repo",
          name: "Wrong repo",
          description: "Attempts to operate on a repository outside the installation.",
          trigger: { type: "webhook", source: "github.release" },
          permissions: {
            github: {
              repositories: ["WebMCP-org/npm-packages"],
              appPermissions: { contents: "write" },
            },
          },
        },
      }),
    ).rejects.toBeInstanceOf(NaniteRepositoryScopeError);
  } finally {
    restoreFetch();
  }
});

test("GitHub MCP capability assignment filters denied tools and infers app permissions", () => {
  const capability = resolveNaniteGitHubMcpCapability({
    capability: {
      tier: "github_pr_author",
      extraTools: ["actions_get", "merge_pull_request"],
    },
    appPermissions: {
      contents: "write",
    },
  });

  expect(capability).toMatchObject({
    readonly: false,
    tools: expect.arrayContaining(["create_pull_request", "actions_get"]),
    deniedTools: expect.arrayContaining(["merge_pull_request", "push_files"]),
    appPermissions: {
      actions: "read",
      contents: "write",
      pull_requests: "write",
    },
  });
  expect(capability?.tools).not.toEqual(
    expect.arrayContaining(["get_file_contents", "list_commits", "list_branches"]),
  );
  expect(capability?.tools).not.toContain("merge_pull_request");

  expect(
    resolveNaniteGitHubMcpCapability({
      capability: { tier: "github_pr_author" },
      appPermissions: { pull_requests: "read" },
    })?.appPermissions,
  ).toEqual({ pull_requests: "write" });

  expect(
    resolveNaniteGitHubMcpCapability({
      capability: { tier: "github_ci_reader" },
    })?.appPermissions,
  ).toEqual({ actions: "read", pull_requests: "read" });

  const withPrComments = resolveNaniteGitHubMcpCapability({
    capability: {
      tier: "github_pr_author",
      extraTools: ["add_issue_comment"],
    },
    appPermissions: { contents: "write" },
  });
  expect(withPrComments?.tools).toContain("add_issue_comment");
  expect(withPrComments?.appPermissions).toEqual({
    contents: "write",
    issues: "write",
    pull_requests: "write",
  });

  expect(() =>
    resolveNaniteGitHubMcpCapability({
      capability: { tools: ["unknown_write_tool"] },
    }),
  ).toThrow(/not mapped to GitHub App permissions/);
});

test("Git auth injection is scoped to declared GitHub repositories", () => {
  expect(parseGitHubRepositoryFromGitUrl("https://github.com/WebMCP-org/WebMCP.git")).toBe(
    "WebMCP-org/WebMCP",
  );
  expect(parseGitHubRepositoryFromGitUrl("git@github.com:WebMCP-org/nanites.git")).toBe(
    "WebMCP-org/nanites",
  );
  expect(parseGitHubRepositoryFromGitUrl("https://gitlab.com/WebMCP-org/WebMCP.git")).toBeNull();
  expect(
    parseGitHubRepositoryFromGitConfig({
      remote: "upstream",
      config: [
        '[remote "origin"]',
        "\turl = https://github.com/WebMCP-org/nanites.git",
        '[remote "upstream"]',
        "\turl = git@github.com:WebMCP-org/WebMCP.git",
      ].join("\n"),
    }),
  ).toBe("WebMCP-org/WebMCP");

  expect(
    shouldInjectGitHubInstallationToken({
      options: { url: "https://github.com/WebMCP-org/WebMCP.git" },
      repository: parseGitHubRepositoryFromGitUrl("https://github.com/WebMCP-org/WebMCP.git"),
      repositories: ["WebMCP-org/WebMCP"],
    }),
  ).toBe(true);
  expect(
    shouldInjectGitHubInstallationToken({
      options: { url: "https://github.com/WebMCP-org/WebMCP.git" },
      repository: parseGitHubRepositoryFromGitUrl("https://github.com/WebMCP-org/WebMCP.git"),
      repositories: ["WebMCP-org/nanites"],
    }),
  ).toBe(false);
  expect(
    shouldInjectGitHubInstallationToken({
      options: {
        url: "https://github.com/WebMCP-org/WebMCP.git",
        token: "explicit-token",
      },
      repository: parseGitHubRepositoryFromGitUrl("https://github.com/WebMCP-org/WebMCP.git"),
      repositories: ["WebMCP-org/WebMCP"],
    }),
  ).toBe(false);
  expect(
    shouldInjectGitHubInstallationToken({
      options: {},
      repository: null,
      repositories: ["WebMCP-org/WebMCP"],
    }),
  ).toBe(false);
  expect(
    shouldInjectGitHubInstallationToken({
      options: { url: "https://gitlab.com/WebMCP-org/WebMCP.git" },
      repository: parseGitHubRepositoryFromGitUrl("https://gitlab.com/WebMCP-org/WebMCP.git"),
      repositories: ["WebMCP-org/WebMCP"],
    }),
  ).toBe(false);
  expect(isGitHubAuthRejection(new Error("HTTP Error: 401 Unauthorized"))).toBe(true);
});

test("GitHub installation git credentials use the documented HTTPS basic auth shape", () => {
  expect(createGitHubInstallationGitCredentials("test-installation-token")).toEqual({
    username: GITHUB_INSTALLATION_GIT_USERNAME,
    password: "test-installation-token",
  });
});

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

async function buildAgentAuthCookieHeader(
  githubInstallationId: number,
  options?: { includeGitHubUserToken?: boolean },
): Promise<string> {
  const managerName = buildNaniteManagerKey(githubInstallationIdSchema.parse(githubInstallationId));
  const request = new Request(`http://example.com/agents/${NANITE_MANAGER_NAME}/${managerName}`);
  const expiresAt = buildBrowserSessionExpiration();
  const sessionCookie = await sealSessionCookie(
    {
      githubUserId: githubUserIdSchema.parse(7),
      githubLogin: "alex",
      activeGithubInstallationId: githubInstallationIdSchema.parse(githubInstallationId),
      expiresAt,
    },
    request,
    env,
  );
  const cookies = [sessionCookie];
  if (options?.includeGitHubUserToken !== false) {
    cookies.push(
      await sealGitHubUserTokenCookie(
        {
          accessToken: "invalid-token",
          expiresAt,
          refreshToken: null,
          refreshTokenExpiresAt: null,
        },
        request,
        env,
      ),
    );
  }

  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function registerPullRequestFixtureNanite(manager: NaniteManagerTestClient) {
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

    return ctx.dispatchSelf(
      {
        reason: "Generated trigger accepted opened pull request.",
        repository: event.payload.repository.full_name,
        pullNumber: event.payload.pull_request.number,
      },
      {
        surfaces: [
          ctx.githubCheck({
            repository: event.payload.repository.full_name,
            headSha: event.payload.pull_request.head.sha,
            name: "Docs syncer",
          }),
        ],
      },
    );
  },
};
`,
      },
      permissions: {
        github: {
          repositories: ["WebMCP-org/nanites"],
          appPermissions: {
            checks: "write",
          },
        },
      },
    },
  });
}

async function sendSignedPullRequestWebhook(body: string, deliveryId: string) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com${GITHUB_WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "pull_request",
        "x-hub-signature-256": await signGitHubWebhookBody(body, env.GITHUB_WEBHOOK_SECRET),
      },
      body,
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function sendSignedPushWebhook(body: string, deliveryId: string) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com${GITHUB_WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "push",
        "x-hub-signature-256": await signGitHubWebhookBody(body, env.GITHUB_WEBHOOK_SECRET),
      },
      body,
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function waitForGitHubRun(manager: NaniteManagerTestClient) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const snapshot = await manager.getSnapshot();
    const run = snapshot.runOrder.flatMap((runId) => {
      const record = snapshot.runs[runId];
      return record ? [record] : [];
    })[0];

    if (run?.status === "complete" && run.githubCheck?.status === "completed") {
      return { run, snapshot };
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const snapshot = await manager.getSnapshot();
  throw new Error(`Timed out waiting for GitHub run: ${JSON.stringify(snapshot.runs)}`);
}

test("Nanite manager and stable Nanite sub-agent requests are scoped to the active installation", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(123);
  const managerName = buildNaniteManagerKey(githubInstallationId);
  const cookie = await buildAgentAuthCookieHeader(githubInstallationId);
  const allowedResult = await authorizeAgentRequest(
    new Request(`http://example.com/agents/${NANITE_MANAGER_NAME}/${managerName}`, {
      headers: { cookie },
    }),
    env,
  );

  expect(allowedResult).toBeInstanceOf(Request);

  const deniedManagerResponse = await authorizeAgentRequest(
    new Request(
      `http://example.com/agents/${NANITE_MANAGER_NAME}/${buildNaniteManagerKey(
        githubInstallationIdSchema.parse(456),
      )}`,
      {
        headers: { cookie },
      },
    ),
    env,
  );
  expect(deniedManagerResponse).toBeInstanceOf(Response);
  expect((deniedManagerResponse as Response).status).toBe(403);

  const deniedRunResponse = await authorizeAgentRequest(
    new Request(
      `http://example.com/agents/${NANITE_MANAGER_NAME}/${buildNaniteManagerKey(
        githubInstallationIdSchema.parse(456),
      )}/sub/${NANITE_AGENT_NAME}/docs-syncer`,
      {
        headers: { cookie },
      },
    ),
    env,
  );
  expect(deniedRunResponse).toBeInstanceOf(Response);
  expect((deniedRunResponse as Response).status).toBe(403);

  const allowedRunResponse = await authorizeAgentRequest(
    new Request(
      `http://example.com/agents/${NANITE_MANAGER_NAME}/${managerName}/sub/${NANITE_AGENT_NAME}/docs-syncer`,
      {
        headers: { cookie },
      },
    ),
    env,
  );
  expect(allowedRunResponse).toBeInstanceOf(Request);
});

test("Nanite agent routes accept a valid app session without a GitHub token cookie", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(123);
  const managerName = buildNaniteManagerKey(githubInstallationId);
  const cookie = await buildAgentAuthCookieHeader(githubInstallationId, {
    includeGitHubUserToken: false,
  });
  const allowedResult = await authorizeAgentRequest(
    new Request(`http://example.com/agents/${NANITE_MANAGER_NAME}/${managerName}`, {
      headers: { cookie },
    }),
    env,
  );

  expect(allowedResult).toBeInstanceOf(Request);
});

test("signed GitHub pull_request webhook starts one run and publishes one check", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(1);
  const managerName = buildNaniteManagerKey(githubInstallationId);
  const manager = await getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<NaniteManager>,
    managerName,
  );
  const accessTokenRequests: unknown[] = [];
  const checkCreateRequests: unknown[] = [];
  const checkUpdateRequests: unknown[] = [];
  const restoreFetch = mockGitHubApi([
    {
      method: "POST",
      path: "/app/installations/1/access_tokens",
      response: async (request) => {
        const body = await request.text();
        accessTokenRequests.push(body.length ? JSON.parse(body) : null);
        return buildGitHubApiJsonResponse("/app/installations/1/access_tokens", {
          token: "test-installation-token",
          expires_at: "2026-05-17T00:00:00Z",
          permissions: {
            checks: "write",
          },
          repository_selection: "selected",
        });
      },
    },
    buildInstallationRepositoriesRoute(["WebMCP-org/nanites"]),
    {
      method: "POST",
      path: "/repos/WebMCP-org/nanites/check-runs",
      response: async (request) => {
        checkCreateRequests.push(await request.json());
        return buildGitHubApiJsonResponse("/repos/WebMCP-org/nanites/check-runs", {
          id: 123,
          name: "Docs syncer",
          head_sha: "abc123def456",
          status: "in_progress",
          details_url: "http://example.com/nanites",
        });
      },
    },
    {
      method: "PATCH",
      path: "/repos/WebMCP-org/nanites/check-runs/123",
      response: async (request) => {
        checkUpdateRequests.push(await request.json());
        return buildGitHubApiJsonResponse("/repos/WebMCP-org/nanites/check-runs/123", {
          id: 123,
          name: "Docs syncer",
          head_sha: "abc123def456",
          status: "completed",
          conclusion: "success",
        });
      },
    },
  ]);

  try {
    await registerPullRequestFixtureNanite(manager);
    const payload = buildPullRequestWebhookPayload({
      action: "opened",
      installation: {
        id: githubInstallationId,
      },
      repository: {
        full_name: "WebMCP-org/nanites",
        name: "nanites",
        owner: {
          login: "WebMCP-org",
        },
      },
      pull_request: {
        head: {
          sha: "abc123def456",
        },
      },
    });
    const body = JSON.stringify(payload);

    const firstResponse = await sendSignedPullRequestWebhook(body, "delivery-one");
    expect(firstResponse.status).toBe(200);

    const { run } = await waitForGitHubRun(manager);

    expect(run).toMatchObject({
      naniteId: "docs-syncer",
      status: "complete",
      trigger: {
        type: "github",
        event: "pull_request",
        repository: "WebMCP-org/nanites",
        action: "opened",
        pullNumber: 21,
        headSha: "abc123def456",
        input: {
          reason: "Generated trigger accepted opened pull request.",
          repository: "WebMCP-org/nanites",
          pullNumber: 21,
        },
      },
      githubCheck: {
        checkRunId: 123,
        status: "completed",
        conclusion: "success",
      },
    });
    expect(accessTokenRequests).toEqual([null, null, null]);
    expect(checkCreateRequests).toHaveLength(1);
    expect(checkCreateRequests[0]).toMatchObject({
      name: "Docs syncer",
      head_sha: "abc123def456",
      external_id: run.runId,
      status: "in_progress",
      details_url: `http://example.com/nanites?installationId=1&naniteId=docs-syncer&runId=${run.runId}`,
    });
    expect(checkUpdateRequests).toHaveLength(1);
    expect(checkUpdateRequests[0]).toMatchObject({
      status: "completed",
      conclusion: "success",
    });
    expect(JSON.stringify(run)).not.toContain("test-installation-token");

    const duplicateResponse = await sendSignedPullRequestWebhook(body, "delivery-two");
    expect(duplicateResponse.status).toBe(200);
    const duplicateSnapshot = await manager.getSnapshot();
    expect(duplicateSnapshot.runOrder).toHaveLength(1);
    expect(checkCreateRequests).toHaveLength(1);
  } finally {
    restoreFetch();
  }
}, 20_000);

test("generated trigger can opt out of GitHub checks even with checks permission", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(1_246_802);
  const managerName = buildNaniteManagerKey(githubInstallationId);
  const manager = await getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<NaniteManager>,
    managerName,
  );
  const checkCreateRequests: unknown[] = [];
  const restoreFetch = mockGitHubApi([
    {
      method: "POST",
      path: `/app/installations/${githubInstallationId}/access_tokens`,
      response: () =>
        buildGitHubApiJsonResponse(`/app/installations/${githubInstallationId}/access_tokens`, {
          token: "test-installation-token",
          expires_at: "2026-05-17T00:00:00Z",
          permissions: {
            checks: "write",
          },
          repository_selection: "selected",
        }),
    },
    buildInstallationRepositoriesRoute(["WebMCP-org/nanites"]),
    {
      method: "POST",
      path: "/repos/WebMCP-org/nanites/check-runs",
      response: async (request) => {
        checkCreateRequests.push(await request.json());
        return buildGitHubApiJsonResponse("/repos/WebMCP-org/nanites/check-runs", {
          id: 124,
          name: "Should not be created",
          head_sha: "abc123def456",
          status: "in_progress",
        });
      },
    },
  ]);

  try {
    await manager.registerNanite({
      manifest: {
        id: "docs-syncer-no-check",
        name: "Docs syncer no check",
        description: "Exercises explicit generated trigger check opt-out.",
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
    return ctx.dispatchSelf(
      {
        reason: "Generated trigger accepted opened pull request without a GitHub surface.",
        repository: event.payload.repository.full_name,
      },
      { surfaces: [] },
    );
  },
};
`,
        },
        permissions: {
          github: {
            repositories: ["WebMCP-org/nanites"],
            appPermissions: {
              checks: "write",
            },
          },
        },
      },
    });

    const payload = buildPullRequestWebhookPayload({
      action: "opened",
      installation: {
        id: githubInstallationId,
      },
      repository: {
        full_name: "WebMCP-org/nanites",
        name: "nanites",
        owner: {
          login: "WebMCP-org",
        },
      },
      pull_request: {
        head: {
          sha: "abc123def456",
        },
      },
    });

    const response = await sendSignedPullRequestWebhook(
      JSON.stringify(payload),
      "no-check-delivery",
    );
    expect(response.status).toBe(200);

    const snapshot = await manager.getSnapshot();
    const run = snapshot.runOrder.flatMap((runId) => {
      const record = snapshot.runs[runId];
      return record ? [record] : [];
    })[0];

    expect(run).toMatchObject({
      naniteId: "docs-syncer-no-check",
      githubCheck: null,
    });
    expect(checkCreateRequests).toHaveLength(0);
  } finally {
    restoreFetch();
  }
}, 20_000);

test("generated push trigger can request a GitHub check surface", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(2_468_024);
  const managerName = buildNaniteManagerKey(githubInstallationId);
  const manager = await getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<NaniteManager>,
    managerName,
  );
  const checkCreateRequests: unknown[] = [];
  const checkUpdateRequests: unknown[] = [];
  const restoreFetch = mockGitHubApi([
    {
      method: "POST",
      path: `/app/installations/${githubInstallationId}/access_tokens`,
      response: () =>
        buildGitHubApiJsonResponse(`/app/installations/${githubInstallationId}/access_tokens`, {
          token: "test-installation-token",
          expires_at: "2026-05-17T00:00:00Z",
          permissions: {
            checks: "write",
          },
          repository_selection: "selected",
        }),
    },
    buildInstallationRepositoriesRoute(["WebMCP-org/nanites"]),
    {
      method: "POST",
      path: "/repos/WebMCP-org/nanites/check-runs",
      response: async (request) => {
        checkCreateRequests.push(await request.json());
        return buildGitHubApiJsonResponse("/repos/WebMCP-org/nanites/check-runs", {
          id: 246,
          name: "Push release watcher",
          head_sha: "def456abc123",
          status: "in_progress",
        });
      },
    },
    {
      method: "PATCH",
      path: "/repos/WebMCP-org/nanites/check-runs/246",
      response: async (request) => {
        checkUpdateRequests.push(await request.json());
        return buildGitHubApiJsonResponse("/repos/WebMCP-org/nanites/check-runs/246", {
          id: 246,
          name: "Push release watcher",
          head_sha: "def456abc123",
          status: "completed",
          conclusion: "success",
        });
      },
    },
  ]);

  try {
    await manager.registerNanite({
      manifest: {
        id: "push-release-watcher",
        name: "Push release watcher",
        description: "Exercises explicit push-triggered GitHub check surfaces.",
        trigger: {
          type: "github",
          event: "push",
          repository: "WebMCP-org/nanites",
          branch: "main",
        },
        inboundTrigger: {
          sourceCode: `
export default {
  async handle(event, ctx) {
    return ctx.dispatchSelf(
      {
        reason: "Generated trigger accepted push.",
        repository: event.payload.repository.full_name,
      },
      {
        surfaces: [
          ctx.githubCheck({
            repository: event.payload.repository.full_name,
            headSha: event.payload.after,
            name: "Push release watcher",
          }),
        ],
      },
    );
  },
};
`,
        },
        permissions: {
          github: {
            repositories: ["WebMCP-org/nanites"],
            appPermissions: {
              checks: "write",
            },
          },
        },
      },
    });

    const payload = buildPushWebhookPayload({
      installation: {
        id: githubInstallationId,
      },
      after: "def456abc123",
    });

    const response = await sendSignedPushWebhook(JSON.stringify(payload), "push-check-delivery");
    expect(response.status).toBe(200);

    const startedAt = Date.now();
    let run: NaniteRunRecord | null = null;
    while (Date.now() - startedAt < 15_000) {
      const snapshot = await manager.getSnapshot();
      run =
        snapshot.runOrder.flatMap((runId) => {
          const record = snapshot.runs[runId];
          return record ? [record] : [];
        })[0] ?? null;
      if (run?.status === "complete" && run.githubCheck?.status === "completed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(run).toMatchObject({
      naniteId: "push-release-watcher",
      status: "complete",
      trigger: {
        type: "github",
        event: "push",
        afterSha: "def456abc123",
      },
      githubCheck: {
        name: "Push release watcher",
        checkRunId: 246,
        status: "completed",
      },
    });
    expect(checkCreateRequests).toHaveLength(1);
    expect(checkCreateRequests[0]).toMatchObject({
      name: "Push release watcher",
      head_sha: "def456abc123",
      status: "in_progress",
      details_url: `http://example.com/nanites?installationId=${githubInstallationId}&naniteId=push-release-watcher&runId=${run?.runId}`,
    });
    expect(checkUpdateRequests).toHaveLength(1);
  } finally {
    restoreFetch();
  }
}, 20_000);

test("generated trigger failures do not create in-progress GitHub checks", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(987_651);
  const managerName = buildNaniteManagerKey(githubInstallationId);
  const manager = await getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<NaniteManager>,
    managerName,
  );
  const accessTokenRequests: unknown[] = [];
  const checkCreateRequests: unknown[] = [];
  const restoreFetch = mockGitHubApi([
    {
      method: "POST",
      path: `/app/installations/${githubInstallationId}/access_tokens`,
      response: async (request) => {
        const body = await request.text();
        accessTokenRequests.push(body.length ? JSON.parse(body) : null);
        return buildGitHubApiJsonResponse(
          `/app/installations/${githubInstallationId}/access_tokens`,
          {
            token: "test-installation-token",
            expires_at: "2026-05-17T00:00:00Z",
            permissions: {
              checks: "write",
            },
            repository_selection: "selected",
          },
        );
      },
    },
    buildInstallationRepositoriesRoute(["WebMCP-org/nanites"]),
    {
      method: "POST",
      path: "/repos/WebMCP-org/nanites/check-runs",
      response: async (request) => {
        checkCreateRequests.push(await request.json());
        return buildGitHubApiJsonResponse("/repos/WebMCP-org/nanites/check-runs", {
          id: 456,
          name: "Nanites",
          head_sha: "abc123def456",
          status: "in_progress",
        });
      },
    },
  ]);

  try {
    await manager.registerNanite({
      manifest: {
        id: "broken-trigger-docs-syncer",
        name: "Broken trigger docs syncer",
        description: "Exercises generated trigger failure handling.",
        trigger: {
          type: "github",
          event: "pull_request",
          repositories: ["WebMCP-org/nanites"],
          actions: ["opened"],
        },
        inboundTrigger: {
          sourceCode: `
export default {
  async handle() {
    throw new Error("generated trigger exploded");
  },
};
`,
        },
        permissions: {
          github: {
            repositories: ["WebMCP-org/nanites"],
            appPermissions: {
              checks: "write",
            },
          },
        },
      },
    });

    const payload = buildPullRequestWebhookPayload({
      action: "opened",
      installation: {
        id: githubInstallationId,
      },
      repository: {
        full_name: "WebMCP-org/nanites",
        name: "nanites",
        owner: {
          login: "WebMCP-org",
        },
      },
      pull_request: {
        head: {
          sha: "abc123def456",
        },
      },
    });

    const response = await sendSignedPullRequestWebhook(
      JSON.stringify(payload),
      "broken-trigger-delivery",
    );
    expect(response.status).toBe(200);

    const snapshot = await manager.getSnapshot();
    const run = snapshot.runOrder.flatMap((runId) => {
      const record = snapshot.runs[runId];
      return record ? [record] : [];
    })[0];

    expect(run).toMatchObject({
      naniteId: "broken-trigger-docs-syncer",
      status: "fail",
      githubCheck: null,
    });
    expect(run?.summary).toContain("phase=response");
    expect(run?.summary).toContain("generated trigger exploded");
    expect(run?.summary).toContain("sourceBytes=");
    expect(accessTokenRequests).toEqual([null]);
    expect(checkCreateRequests).toHaveLength(0);
  } finally {
    restoreFetch();
  }
});
