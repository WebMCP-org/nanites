# MCP Device Flow Notes

Status: reference note
Date: 2026-05-23

This note captures how SigVelo should add Device Authorization Grant support for MCP clients.
SigVelo already has working MCP OAuth. Device Flow should extend that surface for clients that
cannot reliably complete a browser redirect, such as local agent clients, CLI tools, IDE plugins,
remote sandboxes, and headless automation.

## Short version

Device Flow should be a SigVelo OAuth flow, not a shortcut that gives MCP clients raw GitHub tokens.

The preferred shape is:

```text
MCP client
  -> asks SigVelo for a device code
  -> shows the user a verification URL and code
  -> polls SigVelo token endpoint

User
  -> opens SigVelo verification URL
  -> signs in with GitHub if needed
  -> selects a GitHub installation
  -> approves MCP scopes

SigVelo
  -> issues a SigVelo MCP access token
  -> token is bound to user, installation, client, scopes, and resource
```

The MCP client calls `/mcp` with the SigVelo bearer token. SigVelo continues to own installation
policy, scope enforcement, audit, and revocation.

## Why this fits SigVelo MCP

MCP clients often run outside the browser. A redirect-based OAuth flow works for web apps, but it is
awkward when the client is Claude Desktop, a terminal agent, an IDE extension, a remote coding
environment, or a sandboxed worker.

Device Flow gives those clients a clean human approval path without asking them to run a localhost
callback server.

SigVelo already has the right authority model:

- GitHub is the upstream identity provider.
- The GitHub installation is the product permission boundary.
- SigVelo issues MCP tokens with SigVelo scopes.
- The Nanite manager validates and executes privileged actions.
- External clients never receive raw GitHub installation tokens.

Device Flow should preserve that model.

## Relationship to existing MCP OAuth

The current MCP OAuth flow should remain the default browser-capable path:

```text
/oauth/authorize
/oauth/token
/oauth/register
/.well-known/oauth-authorization-server
/.well-known/oauth-protected-resource/mcp
```

Device Flow adds one new authorization entrypoint and one new polling branch in the token endpoint:

```text
POST /oauth/device_authorization
POST /oauth/token
  grant_type=urn:ietf:params:oauth:grant-type:device_code
```

Both flows should issue the same SigVelo MCP token shape. Tool authorization should not care whether
the token came from redirect OAuth or Device Flow, except for audit metadata.

## User story

A developer configures a local MCP client with SigVelo:

1. The MCP client discovers SigVelo's OAuth metadata.
2. The client requests a device code for `resource=https://app.sigvelo.com/mcp` and scopes such as
   `nanites:read`.
3. SigVelo returns:
   - `device_code`
   - `user_code`
   - `verification_uri`
   - `verification_uri_complete`
   - `expires_in`
   - `interval`
4. The client shows:

   ```text
   Open https://app.sigvelo.com/oauth/device and enter code W7KQ-9D2M.
   ```

5. The user opens the URL, signs in with GitHub, selects the installation, and approves scopes.
6. The client polls `/oauth/token` with the device code.
7. SigVelo returns a short-lived MCP access token.
8. The MCP client calls `/mcp` with `Authorization: Bearer <token>`.

## Endpoint sketch

### Device authorization request

```http
POST /oauth/device_authorization
Content-Type: application/x-www-form-urlencoded

client_id=<mcp-client-id>
&scope=nanites:read nanites:write
&resource=https://app.sigvelo.com/mcp
```

Response:

```json
{
  "device_code": "opaque-device-code",
  "user_code": "W7KQ-9D2M",
  "verification_uri": "https://app.sigvelo.com/oauth/device",
  "verification_uri_complete": "https://app.sigvelo.com/oauth/device?user_code=W7KQ-9D2M",
  "expires_in": 600,
  "interval": 5
}
```

