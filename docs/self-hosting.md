# Self-hosting Nanites

This guide is for running your own Nanites deployment on Cloudflare with your own GitHub App.

The target product path is click-through setup: deploy the Worker, open `/setup`, connect
Cloudflare, create a customer-owned GitHub App from a manifest, install it on repositories, and sign
in. The primary path should not ask you to copy GitHub App secrets, create a Cloudflare API token,
edit `.dev.vars`, or choose GitHub permissions by hand.

Nanites is a Cloudflare Worker app. The runtime uses Durable Objects for the manager and agent
state, D1 for product data, R2 for workspace files, KV for OAuth/tool artifacts, Worker Loader for
generated trigger code, Workers AI for model access, and a GitHub App for repository authority.

## Current setup status

Implemented locally in this branch:

- the default `wrangler.jsonc` no longer requires GitHub App or auth-cookie secrets for first
  deploy
- the default `wrangler.jsonc` carries the public Worker script name as a non-secret setup hint, so
  Cloudflare ownership verification works even when `/setup` is opened from a custom domain
- `/setup` is the first-launch UI for missing deployment config
- `/setup` is backed by `NanitesSetupAgent`, so the wizard state is Durable Object state streamed
  to React with the Agents SDK `useAgent()` hook
- `/auth/github/login` and `/mcp` report setup-required instead of failing when the deployment
  GitHub App is missing
- Cloudflare setup uses Cloudflare's managed API MCP server through the Agents SDK MCP client, not
  a Nanites-owned dashboard OAuth client or user-created API token
- the setup Agent asks Cloudflare MCP for authorization, verifies that the selected Cloudflare
  account owns the current Worker route and script, and performs setup-only Cloudflare API work
  through MCP `execute()` calls
- the Agents SDK validates Cloudflare MCP OAuth state and PKCE, then the successful Agent callback
  issues a short-lived browser setup claim so GitHub App creation, manifest callback completion,
  and repository activation stay bound to the browser that proved Cloudflare ownership
- Cloudflare setup asks for read access to account billing/subscriptions, read access to the
  account and Workers resources, and `Workers Scripts Write` so setup can write generated Worker
  secrets. Nanites does not ask for Billing Write and does not upgrade or mutate paid plans.
- GitHub App Manifest setup derives callback, webhook, setup, and redirect URLs from the deployed
  origin
- manifest conversion writes generated `AUTH_COOKIE_SECRET`, GitHub private key, client secret, and
  webhook secret to customer-owned Worker Secrets in the local implementation
- after manifest conversion, `/setup` keeps the GitHub App step in a `secrets-propagating` state
  until the current Worker can read those generated secrets
- while secrets are propagating, the setup Agent schedules current-Worker status checks through the
  setup status route, then broadcasts state updates to `/setup` without exposing secret values
- when the GitHub manifest callback can already read generated secrets, it redirects directly to
  the GitHub App installation page; otherwise `/setup` unlocks the repository step as soon as the
  setup Agent observes that those secrets are readable
- if generated secrets are still unreadable after a short propagation window, `/setup` marks the
  GitHub App step retryable so you can rerun the manifest flow instead of getting stuck
- once generated GitHub App secrets are readable, `/setup` unlocks repository installation, but
  launch stays locked until GitHub verifies the installed app installation
- public `.dev.vars.example` and `.env.example` are intentionally empty so Deploy to Cloudflare does
  not ask for setup-time secrets
- GitHub App installation returns through a setup verification callback that checks the claimed
  installation against GitHub-visible installations after sign-in
- setup verification also requires at least one visible repository, proves the generated GitHub App
  can mint an installation token, and binds claimed setup installs to a nonce from setup Agent state
- the selected GitHub installation id is persisted with deployment GitHub App metadata, so the
  repository step survives setup Agent state reset while D1 metadata and Worker secrets remain
- first-launch setup uses a browser-local setup owner claim, so once one browser starts Cloudflare
  setup another visitor cannot mutate the Cloudflare setup state until the claim is released or
  expires
- manifest conversion validates returned GitHub App permissions and events before writing generated
  secrets
