# MCP Agent Authentication Notes

Status: reference note
Date: 2026-05-22

This note captures the current direction for agent-facing Sigvelo MCP authentication. It is not an
implementation plan yet. The goal is to preserve the product reasoning before the MCP auth extension
surface moves again.

## Short Version

Nanites should support a non-interactive MCP authentication path for coding agents and other machine
clients.

The preferred shape is:

1. A human or installation admin approves an agent client for a GitHub installation.
2. The client authenticates to Sigvelo's OAuth token endpoint with `private_key_jwt`.
3. Sigvelo verifies the JWT assertion against the client's registered public key, usually discovered
   through CIMD/JWKS.
4. Sigvelo issues a short-lived MCP access token scoped to the approved installation and scopes.
5. The client calls Sigvelo MCP with `Authorization: Bearer <access_token>`.

Use client secrets only as a compatibility fallback. The better long-term default is
`private_key_jwt` plus Client ID Metadata Documents (CIMD), because the long-lived private key never
crosses the network and Sigvelo only needs the public key.

## Why This Fits Nanites

Most Nanite operators will be other agents: coding agents, CI agents, hosted automation, or local
developer agents. Browser-based OAuth is fine for initial setup, but it is awkward for recurring
machine work.

Sigvelo already has the right product boundary:

- the GitHub installation is the authority boundary
- the MCP server is the agent-facing control plane
- the Nanite manager owns policy and capability issuance
- Nanites receive scoped capabilities rather than raw user authority

Client credentials gives machines a way to reconnect without a user in the loop while preserving the
same installation and scope model.

## API Key vs OAuth Client Credentials

An API key is usually a long-lived bearer secret sent directly to the API on every request. Whoever
has the key can use it until it is revoked or rotated.

OAuth client credentials adds a token endpoint in front of the API:

1. The client proves its own identity to the authorization server.
2. The authorization server issues a short-lived access token.
3. The client sends that short-lived token to the MCP server.

If the client authenticates with `client_id` and `client_secret`, the secret is still API-key-like.
The OAuth layer still helps because it standardizes discovery, scopes, token lifetime, audience
binding, and MCP extension negotiation.

If the client authenticates with `private_key_jwt`, it is meaningfully stronger. The client signs a
short-lived assertion with its private key. Sigvelo verifies that assertion with the registered
public key. The reusable private key is never transmitted.

## Private Key JWT

`private_key_jwt` is client authentication based on asymmetric keys.

The client owns:

- a private key, kept in its own secret store
- a public key, registered with Sigvelo directly or exposed through a JWKS URL

When the client wants an access token, it creates a short-lived JWT assertion:

```json
{
  "iss": "https://agent.example.com/oauth-client.json",
  "sub": "https://agent.example.com/oauth-client.json",
  "aud": "https://app.sigvelo.com/oauth/token",
  "iat": 1789950000,
  "exp": 1789950300,
  "jti": "unique-request-id"
}
```

The client signs that JWT with its private key and sends it to the token endpoint:

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=<signed-jwt>
&scope=nanites:read nanites:write
&resource=https://app.sigvelo.com/mcp
```

Sigvelo should validate:

- JWT signature against the registered public key
- `iss` and `sub` match the approved client identity
- `aud` is the Sigvelo token endpoint
- `exp` and `iat` are within the accepted clock window
- `jti` has not been replayed, at least within the assertion lifetime
- requested `resource` is the Sigvelo MCP resource
- requested scopes are allowed for the client and installation

If valid, Sigvelo issues a short-lived access token whose props bind the request to the service
client, GitHub installation, scopes, and authorization time.

## CIMD and DCR

CIMD and DCR solve registration and metadata discovery. They do not remove the need for client
authentication.

### CIMD

Client ID Metadata Documents let a client use an HTTPS URL as its `client_id`. The document can
publish metadata such as client name, redirect URIs, token endpoint auth method, and JWKS location.

For Sigvelo, CIMD is useful because an agent client can identify itself with a URL such as:

```text
https://agent.example.com/.well-known/sigvelo-client.json
```

That metadata can point to the client's JWKS. Sigvelo can fetch the public keys and verify
`private_key_jwt` assertions without manually copying keys.

### DCR

Dynamic Client Registration can register clients dynamically, but it should not be the authority
grant for Nanites write access.

For interactive OAuth, DCR can be reasonable because a user still approves the grant. For
non-interactive client credentials, open DCR would mean an arbitrary machine can register and ask for
`nanites:write`. That is not acceptable.

Use DCR only as metadata plumbing or as part of an admin-controlled registration flow. The real
authority must remain an approved binding:

```text
client identity -> GitHub installation -> allowed scopes -> policy constraints
```

## Recommended Sigvelo Model

Add a service-client concept under the GitHub installation boundary.

Suggested fields:

- `clientId`: stable OAuth client identifier, preferably a CIMD URL
- `displayName`: human-readable name for audit and UI
- `githubInstallationId`: required installation binding
- `allowedScopes`: start with `nanites:read`; require explicit admin approval for `nanites:write`
- `authMethod`: `private_key_jwt` preferred, `client_secret_basic` optional fallback
- `jwksUri` or pinned public keys
- `createdByGithubUserId`
- `createdAt`, `lastUsedAt`, `revokedAt`
- optional repo or Nanite constraints if a client should not see the whole installation

Token props should distinguish human MCP grants from service-client grants:

```ts
type SigveloMcpAuthProps =
  | {
      authKind: "mcp";
      githubUserId: number;
      githubLogin: string;
      githubInstallationId: number;
      clientId: string;
      scopes: string[];
      authorizedAt: string;
    }
  | {
      authKind: "mcp_service";
      serviceClientId: string;
      githubInstallationId: number;
      clientId: string;
      scopes: string[];
      authorizedAt: string;
    };
