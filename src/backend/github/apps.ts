import { AppError } from "#/backend/errors.ts";
import { normalizeGitHubAppPrivateKeyToPkcs8 } from "#/backend/github/private-key.ts";

export type DeploymentGitHubAppMetadata = {
  readonly appId: number;
  readonly slug: string;
  readonly htmlUrl: string;
  readonly clientId: string;
};

export type DeploymentGitHubApp = DeploymentGitHubAppMetadata & {
  readonly clientSecret: string;
  readonly webhookSecret: string;
  readonly privateKey: string;
};

export function readDeploymentGitHubAppMetadata(env: Env): DeploymentGitHubAppMetadata {
  return {
    appId: Number(env.GITHUB_APP_ID),
    slug: env.GITHUB_APP_SLUG,
    htmlUrl: `https://github.com/apps/${env.GITHUB_APP_SLUG}`,
    clientId: env.GITHUB_APP_CLIENT_ID,
  };
}

export function requireDeploymentGitHubApp(env: Env): DeploymentGitHubApp {
  const metadata = readDeploymentGitHubAppMetadata(env);

  return {
    ...metadata,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
    privateKey: normalizeGitHubAppPrivateKeyToPkcs8(env.GITHUB_APP_PRIVATE_KEY),
  };
}

export function requireDeploymentGitHubAppForId(
  env: Env,
  githubAppId: number,
): DeploymentGitHubApp {
  const app = requireDeploymentGitHubApp(env);
  if (app.appId !== githubAppId) {
    throw new AppError("deploymentGitHubAppRequired");
  }

  return app;
}
