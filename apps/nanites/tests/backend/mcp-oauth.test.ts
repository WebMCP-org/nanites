import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { githubInstallationIdSchema, githubUserIdSchema } from "@nanites/contracts/ids";
import { sealGitHubUserTokenCookie, sealSessionCookie } from "#/backend/browser-auth/cookies.ts";
import { buildBrowserSessionExpiration } from "#/backend/browser-auth/policy.ts";
import {
  mcpAuthorizeContextOutputSchema,
  mcpJsonRpcRequestSchema,
  oauthAuthorizationServerMetadataSchema,
  oauthClientRegistrationRequestSchema,
  oauthClientRegistrationResponseSchema,
  oauthProtectedResourceMetadataSchema,
  oauthTokenResponseSchema,
} from "#/backend/orpc/contracts/mcp-openapi.ts";
import {
  MCP_AUTHORIZE_CONTEXT_ROUTE,
  MCP_AUTHORIZE_UI_ROUTE,
  MCP_ROUTE,
  MCP_SCOPES,
} from "#/shared/constants/mcp.ts";
import worker from "#/server.ts";
import { mockGitHubApi } from "../helpers/github-api-mock.ts";
import { parseJsonResponse } from "../helpers/json-response.ts";

function buildGitHubApiJsonResponse(path: string, payload: unknown, init?: ResponseInit): Response {
  const response = Response.json(payload, init);
  Object.defineProperty(response, "url", {
    configurable: true,
    value: `https://api.github.com${path}`,
  });
  return response;
}

function buildInstallationRepositoriesRoute(githubInstallationId: number, repositoryCount = 1) {
  return {
    path: new RegExp(String.raw`/user/installations/${githubInstallationId}/repositories(\?.*)?$`),
    response: () =>
      buildGitHubApiJsonResponse(
        `/user/installations/${githubInstallationId}/repositories?per_page=100`,
        {
          total_count: repositoryCount,
          repositories: Array.from({ length: repositoryCount }, (_, index) => ({
            id: 9000 + index,
          })),
        },
      ),
  };
}

function collectSetCookieHeaders(response: Response): string[] {
  return [...response.headers.entries()]
    .filter(([name]) => name.toLowerCase() === "set-cookie")
    .map(([, value]) => value);
}

async function registerPublicMcpClient(): Promise<string> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("http://example.com/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        oauthClientRegistrationRequestSchema.parse({
          client_name: "Codex MCP",
          redirect_uris: ["https://client.example/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      ),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(201);
  const registration = await parseJsonResponse(response, oauthClientRegistrationResponseSchema);
  return registration.client_id;
}

const TEST_CODE_VERIFIER = "mcp-test-code-verifier-1234567890123456789012345678901234567890";
const TEST_CODE_CHALLENGE = "CKdpQoW9-7MWdZknnP_ECb5fEMRMu91rd0zvm5C0Jso";

function buildAuthorizeUrl(
  clientId: string,
  scope: string | null = `${MCP_SCOPES.read} ${MCP_SCOPES.write}`,
): string {
  const url = new URL("http://example.com/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", "https://client.example/callback");
  if (scope !== null) {
    url.searchParams.set("scope", scope);
  }
  url.searchParams.set("state", "mcp-client-state");
  url.searchParams.set("code_challenge", TEST_CODE_CHALLENGE);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", "http://example.com/mcp");
  return url.toString();
}

async function buildAuthenticatedCookieHeader(
  requestUrl: string,
  githubInstallationId: number,
): Promise<string> {
  const request = new Request(requestUrl);
  const expiresAt = buildBrowserSessionExpiration();
  const sessionCookie = await sealSessionCookie(
    {
      githubUserId: githubUserIdSchema.parse(7),
      githubLogin: "alex",
      activeGithubInstallationId: githubInstallationIdSchema.parse(githubInstallationId),
      expiresAt,
    },
    request,
    env,
  );
  const githubUserTokenCookie = await sealGitHubUserTokenCookie(
    {
      accessToken: "test-user-token",
      expiresAt,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    },
    request,
    env,
  );

  return [sessionCookie, githubUserTokenCookie].map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

test("MCP OAuth metadata advertises Sigvelo authorization endpoints and CIMD support", async () => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("http://example.com/.well-known/oauth-authorization-server"),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(200);
  const metadata = await parseJsonResponse(response, oauthAuthorizationServerMetadataSchema);
  expect(metadata).toMatchObject({
    authorization_endpoint: "http://example.com/authorize",
    token_endpoint: "http://example.com/oauth/token",
    registration_endpoint: "http://example.com/oauth/register",
    client_id_metadata_document_supported: true,
    scopes_supported: ["nanites:read", "nanites:write"],
  });
});

test("MCP route challenges unauthenticated clients with protected resource metadata", async () => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://example.com${MCP_ROUTE}`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(
        mcpJsonRpcRequestSchema.parse({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test-client", version: "0.0.0" },
          },
        }),
      ),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain(
    'resource_metadata="http://example.com/.well-known/oauth-protected-resource/mcp"',
  );

  const metadataCtx = createExecutionContext();
  const metadataResponse = await worker.fetch(
    new Request("http://example.com/.well-known/oauth-protected-resource/mcp"),
    env,
    metadataCtx,
  );
  await waitOnExecutionContext(metadataCtx);

  expect(metadataResponse.status).toBe(200);
  const metadata = await parseJsonResponse(metadataResponse, oauthProtectedResourceMetadataSchema);
  expect(metadata).toMatchObject({
    resource: "http://example.com/mcp",
    authorization_servers: ["http://example.com"],
    bearer_methods_supported: ["header"],
    scopes_supported: [MCP_SCOPES.read, MCP_SCOPES.write],
  });
});

