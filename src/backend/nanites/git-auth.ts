import type { ToolProvider } from "@cloudflare/codemode";
import { gitTools, type Git } from "@cloudflare/shell/git";

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
  execute: (args?: unknown) => Promise<unknown>;
};

type ExecutableGitToolSet = {
  readonly [name: string]: ExecutableGitTool;
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

function hasGitCredentials(options: GitAuthFields): boolean {
  return Boolean(options.token || options.username || options.password);
}

function readGitDirectory(options: { readonly dir?: string }): string {
  return options.dir ?? "/";
}

function readGitRemote(options: { readonly remote?: string }): string {
  return options.remote ?? "origin";
}

function readGitToolOptions(command: LazyGitAuthCommand, rawOptions: unknown): LazyGitToolOptions {
  switch (command) {
    case "clone":
      return (rawOptions ?? {}) as GitCloneToolOptions;
    case "fetch":
      return (rawOptions ?? {}) as GitFetchToolOptions;
    case "pull":
      return (rawOptions ?? {}) as GitPullToolOptions;
    case "push":
      return (rawOptions ?? {}) as GitPushToolOptions;
  }
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
  const repository = hasGitCredentials(input.toolOptions)
    ? null
    : await input.options.resolveRepository({
        command: input.command,
        options: input.toolOptions,
      });
  const auth = repository
    ? await input.options.resolveAuth({ command: input.command, repository })
    : null;
  const toolOptions = auth ? { ...input.toolOptions, ...auth } : input.toolOptions;

  try {
    return await input.gitTool.execute(toolOptions);
  } catch (error) {
    if (
      auth &&
      lazyGitAuthRetryWithoutAuthCommandNames.has(input.command) &&
      input.options.isAuthRejection(error)
    ) {
      return input.gitTool.execute(input.toolOptions);
    }
    throw error;
  }
}

function wrapGitToolProviderWithLazyAuth(
  provider: ToolProvider,
  options: LazyGitAuthWrapOptions,
): ToolProvider {
  const tools = provider.tools as ExecutableGitToolSet;

  const wrappedTools: ExecutableGitToolSet = Object.fromEntries(
    Object.entries(tools).map(([command, gitTool]) => [
      command,
      {
        ...gitTool,
        execute: async (rawOptions?: unknown) => {
          if (!isLazyGitAuthCommand(command)) {
            return gitTool.execute(rawOptions);
          }

          return executeWithLazyAuth({
            command,
            gitTool,
            toolOptions: readGitToolOptions(command, rawOptions),
            options,
          });
        },
      },
    ]),
  );

  return {
    ...provider,
    tools: wrappedTools,
  };
}

const gitHubHttpsRepoPattern =
  /^https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i;
const gitHubSshRepoPattern =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i;
const GITHUB_INSTALLATION_GIT_USERNAME = "x-access-token";

function parseGitHubRepositoryFromGitUrl(url: string | null | undefined): string | null {
  if (!url) {
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

  const allowedRepositories = new Set(
    input.repositories.map((repo) => repo.trim().toLowerCase()).filter(Boolean),
  );
  return allowedRepositories.has(input.repository.toLowerCase());
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
  return parseGitHubRepositoryFromGitConfig({
    config,
    remote: readGitRemote(gitOptions),
  });
}
