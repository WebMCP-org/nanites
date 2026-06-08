import type { UIMessage } from "ai";
import {
  buildNaniteSystemPrompt,
  buildNaniteTaskContext,
  buildRunPrompt,
  inspectTranscript,
  messageHasLifecycleToolCall,
} from "#/backend/agents/SigveloNaniteAgent.ts";

const naniteModel = "deepseek/deepseek-v4-pro";
const naniteRunModel = {
  runtimePath: "workers_ai_gateway",
  effectiveModelId: "deepseek/deepseek-v4-pro",
  effectiveProvider: "deepseek",
  effectiveProviderLabel: "DeepSeek",
  effectiveModelName: "DeepSeek V4 Pro",
  effectiveGatewayId: "default",
  manifestVersionId: "version-1",
  resolvedAt: "2026-05-24T00:00:00.000Z",
} as const;

test("Nanite debug transcript caps oversized includeParts payloads", () => {
  const messages = [
    {
      id: "message-1",
      role: "assistant",
      parts: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          result: {
            files: [{ filename: "large.patch", patch: "x".repeat(20_000) }],
          },
        },
      ],
    },
  ] as unknown as UIMessage[];

  const output = inspectTranscript(messages, {
    includeParts: true,
    maxPartLength: 2_000,
  });

  const part = (output[0] as { parts: Array<{ sigveloDebug?: unknown; preview?: string }> })
    .parts[0];
  expect(part.sigveloDebug).toMatchObject({
    truncated: true,
    originalChars: expect.any(Number),
  });
  expect(part.preview?.length).toBeLessThan(2_200);
  expect(JSON.stringify(output).length).toBeLessThan(3_000);
});

test("Nanite debug transcript preserves compact includeParts payloads", () => {
  const message = {
    id: "message-1",
    role: "assistant",
    parts: [{ type: "text", text: "small" }],
  } as unknown as UIMessage;

  expect(inspectTranscript([message], { includeParts: true })).toEqual([message]);
});

test("Nanite lifecycle detection recognizes terminal tool calls", () => {
  const message = {
    id: "message-1",
    role: "assistant",
    parts: [
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "fail",
        input: { summary: "Repeated deterministic checkout failure." },
      },
    ],
  } as unknown as UIMessage;

  expect(messageHasLifecycleToolCall(message)).toBe(true);
});

test("Nanite lifecycle detection recognizes AI SDK tool part names", () => {
  const message = {
    id: "message-1",
    role: "assistant",
    parts: [
      {
        type: "tool-fail",
        toolCallId: "call-1",
        state: "input-available",
        input: { summary: "Repeated deterministic checkout failure." },
      },
    ],
  } as unknown as UIMessage;

  expect(messageHasLifecycleToolCall(message)).toBe(true);
});

test("Nanite lifecycle detection ignores non-lifecycle tool calls", () => {
  const message = {
    id: "message-1",
    role: "assistant",
    parts: [
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "execute",
        input: { code: "return 1" },
      },
    ],
  } as unknown as UIMessage;

  expect(messageHasLifecycleToolCall(message)).toBe(false);
});

