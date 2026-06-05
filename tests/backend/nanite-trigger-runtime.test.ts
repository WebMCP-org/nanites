import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import {
  validateGeneratedTriggerSource,
  type GitHubPushFixtureOverrides,
} from "#/backend/nanites/triggers.ts";
import {
  shouldResyncNaniteDuringMaintenance,
  type SigveloNaniteManager,
} from "#/backend/agents/SigveloNaniteManager.ts";

function getManager() {
  return getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<SigveloNaniteManager>,
    `trigger-validation-${crypto.randomUUID()}`,
  );
}

function getInstallationManager() {
  return getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<SigveloNaniteManager>,
    `installation:${Math.floor(Math.random() * 1_000_000) + 1}`,
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

test("generated trigger validation accepts source that bundles and exports the runtime contract", async () => {
  const result = await validateGeneratedTriggerSource({
    loader: env.LOADER,
    cacheKey: `valid-trigger-${crypto.randomUUID()}`,
    event: null,
    sourceCode: `
export default {
  async handle(event, ctx) {
    if (event.name !== "push") {
      return ctx.noop("Not a push.");
    }

    return ctx.dispatchSelf({ repository: event.payload.repository.full_name });
  },
};
`,
  });

  expect(result).toEqual({ ok: true });
});

test("generated trigger validation accepts typed trigger facade source", async () => {
  const result = await validateGeneratedTriggerSource({
    loader: env.LOADER,
    cacheKey: `typed-trigger-${crypto.randomUUID()}`,
    event: null,
    sourceCode: `
import { defineGitHubTrigger } from "@sigvelo/nanite-trigger";

export default defineGitHubTrigger({
  event: "push",
  async handle(event, ctx) {
    const changed = event.payload.commits.flatMap((commit) => [
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? []),
    ]);

    return ctx.dispatchSelf({
      repository: event.payload.repository.full_name,
      after: event.payload.after,
      files: changed,
    });
  },
});
`,
  });

  expect(result).toEqual({ ok: true });
});

test("generated trigger validation skips Octokit payload semantic diagnostics", async () => {
  const result = await validateGeneratedTriggerSource({
    loader: env.LOADER,
    cacheKey: `typed-trigger-error-${crypto.randomUUID()}`,
    event: null,
    sourceCode: `
import { defineGitHubTrigger } from "@sigvelo/nanite-trigger";

export default defineGitHubTrigger({
  event: "push",
  async handle(event, ctx) {
    return ctx.dispatchSelf({
      pullRequestNumber: event.payload.pull_request.number,
    });
  },
});
`,
  });

  expect(result).toEqual({ ok: true });
});

test("generated trigger validation rejects source that does not export handle", async () => {
  const result = await validateGeneratedTriggerSource({
    loader: env.LOADER,
    cacheKey: `missing-handle-${crypto.randomUUID()}`,
    event: null,
    sourceCode: `export default { notHandle() { return null; } };`,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain("phase=response");
    expect(result.error).toContain("export default { handle(event, ctx) }");
  }
});

test("generated trigger validation rejects forbidden dynamic code before bundling", async () => {
  const result = await validateGeneratedTriggerSource({
    loader: env.LOADER,
    cacheKey: `dynamic-code-${crypto.randomUUID()}`,
    event: null,
    sourceCode: `
export default {
  async handle() {
    return eval("({ type: 'noop', reason: 'dynamic' })");
  },
};
`,
  });

  expect(result).toMatchObject({ ok: false });
  if (!result.ok) {
    expect(result.error).toContain("phase=static");
    expect(result.error).toContain("eval");
  }
});

test("maintenance resync predicate tolerates persisted nanites without event sources", () => {
  const staleNanite = {
    manifest: {
      id: "stale-missing-event-source",
      name: "Stale missing event source",
      description: "Persisted before eventSource was required.",
      permissions: {},
    },
    latestVersion: {
      versionId: "manifest-stale",
      manifestHash: "stale",
      registeredAt: "2026-01-01T00:00:00.000Z",
    },
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Parameters<typeof shouldResyncNaniteDuringMaintenance>[0];

  expect(() => shouldResyncNaniteDuringMaintenance(staleNanite)).not.toThrow();
  expect(shouldResyncNaniteDuringMaintenance(staleNanite)).toBe(true);
});

test("nanite registration stores generated triggers only after validation passes", async () => {
  const manager = await getManager();

  await manager.registerNanite({
    manifest: {
      id: "valid-generated-trigger",
      name: "Valid generated trigger",
      description: "Registers source that satisfies the trigger runtime contract.",
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

  await manager.registerNanite({
    manifest: {
      id: "package-docs-syncer",
      name: "Package docs syncer",
      description: "Keeps package docs aligned with package changes.",
      eventSource: {
        type: "github",
      },
      triggerSource: packageDocsTriggerSource,
      permissions: {},
    },
  });

  const output = await manager.testNaniteTrigger({
    naniteId: "package-docs-syncer",
    actorId: "github:1",
    requestId: crypto.randomUUID(),
    event: {
      fixture: "push",
      overrides: {
        repository: {
          full_name: "WebMCP-org/npm-packages",
          name: "npm-packages",
          owner: { login: "WebMCP-org" },
        },
        ref: "refs/heads/main",
      },
    },
    waitForTerminalOutcome: true,
    timeoutMs: 10_000,
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

  await manager.registerNanite({
    manifest: {
      id: "package-docs-syncer",
      name: "Package docs syncer",
      description: "Keeps package docs aligned with package changes.",
      eventSource: {
        type: "github",
      },
      triggerSource: packageDocsTriggerSource,
      permissions: {},
    },
  });

  const output = await manager.testNaniteTrigger({
    naniteId: "package-docs-syncer",
    actorId: "github:1",
    requestId: crypto.randomUUID(),
    event: {
      fixture: "push",
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
    },
    waitForTerminalOutcome: true,
    timeoutMs: 10_000,
  });

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
    naniteId: "package-docs-syncer",
    status: "complete",
  });
});

test("trigger tests apply dotted fixture override keys before generated filters run", async () => {
  const manager = await getInstallationManager();

  await manager.registerNanite({
    manifest: {
      id: "package-docs-syncer-dotted-overrides",
      name: "Package docs syncer dotted overrides",
      description: "Keeps package docs aligned with package changes.",
      eventSource: {
        type: "github",
      },
      triggerSource: repoFilteredPackageDocsTriggerSource,
      permissions: {},
    },
  });

  const output = await manager.testNaniteTrigger({
    naniteId: "package-docs-syncer-dotted-overrides",
    actorId: "github:1",
    requestId: crypto.randomUUID(),
    event: {
      fixture: "push",
      overrides: {
        "repository.full_name": "WebMCP-org/npm-packages",
        "repository.name": "npm-packages",
        "repository.owner.login": "WebMCP-org",
        ref: "refs/heads/main",
        commits: [
          {
            id: "test000000000001",
            added: [],
            modified: ["packages/react-webmcp/README.md"],
            removed: [],
          },
        ],
      } as unknown as GitHubPushFixtureOverrides,
    },
    waitForTerminalOutcome: true,
    timeoutMs: 10_000,
  });

  expect(output.ok).toBe(true);
  expect(output.event.payload.repository.full_name).toBe("WebMCP-org/npm-packages");
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
    naniteId: "package-docs-syncer-dotted-overrides",
    status: "complete",
  });
});
