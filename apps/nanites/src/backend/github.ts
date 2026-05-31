import { createAppAuth, type InstallationAccessTokenAuthentication } from "@octokit/auth-app";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { createWebMiddleware, Webhooks } from "@octokit/webhooks";
import { getAgentByName } from "agents";
import { getLogger } from "@logtape/logtape";
import { z } from "zod";
import { Octokit, RequestError } from "octokit";
import { LOG_EVENTS } from "@nanites/observability/log-events";
import { LOGGING } from "@nanites/observability/logging";
import { OTEL_ATTRS } from "@nanites/observability/otel-attrs";
import {
  githubUserTokenSchema,
  installationRepositorySchema,
  type GitHubUserToken,
  type InstallationRepository,
} from "@nanites/contracts/auth";
import { createDbClient } from "@nanites/db/client";
import {
  findAccountIdByInstallationId,
  recordPlatformUsageFact,
} from "@nanites/db/mutations/business";
import {
  githubInstallationIdSchema,
  githubRepositoryIdSchema,
  type GitHubInstallationId,
  type GitHubRepositoryId,
} from "@nanites/contracts/ids";
import {
  type NaniteGitHubCheckOutput,
  type NaniteManagerKey,
  type NaniteRunKey,
  naniteRunKeySchema,
} from "@nanites/contracts/nanites";
import { type GitHubVisibleInstallation } from "#/backend/github-installations.ts";
import {
  buildCreateGitHubCheckRunRequest,
  buildUpdateGitHubCheckRunRequest,
} from "#/backend/github-checks.ts";
import {
  GITHUB_PUSH_EVENT_NAME,
  type GitHubAppPermissions,
  SUPPORTED_GITHUB_PULL_REQUEST_EVENT_NAMES,
  type GitHubPullRequestWebhookEvent,
  type GitHubPullRequestWebhookPayload,
  type GitHubPushWebhookEvent,
  type GitHubPushWebhookPayload,
} from "#/backend/github-types.ts";
import type { NaniteManager, NaniteRunRecord } from "#/backend/nanites/host.ts";
import type { TriggerGitHubCheckSurfaceRequest } from "#/backend/nanites/trigger-runtime.ts";
import { GITHUB_WEBHOOK_PATH } from "#/shared/constants/routes.ts";
import { buildNaniteManagerKey } from "#/shared/nanites.ts";

export const GITHUB_OAUTH_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_OAUTH_CODE_CHALLENGE_METHOD = "S256";
export const GITHUB_PKCE_CODE_CHALLENGE_HASH = "SHA-256";
export const GITHUB_PKCE_CODE_VERIFIER_RANDOM_BYTES = 32;
export const GITHUB_OAUTH_PROMPT_SELECT_ACCOUNT = "select_account";

const GITHUB_OAUTH_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_REST_API_BASE_URL = "https://api.github.com";
const GITHUB_REST_API_ACCEPT_HEADER = "application/vnd.github+json";
const GITHUB_REST_API_VERSION = "2026-03-10";
const GITHUB_API_PAGE_SIZE = 100;
const GITHUB_API_TIMEOUT_MS = 10_000;
const GITHUB_MAX_PAGINATION_PAGES = 20;
const GITHUB_INSTALLATION_USER_AGENT = "nanites-control-plane";
const GITHUB_USER_USER_AGENT = "nanites-dashboard";
const githubLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild("github")
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  });
export type GitHubInstallationRepository =
  RestEndpointMethodTypes["apps"]["listInstallationReposForAuthenticatedUser"]["response"]["data"]["repositories"][number];
const githubInstallationRepositoryPermissionNames = [
  "admin",
  "pull",
  "push",
] as const satisfies readonly (keyof NonNullable<GitHubInstallationRepository["permissions"]>)[];
type GitHubInstallationRepositoryPermissionName =
  (typeof githubInstallationRepositoryPermissionNames)[number];
type GitHubViewer = RestEndpointMethodTypes["users"]["getAuthenticated"]["response"]["data"];
export type GitHubAppInstallation =
  RestEndpointMethodTypes["apps"]["listInstallations"]["response"]["data"][number];
type GitHubChecksCreateParameters = RestEndpointMethodTypes["checks"]["create"]["parameters"];
type GitHubChecksUpdateParameters = RestEndpointMethodTypes["checks"]["update"]["parameters"];
type GitHubCheckRun = RestEndpointMethodTypes["checks"]["create"]["response"]["data"];
type GitHubRepositoryName = string;
type NaniteManagerGitHubCheckClient = Pick<
  NaniteManager,
  "attachGitHubCheck" | "claimGitHubCheckCreation" | "recordGitHubCheckFailure"
>;
type GitHubCheckSurfaceRepositoryPayload = Pick<
  GitHubPullRequestWebhookPayload["repository"],
  "full_name" | "name"
