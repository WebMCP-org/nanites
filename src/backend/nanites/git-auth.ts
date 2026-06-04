import type { ToolProvider } from "@cloudflare/codemode";
import { gitTools } from "@cloudflare/shell/git";

const lazyGitAuthCommandNames = new Set(["clone", "fetch", "pull", "push"] as const);
const SHALLOW_GIT_HISTORY_DEPTH = 1;
const GIT_PULL_DISABLED_MESSAGE =
  "git.pull is disabled in Nanite workspaces because @cloudflare/shell does not expose shallow pull options. Use git.fetch; clone and fetch are runtime-enforced with depth: 1.";

type LazyGitAuthCommand =
  typeof lazyGitAuthCommandNames extends Set<infer Command> ? Command : never;

const lazyGitAuthRetryWithoutAuthCommandNames: ReadonlySet<LazyGitAuthCommand> = new Set([
  "clone",
  "fetch",
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

function enforceShallowGitHistory(
  command: LazyGitAuthCommand,
  options: Record<string, unknown>,
): Record<string, unknown> {
  if (command === "clone") {
    return {
      ...options,
      depth: SHALLOW_GIT_HISTORY_DEPTH,
      singleBranch: true,
    };
  }

  if (command === "fetch") {
    return {
      ...options,
      depth: SHALLOW_GIT_HISTORY_DEPTH,
    };
  }

  if (command === "pull") {
    throw new Error(GIT_PULL_DISABLED_MESSAGE);
  }

  return options;
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
            const injectedAuth = optionsWithAuth !== explicitOptions;
            const enforcedOptions = enforceShallowGitHistory(command, optionsWithAuth);

            try {
              return await gitTool.execute(enforcedOptions, ...restArgs);
            } catch (error) {
              if (
                lazyGitAuthRetryWithoutAuthCommandNames.has(command) &&
                injectedAuth &&
                options.isAuthRejection(error)
              ) {
                return gitTool.execute(
                  enforceShallowGitHistory(command, explicitOptions),
                  ...restArgs,
                );
              }
              throw error;
            }
          },
        },
      ]),
    ),
  };
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
