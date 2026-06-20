import { MCP_SCOPES } from "#/shared/constants.ts";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { INVALID_MCP_AUTH_PROPS_DESCRIPTION, nanitesMcpApiHandler } from "#/backend/mcp/index.ts";

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