> & {
  owner: {
    login: string;
  };
};
type GitHubOperationLogContext = {
  operation: string;
  githubInstallationId?: GitHubInstallationId;
  repository?: string;
  metadata?: Record<string, unknown>;
};

export type ScopedGitHubInstallationToken = {
  installationId: GitHubInstallationId;
  token: InstallationAccessTokenAuthentication["token"];
  expiresAt: InstallationAccessTokenAuthentication["expiresAt"];
  repositorySelection: InstallationAccessTokenAuthentication["repositorySelection"];
  repositoryNames: GitHubRepositoryName[];
  permissions: GitHubAppPermissions;
};

function inspectGitHubAppEnv(env: Env) {
  const privateKey =
    typeof env.GITHUB_APP_PRIVATE_KEY === "string" ? env.GITHUB_APP_PRIVATE_KEY.trim() : "";

  return {
    appIdPresent:
      typeof env.GITHUB_APP_ID === "string" && String(env.GITHUB_APP_ID).trim().length > 0,
    clientIdPresent:
      typeof env.GITHUB_CLIENT_ID === "string" && env.GITHUB_CLIENT_ID.trim().length > 0,
    clientSecretPresent:
      typeof env.GITHUB_CLIENT_SECRET === "string" && env.GITHUB_CLIENT_SECRET.trim().length > 0,
    privateKeyPresent: privateKey.length > 0,
    privateKeyHasPemMarkers: privateKey.includes("-----BEGIN") && privateKey.includes("-----END"),
  };
}

function formatGitHubAppEnvState(env: Env): string {
  const state = inspectGitHubAppEnv(env);
  return [
    `appId=${state.appIdPresent ? "present" : "missing"}`,
    `clientId=${state.clientIdPresent ? "present" : "missing"}`,
    `clientSecret=${state.clientSecretPresent ? "present" : "missing"}`,
    `privateKey=${state.privateKeyPresent ? "present" : "missing"}`,
    `privateKeyPem=${state.privateKeyHasPemMarkers ? "yes" : "no"}`,
  ].join(", ");
}

function classifyGitHubFailure(error: unknown): string {
  if (error instanceof RequestError) {
    if (error.status === 401) {
      return "authentication_failed";
    }
    if (error.status === 403) {
      return "permission_denied";
    }
    if (error.status === 404) {
      return "not_found";
    }
    if (error.status === 422) {
      return "validation_failed";
    }
    if (error.status === 429) {
      return "rate_limited";
    }
    if (error.status >= 500) {
      return "github_server_error";
    }
  }

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "timeout";
  }

  return "unknown";
}

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

function logGitHubOperationSuccess(context: GitHubOperationLogContext, startedAt: number): void {
  githubLogger.info(
    LOG_EVENTS.GITHUB_API_REQUEST_SUCCEEDED,
    createGitHubOperationLogContext(context, Date.now() - startedAt),
  );
}

function logGitHubOperationFailure(
  error: unknown,
  context: GitHubOperationLogContext,
  startedAt: number,
): void {
  githubLogger.warn(LOG_EVENTS.GITHUB_API_REQUEST_FAILED, {
    ...createGitHubOperationLogContext(context, Date.now() - startedAt),
    [OTEL_ATTRS.ERROR_TYPE]: classifyGitHubFailure(error),
    ...(error instanceof RequestError
      ? { [OTEL_ATTRS.HTTP_RESPONSE_STATUS_CODE]: error.status }
      : {}),
    error: error instanceof Error ? error.message : String(error),
  });
}

async function observeGitHubOperation<T>(
  context: GitHubOperationLogContext,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    logGitHubOperationSuccess(context, startedAt);
    return result;
  } catch (error) {
    logGitHubOperationFailure(error, context, startedAt);
    throw error;
  }
}

function rethrowGitHubInstallationRequestError(
  error: unknown,
  context: {
    operation: string;
    env: Env;
    githubInstallationId: GitHubInstallationId;
    owner: string;
    repo: string;
  },
): never {
  if (error instanceof RequestError) {
    const repoTarget = `${context.owner}/${context.repo}`;
    throw new Error(
      [
        `${context.operation} failed for ${repoTarget} (installation ${context.githubInstallationId}) with GitHub ${error.status}: ${error.message}.`,
        `GitHub app env state: ${formatGitHubAppEnvState(context.env)}.`,
        "This usually means the deployed GitHub App credentials are stale, malformed, or do not match the installation being used.",
      ].join(" "),
      { cause: error },
    );
  }

  throw error;
}

function requireGitHubAppPrivateKey(env: Env): string {
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (typeof privateKey !== "string" || privateKey.trim().length === 0) {
    throw new Error("GITHUB_APP_PRIVATE_KEY is missing or empty.");
  }

  return privateKey.trim();
}

