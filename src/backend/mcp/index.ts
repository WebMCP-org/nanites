import { MCP_ROUTE, MCP_SCOPES, SUPPORTED_MCP_SCOPES } from "#/shared/constants.ts";
import { createMcpHandler } from "agents/mcp";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError } from "#/backend/errors.ts";
import { executeSigveloNaniteTool } from "#/backend/nanites/tools/define-tool.ts";
import { naniteTools } from "#/backend/nanites/tools/index.ts";

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
    ...props,
    scopes: [...new Set(tokenScopes)],
  };
}

type SigveloMcpToolContext = {
  env: Env;
  auth: SigveloMcpAuthProps;
};

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

function registerSigveloNaniteTools(server: McpServer, context: SigveloMcpToolContext): void {
  for (const definition of naniteTools) {
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
              props: context.auth,
              surface: "mcp",
              requestId: extra.requestId == null ? undefined : String(extra.requestId),
            },
          }),
        ),
    );
  }
}

export const nanitesMcpApiHandler = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const parsedProps = sigveloMcpAuthPropsSchema.safeParse(
      (executionContext as McpExecutionContext).props,
    );
    if (!parsedProps.success) {
      const resourceMetadataUrl = createMcpProtectedResourceMetadataUrl(request);
      const error = new InvalidTokenError(INVALID_MCP_AUTH_PROPS_DESCRIPTION);
      return Response.json(error.toResponseObject(), {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer realm="OAuth", resource_metadata="${resourceMetadataUrl}", error="${error.errorCode}", error_description="${error.message}"`,
        },
      });
    }
    const auth = parsedProps.data;

    // This handler is stateless: a fresh server per request, no session id, and the
    // transport returns 405 for the GET/DELETE session endpoints. There is therefore no
    // server→client stream to deliver tools/list_changed on, so advertise listChanged:
    // false rather than promise notifications that can never arrive.
    const server = new McpServer(
      { name: "sigvelo-nanites", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    registerSigveloNaniteTools(server, {
      env,
      auth,
    });

    return createMcpHandler(server, { route: MCP_ROUTE, authContext: { props: auth } })(
      request,
      env,
      executionContext,
    );
  },
} satisfies ExportedHandler<Env>;
