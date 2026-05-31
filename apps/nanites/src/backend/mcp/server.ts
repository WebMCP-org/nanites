import { createMcpHandler, getMcpAuthContext, McpAgent } from "agents/mcp";
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
  type NaniteToolRuntime,
  resetNaniteDebugTool,
  resolveAuthorizedNaniteToolRuntime,
  startNaniteRunTool,
  testNaniteTriggerTool,
} from "#/backend/nanites/manager-tools.ts";
import { MCP_ROUTE } from "#/shared/constants/mcp.ts";

function getExternalMcpProps(): SigveloMcpAuthProps {
  const authContext = getMcpAuthContext();
  return sigveloMcpAuthPropsSchema.parse(authContext?.props);
}

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

async function buildMcpNaniteToolRuntime(input: {
  context: SigveloMcpToolContext;
  managerName?: string;
}): Promise<NaniteToolRuntime> {
  return resolveAuthorizedNaniteToolRuntime({
    env: input.context.env,
    props: await input.context.getProps(),
    surface: "mcp",
    managerName: input.managerName,
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

  server.registerTool(createNaniteTool.name, createNaniteTool.config, async (input) => {
    const runtime = await buildMcpNaniteToolRuntime({
      context,
      managerName: input.managerName,
    });
    const output = await createNaniteTool.handler(input, runtime);
    return formatMcpToolResult(output);
  });

  server.registerTool(debugNanitesTool.name, debugNanitesTool.config, async (input) => {
    const runtime = await buildMcpNaniteToolRuntime({
      context,
      managerName: input.managerName,
    });
    const output = await debugNanitesTool.handler(input, runtime);
    return formatMcpToolResult(output);
  });

  server.registerTool(deprovisionNanitesTool.name, deprovisionNanitesTool.config, async (input) => {
    const runtime = await buildMcpNaniteToolRuntime({
      context,
      managerName: input.managerName,
    });
    const output = await deprovisionNanitesTool.handler(input, runtime);
    return formatMcpToolResult(output);
  });

  server.registerTool(startNaniteRunTool.name, startNaniteRunTool.config, async (input) => {
    const runtime = await buildMcpNaniteToolRuntime({
      context,
      managerName: input.managerName,
    });
    const output = await startNaniteRunTool.handler(input, runtime);
    return formatMcpToolResult(output);
  });

  server.registerTool(cancelNaniteRunsTool.name, cancelNaniteRunsTool.config, async (input) => {
    const runtime = await buildMcpNaniteToolRuntime({
      context,
      managerName: input.managerName,
    });
    const output = await cancelNaniteRunsTool.handler(input, runtime);
    return formatMcpToolResult(output);
  });

  server.registerTool(testNaniteTriggerTool.name, testNaniteTriggerTool.config, async (input) => {
    const runtime = await buildMcpNaniteToolRuntime({
      context,
      managerName: input.managerName,
    });
    const output = await testNaniteTriggerTool.handler(input, runtime);
    return formatMcpToolResult(output);
  });

  server.registerTool(
    exploreNaniteWorkspaceTool.name,
    exploreNaniteWorkspaceTool.config,
    async (input) => {
      const runtime = await buildMcpNaniteToolRuntime({
        context,
        managerName: input.managerName,
      });
      const output = await exploreNaniteWorkspaceTool.handler(input, runtime);
      return formatMcpToolResult(output);
    },
  );

  server.registerTool(resetNaniteDebugTool.name, resetNaniteDebugTool.config, async (input) => {
    const runtime = await buildMcpNaniteToolRuntime({
      context,
      managerName: input.managerName,
    });
    const output = await resetNaniteDebugTool.handler(input, runtime);
    return formatMcpToolResult(output);
  });
}

async function createNanitesMcpServer(env: Env, _request: Request) {
  const server = createSigveloNanitesMcpServer();
  registerSigveloNaniteTools(server, {
    env,
    getProps: getExternalMcpProps,
  });
  return server;
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

export const nanitesMcpApiHandler = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const server = await createNanitesMcpServer(env, request);
    return createMcpHandler(server, {
      route: MCP_ROUTE,
    })(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