function createGitHubAppAuth(env: Env) {
  return createAppAuth({
    appId: Number(env.GITHUB_APP_ID),
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    privateKey: requireGitHubAppPrivateKey(env),
  });
}

async function recordGitHubPlatformUsage(input: {
  env: Env;
  githubInstallationId: GitHubInstallationId;
  githubRepositoryId?: GitHubRepositoryId | null;
  eventKey: string;
  status: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = createDbClient(input.env.DB);
  const accountId = await findAccountIdByInstallationId(db, input.githubInstallationId);
  await recordPlatformUsageFact(db, {
    accountId,
    githubInstallationId: accountId ? input.githubInstallationId : null,
    githubRepositoryId: input.githubRepositoryId ?? null,
    category: "github-api",
    eventKey: input.eventKey,
    status: input.status,
    durationMs: input.durationMs,
    metadata: accountId
      ? input.metadata
      : {
          ...input.metadata,
          unresolvedGithubInstallationId: input.githubInstallationId,
        },
  });
}

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

const githubOAuthTokenResponseSchema = z.union([
  z.object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive().optional(),
    refresh_token: z.string().min(1).optional(),
    refresh_token_expires_in: z.number().int().positive().optional(),
    token_type: z.string().min(1),
  }),
  z.object({
    error: z.string().min(1),
    error_description: z.string().optional(),
    error_uri: z.string().url().optional(),
  }),
]);

