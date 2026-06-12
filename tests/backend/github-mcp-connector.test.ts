import { createExecutionContext } from "cloudflare:test";
import { GitHubMcpConnector } from "#/backend/nanites/github-mcp-connector.ts";

test("GitHub MCP connector exposes MCP tools under the github namespace and routes calls through the client", async () => {
  const toolCalls: unknown[] = [];
  const connector = new GitHubMcpConnector(
    createExecutionContext() as unknown as DurableObjectState,
    {
      createHeaders: async () => ({}),
      createConnection: () => ({
        name: "github",
        client: {
          callTool: async (params: unknown) => {
            toolCalls.push(params);
            return {
              content: [{ type: "text" as const, text: '{"number":21,"state":"open"}' }],
            };
          },
        },
        tools: [
          {
            name: "get_pull_request",
            description: "Get details of a pull request.",
            inputSchema: { type: "object" as const },
          },
          {
            name: "add_issue_comment",
            description: "Comment on an issue or pull request.",
            inputSchema: { type: "object" as const },
          },
        ],
      }),
    },
  );

  expect(connector.name()).toBe("github");

  const description = await connector.describe();
  expect(description.name).toBe("github");
  expect(Object.keys(description.descriptors).sort()).toEqual([
    "add_issue_comment",
    "get_pull_request",
  ]);

  const result = await connector.executeTool("get_pull_request", {
    owner: "WebMCP-org",
    repo: "nanites",
    pullNumber: 21,
  });
  expect(toolCalls).toEqual([
    {
      name: "get_pull_request",
      arguments: { owner: "WebMCP-org", repo: "nanites", pullNumber: 21 },
    },
  ]);
  expect(result).toEqual({ number: 21, state: "open" });
});
