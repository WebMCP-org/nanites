import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import {
  TEST_GITHUB_APP_ID,
  ensureD1BaselineSchema,
  saveTestGitHubApp,
} from "../helpers/d1-baseline.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";
import { buildGitHubTriggerFixture } from "#/backend/nanites/triggers.ts";
import type {
  NaniteRunRecord,
  SigveloNaniteManager,
} from "#/backend/agents/SigveloNaniteManager.ts";
import { getGitHubWebhookRepositoryFullName } from "#/shared/utils/github.ts";
import {
  waitForRunWorkflowStatus,
  waitForTerminalRun,
  withDetachedRpcResults,
} from "../helpers/rpc-results.ts";

beforeAll(async () => {
  await ensureD1BaselineSchema(env.DB);
});

type InstallationManager = Pick<
  SigveloNaniteManager,
  | "cancelRuns"
  | "dispatchRun"
  | "getSnapshot"
  | "handleGitHubWebhook"
  | "inspectNaniteDebug"
  | "recordRunFailureWithoutWorkflowOutput"
  | "recordRuntimeActivity"
  | "recordWorkflowResult"
  | "registerNanite"
  | "resolveManagerRequest"
  | "startNaniteManualRun"
  | "startRun"
  | "testNaniteTrigger"
>;

async function getManager(): Promise<InstallationManager> {
  return withDetachedRpcResults(
    (await getAgentByName(
      env.SigveloNaniteManager as DurableObjectNamespace<SigveloNaniteManager>,
      `trigger-validation-${crypto.randomUUID()}`,
    )) as unknown as InstallationManager,
  );
}

async function getInstallationManager(
  githubInstallationId = Math.floor(Math.random() * 1_000_000) + 1,
): Promise<InstallationManager> {
  return withDetachedRpcResults(
    (await getAgentByName(
      env.SigveloNaniteManager as DurableObjectNamespace<SigveloNaniteManager>,
      `app:${TEST_GITHUB_APP_ID}:installation:${githubInstallationId}`,
    )) as unknown as InstallationManager,
  );
}

const packageDocsTriggerSource = `
export default {
  async handle(event, ctx) {
    if (event.name !== "push") {
      return ctx.noop("Not a push event.");
    }

    const changed = event.payload.commits?.flatMap((commit) => [
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? []),
    ]) ?? [];
    const relevant = changed.filter((file) => file.startsWith("packages/react-webmcp/"));

    if (relevant.length === 0) {
      return ctx.noop("No React WebMCP package files changed.");
    }

    return ctx.dispatchSelf({
      reason: "React WebMCP package changed",
      files: relevant,
    });
  },
};
`;

const repoFilteredPackageDocsTriggerSource = `
export default {
  async handle(event, ctx) {
    if (event.name !== "push") {
      return ctx.noop("Not a push event.");
    }

    if (event.payload.repository.full_name !== "WebMCP-org/npm-packages") {
      return ctx.noop("Not npm-packages repo");
    }

    const changed = event.payload.commits?.flatMap((commit) => [
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? []),
    ]) ?? [];
    const relevant = changed.filter((file) => file.startsWith("packages/react-webmcp/"));

    if (relevant.length === 0) {
      return ctx.noop("No React WebMCP package files changed.");
    }

    return ctx.dispatchSelf({
      reason: "React WebMCP package changed",
      files: relevant,
    });
  },
};
`;

const issueTriageTriggerSource = `
export default {
  async handle(event, ctx) {
    if (event.name !== "issues") return ctx.noop("Not an issues event.");
    if (!["opened", "reopened"].includes(event.payload.action)) {
      return ctx.noop(\`Ignored issue action: \${event.payload.action}\`);
    }

    return ctx.dispatchSelf({
      reason: "Issue needs triage",
      issueNumber: event.payload.issue.number,
    });
  },
};
`;

type TriggerTestOutput = Awaited<ReturnType<InstallationManager["testNaniteTrigger"]>>;
const naniteModel = "deepseek/deepseek-v4-pro";
const fixtureEnv = env as unknown as { NANITES_LLM_FIXTURE: string };