export function createGitHubInstallationOctokit({
  env,
  installationId,
}: {
  env: Env;
  installationId: GitHubInstallationId;
}): Octokit {
  return new Octokit({
    auth: {
      appId: Number(env.GITHUB_APP_ID),
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      installationId,
      privateKey: requireGitHubAppPrivateKey(env),
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

export async function getGitHubInstallationAccessToken({
  env,
  installationId,
}: {
  env: Env;
  installationId: GitHubInstallationId;
}): Promise<InstallationAccessTokenAuthentication["token"]> {
  return observeGitHubOperation(
    {
      operation: "app.installation_token.issue",
      githubInstallationId: installationId,
    },
    async () => {
      const auth = createGitHubAppAuth(env);
      const result: InstallationAccessTokenAuthentication = await auth({
        installationId,
        type: "installation",
      });

      return result.token;
    },
  );
}

function toGitHubRepositoryName(repository: string): GitHubRepositoryName {
  const [, repo] = repository.split("/", 2);
  return repo ?? repository;
}

export async function issueScopedGitHubInstallationToken({
  env,
  installationId,
  repositories,
  permissions,
}: {
  env: Env;
  installationId: GitHubInstallationId;
  repositories: readonly string[];
  permissions?: GitHubAppPermissions;
}): Promise<ScopedGitHubInstallationToken> {
  const repositoryNames = [
    ...new Set(repositories.map((repository) => toGitHubRepositoryName(repository))),
  ]
    .filter((repository) => repository.length > 0)
    .sort();
  if (repositoryNames.length === 0) {
    throw new Error("GitHub Nanite runtime token requires at least one repository.");
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
      const auth = createGitHubAppAuth(env);
      const requestedPermissions =
        permissions === undefined
          ? undefined
          : (Object.fromEntries(
              Object.entries(permissions).filter(([, permission]) => permission !== undefined),
            ) as GitHubAppPermissions);
      const result: InstallationAccessTokenAuthentication = await auth({
        installationId,
        type: "installation",
        repositoryNames,
        ...(requestedPermissions === undefined ? {} : { permissions: requestedPermissions }),
      });

      return {
        installationId,
        token: result.token,
        expiresAt: result.expiresAt,
        repositorySelection: result.repositorySelection,
        repositoryNames: result.repositoryNames ?? repositoryNames,
        permissions:
          result.permissions ?? requestedPermissions ?? ({} satisfies GitHubAppPermissions),
      };
    },
  );
}

export async function inspectGitHubAppInstallationAuth({
  env,
  githubInstallationId,
  owner,
  repo,
}: {
  env: Env;
  githubInstallationId: GitHubInstallationId;
  owner?: string;
  repo?: string;
}): Promise<{
  env: ReturnType<typeof inspectGitHubAppEnv>;
  app: {
    id: number;
    slug: string;
  };
  installation: {
    id: GitHubInstallationId;
    tokenExpiresAt: string;
  };
  repository: {
    owner: string;
    repo: string;
    defaultBranch: string;
    private: boolean;
  } | null;
}> {
  return observeGitHubOperation(
    {
      operation: "app.installation_auth.inspect",
      githubInstallationId,
      repository: owner && repo ? `${owner}/${repo}` : undefined,
    },
    async () => {
      const auth = createGitHubAppAuth(env);
      const appAuthentication = await auth({ type: "app" });
      const appOctokit = new Octokit({
        auth: appAuthentication.token,
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
      const appResponse = await appOctokit.rest.apps.getAuthenticated();
      if (
        !appResponse.data ||
        typeof appResponse.data.id !== "number" ||
        typeof appResponse.data.slug !== "string" ||
        appResponse.data.slug.length === 0
      ) {
        throw new Error("GitHub app authentication succeeded but no app identity was returned.");
      }
      const installationAuthentication = await auth({
        installationId: githubInstallationId,
        type: "installation",
      });

      let repositoryResult: {
        owner: string;
        repo: string;
        defaultBranch: string;
        private: boolean;
      } | null = null;
      if (owner && repo) {
        const installationOctokit = createGitHubInstallationOctokit({
          env,
          installationId: githubInstallationId,
        });
        const repositoryResponse = await installationOctokit.rest.repos.get({
          owner,
          repo,
        });
        repositoryResult = {
          owner: repositoryResponse.data.owner.login,
          repo: repositoryResponse.data.name,
          defaultBranch: repositoryResponse.data.default_branch,
          private: repositoryResponse.data.private,
        };
      }

      return {
        env: inspectGitHubAppEnv(env),
        app: {
          id: appResponse.data.id,
          slug: appResponse.data.slug,
        },
        installation: {
          id: githubInstallationId,
          tokenExpiresAt: installationAuthentication.expiresAt,
        },
        repository: repositoryResult,
      };
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

async function createGitHubAppOctokit(env: Env): Promise<Octokit> {
  const auth = createGitHubAppAuth(env);
  const authentication = await auth({ type: "app" });

  return new Octokit({
    auth: authentication.token,
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

export async function exchangeGitHubOAuthCode({
  code,
  codeVerifier,
  redirectUri,
  env,
}: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  env: Env;
}): Promise<GitHubUserToken> {
  return observeGitHubOperation({ operation: "oauth.token.exchange" }, async () => {
    const response = await fetch(GITHUB_OAUTH_ACCESS_TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": GITHUB_USER_USER_AGENT,
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    const responseText = await response.text();
    let responseJson: unknown;

    try {
      responseJson = JSON.parse(responseText);
    } catch (error) {
      throw new Error(
        `GitHub OAuth token exchange returned invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const responseResult = githubOAuthTokenResponseSchema.safeParse(responseJson);
    if (!responseResult.success) {
      throw new Error(
        `GitHub OAuth token exchange returned an unexpected response: ${responseText.slice(0, 240)}`,
      );
    }

    const responseData = responseResult.data;
    if ("error" in responseData) {
      throw new Error(
        responseData.error_description ??
          responseData.error ??
          `GitHub OAuth token exchange failed with status ${response.status}.`,
      );
    }

    if (!response.ok) {
      throw new Error(`GitHub OAuth token exchange failed with status ${response.status}.`);
    }

    const apiDateHeader = response.headers.get("date");
    const apiTimeMs = apiDateHeader ? new Date(apiDateHeader).getTime() : Date.now();
    const expiresAt =
      typeof responseData.expires_in === "number"
        ? new Date(apiTimeMs + responseData.expires_in * 1000).toISOString()
        : undefined;
    const refreshTokenExpiresAt =
      typeof responseData.refresh_token_expires_in === "number"
        ? new Date(apiTimeMs + responseData.refresh_token_expires_in * 1000).toISOString()
        : undefined;

    return toGitHubUserToken({
      token: responseData.access_token,
      expiresAt,
      refreshToken: responseData.refresh_token,
      refreshTokenExpiresAt,
    });
  });
}
export async function fetchGitHubViewer(accessToken: string): Promise<GitHubViewer> {
  return observeGitHubOperation({ operation: "user.viewer.fetch" }, async () => {
    const octokit = createGitHubUserOctokit(accessToken);
    const response = await octokit.rest.users.getAuthenticated();
    return response.data;
  });
}

export async function listVisibleInstallations(accessToken: string) {
  return observeGitHubOperation({ operation: "user.installations.list" }, async () => {
    const octokit = createGitHubUserOctokit(accessToken);
    const visibleInstallations: GitHubVisibleInstallation[] = [];
    let pageCount = 0;

    for await (const response of octokit.paginate.iterator(
      octokit.rest.apps.listInstallationsForAuthenticatedUser,
      {
        per_page: GITHUB_API_PAGE_SIZE,
      },
    )) {
      visibleInstallations.push(...response.data);
      pageCount += 1;
      if (pageCount >= GITHUB_MAX_PAGINATION_PAGES) {
        break;
      }
    }

    return visibleInstallations;
  });
}

export async function listGitHubAppInstallations(env: Env): Promise<GitHubAppInstallation[]> {
  return observeGitHubOperation({ operation: "app.installations.list" }, async () => {
    const octokit = await createGitHubAppOctokit(env);
    const installations: GitHubAppInstallation[] = [];
    let pageCount = 0;

    for await (const response of octokit.paginate.iterator(octokit.rest.apps.listInstallations, {
      per_page: GITHUB_API_PAGE_SIZE,
    })) {
      installations.push(...response.data);
      pageCount += 1;
      if (pageCount >= GITHUB_MAX_PAGINATION_PAGES) {
        break;
      }
    }

    return installations;
  });
}

export async function listInstallationRepositories(
  accessToken: string,
  githubInstallationId: GitHubInstallationId,
) {
  return observeGitHubOperation(
    {
      operation: "user.installation_repositories.list",
      githubInstallationId,
    },
    async () => {
      const octokit = createGitHubUserOctokit(accessToken);
      const repositories: GitHubInstallationRepository[] = [];
      let pageCount = 0;

      for await (const response of octokit.paginate.iterator(
        octokit.rest.apps.listInstallationReposForAuthenticatedUser,
        {
          installation_id: githubInstallationId,
          per_page: GITHUB_API_PAGE_SIZE,
        },
      )) {
        repositories.push(...response.data);
        pageCount += 1;
        if (pageCount >= GITHUB_MAX_PAGINATION_PAGES) {
          break;
        }
      }

      return repositories;
    },
  );
}

export async function listReposAccessibleToInstallation(input: {
  env: Env;
  githubInstallationId: GitHubInstallationId;
}) {
  return observeGitHubOperation(
    {
      operation: "app.installation_repositories.list",
      githubInstallationId: input.githubInstallationId,
    },
    async () => {
      const startedAt = Date.now();
      const octokit = createGitHubInstallationOctokit({
        env: input.env,
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

      await recordGitHubPlatformUsage({
        env: input.env,
        githubInstallationId: input.githubInstallationId,
        eventKey: "app.installation_repositories.list",
        status: "success",
        durationMs: Date.now() - startedAt,
        metadata: {
          pageCount,
          repositoryCount: repositories.length,
        },
      });
      return repositories;
    },
  );
}

export function toInstallationRepository(
  repository: GitHubInstallationRepository,
): InstallationRepository {
  const permissions = {
    admin: repository.permissions?.admin ?? false,
    pull: repository.permissions?.pull ?? false,
    push: repository.permissions?.push ?? false,
  } satisfies Record<GitHubInstallationRepositoryPermissionName, boolean>;

  return installationRepositorySchema.parse({
    default_branch: repository.default_branch,
    full_name: repository.full_name,
    id: repository.id,
    name: repository.name,
    owner: {
      login: repository.owner.login,
    },
    permissions,
    private: repository.private,
  });
}

export function toInstallationRepositories(
  repositories: readonly GitHubInstallationRepository[],
): InstallationRepository[] {
  return repositories.map((repository) => toInstallationRepository(repository));
}

export async function findInstallationRepository(
  accessToken: string,
  githubInstallationId: GitHubInstallationId,
  githubRepositoryId: GitHubRepositoryId,
): Promise<InstallationRepository | null> {
  const repositories = toInstallationRepositories(
    await listInstallationRepositories(accessToken, githubInstallationId),
  );
  return repositories.find((repository) => repository.id === githubRepositoryId) ?? null;
}

export async function listGitHubPullRequestChangedFiles({
  env,
  githubInstallationId,
  owner,
  repo,
  pullRequestNumber,
}: {
  env: Env;
  githubInstallationId: GitHubInstallationId;
  owner: string;
  repo: string;
  pullRequestNumber: number;
}): Promise<string[]> {
  const octokit = createGitHubInstallationOctokit({
    env,
    installationId: githubInstallationId,
  });

  const changedFiles: string[] = [];
  let pageCount = 0;

  for (let page = 1; page <= GITHUB_MAX_PAGINATION_PAGES; page += 1) {
    const response = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      page,
      pull_number: pullRequestNumber,
      per_page: GITHUB_API_PAGE_SIZE,
    });
    changedFiles.push(...response.data.map((file) => file.filename));
    pageCount += 1;

    if (response.data.length < GITHUB_API_PAGE_SIZE) {
      break;
    }
  }

  return changedFiles;
}

export async function listGitHubChangedFilesBetweenRefs({
  env,
  githubInstallationId,
  owner,
  repo,
  baseRef,
  headRef,
}: {
  env: Env;
  githubInstallationId: GitHubInstallationId;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}): Promise<string[]> {
  const startedAt = Date.now();
  const octokit = createGitHubInstallationOctokit({
    env,
    installationId: githubInstallationId,
  });

  const changedFiles: string[] = [];
  let pageCount = 0;

  for (let page = 1; page <= GITHUB_MAX_PAGINATION_PAGES; page += 1) {
    let response: Awaited<ReturnType<typeof octokit.rest.repos.compareCommitsWithBasehead>>;
    try {
      response = await octokit.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${baseRef}...${headRef}`,
        page,
        per_page: GITHUB_API_PAGE_SIZE,
      });
    } catch (error) {
      rethrowGitHubInstallationRequestError(error, {
        operation: `Comparing refs ${baseRef}...${headRef}`,
        env,
        githubInstallationId,
        owner,
        repo,
      });
    }

    changedFiles.push(...(response.data.files ?? []).map((file) => file.filename));
    pageCount += 1;

    if ((response.data.files?.length ?? 0) < GITHUB_API_PAGE_SIZE) {
      break;
    }
  }

  await recordGitHubPlatformUsage({
    env,
    githubInstallationId,
    eventKey: "repos.compare_commits",
    status: "success",
    durationMs: Date.now() - startedAt,
    metadata: {
      owner,
      repo,
      baseRef,
      headRef,
      pageCount,
      changedFileCount: changedFiles.length,
    },
  });

  return [...new Set(changedFiles)];
}

export async function createGitHubCheckRun({
  env,
  githubInstallationId,
  owner,
  repo,
  name,
  headSha,
  runKey,
  startedAt,
  detailsUrl,
  output,
  status,
}: {
  env: Env;
  githubInstallationId: GitHubInstallationId;
  owner: string;
  repo: string;
  name: string;
  headSha: string;
  runKey: NaniteRunKey;
  startedAt: string;
  detailsUrl: string | null;
  output: NaniteGitHubCheckOutput;
  status: NonNullable<GitHubChecksCreateParameters["status"]>;
}): Promise<GitHubCheckRun> {
  const requestStartedAt = Date.now();
  const response = await observeGitHubOperation(
    {
      operation: "checks.create",
      githubInstallationId,
      repository: `${owner}/${repo}`,
      metadata: { runKey },
    },
    async () => {
      const octokit = createGitHubInstallationOctokit({
        env,
        installationId: githubInstallationId,
      });

      return octokit.rest.checks.create(
        buildCreateGitHubCheckRunRequest({
          owner,
          repo,
          name,
          headSha,
          runKey,
          startedAt,
          detailsUrl,
          output,
          status,
        }),
      );
    },
  );

  await recordGitHubPlatformUsage({
    env,
    githubInstallationId,
    eventKey: "checks.create",
    status: "success",
    durationMs: Date.now() - requestStartedAt,
    metadata: {
      owner,
      repo,
      headSha,
      runKey,
    },
  });
  return response.data;
}

export async function createCompletedGitHubCheckRun({
  env,
  githubInstallationId,
  owner,
  repo,
  name,
  headSha,
  runKey,
  startedAt,
  detailsUrl,
  output,
  conclusion,
}: {
  env: Env;
  githubInstallationId: GitHubInstallationId;
  owner: string;
  repo: string;
  name: string;
  headSha: string;
  runKey: NaniteRunKey;
  startedAt: string;
  detailsUrl: string | null;
  output: NaniteGitHubCheckOutput;
  conclusion: NonNullable<GitHubChecksUpdateParameters["conclusion"]>;
}): Promise<GitHubCheckRun> {
  const createdCheckRun = await createGitHubCheckRun({
    env,
    githubInstallationId,
    owner,
    repo,
    name,
    headSha,
    runKey,
    startedAt,
    detailsUrl,
    output,
    status: "in_progress",
  });

  return updateGitHubCheckRun({
    env,
    githubInstallationId,
    owner,
    repo,
    checkRunId: createdCheckRun.id,
    output,
    status: "completed",
    conclusion,
    detailsUrl,
    completedAt: new Date().toISOString(),
  });
}

function getNaniteManagerAgent(env: Env, managerKey: NaniteManagerKey) {
  return getAgentByName<Env, NaniteManager>(env.SigveloNaniteManager, managerKey);
}

function buildNaniteRunDetailsUrl(input: {
  origin: string;
  githubInstallationId: GitHubInstallationId;
  naniteId: string;
  runId: string;
}): string {
  const url = new URL("/nanites", input.origin);
  url.searchParams.set("installationId", String(input.githubInstallationId));
  url.searchParams.set("naniteId", input.naniteId);
  url.searchParams.set("runId", input.runId);
  return url.toString();
}

function buildStartedNaniteCheckOutput(input: {
  naniteId: string;
  detailsUrl: string;
}): NaniteGitHubCheckOutput {
  return {
    title: `${input.naniteId} started`,
    summary: "Sigvelo accepted the GitHub trigger and is running the Nanite.",
    text: [
      "Sigvelo started a fresh Nanite run for this GitHub event.",
      "",
      `Live run: ${input.detailsUrl}`,
    ].join("\n"),
  };
}

async function createGitHubCheckForNaniteRun(input: {
  env: Env;
  manager: NaniteManagerGitHubCheckClient;
  githubInstallationId: GitHubInstallationId;
  origin: string;
  repository: GitHubCheckSurfaceRepositoryPayload;
  run: NaniteRunRecord;
  githubCheckSurface: TriggerGitHubCheckSurfaceRequest;
}): Promise<void> {
  const owner = input.repository.owner.login;
  const repo = input.repository.name;
  const detailsUrl = buildNaniteRunDetailsUrl({
    origin: input.origin,
    githubInstallationId: input.githubInstallationId,
    naniteId: input.run.naniteId,
    runId: input.run.runId,
  });
  const output = buildStartedNaniteCheckOutput({
    naniteId: input.githubCheckSurface.name ?? input.run.naniteId,
    detailsUrl,
  });
  const claim = await input.manager.claimGitHubCheckCreation({
    runId: input.run.runId,
    installationId: input.githubInstallationId,
    repository: input.githubCheckSurface.repository,
    owner,
    repo,
    name: input.githubCheckSurface.name ?? input.run.naniteId,
    headSha: input.githubCheckSurface.headSha,
    detailsUrl,
  });

  if (!claim.shouldCreate) {
    return;
  }

  try {
    const checkRun = await createGitHubCheckRun({
      env: input.env,
      githubInstallationId: input.githubInstallationId,
      owner,
      repo,
      name: input.githubCheckSurface.name ?? input.run.naniteId,
      headSha: input.githubCheckSurface.headSha,
      runKey: naniteRunKeySchema.parse(input.run.runId),
      startedAt: input.run.startedAt,
      detailsUrl,
      output,
      status: "in_progress",
    });

    await input.manager.attachGitHubCheck({
      runId: input.run.runId,
      checkRunId: checkRun.id,
      detailsUrl,
      outputTitle: output.title,
      outputSummary: output.summary,
      outputText: output.text,
    });
  } catch (error) {
    await input.manager.recordGitHubCheckFailure({
      runId: input.run.runId,
      status: "create_failed",
      summary: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateGitHubCheckRun({
  env,
  githubInstallationId,
  owner,
  repo,
  checkRunId,
  output,
  status,
  conclusion,
  detailsUrl,
  completedAt,
}: {
  env: Env;
  githubInstallationId: GitHubInstallationId;
  owner: string;
  repo: string;
  checkRunId: number;
  output: NaniteGitHubCheckOutput;
  status: NonNullable<GitHubChecksUpdateParameters["status"]>;
  conclusion?: NonNullable<GitHubChecksUpdateParameters["conclusion"]> | null;
  detailsUrl: string | null;
  completedAt?: string | null;
}) {
  const startedAt = Date.now();
  const response = await observeGitHubOperation(
    {
      operation: "checks.update",
      githubInstallationId,
      repository: `${owner}/${repo}`,
      metadata: { checkRunId, status, conclusion },
    },
    async () => {
      const octokit = createGitHubInstallationOctokit({
        env,
        installationId: githubInstallationId,
      });

      return octokit.rest.checks.update(
        buildUpdateGitHubCheckRunRequest({
          owner,
          repo,
          checkRunId,
          status,
          conclusion,
          completedAt,
          detailsUrl,
          output,
        }),
      );
    },
  );

  await recordGitHubPlatformUsage({
    env,
    githubInstallationId,
    eventKey: "checks.update",
    status: "success",
    durationMs: Date.now() - startedAt,
    metadata: {
      owner,
      repo,
      checkRunId,
      status,
      conclusion,
    },
  });
  return response.data;
}

/**
 * Workers-compatible GitHub webhook receiver built on Octokit's own web middleware.
 *
 * Octokit already owns signature verification, JSON parsing, and webhook event dispatch. This
 * boundary only registers the GitHub events SigVelo cares about, then translates the typed
 * payload into internal Nanites inputs.
 *
 * @see ../../../../opensrc/repos/github.com/octokit/webhooks.js/README.md
 * @see ../../../../opensrc/repos/github.com/octokit/webhooks.js/src/middleware/web/index.ts
 */
function handleGitHubWebhookRequest({
  request,
  env,
  executionContext,
  dispatchPullRequestEvent,
  dispatchPushEvent,
}: {
  request: Request;
  env: Env;
  executionContext: ExecutionContext;
  dispatchPullRequestEvent: (event: {
    payload: GitHubPullRequestWebhookPayload;
    origin: string;
    deliveryId: string | null;
    repositoryId: GitHubRepositoryId;
  }) => Promise<void>;
  dispatchPushEvent: (event: {
    payload: GitHubPushWebhookPayload;
    origin: string;
    deliveryId: string | null;
    repositoryId: GitHubRepositoryId;
  }) => Promise<void>;
}): Response | Promise<Response> {
  const webhooks = new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET });
  const deliveryId = request.headers.get("x-github-delivery");
  const handleSupportedPullRequestEvent = async ({
    payload,
  }: GitHubPullRequestWebhookEvent): Promise<void> => {
    const repositoryId = githubRepositoryIdSchema.parse(payload.repository.id);
    githubLogger.info(LOG_EVENTS.GITHUB_WEBHOOK_RECEIVED, {
      [OTEL_ATTRS.GITHUB_INSTALLATION_ID]: payload.installation?.id,
      [OTEL_ATTRS.GITHUB_REPOSITORY_FULL_NAME]: payload.repository.full_name,
      [OTEL_ATTRS.GITHUB_WEBHOOK_DELIVERY_ID]: deliveryId,
      [OTEL_ATTRS.GITHUB_WEBHOOK_EVENT_NAME]: "pull_request",
      [OTEL_ATTRS.GITHUB_WEBHOOK_EVENT_ACTION]: payload.action,
      repositoryId,
    });
    executionContext.waitUntil(
      dispatchPullRequestEvent({
        payload,
        origin: new URL(request.url).origin,
        deliveryId,
        repositoryId,
      }),
    );
  };
  const handlePushEvent = async ({ payload }: GitHubPushWebhookEvent): Promise<void> => {
    const repositoryId = githubRepositoryIdSchema.parse(payload.repository.id);
    githubLogger.info(LOG_EVENTS.GITHUB_WEBHOOK_RECEIVED, {
      [OTEL_ATTRS.GITHUB_INSTALLATION_ID]: payload.installation?.id,
      [OTEL_ATTRS.GITHUB_REPOSITORY_FULL_NAME]: payload.repository.full_name,
      [OTEL_ATTRS.GITHUB_WEBHOOK_DELIVERY_ID]: deliveryId,
      [OTEL_ATTRS.GITHUB_WEBHOOK_EVENT_NAME]: "push",
      repositoryId,
    });
    executionContext.waitUntil(
      dispatchPushEvent({
        payload,
        origin: new URL(request.url).origin,
        deliveryId,
        repositoryId,
      }),
    );
  };
  for (const eventName of SUPPORTED_GITHUB_PULL_REQUEST_EVENT_NAMES) {
    webhooks.on(eventName, handleSupportedPullRequestEvent);
  }
  webhooks.on(GITHUB_PUSH_EVENT_NAME, handlePushEvent);

  return createWebMiddleware(webhooks, { path: GITHUB_WEBHOOK_PATH })(request);
}

export async function handleGitHubWebhook(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
): Promise<Response> {
  return handleGitHubWebhookRequest({
    request,
    env,
    executionContext,
    dispatchPullRequestEvent: async ({ payload, deliveryId }) => {
      const githubInstallationId = githubInstallationIdSchema.parse(payload.installation?.id);
      const managerKey = buildNaniteManagerKey(githubInstallationId);
      const manager = await getNaniteManagerAgent(env, managerKey);
      const dispatches = await manager.handleGitHubPullRequestWebhook({
        githubInstallationId,
        deliveryId,
        payload,
      });

      for (const dispatch of dispatches) {
        if (!dispatch.created) {
          continue;
        }

        if (dispatch.githubCheckSurface) {
          await createGitHubCheckForNaniteRun({
            env,
            manager,
            githubInstallationId,
            origin: new URL(request.url).origin,
            repository: {
              full_name: payload.repository.full_name,
              name: payload.repository.name,
              owner: {
                login: payload.repository.owner.login,
              },
            },
            run: dispatch.run,
            githubCheckSurface: dispatch.githubCheckSurface,
          });
        }

        await manager.dispatchRun({ runId: dispatch.run.runId });
      }
    },
    dispatchPushEvent: async ({ payload, deliveryId }) => {
      const githubInstallationId = githubInstallationIdSchema.parse(payload.installation?.id);
      const managerKey = buildNaniteManagerKey(githubInstallationId);
      const manager = await getNaniteManagerAgent(env, managerKey);
      const dispatches = await manager.handleGitHubPushWebhook({
        githubInstallationId,
        deliveryId,
        payload,
      });

      for (const dispatch of dispatches) {
        if (dispatch.created) {
          if (dispatch.githubCheckSurface) {
            await createGitHubCheckForNaniteRun({
              env,
              manager,
              githubInstallationId,
              origin: new URL(request.url).origin,
              repository: {
                full_name: payload.repository.full_name,
                name: payload.repository.name,
                owner: {
                  login:
                    payload.repository.owner?.login ?? payload.repository.full_name.split("/")[0],
                },
              },
              run: dispatch.run,
              githubCheckSurface: dispatch.githubCheckSurface,
            });
          }

          await manager.dispatchRun({ runId: dispatch.run.runId });
        }
      }
    },
  });
}
