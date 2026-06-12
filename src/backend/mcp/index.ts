import { createMcpHandler } from "agents/mcp";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { AppError } from "#/backend/errors.ts";
import {
  type AnySigveloMcpToolDefinition,
  executeSigveloNaniteTool,
} from "#/backend/nanites/tools/define-tool.ts";
import { naniteTools } from "#/backend/nanites/tools/index.ts";
import { MCP_ROUTE, MCP_SCOPES, SUPPORTED_MCP_SCOPES } from "#/mcp.ts";

type SigveloMcpScope = (typeof SUPPORTED_MCP_SCOPES)[number];
type McpExecutionContext = ExecutionContext & {
  props?: unknown;
};

export const INVALID_MCP_AUTH_PROPS_DESCRIPTION =
  "SigVelo MCP authorization is invalid. Re-authorize SigVelo MCP.";

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

export function parseSigveloMcpAuthProps(props: unknown): SigveloMcpAuthProps | null {
  const parsed = sigveloMcpAuthPropsSchema.safeParse(props);
  return parsed.success ? parsed.data : null;
}

export function requireSigveloMcpGrantProps(props: unknown): SigveloMcpAuthProps {
  const parsed = parseSigveloMcpAuthProps(props);
  if (!parsed) {
    throw new OAuthError("invalid_grant", {
      description: INVALID_MCP_AUTH_PROPS_DESCRIPTION,
    });
  }

  return parsed;
}

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

function createMcpProtectedResourceMetadataUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}

function createInvalidMcpTokenResponse(request: Request): Response {
  const resourceMetadataUrl = createMcpProtectedResourceMetadataUrl(request);
  const error = new InvalidTokenError(INVALID_MCP_AUTH_PROPS_DESCRIPTION);

  return Response.json(error.toResponseObject(), {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer realm="OAuth", resource_metadata="${resourceMetadataUrl}", error="${error.errorCode}", error_description="${error.message}"`,
    },
  });
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
    const props = parseSigveloMcpAuthProps((executionContext as McpExecutionContext).props);
    if (!props) {
      return createInvalidMcpTokenResponse(request);
    }

    const server = createSigveloNanitesMcpServer();
    registerSigveloNaniteTools(server, {
      env,
      getProps: () => props,
    });

    return createMcpHandler(server, { route: MCP_ROUTE, authContext: { props } })(
      request,
      env,
      executionContext,
    );
  },
} satisfies ExportedHandler<Env>;
