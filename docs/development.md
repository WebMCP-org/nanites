# Sigvelo Agent App

The repository root is the Cloudflare Worker app that runs Sigvelo.

It owns GitHub auth, installation selection, Nanite manager Durable Objects, Think sub-agents, generated trigger execution, the Sigvelo MCP server, product UI, admin views, and observability.

## Runtime Shape

```mermaid
flowchart LR
  Browser["Browser UI"] --> Manager["SigveloNaniteManager<br/>installation-scoped DO"]
  MCP["Sigvelo MCP /mcp"] --> Manager
  GitHub["GitHub webhooks"] --> Manager
  Manager --> Loader["Worker Loader<br/>generated trigger code"]
  Manager --> Nanite["SigveloNaniteAgent<br/>Think sub-agent"]
  Nanite --> Workspace["Workspace tools<br/>files, search, git"]
  Nanite --> GitHubMcp["GitHub MCP<br/>scoped tools"]
  Nanite --> Lifecycle["Lifecycle tools"]
  Lifecycle --> Manager
```

The manager owns policy and aggregate state. Think Nanites own transcript, streaming, workspace, tool loop, and lifecycle outcome.

## Key Areas

- `src/backend/nanites/manager.ts` - installation manager, registry, routing, run summaries, and GitHub feedback.
- `src/backend/nanites/nanite-agent.ts` - stable Think Nanite runtime, workspace tools, GitHub-aware git auth, GitHub MCP attachment, lifecycle tools.
- `src/backend/nanites/triggers.ts` - Worker Loader execution for generated inbound trigger handlers.
- `src/backend/mcp/index.ts` - Sigvelo MCP tools for model operators.
- `src/frontend/routes/_authenticated/nanites.tsx` - Nanites product UI.
- `wrangler.jsonc` - Cloudflare bindings, Durable Object migrations, vars, and required secrets.

## Prerequisites

Use the repo root toolchain:

```bash
vp install
```

For GitHub setup and inspection:

```bash
gh --version
gh auth status
gh api user --jq '{login,id}'
```

For Cloudflare setup and deploy:

```bash
vp exec wrangler whoami
```

## Required Cloudflare Resources

`wrangler.jsonc` expects:

- Worker assets
- Durable Objects: `SigveloNaniteManager`, `SigveloNaniteAgent`
- Worker Loader binding: `LOADER`
- Workers AI binding: `AI`
- Browser binding: `BROWSER`
- D1 database bound as `DB`
- R2 bucket bound as `WORKSPACE_FILES`
- KV namespace bound as `OAUTH_KV`

Create/update resources with Wrangler or Cloudflare MCP:

```bash
vp exec wrangler d1 create nanites-db
vp exec wrangler r2 bucket create nanites-workspace-files
vp exec wrangler kv namespace create OAUTH_KV
```

Apply database migrations before relying on an environment:

```bash
vp exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

## Required Secrets

Set runtime secrets with Wrangler:

```bash
vp exec wrangler secret put AUTH_COOKIE_SECRET --config wrangler.jsonc
vp exec wrangler secret put CLOUDFLARE_ACCOUNT_ID --config wrangler.jsonc
vp exec wrangler secret put GITHUB_APP_PRIVATE_KEY --config wrangler.jsonc
vp exec wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.jsonc
vp exec wrangler secret put GITHUB_WEBHOOK_SECRET --config wrangler.jsonc
```

Optional Sentry:

```bash
vp exec wrangler secret put SENTRY_DSN --config wrangler.jsonc
vp exec wrangler secret put SENTRY_DSN --config wrangler.jsonc --env staging
vp exec wrangler secret put SENTRY_DSN --config wrangler.jsonc --env production
```

Keep non-sensitive runtime settings such as `SENTRY_ENVIRONMENT` and `SENTRY_TRACES_SAMPLE_RATE` in `wrangler.jsonc` vars. Named Cloudflare environments do not inherit top-level vars, so each environment needs explicit values.

## GitHub App Setup

Sigvelo needs a GitHub App installed on the repositories Nanites may maintain.

Use the deployed origin for URLs:

- OAuth callback: `https://<origin>/auth/github/callback`
- Webhook URL: `https://<origin>/api/github/webhook`
- Webhook events: select the GitHub events you want the app to receive; Nanites route with
  Octokit's webhook event names.

