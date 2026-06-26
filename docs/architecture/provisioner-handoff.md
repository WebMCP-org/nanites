# Self-Hosted Nanites Provisioner Handoff

**Status: current implementation spec (2026-06). Companion to
[provisioner-architecture.md](./provisioner-architecture.md); this is the concrete checklist.**

Implementation checklist for moving Nanites setup into `sigvelo`. Nanites boots from fixed Worker
vars/secrets written by the provisioner; it does not store GitHub App credentials in D1.

## Target shape

`sigvelo` owns provisioning. `nanites` owns runtime.

The deployed Nanites Worker reads:

- **plain vars:** `CLOUDFLARE_ACCOUNT_ID`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
  `GITHUB_APP_CLIENT_ID`
- **required secrets:** `AUTH_COOKIE_SECRET`, `CLOUDFLARE_API_TOKEN`,
  `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`

Do not add a SigVelo-hosted runtime control plane, Sentry sink, OTel sink, team model, or deployment
tenant table inside Nanites. Each self-hosted deployment gets its own Cloudflare Worker, D1, KV, R2,
Durable Object namespace, and GitHub App.

## First-party sources

- Cloudflare OAuth overview: https://developers.cloudflare.com/fundamentals/oauth/
- Cloudflare OAuth client creation: https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/
- Cloudflare OAuth integration endpoints: https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/
- Cloudflare API token permissions (Workers/D1/KV/R2 permission names): https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- Cloudflare Workers env vars: https://developers.cloudflare.com/workers/configuration/environment-variables/
- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Workers script settings API: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/
- Cloudflare Workers bulk secrets API: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/bulk_update/
- Cloudflare Workers assets direct upload: https://developers.cloudflare.com/workers/static-assets/direct-upload/
- Cloudflare D1 create database API: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/
- Cloudflare KV create namespace API: https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/methods/create/
- Cloudflare R2 create bucket API: https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/
- GitHub App manifest flow: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
- GitHub create app from manifest endpoint: https://docs.github.com/en/rest/apps/apps#create-a-github-app-from-a-manifest
- GitHub App permissions: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- GitHub App install URL shape: https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/migrating-oauth-apps-to-github-apps#prompt-users-to-install-your-github-app
- GitHub App installation auth: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
- GitHub App user access tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- GitHub webhook validation: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries

## Build the Cloudflare provisioner

**Register one Cloudflare OAuth client for `apps/landing`.** Public client with Authorization Code

- PKCE (S256), `token_endpoint_auth_method: "none"` — no client secret (Cloudflare requires PKCE for
  public clients per its OAuth docs). Scopes are DOT-delimited (colon-delimited are rejected) and must
  create/update Workers scripts, D1, KV, R2, secrets, and any Workers assets/bindings Nanites uses.
  Keep the scope list in one constant next to the OAuth start route. Registered out-of-band by
  `apps/landing/scripts/register-oauth-client.ts`; making the client public is a separate, permanent
  DNS-TXT-verified step.

**Add the Cloudflare OAuth routes to `apps/landing`.**

- start route: generates state + a PKCE code verifier (stored with the state), redirects to
  `https://dash.cloudflare.com/oauth2/auth` with the `code_challenge`
- callback route: verifies state, exchanges the code at `https://dash.cloudflare.com/oauth2/token`
  with the `code_verifier` (no secret), stores the Cloudflare access token only for the active job

Do not keep a Cloudflare refresh token unless we explicitly decide to support one-click updates from
SigVelo later. A retained token can mutate the customer's Cloudflare account.

**Publish a versioned Nanites artifact from the Nanites repo.** Worker module bundle, static assets,
`wrangler.jsonc`-equivalent binding metadata, Durable Object migrations, D1 SQL migrations. Store in
private SigVelo R2.

**Implement the Cloudflare install job.** Deterministic deployment names, e.g.
`nanites-<deploymentId>`, for the Worker, D1, KV, R2, and Durable Object resources. Create if
missing, update if present, record enough IDs to repair a failed install.

**Upload the Worker and assets.** Workers assets upload-session flow for static assets, then upload
the Worker script with bindings matching Nanites' runtime config. Plain config values are
`plain_text` bindings. Secrets go through the Workers secrets API, not plaintext script settings.

**Apply D1 migrations.** Run the artifact's migration SQL against the deployment D1 database.
Idempotent enough to resume after a failed job.

**Generate Nanites-owned secrets.** Generate `AUTH_COOKIE_SECRET` in sigvelo, write it as a Worker
secret, never store the raw value in SigVelo logs or long-lived tables.

## Create the deployment-owned GitHub App

**Ask for the app owner target.** Minimal input: target type (user or org) and login. Do not build
GitHub sign-in just to list orgs — GitHub checks login/admin permission at manifest-create time.

**Add a GitHub App manifest start route in `apps/landing`.** Create unguessable state, store it on
the deployment job, build the manifest, send the user to GitHub:

