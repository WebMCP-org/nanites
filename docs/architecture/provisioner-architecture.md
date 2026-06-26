# Provisioner Architecture for Setup and Deploy Code

**Status: current direction (2026-06). Supersedes the "Zero-Config Self-Hosting" docs.**

Start here before changing setup, deploy, provision, or self-host code in `nanites`.

## Runtime delivery model

Nanites ships as a private compiled Cloudflare Worker artifact installed into the deployment
owner's Cloudflare account.

That model sets the boundary:

- SigVelo does not host Nanite execution after installation.
- The deployment owner pays Cloudflare directly for compute and Workers AI.
- Provisioning must not clone or expose Nanites source.
- Provisioning happens outside this repo; this repo reads config and runs.

The Cloudflare "Deploy to Cloudflare" button is the wrong primitive for this product. It requires a
public repo and clones source into the target account. Both break the private-artifact model.

## Repository boundary

- **`nanites` (this repo) is runtime only.** It contains no setup or provisioning flow. It boots
  from the runtime contract below and owns GitHub-installation agents, the MCP server, webhooks, and
  chat.
- **`sigvelo` (sibling repo) is the provisioner.** Server endpoints in the `apps/landing` Astro app
  are the single registered Cloudflare OAuth client. The deployment owner authorizes Cloudflare
  once, then the provisioner installs or updates Nanites in that Cloudflare account.

After install, normal Nanite execution stays inside the deployment owner's Cloudflare account. Runtime
code should not depend on a SigVelo-hosted deployment registry, setup session, or shared GitHub App.

The old in-Worker setup flow (`NanitesSetupAgent`, `/setup*` routes, the React wizard, and the
Cloudflare-MCP/DCR bootstrap) was deleted. Do not reintroduce it here.

Multiple Nanites deployments may live in one Cloudflare account, but they must be separate Worker,
D1, KV, R2, and Durable Object resources with separate deployment-owned GitHub Apps. Do not model
those deployments as tenants inside one Nanites runtime.

## Provisioning flow

This flow lives in `sigvelo`, not `nanites`.

1. Nanites CI builds a versioned artifact: Worker bundle plus client assets.
2. CI publishes that artifact to a private SigVelo R2 bucket.
3. The deployment owner authorizes Cloudflare through the single provisioner OAuth client on a fixed
   SigVelo domain. That produces a real `api.cloudflare.com` REST token for the selected account.
4. The provisioner reads the artifact from R2 and uploads it through the Cloudflare API: create
   KV/D1/R2, upload the Worker script and bindings, apply Durable Object `new_sqlite_classes`
   migrations, upload assets with the Workers assets upload-session flow, apply D1 migrations, write
   secrets, and enable `workers.dev`.
5. The provisioner creates a deployment-owned GitHub App through the GitHub App manifest flow and
   writes its secrets into the Worker.

The provisioner OAuth client is SigVelo infrastructure. It is created and promoted with the
Cloudflare API (`POST .../oauth_clients`, DNS TXT verification, then `PATCH` to public); it is not a
per-deployment resource.

## Runtime contract read by this repo

These reads are the boundary between the provisioner and runtime.

1. **Four Worker vars**: `CLOUDFLARE_ACCOUNT_ID`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and
   `GITHUB_APP_CLIENT_ID`.
2. **Five required Worker secrets**: `AUTH_COOKIE_SECRET`, `CLOUDFLARE_API_TOKEN`,
   `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_SECRET`, and `GITHUB_APP_WEBHOOK_SECRET`.
3. **GitHub installation rows** in `accounts`, `accountInstallations`, and `accountRepositories`,
   read by `requireDeploymentGitHubInstallation` in `src/backend/auth/installations.ts`.

Runtime manager names are derived from the deployment installation only:

```text
installation:<githubInstallationId>
```

The deployment's fixed Worker app config supplies credentials when GitHub APIs need them.

The provisioner does not write the installation rows. Nanites discovers them at runtime: on GitHub
sign-in, `completeGitHubOAuthCallback` in `src/backend/auth/index.ts` lists the user's visible
installations for the deployment app and upserts the rows best-effort. This is runtime identity
resolution, not setup.

## Keep in this repo

- Runtime contract reads and GitHub installation self-discovery.
- The MCP server: `/mcp`, the `OAuthProvider` in `src/server.ts`, and
  `src/backend/api/routes/mcp.ts`. This is the product MCP endpoint, not the deleted Cloudflare
  setup OAuth client.
- Runtime auth, GitHub webhooks, and agents: `src/backend/auth/*`,
  `src/backend/api/routes/github.ts`, `SigveloNaniteManager`, `SigveloManagerConversationAgent`,
  `SigveloNaniteAgent`, and `NaniteRunWorkflow`.

## Delete if found

Anything that sets up, bootstraps, or provisions Nanites from inside the Worker is obsolete:

- `NanitesSetupAgent`, `/setup*` routes, setup wizard UI, setup-policy, `NANITES_SHOW_SETUP`, setup
  claims/nonces, Cloudflare-MCP/DCR bootstrap, and secret-propagation polling.
- Deploy-button assumptions and "zero-config self-hosting" framing.
- Hosted SigVelo GitHub App fallbacks: `DEFAULT_GITHUB_APP_SLUG = "sigvelo"`,
  `SIGVELO_GITHUB_APP_URL`, and the `?? SIGVELO_GITHUB_APP_URL` /
  `?? DEFAULT_GITHUB_APP_SLUG` fallbacks in
  `src/frontend/routes/_authenticated/nanites/route.tsx` and `src/shared/utils/github.ts`.
- Shared-control-plane assumptions: deployment registries, per-deployment setup sessions,
  license/billing gates, team or seat models, or code that routes runtime execution back through
  SigVelo.

If unsure whether something is dead, grep for non-test callers. No callers, or only tests that exist
to test the obsolete path, means delete the code and the tests. Keep `vp check`, `vp build`, and
`vp test` green. This repo is pre-production; update the baseline schema instead of preserving
obsolete migration paths.

## Provisioner work that belongs in `sigvelo`

- De-risk Cloudflare API calls for OAuth-client creation and the Workers assets upload-session flow.
- Build provisioner endpoints in `apps/landing`.
- Remove dead `apps/agent` and `apps/conduit` code.
- Publish versioned Nanites artifacts from CI to the private R2 bucket.
- Register and publicly promote the permanent Cloudflare OAuth client.
- Smoke an end-to-end install on a throwaway Cloudflare account.
