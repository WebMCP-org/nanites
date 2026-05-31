import { z } from "zod";
import { MCP_SCOPE_DESCRIPTIONS, SUPPORTED_MCP_SCOPES } from "#/shared/constants/mcp.ts";

const oauthScopeSchema = z.enum(SUPPORTED_MCP_SCOPES);
const oauthSpaceDelimitedScopesSchema = z
  .string()
  .min(1)
  .describe("Space-delimited OAuth scopes requested or granted for the MCP client.");

export const oauthErrorResponseSchema = z
  .object({
    error: z.string().min(1).describe("OAuth error code."),
    error_description: z
      .string()
      .min(1)
      .optional()
      .describe("Human-readable OAuth error description."),
    error_uri: z.string().url().optional().describe("Optional documentation URL for the error."),
  })
  .describe("OAuth 2.0 error response.");

export const oauthAuthorizationServerMetadataSchema = z
  .object({
    issuer: z.string().url(),
    authorization_endpoint: z.string().url(),
    token_endpoint: z.string().url(),
    registration_endpoint: z.string().url(),
    response_types_supported: z.array(z.literal("code")),
    grant_types_supported: z.array(z.enum(["authorization_code", "refresh_token"])),
    code_challenge_methods_supported: z.array(z.enum(["S256", "plain"])),
    token_endpoint_auth_methods_supported: z.array(
      z.enum(["client_secret_basic", "client_secret_post", "none"]),
    ),
    scopes_supported: z.array(oauthScopeSchema),
    client_id_metadata_document_supported: z.boolean(),
  })
  .describe("OAuth authorization server metadata for SigVelo MCP clients.");

export const oauthProtectedResourceMetadataSchema = z
  .object({
    resource: z.string().url(),
    authorization_servers: z.array(z.string().url()),
    bearer_methods_supported: z.array(z.literal("header")),
    scopes_supported: z.array(oauthScopeSchema),
  })
  .describe("OAuth protected resource metadata for the SigVelo MCP endpoint.");

const oauthAuthorizeInstallationSchema = z.object({
  id: z.number().int().positive().describe("GitHub installation id."),
  repositoryCount: z.number().int().nonnegative(),
  manageAccessHref: z.string().url(),
  account: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1),
    type: z.enum(["User", "Organization"]),
    avatar_url: z.string().url().nullable(),
  }),
});

export const mcpAuthorizeContextOutputSchema = z
  .discriminatedUnion("status", [
    z.object({
      status: z.literal("invalid"),
      message: z.string().min(1),
    }),
    z.object({
      status: z.literal("login"),
      clientName: z.string().min(1),
      loginHref: z.string().url(),
    }),
    z.object({
      status: z.literal("no_installations"),
      clientName: z.string().min(1),
      installHref: z.string().url(),
    }),
    z.object({
      status: z.literal("no_repositories"),
      clientName: z.string().min(1),
      installHref: z.string().url(),
      installations: z.array(oauthAuthorizeInstallationSchema),
    }),
    z.object({
      status: z.literal("consent"),
      clientName: z.string().min(1),
      requestedScopes: z.array(oauthScopeSchema),
      authorizeAction: z.string().min(1),
      csrfToken: z.string().min(1),
      activeGithubInstallationId: z.number().int().positive().nullable(),
      installations: z.array(oauthAuthorizeInstallationSchema),
    }),
  ])
  .describe("Browser-facing MCP authorization context used by the consent UI.");

export const oauthTokenRequestSchema = z
  .object({
    grant_type: z.enum(["authorization_code", "refresh_token"]),
    client_id: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    redirect_uri: z.string().url().optional(),
    code_verifier: z.string().min(1).optional(),
    refresh_token: z.string().min(1).optional(),
    scope: oauthSpaceDelimitedScopesSchema.optional(),
    resource: z.string().url().optional(),
  })
  .describe("OAuth token request for authorization-code and refresh-token grants.");

export const oauthTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.literal("bearer"),
    expires_in: z.number().int().positive(),
    scope: oauthSpaceDelimitedScopesSchema,
    refresh_token: z.string().min(1).optional(),
  })
  .describe("OAuth access token response for SigVelo MCP clients.");

export const oauthClientRegistrationRequestSchema = z
  .object({
    redirect_uris: z.array(z.string().url()).min(1),
    client_name: z.string().min(1).optional(),
    client_uri: z.string().url().optional(),
    logo_uri: z.string().url().optional(),
    grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
    response_types: z.array(z.literal("code")).optional(),
    token_endpoint_auth_method: z.literal("none").optional(),
    scope: oauthSpaceDelimitedScopesSchema.optional().describe(
      `Optional requested scopes. Supported scopes are ${Object.entries(MCP_SCOPE_DESCRIPTIONS)
        .map(([scope, description]) => `${scope} (${description})`)
        .join(", ")}.`,
    ),
  })
  .describe("Dynamic client registration request for public MCP OAuth clients.");

export const mcpAuthorizationConsentFormSchema = z
  .object({
    csrf_token: z
      .string()
      .min(1)
      .describe("CSRF token returned by the authorization context endpoint."),
    intent: z.enum(["allow", "deny"]),
    github_installation_id: z
      .number()
      .int()
      .positive()
      .describe("Selected GitHub installation to bind to the MCP grant."),
  })
  .describe("Form body submitted by the MCP authorization consent UI.");

export const oauthClientRegistrationResponseSchema = oauthClientRegistrationRequestSchema
  .extend({
    client_id: z.string().min(1),
    client_id_issued_at: z.number().int().nonnegative(),
  })
  .describe("Dynamic client registration response for public MCP OAuth clients.");

export const mcpJsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number().int()]).optional(),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .describe("JSON-RPC 2.0 request sent over the MCP Streamable HTTP transport.");

export const mcpJsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number().int(), z.null()]).optional(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string(),
        data: z.unknown().optional(),
      })
      .optional(),
  })
  .describe("JSON-RPC 2.0 response returned by the MCP Streamable HTTP transport.");

export type McpAuthorizeContextOutput = z.infer<typeof mcpAuthorizeContextOutputSchema>;
