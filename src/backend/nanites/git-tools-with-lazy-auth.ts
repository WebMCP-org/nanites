import type { ToolProvider } from "@cloudflare/codemode";

const lazyGitAuthCommandNames = new Set(["clone", "fetch", "pull", "push"] as const);

type LazyGitAuthCommand =
  typeof lazyGitAuthCommandNames extends Set<infer Command> ? Command : never;

const lazyGitAuthRetryWithoutAuthCommandNames: ReadonlySet<LazyGitAuthCommand> = new Set([
  "clone",
  "fetch",
  "pull",
]);

type LazyGitAuthCredentials =
  | {
      token: string;
    }
  | {
      username: string;
      password?: string;
    };

type ExecutableGitTool = {
  description?: string;
  execute: (...args: unknown[]) => Promise<unknown>;
};

function isExplicitOptions(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasExplicitAuth(options: Record<string, unknown>): boolean {
  return "token" in options || "username" in options || "password" in options;
}

function isLazyGitAuthCommand(command: string): command is LazyGitAuthCommand {
  return lazyGitAuthCommandNames.has(command as LazyGitAuthCommand);
}

async function resolveOptionsWithLazyAuth(input: {
  command: LazyGitAuthCommand;
  options: Record<string, unknown>;
  resolveAuth: (input: {
    command: LazyGitAuthCommand;
    options: Record<string, unknown>;
  }) => Promise<LazyGitAuthCredentials | null>;
}): Promise<Record<string, unknown>> {
  if (hasExplicitAuth(input.options)) {
    return input.options;
  }

  const auth = await input.resolveAuth({
    command: input.command,
    options: input.options,
  });
  return auth ? { ...input.options, ...auth } : input.options;
}

export function wrapGitToolProviderWithLazyAuth(
  provider: ToolProvider,
  options: {
    resolveAuth: (input: {
      command: LazyGitAuthCommand;
      options: Record<string, unknown>;
    }) => Promise<LazyGitAuthCredentials | null>;
    isAuthRejection: (error: unknown) => boolean;
  },
): ToolProvider {
  const tools = provider.tools as Record<string, ExecutableGitTool>;

  return {
    ...provider,
    tools: Object.fromEntries(
      Object.entries(tools).map(([command, gitTool]) => [
        command,
        {
          ...gitTool,
          execute: async (...args: unknown[]) => {
            if (!isLazyGitAuthCommand(command)) {
              return gitTool.execute(...args);
            }

            const [firstArg, ...restArgs] = args;
            const explicitOptions = isExplicitOptions(firstArg) ? firstArg : {};
            const optionsWithAuth = await resolveOptionsWithLazyAuth({
              command,
              options: explicitOptions,
              resolveAuth: options.resolveAuth,
            });

            try {
              return await gitTool.execute(optionsWithAuth, ...restArgs);
            } catch (error) {
              if (
                lazyGitAuthRetryWithoutAuthCommandNames.has(command) &&
                optionsWithAuth !== explicitOptions &&
                options.isAuthRejection(error)
              ) {
                return gitTool.execute(explicitOptions, ...restArgs);
              }
              throw error;
            }
          },
        },
      ]),
    ),
  };
}