async function registerPackageDocsSyncer(
  manager: InstallationManager,
  input: {
    id: string;
    name: string;
    triggerSource: string;
  },
) {
  await manager.registerNanite({
    manifest: {
      id: input.id,
      name: input.name,
      description: "Keeps package docs aligned with package changes.",
      model: naniteModel,
      eventSource: {
        type: "github",
      },
      triggerSource: input.triggerSource,
      permissions: {},
    },
  });
}

const npmPackagesRepositoryOverride = {
  full_name: "WebMCP-org/npm-packages",
  name: "npm-packages",
  owner: { login: "WebMCP-org" },
};

const packageDocsChangedCommit = {
  id: "test000000000001",
  added: [],
  modified: ["packages/react-webmcp/README.md"],
  removed: [],
};

function testPackageDocsTrigger(
  manager: InstallationManager,
  input: {
    naniteId: string;
    commits?: Array<typeof packageDocsChangedCommit>;
  },
) {
  return manager.testNaniteTrigger({
    naniteId: input.naniteId,
    actorId: "github:1",
    requestId: crypto.randomUUID(),
    event: {
      fixture: "push",
      overrides: {
        repository: npmPackagesRepositoryOverride,
        ref: "refs/heads/main",
        ...(input.commits ? { commits: input.commits } : {}),
      },
    },
    waitForTerminalOutcome: true,
    timeoutMs: 10_000,
  });
}

function expectAcceptedTriggerRun(output: TriggerTestOutput, naniteId: string) {
  expect(output.ok).toBe(true);
  expect(output.runs).toHaveLength(1);
  expect(output.acceptance).toMatchObject({
    fixtureBuilt: true,
    triggerAcceptedEvent: true,
    runCreated: true,
    modelDispatched: true,
    terminalOutcomeReached: true,
    triggerRejectionReason: null,
  });
  expect(output.runs[0]).toMatchObject({
    naniteId,
    status: "complete",
  });
}

test("nanite registration stores generated triggers only after validation passes", async () => {
  const manager = await getManager();

  await manager.registerNanite({
    manifest: {
      id: "valid-generated-trigger",
      name: "Valid generated trigger",
      description: "Registers source that satisfies the trigger runtime contract.",
      model: naniteModel,
      eventSource: {
        type: "github",
        events: ["push"],
        repositories: ["WebMCP-org/nanites"],
        branches: ["main"],
      },
      triggerSource: `
export default {
  async handle(_event, ctx) {
    return ctx.noop("validated");
  },
};
`,
      permissions: {},
    },
  });

  expect((await manager.getSnapshot()).nanites["valid-generated-trigger"]?.manifest).toMatchObject({
    id: "valid-generated-trigger",
    triggerSource: expect.stringContaining("async handle"),
  });
});

test("trigger tests return generated noop reasons when fixtures do not dispatch", async () => {
  const manager = await getInstallationManager();

  await registerPackageDocsSyncer(manager, {
    id: "package-docs-syncer",
    name: "Package docs syncer",
    triggerSource: packageDocsTriggerSource,
  });

  const output = await testPackageDocsTrigger(manager, {
    naniteId: "package-docs-syncer",
  });

  expect(output.ok).toBe(false);
  expect(output.runs).toHaveLength(0);
  expect(output.acceptance).toMatchObject({
    fixtureBuilt: true,
    triggerAcceptedEvent: false,
    runCreated: false,
    modelDispatched: false,
    triggerRejectionReason:
      "Generated trigger returned noop: No React WebMCP package files changed.",
  });
  expect(output.error).toBe(output.acceptance.triggerRejectionReason);
});

test("trigger tests dispatch when fixture overrides satisfy generated filters", async () => {
  const manager = await getInstallationManager();

  await registerPackageDocsSyncer(manager, {
    id: "package-docs-syncer",
    name: "Package docs syncer",
    triggerSource: packageDocsTriggerSource,
  });

  const output = await testPackageDocsTrigger(manager, {
    naniteId: "package-docs-syncer",
    commits: [packageDocsChangedCommit],
  });

  expectAcceptedTriggerRun(output, "package-docs-syncer");
});

