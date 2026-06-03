import type { ToolProvider } from "@cloudflare/codemode";
import { gitTools } from "@cloudflare/shell/git";
import { wrapGitToolProviderWithLazyAuth } from "#/backend/nanites/git-tools-with-lazy-auth.ts";

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