test("Nanite run prompt does not require workspace hydration for API-only work", () => {
  const prompt = buildRunPrompt({
    managerName: "installation:122769206",
    nanite: {
      enabled: true,
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
      latestVersion: {
        versionId: "version-1",
        manifestHash: "hash-1",
        registeredAt: "2026-05-24T00:00:00.000Z",
      },
      manifest: {
        id: "sigvelo-commit-bot",
        name: "Commit bot",
        description: "Creates requested maintenance commits.",
        model: naniteModel,
        eventSource: { type: "manual" },
        permissions: {
          github: {
            repositories: ["WebMCP-org/nanites"],
            appPermissions: { contents: "write", pull_requests: "read" },
          },
        },
      },
    },
    run: {
      runId: "d08164f2-024a-4b6a-98fb-b8adb4be5ffd",
      naniteId: "sigvelo-commit-bot",
      model: naniteRunModel,
      triggerKey: "manual:empty-commit",
      trigger: {
        type: "manual",
        requestId: "request-1",
        actorId: null,
        message: "Use the GitHub API to create an empty commit.",
      },
      status: "running",
      summary: null,
      outputUrl: null,
      humanRequest: null,
      agentFeedback: null,
      dispatchError: null,
      versionId: "version-1",
      chatUrl: "https://app.sigvelo.com/nanites?naniteId=sigvelo-commit-bot",
      startedAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
      completedAt: null,
    },
  });

  expect(prompt).toContain("First classify the task's execution plane");
  expect(prompt).toContain("Do not hydrate or repair workspace git for API-only tasks.");
  expect(prompt).toContain("assume the Nanite may be misconfigured");
  expect(prompt).toContain(
    "Before committing or pushing, verify the current branch, upstream branch, remote default branch, and latest remote head",
  );
  expect(prompt).toContain("If a push is rejected, fetch the remote branch and reconcile");
  expect(prompt).toContain("Never force push.");
});

test("Nanite system prompt stays stable and delegates dynamic facts to task context", () => {
  const prompt = buildNaniteSystemPrompt();

  expect(prompt).toContain("Use nanite_task_context");
  expect(prompt).toContain("Use the smallest execution plane that can satisfy the run");
  expect(prompt).toContain("Finish exactly once with complete, no_change, fail, or ask_human.");
  expect(prompt).not.toContain("Full Nanite manifest JSON:");
  expect(prompt).not.toContain("ctx.dispatchSelf");
  expect(prompt).not.toContain("Before committing or pushing");
  expect(prompt).not.toContain("If a push is rejected");
});

test("Nanite task context includes full manifest config, trigger source, and active trigger", () => {
  const prompt = buildNaniteTaskContext({
    trigger: {
      type: "github",
      event: {
        id: "request-1",
        name: "push",
        payload: {
          repository: { full_name: "WebMCP-org/npm-packages" },
          ref: "refs/heads/main",
          sender: { login: "sigvelo-dev" },
        },
      },
      input: {
        repository: "WebMCP-org/npm-packages",
      },
    },
    manifest: {
      id: "docs-sync-react-webmcp",
      name: "React WebMCP docs syncer",
      description: "Keeps React WebMCP docs aligned with package changes.",
      model: naniteModel,
      eventSource: {
        type: "github",
        events: ["push"],
        repositories: ["WebMCP-org/npm-packages"],
        branches: ["main"],
      },
      triggerSource: `
export default {
  async handle(event, ctx) {
    return ctx.dispatchSelf({
      repository: event.payload.repository.full_name,
    });
  },
};
`,
      permissions: {
        github: {
          repositories: ["WebMCP-org/npm-packages", "WebMCP-org/docs"],
          appPermissions: {
            contents: "write",
            pull_requests: "write",
          },
        },
      },
    },
  });

  expect(prompt).toContain("Nanite task context");
  expect(prompt).toContain("Full Nanite manifest JSON:");
  expect(prompt).toContain('"triggerSource"');
  expect(prompt).toContain("ctx.dispatchSelf");
  expect(prompt).toContain("Repository scope from permissions.github.repositories");
  expect(prompt).toContain("GitHub app permissions from permissions.github.appPermissions");
  expect(prompt).toContain("- WebMCP-org/npm-packages");
  expect(prompt).toContain("- WebMCP-org/docs");
  expect(prompt).toContain("Use this manifest as the authority");
  expect(prompt).toContain("Active run trigger payload");
  expect(prompt).toContain('"repository": "WebMCP-org/npm-packages"');
  expect(prompt).toContain("Operate only inside the declared repository and permission scope.");
  expect(prompt).not.toContain("Before committing or pushing");
  expect(prompt).not.toContain("If a push is rejected");
});
