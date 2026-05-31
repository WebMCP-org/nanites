import type { InstallationAccessTokenAuthentication } from "@octokit/auth-app";

type GitHubInstallationAccessTokenResponse = {
  readonly token: InstallationAccessTokenAuthentication["token"];
  readonly expires_at: string;
  readonly permissions: InstallationAccessTokenAuthentication["permissions"];
  readonly repository_selection: InstallationAccessTokenAuthentication["repositorySelection"];
};

export function buildGitHubInstallationAccessTokenResponse(
  overrides: Partial<GitHubInstallationAccessTokenResponse> = {},
) {
  return {
    token: "test-installation-token",
    expires_at: "2026-04-11T12:00:00.000Z",
    permissions: {
      contents: "read",
      metadata: "read",
    },
    repository_selection: "selected",
    ...overrides,
  } satisfies GitHubInstallationAccessTokenResponse;
}
