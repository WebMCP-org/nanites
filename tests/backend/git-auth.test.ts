import { createExecutionContext } from "cloudflare:test";
import type { ToolProvider } from "@cloudflare/codemode";
import { gitTools } from "@cloudflare/shell/git";
import { wrapGitToolProviderWithLazyAuth } from "#/backend/nanites/git-auth.ts";
import { ToolProviderConnector } from "#/backend/nanites/tool-provider-connector.ts";

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
  };
}

function wrapFakeGitProvider(calls: RecordedCall[]): ToolProvider {
  return wrapGitToolProviderWithLazyAuth(createFakeGitProvider(calls), {
    resolveAuth: async () => ({ token: "test-token" }),
    isAuthRejection: () => false,
  });
}

function wrapRealGitProvider(): ToolProvider {
  // gitTools only wires up filesystem adapters at construction; the workspace
  // is never touched until a tool executes, so a stub is enough to read the
  // provider's model-facing types.
  const workspace = {} as Parameters<typeof gitTools>[0];
  return wrapGitToolProviderWithLazyAuth(gitTools(workspace), {
    resolveAuth: async () => null,
    isAuthRejection: () => false,
  });
}

test("git push rejects force flags", async () => {
  const calls: RecordedCall[] = [];
  const wrapped = wrapFakeGitProvider(calls);
  const tools = wrapped.tools as Record<
    string,
    { execute: (...args: unknown[]) => Promise<unknown> }
  >;

  await expect(tools.push?.execute({ force: true })).rejects.toThrow(
    /Force pushes are not allowed/,
  );
  await expect(tools.push?.execute({ forceWithLease: true })).rejects.toThrow(
    /Force pushes are not allowed/,
  );
  expect(calls).toEqual([]);
});

test("git push injects lazy auth into plain pushes", async () => {
  const calls: RecordedCall[] = [];
  const wrapped = wrapFakeGitProvider(calls);
  const tools = wrapped.tools as Record<
    string,
    { execute: (...args: unknown[]) => Promise<unknown> }
  >;

  await tools.push?.execute({ ref: "main" });
  expect(calls).toEqual([{ tool: "push", options: { ref: "main", token: "test-token" } }]);
});

test("wrapped git types drop the rejected force option from push", () => {
  const raw = gitTools({} as Parameters<typeof gitTools>[0]);
  // Drift guard: if upstream stops advertising force on push (or reformats the
  // line so the rewrite stops matching), this fails at the dep bump.
  expect(raw.types).toMatch(/^\s*push\(.* force\?: boolean;.*$/m);

  const wrapped = wrapRealGitProvider();
  expect(wrapped.types).toMatch(/^\s*push\(/m);
  expect(wrapped.types).not.toMatch(/^\s*push\(.*force\?: boolean.*$/m);
});

test("connector describe() surfaces the provider types as model-facing instructions", async () => {
  const connector = new ToolProviderConnector(
    createExecutionContext() as unknown as DurableObjectState,
    wrapRealGitProvider(),
  );

  const description = await connector.describe();
  expect(description.name).toBe("git");
  expect(Object.keys(description.descriptors)).toContain("push");
  // codemode renders codemode.search/describe from descriptors + instructions;
  // the hand-written types block is the only signature documentation we have.
  expect(description.instructions).toContain("declare const git");
  expect(description.instructions).not.toMatch(/^\s*push\(.*force\?: boolean.*$/m);
});
