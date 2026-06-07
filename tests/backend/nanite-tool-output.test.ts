import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  applyNaniteToolOutputBudget,
  NaniteToolOutputArtifactStore,
  wrapToolSetForNaniteOutputBudget,
} from "#/backend/nanites/tool-output.ts";

type ExecutableTool = {
  execute: (input: unknown, options: unknown) => Promise<unknown>;
};

type StoredValue = {
  value: string;
  metadata: unknown;
};

function createFakeKvNamespace(): KVNamespace {
  const values = new Map<string, StoredValue>();
  return {
    put: async (key: string, value: string, options?: KVNamespacePutOptions) => {
      values.set(key, {
        value,
        metadata: options?.metadata,
      });
    },
    getWithMetadata: async (key: string) => {
      const stored = values.get(key);
      return {
        value: stored?.value ?? null,
        metadata: stored?.metadata ?? null,
        cacheStatus: null,
      };
    },
    list: async ({ prefix, limit }: KVNamespaceListOptions = {}) => {
      const keys = Array.from(values.entries())
        .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
        .slice(0, limit ?? 1_000)
        .map(([name, stored]) => ({
          name,
          metadata: stored.metadata,
        }));

      return {
        list_complete: true,
        keys,
        cacheStatus: null,
      };
    },
  } as unknown as KVNamespace;
}

test("Nanite tool output artifact store writes opaque TTL-backed artifacts", async () => {
  const store = new NaniteToolOutputArtifactStore({
    kv: createFakeKvNamespace(),
    managerName: "installation:1",
    naniteId: "docs-syncer",
    naniteName: "docs-syncer",
    runId: "run-1",
    ttlSeconds: 60,
  });

  const persisted = await store.persist({
    toolName: "execute",
    toolCallId: "call-1",
    content: "alpha\nneedle\nomega",
    extension: "txt",
  });

  expect(persisted.artifactId).toMatch(/^toolout_[a-f0-9]{32}$/);

  await expect(store.info(persisted.artifactId)).resolves.toMatchObject({
    artifactId: persisted.artifactId,
    runId: "run-1",
    toolName: "execute",
    toolCallId: "call-1",
    size: 18,
    contentType: "text/plain",
  });

  await expect(
    store.read({ artifactId: persisted.artifactId, offset: 6, maxChars: 6 }),
  ).resolves.toMatchObject({
    action: "read",
    content: "needle",
    offset: 6,
    returnedChars: 6,
    totalChars: 18,
    truncated: true,
  });

  await expect(
    store.read({ artifactId: persisted.artifactId, pattern: "needle" }),
  ).resolves.toMatchObject({
    action: "grep",
    matches: [{ line: 2, text: "needle" }],
  });

  await expect(store.read()).resolves.toMatchObject({
    action: "list",
    artifacts: [
      {
        artifactId: persisted.artifactId,
        runId: "run-1",
      },
    ],
  });
});

test("Nanite tool output budget preserves small outputs inline", async () => {
  const output = { ok: true, value: "small" };
  const artifactWrites: unknown[] = [];

  await expect(
    applyNaniteToolOutputBudget(output, {
      toolName: "small_tool",
      toolCallId: "call-1",
      options: {
        defaultMaxResponseChars: 1_000,
        persistArtifact: async (artifact) => {
          artifactWrites.push(artifact);
          return { artifactId: "toolout_unused" };
        },
      },
    }),
  ).resolves.toBe(output);

  expect(artifactWrites).toHaveLength(0);
});

test("Nanite tool output budget stores large outputs and returns a natural language continuation notice", async () => {
  const writes: Array<{ content: string; extension: "json" | "txt" }> = [];

  const output = await applyNaniteToolOutputBudget("a".repeat(120), {
    toolName: "execute",
    toolCallId: "call-2",
    requestedMaxResponseChars: 50,
    options: {
      minResponseChars: 1,
      persistArtifact: async ({ content, extension }) => {
        writes.push({ content, extension });
        return { artifactId: "toolout_large" };
      },
    },
  });

  expect(writes).toEqual([{ content: "a".repeat(120), extension: "txt" }]);
  expect(output).toEqual({ notice: expect.any(String) });
  const notice = (output as { notice: string }).notice;
  expect(notice).toContain("SigVelo saved the full tool result as a current-run artifact");
  expect(notice).toContain("toolout_large");
  expect(notice).toContain("120 characters");
  expect(notice).toContain("[SigVelo truncated");
});

test("Nanite tool output wrapper applies per-call maxResponseChars and strips SigVelo input", async () => {
  let receivedInput: unknown = null;
  const tools = {
    noisy: tool({
      description: "Return a large payload.",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async (input) => {
        receivedInput = input;
        return { data: "x".repeat(100) };
      },
    }),
  } satisfies ToolSet;

  const wrapped = wrapToolSetForNaniteOutputBudget(tools, {
    minResponseChars: 1,
    persistArtifact: async () => ({ artifactId: "toolout_noisy" }),
  });

  const result = await (wrapped.noisy as ExecutableTool).execute(
    { query: "logs", _sigvelo: { maxResponseChars: 50 } },
    { toolCallId: "call-3" },
  );

  expect(receivedInput).toEqual({ query: "logs" });
  expect(result).toEqual({ notice: expect.any(String) });
  const notice = (result as { notice: string }).notice;
  expect(notice).toContain("toolout_noisy");
  expect(notice).toContain("[SigVelo truncated");
});

test("Nanite tool output wrapper exposes maxResponseChars on eligible Zod object schemas", () => {
  const tools = {
    noisy: tool({
      description: "Return a large payload.",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async () => "ok",
    }),
  } satisfies ToolSet;

  const wrapped = wrapToolSetForNaniteOutputBudget(tools, {
    persistArtifact: async () => ({ artifactId: "toolout_unused" }),
  });

  const inputSchema = (wrapped.noisy as { inputSchema: z.ZodObject }).inputSchema;
  expect(
    inputSchema.safeParse({ query: "logs", _sigvelo: { maxResponseChars: 10_000 } }).success,
  ).toBe(true);
});

test("Nanite tool output wrapper can skip lifecycle tools", async () => {
  const tools = {
    complete: tool({
      description: "Complete.",
      inputSchema: z.object({
        summary: z.string(),
      }),
      execute: async (input) => input,
    }),
  } satisfies ToolSet;

  const wrapped = wrapToolSetForNaniteOutputBudget(tools, {
    excludedToolNames: ["complete"],
    persistArtifact: async () => {
      throw new Error("should not persist");
    },
  });

  await expect(
    (wrapped.complete as ExecutableTool).execute(
      { summary: "done", _sigvelo: { maxResponseChars: 1_000 } },
      { toolCallId: "call-4" },
    ),
  ).resolves.toEqual({ summary: "done", _sigvelo: { maxResponseChars: 1_000 } });
});
