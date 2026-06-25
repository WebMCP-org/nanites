# SigVelo Agent App

The repository root is the Cloudflare Worker app that runs SigVelo.

It owns GitHub auth, deployment installation resolution, Nanite manager Durable Objects, Think sub-agents, generated trigger execution, the SigVelo MCP server, product UI, admin views, and observability.

## Runtime Shape

```mermaid
flowchart LR
  Browser["Browser UI"] --> Manager["SigveloNaniteManager<br/>installation-scoped DO"]
  MCP["SigVelo MCP /mcp"] --> Manager
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

- `src/backend/agents/SigveloNaniteManager.ts` - installation manager, registry, routing, run summaries, and GitHub feedback.
- `src/backend/agents/SigveloNaniteAgent.ts` - stable Think Nanite runtime, workspace tools, GitHub-aware git auth, GitHub MCP codemode connector, lifecycle tools.
- `src/backend/nanites/triggers.ts` - Worker Loader execution for generated inbound trigger handlers.
- `src/backend/mcp/index.ts` - SigVelo MCP tools for model operators.
- `src/frontend/routes/_authenticated/nanites/route.tsx` - Nanites product UI.
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
- Cloudflare Workers Paid plan for Dynamic Workers
- Durable Objects: `SigveloNaniteManager`, `SigveloNaniteAgent`
- Worker Loader binding: `LOADER`
- Workers AI binding: `AI`
- Browser binding: `BROWSER`
- D1 database bound as `DB`
- R2 bucket bound as `WORKSPACE_FILES`
- KV namespace bound as `OAUTH_KV`
- KV namespace bound as `TOOL_OUTPUTS`

Create/update resources with Wrangler or Cloudflare MCP:

```bash
vp exec wrangler d1 create nanites-db
vp exec wrangler r2 bucket create nanites-workspace-files
vp exec wrangler kv namespace create OAUTH_KV
vp exec wrangler kv namespace create TOOL_OUTPUTS
```

`/setup` uses Cloudflare API MCP with Billing Read to confirm the selected account has an active
Workers paid subscription. It also creates or configures the deployment AI Gateway
(`sigvelo-nanites`) with the retry/ZDR policy from `NANITES_AI_GATEWAY_REQUEST_DEFAULTS` in
`src/backend/nanites/language-model.ts` — edit those constants and redeploy to change them. The
default model is `@cf/zai-org/glm-5.2` through the Worker `AI` binding and AI Gateway, so the
zero-config path does not depend on third-party provider credentials.

Apply database migrations before relying on an environment:

```bash
vp exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

## Local Runtime Secrets

Fresh self-hosted deploys should use the Deploy to Cloudflare button and `/setup`; that path creates
the customer-owned GitHub App and writes generated runtime secrets to Worker Secrets without
copy-paste. There are no hand-set GitHub secrets anywhere: runtime identity is a `github_apps` D1
row plus per-app secret bindings (`GITHUB_APP_<ID>_PRIVATE_KEY` and friends).

