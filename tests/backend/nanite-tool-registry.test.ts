import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSigveloNanitesMcpServer, registerSigveloNaniteTools } from "#/backend/mcp/index.ts";
import { naniteTools } from "#/backend/nanites/tools/index.ts";
import { MCP_SCOPES } from "#/mcp.ts";

test("MCP tools/list exposes Nanite tools with schemas, output schemas, and annotations", async () => {
  const server = createSigveloNanitesMcpServer();
  registerSigveloNaniteTools(server, {
    env: {} as Env,
    getProps: () => ({
      authKind: "mcp",
      githubUserId: 1,
      githubLogin: "octocat",
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