test("trigger tests apply fixture repository overrides before generated filters run", async () => {
  const manager = await getInstallationManager();

  await registerPackageDocsSyncer(manager, {
    id: "package-docs-syncer-repository-overrides",
    name: "Package docs syncer repository overrides",
    triggerSource: repoFilteredPackageDocsTriggerSource,
  });

  const output = await manager.testNaniteTrigger({
    naniteId: "package-docs-syncer-repository-overrides",
    actorId: "github:1",
    requestId: crypto.randomUUID(),
    event: {
      fixture: "push",
      overrides: {
        repository: {
          full_name: "WebMCP-org/npm-packages",
          name: "npm-packages",
          owner: {
            login: "WebMCP-org",
          },
        },
        ref: "refs/heads/main",
        commits: [packageDocsChangedCommit],
      },
    },
    waitForTerminalOutcome: true,
    timeoutMs: 10_000,
  });

  expect(output.ok).toBe(true);
  expect(getGitHubWebhookRepositoryFullName(output.event)).toBe("WebMCP-org/npm-packages");
  expectAcceptedTriggerRun(output, "package-docs-syncer-repository-overrides");
});

test("trigger tests dispatch issue fixtures through generated filters", async () => {
  const manager = await getInstallationManager();
  const naniteId = "issue-triage-nanite";

  await manager.registerNanite({
    manifest: {
      id: naniteId,
      name: "Issue triage Nanite",
      description: "Triages new and reopened issues.",
      model: naniteModel,
      eventSource: {
        type: "github",
        events: ["issues.opened", "issues.reopened"],
        actions: ["opened", "reopened"],
      },
      triggerSource: issueTriageTriggerSource,
      permissions: {},
    },
  });

  const output = await manager.testNaniteTrigger({
    naniteId,
    actorId: "github:1",
    requestId: crypto.randomUUID(),
    event: {
      fixture: "issues.opened",
    },
    waitForTerminalOutcome: true,
    timeoutMs: 10_000,
  });

  expectAcceptedTriggerRun(output, naniteId);
  expect(output.event.name).toBe("issues");
  expect(output.event.payload.action).toBe("opened");
});

