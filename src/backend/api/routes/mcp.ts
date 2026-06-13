import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { AppError, describeError, requestValidationHook } from "#/backend/errors.ts";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createDbClient } from "#/backend/db/index.ts";
import { listBrowserVisibleInstallationSnapshots } from "#/backend/auth/installations.ts";
import {
  readSessionCookie,
  type NanitesSession,
  type SessionInstallationSnapshot,
} from "#/backend/auth/session.ts";
import { listInstallationRepositories, type GitHubUserToken } from "#/backend/github/index.ts";
import type { WorkerContext, WorkerHonoEnv } from "#/backend/api/apps.ts";
import { resolveGrantedMcpScopes } from "#/backend/mcp/index.ts";
import { AUTH_RETURN_TO_PARAM, GITHUB_OAUTH_LOGIN_PATH } from "#/auth.ts";
import {
  MCP_AUTHORIZE_CONTEXT_ROUTE,
  MCP_AUTHORIZE_ROUTE,
  MCP_AUTHORIZE_UI_ROUTE,
  MCP_CONSENT_COOKIE_MAX_AGE_SECONDS,
  MCP_CONSENT_COOKIE_NAME,
  MCP_CONSENT_COOKIE_PATH,
} from "#/mcp.ts";
import { buildGitHubAppInstallHref } from "#/github.ts";
import { requireDeploymentGitHubApp } from "#/backend/github/apps.ts";

const consentCookiePayloadSchema = z.object({
  csrfToken: z.string().min(1),
  clientId: z.string().min(1),
  oauthState: z.string().min(1),
  authRequestHash: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
});

type EnvWithOAuthHelpers = Env & {
  OAUTH_PROVIDER?: OAuthHelpers;
};

interface McpAuthorizeInstallationOption {
  readonly installation: SessionInstallationSnapshot;
  readonly repositoryCount: number;
  readonly manageAccessHref: string;
}

type BrowserAuthorizeContext = {
  session: NanitesSession;
  githubUserToken: GitHubUserToken;
  actor: NanitesSession["githubViewer"];
  sessionInstallationSnapshots: SessionInstallationSnapshot[];
};

export type McpAuthorizeContext =
  | {
      status: "login";
      clientName: string;
      loginHref: string;
    }
  | {
      status: "no_installations";
      clientName: string;
      installHref: string;
    }
  | {
      status: "no_repositories";
      clientName: string;
      installHref: string;
      installations: McpAuthorizeInstallationOption[];
    }
  | {
      status: "consent";
      clientName: string;
      requestedScopes: string[];
      authorizeAction: string;
      csrfToken: string;
      activeGithubInstallationId: number | null;
      installations: McpAuthorizeInstallationOption[];
    }
  | {
      status: "invalid";
      message: string;
    };

const mcpConsentFormInput = zValidator(
  "form",
  z
    .object({
      csrf_token: z.string().min(1),
      intent: z.enum(["authorize", "deny"]),
      github_installation_id: z.coerce.number().int().positive(),
    })
    .transform((value) => ({
      csrfToken: value.csrf_token,
      intent: value.intent,
      selectedInstallationId: value.github_installation_id,
    })),
  requestValidationHook,
);

const mcpOAuthProviderRequired = createMiddleware<WorkerHonoEnv>(async (context, next) => {
  const oauthProvider = (context.env as EnvWithOAuthHelpers).OAUTH_PROVIDER;
  if (!oauthProvider) {
    throw new AppError("mcpOAuthProviderUnavailable");
  }

  context.set("mcpOAuthProvider", oauthProvider);
  await next();
});

const mcpAuthRequestRequired = createMiddleware<WorkerHonoEnv>(async (context, next) => {
  const sourceUrl = new URL(context.req.raw.url);
  const authRequestUrl =
    sourceUrl.pathname === MCP_AUTHORIZE_CONTEXT_ROUTE
      ? new URL(MCP_AUTHORIZE_ROUTE, context.req.raw.url)
      : sourceUrl;
  authRequestUrl.search = sourceUrl.search;
  const authorizationRequest =
    sourceUrl.pathname === MCP_AUTHORIZE_CONTEXT_ROUTE
      ? new Request(authRequestUrl, {
          method: "GET",
          headers: context.req.raw.headers,
        })
      : context.req.raw;

  try {
    context.set(
      "mcpAuthRequest",
      await context.get("mcpOAuthProvider").parseAuthRequest(authorizationRequest),
    );
  } catch (error) {
    throw new AppError("invalidMcpAuthorizationRequest", {
      cause: error,
      details: { reason: describeError(error) },
    });
  }

  await next();
});

async function readOptionalBrowserAuthorizeContext({
  request,
  env,
  responseHeaders,
}: {
  request: Request;
  env: Env;
  responseHeaders?: Headers | undefined;
}): Promise<BrowserAuthorizeContext | null> {
  const session = await readSessionCookie(request, env);
  if (!session) {
    return null;
  }

  try {
    const visibleInstallations = await listBrowserVisibleInstallationSnapshots(request, env, {
      responseHeaders,
    });

    return {
      session: visibleInstallations.session,
      actor: visibleInstallations.session.githubViewer,
      githubUserToken: visibleInstallations.githubUserToken,
      sessionInstallationSnapshots: visibleInstallations.installations,
    };
  } catch (error) {
    if (error instanceof AppError && error.kind === "authenticationRequired") {
      return null;
    }

    throw error;
  }
}

