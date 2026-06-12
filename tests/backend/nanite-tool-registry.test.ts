import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { OAuthError } from "@cloudflare/workers-oauth-provider";
import {
  createSigveloNanitesMcpServer,
  INVALID_MCP_AUTH_PROPS_DESCRIPTION,
  nanitesMcpApiHandler,
  registerSigveloNaniteTools,
  requireSigveloMcpGrantProps,
} from "#/backend/mcp/index.ts";
import { deriveNaniteGitHubMcpAccess } from "#/backend/nanites/github-mcp-capabilities.ts";
import { naniteTools } from "#/backend/nanites/tools/index.ts";
import { MCP_SCOPES } from "#/mcp.ts";
import { TEST_GITHUB_APP_ID } from "../helpers/d1-baseline.ts";

test("MCP tools/list exposes Nanite tools with schemas, output schemas, and annotations", async () => {
  const server = createSigveloNanitesMcpServer();
  registerSigveloNaniteTools(server, {
    env: {} as Env,
    getProps: () => ({
      authKind: "mcp",
      githubUserId: 1,
      githubLogin: "octocat",
      githubAppId: TEST_GITHUB_APP_ID,
      githubInstallationId: 2,
      clientId: "test-client",
      scopes: [MCP_SCOPES.read, MCP_SCOPES.write],
      authorizedAt: new Date(0).toISOString(),
    }),
  });

  const client = new Client({ name: "nanite-tool-registry-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listedTools = await client.listTools();
  const listedToolByName = new Map(listedTools.tools.map((tool) => [tool.name, tool]));
  const whoami = listedToolByName.get("sigvelo_whoami");
  const createNanite = listedToolByName.get("sigvelo_create_nanite");

  expect([...listedToolByName.keys()]).toEqual(naniteTools.map((tool) => tool.name));
  expect(whoami?.annotations).toMatchObject({
    readOnlyHint: true,
    destructiveHint: false,
  });
  expect(whoami?.outputSchema).toMatchObject({ type: "object" });
  expect(createNanite?.inputSchema).toMatchObject({ type: "object" });
  expect(createNanite?.outputSchema).toMatchObject({ type: "object" });
  for (const listedTool of listedTools.tools) {
    expect(JSON.stringify(listedTool.inputSchema)).not.toContain("managerName");
  }

  await client.close();
  await server.close();
});

test("MCP token exchange rejects stored grant props that do not match the current auth schema", () => {
  expect(() =>
    requireSigveloMcpGrantProps({
      authKind: "mcp",
      githubUserId: 1,
      githubLogin: "octocat",
      githubInstallationId: 2,
      clientId: "test-client",
      scopes: [MCP_SCOPES.read],
      authorizedAt: new Date(0).toISOString(),
    }),
  ).toThrow(OAuthError);

  try {
    requireSigveloMcpGrantProps({
      authKind: "mcp",
      githubUserId: 1,
      githubLogin: "octocat",
      githubInstallationId: 2,
      clientId: "test-client",
      scopes: [MCP_SCOPES.read],
      authorizedAt: new Date(0).toISOString(),
    });
  } catch (error) {
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("invalid_grant");
    expect((error as OAuthError).description).toBe(INVALID_MCP_AUTH_PROPS_DESCRIPTION);
  }
});

test("MCP API rejects access-token props that do not match the current auth schema", async () => {
  const executionContext = createExecutionContext() as ExecutionContext & {
    props: Record<string, unknown>;
  };
  executionContext.props = {
    authKind: "mcp",
    githubUserId: 1,
    githubLogin: "octocat",
    githubInstallationId: 2,
    clientId: "test-client",
    scopes: [MCP_SCOPES.read],
    authorizedAt: new Date(0).toISOString(),
  };

  const response = await nanitesMcpApiHandler.fetch(
    new Request("http://localhost:5173/mcp"),
    {} as Env,
    executionContext,
  );

  await waitOnExecutionContext(executionContext);

  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe(
    `Bearer realm="OAuth", resource_metadata="http://localhost:5173/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="${INVALID_MCP_AUTH_PROPS_DESCRIPTION}"`,
  );
  expect(await response.json()).toEqual({
    error: "invalid_token",
    error_description: INVALID_MCP_AUTH_PROPS_DESCRIPTION,
  });
});

test("GitHub MCP issue comment tool is exposed for issue or pull request write grants", () => {
  expect(
    deriveNaniteGitHubMcpAccess({
      appPermissions: { issues: "write" },
    })?.tools,
  ).toContain("add_issue_comment");

  expect(
    deriveNaniteGitHubMcpAccess({
      appPermissions: { pull_requests: "write" },
    })?.tools,
  ).toContain("add_issue_comment");

  expect(
    deriveNaniteGitHubMcpAccess({
      appPermissions: { pull_requests: "read" },
    })?.tools,
  ).not.toContain("add_issue_comment");
});