test("MCP authorization asks unauthenticated users to log in with GitHub", async () => {
  const clientId = await registerPublicMcpClient();
  const ctx = createExecutionContext();
  const authorizeUrl = buildAuthorizeUrl(clientId);
  const response = await worker.fetch(new Request(authorizeUrl), env, ctx);
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toContain(MCP_AUTHORIZE_UI_ROUTE);

  const contextCtx = createExecutionContext();
  const contextResponse = await worker.fetch(
    new Request(`http://example.com${MCP_AUTHORIZE_CONTEXT_ROUTE}${new URL(authorizeUrl).search}`),
    env,
    contextCtx,
  );
  await waitOnExecutionContext(contextCtx);

  expect(contextResponse.status).toBe(200);
  const context = await parseJsonResponse(contextResponse, mcpAuthorizeContextOutputSchema);
  expect(context).toMatchObject({
    status: "login",
    clientName: "Codex MCP",
    loginHref: expect.stringContaining("/auth/github/login?"),
  });
});

test("MCP authorization rejects unsupported scopes and defaults empty scope to read-only", async () => {
  const githubInstallationId = 123;
  const clientId = await registerPublicMcpClient();
  const invalidAuthorizeUrl = buildAuthorizeUrl(clientId, `${MCP_SCOPES.read} github:repo`);
  const cookie = await buildAuthenticatedCookieHeader(invalidAuthorizeUrl, githubInstallationId);

  const invalidCtx = createExecutionContext();
  const invalidResponse = await worker.fetch(
    new Request(
      `http://example.com${MCP_AUTHORIZE_CONTEXT_ROUTE}${new URL(invalidAuthorizeUrl).search}`,
      {
        headers: { cookie },
      },
    ),
    env,
    invalidCtx,
  );
  await waitOnExecutionContext(invalidCtx);

  expect(invalidResponse.status).toBe(400);
  const invalidContext = await parseJsonResponse(invalidResponse, mcpAuthorizeContextOutputSchema);
  expect(invalidContext).toMatchObject({
    status: "invalid",
    message: expect.stringContaining("github:repo"),
  });

  const readOnlyAuthorizeUrl = buildAuthorizeUrl(clientId, null);
  const restoreFetch = mockGitHubApi([
    {
      path: /\/user\/installations(\?.*)?$/,
      response: () =>
        buildGitHubApiJsonResponse("/user/installations?per_page=100", {
          total_count: 1,
          installations: [
            {
              id: githubInstallationId,
              suspended_at: null,
              account: {
                id: 456,
                login: "WebMCP-org",
                type: "Organization",
                avatar_url: "https://avatars.githubusercontent.com/u/456",
              },
            },
          ],
        }),
    },
    buildInstallationRepositoriesRoute(githubInstallationId),
  ]);

  try {
    const readOnlyCtx = createExecutionContext();
    const readOnlyResponse = await worker.fetch(
      new Request(
        `http://example.com${MCP_AUTHORIZE_CONTEXT_ROUTE}${new URL(readOnlyAuthorizeUrl).search}`,
        {
          headers: { cookie },
        },
      ),
      env,
      readOnlyCtx,
    );
    await waitOnExecutionContext(readOnlyCtx);

    expect(readOnlyResponse.status).toBe(200);
    const readOnlyContext = await parseJsonResponse(
      readOnlyResponse,
      mcpAuthorizeContextOutputSchema,
    );
    expect(readOnlyContext).toMatchObject({
      status: "consent",
      requestedScopes: [MCP_SCOPES.read],
    });
  } finally {
    restoreFetch();
  }
});

