import {
  appendExpiredAuthCookies,
  AuthenticationRequiredError,
  requireSession,
} from "#/backend/browser-auth/session.ts";
import {
  MANAGER_CONVERSATION_AGENT_NAME,
  NANITE_MANAGER_NAME,
} from "#/shared/constants/nanites.ts";
import { githubInstallationIdSchema } from "@nanites/contracts/ids";
import { buildNaniteManagerKey } from "#/shared/nanites.ts";

export const AGENT_AUTH_HEADERS = {
  kind: "x-nanites-auth-kind",
  githubLogin: "x-nanites-github-login",
  githubUserId: "x-nanites-github-user-id",
  activeInstallationId: "x-nanites-active-installation-id",
} as const;

type AgentRouteTarget = {
  className: string;
  instanceName: string;
};

function toUnauthorizedAgentResponse(request: Request): Response {
  const headers = new Headers({ "content-type": "application/json" });
  appendExpiredAuthCookies(request, headers);

  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers,
  });
}

function toForbiddenAgentResponse(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 403,
    headers: {
      "content-type": "application/json",
    },
  });
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function getAgentRouteTarget(request: Request): AgentRouteTarget | null {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "agents" || !segments[1] || !segments[2]) {
    return null;
  }

  const className = decodePathSegment(segments[1]);
  const instanceName = decodePathSegment(segments[2]);
  if (!className || !instanceName) {
    return null;
  }

  return { className, instanceName };
}

function matchesNaniteAgentClass(className: string, expectedClassName: string): boolean {
  return (
    className === expectedClassName || className.toLowerCase() === expectedClassName.toLowerCase()
  );
}

function authorizeNaniteAgentScope(request: Request): Response | null {
  const routeTarget = getAgentRouteTarget(request);
  if (!routeTarget) {
    return null;
  }

  const isNaniteManager = matchesNaniteAgentClass(routeTarget.className, NANITE_MANAGER_NAME);
  const isManagerConversation = matchesNaniteAgentClass(
    routeTarget.className,
    MANAGER_CONVERSATION_AGENT_NAME,
  );
  if (!isNaniteManager && !isManagerConversation) {
    return null;
  }

  const activeInstallationId = request.headers.get(AGENT_AUTH_HEADERS.activeInstallationId);
  if (!activeInstallationId) {
    return toForbiddenAgentResponse("Active GitHub installation required.");
  }

  const installationIdResult = githubInstallationIdSchema.safeParse(Number(activeInstallationId));
  if (!installationIdResult.success) {
    return toForbiddenAgentResponse("Active GitHub installation required.");
  }

  const managerName = buildNaniteManagerKey(installationIdResult.data);

  if (isNaniteManager && routeTarget.instanceName !== managerName) {
    return toForbiddenAgentResponse("Nanite manager does not belong to the active installation.");
  }

  if (isManagerConversation && !routeTarget.instanceName.startsWith(`${managerName}:`)) {
    return toForbiddenAgentResponse(
      "Manager conversation does not belong to the active installation.",
    );
  }

  return null;
}

export async function authorizeAgentRequest(
  request: Request,
  env: Env,
): Promise<Request | Response> {
  try {
    const session = await requireSession(request, env);

    const headers = new Headers(request.headers);
    headers.set(AGENT_AUTH_HEADERS.kind, "browser-session");
    headers.set(AGENT_AUTH_HEADERS.githubLogin, session.githubLogin);
    headers.set(AGENT_AUTH_HEADERS.githubUserId, String(session.githubUserId));

    if (session.activeGithubInstallationId === null) {
      headers.delete(AGENT_AUTH_HEADERS.activeInstallationId);
    } else {
      headers.set(
        AGENT_AUTH_HEADERS.activeInstallationId,
        String(session.activeGithubInstallationId),
      );
    }

    const authorizedRequest = new Request(request, { headers });
    return authorizeNaniteAgentScope(authorizedRequest) ?? authorizedRequest;
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return toUnauthorizedAgentResponse(request);
    }

    throw error;
  }
}
