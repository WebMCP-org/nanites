import { createAppAuth, type InstallationAccessTokenAuthentication } from "@octokit/auth-app";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { exchangeWebFlowCode } from "@octokit/oauth-methods";
import { getLogger } from "@logtape/logtape";
import { Octokit, RequestError } from "octokit";
import { AppError, describeError } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { recordInstallationRepositorySnapshots } from "#/backend/db/facts.ts";
import {
  type DeploymentGitHubApp,
  requireDeploymentGitHubAppForId,
  requireDeploymentGitHubApp,
} from "#/backend/github/apps.ts";

const GITHUB_REST_API_BASE_URL = "https://api.github.com";
const GITHUB_REST_API_ACCEPT_HEADER = "application/vnd.github+json";
const GITHUB_REST_API_VERSION = "2026-03-10";
const GITHUB_API_PAGE_SIZE = 100;
const GITHUB_API_TIMEOUT_MS = 60_000;
const GITHUB_MAX_PAGINATION_PAGES = 20;
const GITHUB_INSTALLATION_USER_AGENT = "nanites-control-plane";
const GITHUB_USER_USER_AGENT = "nanites-dashboard";
const githubLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild("github")
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  });

export type GitHubViewer = RestEndpointMethodTypes["users"]["getAuthenticated"]["response"]["data"];
export type GitHubUserToken = {
  accessToken: string;
  expiresAt: string | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: string | null;
  githubAppId: number;
  githubAppClientId: string;
};
type GitHubInstallationTokenPermissions = NonNullable<
  RestEndpointMethodTypes["apps"]["createInstallationAccessToken"]["parameters"]["permissions"]
>;
export type GitHubInstallationRepository =
  RestEndpointMethodTypes["apps"]["listInstallationReposForAuthenticatedUser"]["response"]["data"]["repositories"][number];
export type GitHubVisibleInstallation =
  RestEndpointMethodTypes["apps"]["listInstallationsForAuthenticatedUser"]["response"]["data"]["installations"][number];
export type GitHubAppPermissions = GitHubInstallationTokenPermissions;
export type GitHubPullRequestImpact = {
  pullRequestNumber: number;
  merged: boolean;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
};
type GitHubPullRequestReference = {
  owner: string;
  repo: string;
  pullRequestNumber: number;
};
type GitHubOperationLogContext = {
  operation: string;
  githubInstallationId?: number;
  repository?: string;
  metadata?: Record<string, unknown>;
};
function createGitHubOperationLogContext(
  context: GitHubOperationLogContext,
  durationMs: number,
): Record<string, unknown> {
  return {
    [OTEL_ATTRS.GITHUB_OPERATION]: context.operation,
    [OTEL_ATTRS.REQUEST_DURATION_MS]: durationMs,
    ...(context.githubInstallationId
      ? { [OTEL_ATTRS.GITHUB_INSTALLATION_ID]: context.githubInstallationId }
      : {}),
    ...(context.repository ? { [OTEL_ATTRS.GITHUB_REPOSITORY_FULL_NAME]: context.repository } : {}),
    ...context.metadata,
  };
}

async function observeGitHubOperation<T>(
  context: GitHubOperationLogContext,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    githubLogger.info(
      LOG_EVENTS.GITHUB_API_REQUEST_SUCCEEDED,
      createGitHubOperationLogContext(context, Date.now() - startedAt),
    );
    return result;
  } catch (error) {
    githubLogger.warn(LOG_EVENTS.GITHUB_API_REQUEST_FAILED, {
      ...createGitHubOperationLogContext(context, Date.now() - startedAt),
      [OTEL_ATTRS.ERROR_TYPE]: error instanceof Error ? error.name : typeof error,
      [OTEL_ATTRS.EXCEPTION_MESSAGE]: describeError(error),
      ...(error instanceof RequestError
        ? { [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CODE]: error.status }
        : {}),
    });
    throw error;
  }
}

function createGitHubAppAuth(config: DeploymentGitHubApp) {
  return createAppAuth({
    appId: config.appId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    privateKey: config.privateKey,
  });
}

