import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSigveloNanitesMcpServer, registerSigveloNaniteTools } from "#/backend/mcp/index.ts";
import { createSigveloThinkTools, naniteTools } from "#/backend/nanites/tools/index.ts";
import { MCP_SCOPES } from "#/mcp.ts";

test("Nanite tool registry declares the canonical manager tools explicitly", () => {
  expect(naniteTools.map((tool) => tool.name)).toEqual([
    "sigvelo_whoami",
    "sigvelo_create_nanite",
    "sigvelo_debug_nanites",
    "sigvelo_deprovision_nanites",
    "sigvelo_start_nanite_run",
    "sigvelo_cancel_nanite_runs",
    "sigvelo_test_nanite_trigger",
    "sigvelo_explore_nanite_workspace",
    "sigvelo_reset_nanite_debug",
  ]);
});

test("Nanite tool names do not drift into duplicate MCP registrations", () => {
  const toolNames = naniteTools.map((tool) => tool.name);
  expect(new Set(toolNames).size).toBe(toolNames.length);
});

test("Nanite tools use flattened MCP SDK metadata", () => {
  for (const tool of naniteTools) {
    expect(tool).toHaveProperty("title");
    expect(tool).toHaveProperty("description");
    expect(tool).toHaveProperty("inputSchema");
    expect(tool).toHaveProperty("outputSchema");
    expect(tool).toHaveProperty("execute");
    expect(tool).not.toHaveProperty("config");
    expect(tool).not.toHaveProperty("handler");
  }
});

test("Think tools are translated from the same Sigvelo registry", () => {
  const thinkTools = createSigveloThinkTools({
    env: {} as Env,
    getProps: () => null,
  });

  expect(Object.keys(thinkTools)).toEqual(naniteTools.map((tool) => tool.name));
  expect(thinkTools.sigvelo_whoami).toMatchObject({
    title: "Inspect Sigvelo authorization",
    description: "Returns the GitHub actor and installation bound to this tool session.",
  });
});

test("MCP tools/list exposes schemas, output schemas, and annotations", async () => {
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

  await client.close();
  await server.close();
});
