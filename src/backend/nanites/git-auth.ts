const gitHubHttpsRepoPattern =
  /^https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i;
const gitHubSshRepoPattern =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i;
export const GITHUB_INSTALLATION_GIT_USERNAME = "x-access-token";

export function parseGitHubRepositoryFromGitUrl(url: unknown): string | null {
  if (typeof url !== "string") {
    return null;
  }

  const trimmed = url.trim();
  const match = trimmed.match(gitHubHttpsRepoPattern) ?? trimmed.match(gitHubSshRepoPattern);
  const owner = match?.groups?.owner;
  const repo = match?.groups?.repo;
  return owner && repo ? `${owner}/${repo}` : null;
}

export function parseGitHubRepositoryFromGitConfig(input: {
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

export function isAllowedGitHubRepository(input: {
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

export function shouldInjectGitHubInstallationToken(input: {
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

export function createGitHubInstallationGitCredentials(token: string): {
  username: string;
  password: string;
} {
  // GitHub App installation tokens authenticate git over HTTPS as x-access-token:<token>.
  return {
    username: GITHUB_INSTALLATION_GIT_USERNAME,
    password: token,
  };
}

export function isGitHubAuthRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:401|403)\b/.test(message) && /unauthori[sz]ed|forbidden/i.test(message);
}
