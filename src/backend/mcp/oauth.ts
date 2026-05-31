import { parse, serialize, type SerializeOptions } from "cookie";
import { z } from "zod";
import type { AuthRequest, ClientInfo, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { ActiveInstallation } from "@nanites/contracts/auth";
import { githubInstallationIdSchema } from "@nanites/contracts/ids";
import { listInstallationRepositories, listVisibleInstallations } from "#/backend/github.ts";
import {
  AuthenticationRequiredError,
  getActorFromSession,
  requireGitHubUserToken,
  toActiveInstallations,
} from "#/backend/browser-auth/session.ts";
import { readSessionCookie } from "#/backend/browser-auth/cookies.ts";
import { GITHUB_OAUTH_LOGIN_PATH } from "#/backend/browser-auth/policy.ts";
import { resolveGrantedMcpScopes, UnsupportedMcpScopeError } from "#/backend/mcp/auth-context.ts";
import { AUTH_RETURN_TO_PARAM } from "#/shared/auth-return-to.ts";
import {
  MCP_AUTHORIZE_CONTEXT_ROUTE,
  MCP_AUTHORIZE_ROUTE,
  MCP_AUTHORIZE_UI_ROUTE,
} from "#/shared/constants/mcp.ts";
import {
  buildGitHubAppInstallOnAnotherOwnerHref,
  buildGitHubAppManageAccessHref,
} from "#/shared/github-app.ts";

const MCP_CONSENT_COOKIE_NAME = "sigvelo_mcp_consent";
const MCP_CONSENT_COOKIE_PATH = MCP_AUTHORIZE_ROUTE;
const MCP_CONSENT_MAX_AGE_SECONDS = 10 * 60;

const consentCookiePayloadSchema = z.object({
  csrfToken: z.string().min(1),
  clientId: z.string().min(1),
  oauthState: z.string().min(1),
  authRequestHash: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
});

type ConsentCookiePayload = z.infer<typeof consentCookiePayloadSchema>;

type EnvWithOAuthHelpers = Env & {
  OAUTH_PROVIDER?: OAuthHelpers;
};

interface InstallationRepositoryOption {
  readonly installation: ActiveInstallation;
  readonly repositoryCount: number;
  readonly manageAccessHref: string;
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function buildConsentCookieOptions(request: Request, overrides?: Partial<SerializeOptions>) {
  return {
    path: MCP_CONSENT_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: MCP_CONSENT_MAX_AGE_SECONDS,
    ...overrides,
  } satisfies SerializeOptions;
}

function buildExpiredConsentCookie(request: Request): string {
  return serialize(MCP_CONSENT_COOKIE_NAME, "", {
    path: MCP_CONSENT_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    expires: new Date(0),
    maxAge: 0,
  });
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function sha256Base64Url(value: string): Promise<string> {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).toString("base64url");
}

async function hashAuthRequest(authRequest: AuthRequest): Promise<string> {
  return sha256Base64Url(
    JSON.stringify({
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
    }),
  );
}

async function signConsentPayload(payload: string, env: Env): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${env.AUTH_COOKIE_SECRET}:mcp-consent`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  ).toString("base64url");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function sealConsentCookie(
  payload: ConsentCookiePayload,
  request: Request,
  env: Env,
): Promise<string> {
  const payloadJson = JSON.stringify(consentCookiePayloadSchema.parse(payload));
  const encodedPayload = encodeBase64Url(payloadJson);
  const signature = await signConsentPayload(encodedPayload, env);

  return serialize(
    MCP_CONSENT_COOKIE_NAME,
    `${encodedPayload}.${signature}`,
    buildConsentCookieOptions(request),
  );
}

async function readConsentCookie(request: Request, env: Env): Promise<ConsentCookiePayload | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const sealedValue = parse(cookieHeader)[MCP_CONSENT_COOKIE_NAME];
  if (!sealedValue) {
    return null;
  }

  const [encodedPayload, signature] = sealedValue.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await signConsentPayload(encodedPayload, env);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  let decodedPayload: unknown;
  try {
    decodedPayload = JSON.parse(decodeBase64Url(encodedPayload));
  } catch {
    return null;
  }

  const payload = consentCookiePayloadSchema.safeParse(decodedPayload);
  if (!payload.success || Date.parse(payload.data.expiresAt) <= Date.now()) {
    return null;
  }

  return payload.data;
}

function requireOAuthProvider(env: Env): OAuthHelpers {
  const oauthProvider = (env as EnvWithOAuthHelpers).OAUTH_PROVIDER;
  if (!oauthProvider) {
    throw new Error("OAuth provider helpers are not available on this request.");
  }

  return oauthProvider;
}

function buildTextHeaders(headers = new Headers()): Headers {
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("content-type", "text/plain; charset=utf-8");
  return headers;
}

function buildJsonHeaders(headers = new Headers()): Headers {
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return headers;
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: buildJsonHeaders(new Headers(init?.headers)),
  });
}

function buildLoginHref(request: Request): string {
  const url = new URL(request.url);
  const loginUrl = new URL(GITHUB_OAUTH_LOGIN_PATH, request.url);
  loginUrl.searchParams.set(AUTH_RETURN_TO_PARAM, `${url.pathname}${url.search}`);
  return loginUrl.toString();
}

function getClientDisplayName(client: ClientInfo | null, authRequest: AuthRequest): string {
  return client?.clientName?.trim() || authRequest.clientId;
}

function buildOAuthProviderUserId(githubUserId: number): string {
  return `github-${githubUserId}`;
}

function buildAuthorizeRequestFromContextRequest(request: Request): Request {
  const sourceUrl = new URL(request.url);
  const authorizeUrl = new URL(MCP_AUTHORIZE_ROUTE, request.url);
  authorizeUrl.search = sourceUrl.search;

  return new Request(authorizeUrl, {
    method: "GET",
    headers: request.headers,
  });
}

function buildAuthorizeUiRedirect(request: Request): Response {
  const url = new URL(request.url);
  const uiUrl = new URL(MCP_AUTHORIZE_UI_ROUTE, request.url);
  uiUrl.search = url.search;
  return Response.redirect(uiUrl, 302);
}

function buildAuthorizeActionPath(request: Request): string {
  const url = new URL(request.url);
  return `${MCP_AUTHORIZE_ROUTE}${url.search}`;
}

function buildAuthorizeReturnToPath(request: Request): string {
  const url = new URL(request.url);
  return `${MCP_AUTHORIZE_UI_ROUTE}${url.search}`;
}

function toAuthorizeInstallationOption(option: InstallationRepositoryOption) {
  return {
    id: option.installation.id,
    repositoryCount: option.repositoryCount,
    manageAccessHref: option.manageAccessHref,
    account: {
      id: option.installation.account.id,
      login: option.installation.account.login,
      type: option.installation.account.type,
      avatar_url: option.installation.account.avatar_url,
    },
  };
}

function buildOAuthErrorRedirectLocation({
  authRequest,
  error,
  description,
}: {
  authRequest: AuthRequest;
  error: "access_denied" | "invalid_scope";
  description: string;
}): string {
  const redirectUrl = new URL(authRequest.redirectUri);
  redirectUrl.searchParams.set("error", error);
  redirectUrl.searchParams.set("error_description", description);
  redirectUrl.searchParams.set("state", authRequest.state);
  return redirectUrl.toString();
}

async function resolveAuthenticatedAuthorizeContext(request: Request, env: Env, headers: Headers) {
  const session = await readSessionCookie(request, env);
  if (!session) {
    return null;
  }

  try {
    const githubUserToken = await requireGitHubUserToken(request, env, {
      responseHeaders: headers,
    });
    const activeInstallations = toActiveInstallations(
      await listVisibleInstallations(githubUserToken.accessToken),
    );

    return {
      session,
      actor: getActorFromSession(session),
      githubUserToken,
      activeInstallations,
    };
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return null;
    }

    throw error;
  }
}

async function resolveInstallationRepositoryOptions(
  authContext: NonNullable<Awaited<ReturnType<typeof resolveAuthenticatedAuthorizeContext>>>,
  returnToPath: string,
): Promise<InstallationRepositoryOption[]> {
  return Promise.all(
    authContext.activeInstallations.map(async (installation) => {
      const repositories = await listInstallationRepositories(
        authContext.githubUserToken.accessToken,
        installation.id,
      );

      return {
        installation,
        repositoryCount: repositories.length,
        manageAccessHref: buildGitHubAppManageAccessHref({
          state: returnToPath,
          suggestedTargetId: installation.account.id,
        }),
      };
    }),
  );
}

export async function handleMcpOAuthAuthorizeContextRequest({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== MCP_AUTHORIZE_CONTEXT_ROUTE || request.method !== "GET") {
    return null;
  }

  const oauthProvider = requireOAuthProvider(env);
  const authorizeRequest = buildAuthorizeRequestFromContextRequest(request);
  let authRequest: AuthRequest;
  try {
    authRequest = await oauthProvider.parseAuthRequest(authorizeRequest);
  } catch (error) {
    return jsonResponse(
      {
        status: "invalid",
        message: `Invalid MCP authorization request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      {
        status: 400,
      },
    );
  }

  const client = await oauthProvider.lookupClient(authRequest.clientId);
  const clientName = getClientDisplayName(client, authRequest);
  let requestedScopes: ReturnType<typeof resolveGrantedMcpScopes>;
  try {
    requestedScopes = resolveGrantedMcpScopes(authRequest.scope);
  } catch (error) {
    return jsonResponse(
      {
        status: "invalid",
        message:
          error instanceof UnsupportedMcpScopeError
            ? error.message
            : `Invalid MCP authorization request: ${
                error instanceof Error ? error.message : String(error)
              }`,
      },
      {
        status: 400,
      },
    );
  }

  const headers = new Headers();
  const authContext = await resolveAuthenticatedAuthorizeContext(authorizeRequest, env, headers);
  const authorizeReturnToPath = buildAuthorizeReturnToPath(authorizeRequest);

  if (!authContext) {
    return jsonResponse(
      {
        status: "login",
        clientName,
        loginHref: buildLoginHref(authorizeRequest),
      },
      { headers },
    );
  }

  if (authContext.activeInstallations.length === 0) {
    headers.append("Set-Cookie", buildExpiredConsentCookie(authorizeRequest));
    return jsonResponse(
      {
        status: "no_installations",
        clientName,
        installHref: buildGitHubAppInstallOnAnotherOwnerHref(authorizeReturnToPath),
      },
      {
        headers,
      },
    );
  }

  const installationRepositoryOptions = await resolveInstallationRepositoryOptions(
    authContext,
    authorizeReturnToPath,
  );
  const repositoryReadyInstallations = installationRepositoryOptions.filter(
    (option) => option.repositoryCount > 0,
  );

  if (repositoryReadyInstallations.length === 0) {
    headers.append("Set-Cookie", buildExpiredConsentCookie(authorizeRequest));
    return jsonResponse(
      {
        status: "no_repositories",
        clientName,
        installHref: buildGitHubAppInstallOnAnotherOwnerHref(authorizeReturnToPath),
        installations: installationRepositoryOptions.map(toAuthorizeInstallationOption),
      },
      {
        headers,
      },
    );
  }

  const csrfToken = crypto.randomUUID();
  headers.append(
    "Set-Cookie",
    await sealConsentCookie(
      {
        csrfToken,
        clientId: authRequest.clientId,
        oauthState: authRequest.state,
        authRequestHash: await hashAuthRequest(authRequest),
        expiresAt: nowIso(MCP_CONSENT_MAX_AGE_SECONDS * 1000),
      },
      authorizeRequest,
      env,
    ),
  );

  return jsonResponse(
    {
      status: "consent",
      clientName,
      requestedScopes,
      authorizeAction: buildAuthorizeActionPath(authorizeRequest),
      csrfToken,
      activeGithubInstallationId: authContext.session.activeGithubInstallationId,
      installations: repositoryReadyInstallations.map(toAuthorizeInstallationOption),
    },
    { headers },
  );
}

