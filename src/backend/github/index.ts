import { createAppAuth, type InstallationAccessTokenAuthentication } from "@octokit/auth-app";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { exchangeWebFlowCode } from "@octokit/oauth-methods";
import { getLogger } from "@logtape/logtape";
import { Octokit, RequestError } from "octokit";
import { AppError, describeError } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { createDbClient } from "#/backend/db/index.ts";
import {
  recordInstallationRepositorySnapshots,
  recordPlatformUsageFact,
} from "#/backend/db/facts.ts";
import {
  type GitHubAppCredentials,
  requireGitHubApp,
  requireDeploymentGitHubApp,
} from "#/backend/github/apps.ts";
import { normalizeGitHubAppPrivateKeyToPkcs8 } from "#/backend/github/private-key.ts";

const GITHUB_REST_API_BASE_URL = "https://api.github.com";
const GITHUB_REST_API_ACCEPT_HEADER = "application/vnd.github+json";
const GITHUB_REST_API_VERSION = "2026-03-10";
const GITHUB_API_PAGE_SIZE = 100;
const GITHUB_API_TIMEOUT_MS = 60_000;
const GITHUB_MAX_PAGINATION_PAGES = 20;
const GITHUB_INSTALLATION_USER_AGENT = "nanites-control-plane";
const GITHUB_SETUP_USER_AGENT = "nanites-setup";
const GITHUB_USER_USER_AGENT = "nanites-dashboard";
const NANITES_UPSTREAM_REPOSITORY_OWNER = "WebMCP-org";
const NANITES_UPSTREAM_REPOSITORY_NAME = "nanites";
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
export type GitHubAppManifestConversion =
  RestEndpointMethodTypes["apps"]["createFromManifest"]["response"]["data"];
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
type GitHubRepositoryProjectionOptions = {
  env: Env;
  githubAppId: number;
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

export function isGitHubAuthenticationFailure(error: unknown): boolean {
  return error instanceof RequestError && (error.status === 401 || error.status === 403);
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

function createGitHubAppAuth(config: GitHubAppCredentials) {
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
  config: GitHubAppCredentials;
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

function createGitHubSetupOctokit(): Octokit {
  return new Octokit({
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
    userAgent: GITHUB_SETUP_USER_AGENT,
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
  const config = await requireGitHubApp(createDbClient(env.DB), env, githubAppId);
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
      const auth = createGitHubAppAuth(
        await requireGitHubApp(createDbClient(env.DB), env, githubAppId),
      );
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

function throwUpstreamStarVerificationError(error: RequestError): never {
  throw new AppError("upstreamStarVerificationFailed", {
    cause: error,
    details: { githubResponseStatus: error.status },
  });
}

export type AuthenticatedGitHubAppProfile = {
  readonly appId: number;
  readonly slug: string;
  readonly htmlUrl: string;
  readonly ownerLogin: string | null;
  readonly ownerType: string | null;
  readonly clientId: string;
  readonly permissions: Record<string, string>;
  readonly events: readonly string[];
};

/**
 * Reads the app's own profile (`GET /app`) authenticated by nothing but its id
 * and private key — the one credential pair that survives a local state wipe.
 * Lets the local-dev setup route rebuild a `github_apps` row without
 * re-registering the app.
 */
export async function fetchAuthenticatedGitHubApp(input: {
  readonly appId: number;
  readonly privateKey: string;
}): Promise<AuthenticatedGitHubAppProfile> {
  const auth = createAppAuth({
    appId: input.appId,
    privateKey: normalizeGitHubAppPrivateKeyToPkcs8(input.privateKey),
  });
  const { token } = await auth({ type: "app" });
  const octokit = createGitHubSetupOctokit();
  const response = await observeGitHubOperation({ operation: "app.profile.read" }, () =>
    octokit.rest.apps.getAuthenticated({ headers: { authorization: `bearer ${token}` } }),
  );

  const app = response.data;
  if (!app || typeof app.slug !== "string" || typeof app.client_id !== "string") {
    throw new AppError("githubAppNotFound", { details: { githubAppId: input.appId } });
  }

  const permissions: Record<string, string> = {};
  for (const [permission, access] of Object.entries(app.permissions ?? {})) {
    if (typeof access === "string") {
      permissions[permission] = access;
    }
  }

  return {
    appId: app.id,
    slug: app.slug,
    htmlUrl: app.html_url,
    ownerLogin: app.owner && "login" in app.owner ? app.owner.login : null,
    ownerType: app.owner && "type" in app.owner ? (app.owner.type ?? null) : null,
    clientId: app.client_id,
    permissions,
    events: Array.isArray(app.events)
      ? app.events.filter((event): event is string => typeof event === "string")
      : [],
  };
}

export async function convertGitHubAppManifestCode(
  code: string,
): Promise<GitHubAppManifestConversion> {
  const octokit = createGitHubSetupOctokit();
  try {
    const response = await observeGitHubOperation({ operation: "app.manifest.convert" }, () =>
      octokit.rest.apps.createFromManifest({ code }),
    );
    return response.data;
  } catch (error) {
    if (error instanceof RequestError) {
      throw new AppError("githubAppManifestConversionFailed", {
        cause: error,
        details: { githubResponseStatus: error.status },
      });
    }
    throw error;
  }
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
      const config = await requireDeploymentGitHubApp(createDbClient(env.DB), env);
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

export async function checkAuthenticatedUserStarredNanites(accessToken: string): Promise<boolean> {
  return observeGitHubOperation({ operation: "user.upstream_star.check" }, async () => {
    const octokit = createGitHubUserOctokit(accessToken);
    try {
      await octokit.rest.activity.checkRepoIsStarredByAuthenticatedUser({
        owner: NANITES_UPSTREAM_REPOSITORY_OWNER,
        repo: NANITES_UPSTREAM_REPOSITORY_NAME,
      });
      return true;
    } catch (error) {
      if (error instanceof RequestError && error.status === 404) {
        return false;
      }
      if (error instanceof RequestError) {
        throwUpstreamStarVerificationError(error);
      }
      throw error;
    }
  });
}

export async function starNanitesRepositoryForAuthenticatedUser(
  accessToken: string,
): Promise<void> {
  return observeGitHubOperation({ operation: "user.upstream_star.put" }, async () => {
    const octokit = createGitHubUserOctokit(accessToken);
    try {
      await octokit.rest.activity.starRepoForAuthenticatedUser({
        owner: NANITES_UPSTREAM_REPOSITORY_OWNER,
        repo: NANITES_UPSTREAM_REPOSITORY_NAME,
      });
    } catch (error) {
      if (error instanceof RequestError) {
        throwUpstreamStarVerificationError(error);
      }
      throw error;
    }
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

export async function listInstallationRepositories(
  accessToken: string,
  githubInstallationId: number,
  projection?: GitHubRepositoryProjectionOptions,
): Promise<GitHubInstallationRepository[]> {
  return observeGitHubOperation(
    {
      operation: "user.installation_repositories.list",
      githubInstallationId,
    },
    async () => {
      const octokit = createGitHubUserOctokit(accessToken);
      const repositories: GitHubInstallationRepository[] = [];

      for (let page = 1; page <= GITHUB_MAX_PAGINATION_PAGES; page += 1) {
        const response = await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
          installation_id: githubInstallationId,
          page,
          per_page: GITHUB_API_PAGE_SIZE,
        });
        repositories.push(...response.data.repositories);

        if (response.data.repositories.length < GITHUB_API_PAGE_SIZE) {
          break;
        }
      }

      if (projection) {
        await recordInstallationRepositorySnapshots(createDbClient(projection.env.DB), {
          githubAppId: projection.githubAppId,
          githubInstallationId,
          repositories,
        });
      }

      return repositories;
    },
  );
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
      const startedAt = Date.now();
      const octokit = createGitHubInstallationOctokit({
        config: await requireGitHubApp(createDbClient(input.env.DB), input.env, input.githubAppId),
        installationId: input.githubInstallationId,
      });
      const repositories: GitHubInstallationRepository[] = [];
      let pageCount = 0;

      for (let page = 1; page <= GITHUB_MAX_PAGINATION_PAGES; page += 1) {
        const response = await octokit.rest.apps.listReposAccessibleToInstallation({
          page,
          per_page: GITHUB_API_PAGE_SIZE,
        });
        repositories.push(...response.data.repositories);
        pageCount += 1;

        if (response.data.repositories.length < GITHUB_API_PAGE_SIZE) {
          break;
        }
      }

      const db = createDbClient(input.env.DB);
      await recordPlatformUsageFact(db, {
        githubInstallationId: input.githubInstallationId,
        category: "github-api",
        eventKey: "app.installation_repositories.list",
        status: "success",
        durationMs: Date.now() - startedAt,
        metadata: {
          pageCount,
          repositoryCount: repositories.length,
        },
      });
      await recordInstallationRepositorySnapshots(db, {
        githubAppId: input.githubAppId,
        githubInstallationId: input.githubInstallationId,
        repositories,
      });
      return repositories;
    },
  );
}
