import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { TEST_GITHUB_APP_ID } from "../helpers/d1-baseline.ts";
import { buildGitHubTriggerFixture } from "#/backend/nanites/triggers.ts";
import {
  isTerminalNaniteRunStatus,
  type NaniteRunRecord,
  type SigveloNaniteManager,
} from "#/backend/agents/SigveloNaniteManager.ts";
import { getGitHubWebhookRepositoryFullName } from "#/github.ts";

beforeAll(async () => {
  await env.DB.exec("CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY);");
});

function getManager() {
  return getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<SigveloNaniteManager>,
    `trigger-validation-${crypto.randomUUID()}`,
  );
}

async function getInstallationManager() {
  const githubInstallationId = Math.floor(Math.random() * 1_000_000) + 1;
  return getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<SigveloNaniteManager>,
    `app:${TEST_GITHUB_APP_ID}:installation:${githubInstallationId}`,
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

type InstallationManager = Awaited<ReturnType<typeof getInstallationManager>>;
type TriggerTestOutput = Awaited<ReturnType<InstallationManager["testNaniteTrigger"]>>;
const naniteModel = "deepseek/deepseek-v4-pro";

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

function npmPackagesRepositoryOverride() {
  return {
    full_name: "WebMCP-org/npm-packages",
    name: "npm-packages",
    owner: { login: "WebMCP-org" },
  };
}

function packageDocsChangedCommit() {
  return {
    id: "test000000000001",
    added: [],
    modified: ["packages/react-webmcp/README.md"],
    removed: [],
  };
}

function testPackageDocsTrigger(
  manager: InstallationManager,
  input: {
    naniteId: string;
    commits?: ReturnType<typeof packageDocsChangedCommit>[];
  },
) {
  return manager.testNaniteTrigger({
    naniteId: input.naniteId,
    actorId: "github:1",
    requestId: crypto.randomUUID(),
    event: {
      fixture: "push",
      overrides: {
        repository: npmPackagesRepositoryOverride(),
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
    commits: [packageDocsChangedCommit()],
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
        commits: [packageDocsChangedCommit()],
      },
    },
    waitForTerminalOutcome: true,
    timeoutMs: 10_000,
  });

  expect(output.ok).toBe(true);
  expect(getGitHubWebhookRepositoryFullName(output.event)).toBe("WebMCP-org/npm-packages");
  expectAcceptedTriggerRun(output, "package-docs-syncer-repository-overrides");
});

async function waitForTerminalRun(
  manager: InstallationManager,
  runId: string,
): Promise<NaniteRunRecord> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const run = (await manager.getSnapshot()).runs[runId];
    if (run && isTerminalNaniteRunStatus(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Run ${runId} did not reach a terminal status in time.`);
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
      repository: npmPackagesRepositoryOverride(),
      ref: "refs/heads/main",
      after: "test000000000002",
      commits: [packageDocsChangedCommit()],
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

  await waitForTerminalRun(manager, runId);

  const secondEvaluations = await manager.handleGitHubWebhook({ event });
  expect(secondEvaluations).toHaveLength(1);
  expect(secondEvaluations[0]?.skippedReason).toBeNull();
  expect(secondEvaluations[0]?.dispatches[0]?.created).toBe(false);
  expect(secondEvaluations[0]?.dispatches[0]?.run.runId).toBe(runId);
});
