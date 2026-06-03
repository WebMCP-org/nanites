import { createAppAuth, type InstallationAccessTokenAuthentication } from "@octokit/auth-app";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import { createWebMiddleware, type EmitterWebhookEvent, Webhooks } from "@octokit/webhooks";
import { getAgentByName } from "agents";
import { getLogger } from "@logtape/logtape";
import { z } from "zod";
import { Octokit, RequestError } from "octokit";
import { LOG_EVENTS } from "#/shared/observability/log-events.ts";
import { LOGGING } from "#/shared/observability/logging.ts";
import { OTEL_ATTRS } from "#/shared/observability/otel-attrs.ts";
import { createDbClient } from "#/backend/db/client.ts";
import { recordPlatformUsageFact } from "#/backend/db/business-mutations.ts";
import type { SigveloNaniteManager } from "#/backend/nanites/host.ts";
import { GITHUB_WEBHOOK_PATH } from "#/shared/constants/routes.ts";
import {
  getGitHubWebhookAction,
  getGitHubWebhookInstallationId,
  getGitHubWebhookRepositoryFullName,
  getGitHubWebhookRepositoryId,
} from "#/shared/github-webhook-fields.ts";
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

export type GitHubViewer = RestEndpointMethodTypes["users"]["getAuthenticated"]["response"]["data"];
export type GitHubUserToken = {
  accessToken: string;
  expiresAt: string | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: string | null;
};
type GitHubInstallationTokenPermissions = NonNullable<
  RestEndpointMethodTypes["apps"]["createInstallationAccessToken"]["parameters"]["permissions"]
>;
export type GitHubInstallationRepository =
  RestEndpointMethodTypes["apps"]["listInstallationReposForAuthenticatedUser"]["response"]["data"]["repositories"][number];
export type GitHubVisibleInstallation =
  RestEndpointMethodTypes["apps"]["listInstallationsForAuthenticatedUser"]["response"]["data"]["installations"][number];
export type GitHubAppPermissions = GitHubInstallationTokenPermissions;
type GitHubOperationLogContext = {
  operation: string;
  githubInstallationId?: number;
  repository?: string;
  metadata?: Record<string, unknown>;
};

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

function createGitHubInstallationOctokit({
  env,
  installationId,
}: {
  env: Env;
  installationId: number;
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

function readGitHubInstallationTokenRepositoryName(repositoryFullName: string): string {
  const [, repo] = repositoryFullName.split("/", 2);
  return repo ?? repositoryFullName;
}

export async function issueScopedGitHubInstallationToken({
  env,
  installationId,
  repositories,
  permissions,
}: {
  env: Env;
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

    return {
      accessToken: responseData.access_token,
      expiresAt: expiresAt ?? null,
      refreshToken: responseData.refresh_token ?? null,
      refreshTokenExpiresAt: refreshTokenExpiresAt ?? null,
    };
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

export async function listInstallationRepositories(
  accessToken: string,
  githubInstallationId: number,
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

      await recordPlatformUsageFact(createDbClient(input.env.DB), {
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
      return repositories;
    },
  );
}

/**
 * Workers-compatible GitHub webhook receiver built on Octokit's own web middleware.
 *
 * Octokit already owns signature verification, JSON parsing, and webhook event dispatch. This
 * boundary only logs cheap metadata and forwards Octokit's event object to the Nanite manager.
 *
 * @see ../../../../opensrc/repos/github.com/octokit/webhooks.js/README.md
 * @see ../../../../opensrc/repos/github.com/octokit/webhooks.js/src/middleware/web/index.ts
 */
function handleGitHubWebhookRequest({
  request,
  env,
  executionContext,
  dispatchWebhookEvent,
}: {
  request: Request;
  env: Env;
  executionContext: ExecutionContext;
  dispatchWebhookEvent: (event: EmitterWebhookEvent) => Promise<void>;
}): Response | Promise<Response> {
  const webhooks = new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET });
  webhooks.onAny((event) => {
    githubLogger.info(LOG_EVENTS.GITHUB_WEBHOOK_RECEIVED, {
      [OTEL_ATTRS.GITHUB_INSTALLATION_ID]: getGitHubWebhookInstallationId(event),
      [OTEL_ATTRS.GITHUB_REPOSITORY_FULL_NAME]: getGitHubWebhookRepositoryFullName(event),
      [OTEL_ATTRS.GITHUB_WEBHOOK_DELIVERY_ID]: event.id,
      [OTEL_ATTRS.GITHUB_WEBHOOK_EVENT_NAME]: event.name,
      [OTEL_ATTRS.GITHUB_WEBHOOK_EVENT_ACTION]: getGitHubWebhookAction(event),
      repositoryId: getGitHubWebhookRepositoryId(event),
    });
    executionContext.waitUntil(dispatchWebhookEvent(event));
  });

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
    dispatchWebhookEvent: async (event) => {
      const githubInstallationId = getGitHubWebhookInstallationId(event);
      if (typeof githubInstallationId !== "number") {
        throw new Error(`GitHub ${event.name} webhook is missing installation.id.`);
      }
      const managerKey = buildNaniteManagerKey(githubInstallationId);
      const manager = await getAgentByName<Env, SigveloNaniteManager>(
        env.SigveloNaniteManager,
        managerKey,
      );
      const dispatches = await manager.handleGitHubWebhook({
        githubInstallationId,
        event,
      });

      for (const dispatch of dispatches) {
        if (!dispatch.created) {
          continue;
        }

        await manager.dispatchRun({ runId: dispatch.run.runId });
      }
    },
  });
}