```

Tool authorization can stay mostly scope-based, but audit and UI should show whether a tool call came
from a human-authorized MCP token or a service client.

## Safety Rules

- Default service clients to `nanites:read`.
- Require explicit installation admin approval for `nanites:write`.
- Never expose raw GitHub tokens to external MCP clients.
- Let the manager mint GitHub App installation tokens internally.
- Keep access tokens short-lived.
- Validate token audience. Do not accept tokens meant for other resources.
- Implement immediate service-client revocation.
- Cache JWKS with respect for cache headers, but allow forced refresh or key pinning for revocation.
- Track `jti` for replay resistance when accepting JWT assertions.
- Log token issuance and MCP tool calls by service client.
- Expose service-client inventory and last-used data in admin/product surfaces before encouraging
  production use.

## ID-JAG and Enterprise-Managed Authorization

ID-JAG belongs to a different MCP auth extension: Enterprise-Managed Authorization.

Client credentials answers:

```text
Can this machine client act as itself without a human browser flow?
```

Enterprise-managed authorization answers:

```text
Can an enterprise IdP centrally decide whether this user, using this MCP client, may access this MCP server?
```

The Enterprise-Managed Authorization flow is roughly:

1. A user signs in to the MCP client with the enterprise IdP.
2. The MCP client receives an identity assertion, such as an OIDC ID token or SAML assertion.
3. The MCP client asks the IdP to exchange that assertion for an Identity Assertion JWT
   Authorization Grant (ID-JAG).
4. The MCP client sends the ID-JAG to the MCP server's authorization server using the JWT bearer
   grant.
5. The MCP authorization server validates the ID-JAG and issues an access token for the MCP server.

This could matter for Sigvelo enterprise accounts later. It would let a company's IdP control which
employees and MCP clients can access Sigvelo MCP, without each employee separately authorizing every
MCP server.

It is not the first thing to build for Nanites machine clients. Service-client credentials are the
more direct path for coding agents, CI, and scheduled automation. ID-JAG becomes relevant when
enterprise customers want central IdP policy over human employee access through approved MCP clients.

## Current Sigvelo State

Sigvelo currently has a working HTTP MCP OAuth code flow:

- dynamic public-client registration
- browser consent through the Sigvelo MCP authorization UI
- GitHub user and installation binding
- `nanites:read` and `nanites:write` scopes
- bearer-token MCP calls

Important local code points:

- `src/server.ts`
- `src/backend/mcp/oauth.ts`
- `src/backend/mcp/auth-context.ts`
- `src/backend/orpc/contracts/mcp-openapi.ts`
- `tests/backend/mcp-oauth.test.ts`

Missing pieces for this direction:

- service-client persistence model
- admin/service-client creation UI or tool
- `private_key_jwt` assertion validation
- JWKS/CIMD discovery and caching
- `grant_type=client_credentials` token endpoint path
- `authKind: "mcp_service"` token props
- audit surface for service-client token issuance and MCP tool calls
- MCP initialize response advertising `io.modelcontextprotocol/oauth-client-credentials`

## Implementation Slices

1. Add a service-client domain model and read-only admin inventory.
2. Support `private_key_jwt` verification for a manually registered public key or JWKS URI.
3. Add `grant_type=client_credentials` for `nanites:read` only.
4. Add audit events for token issuance and MCP tool calls.
5. Add explicit admin approval for `nanites:write`.
6. Add CIMD URL support for service clients.
7. Add client-secret fallback only if real MCP clients need it.
8. Revisit Enterprise-Managed Authorization and ID-JAG when an enterprise customer asks for IdP
   policy control.

## Open Questions

- Should service clients be installation-wide or Nanite-scoped by default?
- Should `nanites:write` allow creating Nanites, poking Nanites, or both?
- Should a service client be allowed to create another service client? Default answer should be no.
- Should service-client grants be visible in the product UI before write access exists? Default
  answer should be yes.
- Should Sigvelo accept only CIMD URL `client_id`s for `private_key_jwt`, or also manually registered
  opaque client IDs?
- How much replay tracking is needed for JWT assertions at expected token request volume?
- Can the current OAuth provider library support this directly, or do we need a custom token path
  until upstream support lands?

## Sources

- [MCP OAuth Client Credentials](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials)
- [MCP Enterprise-Managed Authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)
- [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Extension Support Matrix](https://modelcontextprotocol.io/extensions/client-matrix)
- [ext-auth OAuth client credentials draft](https://raw.githubusercontent.com/modelcontextprotocol/ext-auth/main/specification/draft/oauth-client-credentials.mdx)
- [ext-auth enterprise-managed authorization draft](https://raw.githubusercontent.com/modelcontextprotocol/ext-auth/main/specification/draft/enterprise-managed-authorization.mdx)
- [SEP-990: Enterprise IdP policy controls](https://modelcontextprotocol.io/seps/990-enable-enterprise-idp-policy-controls-during-mcp-o)
- [IETF draft: Identity Assertion JWT Authorization Grant](https://www.ietf.org/archive/id/draft-ietf-oauth-identity-assertion-authz-grant-03.html)