Local development gets the same identity through the dev-only `/setup/local` page instead of the
wizard (whose Cloudflare ownership verification cannot run on localhost). See
[Local GitHub App Setup](#local-github-app-setup).

The local `.dev.vars` template sets `NANITES_SHOW_SETUP=false` so normal local development does not
auto-route into the first-launch setup wizard. Set `NANITES_SHOW_SETUP=true` in `.dev.vars` only
when intentionally testing the setup flow.

Optional Sentry:

```bash
vp exec wrangler secret put SENTRY_DSN --config wrangler.jsonc
```

Setting the `SENTRY_DSN` secret enables both worker-side Sentry and browser-side Sentry — the
frontend reads the DSN at runtime from `/api/client-config`, so no rebuild is needed. (A build-time
`VITE_SENTRY_DSN` still takes precedence when set.) Keep non-sensitive runtime settings such as
`SENTRY_ENVIRONMENT` and `SENTRY_TRACES_SAMPLE_RATE` in `wrangler.jsonc` vars.

For local browser SDK or source-map upload settings, copy the Sentry/browser template only when you
need it:

```bash
cp docs/env.local.example .env
```

## Local GitHub App Setup

SigVelo needs a GitHub App installed on the repositories Nanites may maintain. For self-hosted
deployments, `/setup` creates the app. Locally, the dev-only `/setup/local` page (mounted only in
dev builds and only answering loopback hostnames) does the same job: it runs GitHub's app-manifest
flow with Nanites' default permissions and registers the resulting app in the local D1 database.

Agent-assisted first-time setup (once per developer):

1. `cp docs/dev.vars.local.example .dev.vars`
2. `vp run db:migrate:local && vp run dev`
3. If the browser lands on the Nanites login screen before setup is complete, use **Open local
   setup**. It links to `http://localhost:5173/setup/local`.
4. Open `http://localhost:5173/setup/local` and click **Create dev GitHub App on GitHub**. A
   coding agent can open the page and follow the manifest link, but GitHub may still require the
   human to log in, pass sudo-mode, or confirm account access.
5. After GitHub redirects back, append the printed secret block (`GITHUB_APP_<ID>_*` plus
   `AUTH_COOKIE_SECRET`) to `.dev.vars` and restart `vp run dev`. A local coding agent can read the
   returned page and append this block without exposing the values in chat. The worker cannot write
   `.dev.vars` itself.
6. Optional: upload `public/assets/nanite-github-app-badge.png` as the app badge in GitHub App
   settings under **Display information**. GitHub App manifests cannot set badges.
7. Install the app on at least one repository. A coding agent can open the install URL, but the
   human should choose the GitHub account, repository scope, and final install approval.
8. Sign in at `http://localhost:5173`. The runtime uses the local deployment installation recorded
   by `/setup/local`; there is no separate installation picker. The sign-in step uses the generated
   GitHub App OAuth flow, so browser login or consent prompts remain human checkpoints.

What a coding agent can do locally:

- create `.dev.vars` from the template
- run migrations and `vp run dev`
- open `/setup/local` and follow the GitHub App manifest redirect
- append the generated secret block to `.dev.vars` without printing the values
- restart the dev server and run `/setup/local/restore`
- open the GitHub App install URL and return to the Nanites login flow

What still needs a human:

- GitHub login, CAPTCHA, sudo-mode, and account access confirmation
- choosing the account and repository scope for the GitHub App installation
- approving the GitHub App installation or org-request flow
- approving GitHub App OAuth during Nanites sign-in
- optional badge upload in GitHub App settings

After any `rm -rf .wrangler` (the supported reset for stale local state), the secrets in
`.dev.vars` survive and the database row is rebuilt without a browser flow:

```bash
vp run db:migrate:local && vp run dev
curl -X POST http://localhost:5173/setup/local/restore
```

The dev app manifest uses an inactive `https://example.com/nanites-local-webhook` placeholder
because GitHub requires a hook URL but rejects localhost hook URLs. Local webhook behavior is
covered by the test suite. For live local webhooks, point the app's webhook URL at a public
[smee.io](https://smee.io) channel in GitHub settings, activate it, and run
`npx smee-client --url <channel> --target http://localhost:5173/api/github/webhook`.

The Nanite runtime should prefer Workspace git plus GitHub MCP/Octokit for GitHub API work. Do not assume shell `gh` is authenticated inside a Nanite unless `GH_TOKEN` injection is explicitly added.

## Nanites MCP

The app exposes the model control plane at:

```text
/mcp
```

Core tools:

| Tool                               | Purpose                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| `sigvelo_whoami`                   | Verify actor, installation, client, and scopes.                  |
| `sigvelo_create_nanite`            | Create or update a Nanite manifest.                              |
| `sigvelo_deprovision_nanite`       | Delete one Nanite and its run history.                           |
| `sigvelo_start_nanite_run`         | Start a manual Nanite run.                                       |
| `sigvelo_cancel_nanite_runs`       | Cancel pending or running Nanite runs.                           |
| `sigvelo_test_nanite_trigger`      | Test a raw GitHub event and dispatch accepted runs.              |
| `sigvelo_debug_nanites`            | Inspect manager state and optional Think transcript/submissions. |
| `sigvelo_explore_nanite_workspace` | Inspect child-owned workspace files.                             |

MCP tool calls are already bound to the authorized GitHub installation. Do not pass a manager name.
For `sigvelo_create_nanite`, keep the manifest to id, name, description, `eventSource`,
`triggerSource` for machine sources, and `permissions.github`. GitHub MCP tools are derived from
`permissions.github.appPermissions`; do not include MCP tiers, tool allowlists, or runtime
capability blocks.

Create and test Nanites one at a time. For related Nanite fleets, call `sigvelo_create_nanite` for
one Nanite, run `sigvelo_test_nanite_trigger` for that Nanite, then move to the next Nanite. Do not
try to call SigVelo tools from inside `execute`; `execute` is Worker-compatible JavaScript for
workspace and git provider work, and it does not expose SigVelo control-plane tools as top-level
functions.

For `sigvelo_test_nanite_trigger`, send a GitHub webhook-shaped event object with `id`, base
`name`, and `payload`. `payload.installation.id` must match the installation returned by
`sigvelo_whoami`; action-specific behavior belongs in `payload.action`.

Minimal MCP config:

```json
{
  "mcpServers": {
    "nanites": {
      "type": "http",
      "url": "http://localhost:5173/mcp"
    }
  }
}
```

Local browser and MCP smoke tests should use the real local GitHub App OAuth flow. `gh` is still
useful for checking the active GitHub account and normal repository API access, but a plain
`gh auth token` is a GitHub CLI token, not a GitHub App user token. GitHub rejects it for app-user
authorization surfaces such as `/user/installations`.

```bash
vp run dev
```

Open `http://localhost:5173/auth/github/login`, complete OAuth for the local Nanites app, and select
the intended installation in the UI. Then point MCPJam at the local server:

```bash
mcpjam oauth login \
  --url http://localhost:5173/mcp \
  --scopes "nanites:read nanites:write" \
  --verify-tools
```

The dev-only `/auth/test/mint-session` path is still available when `ALLOW_TEST_AUTH=true`, but it
requires a GitHub App user token minted by the app, not the GitHub CLI token.

## Generated Trigger Contract

Generated trigger handlers are Worker-compatible TypeScript.

Machine-originated Nanite manifests use `eventSource` for coarse intake and root `triggerSource` for
this generated code. Generated trigger handlers receive a trigger event whose GitHub payload stays in
GitHub's webhook shape, plus a small manager intent API:

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
vp run db:migrate:local
vp run dev
```

Run app commands:

```bash
vp run dev
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
vp run deploy
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
- `docs/nanites-auth-slice.md`
- `docs/testing-golden-standard.md`
