import { getAgentByName } from "agents";
import { Hono, type Context } from "hono";
import { validator } from "hono/validator";
import { agentsMiddleware } from "hono-agents";
import { authorizeAgentRequest } from "#/backend/browser-auth/agent-request.ts";
import {
  appendExpiredAuthCookies,
  AuthenticationRequiredError,
  buildBrowserNanitesContext,
  clearRevokedSessionSelectionIfNeeded,
  extendBrowserSession,
  isGitHubUserTokenAuthFailure,
  requireActiveGithubInstallationId,
  requireGitHubUserToken,
  requireSession,
  readSessionInstallationSnapshots,
  selectSessionInstallationSnapshot,
  SessionInstallationSnapshotRequiredError,
} from "#/backend/browser-auth/session.ts";
import {
  clearGitHubOAuthStateCookie,
  clearGitHubUserTokenCookie,
  clearSessionCookie,
  readSessionCookie,
} from "#/backend/browser-auth/cookies.ts";
import {
  GITHUB_OAUTH_CALLBACK_PATH,
  GITHUB_OAUTH_LOGIN_PATH,
} from "#/backend/browser-auth/policy.ts";
import {
  handleGitHubLoginRequest,
  handleGitHubOAuthCallbackRequest,
} from "#/backend/browser-auth/routes.ts";
import {
  handleTestAuthRequest,
  TEST_AUTH_MINT_SESSION_PATH,
} from "#/backend/browser-auth/test-auth.ts";
import { handleGitHubWebhook, listVisibleInstallations } from "#/backend/github.ts";
import {
  handleMcpOAuthAuthorizeContextRequest,
  handleMcpOAuthAuthorizeRequest,
} from "#/backend/mcp/oauth.ts";
import type { SigveloNaniteManager } from "#/backend/nanites/host.ts";
import { MCP_AUTHORIZE_CONTEXT_ROUTE, MCP_AUTHORIZE_ROUTE } from "#/shared/constants/mcp.ts";
import { buildNaniteManagerKey } from "#/shared/nanites.ts";

type WorkerHonoEnv = {
  Bindings: Env;
};

type WorkerContext = Context<WorkerHonoEnv>;

const GITHUB_WEBHOOK_ROUTE = "/api/github/webhook";
const AUTH_API_ERROR_CODES = {
  authenticationRequired: "authentication_required",
  activeInstallationRequired: "active_installation_required",
  installationAccessRevoked: "installation_access_revoked",
} as const;

function authApiErrorResponse(context: WorkerContext, error: unknown, headers: Headers) {
  if (error instanceof AuthenticationRequiredError || isGitHubUserTokenAuthFailure(error)) {
    appendExpiredAuthCookies(context.req.raw, headers);
    return context.json(
      { code: AUTH_API_ERROR_CODES.authenticationRequired },
      { status: 401, headers },
    );
  }

  if (error instanceof SessionInstallationSnapshotRequiredError) {
    return context.json(
      { code: AUTH_API_ERROR_CODES.activeInstallationRequired },
      { status: 403, headers },
    );
  }

  throw error;
}

async function requireBrowserGitHubAccess(context: WorkerContext, headers: Headers) {
  const session = await requireSession(context.req.raw, context.env);
  const githubUserToken = await requireGitHubUserToken(context.req.raw, context.env, {
    responseHeaders: headers,
  });

  return { githubUserToken, session };
}

async function handleGitHubChatSdkWebhook(request: Request, env: Env): Promise<Response> {
  const ingress = await getAgentByName(env.SigveloChatIngress, "default");
  return ingress.fetch(request);
}

const activeInstallationInput = validator("json", (value): { githubInstallationId: number } => {
  return value as { githubInstallationId: number };
});