function createGitHubInstallationOctokit({
  config,
  installationId,
}: {
  config: DeploymentGitHubApp;
  installationId: number;
}): Octokit {
  return new Octokit({
    auth: {
      appId: config.appId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      installationId,
      privateKey: config.privateKey,
    },
    authStrategy: createAppAuth,
    baseUrl: GITHUB_REST_API_BASE_URL,
    request: {
      headers: {
        accept: GITHUB_REST_API_ACCEPT_HEADER,
        "x-github-api-version": GITHUB_REST_API_VERSION,
      },
      timeout: GITHUB_API_TIMEOUT_MS,
    },
    userAgent: GITHUB_INSTALLATION_USER_AGENT,
  });
}

function readGitHubInstallationTokenRepositoryName(repositoryFullName: string): string {
  const [, repo] = repositoryFullName.split("/", 2);
  return repo ?? repositoryFullName;
}

function readGitHubPullRequestReference(
  outputUrl: string | null | undefined,
): GitHubPullRequestReference | null {
  if (!outputUrl) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(outputUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const [, owner, repo, kind, numberText] = url.pathname.split("/");
  const pullRequestNumber = Number(numberText);
  if (!owner || !repo || kind !== "pull" || !Number.isInteger(pullRequestNumber)) {
    return null;
  }

  return {
    owner: decodeURIComponent(owner),
    repo: decodeURIComponent(repo),
    pullRequestNumber,
  };
}

export async function fetchGitHubPullRequestImpact({
  env,
  githubAppId,
  installationId,
  outputUrl,
}: {
  env: Env;
  githubAppId: number;
  installationId: number;
  outputUrl: string | null | undefined;
}): Promise<GitHubPullRequestImpact | null> {
  const reference = readGitHubPullRequestReference(outputUrl);
  if (!reference) {
    return null;
  }

  const repository = `${reference.owner}/${reference.repo}`;
  const config = requireDeploymentGitHubAppForId(env, githubAppId);
  const octokit = createGitHubInstallationOctokit({ config, installationId });
  const response = await observeGitHubOperation(
    {
      operation: "pulls.get",
      githubInstallationId: installationId,
      repository,
      metadata: { pullRequestNumber: reference.pullRequestNumber },
    },
    () =>
      octokit.rest.pulls.get({
        owner: reference.owner,
        repo: reference.repo,
        pull_number: reference.pullRequestNumber,
      }),
  );
  const pullRequest = response.data;

  return {
    pullRequestNumber: reference.pullRequestNumber,
    merged: pullRequest.merged_at !== null,
    mergedAt: pullRequest.merged_at,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changedFiles: pullRequest.changed_files,
  };
}

export async function issueScopedGitHubInstallationToken({
  env,
  githubAppId,
  installationId,
  repositories,
  permissions,
}: {
  env: Env;
  githubAppId: number;
  installationId: number;
  repositories: readonly string[];
  permissions?: GitHubAppPermissions;
}): Promise<InstallationAccessTokenAuthentication> {
  const repositoryNames = [
    ...new Set(
      repositories.map((repository) => readGitHubInstallationTokenRepositoryName(repository)),
    ),
  ]
    .filter((repository) => repository.length > 0)
    .sort();
  if (repositoryNames.length === 0) {
    throw new AppError("githubRuntimeTokenRepositoryRequired");
  }

  return observeGitHubOperation(
    {
      operation: "app.scoped_installation_token.issue",
      githubInstallationId: installationId,
      metadata: {
        repositoryCount: repositoryNames.length,
      },
    },
    async () => {
      const auth = createGitHubAppAuth(requireDeploymentGitHubAppForId(env, githubAppId));
      return auth({
        installationId,
        type: "installation",
        repositoryNames,
        ...(permissions === undefined ? {} : { permissions }),
      });
    },
  );
}

function createGitHubUserOctokit(accessToken: string): Octokit {
  return new Octokit({
    auth: accessToken,
    baseUrl: GITHUB_REST_API_BASE_URL,
    request: {
      headers: {
        accept: GITHUB_REST_API_ACCEPT_HEADER,
        "x-github-api-version": GITHUB_REST_API_VERSION,
      },
      timeout: GITHUB_API_TIMEOUT_MS,
    },
    retry: {
      enabled: false,
    },
    userAgent: GITHUB_USER_USER_AGENT,
  });
}

export async function exchangeGitHubOAuthCode({
  code,
  redirectUri,
  env,
}: {
  code: string;
  redirectUri: string;
  env: Env;
}): Promise<GitHubUserToken> {
  return observeGitHubOperation({ operation: "oauth.token.exchange" }, async () => {
    try {
      // Browser/MCP OAuth always rides the deployment app.
      const config = requireDeploymentGitHubApp(env);
      const { authentication } = await exchangeWebFlowCode({
        clientType: "github-app",
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        redirectUrl: redirectUri,
      });

      return {
        accessToken: authentication.token,
        expiresAt: "expiresAt" in authentication ? authentication.expiresAt : null,
        refreshToken: "refreshToken" in authentication ? authentication.refreshToken : null,
        refreshTokenExpiresAt:
          "refreshTokenExpiresAt" in authentication ? authentication.refreshTokenExpiresAt : null,
        githubAppId: config.appId,
        githubAppClientId: config.clientId,
      };
    } catch (error) {
      if (!(error instanceof RequestError)) {
        throw error;
      }

      const responseData = error.response?.data;
      const githubError =
        typeof responseData === "object" &&
        responseData !== null &&
        "error" in responseData &&
        typeof responseData.error === "string"
          ? responseData.error
          : null;
      const githubErrorDescription =
        typeof responseData === "object" &&
        responseData !== null &&
        "error_description" in responseData &&
        typeof responseData.error_description === "string"
          ? responseData.error_description
          : null;

      throw new AppError("githubOAuthTokenExchangeFailed", {
        cause: error,
        details: {
          githubError,
          githubErrorDescription,
          githubResponseStatus: error.status,
        },
      });
    }
  });
}
export async function fetchGitHubViewer(accessToken: string): Promise<GitHubViewer> {
  return observeGitHubOperation({ operation: "user.viewer.fetch" }, async () => {
    const octokit = createGitHubUserOctokit(accessToken);
    const response = await octokit.rest.users.getAuthenticated();
    return response.data;
  });
}

export async function listVisibleInstallations(
  accessToken: string,
): Promise<GitHubVisibleInstallation[]> {
  return observeGitHubOperation({ operation: "user.installations.list" }, async () => {
    const octokit = createGitHubUserOctokit(accessToken);
    const installations: GitHubVisibleInstallation[] = [];

    for (let page = 1; page <= GITHUB_MAX_PAGINATION_PAGES; page += 1) {
      const response = await octokit.rest.apps.listInstallationsForAuthenticatedUser({
        page,
        per_page: GITHUB_API_PAGE_SIZE,
      });
      installations.push(...response.data.installations);

      if (response.data.installations.length < GITHUB_API_PAGE_SIZE) {
        break;
      }
    }

    return installations;
  });
}

export async function listReposAccessibleToInstallation(input: {
  env: Env;
  githubAppId: number;
  githubInstallationId: number;
}) {
  return observeGitHubOperation(
    {
      operation: "app.installation_repositories.list",
      githubInstallationId: input.githubInstallationId,
    },
    async () => {
      const octokit = createGitHubInstallationOctokit({
        config: requireDeploymentGitHubAppForId(input.env, input.githubAppId),
        installationId: input.githubInstallationId,
      });
      const repositories: GitHubInstallationRepository[] = [];

      for (let page = 1; page <= GITHUB_MAX_PAGINATION_PAGES; page += 1) {
        const response = await octokit.rest.apps.listReposAccessibleToInstallation({
          page,
          per_page: GITHUB_API_PAGE_SIZE,
        });
        repositories.push(...response.data.repositories);

        if (response.data.repositories.length < GITHUB_API_PAGE_SIZE) {
          break;
        }
      }

      const db = createDbClient(input.env.DB);
      await recordInstallationRepositorySnapshots(db, {
        githubAppId: input.githubAppId,
        githubInstallationId: input.githubInstallationId,
        repositories,
      });
      return repositories;
    },
  );
}
