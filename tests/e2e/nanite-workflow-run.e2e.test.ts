import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { getAgentByName } from "agents";
import worker from "#/server.ts";
import { buildGitHubTriggerFixture } from "#/backend/nanites/triggers.ts";
import type { SigveloNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import { buildNaniteManagerKey } from "#/shared/utils/nanites.ts";
import {
  TEST_GITHUB_APP_ID,
  ensureD1BaselineSchema,
  saveTestGitHubApp,
} from "../helpers/d1-baseline.ts";
import { buildTestGitHubWebhookRequest } from "../helpers/github-webhook.ts";
import {
  waitForRunWorkflowStatus,
  waitForTerminalRun,
  withDetachedRpcResults,
} from "../helpers/rpc-results.ts";

type ManagerRpc = Pick<
  SigveloNaniteManager,
  "getSnapshot" | "inspectNaniteDebug" | "registerNanite"
>;

async function getInstallationManager(githubInstallationId: number): Promise<ManagerRpc> {
  return withDetachedRpcResults(
    (await getAgentByName<Env, SigveloNaniteManager>(
      env.SigveloNaniteManager,
      buildNaniteManagerKey({ githubAppId: TEST_GITHUB_APP_ID, githubInstallationId }),
    )) as unknown as ManagerRpc,
  );
}

test("signed GitHub webhook starts a Workflow-backed Nanite run to a durable outcome", async () => {
  await ensureD1BaselineSchema(env.DB);
  await saveTestGitHubApp(env.DB);

  const githubInstallationId = Math.floor(Math.random() * 1_000_000) + 1;
  const manager = await getInstallationManager(githubInstallationId);
  const naniteId = "workflow-webhook-docs-syncer";

  await manager.registerNanite({
    manifest: {
      id: naniteId,
      name: "Workflow webhook docs syncer",
      description: "Proves signed webhook dispatch reaches a Workflow-backed Nanite run.",
      model: "deepseek/deepseek-v4-pro",
      eventSource: {
        type: "github",
        events: ["push"],
      },
      triggerSource: `
import { defineGitHubTrigger } from "@sigvelo/nanite-trigger";

export default defineGitHubTrigger({
  event: "push",
  async handle(event, ctx) {
    if (event.payload.repository.full_name !== "WebMCP-org/npm-packages") {
      return ctx.noop("Different repository.");
    }

    const changed = event.payload.commits?.flatMap((commit) => [
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? []),
    ]) ?? [];
    const files = changed.filter((file) => file.startsWith("packages/react-webmcp/"));

    if (files.length === 0) {
      return ctx.noop("No React WebMCP package files changed.");
    }

    return ctx.dispatchSelf({
      reason: "React WebMCP package changed",
      files,
    });
  },
});
`,
      permissions: {},
    },
  });

  const deliveryId = `e2e-workflow-${crypto.randomUUID()}`;
  const event = buildGitHubTriggerFixture({
    fixture: "push",
    deliveryId,
    installationId: githubInstallationId,
    overrides: {
      repository: {
        full_name: "WebMCP-org/npm-packages",
        name: "npm-packages",
        owner: { login: "WebMCP-org" },
      },
      ref: "refs/heads/main",
      commits: [
        {
          id: "test000000000001",
          added: [],
          modified: ["packages/react-webmcp/README.md"],
          removed: [],
        },
      ],
    },
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    await buildTestGitHubWebhookRequest({
      body: JSON.stringify(event.payload),
      delivery: deliveryId,
      event: "push",
      origin: "https://sigvelo-agent-tests.example.workers.dev",
    }),
    env,
    ctx,
  );

  expect(response.status).toBe(200);
  await expect(response.text()).resolves.toBe("ok");
  await waitOnExecutionContext(ctx);

  const terminalRun = await waitForTerminalRun(manager, { naniteId });
  expect(terminalRun).toMatchObject({
    naniteId,
    status: "complete",
    summary: "Docs sync completed through the mocked provider layer.",
    outputUrl: "https://example.com/runs/docs-syncer",
    trigger: {
      type: "github",
      input: {
        reason: "React WebMCP package changed",
        files: ["packages/react-webmcp/README.md"],
      },
      event: {
        id: deliveryId,
        name: "push",
      },
    },
    agentFeedback: {
      severity: "info",
      message: "The trigger reached the Nanite model with usable runtime context.",
    },
  });

  const workflow = await waitForRunWorkflowStatus(manager, { runId: terminalRun.runId });
  expect(workflow).toMatchObject({
    runId: terminalRun.runId,
    workflow: {
      workflowId: terminalRun.runId,
      workflowName: "NANITE_RUN_WORKFLOW",
      status: "complete",
      metadata: {
        naniteId,
        triggerType: "github",
      },
    },
  });
});