test("issues write Nanites can file issues and comment through GitHub MCP inside execute", async () => {
  const githubInstallationId = Math.floor(Math.random() * 1_000_000) + 1;
  const manager = await getInstallationManager(githubInstallationId);
  const naniteId = "issue-github-mcp-actions";
  const originalFixture = fixtureEnv.NANITES_LLM_FIXTURE;
  const restoreGitHubApi = mockGitHubApi([
    {
      method: "POST",
      path: `/app/installations/${githubInstallationId}/access_tokens`,
      response: () =>
        Response.json({
          token: "test-installation-token",
          expires_at: "2026-06-10T20:00:00Z",
          permissions: { issues: "write" },
        }),
    },
    {
      path: /^\/installation\/repositories(?:\?(?:page=1&per_page=100|per_page=100&page=1))?$/,
      response: () =>
        Response.json({
          total_count: 1,
          repository_selection: "selected",
          repositories: [
            {
              id: 1255393047,
              full_name: "WebMCP-org/nanites",
              name: "nanites",
              private: true,
              permissions: { push: true, pull: true },
              owner: { login: "WebMCP-org" },
            },
          ],
        }),
    },
  ]);
  const githubApiFetch = globalThis.fetch;
  const fakeGitHub = {
    headers: null as Record<
      "tools" | "toolsets" | "excludedTools" | "readonly",
      string | null
    > | null,
    toolCalls: [] as Array<{ name: string; arguments: unknown }>,
  };

  globalThis.fetch = async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const request =
      requestInput instanceof Request ? requestInput : new Request(requestInput, init);
    const url = new URL(request.url);

    if (url.origin !== "https://api.githubcopilot.com" || url.pathname !== "/mcp/") {
      return githubApiFetch(requestInput, init);
    }

    if (request.method === "GET") {
      return new Response("SSE not supported", { status: 405 });
    }
    if (request.method === "DELETE") {
      return new Response(null, { status: 200 });
    }

    const message = (await request.json()) as {
      id?: number | string;
      method?: string;
      params?: { protocolVersion?: string; name?: string; arguments?: unknown };
    };
    if (message.id === undefined) {
      return new Response(null, { status: 202 });
    }

    const respond = (result: unknown) => Response.json({ jsonrpc: "2.0", id: message.id, result });
    switch (message.method) {
      case "initialize":
        return respond({
          protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "fake-github-mcp", version: "1.0.0" },
        });
      case "tools/list":
        fakeGitHub.headers = {
          tools: request.headers.get("X-MCP-Tools"),
          toolsets: request.headers.get("X-MCP-Toolsets"),
          excludedTools: request.headers.get("X-MCP-Exclude-Tools"),
          readonly: request.headers.get("X-MCP-Readonly"),
        };
        return respond({
          tools: ["get_me", "add_issue_comment", "issue_write"].map((name) => ({
            name,
            inputSchema: { type: "object", properties: {} },
          })),
        });
      case "tools/call": {
        const name = String(message.params?.name ?? "");
        fakeGitHub.toolCalls.push({
          name,
          arguments: message.params?.arguments ?? null,
        });
        return respond({
          content: [{ type: "text", text: JSON.stringify({ ok: true, name }) }],
        });
      }
      default:
        return respond({});
    }
  };

  try {
    await saveTestGitHubApp(env.DB);
    fixtureEnv.NANITES_LLM_FIXTURE = "github_mcp_issue_actions";
    await manager.registerNanite({
      manifest: {
        id: naniteId,
        name: "Issue GitHub MCP actions",
        description: "Verifies issue filing and comment tools execute in Nanite runtime code.",
        model: naniteModel,
        eventSource: {
          type: "manual",
        },
        permissions: {
          github: {
            repositories: ["WebMCP-org/nanites"],
            appPermissions: {
              issues: "write",
            },
          },
        },
      },
    });

    const run = await manager.startRun({
      naniteId,
      trigger: {
        type: "manual",
        requestId: crypto.randomUUID(),
        actorId: "github:1",
        message: "Create a scoped follow-up issue and comment on an issue through GitHub MCP.",
      },
    });
    await manager.dispatchRun({ runId: run.runId });

    const terminalRun = await waitForTerminalRun(manager, { runId: run.runId });
    if (terminalRun.status !== "no_change") {
      throw new Error("Expected the GitHub MCP action run to finish with no_change.");
    }
    expect(terminalRun.agentFeedback).toMatchObject({
      severity: "info",
      suggestions: ["issue_write_called=true", "add_issue_comment_called=true"],
    });
    const workflow = await waitForRunWorkflowStatus(manager, { runId: run.runId });
    expect(workflow).toMatchObject({
      runId: run.runId,
      workflow: {
        workflowId: run.runId,
        workflowName: "NANITE_RUN_WORKFLOW",
        status: "complete",
        metadata: {
          naniteId,
          triggerType: "manual",
        },
      },
    });

    expect(fakeGitHub.toolCalls).toMatchObject([
      {
        name: "issue_write",
        arguments: {
          method: "create",
          owner: "WebMCP-org",
          repo: "nanites",
          title: "Nanite fixture follow-up",
        },
      },
      {
        name: "add_issue_comment",
        arguments: {
          owner: "WebMCP-org",
          repo: "nanites",
          issue_number: 130,
        },
      },
    ]);
    const observedHeaders = fakeGitHub.headers;
    expect(observedHeaders).toMatchObject({
      tools: null,
      readonly: null,
    });
    expect(observedHeaders?.toolsets?.split(",").sort()).toEqual(["context", "issues"]);
    expect(observedHeaders?.excludedTools?.split(",")).not.toContain("issue_write");
  } finally {
    fixtureEnv.NANITES_LLM_FIXTURE = originalFixture;
    globalThis.fetch = githubApiFetch;
    restoreGitHubApi();
  }
});

