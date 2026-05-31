import type { GitHubInstallationId } from "@nanites/contracts/ids";
import { listReposAccessibleToInstallation } from "#/backend/github.ts";
import type { NaniteManifest } from "#/backend/nanites/host.ts";

export class NaniteRepositoryScopeError extends Error {
  constructor(
    readonly githubInstallationId: GitHubInstallationId,
    readonly repositories: readonly string[],
  ) {
    super(
      `GitHub installation ${githubInstallationId} cannot access Nanite repositories: ${repositories.join(", ")}`,
    );
    this.name = "NaniteRepositoryScopeError";
  }
}

function collectManifestRepositories(manifest: NaniteManifest): string[] {
  const repositories = new Set<string>();

  for (const repository of manifest.permissions.github?.repositories ?? []) {
    repositories.add(repository);
  }

  const trigger = manifest.trigger;
  if (trigger.type === "github") {
    if (trigger.event === "pull_request") {
      for (const repository of trigger.repositories) {
        repositories.add(repository);
      }
    } else {
      repositories.add(trigger.repository);
    }
  }

  return [...repositories].sort();
}

export async function assertNaniteRepositoriesBelongToInstallation({
  env,
  githubInstallationId,
  manifest,
}: {
  env: Env;
  githubInstallationId: GitHubInstallationId;
  manifest: NaniteManifest;
}): Promise<void> {
  const requestedRepositories = collectManifestRepositories(manifest);
  if (requestedRepositories.length === 0) {
    return;
  }

  const accessibleRepositories = new Set(
    (
      await listReposAccessibleToInstallation({
        env,
        githubInstallationId,
      })
    ).map((repository) => repository.full_name),
  );
  const inaccessibleRepositories = requestedRepositories.filter(
    (repository) => !accessibleRepositories.has(repository),
  );

  if (inaccessibleRepositories.length > 0) {
    throw new NaniteRepositoryScopeError(githubInstallationId, inaccessibleRepositories);
  }
}
