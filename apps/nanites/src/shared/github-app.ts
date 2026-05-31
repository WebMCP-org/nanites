export const SIGVELO_GITHUB_APP_SLUG = "sigvelo";
export const SIGVELO_GITHUB_APP_URL = `https://github.com/apps/${SIGVELO_GITHUB_APP_SLUG}`;

const SIGVELO_GITHUB_APP_INSTALL_PATH = "/installations/new";
const SIGVELO_GITHUB_APP_PERMISSIONS_PATH = `${SIGVELO_GITHUB_APP_INSTALL_PATH}/permissions`;

export interface BuildGitHubAppInstallHrefOptions {
  readonly state?: string | null;
  readonly suggestedTargetId?: number | null;
  readonly repositoryIds?: readonly number[];
}

export interface BuildGitHubAppManageAccessHrefOptions {
  readonly state?: string | null;
  readonly suggestedTargetId?: number | null;
}

export function buildGitHubAppInstallHref({
  state,
  suggestedTargetId,
  repositoryIds = [],
}: BuildGitHubAppInstallHrefOptions = {}): string {
  const path = suggestedTargetId
    ? SIGVELO_GITHUB_APP_PERMISSIONS_PATH
    : SIGVELO_GITHUB_APP_INSTALL_PATH;
  const url = new URL(`${SIGVELO_GITHUB_APP_URL}${path}`);

  if (state) {
    url.searchParams.set("state", state);
  }

  if (suggestedTargetId) {
    url.searchParams.set("suggested_target_id", String(suggestedTargetId));
  }

  for (const repositoryId of repositoryIds) {
    url.searchParams.append("repository_ids[]", String(repositoryId));
  }

  return url.toString();
}

export function buildGitHubAppInstallOnAnotherOwnerHref(state?: string | null): string {
  return buildGitHubAppInstallHref({ state });
}

export function buildGitHubAppManageAccessHref({
  state,
  suggestedTargetId,
}: BuildGitHubAppManageAccessHrefOptions): string {
  return buildGitHubAppInstallHref({
    state,
    suggestedTargetId,
  });
}