test("ask_manager workflow output pauses the run with a request-only manager request", async () => {
  const manager = await getInstallationManager();
  const naniteId = "ask-manager-workflow-output";
  const originalFixture = fixtureEnv.NANITES_LLM_FIXTURE;

  try {
    fixtureEnv.NANITES_LLM_FIXTURE = "ask_manager";
    await manager.registerNanite({
      manifest: {
        id: naniteId,
        name: "Ask manager workflow output",
        description: "Exercises manager escalation.",
        model: naniteModel,
        eventSource: {
          type: "manual",
        },
        permissions: {},
      },
    });

    const run = await manager.startRun({
      naniteId,
      trigger: {
        type: "manual",
        requestId: crypto.randomUUID(),
        actorId: "github:1",
        message: "Open the documentation PR.",
      },
    });
    await manager.dispatchRun({ runId: run.runId });

    const waitingRun = await waitForRunStatus(manager, run.runId, "waiting_for_manager");
    if (waitingRun.status !== "waiting_for_manager") {
      throw new Error("Expected the Nanite run to wait for the manager.");
    }
    expect(waitingRun.managerRequest.request).toContain("repository authority");
    expect("summary" in waitingRun).toBe(false);

    const activity = (await manager.getSnapshot()).runtimeActivityByNanite[naniteId];
    expect(activity).toMatchObject({
      state: "waiting_for_manager",
      runId: run.runId,
    });

    const workflow = await waitForRunWorkflowStatus(manager, { runId: run.runId });
    expect(workflow).toMatchObject({
      runId: run.runId,
      workflow: {
        workflowId: run.runId,
        workflowName: "NANITE_RUN_WORKFLOW",
        status: "complete",
        metadata: {
          naniteId,
          triggerType: "manual",
        },
      },
    });

    const cancellationReason = "Manager canceled the waiting test run.";
    const cancellation = await manager.cancelRuns({
      runIds: [run.runId],
      reason: cancellationReason,
    });
    expect(cancellation.skippedRuns).toEqual([]);
    expect(cancellation.canceledRuns).toHaveLength(1);
    expect(cancellation.canceledRuns[0]).toMatchObject({
      runId: run.runId,
      status: "canceled",
      summary: cancellationReason,
    });

    const canceledWorkflow = await waitForRunWorkflowStatus(manager, { runId: run.runId });
    expect(canceledWorkflow.workflow?.status).toBe("complete");
  } finally {
    fixtureEnv.NANITES_LLM_FIXTURE = originalFixture;
  }
});

test("manual run projects ask_manager output through Workflow callbacks", async () => {
  const manager = await getInstallationManager();
  const naniteId = "ask-manager-manual-wait";
  const originalFixture = fixtureEnv.NANITES_LLM_FIXTURE;

  try {
    fixtureEnv.NANITES_LLM_FIXTURE = "ask_manager";
    await manager.registerNanite({
      manifest: {
        id: naniteId,
        name: "Ask manager manual wait",
        description: "Exercises manual wait outcome handling.",
        model: naniteModel,
        eventSource: {
          type: "manual",
        },
        permissions: {},
      },
    });

    const output = await manager.startNaniteManualRun({
      naniteId,
      actorId: "github:1",
      message: "Open the documentation PR.",
    });

    expect(output.ok).toBe(true);
    expect(output.runs).toHaveLength(1);
    expect(output.runs[0].status).toBe("running");

    const waitingRun = await waitForRunStatus(manager, output.runs[0].runId, "waiting_for_manager");
    if (waitingRun.status !== "waiting_for_manager") {
      throw new Error("Expected the Nanite run to wait for the manager.");
    }
    expect(waitingRun.managerRequest?.request).toContain("repository authority");
  } finally {
    fixtureEnv.NANITES_LLM_FIXTURE = originalFixture;
  }
});

