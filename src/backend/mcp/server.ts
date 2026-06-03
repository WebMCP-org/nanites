import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { sigveloMcpAuthPropsSchema, type SigveloMcpAuthProps } from "#/backend/mcp/auth-context.ts";
import {
  cancelNaniteRunsTool,
  createNaniteTool,
  debugNanitesTool,
  deprovisionNanitesTool,
  exploreNaniteWorkspaceTool,
  resolveAuthorizedNaniteToolRuntime,
  resetNaniteDebugTool,
  startNaniteRunTool,
  testNaniteTriggerTool,
} from "#/backend/nanites/manager-tools.ts";

type SigveloMcpToolContext = {
  env: Env;
  getProps(): SigveloMcpAuthProps | Promise<SigveloMcpAuthProps>;
};

function createSigveloNanitesMcpServer(): McpServer {
  return new McpServer(
    { name: "sigvelo-nanites", version: "0.1.0" },
    { capabilities: { tools: { listChanged: true } } },
  );
}

const whoamiToolInputSchema = z.object({});

function formatMcpToolResult(output: object): CallToolResult {
  const structuredContent = JSON.parse(JSON.stringify(output)) as Record<string, unknown>;

  return {
    structuredContent,
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
  };
}

function readOptionalManagerName(input: unknown): string | undefined {
  return typeof input === "object" &&
    input !== null &&
    "managerName" in input &&
    typeof input.managerName === "string"
    ? input.managerName
    : undefined;
}

async function resolveRuntimeForToolInput(context: SigveloMcpToolContext, input: unknown) {
  return resolveAuthorizedNaniteToolRuntime({
    env: context.env,
    props: await context.getProps(),
    surface: "mcp",
    managerName: readOptionalManagerName(input),
  });
}

function registerSigveloNaniteTools(server: McpServer, context: SigveloMcpToolContext): void {
  server.registerTool(
    "sigvelo_whoami",
    {
      title: "Inspect Sigvelo MCP authorization",
      description: "Returns the GitHub actor and installation bound to this MCP token.",
      inputSchema: whoamiToolInputSchema,
    },
    async (_input) => {
      const props = await context.getProps();
      return formatMcpToolResult({
        authKind: props.authKind,
        githubUserId: props.githubUserId,
        githubLogin: props.githubLogin,
        githubInstallationId: props.githubInstallationId,
        clientId: props.clientId,
        scopes: props.scopes,
      });
    },
  );

  server.registerTool(createNaniteTool.name, createNaniteTool.config, async (input) =>
    formatMcpToolResult(
      await createNaniteTool.handler(input, await resolveRuntimeForToolInput(context, input)),
    ),
  );

  server.registerTool(debugNanitesTool.name, debugNanitesTool.config, async (input) =>
    formatMcpToolResult(
      await debugNanitesTool.handler(input, await resolveRuntimeForToolInput(context, input)),
    ),
  );

  server.registerTool(deprovisionNanitesTool.name, deprovisionNanitesTool.config, async (input) =>
    formatMcpToolResult(
      await deprovisionNanitesTool.handler(input, await resolveRuntimeForToolInput(context, input)),
    ),
  );

  server.registerTool(startNaniteRunTool.name, startNaniteRunTool.config, async (input) =>
    formatMcpToolResult(
      await startNaniteRunTool.handler(input, await resolveRuntimeForToolInput(context, input)),
    ),
  );

  server.registerTool(cancelNaniteRunsTool.name, cancelNaniteRunsTool.config, async (input) =>
    formatMcpToolResult(
      await cancelNaniteRunsTool.handler(input, await resolveRuntimeForToolInput(context, input)),
    ),
  );

  server.registerTool(testNaniteTriggerTool.name, testNaniteTriggerTool.config, async (input) =>
    formatMcpToolResult(
      await testNaniteTriggerTool.handler(input, await resolveRuntimeForToolInput(context, input)),
    ),
  );

  server.registerTool(
    exploreNaniteWorkspaceTool.name,
    exploreNaniteWorkspaceTool.config,
    async (input) =>
      formatMcpToolResult(
        await exploreNaniteWorkspaceTool.handler(
          input,
          await resolveRuntimeForToolInput(context, input),
        ),
      ),
  );

  server.registerTool(resetNaniteDebugTool.name, resetNaniteDebugTool.config, async (input) =>
    formatMcpToolResult(
      await resetNaniteDebugTool.handler(input, await resolveRuntimeForToolInput(context, input)),
    ),
  );
}

export class SigveloMcpAgent extends McpAgent<Env, Record<string, never>, SigveloMcpAuthProps> {
  server = createSigveloNanitesMcpServer();
  initialState = {};

  async init(): Promise<void> {
    registerSigveloNaniteTools(this.server, {
      env: this.env,
      getProps: () => sigveloMcpAuthPropsSchema.parse(this.props),
    });
  }
}
