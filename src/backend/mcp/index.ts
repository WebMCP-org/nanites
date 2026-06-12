import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError } from "#/backend/errors.ts";
import {
  type AnySigveloMcpToolDefinition,
  executeSigveloNaniteTool,
} from "#/backend/nanites/tools/define-tool.ts";
import { naniteTools } from "#/backend/nanites/tools/index.ts";
import { MCP_ROUTE, MCP_SCOPES, SUPPORTED_MCP_SCOPES } from "#/mcp.ts";

type SigveloMcpScope = (typeof SUPPORTED_MCP_SCOPES)[number];

export const sigveloMcpAuthPropsSchema = z.object({
  authKind: z.literal("mcp"),
  githubUserId: z.number().int().positive(),
  githubLogin: z.string().min(1),
  githubAppId: z.number().int().positive(),
  githubInstallationId: z.number().int().positive(),
  clientId: z.string().min(1),
  scopes: z.array(z.enum(SUPPORTED_MCP_SCOPES)),
  authorizedAt: z.string().datetime({ offset: true }),
});

export type SigveloMcpAuthProps = z.infer<typeof sigveloMcpAuthPropsSchema>;

export function resolveGrantedMcpScopes(requestedScopes: readonly string[]): SigveloMcpScope[] {
  const unsupportedScopes = requestedScopes.filter(
    (scope) => !SUPPORTED_MCP_SCOPES.includes(scope as SigveloMcpScope),
  );
  if (unsupportedScopes.length > 0) {
    const scopes = [...new Set(unsupportedScopes)];
    throw new AppError("unsupportedMcpScope", {
      details: { scopes },
      message: `Unsupported SigVelo MCP scopes requested: ${scopes.join(", ")}`,
    });
  }

  if (requestedScopes.length === 0) {
    return [MCP_SCOPES.read];
  }

  const grantedScopes = requestedScopes as SigveloMcpScope[];
  return [...new Set(grantedScopes)];
}

export function downscopeMcpAuthPropsForToken({
  props,
  requestedScopes,
}: {
  props: SigveloMcpAuthProps;
  requestedScopes: readonly string[];
}): SigveloMcpAuthProps {
  const tokenScopes = requestedScopes.filter(
    (scope): scope is SigveloMcpScope =>
      SUPPORTED_MCP_SCOPES.includes(scope as SigveloMcpScope) &&
      props.scopes.includes(scope as SigveloMcpScope),
  );

  return {
    authKind: props.authKind,
    githubUserId: props.githubUserId,
    githubLogin: props.githubLogin,
    githubAppId: props.githubAppId,
    githubInstallationId: props.githubInstallationId,
    clientId: props.clientId,
    authorizedAt: props.authorizedAt,
    scopes: [...new Set(tokenScopes)],
  };
}

type SigveloMcpToolContext = {
  env: Env;
  getProps(): SigveloMcpAuthProps;
};

export function createSigveloNanitesMcpServer(): McpServer {
  return new McpServer(
    { name: "sigvelo-nanites", version: "0.1.0" },
    { capabilities: { tools: { listChanged: true } } },
  );
}

function formatMcpToolResult(output: object): CallToolResult {
  const structuredContent = JSON.parse(JSON.stringify(output)) as Record<string, unknown>;

  return {
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
  };
}

function readMcpAuthProps(): SigveloMcpAuthProps {
  return sigveloMcpAuthPropsSchema.parse(getMcpAuthContext()?.props);
}

function readMcpRequestId(requestId: unknown): string | undefined {
  return requestId === null || requestId === undefined ? undefined : String(requestId);
}

function registerSigveloNaniteTool(
  server: McpServer,
  context: SigveloMcpToolContext,
  definition: AnySigveloMcpToolDefinition,
): void {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      annotations: definition.annotations,
      _meta: definition._meta,
    },
    async (toolInput, extra) =>
      formatMcpToolResult(
        await executeSigveloNaniteTool({
          definition,
          toolInput,
          invocation: {
            env: context.env,
            props: context.getProps(),
            surface: "mcp",
            requestId: readMcpRequestId(extra.requestId),
          },
        }),
      ),
  );
}

export function registerSigveloNaniteTools(
  server: McpServer,
  context: SigveloMcpToolContext,
): void {
  for (const definition of naniteTools) {
    registerSigveloNaniteTool(server, context, definition);
  }
}

export const nanitesMcpApiHandler = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const server = createSigveloNanitesMcpServer();
    registerSigveloNaniteTools(server, {
      env,
      getProps: readMcpAuthProps,
    });

    return createMcpHandler(server, { route: MCP_ROUTE })(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