- setup preflights the generated GitHub App D1 metadata table before starting a GitHub App manifest
  flow, so a missing migration fails before GitHub creates an app
- retryable post-conversion failures preserve the orphaned GitHub App URL and cleanup instructions
- signed GitHub App installation lifecycle webhooks move a completed setup back to repository
  repair when the selected installation is deleted, suspended, loses repositories, or accepts new
  permissions
- runtime GitHub OAuth, webhook verification, installation tokens, and Chat ingress read through
  the deployment GitHub App config owner

Still required before public zero-copy claims:

- live-smoke GitHub manifest conversion on a deployed `NanitesSetupAgent` and prove the implemented
  Worker Secret write path succeeds through Cloudflare MCP `execute()` with the DCR-issued setup
  token
- smoke test Deploy to Cloudflare provisioning for Browser Run, Worker Loader, and top-level KV/R2
  bindings when the public template omits account-specific resource ids/names
- smoke test Workers Builds running the package deploy script after dependency install
- measure Worker Secret propagation after the setup flow writes generated secrets

See [Zero-Config Self-Hosting Plan](./architecture/zero-config-self-hosting-plan.md) for the
first-party references and remaining live smoke checks. See
[Zero-Config Self-Hosting Edge Cases](./architecture/zero-config-self-hosting-edge-cases.md) for
the expected behavior when setup is interrupted, retried, or pointed at existing Cloudflare/GitHub
state.

## Prerequisites

- Node.js 22.12 or newer
- `vp`
- a Cloudflare account with Workers Paid, Durable Objects, D1, R2, KV, Worker Loader, Browser, and
  Workers AI enabled
- a GitHub organization or account where you can create and install a GitHub App
- `gh` authenticated locally when you want to run the local MCP smoke path

Install dependencies from the repository root:

```bash
vp install
```

## 1. Deploy