test("MCP authorization teaches repository access setup before consent", async () => {
  const githubInstallationId = 123;
  const clientId = await registerPublicMcpClient();
  const authorizeUrl = buildAuthorizeUrl(clientId);
  const cookie = await buildAuthenticatedCookieHeader(authorizeUrl, githubInstallationId);
  const restoreFetch = mockGitHubApi([
    {
      path: /\/user\/installations(\?.*)?$/,
      response: () =>
        buildGitHubApiJsonResponse("/user/installations?per_page=100", {
          total_count: 1,
          installations: [
            {
              id: githubInstallationId,
              suspended_at: null,
              account: {
                id: 456,
                login: "WebMCP-org",
                type: "Organization",
                avatar_url: "https://avatars.githubusercontent.com/u/456",
              },
            },
          ],
        }),
    },
    buildInstallationRepositoriesRoute(githubInstallationId, 0),
  ]);

  try {
    const contextCtx = createExecutionContext();
    const response = await worker.fetch(
      new Request(
        `http://example.com${MCP_AUTHORIZE_CONTEXT_ROUTE}${new URL(authorizeUrl).search}`,
        {
          headers: { cookie },
        },
      ),
      env,
      contextCtx,
    );
    await waitOnExecutionContext(contextCtx);

    expect(response.status).toBe(200);
    const context = await parseJsonResponse(response, mcpAuthorizeContextOutputSchema);
    expect(context).toMatchObject({
      status: "no_repositories",
      clientName: "Codex MCP",
      installHref: expect.stringContaining("state=%2Fmcp-authorize%3F"),
      installations: [
        {
          id: githubInstallationId,
          repositoryCount: 0,
          manageAccessHref: expect.stringContaining("suggested_target_id=456"),
          account: {
            id: 456,
            login: "WebMCP-org",
          },
        },
      ],
    });
  } finally {
    restoreFetch();
  }
});

