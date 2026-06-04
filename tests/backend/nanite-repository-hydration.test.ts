import type { NaniteManifest, NaniteTriggerEvent } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  buildDefaultRepositoryHydrationPlans,
  hydrateRepositoryIntoWorkspace,
  type RepositoryHydrationWorkspace,
} from "#/backend/nanites/repository-hydration.ts";
import type { TriggerDispatchInput } from "#/backend/nanites/triggers.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";

function encodeBase64(value: string): string {
  return btoa(value);
}

const docsSyncManifest = {
  id: "docs-sync-codemode",
  name: "codemode Docs Syncer",
  description: "Keeps codemode docs aligned.",
  eventSource: {
    type: "github",
    events: ["push"],
    repositories: ["WebMCP-org/npm-packages"],
    branches: ["main"],
  },
  triggerSource: "export default { async handle(_event, ctx) { return ctx.noop('test'); } };",
  permissions: {
    github: {
      repositories: ["WebMCP-org/npm-packages", "WebMCP-org/docs"],
      appPermissions: {
        contents: "write",
        pull_requests: "write",
      },
    },
  },
} satisfies NaniteManifest;

function createPushTrigger(input?: TriggerDispatchInput): NaniteTriggerEvent {
  return {
    type: "github",
    event: {
      id: "push-event-1",
      name: "push",
      payload: {
        repository: {
          full_name: "WebMCP-org/npm-packages",
        },
        ref: "refs/heads/main",
        after: "abc123",
        commits: [
          {
            added: [],
            modified: ["packages/codemode/src/index.ts"],
            removed: [],
          },
        ],
      },
    },
    ...(input ? { input } : {}),
  };
}

test("default hydration plan is inferred from a GitHub push dispatch without manifest config", () => {
  expect(
    buildDefaultRepositoryHydrationPlans({
      manifest: docsSyncManifest,
      trigger: createPushTrigger({
        packageName: "codemode",
        changedFiles: ["packages/codemode/src/index.ts"],
      }),
    }),
  ).toEqual([
    {
      repository: "WebMCP-org/npm-packages",
      ref: "abc123",
      destination: "/repos/npm-packages",
      paths: [
        "AGENTS.md",
        "CLAUDE.md",
        "package.json",
        "packages/codemode/package.json",
        "packages/codemode/src/index.ts",
        "README.md",
      ],
      reason: "Prepare WebMCP-org/npm-packages@abc123",
    },
  ]);
});

test("default hydration plan is skipped when contents permission is not granted", () => {
  expect(
    buildDefaultRepositoryHydrationPlans({
      manifest: {
        ...docsSyncManifest,
        permissions: {
          github: {
            repositories: ["WebMCP-org/npm-packages"],
            appPermissions: {
              pull_requests: "write",
            },
          },
        },
      },
      trigger: createPushTrigger({
        packageName: "codemode",
      }),
    }),
  ).toEqual([]);
});

test("repository hydration writes available content paths and metadata into workspace", async () => {
  const restoreFetch = mockGitHubApi([
    {
      path: "/repos/WebMCP-org/npm-packages/contents/AGENTS.md?ref=abc123",
      response: () =>
        Response.json({
          type: "file",
          sha: "sha-agents",
          content: encodeBase64("Use repo instructions."),
        }),
    },
    {
      path: "/repos/WebMCP-org/npm-packages/contents/packages%2Fcodemode%2Fsrc%2Findex.ts?ref=abc123",
      response: () =>
        Response.json({
          type: "file",
          sha: "sha-source",
          content: encodeBase64("export const ok = true;"),
        }),
    },
    {
      path: "/repos/WebMCP-org/npm-packages/contents/packages%2Fcodemode%2Fpackage.json?ref=abc123",
      response: () => Response.json({ message: "Not Found" }, { status: 404 }),
    },
  ]);
  const writtenBytes = new Map<string, Uint8Array>();
  const writtenText = new Map<string, string>();
  const workspace: RepositoryHydrationWorkspace = {
    writeFile: async (path, content) => {
      writtenText.set(path, content);
    },
    writeFileBytes: async (path, content) => {
      writtenBytes.set(path, content);
    },
  };

  try {
    const result = await hydrateRepositoryIntoWorkspace({
      workspace,
      token: "github-token",
      plan: {
        repository: "WebMCP-org/npm-packages",
        ref: "abc123",
        destination: "/repos/npm-packages",
        paths: ["AGENTS.md", "packages/codemode/package.json", "packages/codemode/src/index.ts"],
        reason: "Prepare codemode package.",
      },
    });

    expect([...writtenBytes.keys()].sort()).toEqual([
      "/repos/npm-packages/AGENTS.md",
      "/repos/npm-packages/packages/codemode/src/index.ts",
    ]);
    expect(new TextDecoder().decode(writtenBytes.get("/repos/npm-packages/AGENTS.md"))).toBe(
      "Use repo instructions.",
    );
    expect(result).toMatchObject({
      repository: "WebMCP-org/npm-packages",
      ref: "abc123",
      writtenFiles: [{ path: "AGENTS.md" }, { path: "packages/codemode/src/index.ts" }],
      missingFiles: ["packages/codemode/package.json"],
    });
    expect(
      JSON.parse(writtenText.get("/.sigvelo/hydration/WebMCP-org__npm-packages.json")!),
    ).toMatchObject({
      repository: "WebMCP-org/npm-packages",
      ref: "abc123",
      missingFiles: ["packages/codemode/package.json"],
    });
  } finally {
    restoreFetch();
  }
});
