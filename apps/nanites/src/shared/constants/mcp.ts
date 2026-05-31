export const MCP_ROUTE = "/mcp";
export const MCP_AUTHORIZE_ROUTE = "/authorize";
export const MCP_AUTHORIZE_UI_ROUTE = "/mcp-authorize";
export const MCP_AUTHORIZE_CONTEXT_ROUTE = "/api/mcp/oauth/authorize-context";
export const MCP_TOKEN_ROUTE = "/oauth/token";
export const MCP_CLIENT_REGISTRATION_ROUTE = "/oauth/register";
export const MCP_OAUTH_AUTHORIZATION_SERVER_METADATA_ROUTE =
  "/.well-known/oauth-authorization-server";
export const MCP_OAUTH_PROTECTED_RESOURCE_METADATA_ROUTE =
  "/.well-known/oauth-protected-resource/mcp";
export const MCP_OAUTH_SECURITY_SCHEME = "sigveloMcpOAuth";

export const MCP_SCOPES = {
  read: "nanites:read",
  write: "nanites:write",
} as const;

export const SUPPORTED_MCP_SCOPES = [MCP_SCOPES.read, MCP_SCOPES.write] as const;

export const MCP_SCOPE_DESCRIPTIONS = {
  [MCP_SCOPES.read]: "Inspect Nanite managers and runs.",
  [MCP_SCOPES.write]: "Create Nanites and start Nanite runs.",
} as const satisfies Record<(typeof SUPPORTED_MCP_SCOPES)[number], string>;

export type McpScope = (typeof SUPPORTED_MCP_SCOPES)[number];
