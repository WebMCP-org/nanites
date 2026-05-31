# Nanites Auth Slice

This note documents the narrow auth slice implemented for the current Nanites demo.

## Boundary

- GitHub is the identity provider.
- The browser app session is a sealed cookie, not the GitHub token.
- The primary authorization boundary is the active GitHub installation.
- Normal authenticated requests trust a valid sealed app session.
- GitHub revalidation is reserved for login, installation switching, and repository listing inside the active installation context.
- MCP clients authorize through Sigvelo OAuth. GitHub is the upstream human login step, but
  Sigvelo issues the MCP access token.

## Session Model

The sealed session cookie carries only:

- `githubUserId`
- `githubLogin`
- `activeGithubInstallationId`
- `expiresAt`

The GitHub user access token is sealed into a separate cookie so normal requests do not need to call GitHub.

Sealed browser auth cookies use `jose` JWE with a purpose-scoped symmetric key derived from the
Worker secret. The implementation does not store plaintext session state in cookies.

## Runtime Layout

- `packages/contracts`: canonical auth and installation contracts
- `packages/db`: Drizzle schema and DB-derived contracts
- `apps/nanites/src/auth`: runtime cookie, GitHub, and session behavior
- `apps/nanites/src/orpc`: auth-aware request context and middleware layering
- `apps/nanites/src/backend/mcp`: Sigvelo OAuth authorization and MCP tool exposure

## MCP OAuth Model

Sigvelo is the MCP authorization server. MCP clients do not receive GitHub user tokens or GitHub App
installation tokens. During `/authorize`, the user logs in with GitHub when no sealed browser session
is present, chooses one visible GitHub App installation, and receives a Sigvelo MCP grant bound to:

- `githubUserId`
- `githubLogin`
- `githubInstallationId`
- OAuth client id
- Sigvelo MCP scopes

MCP protocol state, client registrations, authorization codes, and Sigvelo-issued access/refresh
tokens are stored by `@cloudflare/workers-oauth-provider` in `OAUTH_KV`. This is Sigvelo protocol
state, not GitHub identity state.

## Revalidation Policy

GitHub API calls are expected in these paths:

- GitHub login callback
- active installation selection
- repository listing for the active installation

Normal authenticated requests should not call GitHub on every request. They should trust the sealed
app session unless the flow is explicitly revalidating an installation or repo boundary.

Persisted GitHub account, installation, repository, or person snapshots must not be an authorization
source of truth. Product authorization should use sealed app/MCP auth state plus live GitHub
revalidation at privilege boundaries. Admin/business snapshots, if needed, belong behind explicit
analytics refresh work.

## Deliberate Non-Goals

- no `users` table
- no `sessions` table
- no GitHub installation or repository table as auth truth
- no WorkOS or managed-auth integration
- no generalized Nanites runtime orchestration
- no broader dashboard architecture work beyond what auth requires

## Sources

- `docs/architecture/architecture.md`
- `packages/contracts/src/auth.ts`
- `apps/nanites/src/backend/github.ts`
- GitHub App user access tokens:
  https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- GitHub installations REST API:
  https://docs.github.com/en/rest/apps/installations
