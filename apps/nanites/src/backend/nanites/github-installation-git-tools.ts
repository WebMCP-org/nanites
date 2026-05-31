import type { ToolProvider } from "@cloudflare/codemode";
import {
  createGitHubInstallationGitCredentials,
  isGitHubAuthRejection,
  parseGitHubRepositoryFromGitConfig,
  parseGitHubRepositoryFromGitUrl,
  shouldInjectGitHubInstallationToken,
} from "#/backend/nanites/git-auth.ts";
import { gitToolsWithLazyAuth } from "#/backend/nanites/git-tools-with-lazy-auth.ts";

type GitToolsWorkspace = Parameters<typeof gitToolsWithLazyAuth>[0];

export type GitHubInstallationGitToolsOptions = {
  getAllowedRepositories: () => Promise<readonly string[]> | readonly string[];
  issueToken: (input: { repository: string }) => Promise<string | null>;
};

export function gitToolsWithGitHubInstallationAuth(
  workspace: GitToolsWorkspace,
  options: GitHubInstallationGitToolsOptions,
): ToolProvider {
  return gitToolsWithLazyAuth(workspace, {
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
  workspace: GitToolsWorkspace;
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