- personal account: `POST https://github.com/settings/apps/new`
- organization: `POST https://github.com/organizations/<org>/settings/apps/new`

**Manifest fields to own in sigvelo** (built from the deployment record):

- `name`: unique human-readable app name
- `url`: SigVelo or deployed Nanites URL
- `hook_attributes.url`: `https://<nanites-worker>/api/github/webhook`
- `redirect_url`: SigVelo manifest callback route
- `callback_urls`: `https://<nanites-worker>/auth/github/callback`
- `setup_url`: `https://<nanites-worker>/`
- `public`: `false`
- `default_permissions`: one constant owned by SigVelo
- `default_events`: one constant owned by SigVelo

Start broad enough for the current product, but no speculative permissions — minimum required.

**Manifest callback route.** Verify state, exchange GitHub's temporary code with
`POST https://api.github.com/app-manifests/{code}/conversions`. The response includes app id, slug,
client id, client secret, webhook secret, PEM private key. The code expires within one hour; failed
callbacks restart the manifest flow.

**Normalize and write GitHub credentials.** Manifest private keys may arrive as PKCS#1 PEM. Nanites
already has a WebCrypto-compatible normalizer in `src/backend/github/private-key.ts`; copy it instead
of rediscovering the encoding. Write:

- `GITHUB_APP_ID` — plain Worker var
- `GITHUB_APP_SLUG` — plain Worker var
- `GITHUB_APP_CLIENT_ID` — plain Worker var
- `CLOUDFLARE_ACCOUNT_ID` — plain Worker var
- `GITHUB_APP_PRIVATE_KEY` — Worker secret
- `GITHUB_APP_CLIENT_SECRET` — Worker secret
- `GITHUB_APP_WEBHOOK_SECRET` — Worker secret
- `CLOUDFLARE_API_TOKEN` — Worker secret with AI Gateway Read access

**Show the install link.** After credentials are written, send the user to
`https://github.com/apps/<slug>/installations/new`. Nanites has an install URL helper in
`src/shared/utils/github.ts`; copy the URL shape if sigvelo needs to render the post-create link.

## Nanites runtime contract

Nanites reads app identity and credentials from `src/backend/github/apps.ts`. There is no runtime
GitHub App table, dynamic secret binding name, active/retired app row, or app registry. Keep
`githubAppId` on facts/installations as a plain observed GitHub id.

Webhook verification in `src/backend/api/routes/github.ts` reads GitHub's target app id header,
compares it to `GITHUB_APP_ID`, and verifies HMAC with `GITHUB_APP_WEBHOOK_SECRET`.

Browser and MCP auth in `src/backend/auth/index.ts` and `src/backend/auth/session.ts` use the same
fixed deployment app config for GitHub App user OAuth and token refresh.

## Keep the data boundary small

SigVelo stores deployment bookkeeping only: deployment id; Cloudflare account id and Worker/resource
names; Nanites artifact version; GitHub App id, slug, client id, html URL, owner login/type;
provisioning status and last error.

Do not store repository lists, GitHub user tokens, GitHub installation tokens, webhook payloads,
Nanite run logs, model prompts, or customer runtime errors in SigVelo. Those belong in the customer's
Cloudflare account.

## Failure handling

Repairable state machine, not clever rollback.

- Cloudflare resource creation fails → retry the failed step.
- GitHub App creation succeeds but Worker secret writes fail → keep the app metadata, retry writing
  vars/secrets.
- User abandons the GitHub manifest flow → mark the deployment `waiting_for_github_app`.
- Manifest code expires → restart the manifest flow.
- Do not delete a customer-owned GitHub App automatically. Show the app URL, let the owner decide.

## Copy from Nanites

- `src/backend/github/private-key.ts` — PKCS#1 → PKCS#8 normalizer.
- `src/shared/utils/github.ts` — GitHub App install URL shape.
- `src/backend/github/index.ts` — Octokit patterns for GitHub App auth, user OAuth exchange,
  installation tokens, API headers. Most stays in Nanites; it is the source of truth for runtime
  GitHub behavior.
- `src/backend/api/routes/github.ts` — webhook target-app check and `@octokit/webhooks` verification
  pattern.
- `wrangler.jsonc` — runtime binding/resource list the artifact metadata must express.

Do not copy the deleted setup flow back into either repo.

## Smoke tests

Before calling this done:

1. Provision into a throwaway Cloudflare account.
2. Create a GitHub App from the manifest under a throwaway GitHub org.
3. Confirm the Worker has fixed GitHub vars/secrets.
4. Install the app on one repo.
5. Sign in to Nanites through the deployed Worker.
6. Confirm Nanites records the visible installation and can mint an installation token.
7. Send a GitHub webhook ping and verify pong.
8. Trigger one small Nanite workflow against the installed repo.