export const nanitesHttpApp = new Hono<WorkerHonoEnv>()
  .get(TEST_AUTH_MINT_SESSION_PATH, async (context) => {
    if (context.env.ALLOW_TEST_AUTH !== "true") {
      return context.text("Not found", 404);
    }

    return (
      (await handleTestAuthRequest({
        request: context.req.raw,
        env: context.env,
      })) ?? context.text("Not found", 404)
    );
  })
  .all(MCP_AUTHORIZE_ROUTE, async (context) => {
    return (
      (await handleMcpOAuthAuthorizeRequest({
        request: context.req.raw,
        env: context.env,
      })) ?? context.text("Not found", 404)
    );
  })
  .get(GITHUB_OAUTH_LOGIN_PATH, (context) => {
    return handleGitHubLoginRequest(context.req.raw, context.env);
  })
  .get(GITHUB_OAUTH_CALLBACK_PATH, (context) => {
    return handleGitHubOAuthCallbackRequest({
      request: context.req.raw,
      env: context.env,
    });
  })
  .post(GITHUB_WEBHOOK_ROUTE, async (context) => {
    const gitHubEvent = context.req.header("x-github-event");
    if (gitHubEvent === "ping") {
      return context.text("pong");
    }

    if (gitHubEvent === "issue_comment" || gitHubEvent === "pull_request_review_comment") {
      return handleGitHubChatSdkWebhook(context.req.raw, context.env);
    }

    return handleGitHubWebhook(context.req.raw, context.env, context.executionCtx);
  })
  .get(MCP_AUTHORIZE_CONTEXT_ROUTE, async (context) => {
    return (
      (await handleMcpOAuthAuthorizeContextRequest({
        request: context.req.raw,
        env: context.env,
      })) ?? context.text("Not found", 404)
    );
  })
  .get("/api/auth/session/optional", async (context) => {
    const session = await readSessionCookie(context.req.raw, context.env);
    return context.json(
      session
        ? buildBrowserNanitesContext(session, session.sessionInstallationSnapshot ?? null)
        : null,
    );
  })
  .get("/api/auth/installations/visible", async (context) => {
    const headers = new Headers();

    try {
      const { githubUserToken, session } = await requireBrowserGitHubAccess(context, headers);
      const installations = readSessionInstallationSnapshots(
        await listVisibleInstallations(githubUserToken.accessToken),
      );
      await clearRevokedSessionSelectionIfNeeded({
        req: context.req.raw,
        env: context.env,
        session,
        resHeaders: headers,
        sessionInstallationSnapshots: installations,
      });

      return context.json({ installations }, { headers });
    } catch (error) {
      return authApiErrorResponse(context, error, headers);
    }
  })
  .post("/api/auth/installations/active", activeInstallationInput, async (context) => {
    const headers = new Headers();

    try {
      const { githubInstallationId } = context.req.valid("json");
      if (!Number.isInteger(githubInstallationId) || githubInstallationId <= 0) {
        return context.json(
          { error: "githubInstallationId must be a positive integer." },
          {
            status: 400,
            headers,
          },
        );
      }

      const { githubUserToken, session } = await requireBrowserGitHubAccess(context, headers);
      const installations = await listVisibleInstallations(githubUserToken.accessToken);
      const sessionInstallationSnapshots = readSessionInstallationSnapshots(installations);
      const activeInstallation =
        sessionInstallationSnapshots.find(
          (installation) => installation.id === githubInstallationId,
        ) ?? null;

      if (!activeInstallation) {
        await clearRevokedSessionSelectionIfNeeded({
          req: context.req.raw,
          env: context.env,
          session,
          resHeaders: headers,
          sessionInstallationSnapshots,
        });

        return context.json(
          {
            code: AUTH_API_ERROR_CODES.installationAccessRevoked,
            githubInstallationId,
          },
          { status: 403, headers },
        );
      }

      const nextSession = await extendBrowserSession(
        context.req.raw,
        context.env,
        selectSessionInstallationSnapshot(session, githubInstallationId, activeInstallation),
        headers,
      );

      return context.json(buildBrowserNanitesContext(nextSession, activeInstallation), { headers });
    } catch (error) {
      return authApiErrorResponse(context, error, headers);
    }
  })
  .post("/api/auth/session/logout", (context) => {
    const headers = new Headers();
    headers.append("Set-Cookie", clearSessionCookie(context.req.raw));
    headers.append("Set-Cookie", clearGitHubUserTokenCookie(context.req.raw));
    headers.append("Set-Cookie", clearGitHubOAuthStateCookie(context.req.raw));

    return context.body(null, { status: 204, headers });
  })
  .get("/api/nanites/manager/:managerName", async (context) => {
    const headers = new Headers();

    try {
      const session = await requireSession(context.req.raw, context.env);
      const activeGithubInstallationId = requireActiveGithubInstallationId(session);
      const managerName = context.req.param("managerName");

      if (managerName !== buildNaniteManagerKey(activeGithubInstallationId)) {
        return context.json(
          {
            code: AUTH_API_ERROR_CODES.activeInstallationRequired,
            githubInstallationId: activeGithubInstallationId,
          },
          { status: 403, headers },
        );
      }

      const manager = await getAgentByName<Env, SigveloNaniteManager>(
        context.env.SigveloNaniteManager,
        managerName,
      );

      return context.json({ managerName, state: await manager.getSnapshot() }, { headers });
    } catch (error) {
      return authApiErrorResponse(context, error, headers);
    }
  });

nanitesHttpApp.use("/agents/*", async (context, next) => {
  const middleware = agentsMiddleware<WorkerHonoEnv>({
    options: {
      onBeforeConnect: (request) => authorizeAgentRequest(request, context.env),
      onBeforeRequest: (request) => authorizeAgentRequest(request, context.env),
    },
  });

  return middleware(context, next);
});

nanitesHttpApp.notFound((context) => context.text("Not found", 404));

export type NanitesHttpApp = typeof nanitesHttpApp;