test("manager rejection closes an ask_manager run without resuming its Workflow", async () => {
  const manager = await getInstallationManager();
  const naniteId = "ask-manager-reject";
  const originalFixture = fixtureEnv.NANITES_LLM_FIXTURE;

  try {
    fixtureEnv.NANITES_LLM_FIXTURE = "ask_manager";
    await manager.registerNanite({
      manifest: {
        id: naniteId,
        name: "Ask manager reject",
        description: "Exercises manager rejection.",
        model: naniteModel,
        eventSource: {
          type: "manual",
        },
        permissions: {},
      },
    });

    const run = await manager.startRun({
      naniteId,
      trigger: {
        type: "manual",
        requestId: crypto.randomUUID(),
        actorId: "github:1",
        message: "Open the documentation PR.",
      },
    });
    await manager.dispatchRun({ runId: run.runId });

    const waitingRun = await waitForRunStatus(manager, run.runId, "waiting_for_manager");
    if (waitingRun.status !== "waiting_for_manager") {
      throw new Error("Expected the Nanite run to wait for the manager.");
    }
    await waitForRunWorkflowStatus(manager, { runId: run.runId });

    await manager.resolveManagerRequest({
      kind: "reject",
      runId: run.runId,
      requestId: waitingRun.managerRequest.id,
      summary: "Manager rejected the requested authority.",
    });

    const terminalRun = await waitForTerminalRun(manager, { runId: run.runId });
    if (terminalRun.status !== "fail") {
      throw new Error("Expected rejected manager request to fail the run.");
    }
    expect(terminalRun.summary).toBe("Manager rejected the requested authority.");
    const workflow = await waitForRunWorkflowStatus(manager, { runId: run.runId });
    expect(workflow.workflow?.status).toBe("complete");
  } finally {
    fixtureEnv.NANITES_LLM_FIXTURE = originalFixture;
  }
});

test("manager response starts a follow-up Workflow-backed run", async () => {
  const manager = await getInstallationManager();
  const naniteId = "ask-manager-resume";
  const originalFixture = fixtureEnv.NANITES_LLM_FIXTURE;

  try {
    fixtureEnv.NANITES_LLM_FIXTURE = "ask_manager";
    await manager.registerNanite({
      manifest: {
        id: naniteId,
        name: "Ask manager resume",
        description: "Exercises manager resume.",
        model: naniteModel,
        eventSource: {
          type: "manual",
        },
        permissions: {},
      },
    });

    const run = await manager.startRun({
      naniteId,
      trigger: {
        type: "manual",
        requestId: crypto.randomUUID(),
        actorId: "github:1",
        message: "Open the documentation PR.",
      },
    });
    await manager.dispatchRun({ runId: run.runId });

    const waitingRun = await waitForRunStatus(manager, run.runId, "waiting_for_manager");
    if (waitingRun.status !== "waiting_for_manager") {
      throw new Error("Expected the Nanite run to wait for the manager.");
    }
    await waitForRunWorkflowStatus(manager, { runId: run.runId });

    fixtureEnv.NANITES_LLM_FIXTURE = "no_change";
    const followUpRun = await manager.resolveManagerRequest({
      kind: "resume",
      runId: run.runId,
      requestId: waitingRun.managerRequest.id,
      message: "Repository authority has been granted. Continue the run.",
    });

    expect(followUpRun.runId).not.toBe(run.runId);
    expect(followUpRun.trigger).toMatchObject({
      type: "manual",
      actorId: "github:1",
    });

    const resolvedRequestRun = await waitForTerminalRun(manager, { runId: run.runId });
    if (resolvedRequestRun.status !== "no_change") {
      throw new Error("Expected resolved manager request to close with no_change.");
    }
    expect(resolvedRequestRun.summary).toBe(
      "Manager answered this request by starting a follow-up run.",
    );

    const terminalRun = await waitForTerminalRun(manager, { runId: followUpRun.runId });
    if (terminalRun.status !== "no_change") {
      throw new Error("Expected follow-up run to finish with no_change.");
    }
    const workflow = await waitForRunWorkflowStatus(manager, { runId: followUpRun.runId });
    expect(workflow.workflow?.status).toBe("complete");
  } finally {
    fixtureEnv.NANITES_LLM_FIXTURE = originalFixture;
  }
});

test("missing workflow structured output fails the run projection", async () => {
  const manager = await getInstallationManager();
  const naniteId = "missing-workflow-output";

  await manager.registerNanite({
    manifest: {
      id: naniteId,
      name: "Missing workflow output",
      description: "Exercises workflow output failure projection.",
      model: naniteModel,
      eventSource: {
        type: "manual",
      },
      permissions: {},
    },
  });

  const run = await manager.startRun({
    naniteId,
    trigger: {
      type: "manual",
      requestId: crypto.randomUUID(),
      actorId: "github:1",
      message: "Inspect the trigger but omit a structured result.",
    },
  });

  const terminalRun = await manager.recordRunFailureWithoutWorkflowOutput({
    runId: run.runId,
    error: "Nanite Run Workflow failed before reporting structured output: no workflow result",
  });
  if (terminalRun.status !== "fail") {
    throw new Error("Expected missing Workflow output to fail the run.");
  }
  expect(terminalRun.summary).toContain(
    "Nanite Run Workflow failed before reporting structured output",
  );
});

