import type { ToolProvider } from "@cloudflare/codemode";
import { gitTools } from "@cloudflare/shell/git";

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

function isTruthyForceOption(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function assertSafeGitCommandOptions(command: string, options: Record<string, unknown>): void {
  if (command !== "push") {
    return;
  }

  if (
    isTruthyForceOption(options.force) ||
    isTruthyForceOption(options.forceWithLease) ||
    isTruthyForceOption(options.force_with_lease)
  ) {
    throw new Error(
      "Force pushes are not allowed. Fetch and rebase or merge the remote branch, then push normally. If remote history truly must be rewritten, use ask_human — a human has to do it.",
    );
  }
}

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

type LazyGitAuthWrapOptions = {
  resolveAuth: (input: {
    command: LazyGitAuthCommand;
    options: Record<string, unknown>;
  }) => Promise<LazyGitAuthCredentials | null>;
  isAuthRejection: (error: unknown) => boolean;
};

async function executeWithLazyAuth(input: {
  command: LazyGitAuthCommand;
  gitTool: ExecutableGitTool;
  commandOptions: Record<string, unknown>;
  restArgs: unknown[];
  options: LazyGitAuthWrapOptions;
}): Promise<unknown> {
  const optionsWithAuth = await resolveOptionsWithLazyAuth({
    command: input.command,
    options: input.commandOptions,
    resolveAuth: input.options.resolveAuth,
  });

  try {
    return await input.gitTool.execute(optionsWithAuth, ...input.restArgs);
  } catch (error) {
    if (
      lazyGitAuthRetryWithoutAuthCommandNames.has(input.command) &&
      optionsWithAuth !== input.commandOptions &&
      input.options.isAuthRejection(error)
    ) {
      return input.gitTool.execute(input.commandOptions, ...input.restArgs);
    }
    throw error;
  }
}

export function wrapGitToolProviderWithLazyAuth(
  provider: ToolProvider,
  options: LazyGitAuthWrapOptions,
): ToolProvider {
  const tools = provider.tools as Record<string, ExecutableGitTool>;

  const wrappedTools: Record<string, ExecutableGitTool> = Object.fromEntries(
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
          assertSafeGitCommandOptions(command, explicitOptions);
          return executeWithLazyAuth({
            command,
            gitTool,
            commandOptions: explicitOptions,
            restArgs,
            options,
          });
        },
      },
    ]),
  );

  return {
    ...provider,
    types: removeForceFromPushTypes(provider.types),
    tools: wrappedTools,
  };
}

/**
 * The upstream git type block advertises `force?: boolean` on push, but the
 * wrapper rejects it. Keep the model-facing types honest.
 */
function removeForceFromPushTypes(types: string | undefined): string | undefined {
  return types?.replace(/^(\s*push\(.*)$/m, (pushLine) =>
    pushLine.replace(" force?: boolean;", ""),
  );
}

const gitHubHttpsRepoPattern =
  /^https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i;
const gitHubSshRepoPattern =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i;
const GITHUB_INSTALLATION_GIT_USERNAME = "x-access-token";

function parseGitHubRepositoryFromGitUrl(url: unknown): string | null {
  if (typeof url !== "string") {
    return null;
  }

  const trimmed = url.trim();
  const match = trimmed.match(gitHubHttpsRepoPattern) ?? trimmed.match(gitHubSshRepoPattern);
  const owner = match?.groups?.owner;
  const repo = match?.groups?.repo;
  return owner && repo ? `${owner}/${repo}` : null;
}

function parseGitHubRepositoryFromGitConfig(input: {
  config: string | null;
  remote?: unknown;
}): string | null {
  if (!input.config) {
    return null;
  }

  const remote = typeof input.remote === "string" && input.remote.trim() ? input.remote : "origin";
  const sectionPattern = new RegExp(
    `^\\s*\\[remote\\s+["']${remote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\]\\s*$`,
    "i",
  );
  let inRemoteSection = false;
  for (const line of input.config.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      inRemoteSection = sectionPattern.test(line);
      continue;
    }
    if (!inRemoteSection) {
      continue;
    }

    const match = line.match(/^\s*url\s*=\s*(?<url>\S+)\s*$/i);
    if (match?.groups?.url) {
      return parseGitHubRepositoryFromGitUrl(match.groups.url);
    }
  }

  return null;
}

function isAllowedGitHubRepository(input: {
  repository: string | null;
  repositories: readonly string[];
}): boolean {
  if (!input.repository) {
    return false;
  }

  const allowedRepositories = new Set(
    input.repositories.map((repo) => repo.trim().toLowerCase()).filter(Boolean),
  );
  return allowedRepositories.has(input.repository.toLowerCase());
}

function shouldInjectGitHubInstallationToken(input: {
  options: Record<string, unknown>;
  repository: string | null;
  repositories: readonly string[];
}): boolean {
  if ("token" in input.options || "username" in input.options || "password" in input.options) {
    return false;
  }

  return isAllowedGitHubRepository({
    repository: input.repository,
    repositories: input.repositories,
  });
}

function createGitHubInstallationGitCredentials(token: string): {
  username: string;
  password: string;
} {
  // GitHub App installation tokens authenticate git over HTTPS as x-access-token:<token>.
  return {
    username: GITHUB_INSTALLATION_GIT_USERNAME,
    password: token,
  };
}

function isGitHubAuthRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:401|403)\b/.test(message) && /unauthori[sz]ed|forbidden/i.test(message);
}

type GitHubInstallationGitToolsOptions = {
  getAllowedRepositories: () => Promise<readonly string[]> | readonly string[];
  issueToken: (input: { repository: string }) => Promise<string | null>;
};

export function gitToolsWithGitHubInstallationAuth(
  workspace: Parameters<typeof gitTools>[0],
  options: GitHubInstallationGitToolsOptions,
): ToolProvider {
  return wrapGitToolProviderWithLazyAuth(gitTools(workspace), {
    isAuthRejection: isGitHubAuthRejection,
    resolveAuth: async ({ command, options: gitOptions }) => {
      const repository = await resolveGitCommandRepository({
        workspace,
        command,
        options: gitOptions,
      });
      if (!repository) {
        return null;
      }

      const repositories = await options.getAllowedRepositories();
      if (
        !shouldInjectGitHubInstallationToken({
          options: gitOptions,
          repository,
          repositories,
        })
      ) {
        return null;
      }

      const token = await options.issueToken({ repository });
      return token ? createGitHubInstallationGitCredentials(token) : null;
    },
  });
}

async function resolveGitCommandRepository({
  workspace,
  command,
  options,
}: {
  workspace: Parameters<typeof gitTools>[0];
  command: string;
  options: Record<string, unknown>;
}): Promise<string | null> {
  if (command === "clone") {
    return parseGitHubRepositoryFromGitUrl(options.url);
  }

  const dir = typeof options.dir === "string" && options.dir.trim() ? options.dir.trim() : "/";
  const configPath = `${dir.replace(/\/+$/, "") || ""}/.git/config`;
  const config = await workspace.readFile(configPath);
  return parseGitHubRepositoryFromGitConfig({
    config,
    remote: options.remote,
  });
}
