import type { ToolProvider } from "@cloudflare/codemode";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { wrapGitToolProviderWithLazyAuth } from "#/backend/nanites/git-auth.ts";
import { wrapToolSetForNaniteOutputBudget } from "#/backend/nanites/tool-output.ts";
import {
  addReasonParametersToToolProviderTypes,
  wrapToolProviderForNaniteCallReasons,
  wrapToolSetForNaniteCallReasons,
} from "#/backend/nanites/tool-reason.ts";

type ExecutableTool = {
  inputSchema?: z.ZodObject;
  execute: (...args: unknown[]) => Promise<unknown>;
  needsApproval?: (input: unknown, options: unknown) => Promise<unknown>;
  toModelOutput?: (event: Record<string, unknown>) => Promise<unknown>;
};

test("Nanite top-level tool reason wrapper requires reasoned args envelopes", async () => {
  let receivedInput: unknown = null;
  const tools = {
    read: tool({
      description: "Read a file.",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async (input) => {
        receivedInput = input;
        return { ok: true };
      },
    }),
  } satisfies ToolSet;

  const wrapped = wrapToolSetForNaniteCallReasons(tools);
  const readTool = wrapped.read as ExecutableTool;

  expect(readTool.inputSchema?.safeParse({ path: "/repo/README.md" }).success).toBe(false);
  expect(readTool.inputSchema?.safeParse({ args: { path: "/repo/README.md" } }).success).toBe(
    false,
  );
  expect(
    readTool.inputSchema?.safeParse({
      args: {
        path: "/repo/README.md",
      },
      reason: " ",
    }).success,
  ).toBe(false);
  expect(
    readTool.inputSchema?.safeParse({
      args: {
        path: "/repo/README.md",
      },
      reason: "Inspect repository instructions before editing.",
    }).success,
  ).toBe(true);

  await expect(
    readTool.execute(
      {
        args: {
          path: "/repo/README.md",
        },
        reason: "Inspect repository instructions before editing.",
      },
      { toolCallId: "call-1" },
    ),
  ).resolves.toEqual({ ok: true });
  expect(receivedInput).toEqual({ path: "/repo/README.md" });

  await expect(readTool.execute({ args: { path: "/repo/README.md" } }, {})).rejects.toThrow(
    /requires a non-empty reason/,
  );
  await expect(
    readTool.execute(
      {
        reason: "Inspect repository instructions before editing.",
      },
      {},
    ),
  ).rejects.toThrow(/requires args/);
});

test("Nanite top-level tool reason wrapper delegates callbacks with args only", async () => {
  let approvalInput: unknown = null;
  let modelOutputInput: unknown = null;
  const tools = {
    risky: {
      description: "Risky tool.",
      inputSchema: z.object({
        action: z.string(),
      }),
      needsApproval: async (input: unknown) => {
        approvalInput = input;
        return true;
      },
      toModelOutput: async (event: Record<string, unknown>) => {
        modelOutputInput = event.input;
        return { type: "json", value: { ok: true } };
      },
    },
  } as unknown as ToolSet;

  const wrapped = wrapToolSetForNaniteCallReasons(tools);
  const riskyTool = wrapped.risky as ExecutableTool;

  await expect(
    riskyTool.needsApproval?.(
      {
        args: {
          action: "delete",
        },
        reason: "Request approval before destructive work.",
      },
      {},
    ),
  ).resolves.toBe(true);
  await expect(
    riskyTool.toModelOutput?.({
      toolCallId: "call-2",
      input: {
        args: {
          action: "delete",
        },
        reason: "Render the approved result.",
      },
      output: { ok: true },
    }),
  ).resolves.toEqual({ type: "json", value: { ok: true } });

  expect(approvalInput).toEqual({ action: "delete" });
  expect(modelOutputInput).toEqual({ action: "delete" });
});