The intended public entrypoint is:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/WebMCP-org/nanites)
```

The one-click deploy is the golden path. It creates the Worker from the public template, then the
runtime setup UI finishes account verification, GitHub App creation, repository installation, and
generated secret writes. Local operators can run the same deploy wrapper with Wrangler:

```bash
vp check
vp test
vp build
vp run deploy
```

`vp run deploy` builds, deploys once with Wrangler auto-provisioning enabled, resolves the generated
remote D1 database id, applies migrations for the default `DB` binding, then redeploys the Worker
and assets. The deploy wrapper reads the D1 database name and migrations directory from
`wrangler.jsonc`, then writes a temporary migration-only Wrangler config with the generated
database id. It prefers the project-local `node_modules/.bin/vp` binary for build and Wrangler
commands, so Workers Builds does not need a globally installed Vite+ CLI. This keeps the public
`wrangler.jsonc` free of account-specific D1, R2, and KV ids.

### Workers Builds Git integration

Cloudflare Workers Builds reads the root `wrangler.jsonc` when connecting the repository. Keep the
root Worker name and setup hint aligned:

```jsonc
{
  "name": "nanites-app-production",
  "vars": {
    "NANITES_CLOUDFLARE_SCRIPT_NAME": "nanites-app-production",
  },
}
```

Wrangler v3.109.0 and newer may generate a follow-up PR after a build if the connected Worker name
does not match the repository config. Accept the same value in both places instead of letting the
dashboard and repo drift.

Use these Workers Builds settings:

| Setting                              | Value                          |
| ------------------------------------ | ------------------------------ |
| Production branch                    | `main`                         |
| Build command                        | leave blank                    |
| Deploy command                       | `pnpm run deploy`              |
| Non-production branch deploy command | `pnpm run deploy:preview`      |
| Root directory                       | `/` or blank for the repo root |
| Build cache                          | enabled                        |
| Build variable                       | `NODE_VERSION=22`              |
| Build variable                       | `PNPM_VERSION=10.33.0`         |

Do not use raw `npx wrangler versions upload` for non-production branches. Nanites needs the package
script because it builds first, then uploads `dist/nanites_app_production/index.js` with
`dist/client` assets and the public `wrangler.jsonc` template.

If Cloudflare warns that the selected build token is missing `ai_search_write`, that warning is not
required for the current Nanites runtime. Nanites uses the Workers AI binding named `AI`, not
Cloudflare AI Search. The token still needs enough access for Workers Builds, Worker uploads, routes,
KV/R2 resources, and D1 migrations.

V1 assumes one Nanites deployment per Cloudflare account. This is intentionally not an idempotent
multi-install installer for one account. The default resource names are
`nanites-db`, plus KV/R2 names derived from the Worker prefix `nanites-app-production`; setup
verifies and configures that one selected account instead of trying to namespace or reconcile
multiple Nanites deployments in the same Cloudflare account. Those default-named resources should be
fresh, or already owned by this Nanites template's migration history. V1 does not reconcile
arbitrary legacy resources that happen to use the same names. If a Cloudflare account already
contains conflicting default resources, use a fresh account or remove the conflicting resources
before using the zero-config path. When `vp run deploy` stops while applying D1 migrations, treat
that as the same account-freshness problem first: an older `nanites-db` can exist with tables but
without this template's migration history.

To validate the public deploy shape without creating or updating Cloudflare resources, run:

```bash
vp run deploy:validate
```

This checks the public self-host template before the Wrangler dry run: the Deploy to Cloudflare
path must stay prompt-free, the generated secrets must stay out of deploy-time examples, and the
default Wrangler config must keep the D1, R2, KV, Durable Object, Browser, Workers AI, and Worker
Loader bindings that `/setup` depends on.

## 2. Open setup

Open the deployed origin. If no deployment GitHub App is configured, Nanites routes you to:

```text
https://<your-origin>/setup
```

Follow the setup checklist:

1. Connect Cloudflare.
2. Create the GitHub App.
3. Pick repositories.
4. Star Nanites.
5. Start Nanites.

When Cloudflare asks for MCP permissions, the intended setup scope is the account that owns the
Worker plus Billing Read, Workers Scripts Write, and AI Gateway Read/Write. Billing Read is used only
to confirm the account has an active Workers paid subscription before Nanites creates a GitHub App.
Workers Scripts Write is used only to store generated setup secrets on the Worker. AI Gateway
Read/Write is used to create or configure the deployment gateway.

The Cloudflare step also checks the runtime pieces Nanites cannot safely fake:

- Workers Paid is active. Dynamic Workers require Workers Paid, and Cloudflare bills that account
  directly.
- Worker Loader can run a tiny setup smoke Worker. This proves generated trigger handlers can run as
  Dynamic Workers.
- Workers AI is bound as `AI`, and the default model id is configured.
- The default model route uses the configured Cloudflare AI Gateway, default `sigvelo-nanites`, with
  `openai/gpt-5.5`. Setup creates or configures that gateway with the deployment retry/ZDR settings.
  Unified Billing models and `@cf/...` Workers AI models both run through the binding without
  provider API keys in Nanites.
- Browser Run is shown as informational because it supports later preview verification, but it is
  not a first-launch blocker.

After Cloudflare verifies ownership, the setup Agent redirects back to `/setup` with a short-lived
HttpOnly setup claim in the same browser. This is not a manual secret; it only keeps GitHub App
setup bound to the browser that proved Cloudflare ownership.

Setup creates a customer-owned GitHub App owned by your GitHub account or organization. GitHub App names
must be unique across GitHub, so Nanites gives the manifest a short generated default name such as
`Nanites app 1a2b`. The manifest uses the deployed origin for:

```text
OAuth callback: https://<your-origin>/auth/github/callback
Webhook URL:    https://<your-origin>/api/github/webhook
Setup URL:      https://<your-origin>/setup/github/installed
Manifest URL:   https://<your-origin>/setup/github/manifest/callback
```

Optional: upload `public/assets/nanite-github-app-badge.png` as the app badge in GitHub App settings
under **Display information**. GitHub App manifests cannot set badges.

Nanites does not use GitHub's "Request user authorization (OAuth) during installation" option.
Keep that disabled for manually configured apps. Nanites uses the setup URL first, then starts its
own GitHub login flow with a callback state cookie before verifying the returned installation.
Before launch, setup also verifies that the signed-in GitHub user has starred
`WebMCP-org/nanites`. The generated GitHub App manifest requests GitHub's `Starring` user
permission for that setup-owned verification step.

Nanites requests the current conservative permission set:

- Contents: write
- Pull requests: write
- Actions: read
- Issues: write
- Starring: write

After installation, GitHub redirects back to Nanites. Nanites does not trust the returned
`installation_id` by itself; it sends you through the generated GitHub App OAuth flow and only
activates an installation that GitHub lists as visible to the signed-in user.

## 3. Run locally

Local development uses the dev-only `/setup/local` page instead of the Cloudflare setup flow, whose
ownership verification cannot run on localhost:

```bash
cp docs/dev.vars.local.example .dev.vars
vp run db:migrate:local
vp run dev
```

Then open `http://localhost:5173/setup/local` to create a personal dev GitHub App and follow its
printed steps — full walkthrough in [development.md](./development.md#local-github-app-setup).

The local `.dev.vars` template hides the setup wizard with `NANITES_SHOW_SETUP=false`. Change it to
`NANITES_SHOW_SETUP=true` only when you want to exercise `/setup` locally. This flag does not bypass
runtime GitHub App config: local OAuth and MCP still need the `github_apps` D1 row plus
`AUTH_COOKIE_SECRET` and the per-app `GITHUB_APP_<ID>_*` secrets that `/setup/local` provides.

For local MCP/browser smoke testing, use the real local GitHub App OAuth flow. A plain
`gh auth token` is not a GitHub App user token and cannot list app installations.

```bash
vp run dev
```

Open `http://localhost:5173/auth/github/login`, complete OAuth, select the intended installation,
then point an MCP client at:

```text
http://localhost:5173/mcp
```

## 4. Local reset and migration

Nanites is still pre-production, so the supported recovery path for stale local setup state is a
hard reset, not a compatibility shim. Delete local Wrangler state, apply the current baseline
migration, and restore the GitHub App row from the secrets still in `.dev.vars`:

```bash
rm -rf .wrangler
vp run db:migrate:local
vp run dev
curl -X POST http://localhost:5173/setup/local/restore
```

Keep binding names unchanged and regenerate Worker types after binding edits:

```bash
vp exec wrangler types env.d.ts --include-runtime false
```

Apply remote D1 migrations manually only for named operator environments:

```bash
vp exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

Manual reuse of an existing GitHub App is not part of V1 setup. If a local or pre-production
deployment drifts, reset the local state or create a fresh deployment-owned app through `/setup`.

## 5. Smoke test the runtime

After setup, confirm these paths:

```text
https://<your-origin>/auth/github/callback
https://<your-origin>/api/github/webhook
https://<your-origin>/mcp
```

Minimum release smoke:

1. Sign in with GitHub.
2. Select the installed GitHub App installation.
3. Star `WebMCP-org/nanites` through the setup flow and confirm Launch unlocks.
4. Create one Nanite through the browser or MCP.
5. Start a manual run.
6. Test one generated trigger with `sigvelo_test_nanite_trigger`.
7. Confirm the Nanite chat streams in the browser.
8. Confirm GitHub MCP-backed PR/check/search operations work for the Nanite's granted repositories.
9. Send one signed GitHub webhook delivery and confirm an unsigned delivery is rejected.
10. Confirm the app can still mint an installation token and list at least one repository after
    launch.
11. Confirm Browser Run and Worker Loader both execute through the deployed Worker.

Minimal MCP client config:

```json
{
  "mcpServers": {
    "nanites": {
      "type": "http",
      "url": "https://<your-origin>/mcp"
    }
  }
}
```

## Operational Notes

- Cloudflare environment vars do not inherit from top-level `vars`; keep each `env.<name>.vars`
  block explicit.
- Do not rename Worker bindings without also regenerating Worker types with
  `vp exec wrangler types env.d.ts --include-runtime false`.
- GitHub data should stay GitHub-shaped at integration boundaries. Prefer Octokit/GitHub App
  primitives over local DTOs.
- Nanites are pre-production. Prefer hard cutovers and deleted stale code over compatibility shims.