test("MCP authorization completes with a Sigvelo token grant bound to a GitHub installation", async () => {
  const activeGithubInstallationId = 123;
  const selectedGithubInstallationId = 456;
  const clientId = await registerPublicMcpClient();
  const authorizeUrl = buildAuthorizeUrl(clientId);
  const cookie = await buildAuthenticatedCookieHeader(authorizeUrl, activeGithubInstallationId);
  const restoreFetch = mockGitHubApi([
    {
      path: /\/user\/installations(\?.*)?$/,
      response: () =>
        buildGitHubApiJsonResponse("/user/installations?per_page=100", {
          total_count: 2,
          installations: [
            {
              id: activeGithubInstallationId,
              suspended_at: null,
              account: {
                id: 111,
                login: "OK-Experiments",
                type: "Organization",
                avatar_url: "https://avatars.githubusercontent.com/u/111",
              },
            },
            {
              id: selectedGithubInstallationId,
              suspended_at: null,
              account: {
                id: 222,
                login: "WebMCP-org",
                type: "Organization",
                avatar_url: "https://avatars.githubusercontent.com/u/222",
              },
            },
          ],
        }),
    },
    buildInstallationRepositoriesRoute(activeGithubInstallationId),
    buildInstallationRepositoriesRoute(selectedGithubInstallationId),
  ]);

  try {
    const contextCtx = createExecutionContext();
    const consentResponse = await worker.fetch(
      new Request(
        `http://example.com${MCP_AUTHORIZE_CONTEXT_ROUTE}${new URL(authorizeUrl).search}`,
        {
          headers: { cookie },
        },
      ),
      env,
      contextCtx,
    );
    await waitOnExecutionContext(contextCtx);

    expect(consentResponse.status).toBe(200);
    const consent = await parseJsonResponse(consentResponse, mcpAuthorizeContextOutputSchema);
    expect(consent).toMatchObject({
      status: "consent",
      csrfToken: expect.any(String),
      authorizeAction: expect.stringContaining("/authorize?"),
    });
    if (consent.status !== "consent") {
      throw new Error(`Expected consent context, received ${consent.status}`);
    }

    const consentCookie = collectSetCookieHeaders(consentResponse)
      .map((value) => value.split(";", 1)[0])
      .find((value) => value.startsWith("sigvelo_mcp_consent="));
    expect(consentCookie).toBeTruthy();

    const postCtx = createExecutionContext();
    const completeResponse = await worker.fetch(
      new Request(`http://example.com${consent.authorizeAction}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: `${cookie}; ${consentCookie}`,
        },
        body: new URLSearchParams({
          csrf_token: consent.csrfToken,
          github_installation_id: String(selectedGithubInstallationId),
        }),
      }),
      env,
      postCtx,
    );
    await waitOnExecutionContext(postCtx);

    expect(completeResponse.status).toBe(302);
    const redirectLocation = completeResponse.headers.get("location");
    expect(redirectLocation).toMatch(/^https:\/\/client\.example\/callback\?/);
    expect(redirectLocation).toContain("state=mcp-client-state");
    expect(redirectLocation).toContain("code=");
    const code = redirectLocation ? new URL(redirectLocation).searchParams.get("code") : null;
    expect(code?.split(":")).toHaveLength(3);
    expect(code?.startsWith("github-7:")).toBe(true);
    expect(code).toBeTruthy();

    const tokenCtx = createExecutionContext();
    const tokenResponse = await worker.fetch(
      new Request("http://example.com/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code: code ?? "",
          redirect_uri: "https://client.example/callback",
          code_verifier: TEST_CODE_VERIFIER,
          scope: MCP_SCOPES.read,
        }),
      }),
      env,
      tokenCtx,
    );
    await waitOnExecutionContext(tokenCtx);

    expect(tokenResponse.status).toBe(200);
    const token = await parseJsonResponse(tokenResponse, oauthTokenResponseSchema);
    expect(token).toMatchObject({
      token_type: "bearer",
      scope: MCP_SCOPES.read,
      access_token: expect.any(String),
    });

    const initializeCtx = createExecutionContext();
    const initializeResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "test-client", version: "0.0.0" },
            },
          }),
        ),
      }),
      env,
      initializeCtx,
    );
    await waitOnExecutionContext(initializeCtx);

    expect(initializeResponse.status).toBe(200);
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    const mcpHeaders = {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token.access_token}`,
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    };

    const toolsCtx = createExecutionContext();
    const toolsResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: mcpHeaders,
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          }),
        ),
      }),
      env,
      toolsCtx,
    );
    await waitOnExecutionContext(toolsCtx);

    expect(toolsResponse.status).toBe(200);
    const toolsText = await toolsResponse.text();
    expect(toolsText).not.toContain('"name":"search"');
    expect(toolsText).not.toContain('"name":"execute"');
    expect(toolsText).not.toContain("sigvelo_get_manager_state");
    expect(toolsText).toContain("sigvelo_whoami");
    expect(toolsText).toContain("sigvelo_create_nanite");
    expect(toolsText).toContain("sigvelo_debug_nanites");
    expect(toolsText).toContain("sigvelo_deprovision_nanites");
    expect(toolsText).toContain("sigvelo_start_nanite_run");
    expect(toolsText).toContain("sigvelo_cancel_nanite_runs");
    expect(toolsText).toContain("sigvelo_test_nanite_trigger");
    expect(toolsText).toContain("sigvelo_explore_nanite_workspace");
    expect(toolsText).toContain("sigvelo_reset_nanite_debug");
    expect(toolsText).not.toContain("sigvelo_poke_nanite");

    const whoamiCtx = createExecutionContext();
    const whoamiResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: mcpHeaders,
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "sigvelo_whoami",
              arguments: {},
            },
          }),
        ),
      }),
      env,
      whoamiCtx,
    );
    await waitOnExecutionContext(whoamiCtx);

    expect(whoamiResponse.status).toBe(200);
    const whoamiText = await whoamiResponse.text();
    const whoamiEvent = JSON.parse(
      whoamiText
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length) ?? "{}",
    );
    const whoamiPayload = JSON.parse(whoamiEvent.result.content[0].text);
    expect(whoamiPayload).toMatchObject({
      githubInstallationId: selectedGithubInstallationId,
      scopes: [MCP_SCOPES.read],
    });
    expect(whoamiEvent.result.structuredContent).toMatchObject({
      githubInstallationId: selectedGithubInstallationId,
      scopes: [MCP_SCOPES.read],
    });

    expect(token.refresh_token).toBeTruthy();
    const writeTokenCtx = createExecutionContext();
    const writeTokenResponse = await worker.fetch(
      new Request("http://example.com/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: token.refresh_token ?? "",
          scope: `${MCP_SCOPES.read} ${MCP_SCOPES.write}`,
        }),
      }),
      env,
      writeTokenCtx,
    );
    await waitOnExecutionContext(writeTokenCtx);

    expect(writeTokenResponse.status).toBe(200);
    const writeToken = await parseJsonResponse(writeTokenResponse, oauthTokenResponseSchema);
    expect(writeToken).toMatchObject({
      token_type: "bearer",
      scope: `${MCP_SCOPES.read} ${MCP_SCOPES.write}`,
      access_token: expect.any(String),
    });

    const createNaniteCtx = createExecutionContext();
    const createNaniteResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          ...mcpHeaders,
          authorization: `Bearer ${writeToken.access_token}`,
        },
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: {
              name: "sigvelo_create_nanite",
              arguments: {
                manifest: {
                  id: "mcp-created-docs-syncer",
                  name: "MCP created docs syncer",
                  description: "Created through the real MCP create Nanite tool path.",
                  trigger: { type: "manual" },
                  permissions: {},
                },
                enabled: true,
              },
            },
          }),
        ),
      }),
      env,
      createNaniteCtx,
    );
    await waitOnExecutionContext(createNaniteCtx);

    expect(createNaniteResponse.status).toBe(200);
    const createNaniteText = await createNaniteResponse.text();
    expect(createNaniteText).toContain("mcp-created-docs-syncer");
    expect(createNaniteText).toContain("manifest-");
    expect(createNaniteText).toContain("manifestHash");

    const debugNanitesCtx = createExecutionContext();
    const debugNanitesResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          ...mcpHeaders,
          authorization: `Bearer ${writeToken.access_token}`,
        },
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: {
              name: "sigvelo_debug_nanites",
              arguments: {
                naniteId: "mcp-created-docs-syncer",
                include: ["nanites", "runs", "runtimeActivity", "manifest"],
              },
            },
          }),
        ),
      }),
      env,
      debugNanitesCtx,
    );
    await waitOnExecutionContext(debugNanitesCtx);

    expect(debugNanitesResponse.status).toBe(200);
    const debugNanitesText = await debugNanitesResponse.text();
    expect(debugNanitesText).toContain("mcp-created-docs-syncer");
    expect(debugNanitesText).toContain("MCP created docs syncer");
    expect(debugNanitesText).not.toContain('"state"');

    const cancelRunsCtx = createExecutionContext();
    const cancelRunsResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          ...mcpHeaders,
          authorization: `Bearer ${writeToken.access_token}`,
        },
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 6,
            method: "tools/call",
            params: {
              name: "sigvelo_cancel_nanite_runs",
              arguments: {
                naniteId: "mcp-created-docs-syncer",
                reason: "MCP smoke test stale-run cancellation check.",
              },
            },
          }),
        ),
      }),
      env,
      cancelRunsCtx,
    );
    await waitOnExecutionContext(cancelRunsCtx);

    expect(cancelRunsResponse.status).toBe(200);
    const cancelRunsText = await cancelRunsResponse.text();
    expect(cancelRunsText).toContain('\\"ok\\": true');
    expect(cancelRunsText).toContain("canceledRuns");

    const createStaleNaniteCtx = createExecutionContext();
    const createStaleNaniteResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          ...mcpHeaders,
          authorization: `Bearer ${writeToken.access_token}`,
        },
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 7,
            method: "tools/call",
            params: {
              name: "sigvelo_create_nanite",
              arguments: {
                manifest: {
                  id: "mcp-stale-docs-syncer",
                  name: "MCP stale docs syncer",
                  description: "Created so the MCP deprovision path can remove stale Nanites.",
                  trigger: { type: "manual" },
                  permissions: {},
                },
                enabled: true,
              },
            },
          }),
        ),
      }),
      env,
      createStaleNaniteCtx,
    );
    await waitOnExecutionContext(createStaleNaniteCtx);

    expect(createStaleNaniteResponse.status).toBe(200);

    const previousStaleFixture = Reflect.get(env, "NANITES_LLM_FIXTURE");
    Reflect.set(env, "NANITES_LLM_FIXTURE", "complete");
    try {
      const startStaleNaniteCtx = createExecutionContext();
      const startStaleNaniteResponse = await worker.fetch(
        new Request("http://example.com/mcp", {
          method: "POST",
          headers: {
            ...mcpHeaders,
            authorization: `Bearer ${writeToken.access_token}`,
          },
          body: JSON.stringify(
            mcpJsonRpcRequestSchema.parse({
              jsonrpc: "2.0",
              id: 17,
              method: "tools/call",
              params: {
                name: "sigvelo_start_nanite_run",
                arguments: {
                  naniteId: "mcp-stale-docs-syncer",
                  message: "Create child Think state before deprovisioning this Nanite.",
                  waitForTerminalOutcome: true,
                  timeoutMs: 20_000,
                },
              },
            }),
          ),
        }),
        env,
        startStaleNaniteCtx,
      );
      await waitOnExecutionContext(startStaleNaniteCtx);

      expect(startStaleNaniteResponse.status).toBe(200);
      const startStaleNaniteText = await startStaleNaniteResponse.text();
      expect(startStaleNaniteText).toContain("mcp-stale-docs-syncer");
      expect(startStaleNaniteText).toContain('\\"status\\": \\"complete\\"');
    } finally {
      Reflect.set(env, "NANITES_LLM_FIXTURE", previousStaleFixture);
    }

    const deprovisionNanitesCtx = createExecutionContext();
    const deprovisionNanitesResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          ...mcpHeaders,
          authorization: `Bearer ${writeToken.access_token}`,
        },
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 8,
            method: "tools/call",
            params: {
              name: "sigvelo_deprovision_nanites",
              arguments: {
                naniteIds: ["mcp-stale-docs-syncer"],
                reason: "MCP smoke test stale Nanite cleanup.",
              },
            },
          }),
        ),
      }),
      env,
      deprovisionNanitesCtx,
    );
    await waitOnExecutionContext(deprovisionNanitesCtx);

    expect(deprovisionNanitesResponse.status).toBe(200);
    const deprovisionNanitesText = await deprovisionNanitesResponse.text();
    expect(deprovisionNanitesText).toContain('\\"ok\\": true');
    expect(deprovisionNanitesText).toContain("mcp-stale-docs-syncer");
    expect(deprovisionNanitesText).toContain("deprovisionedNaniteIds");

    const recreateStaleNaniteCtx = createExecutionContext();
    const recreateStaleNaniteResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          ...mcpHeaders,
          authorization: `Bearer ${writeToken.access_token}`,
        },
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 18,
            method: "tools/call",
            params: {
              name: "sigvelo_create_nanite",
              arguments: {
                manifest: {
                  id: "mcp-stale-docs-syncer",
                  name: "MCP stale docs syncer",
                  description: "Recreated to verify deprovision removed child Think state.",
                  trigger: { type: "manual" },
                  permissions: {},
                },
                enabled: true,
              },
            },
          }),
        ),
      }),
      env,
      recreateStaleNaniteCtx,
    );
    await waitOnExecutionContext(recreateStaleNaniteCtx);

    expect(recreateStaleNaniteResponse.status).toBe(200);

    const debugRecreatedStaleNaniteCtx = createExecutionContext();
    const debugRecreatedStaleNaniteResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          ...mcpHeaders,
          authorization: `Bearer ${writeToken.access_token}`,
        },
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 19,
            method: "tools/call",
            params: {
              name: "sigvelo_debug_nanites",
              arguments: {
                naniteId: "mcp-stale-docs-syncer",
                include: ["nanites", "runs", "runtimeActivity", "transcript", "submissions"],
              },
            },
          }),
        ),
      }),
      env,
      debugRecreatedStaleNaniteCtx,
    );
    await waitOnExecutionContext(debugRecreatedStaleNaniteCtx);

    expect(debugRecreatedStaleNaniteResponse.status).toBe(200);
    const debugRecreatedStaleNaniteText = await debugRecreatedStaleNaniteResponse.text();
    expect(debugRecreatedStaleNaniteText).toContain("mcp-stale-docs-syncer");
    expect(debugRecreatedStaleNaniteText).not.toContain("Unknown Nanite run");
    expect(debugRecreatedStaleNaniteText).toContain('\\"transcript\\": []');
    expect(debugRecreatedStaleNaniteText).toContain('\\"submissions\\": []');

    const exploreWorkspaceCtx = createExecutionContext();
    const exploreWorkspaceResponse = await worker.fetch(
      new Request("http://example.com/mcp", {
        method: "POST",
        headers: {
          ...mcpHeaders,
          authorization: `Bearer ${writeToken.access_token}`,
        },
        body: JSON.stringify(
          mcpJsonRpcRequestSchema.parse({
            jsonrpc: "2.0",
            id: 9,
            method: "tools/call",
            params: {
              name: "sigvelo_explore_nanite_workspace",
              arguments: {
                action: "info",
                naniteId: "mcp-created-docs-syncer",
              },
            },
          }),
        ),
      }),
      env,
      exploreWorkspaceCtx,
    );
    await waitOnExecutionContext(exploreWorkspaceCtx);

    expect(exploreWorkspaceResponse.status).toBe(200);
    const exploreWorkspaceText = await exploreWorkspaceResponse.text();
    expect(exploreWorkspaceText).toContain('\\"action\\": \\"info\\"');
    expect(exploreWorkspaceText).toContain("fileCount");

    const previousFixture = Reflect.get(env, "NANITES_LLM_FIXTURE");
    Reflect.set(env, "NANITES_LLM_FIXTURE", "complete");
    try {
      const startNaniteRunCtx = createExecutionContext();
      const startNaniteRunResponse = await worker.fetch(
        new Request("http://example.com/mcp", {
          method: "POST",
          headers: {
            ...mcpHeaders,
            authorization: `Bearer ${writeToken.access_token}`,
          },
          body: JSON.stringify(
            mcpJsonRpcRequestSchema.parse({
              jsonrpc: "2.0",
              id: 20,
              method: "tools/call",
              params: {
                name: "sigvelo_start_nanite_run",
                arguments: {
                  naniteId: "mcp-created-docs-syncer",
                  message: "MCP smoke test through the direct manual-run tool.",
                  waitForTerminalOutcome: true,
                  timeoutMs: 20_000,
                },
              },
            }),
          ),
        }),
        env,
        startNaniteRunCtx,
      );
      await waitOnExecutionContext(startNaniteRunCtx);

      expect(startNaniteRunResponse.status).toBe(200);
      const startNaniteRunText = await startNaniteRunResponse.text();
      expect(startNaniteRunText).toContain("mcp-created-docs-syncer");
      expect(startNaniteRunText).toContain('\\"status\\": \\"complete\\"');
    } finally {
      Reflect.set(env, "NANITES_LLM_FIXTURE", previousFixture);
    }
  } finally {
    restoreFetch();
  }
});
