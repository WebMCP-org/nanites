import type { UIMessage } from "ai";
import {
  buildRunPrompt,
  inspectTranscript,
  messageHasLifecycleToolCall,
} from "#/backend/nanites/agent.ts";

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
        trigger: { type: "manual" },
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
});