Typical permissions:

- `contents`: read/write for branches and file changes
- `pull_requests`: read/write for PR creation and updates
- `actions`: read for workflow/check investigation
- `issues`: read/write when issue or PR comment surfaces are needed

Useful `gh` checks:

```bash
gh api /user/installations --paginate
gh api /user/installations/<installation_id>/repositories --paginate
```

The Nanite runtime should prefer Workspace git plus GitHub MCP/Octokit for GitHub API work. Do not assume shell `gh` is authenticated inside a Nanite unless `GH_TOKEN` injection is explicitly added.

## Sigvelo MCP

The app exposes the model control plane at:

```text
/mcp
```

Core tools:

| Tool                               | Purpose                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| `sigvelo_whoami`                   | Verify actor, installation, client, and scopes.                  |
| `sigvelo_create_nanite`            | Create or update a Nanite manifest.                              |
| `sigvelo_poke_nanite`              | Ask, trigger-test, cancel runs, or deprovision Nanites.          |
| `sigvelo_debug_nanites`            | Inspect manager state and optional Think transcript/submissions. |
| `sigvelo_explore_nanite_workspace` | Inspect child-owned workspace files.                             |

Minimal MCP config:

```json
{
  "mcpServers": {
    "sigvelo": {
      "type": "http",
      "url": "https://app.sigvelo.com/mcp"
    }
  }
}
```

Local MCP smoke tests can use the GitHub CLI token already stored in the user's keychain. Do not
print or commit the token. Start the local app with:

```bash
ALLOW_TEST_AUTH=true GITHUB_TEST_USER_TOKEN="$(gh auth token)" vp dev
```

Run that from the repository root, then point MCPJam at the local server:

```bash
mcpjam oauth login \
  --url http://localhost:5173/mcp \
  --scopes "nanites:read nanites:write" \
  --verify-tools
```

## Generated Trigger Contract

Generated trigger handlers are Worker-compatible TypeScript.

They receive a trigger event whose GitHub payload stays in GitHub's webhook shape, plus a small
manager intent API:

```ts
export default {
  async handle(event, ctx) {
    if (event.name !== "push") {
      return ctx.noop("Not a push event.");
    }

    return ctx.dispatchSelf({
      reason: "Relevant push event",
      repository: event.payload.repository.full_name,
    });
  },
};
```

Supported helpers today:

- `ctx.dispatchSelf(input)`
- `ctx.noop(reason)`
- `ctx.record(message, data)`

Generated trigger handlers route events. They should not edit repositories, own lifecycle state, or bypass manager policy.

## Development

Run the app:

```bash
vp run dev
```

Run app commands:

```bash
vp dev
vp build
vp test
vp check
```

Validate from the repo root before merging:

```bash
vp check
vp test
```

Deploy:

```bash
vp run deploy:staging
vp run deploy:prod
```

## Testing

Use the root checks for normal work:

```bash
vp check
vp test
```

Nanites runtime changes should favor end-to-end tests that exercise real Worker/Agent boundaries, real signed webhooks, real Durable Object state, and real browser journeys where UI behavior matters.

## More Docs

- `docs/architecture/README.md`
- `docs/architecture/architecture.md`
- `docs/architecture/execution-architecture.md`
- `docs/architecture/roadmap.md`
- `docs/architecture/user-stories.md`
- `docs/admin-access.md`
- `docs/nanites-auth-slice.md`
- `docs/testing-golden-standard.md`
