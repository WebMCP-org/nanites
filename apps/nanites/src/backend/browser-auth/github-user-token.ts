import { refreshToken as refreshGitHubOAuthToken } from "@octokit/oauth-methods";
import { githubUserTokenSchema, type GitHubUserToken } from "@nanites/contracts/auth";

function toGitHubUserToken(input: {
  token: string;
  expiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
}): GitHubUserToken {
  return githubUserTokenSchema.parse({
    accessToken: input.token,
    expiresAt: input.expiresAt ?? null,
    refreshToken: input.refreshToken ?? null,
    refreshTokenExpiresAt: input.refreshTokenExpiresAt ?? null,
  });
}

export async function refreshGitHubUserToken({
  githubUserToken,
  env,
}: {
  githubUserToken: GitHubUserToken;
  env: Env;
}): Promise<GitHubUserToken> {
  if (!githubUserToken.refreshToken) {
    throw new Error("GitHub user token refresh requested without a refresh token.");
  }

  const { authentication } = await refreshGitHubOAuthToken({
    clientType: "github-app",
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    refreshToken: githubUserToken.refreshToken,
  });

  return toGitHubUserToken({
    token: authentication.token,
    expiresAt: "expiresAt" in authentication ? authentication.expiresAt : undefined,
    refreshToken: "refreshToken" in authentication ? authentication.refreshToken : undefined,
    refreshTokenExpiresAt:
      "refreshTokenExpiresAt" in authentication ? authentication.refreshTokenExpiresAt : undefined,
  });
}
