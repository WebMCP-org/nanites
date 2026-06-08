# Self-hosting Nanites

This guide is for running your own Nanites deployment on Cloudflare with your own GitHub App.

Nanites is a Cloudflare Worker app. The runtime uses Durable Objects for the manager and agent
state, D1 for product data, R2 for workspace files, KV for OAuth/tool artifacts, Worker Loader for
generated trigger code, Workers AI for model access, and a GitHub App for repository authority.

The committed `wrangler.jsonc` includes SigVelo's current app ids, custom domains, and Cloudflare
resource ids for the hosted deployment. Fork operators must replace those values before deploying
their own instance.

## Fork replacement checklist

Before your first deploy, replace every environment-specific value in `wrangler.jsonc`:

| Field                                 | Replace with                                          |
| ------------------------------------- | ----------------------------------------------------- |
| `vars.GITHUB_APP_ID`                  | your GitHub App id                                    |
| `vars.GITHUB_CLIENT_ID`               | your GitHub App client id                             |
| `routes[].pattern`                    | your Worker custom domain, or remove routes entirely  |
| `d1_databases[].database_id`          | the D1 database id created in your Cloudflare account |
| `d1_databases[].database_name`        | your D1 database name                                 |
| `r2_buckets[].bucket_name`            | your R2 bucket name                                   |
| `kv_namespaces[].id` / `preview_id`   | your KV namespace ids                                 |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` / AUD | your Access app values, or empty strings if unused    |
| `SENTRY_ENVIRONMENT` / trace settings | your observability environment names and sample rates |

After changing bindings, regenerate Worker types:

```bash
vp exec wrangler types env.d.ts --include-runtime false
```

## Prerequisites

- Node.js 22.12 or newer
- `vp`
- a Cloudflare account with Workers, Durable Objects, D1, R2, KV, Worker Loader, Browser, and
  Workers AI enabled
- a GitHub organization or account where you can create and install a GitHub App
- `gh` authenticated locally when you want to run the local MCP smoke path

Install dependencies from the repository root:

```bash
vp install
```

## 1. Create Cloudflare resources

Create the resources declared in `wrangler.jsonc`:

```bash
vp exec wrangler d1 create nanites-db
vp exec wrangler r2 bucket create nanites-workspace-files
vp exec wrangler kv namespace create OAUTH_KV
vp exec wrangler kv namespace create TOOL_OUTPUTS
```

Copy the generated D1 database id, KV namespace ids, R2 bucket names, GitHub App ids, and route
domains into `wrangler.jsonc`. Keep the binding names unchanged: `DB`, `WORKSPACE_FILES`,
`OAUTH_KV`, and `TOOL_OUTPUTS`.

If you use named environments, repeat the resource creation for each environment you plan to run
and update the matching `env.<name>` block in `wrangler.jsonc`.

## 2. Create a GitHub App

Create a GitHub App for the origin where your Worker will run.

Use these URLs:

```text
Homepage URL: https://<your-origin>
Callback URL: https://<your-origin>/auth/github/callback
Webhook URL: https://<your-origin>/api/github/webhook
```

Typical permissions:

| Permission    | Access         | Why                                       |
| ------------- | -------------- | ----------------------------------------- |
| Contents      | Read and write | Branches, file changes, and workspace git |
| Pull requests | Read and write | Change proposals                          |
| Actions       | Read           | Workflow and check investigation          |
| Issues        | Read and write | Issue or PR comment surfaces when enabled |
| Metadata      | Read-only      | Required by GitHub Apps                   |

Subscribe to the GitHub events your Nanites should route, such as `push`, `pull_request`,
`issues`, and `workflow_run`.

After creating the app, update `GITHUB_APP_ID` and `GITHUB_CLIENT_ID` in `wrangler.jsonc`, then
download the private key.

## 3. Set secrets

Set required Worker secrets:

```bash
vp exec wrangler secret put AUTH_COOKIE_SECRET --config wrangler.jsonc
vp exec wrangler secret put CLOUDFLARE_ACCOUNT_ID --config wrangler.jsonc
vp exec wrangler secret put GITHUB_APP_PRIVATE_KEY --config wrangler.jsonc
vp exec wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.jsonc
vp exec wrangler secret put GITHUB_WEBHOOK_SECRET --config wrangler.jsonc
```

For named environments, pass `--env staging` or `--env production` and set the same required
secrets there.

Optional Sentry secrets:

```bash
vp exec wrangler secret put SENTRY_DSN --config wrangler.jsonc
vp exec wrangler secret put SENTRY_DSN --config wrangler.jsonc --env production
```

Do not commit `.dev.vars`, private keys, or copied secret files.

## 4. Apply database migrations

Apply D1 migrations before using an environment:

```bash
vp exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

For named environments:

```bash
vp exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc --env production
```

## 5. Run locally

For local development, create `.dev.vars` with the required secrets or copy them from your secret
manager:

```bash
cp .dev.vars.example .dev.vars
```

Then run:

```bash
vp run dev
```

For local MCP smoke testing, you can use the GitHub CLI token from your keychain:

```bash
ALLOW_TEST_AUTH=true GITHUB_TEST_USER_TOKEN="$(gh auth token)" vp run dev
```

Then point an MCP client at:

```text
http://localhost:5173/mcp
```

## 6. Deploy

Validate before deploying:

```bash
vp check
vp test
vp build
```

Deploy:

```bash
vp run deploy:prod
```

After deployment, confirm these paths:

```text
https://<your-origin>/auth/github/callback
https://<your-origin>/api/github/webhook
https://<your-origin>/mcp
```

Then install the GitHub App on a test repository and sign in through the browser app.

## 7. Smoke test the runtime

Minimum release smoke:

1. Sign in with GitHub.
2. Select the installed GitHub App installation.
3. Create one Nanite through the browser or MCP.
4. Start a manual run.
5. Test one generated trigger with `sigvelo_test_nanite_trigger`.
6. Confirm the Nanite chat streams in the browser.
7. Confirm GitHub MCP-backed PR/check/search operations work for the Nanite's granted repositories.

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
