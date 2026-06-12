import type { ToolProvider } from "@cloudflare/codemode";
import {
  hideAttachmentsFromGit,
  wrapGitToolProviderWithLazyAuth,
} from "#/backend/nanites/git-auth.ts";

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

test("git-facing workspace hides /attachments so evicted transcript media is never committed", async () => {
  const workspace = {
    label: "fake-workspace",
    readDir: async (path: string) => {
      if (path === "/" || path === "" || path === ".") {
        return [
          { name: "attachments", type: "dir" },
          { name: "src", type: "dir" },
          { name: "README.md", type: "file" },
        ];
      }
      if (path.replace(/\/+$/, "") === "/attachments") {
        return [{ name: "evicted", type: "dir" }];
      }
      return [];
    },
    readFile: async (path: string) => `content:${path}`,
  };

  const gitWorkspace = hideAttachmentsFromGit(
    workspace as unknown as Parameters<typeof hideAttachmentsFromGit>[0],
  ) as unknown as typeof workspace;

  expect((await gitWorkspace.readDir("/")).map((entry) => entry.name)).toEqual([
    "src",
    "README.md",
  ]);
  // Non-root listings and other methods pass through to the real workspace.
  expect((await gitWorkspace.readDir("/attachments")).map((entry) => entry.name)).toEqual([
    "evicted",
  ]);
  expect(await gitWorkspace.readFile("/src/index.ts")).toBe("content:/src/index.ts");
});
