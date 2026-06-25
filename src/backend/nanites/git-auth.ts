import type { ToolProvider } from "@cloudflare/codemode";
import { gitTools, type Git } from "@cloudflare/shell/git";

type LazyGitAuthCommand = "clone" | "fetch" | "pull" | "push";

const lazyGitAuthCommandNames: ReadonlySet<LazyGitAuthCommand> = new Set([
  "clone",
  "fetch",
  "pull",
  "push",
]);
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
  execute: (args?: unknown) => Promise<unknown>;
};

type GitCloneToolOptions = Parameters<Git["clone"]>[0];
type GitFetchToolOptions = NonNullable<Parameters<Git["fetch"]>[0]>;
type GitPullToolOptions = NonNullable<Parameters<Git["pull"]>[0]>;
type GitPushToolOptions = NonNullable<Parameters<Git["push"]>[0]>;
type GitAuthFields = Pick<GitCloneToolOptions, "token" | "username" | "password">;
type LazyGitToolOptions =
  | GitCloneToolOptions
  | GitFetchToolOptions
  | GitPullToolOptions
  | GitPushToolOptions;

function isLazyGitAuthCommand(command: string): command is LazyGitAuthCommand {
  return lazyGitAuthCommandNames.has(command as LazyGitAuthCommand);
}

function isExecutableGitTool(tool: unknown): tool is ExecutableGitTool {
  return (
    typeof tool === "object" &&
    tool !== null &&
    "execute" in tool &&
    typeof tool.execute === "function"
  );
}

function requireGitTool(provider: ToolProvider, name: "clone" | "pull"): ExecutableGitTool {
  const tool = provider.tools[name];
  if (!isExecutableGitTool(tool)) {
    throw new Error(`Git tool "${name}" is not available.`);
  }
  return tool;
}

function readGitDirectory(options: { readonly dir?: string }): string {
  return options.dir ?? "/";
}

function readGitRemote(options: { readonly remote?: string }): string {
  return options.remote ?? "origin";
}

function readGitToolOptions(command: LazyGitAuthCommand, rawOptions: unknown): LazyGitToolOptions {
  const normalizedOptions = normalizeGitOptions(rawOptions);
  switch (command) {
    case "clone":
      return (normalizedOptions ?? {}) as GitCloneToolOptions;
    case "fetch":
      return (normalizedOptions ?? {}) as GitFetchToolOptions;
    case "pull":
      return (normalizedOptions ?? {}) as GitPullToolOptions;
    case "push":
      return (normalizedOptions ?? {}) as GitPushToolOptions;
  }
}

function stripGitCredentials<T extends GitAuthFields>(options: T): Omit<T, keyof GitAuthFields> {
  const { token: _token, username: _username, password: _password, ...rest } = options;
  return rest;
}

function normalizeGitOptions(rawOptions: unknown): unknown {
  if (!rawOptions || typeof rawOptions !== "object" || Array.isArray(rawOptions)) {
    return rawOptions;
  }

  const options = rawOptions as Record<string, unknown>;
  if (typeof options.dir === "string" || typeof options.cwd !== "string") {
    return rawOptions;
  }

  const { cwd, ...rest } = options;
  return { ...rest, dir: cwd };
}

type LazyGitAuthWrapOptions = {
  resolveAuth: (input: {
    command: LazyGitAuthCommand;
    repository: string;
  }) => Promise<LazyGitAuthCredentials | null>;
  resolveRepository(input: {
    command: LazyGitAuthCommand;
    options: LazyGitToolOptions;
  }): Promise<string | null>;
  isAuthRejection: (error: unknown) => boolean;
};

async function executeWithLazyAuth(input: {
  command: LazyGitAuthCommand;
  gitTool: ExecutableGitTool;
  toolOptions: LazyGitToolOptions;
  options: LazyGitAuthWrapOptions;
}): Promise<unknown> {
  const repository = await input.options.resolveRepository({
    command: input.command,
    options: input.toolOptions,
  });
  const auth = repository
    ? await input.options.resolveAuth({ command: input.command, repository })
    : null;
  if (repository && !auth) {
    throw new Error(`GitHub repository "${repository}" is outside this Nanite's git scope.`);
  }

  const unauthenticatedToolOptions = stripGitCredentials(input.toolOptions);
  const toolOptions = auth
    ? { ...unauthenticatedToolOptions, ...auth }
    : unauthenticatedToolOptions;

  try {
    return await input.gitTool.execute(toolOptions);
  } catch (error) {
    if (
      auth &&
      lazyGitAuthRetryWithoutAuthCommandNames.has(input.command) &&
      input.options.isAuthRejection(error)
    ) {
      return input.gitTool.execute(unauthenticatedToolOptions);
    }
    throw error;
  }
}