### Token polling request

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code
&device_code=opaque-device-code
&client_id=<mcp-client-id>
```

Polling errors should follow the standard device flow shape:

- `authorization_pending`
- `slow_down`
- `expired_token`
- `access_denied`

Successful response should match the existing MCP OAuth token response.

## Verification UI

The verification UI should be small and installation-focused.

Required states:

- Enter user code.
- Invalid or expired code.
- GitHub sign-in required.
- Installation selection required.
- Scope consent.
- Approved.
- Denied.

The consent screen should show:

- MCP client name and client id.
- Requested scopes.
- Selected GitHub installation.
- Whether the request can read or mutate Nanites.
- Expiration time for the device request.

The UI should avoid implying that the client receives GitHub credentials. It receives a SigVelo MCP
token.

## Token props

Device Flow should reuse the existing human-authorized MCP token shape and add enough metadata for
audit:

```ts
type SigveloMcpDeviceAuthProps = {
  authKind: "mcp";
  grantType: "device_code";
  githubUserId: number;
  githubLogin: string;
  githubInstallationId: number;
  clientId: string;
  scopes: string[];
  resource: "https://app.sigvelo.com/mcp";
  authorizedAt: string;
  deviceApprovedAt: string;
};
```

If the current token props do not include `grantType`, add it as optional first:

```ts
grantType?: "authorization_code" | "device_code";
```

Do not split Device Flow into a service-client token. A user is present and approving the request.
Service clients remain a separate `client_credentials` / `private_key_jwt` path.

## Storage model

Device codes should be short-lived and server-owned.

Suggested fields:

- `deviceCodeHash`
- `userCodeHash`
- `clientId`
- `requestedScopes`
- `resource`
- `status`: `pending`, `approved`, `denied`, `expired`, `consumed`
- `githubUserId`
- `githubLogin`
- `githubInstallationId`
- `createdAt`
- `expiresAt`
- `approvedAt`
- `lastPolledAt`
- `pollCount`
- `nextAllowedPollAt`

Store only hashed device and user codes. Treat `device_code` as a bearer secret.

KV can work for an MVP because the state is short-lived. Durable Object or D1 is better if polling
coordination, rate limiting, and audit queries become important.

## Polling rules

The token endpoint should enforce:

- Request expiration.
- Poll interval.
- `slow_down` when a client polls too quickly.
- One-time consumption after token issuance.
- Client id match between device authorization and token polling.
- Scope/resource match to the original request.

The access token should be short-lived. Refresh token support can wait unless a real MCP client needs
long sessions.

## Discovery metadata

The OAuth authorization server metadata should advertise Device Flow only after it is implemented:

```json
{
  "device_authorization_endpoint": "https://app.sigvelo.com/oauth/device_authorization",
  "grant_types_supported": ["authorization_code", "urn:ietf:params:oauth:grant-type:device_code"]
}
```

The MCP protected resource metadata should continue to point clients at the same authorization
server. MCP clients should not need a SigVelo-specific auth branch once discovery is correct.

## Security rules

- Never return raw GitHub user tokens or installation tokens to MCP clients.
- Bind every issued token to an MCP resource audience.
- Require GitHub sign-in before approval.
- Require an active GitHub installation before approval.
- Clamp requested scopes to the scopes allowed by SigVelo.
- Make `nanites:write` visibly different from `nanites:read`.
- Hash device codes and user codes at rest.
- Expire device requests quickly, around 10 minutes.
- Apply polling backoff with `slow_down`.
- Consume a device code after one successful token exchange.
- Log approvals, denials, token issuance, and MCP tool calls.

## Fit with raw APIs

Device Flow should not be MCP-only internally.

SigVelo can expose future raw APIs with the same OAuth server and token policy:

```text
/mcp             accepts SigVelo OAuth tokens
/api or /rpc     accepts SigVelo OAuth tokens
```

The token's `resource` or audience should decide where it is valid. A token minted for
`https://app.sigvelo.com/mcp` should not automatically authorize unrelated APIs.

## Non-goals

- Do not replace browser GitHub OAuth for the SigVelo web app.
- Do not replace the existing MCP authorization code flow.
- Do not implement machine-to-machine service clients through Device Flow.
- Do not use GitHub Device Flow tokens directly against SigVelo MCP.
- Do not grant installation-wide write access without explicit user consent.

## Implementation slices

### Slice 1: Device code MVP

- Add `/oauth/device_authorization`.
- Generate `device_code` and human-friendly `user_code`.
- Store pending device request with TTL.
- Add `/oauth/device` verification UI.
- Add token endpoint handling for `device_code`.
- Issue existing SigVelo MCP access tokens.
- Add tests for pending, approved, denied, expired, consumed, and slow polling.

### Slice 2: Discovery and client polish

- Add `device_authorization_endpoint` to OAuth metadata.
- Add `device_code` to supported grant types.
- Add copyable verification URI and code in the UI.
- Add audit fields to MCP authorization inspection.

### Slice 3: Scope and installation controls

- Show requested scopes and the deployment installation clearly.
- Require explicit confirmation for write scopes.
- Add admin visibility for recent device grants.
- Add revoke support if refresh tokens or long-lived sessions are introduced.
