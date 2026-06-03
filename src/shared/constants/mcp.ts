export const MCP_ROUTE = "/mcp";
export const MCP_AUTHORIZE_ROUTE = "/authorize";
export const MCP_AUTHORIZE_UI_ROUTE = "/mcp-authorize";
export const MCP_AUTHORIZE_CONTEXT_ROUTE = "/api/mcp/oauth/authorize-context";
export const MCP_TOKEN_ROUTE = "/oauth/token";
export const MCP_CLIENT_REGISTRATION_ROUTE = "/oauth/register";

export const MCP_SCOPES = {
  read: "nanites:read",
  write: "nanites:write",
} as const;

export const SUPPORTED_MCP_SCOPES = [MCP_SCOPES.read, MCP_SCOPES.write] as const;