export async function handleMcpOAuthAuthorizeRequest({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== MCP_AUTHORIZE_ROUTE ||
    (request.method !== "GET" && request.method !== "POST")
  ) {
    return null;
  }

  if (request.method === "GET") {
    return buildAuthorizeUiRedirect(request);
  }

  const oauthProvider = requireOAuthProvider(env);
  let authRequest: AuthRequest;
  try {
    authRequest = await oauthProvider.parseAuthRequest(request);
  } catch (error) {
    return new Response(
      `Invalid MCP authorization request: ${error instanceof Error ? error.message : String(error)}`,
      {
        status: 400,
        headers: buildTextHeaders(),
      },
    );
  }
  const client = await oauthProvider.lookupClient(authRequest.clientId);
  const clientName = getClientDisplayName(client, authRequest);
  const headers = new Headers();
  const authContext = await resolveAuthenticatedAuthorizeContext(request, env, headers);

  if (!authContext || authContext.activeInstallations.length === 0) {
    return new Response("MCP authorization requires an authenticated GitHub installation.", {
      status: 401,
      headers: buildTextHeaders(headers),
    });
  }

  const formData = await request.formData();
  const consentCookie = await readConsentCookie(request, env);
  const csrfToken = formData.get("csrf_token");
  if (
    !consentCookie ||
    typeof csrfToken !== "string" ||
    csrfToken !== consentCookie.csrfToken ||
    consentCookie.clientId !== authRequest.clientId ||
    consentCookie.oauthState !== authRequest.state ||
    consentCookie.authRequestHash !== (await hashAuthRequest(authRequest))
  ) {
    return new Response("Invalid or expired MCP authorization consent.", {
      status: 400,
      headers: buildTextHeaders(headers),
    });
  }

  if (formData.get("intent") === "deny") {
    headers.set(
      "Location",
      buildOAuthErrorRedirectLocation({
        authRequest,
        error: "access_denied",
        description: "The user denied the Sigvelo MCP authorization request.",
      }),
    );
    headers.append("Set-Cookie", buildExpiredConsentCookie(request));
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  const selectedInstallation = githubInstallationIdSchema.safeParse(
    Number(formData.get("github_installation_id")),
  );
  const activeInstallation =
    selectedInstallation.success &&
    authContext.activeInstallations.find(
      (installation) => installation.id === selectedInstallation.data,
    );

  if (!activeInstallation) {
    return new Response("Selected GitHub installation is no longer available.", {
      status: 403,
      headers: buildTextHeaders(headers),
    });
  }

  const selectedInstallationRepositories = await listInstallationRepositories(
    authContext.githubUserToken.accessToken,
    activeInstallation.id,
  );
  if (selectedInstallationRepositories.length === 0) {
    headers.set(
      "Location",
      buildOAuthErrorRedirectLocation({
        authRequest,
        error: "access_denied",
        description: "The selected GitHub installation has no repositories shared with Sigvelo.",
      }),
    );
    headers.append("Set-Cookie", buildExpiredConsentCookie(request));
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  let grantedScopes: ReturnType<typeof resolveGrantedMcpScopes>;
  try {
    grantedScopes = resolveGrantedMcpScopes(authRequest.scope);
  } catch (error) {
    headers.set(
      "Location",
      buildOAuthErrorRedirectLocation({
        authRequest,
        error: "invalid_scope",
        description: error instanceof Error ? error.message : "Unsupported Sigvelo MCP scope.",
      }),
    );
    headers.append("Set-Cookie", buildExpiredConsentCookie(request));
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  const authorizedAt = nowIso();
  const authorization = await oauthProvider.completeAuthorization({
    request: authRequest,
    userId: buildOAuthProviderUserId(authContext.actor.id),
    metadata: {
      clientName,
      githubLogin: authContext.actor.login,
      githubInstallationId: activeInstallation.id,
      githubInstallationOwner: activeInstallation.account.login,
      authorizedAt,
    },
    scope: grantedScopes,
    props: {
      authKind: "mcp",
      githubUserId: authContext.actor.id,
      githubLogin: authContext.actor.login,
      githubInstallationId: activeInstallation.id,
      clientId: authRequest.clientId,
      scopes: grantedScopes,
      authorizedAt,
    },
  });

  headers.set("Location", authorization.redirectTo);
  headers.append("Set-Cookie", buildExpiredConsentCookie(request));
  return new Response(null, {
    status: 302,
    headers,
  });
}