async function hashAuthRequest(authRequest: AuthRequest): Promise<string> {
  const payload = JSON.stringify({
    responseType: authRequest.responseType,
    clientId: authRequest.clientId,
    redirectUri: authRequest.redirectUri,
    scope: [...authRequest.scope].sort(),
    state: authRequest.state,
    codeChallenge: authRequest.codeChallenge ?? null,
    codeChallengeMethod: authRequest.codeChallengeMethod ?? null,
    resource: (Array.isArray(authRequest.resource)
      ? [...authRequest.resource]
      : authRequest.resource
        ? [authRequest.resource]
        : []
    ).sort(),
  });

  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)),
  ).toString("base64url");
}

async function readConsentCookie(context: WorkerContext) {
  const sealedValue = await getSignedCookie(
    context,
    `${context.env.AUTH_COOKIE_SECRET}:mcp-consent`,
    MCP_CONSENT_COOKIE_NAME,
  );
  if (!sealedValue) {
    return null;
  }

  try {
    const payload = consentCookiePayloadSchema.safeParse(JSON.parse(sealedValue));
    return payload.success && Date.parse(payload.data.expiresAt) > Date.now() ? payload.data : null;
  } catch {
    return null;
  }
}

function expireConsentCookie(context: WorkerContext): void {
  deleteCookie(context, MCP_CONSENT_COOKIE_NAME, {
    path: MCP_CONSENT_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(context.req.raw.url).protocol === "https:",
  });
}

function redirectOAuthError(
  context: WorkerContext,
  authRequest: AuthRequest,
  error: "access_denied",
  description: string,
): Response {
  const redirectUrl = new URL(authRequest.redirectUri);
  redirectUrl.searchParams.set("error", error);
  redirectUrl.searchParams.set("error_description", description);
  redirectUrl.searchParams.set("state", authRequest.state);

  expireConsentCookie(context);
  return context.redirect(redirectUrl.toString(), 302);
}

