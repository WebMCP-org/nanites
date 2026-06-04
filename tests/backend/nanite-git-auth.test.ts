import type { ToolProvider } from "@cloudflare/codemode";
import { wrapGitToolProviderWithLazyAuth } from "#/backend/nanites/git-auth.ts";

function createFakeGitProvider(input?: {
  cloneImplementation?: (...args: unknown[]) => Promise<unknown>;
}): ToolProvider {
  return {
    name: "git",
    tools: {
      clone: {
        description: "git.clone",
        execute:
          input?.cloneImplementation ??
          (async (options: unknown) => ({
            cloned: true,
            options,
          })),
      },
      status: {
        description: "git.status",
        execute: async (options: unknown) => ({
          status: true,
          options,
        }),
      },
    },
  };
}

type ExecutableTool = {
  execute: (...args: unknown[]) => Promise<unknown>;
};

test("lazy git auth injects credentials for auth-capable commands", async () => {
  let receivedInput: unknown = null;
  const provider = createFakeGitProvider({
    cloneImplementation: async (options) => {
      receivedInput = options;
      return { ok: true };
    },
  });

  const wrapped = wrapGitToolProviderWithLazyAuth(provider, {
    isAuthRejection: () => false,
    resolveAuth: async ({ command, options }) => {
      expect(command).toBe("clone");
      expect(options).toEqual({ url: "https://github.com/WebMCP-org/nanites.git" });
      return { token: "fresh-token" };
    },
  });

  await expect(
    (wrapped.tools.clone as ExecutableTool).execute({
      url: "https://github.com/WebMCP-org/nanites.git",
    }),
  ).resolves.toEqual({ ok: true });

  expect(receivedInput).toEqual({
    url: "https://github.com/WebMCP-org/nanites.git",
    token: "fresh-token",
  });
});

test("lazy git auth preserves explicit model-provided auth", async () => {
  let resolverCalled = false;
  let receivedInput: unknown = null;
  const provider = createFakeGitProvider({
    cloneImplementation: async (options) => {
      receivedInput = options;
      return { ok: true };
    },
  });

  const wrapped = wrapGitToolProviderWithLazyAuth(provider, {
    isAuthRejection: () => false,
    resolveAuth: async () => {
      resolverCalled = true;
      return { token: "fresh-token" };
    },
  });

  await expect(
    (wrapped.tools.clone as ExecutableTool).execute({
      url: "https://github.com/WebMCP-org/nanites.git",
      token: "explicit-token",
    }),
  ).resolves.toEqual({ ok: true });

  expect(resolverCalled).toBe(false);
  expect(receivedInput).toEqual({
    url: "https://github.com/WebMCP-org/nanites.git",
    token: "explicit-token",
  });
});

test("lazy git auth retries read operations without injected credentials after auth rejection", async () => {
  const calls: unknown[] = [];
  const provider = createFakeGitProvider({
    cloneImplementation: async (options) => {
      calls.push(options);
      if (calls.length === 1) {
        throw new Error("HTTP Error: 401 Unauthorized");
      }
      return { ok: true };
    },
  });

  const wrapped = wrapGitToolProviderWithLazyAuth(provider, {
    isAuthRejection: (error) =>
      error instanceof Error && error.message.includes("401 Unauthorized"),
    resolveAuth: async () => ({ token: "fresh-token" }),
  });

  await expect(
    (wrapped.tools.clone as ExecutableTool).execute({
      url: "https://github.com/WebMCP-org/nanites.git",
    }),
  ).resolves.toEqual({ ok: true });

  expect(calls).toEqual([
    {
      url: "https://github.com/WebMCP-org/nanites.git",
      token: "fresh-token",
    },
    {
      url: "https://github.com/WebMCP-org/nanites.git",
    },
  ]);
});

test("lazy git auth does not resolve credentials for non-auth commands", async () => {
  let resolverCalled = false;
  const provider = createFakeGitProvider();
  const wrapped = wrapGitToolProviderWithLazyAuth(provider, {
    isAuthRejection: () => false,
    resolveAuth: async () => {
      resolverCalled = true;
      return { token: "fresh-token" };
    },
  });

  await expect((wrapped.tools.status as ExecutableTool).execute({})).resolves.toEqual({
    status: true,
    options: {},
  });
  expect(resolverCalled).toBe(false);
});