test("terminal run activity ignores late Think submission activity reports", async () => {
  const manager = await getInstallationManager();
  const naniteId = "terminal-activity-race";

  await manager.registerNanite({
    manifest: {
      id: naniteId,
      name: "Terminal activity race",
      description: "Exercises terminal runtime activity projection.",
      model: naniteModel,
      eventSource: {
        type: "manual",
      },
      permissions: {},
    },
  });

  const run = await manager.startRun({
    naniteId,
    trigger: {
      type: "manual",
      requestId: crypto.randomUUID(),
      actorId: "github:1",
      message: "Check whether anything changed.",
    },
  });
  const terminalRun = await manager.recordWorkflowResult({
    runId: run.runId,
    naniteId,
    result: {
      kind: "no_change",
      summary: "Nothing changed.",
      agentFeedback: null,
    },
  });
  if (terminalRun.status !== "no_change") {
    throw new Error("Expected direct Workflow result to finish with no_change.");
  }

  const lateThinking = await manager.recordRuntimeActivity({
    naniteId,
    runId: run.runId,
    state: "thinking",
  });
  expect(lateThinking).toMatchObject({
    state: "idle",
    runId: run.runId,
    toolName: null,
    lastActivityAt: terminalRun.completedAt,
    error: null,
  });

  const latePromptSchemaError = await manager.recordRuntimeActivity({
    naniteId,
    runId: run.runId,
    state: "error",
    error: "Invalid prompt: The messages do not match the ModelMessage[] schema.",
  });
  expect(latePromptSchemaError).toEqual(lateThinking);

  const snapshot = await manager.getSnapshot();
  expect(snapshot.runs[run.runId]?.status).toBe("no_change");
  expect(snapshot.runtimeActivityByNanite[naniteId]).toEqual(lateThinking);
});

async function waitForRunStatus(
  manager: InstallationManager,
  runId: string,
  status: NaniteRunRecord["status"],
): Promise<NaniteRunRecord> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const run = (await manager.getSnapshot()).runs[runId];
    if (run?.status === status) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Run ${runId} did not reach ${status} in time.`);
}

test("webhook dispatch dedupes runs by trigger idempotency key", async () => {
  const manager = await getInstallationManager();

  await registerPackageDocsSyncer(manager, {
    id: "package-docs-syncer-dedupe",
    name: "Package docs syncer dedupe",
    triggerSource: packageDocsTriggerSource,
  });

  const event = buildGitHubTriggerFixture({
    fixture: "push",
    deliveryId: "delivery-dedupe-1",
    installationId: 555,
    overrides: {
      repository: npmPackagesRepositoryOverride,
      ref: "refs/heads/main",
      after: "test000000000002",
      commits: [packageDocsChangedCommit],
    },
  });

  const firstEvaluations = await manager.handleGitHubWebhook({ event });
  expect(firstEvaluations).toHaveLength(1);
  expect(firstEvaluations[0]?.dispatches).toHaveLength(1);
  expect(firstEvaluations[0]?.dispatches[0]?.created).toBe(true);
  const runId = firstEvaluations[0]?.dispatches[0]?.run.runId;
  if (!runId) {
    throw new Error("Expected the first webhook delivery to create a run.");
  }

  await waitForTerminalRun(manager, { runId });

  const secondEvaluations = await manager.handleGitHubWebhook({ event });
  expect(secondEvaluations).toHaveLength(1);
  expect(secondEvaluations[0]?.skippedReason).toBeNull();
  expect(secondEvaluations[0]?.dispatches[0]?.created).toBe(false);
  expect(secondEvaluations[0]?.dispatches[0]?.run.runId).toBe(runId);
});
