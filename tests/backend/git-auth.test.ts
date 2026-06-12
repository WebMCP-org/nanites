import type { ToolProvider } from "@cloudflare/codemode";
import { wrapGitToolProviderWithLazyAuth } from "#/backend/nanites/git-auth.ts";

type RecordedCall = { tool: string; options: Record<string, unknown> };

function createFakeGitProvider(calls: RecordedCall[]): ToolProvider {
  const record =
    (tool: string) =>
    async (...args: unknown[]) => {
      calls.push({ tool, options: (args[0] ?? {}) as Record<string, unknown> });
      return { ok: true };
    };
  return {
    name: "git",
    tools: {
      status: { description: "git status", execute: record("status") },
      push: { description: "git push", execute: record("push") },
    },
    types: [
      "declare const git: {",
      "  push(opts?: { remote?: string; ref?: string; force?: boolean; dir?: string }): Promise<{ ok: boolean; refs: Record<string, unknown> }>;",
      "};",
    ].join("\n"),
  };
}

function wrapFakeGitProvider(calls: RecordedCall[]): ToolProvider {
  return wrapGitToolProviderWithLazyAuth(createFakeGitProvider(calls), {
    resolveAuth: async () => ({ token: "test-token" }),
    isAuthRejection: () => false,
  });
}

test("plain git push rejects force flags and points at push_force", async () => {
  const calls: RecordedCall[] = [];
  const wrapped = wrapFakeGitProvider(calls);
  const tools = wrapped.tools as Record<
    string,
    { execute: (...args: unknown[]) => Promise<unknown> }
  >;

  await expect(tools.push?.execute({ force: true })).rejects.toThrow(/push_force/);
  expect(calls).toEqual([]);
});

test("push_force requires approval, forces the push, and injects lazy auth", async () => {
  const calls: RecordedCall[] = [];
  const wrapped = wrapFakeGitProvider(calls);
  const tools = wrapped.tools as Record<
    string,
    { requiresApproval?: boolean; execute: (...args: unknown[]) => Promise<unknown> }
  >;

  expect(tools.push_force?.requiresApproval).toBe(true);
  expect(tools.push?.requiresApproval).toBeUndefined();

  await tools.push_force?.execute({ ref: "main" });
  expect(calls).toEqual([
    { tool: "push", options: { ref: "main", force: true, token: "test-token" } },
  ]);
});

test("wrapped git types drop force from push and document push_force", () => {
  const wrapped = wrapFakeGitProvider([]);

  expect(wrapped.types).toContain(
    "push_force(opts?: { remote?: string; ref?: string; dir?: string })",
  );
  expect(wrapped.types).toContain("pauses for human approval");
  expect(wrapped.types).not.toContain(
    "push(opts?: { remote?: string; ref?: string; force?: boolean;",
  );
});