test("Nanite reason wrapper composes after output budgeting", async () => {
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

  const wrapped = wrapToolSetForNaniteCallReasons(
    wrapToolSetForNaniteOutputBudget(tools, {
      minResponseChars: 1,
      persistArtifact: async () => ({ artifactId: "toolout_reasoned" }),
    }),
  );

  const result = await (wrapped.noisy as ExecutableTool).execute(
    {
      args: {
        query: "logs",
        _sigvelo: { maxResponseChars: 50 },
      },
      reason: "Inspect logs while keeping the inline response bounded.",
    },
    { toolCallId: "call-3" },
  );

  expect(receivedInput).toEqual({ query: "logs" });
  expect(result).toEqual({ notice: expect.stringContaining("toolout_reasoned") });
});

test("Nanite reason wrapper fails fast for non-object top-level schemas", () => {
  const tools = {
    raw: tool({
      description: "Raw scalar.",
      inputSchema: z.string(),
      execute: async () => "ok",
    }),
  } satisfies ToolSet;

  expect(() => wrapToolSetForNaniteCallReasons(tools)).toThrow(/Zod object input schema/);
});

test("Nanite execute provider wrapper requires final reason arguments", async () => {
  let receivedInput: unknown = null;
  const provider = wrapToolProviderForNaniteCallReasons({
    tools: {
      search: {
        description: "Search logs.",
        inputSchema: z.object({
          query: z.string(),
        }),
        execute: async (input: unknown) => {
          receivedInput = input;
          return { ok: true };
        },
      },
    },
  } as ToolProvider);

  expect(provider.types).toContain("search: (input: SearchInput, reason: string)");
  await expect(
    (provider.tools as Record<string, ExecutableTool>).search.execute(
      { query: "needle" },
      "Find the relevant log line.",
    ),
  ).resolves.toEqual({ ok: true });
  expect(receivedInput).toEqual({ query: "needle" });

  await expect(
    (provider.tools as Record<string, ExecutableTool>).search.execute({ query: "needle" }),
  ).rejects.toThrow(/requires a final non-empty reason/);
});

test("Nanite execute provider wrapper preserves positional helper args", async () => {
  const provider = wrapToolProviderForNaniteCallReasons({
    name: "state",
    tools: {
      readFile: {
        description: "state.readFile",
        execute: async (...args: unknown[]) => args,
      },
    },
    types: "declare const state: {\n  readFile(path: string): Promise<string>;\n};",
  });

  expect(provider.types).toContain("readFile(path: string, reason: string)");
  await expect(
    (provider.tools as Record<string, ExecutableTool>).readFile.execute(
      "/repo/README.md",
      "Read repository instructions.",
    ),
  ).resolves.toEqual(["/repo/README.md"]);
});

test("Nanite execute provider type rewriting handles namespace functions", () => {
  expect(
    addReasonParametersToToolProviderTypes(
      "declare namespace artifact {\n  function read(args?: { artifactId?: string }): Promise<unknown>;\n}",
    ),
  ).toContain("function read(args?: { artifactId?: string }, reason: string)");
});

test("Nanite execute provider reason wrapper composes with lazy git auth", async () => {
  let receivedInput: unknown = null;
  const gitProvider = wrapGitToolProviderWithLazyAuth(
    {
      name: "git",
      tools: {
        clone: {
          description: "git.clone",
          execute: async (options: unknown) => {
            receivedInput = options;
            return { ok: true };
          },
        },
      },
    },
    {
      isAuthRejection: () => false,
      resolveAuth: async () => ({ token: "fresh-token" }),
    },
  );
  const reasonedProvider = wrapToolProviderForNaniteCallReasons(gitProvider);

  await expect(
    (reasonedProvider.tools as Record<string, ExecutableTool>).clone.execute(
      { url: "https://github.com/WebMCP-org/nanites.git" },
      "Clone the scoped repository into the Nanite workspace.",
    ),
  ).resolves.toEqual({ ok: true });
  expect(receivedInput).toEqual({
    url: "https://github.com/WebMCP-org/nanites.git",
    token: "fresh-token",
    depth: 1,
    singleBranch: true,
  });
});