export const mcpOAuthRoutes = new Hono<WorkerHonoEnv>()
  .use(MCP_AUTHORIZE_ROUTE, secureHeaders({ xFrameOptions: "DENY" }))
  .use(MCP_AUTHORIZE_CONTEXT_ROUTE, secureHeaders({ xFrameOptions: "DENY" }))
  .use(MCP_AUTHORIZE_ROUTE, async (context, next) => {
    context.header("cache-control", "no-store");
    await next();
  })
  .use(MCP_AUTHORIZE_CONTEXT_ROUTE, async (context, next) => {
    context.header("cache-control", "no-store");
    await next();
  })
  .get(MCP_AUTHORIZE_ROUTE, (context) => {
    const sourceUrl = new URL(context.req.raw.url);
    const uiUrl = new URL(MCP_AUTHORIZE_UI_ROUTE, context.req.raw.url);
    uiUrl.search = sourceUrl.search;

    return context.redirect(uiUrl.toString(), 302);
  })
  .post(
    MCP_AUTHORIZE_ROUTE,
    csrf(),
    mcpConsentFormInput,
    mcpOAuthProviderRequired,
    mcpAuthRequestRequired,
    async (context) => {
      const oauthProvider = context.get("mcpOAuthProvider");
      const authRequest = context.get("mcpAuthRequest");
      const client = await oauthProvider.lookupClient(authRequest.clientId);
      const clientName = client?.clientName?.trim() || authRequest.clientId;
      const authContext = await readOptionalBrowserAuthorizeContext({
        request: context.req.raw,
        env: context.env,
        responseHeaders: context.res.headers,
      });

      if (!authContext || authContext.sessionInstallationSnapshots.length === 0) {
        throw new AppError("mcpAuthorizationInstallationRequired");
      }

      const formData = context.req.valid("form");
      const consentCookie = await readConsentCookie(context);
      if (
        !consentCookie ||
        formData.csrfToken !== consentCookie.csrfToken ||
        consentCookie.clientId !== authRequest.clientId ||
        consentCookie.oauthState !== authRequest.state ||
        consentCookie.authRequestHash !== (await hashAuthRequest(authRequest))
      ) {
        throw new AppError("invalidMcpAuthorizationConsent");
      }

      if (formData.intent === "deny") {
        return redirectOAuthError(
          context,
          authRequest,
          "access_denied",
          "The user denied the SigVelo MCP authorization request.",
        );
      }

      const activeInstallation =
        authContext.sessionInstallationSnapshots.find(
          (installation) => installation.id === formData.selectedInstallationId,
        ) ?? null;

      if (!activeInstallation) {
        throw new AppError("mcpSelectedInstallationUnavailable");
      }

      if (
        (
          await listInstallationRepositories(
            authContext.githubUserToken.accessToken,
            activeInstallation.id,
            { env: context.env, githubAppId: activeInstallation.githubAppId },
          )
        ).length === 0
      ) {
        return redirectOAuthError(
          context,
          authRequest,
          "access_denied",
          "The selected GitHub installation has no repositories shared with SigVelo.",
        );
      }

      const grantedScopes = resolveGrantedMcpScopes(authRequest.scope);

      const authorizedAt = new Date().toISOString();
      const authorization = await oauthProvider.completeAuthorization({
        request: authRequest,
        userId: `github-${authContext.actor.id}`,
        metadata: {
          clientName,
          githubLogin: authContext.actor.login,
          githubAppId: activeInstallation.githubAppId,
          githubInstallationId: activeInstallation.id,
          githubInstallationOwner: activeInstallation.account.login,
          authorizedAt,
        },
        scope: grantedScopes,
        props: {
          authKind: "mcp",
          githubUserId: authContext.actor.id,
          githubLogin: authContext.actor.login,
          githubAppId: activeInstallation.githubAppId,
          githubInstallationId: activeInstallation.id,
          clientId: authRequest.clientId,
          scopes: grantedScopes,
          authorizedAt,
        },
      });

      expireConsentCookie(context);
      return context.redirect(authorization.redirectTo, 302);
    },
  )
  .get(
    MCP_AUTHORIZE_CONTEXT_ROUTE,
    mcpOAuthProviderRequired,
    mcpAuthRequestRequired,
    async (context) => {
      const oauthProvider = context.get("mcpOAuthProvider");
      const sourceUrl = new URL(context.req.raw.url);
      const authRequest = context.get("mcpAuthRequest");

      const client = await oauthProvider.lookupClient(authRequest.clientId);
      const clientName = client?.clientName?.trim() || authRequest.clientId;
      const requestedScopes = resolveGrantedMcpScopes(authRequest.scope);

      const authContext = await readOptionalBrowserAuthorizeContext({
        request: context.req.raw,
        env: context.env,
        responseHeaders: context.res.headers,
      });
      const authorizeReturnToPath = `${MCP_AUTHORIZE_UI_ROUTE}${sourceUrl.search}`;

      if (!authContext) {
        const loginUrl = new URL(GITHUB_OAUTH_LOGIN_PATH, context.req.raw.url);
        loginUrl.searchParams.set(AUTH_RETURN_TO_PARAM, `${sourceUrl.pathname}${sourceUrl.search}`);

        return context.json({
          status: "login",
          clientName,
          loginHref: loginUrl.toString(),
        });
      }

      const deploymentGitHubApp = await requireDeploymentGitHubApp(
        createDbClient(context.env.DB),
        context.env,
      );
      const buildDeploymentAppInstallHref = (
        options: Parameters<typeof buildGitHubAppInstallHref>[0],
      ) =>
        buildGitHubAppInstallHref({
          ...options,
          appSlug: deploymentGitHubApp.slug,
        });

      if (authContext.sessionInstallationSnapshots.length === 0) {
        expireConsentCookie(context);
        return context.json({
          status: "no_installations",
          clientName,
          installHref: buildDeploymentAppInstallHref({ state: authorizeReturnToPath }),
        });
      }

      const installations = await Promise.all(
        authContext.sessionInstallationSnapshots.map(async (installation) => ({
          installation,
          repositoryCount: (
            await listInstallationRepositories(
              authContext.githubUserToken.accessToken,
              installation.id,
              { env: context.env, githubAppId: installation.githubAppId },
            )
          ).length,
          manageAccessHref: buildDeploymentAppInstallHref({
            state: authorizeReturnToPath,
            suggestedTargetId: installation.account.id,
          }),
        })),
      );
      const repositoryReadyInstallations = installations.filter(
        (installation) => installation.repositoryCount > 0,
      );

      if (repositoryReadyInstallations.length === 0) {
        expireConsentCookie(context);
        return context.json({
          status: "no_repositories",
          clientName,
          installHref: buildDeploymentAppInstallHref({ state: authorizeReturnToPath }),
          installations,
        });
      }

      const csrfToken = crypto.randomUUID();
      await setSignedCookie(
        context,
        MCP_CONSENT_COOKIE_NAME,
        JSON.stringify({
          csrfToken,
          clientId: authRequest.clientId,
          oauthState: authRequest.state,
          authRequestHash: await hashAuthRequest(authRequest),
          expiresAt: new Date(Date.now() + MCP_CONSENT_COOKIE_MAX_AGE_SECONDS * 1000).toISOString(),
        }),
        `${context.env.AUTH_COOKIE_SECRET}:mcp-consent`,
        {
          path: MCP_CONSENT_COOKIE_PATH,
          httpOnly: true,
          sameSite: "lax",
          secure: new URL(context.req.raw.url).protocol === "https:",
          maxAge: MCP_CONSENT_COOKIE_MAX_AGE_SECONDS,
        },
      );

      return context.json({
        status: "consent",
        clientName,
        requestedScopes,
        authorizeAction: `${MCP_AUTHORIZE_ROUTE}${sourceUrl.search}`,
        csrfToken,
        activeGithubInstallationId: authContext.session.activeGithubInstallationId,
        installations: repositoryReadyInstallations,
      });
    },
  );