function wrapGitToolProviderWithLazyAuth(
  provider: ToolProvider,
  options: LazyGitAuthWrapOptions,
): ToolProvider {
  const wrappedTools: Record<string, ExecutableGitTool> = {};
  for (const [command, gitTool] of Object.entries(provider.tools)) {
    if (!isExecutableGitTool(gitTool)) {
      throw new Error(`Git tool "${command}" is not executable.`);
    }

    wrappedTools[command] = {
      ...gitTool,
      execute: async (rawOptions?: unknown) => {
        const normalizedOptions = normalizeGitOptions(rawOptions);
        if (!isLazyGitAuthCommand(command)) {
          return gitTool.execute(normalizedOptions);
        }

        return executeWithLazyAuth({
          command,
          gitTool,
          toolOptions: readGitToolOptions(command, normalizedOptions),
          options,
        });
      },
    };
  }

  return {
    ...provider,
    tools: wrappedTools,
  };
}

const gitHubHttpsRepoPattern =
  /^https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i;
const gitHubSshRepoPattern =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i;
const gitHubRepositoryComponentPattern = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
const gitHubRepositoryFullNamePattern =
  /^(?!\.{1,2}\/)(?!.*\/\.{1,2}$)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_INSTALLATION_GIT_USERNAME = "x-access-token";

function normalizeGitHubRepositoryFullName(owner: string, repo: string): string | null {
  if (
    !gitHubRepositoryComponentPattern.test(owner) ||
    !gitHubRepositoryComponentPattern.test(repo)
  ) {
    return null;
  }
  return `${owner}/${repo}`;
}

function parseGitHubRepositoryFromGitUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  const trimmed = url.trim();
  const match = trimmed.match(gitHubHttpsRepoPattern) ?? trimmed.match(gitHubSshRepoPattern);
  const owner = match?.groups?.owner;
  const repo = match?.groups?.repo;
  return owner && repo ? normalizeGitHubRepositoryFullName(owner, repo) : null;
}

export function gitHubRepositoryFromGitConfig(input: {
  config: string | null;
  remote: string;
}): string | null {
  if (!input.config) {
    return null;
  }

  const sectionPattern = new RegExp(
    `^\\s*\\[remote\\s+["']${input.remote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\]\\s*$`,
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

  const repository = input.repository.toLowerCase();
  return input.repositories.some((repo) => repo.trim().toLowerCase() === repository);
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
    resolveRepository: (input) => resolveGitCommandRepository({ workspace, ...input }),
    resolveAuth: async ({ repository }) => {
      const repositories = await options.getAllowedRepositories();
      if (!isAllowedGitHubRepository({ repository, repositories })) {
        return null;
      }

      const token = await options.issueToken({ repository });
      // GitHub App installation tokens authenticate git over HTTPS as x-access-token:<token>.
      return token ? { username: GITHUB_INSTALLATION_GIT_USERNAME, password: token } : null;
    },
  });
}

export function gitCheckoutTools(provider: ToolProvider) {
  return {
    clone: requireGitTool(provider, "clone"),
    pull: requireGitTool(provider, "pull"),
  };
}

export function githubRepositoryCheckoutDir(repository: string): string {
  const trimmed = repository.trim();
  if (!gitHubRepositoryFullNamePattern.test(trimmed)) {
    throw new Error(`Invalid GitHub repository full name: ${repository}`);
  }
  return `/repos/${trimmed}`;
}

async function resolveGitCommandRepository({
  workspace,
  command,
  options,
}: {
  workspace: Parameters<typeof gitTools>[0];
  command: LazyGitAuthCommand;
  options: LazyGitToolOptions;
}): Promise<string | null> {
  if (command === "clone") {
    return parseGitHubRepositoryFromGitUrl((options as GitCloneToolOptions).url);
  }

  const gitOptions = options as GitFetchToolOptions | GitPullToolOptions | GitPushToolOptions;
  const configPath = `${readGitDirectory(gitOptions).replace(/\/+$/, "") || ""}/.git/config`;
  const config = await workspace.readFile(configPath);
  return gitHubRepositoryFromGitConfig({
    config,
    remote: readGitRemote(gitOptions),
  });
}
