# Zero-Config Self-Hosting Plan

Nanites should be self-hosted by default. A customer should be able to deploy the Cloudflare
runtime, create a customer-owned GitHub App, install it on repositories, and start using Nanites
without copying GitHub App secrets, entering Cloudflare API tokens, editing a secrets file, or
manually selecting GitHub permissions.

The north star is no copy-paste operations:

- no `.dev.vars`, `.env`, Wrangler secret prompts, or dashboard secret entry in the primary path
- no model-provider API keys in Nanites
- no SigVelo-owned GitHub App
- no user-generated Cloudflare API token
- only first-party click-through steps: Cloudflare deploy/account consent, Cloudflare MCP OAuth
  consent, GitHub App creation, GitHub App installation, and GitHub sign-in

The target path is:

1. Deploy Nanites with Cloudflare's Deploy to Cloudflare button.
2. Open the deployed Worker setup screen.
3. Sign in through Cloudflare MCP OAuth so the Worker can prove deployment ownership and write its
   own generated secrets.
4. Create a customer-owned GitHub App through a GitHub App Manifest.
5. Install that GitHub App on selected repositories.
6. Sign in with that GitHub App and use the one-deployment-installation Nanites runtime.

There is no hosted SigVelo SaaS path in this plan.

For interrupted setup, stale GitHub Apps, duplicate installs, secret propagation, and other
non-happy-path behavior, see
[Zero-Config Self-Hosting Edge Cases](./zero-config-self-hosting-edge-cases.md).

## Product Decision

Use Cloudflare's deploy button for infrastructure provisioning and GitHub's App Manifest flow for
GitHub authority provisioning.

Use Cloudflare's managed API MCP server as the primary Cloudflare control-plane bootstrap candidate,
not the dashboard OAuth Clients API directly.

Use the Cloudflare Agents SDK MCP client as the implementation target for that bootstrap, not a
custom browser-only OAuth client. Nanites already uses Agents and `addMcpServer()` for GitHub MCP
connections, so the setup flow should use the same runtime pattern:

- a `NanitesSetupAgent` owns Cloudflare MCP OAuth, callback handling, MCP token storage, setup
  progress, and setup-only Cloudflare `execute()` calls
- the React `/setup` route uses `useAgent()` to read the Agent's synced wizard state and call
  browser-initiated setup actions through the typed Agent `stub`; same-origin HTTP routes remain
  only for third-party redirects and responses that must set or clear HttpOnly setup cookies
- after Cloudflare ownership is proven, the setup Agent issues a short-lived browser setup claim:
  the browser gets an opaque HttpOnly token, while the Agent stores only the token hash and expiry
- after generated Worker secrets are readable, the setup Agent removes or closes the Cloudflare MCP
  connection so the control-plane token is not kept longer than the setup flow needs

Cloudflare's Agents docs describe this shape directly: `addMcpServer()` connects an Agent to an MCP
server, returns an `authUrl` when OAuth is required, stores OAuth tokens in Agent SQLite storage,
and can update React clients through MCP state hooks. Nanites projects that MCP state into
`NanitesSetupAgent` state so the wizard has one source of truth: React renders Agent state and calls
typed Agent `stub` methods, while the Agent owns setup progression, OAuth verifier, callbacks,
refresh token, secret writes, and propagation checks.

Live Cloudflare API probes on June 9, 2026 ruled out the purest dashboard-OAuth version of the idea:
Cloudflare's dashboard authorization endpoint does not currently accept an OAuth Client ID Metadata
Document URL as `client_id`, and registered dashboard OAuth clients reject callback URLs that are not
pre-registered on the client. A fresh self-hosted Worker cannot be its own dashboard OAuth client
just because it now has a URL.

Live Cloudflare MCP probes on the same day found a better zero-copy path. The managed Cloudflare API
MCP server at `https://mcp.cloudflare.com/mcp` advertises Dynamic Client Registration (DCR), accepts
a public client registration with an arbitrary HTTPS redirect URI, and exposes a generic
`execute()` tool backed by `cloudflare.request()` across the Cloudflare API. That lets the
customer-owned Worker become an MCP client, dynamically register itself with the Cloudflare MCP
authorization server, send the user through Cloudflare's MCP authorization screen, and then use MCP
tool calls to verify ownership and write generated Worker secrets.

Treat the DCR-issued access token as an MCP bearer token, not as a raw Cloudflare API token. A live
probe showed the token works against `https://mcp.cloudflare.com/mcp`, but direct
`https://api.cloudflare.com/client/v4/...` calls with the same token return Cloudflare API
authentication failures. Nanites should hard-code the small MCP JSON-RPC client path for setup
control-plane calls through the Agents SDK MCP client instead of trying to reuse the MCP token
directly against the REST API.

This is not CIMD on the managed Cloudflare API MCP server today. Its live authorization metadata
currently reports `client_id_metadata_document_supported: false` and `registration_endpoint:
"https://mcp.cloudflare.com/register"`. Cloudflare's Workers OAuth Provider library can support
CIMD when enabled, but the managed Cloudflare API MCP server appears to use DCR for dynamic clients.

That leaves three honest setup strategies:

- Zero-copy primary candidate: connect the setup Worker to Cloudflare's managed API MCP server using
  DCR and PKCE, then perform setup Cloudflare API operations through MCP `execute()` calls.
- Zero-copy fallback: use one project-owned public Cloudflare dashboard OAuth client with a
  narrowly-scoped, stateless callback relay. The relay is only bootstrap plumbing.
- Fully self-hosted fallback: ask the customer to create a Cloudflare OAuth client or setup-scoped
  API token. This avoids any hosted bootstrap dependency, but it is no longer zero-configuration.

Do not ask customers to use a SigVelo-owned GitHub App. In a self-hosted product, the customer-owned
Worker should own the GitHub App private key, webhook secret, client secret, installation tokens,
webhook intake, and Nanite state.

Do not require GitHub App credentials during the Cloudflare deploy step. The GitHub App manifest
needs the final deployed origin for callback and webhook URLs, so the GitHub App must be created
after the Worker exists.

Do not require an initial `AUTH_COOKIE_SECRET` during deploy. The first-launch setup flow can use a
short-lived setup state stored in the setup Agent's SQLite-backed Durable Object state. After
Cloudflare ownership is proven, setup should generate the deployment's long-lived auth/session
secret and store it alongside the generated GitHub App credentials.

Use Cloudflare-owned model execution. Nanites should default to Cloudflare-hosted Workers AI model
ids through the Worker `AI` binding and deployment AI Gateway, not through Nanites-collected
provider API keys. Third-party provider ids should be explicit operator choices because they can
depend on account-level AI Gateway provider authentication.

## Evidence Matrix

The first-party docs support most of the product story: the user clicks through Cloudflare and
GitHub, and Nanites writes the generated secrets into the customer's own Cloudflare account. Live
Cloudflare probes narrowed the setup authority shape: dashboard OAuth is registered-client only, but
Cloudflare's managed API MCP server supports DCR and can expose Cloudflare API operations through
MCP after user authorization.

Confirmed by first-party docs and live probes:

- A public Nanites repo can expose a Deploy to Cloudflare button. Cloudflare's
  [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
  docs say the button clones a public GitHub/GitLab repo into the user's account, configures the
  project, builds it with Workers Builds, and deploys it. Private repos, non-GitHub/GitLab sources,
  Pages apps, and non-isolated monorepos are documented limitations.
- Cloudflare can provision the core Nanites resources from `wrangler.jsonc`. The deploy-button docs
  list automatic provisioning for KV, D1, R2, Hyperdrive, Vectorize, Secrets Store Secrets, Durable
  Objects, Workers AI, and Queues from the Wrangler config. This covers Nanites' D1, R2, KV, Durable
  Objects, and Workers AI baseline. The root `wrangler.jsonc` is now the portable public template:
  the top-level `DB`, `OAUTH_KV`, `TOOL_OUTPUTS`, and `WORKSPACE_FILES` bindings intentionally omit
  account-specific ids/names where Wrangler can provision them. Named SigVelo environments still
  keep explicit ids in their `env.<name>` blocks.
- Workers Builds can run app build and deploy commands. Cloudflare's
  [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
  docs define the build/deploy command model and say deploy defaults to `npx wrangler deploy`;
  deploy-button docs say custom `build` and `deploy` package scripts are detected and can run D1
  migrations. Nanites' root `deploy` script builds, deploys once with Wrangler auto-provisioning,
  resolves the generated remote D1 database id with `wrangler d1 list --json`, writes a temporary
  migration-only Wrangler config under `.wrangler/`, applies D1 migrations, and redeploys. This is
  necessary because `wrangler d1 migrations apply DB --remote` cannot target a D1 binding that has
  no `database_id` yet, and Workers Builds should not need to commit generated account ids back to
  the repo.
- The first deploy can avoid runtime secrets. Cloudflare's
  [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) docs say
  `secrets.required` makes deploy fail when required secrets are missing; deploy-button docs say
  `.dev.vars.example` and `.env.example` are read as secret inputs. The public template must omit
  GitHub/auth secrets from `secrets.required` and from primary deploy-button secret prompts. The
  root `.dev.vars.example` and `.env.example` are intentionally empty; local development examples
  live under `docs/`.
- The setup Worker can write generated secrets into customer-owned Cloudflare storage. Cloudflare's
  [Workers script secrets API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/)
  supports listing, adding, deleting, and bulk patching script secrets, including `secret_text`
  values. The bulk patch endpoint uses JSON Merge Patch with a top-level `secrets` map. Worker
  secrets docs say secrets are available to Worker code as environment variables and hidden from
  Wrangler/dashboard display.
- If the dashboard OAuth fallback is needed, Cloudflare OAuth scope IDs are dot-delimited and can
  be discovered from
  Cloudflare's
  [OAuth scopes API](https://developers.cloudflare.com/api/resources/iam/subresources/oauth_scopes/methods/list).
  A live query on June 9, 2026 returned the fallback setup scopes Nanites would need:
  `memberships.read user-details.read workers-scripts.write`.
- Dashboard OAuth can replace a customer-created Cloudflare API token for setup actions only after
  the setup flow already has a valid registered OAuth client. A live probe on June 9, 2026 used a
  Wrangler OAuth credential to call Cloudflare's API successfully for `GET /memberships`,
  `GET /accounts`, and `GET /accounts/:account_id/workers/scripts`. The same credential returned
  403 for `GET /accounts/:account_id/oauth_clients` and
  `POST /accounts/:account_id/oauth_clients`, so it can verify account/script ownership and call
  Worker APIs, but it cannot create Cloudflare OAuth clients.
- Cloudflare's OAuth authorization endpoint enforces registered clients and pre-registered redirect
  URIs. A live probe on June 9, 2026 served a valid OAuth Client ID Metadata Document from a
  temporary Worker and used that metadata URL as `client_id`; Cloudflare returned the same
  `invalid_client` result as a deliberately fake URL client id. The known Wrangler client id was
  accepted far enough to redirect to login with its registered localhost callback, but the same
  registered client id with the temporary Worker callback returned `invalid_request` because the
  `redirect_uri` did not match the client's pre-registered callback URLs.
- Cloudflare's managed API MCP server can be the Cloudflare setup authority bootstrap instead of a
  dashboard OAuth client. Cloudflare's
  [own MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
  docs say `https://mcp.cloudflare.com/mcp` provides access to the Cloudflare API through
  `search()` and `execute()`, redirects users through OAuth, and supports bearer-token automation.
  A live probe on June 9, 2026 confirmed:
  - `GET https://mcp.cloudflare.com/mcp` returns a 401 with protected-resource metadata.
  - `GET https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp` points at
    `https://mcp.cloudflare.com` as the authorization server.
  - `GET https://mcp.cloudflare.com/.well-known/oauth-authorization-server` advertises
    `registration_endpoint: "https://mcp.cloudflare.com/register"` and
    `client_id_metadata_document_supported: false`.
  - `POST https://mcp.cloudflare.com/register` accepted a public DCR client with
    `token_endpoint_auth_method: "none"` and an arbitrary HTTPS redirect URI.
  - The resulting `client_id` rendered an authorization page at
    `https://mcp.cloudflare.com/authorize` for that redirect URI.
  - A deployed setup Agent on `https://nanites-app.alexmnahas.workers.dev` regenerated its
    Cloudflare MCP authorization URL after a stale unscoped auth URL and included
    `scope=offline_access user:read account:read workers:read workers_scripts:write`.
  - Cloudflare's managed MCP authorization page currently does not preselect requested write
    scopes from either the OAuth `scope` parameter, repeated `scopes` query parameters,
    `scope_template`, or DCR `scope` metadata. The rendered page hard-codes
    `DEFAULT_TEMPLATE = "read-only"`, encodes 36 read-only scopes into the authorization form
    state, and shows `36 / 78` permissions selected. The working V1 consent path is to choose one
    Cloudflare account, choose `Custom`, click `Deselect all`, and add `Workers Scripts Write`,
    which leaves the required user/account/background scopes plus `workers_scripts:write`.
  - After browser authorization through that DCR client, the MCP token exchanged with PKCE had
    `token_type: "bearer"`, `expires_in: 3600`, and a refresh token.
  - Direct Cloudflare REST calls with the DCR-issued MCP token failed: `/user/tokens/verify`
    returned 400 `Invalid request headers`, and `/memberships` plus
    `/accounts/:account_id/workers/scripts` returned 400 authentication failures.
  - The same DCR-issued MCP token succeeded against `https://mcp.cloudflare.com/mcp`: `initialize`
    returned the `cloudflare-api` server, `tools/list` returned `docs`, `search`, and `execute`, and
    `execute()` listed Workers scripts successfully.
  - Using Cloudflare MCP with an existing Wrangler bearer token for the automation lane,
    `execute()` successfully called `PATCH /accounts/:account_id/workers/scripts/:script_name/secrets-bulk`
    with `application/merge-patch+json`, listed the resulting secret metadata, and the disposable
    Worker saw the new secret at runtime on the first read.
  - MCP `execute()` still hit the same OAuth-client administration boundary as direct Cloudflare API
    calls: listing OAuth clients failed with Cloudflare API error 10000.
  - A deployed Nanites Worker smoke on June 9, 2026 reached the setup Agent over the Agents
    WebSocket RPC protocol and called `connectCloudflare({ origin })`. The Agent inferred the
    current Worker script name `nanites-app`, dynamically connected to Cloudflare's managed API MCP
    server, and returned an authorization URL at `https://mcp.cloudflare.com/authorize` with setup
    state `cloudflare.status: "authenticating"`. This proves the deployed Worker can start the
    Cloudflare MCP bootstrap without a pre-registered Nanites OAuth client.
  - A follow-up deployed Nanites smoke on June 9, 2026 reached `cloudflare.status: "verified"`
    after browser authorization through the DCR client. The setup Agent received the Cloudflare MCP
    OAuth callback, exchanged the PKCE code, called MCP `execute()` to list memberships and Workers
    scripts, and verified that account `ad0d45931959d888de55865d02260ef8` owns script
    `nanites-app`.
    The remaining Nanites-specific live smoke check is that the deployed Agent completes GitHub
    manifest conversion and writes the generated Worker secrets with this setup-granted MCP token
    after the user signs in to GitHub.
- Cloudflare's Agents SDK can own the Cloudflare MCP OAuth session for the setup flow. Cloudflare's
  [McpClient API](https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/)
  docs say `addMcpServer()` connects an Agent to an external MCP server, returns
  `state: "authenticating"` plus `authUrl` when OAuth is required, persists connections in Agent
  SQL storage, and stores OAuth tokens in SQLite across Agent restarts. Cloudflare's
  [OAuth MCP client guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/oauth-mcp-client/)
  shows React `useAgent()` receiving MCP state through `onMcpUpdate`, including
  `server.auth_url` for an authorize button, with no polling. Cloudflare's
  [Agent class internals](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/)
  docs confirm Agents are Durable Objects with long-term storage, which makes them the right home
  for setup OAuth callback state and MCP token storage.
- Cloudflare's Agents SDK should be the browser setup boundary. The
  [Client SDK](https://developers.cloudflare.com/agents/communication-channels/chat/client-sdk/)
  docs say `useAgent()` gives browser clients real-time Agent state sync, RPC calls, streaming, and
  automatic reconnection. The
  [Callable methods](https://developers.cloudflare.com/agents/runtime/lifecycle/callable-methods/)
  docs show browser/mobile clients calling `@callable()` methods through `agent.stub` and reserve
  Durable Object RPC for same-Worker or Agent-to-Agent calls. The
  [Cross-domain authentication](https://developers.cloudflare.com/agents/runtime/operations/cross-domain-authentication/)
  docs say same-origin WebSocket handshakes send browser cookies and prefer HttpOnly cookies; that
  is why the Cloudflare MCP callback sets an HttpOnly setup claim and `NanitesSetupAgent.onConnect`
  binds that claim to the reconnecting `useAgent()` connection. The
  [Agent class internals](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/)
  docs also document lifecycle context through `getCurrentAgent()`, which lets the setup Agent read
  the callback request while handling the MCP OAuth callback.
- The local `use-mcp-react` repo at `/Users/alexmnahas/contracting/use-mcp-react` already models
  this MCP auth shape. It uses `@modelcontextprotocol/sdk`'s `OAuthClientProvider`, supports manual
  `clientId`, DCR, and `clientMetadataUrl`, and its tests prove that when an authorization server
  advertises `client_id_metadata_document_supported`, the hook sends the metadata URL as
  `client_id` instead of registering dynamically. For Cloudflare's managed API MCP server today, DCR
  is the live path because the server advertises DCR and not CIMD.
- GitHub App creation can be click-through and customer-owned. GitHub's
  [Manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
  says the creator follows a URL, names the app, and owns the resulting GitHub App; the manifest
  preconfigures permissions, events, webhook URL, setup URL, and callback URLs.
- GitHub App names cannot be fixed for every self-hosted install. GitHub's
  [registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
  docs say the name cannot be longer than 34 characters and must be unique across GitHub. The setup
  manifest therefore uses a branded generated default name like `Nanites app 1a2b`.
- GitHub App manifests cannot set the app badge. Nanites ships
  `public/assets/nanite-github-app-badge.png`, a 200x200 PNG under 1 MB, for the owner to upload in
  GitHub App settings under **Display information** after registration.
- GitHub returns the generated GitHub App secrets to Nanites. GitHub's manifest docs say the flow
  generates the GitHub App ID, webhook secret, private key PEM, client secret, and client id. The
  [manifest conversion endpoint](https://docs.github.com/en/rest/apps/apps?apiVersion=2026-03-10#create-a-github-app-from-a-manifest)
  exchanges `code` at `POST /app-manifests/{code}/conversions` and its response schema includes
  `client_id`, `client_secret`, `webhook_secret`, and `pem`.
- Install and sign-in can be verified without trusting query params. GitHub's
  [setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
  docs warn `installation_id` can be spoofed. GitHub's
  [user access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
  docs say user tokens can list installations and repositories visible to both the user and app.
- Runtime GitHub access remains installation-scoped. GitHub's
  [installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
  docs say tokens are minted from the app JWT and installation id, can be narrowed by repository and
  permissions, and expire after one hour.

Implementation checks before a public claim:

- The local prototype now uses `NanitesSetupAgent` with the Agents SDK MCP client instead of a
  hand-rolled setup OAuth client. It connects to `https://mcp.cloudflare.com/mcp` with a stable
  `cloudflare-api` server id, exposes React state through `useAgent()`, and sends
  browser-initiated setup actions through the typed Agent `stub`. Direct connect/verify calls now
  mark Cloudflare setup failed instead of leaving durable state on `connecting` or `verifying` if
  the MCP transport fails or times out.
- The setup flow now binds post-Cloudflare setup to the browser that proved ownership. Starting
  Cloudflare OAuth goes through the Agents SDK MCP OAuth callback, which validates OAuth state and
  PKCE from Durable Object storage. After the Agent verifies that the authorized Cloudflare account
  owns the current Worker, the Agent callback returns the `/setup` redirect with a short-lived setup
  claim in an HttpOnly cookie. The Agent binds that claim to the `useAgent()` WebSocket connection
  when the browser reconnects, so GitHub App manifest creation can run through the Agent `stub`.
  HTTP callbacks still validate the cookie directly. The setup Agent stores only token hashes in
  Durable Object storage and clears the claim after repository activation.
- `GET /api/setup/status` remains as a status read because it runs at the current Worker request
  boundary. After the setup Agent writes generated Worker secrets, a long-lived Durable Object may
  still hold an older `env`; the status route reads deployment config with the fresh request `env`
  and passes only a boolean readability signal back to the setup Agent. Browser-initiated actions go
  through the Agent `stub`; the setup Agent owns any current-Worker status probing needed while
  generated secrets propagate.
- When GitHub App manifest conversion completes before generated Worker secrets are readable, the
  callback returns to `/setup?github_app=created`. The setup Agent schedules propagation checks
  against the current Worker request boundary while it reports `secrets-propagating`; once a fresh
  request can read the generated secrets, Agent state moves the repository step to ready. If the
  callback can read generated secrets immediately, it redirects directly to the GitHub App
  installation URL.
- The public deploy template is now id-free for the top-level self-host path, and
  `vp run deploy:validate` verifies the Worker/assets/binding shape with Wrangler `--dry-run`
  without provisioning Cloudflare resources. The V1 product constraint is one Nanites deployment
  per Cloudflare account, so the public template keeps one fixed default resource set for the
  top-level self-host path and the setup flow configures the single selected account. V1 is not an
  idempotent multi-deployment installer for one account: it does not try to namespace, duplicate, or
  reconcile multiple Nanites deployments in the same Cloudflare account. It also assumes the
  default-named resources are fresh, or were originally created by this Nanites template's migration
  history; arbitrary legacy resources with the same names are outside the zero-config path. Treat
  that as an intentional product constraint, not a missing idempotency feature for the first
  self-hosting release.
- The default template sets `NANITES_CLOUDFLARE_SCRIPT_NAME` to the same value as `wrangler.jsonc`
  `name`. That value is not a secret; it lets Cloudflare ownership verification identify the current
  Worker script when the setup page is opened from a custom domain where the script name cannot be
  inferred from the hostname.
- Continue the deployed Cloudflare API MCP bootstrap smoke from the verified callback boundary:
  MCP `initialize`, MCP `tools/list`, and MCP `execute` completion after browser authorization.
- Smoke MCP `execute` writing the generated Worker secrets with the exact permissions granted by
  the Cloudflare MCP authorization screen after the user chooses one account, chooses `Custom`,
  clicks `Deselect all`, and adds `Workers Scripts Write`. The endpoint and JSON-RPC path are
  already exercised with an existing Wrangler bearer token; repeat that secret-write smoke with the
  DCR-issued MCP token from the customer setup flow before making the public claim. If that fails,
  fall back to the project-owned dashboard OAuth client relay or the manual API-token path.
- Smoke test REST script-secret writes and measure when the deployed Worker can read new values.
- Smoke test Deploy to Cloudflare with Nanites' Browser Run and Dynamic Worker Loader bindings.
- Smoke test Workers Builds running the package deploy script after dependency install.

## Setup UI Direction

The `/setup` screen should be a practical wizard, not a landing page or a marketing surface. The
implementation should stay small: use the SigVelo-style Stepper, Button, and Badge primitives,
derive visible step state from `NanitesSetupAgent.state`, and use CSS-only Nanite animation.

Do not add MUI, Chakra, Ant Design, a shadcn runtime package, Stepperize, or an animation package for
V1. Revisit a headless step state library only if setup grows into branching, nested, or schema
validated flows.

Use this flow model:

1. Cloudflare deployment - confirm the Worker and Cloudflare bindings were provisioned by the
   deploy button. Action: `Review`.
2. Cloudflare ownership - run Cloudflare MCP OAuth with PKCE, prove the user owns this deployment,
   and grant setup enough authority to write generated script secrets. Action: `Connect Cloudflare`.
3. GitHub App - start the GitHub App Manifest flow and receive the generated app id, private key,
   webhook secret, client id, and client secret. Action: `Create App`.
4. Repository access - install the customer-owned GitHub App on the repositories Nanites can
   maintain, then verify the installation with the signed-in GitHub user. Action: `Pick Repos`.
5. Star Nanites - verify that the signed-in GitHub user has starred `WebMCP-org/nanites`.
   Action: `Star WebMCP-org/nanites`.
6. Start Nanites - run the final callback, secret, storage, and model-access checks, then enter the
   app. Action: `Start`.

Keep the visible step copy short. Users should see what to click, what is done, and what is locked;
they do not need to see implementation details like PKCE, script secrets, manifest conversion, or
binding names in the primary UI.

### Required Upstream Star Verification

Nanites requires self-hosters to star the upstream repo before launch. This is a setup gate, not a
background OAuth side effect.

The product shape is intentionally direct:

Button: `Star WebMCP-org/nanites`

Subtext: `Star the upstream repo before launching this self-hosted deployment. This helps other self-hosters find the project.`

Behavior: call the star API only after that click, then verify the signed-in GitHub user has starred
the repo before enabling Launch.

The product rule is simple: no silent star during GitHub OAuth and no star during the setup
callback. The user has to click a clearly labeled action after GitHub sign-in. The customer-owned
GitHub App manifest requests the `starring: write` user permission, and the server uses the
signed-in user's GitHub App user access token for:

```text
PUT /user/starred/WebMCP-org/nanites
```

The setup API also supports `GET /user/starred/WebMCP-org/nanites` for the `I already starred it`
path. Launch remains locked until GitHub returns a positive star check.

## First-Party References

### Cloudflare

- [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
  - The button clones a public GitHub/GitLab repo into the user's account, lets the user choose
    Worker/resource names, builds with Workers Builds, and deploys to Cloudflare.
  - It provisions supported resources from the Wrangler config. The docs list KV, D1, R2,
    Hyperdrive, Vectorize, Secrets Store Secrets, Durable Objects, Workers AI, and Queues.
  - It reads Worker secrets from `.dev.vars.example` or `.env.example`.
  - It detects custom `build` and `deploy` scripts from `package.json`.
  - It recommends running D1 migrations from the `deploy` script using the binding name.
  - It supports `package.json.cloudflare.bindings` descriptions for setup-time explanations.
  - It currently requires public GitHub/GitLab repos and only supports Workers applications.
  - The supported resource list does not currently name Browser Run or Dynamic Worker Loader
    bindings, so those require a deploy-button smoke test before we claim full one-click coverage.
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
  - Cloudflare recommends `wrangler.jsonc` for new Workers projects.
  - Wrangler config should be treated as the source of truth.
  - Wrangler automatic provisioning is currently documented for KV, R2, and D1 when resource IDs
    are omitted.
  - Workers AI is configured with an `ai.binding`.
  - `secrets.required` declares required secret bindings for validation and type generation.
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
  - Workers Builds runs an optional build command and a deploy command.
  - The deploy command defaults to `npx wrangler deploy`.
  - If a deploy script exists in `package.json`, it can be used as the deploy command.
  - Workers Builds creates a Cloudflare API token for its own build/deploy work by default, but the
    deployed Worker does not receive that token as runtime authority.
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
  - Use secrets for sensitive values.
  - `secrets.required` makes `wrangler deploy` and `wrangler versions upload` fail when required
    secrets are missing. Therefore the public zero-config template must not list GitHub or auth
    secrets as required initial deploy inputs.
  - `wrangler secret put` creates a new Worker version and deploys it immediately.
  - Secrets can be uploaded with deploys through a secrets file.
  - To Worker code, secrets behave like environment variables, but values are not visible in
    Wrangler or the Cloudflare dashboard after definition.
- [Cloudflare Secrets Store Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/secrets-store/)
  - Secrets Store is available for account-level reusable secrets.
  - This is a possible later storage target for generated GitHub App credentials, but using it from
    the setup Worker requires Cloudflare API authority.
  - Secrets Store is currently beta, has role requirements, and has one-store-per-account behavior
    documented in Wrangler's Secrets Store command docs. Treat per-Worker script secrets as the V1
    storage target unless a smoke test proves Secrets Store bindings are cleaner.
- [Cloudflare Secrets Store Workers integration](https://developers.cloudflare.com/secrets-store/integrations/workers/)
  - Secrets Store is account-level, unlike per-Worker Variables and Secrets.
  - Workers access Secrets Store bindings through the `env` object and an async `get()` call.
  - Binding an account secret to a Worker has role requirements, so V1 should prefer script secrets
    unless a live setup test proves Secrets Store is smoother for generated credentials.
- [Cloudflare's own MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
  - Cloudflare runs managed remote MCP servers that clients can connect to using OAuth.
  - The Cloudflare API MCP server URL is `https://mcp.cloudflare.com/mcp`.
  - The docs say it provides access to the Cloudflare API through two tools, `search()` and
    `execute()`.
  - The docs say users are redirected to Cloudflare to authorize via OAuth and select permissions.
  - The docs say CI/CD or automation can use a Cloudflare API token as a bearer token, and both user
    tokens and account tokens are supported.
  - A live metadata probe on June 9, 2026 showed DCR support through
    `https://mcp.cloudflare.com/register`, not CIMD support on the managed server.
- [Cloudflare MCP authorization docs](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
  - Cloudflare documents MCP authorization as OAuth-based user consent for MCP clients.
  - The Workers OAuth Provider Library can issue MCP tokens from third-party OAuth, a bring-your-own
    provider, or a Worker-owned authorization flow.
  - In third-party-provider mode, the MCP server exchanges the third-party code itself, then issues
    a bound MCP token to the MCP client.
- [Cloudflare Workers OAuth Provider library](https://github.com/cloudflare/workers-oauth-provider)
  - This is the provider library behind Cloudflare Worker MCP OAuth flows.
  - It supports DCR.
  - It also supports Client ID Metadata Documents when
    `clientIdMetadataDocumentEnabled: true` and the Worker uses the `global_fetch_strictly_public`
    compatibility flag.
  - The library reports `client_id_metadata_document_supported: true` only when both CIMD enablement
    requirements are met.
- [Cloudflare OAuth Clients API](https://developers.cloudflare.com/api/resources/iam/subresources/oauth_clients/)
  - Cloudflare OAuth clients can request dot-delimited Cloudflare API scopes and use configured
    redirect URIs.
  - The list/create endpoints are documented at `GET /accounts/{account_id}/oauth_clients` and
    `POST /accounts/{account_id}/oauth_clients`.
  - The API docs list `OAuth Client Read` for list/get and `OAuth Client Write` for create/update.
    The security scheme is Cloudflare API Token or legacy API key, not a bootstrap OAuth grant.
  - OAuth clients support `authorization_code`, optional `refresh_token`, and
    `token_endpoint_auth_method: "none"` for public-client/PKCE-style browser setup flows.
  - Creating a public OAuth client has a verification/promotion model; the client URI host must be
    verified before public promotion, and promotion requires a non-empty client name, logo URI, and
    at least one non-identity scope.
  - A zero-configuration setup path needs a deliberate OAuth client strategy because every
    self-hosted Worker gets its own origin.
- [Cloudflare OAuth scopes API](https://developers.cloudflare.com/api/resources/iam/subresources/oauth_scopes/methods/list)
  - The OAuth scopes endpoint lists the scope ids that an OAuth client can request.
  - The endpoint requires authentication.
  - A live query on June 9, 2026 returned these setup-relevant scope ids:
    `memberships.read`, `user-details.read`, and `workers-scripts.write`.
  - The same live query returned no scope whose id/name/description matched `oauth`, `client`, or
    `iam`, so there was no discoverable OAuth scope that could grant OAuth client administration to
    the setup flow.
- [Wrangler login command](https://developers.cloudflare.com/workers/wrangler/commands/general/#login)
  - Wrangler authenticates with Cloudflare using OAuth.
  - Wrangler exposes the Cloudflare auth URL shape as `https://dash.cloudflare.com/oauth2/auth?...`
    and uses a localhost callback by default.
  - Wrangler can list OAuth scopes; current Wrangler 4.98.0 lists `account:read`, `user:read`,
    `workers_scripts:write`, `workers:write`, `secrets_store:write`, `ai:write`, `browser:write`,
    and related scopes. The OAuth Clients API uses dot-delimited scope ids, so this list is only a
    CLI compatibility alias set, not the implementation contract.
- [Cloudflare Workers script secrets API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/)
  - The Workers API can write script secrets after the user grants the setup flow enough Cloudflare
    authority.
  - The API supports listing, getting metadata for, adding, deleting, and bulk patching script
    secrets.
  - The bulk patch endpoint expects `application/merge-patch+json` with a top-level `secrets` map.
  - The add-secret endpoint accepts `{ "name": "...", "text": "...", "type": "secret_text" }`.
  - The API docs prove the write surface, but do not explicitly state the deploy/version propagation
    behavior. Keep that as a smoke-test requirement.
- [New Workers bulk secrets API endpoint changelog](https://developers.cloudflare.com/changelog/post/2026-06-03-bulk-secrets-api/)
  - The current bulk endpoint was released on June 3, 2026.
  - Its example body creates or updates secrets under `{ "secrets": { ... } }` and deletes secrets
    by setting entries to `null`.
- [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/)
  - Dynamic Workers are the documented product behind runtime-loaded Worker code. Nanites' current
    `worker_loaders` binding must be deploy-button smoke tested because the deploy-button supported
    resource list does not explicitly name it.
- [Browser Run](https://developers.cloudflare.com/browser-run/)
  - Browser Run is available on Free and Paid plans and can be used from Workers for browser
    sessions.
  - Nanites' Browser binding must be deploy-button smoke tested because the deploy-button supported
    resource list does not explicitly name it.

### GitHub

- [Registering a GitHub App from a manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
  - A manifest preconfigures the GitHub App's permissions, events, webhook URL, setup URL, and
    callback URLs.
  - The creator only needs to follow the manifest flow and name the app.
  - The creator owns the resulting GitHub App.
  - The flow generates the app id, webhook secret, private key PEM, client secret, and client id.
  - The three-step manifest handshake must complete within one hour.
  - GitHub redirects back to the manifest `redirect_url` with a temporary `code`.
- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
  - GitHub App names are limited to 34 characters.
  - GitHub App names must be unique across GitHub.
- [Create a GitHub App from a manifest REST endpoint](https://docs.github.com/en/rest/apps/apps?apiVersion=2026-03-10#create-a-github-app-from-a-manifest)
  - `POST /app-manifests/{code}/conversions` exchanges the temporary code for app configuration.
  - The response includes fields Nanites needs: `id`, `slug`, `html_url`, `client_id`,
    `client_secret`, `webhook_secret`, and `pem`.
  - GitHub's current example for this conversion call does not require the user to supply a PAT or
    manually created API token.
- [About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
  - GitHub redirects users to the setup URL after they install the GitHub App.
  - GitHub warns that `installation_id` in the setup URL can be spoofed.
  - Nanites must verify installation access through GitHub API state instead of trusting the query
    parameter alone.
- [About the user authorization callback URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url)
  - GitHub App OAuth callback URLs are the browser sign-in callback surface.
  - GitHub Apps can define up to 10 callback URLs, and the `redirect_uri` authorization parameter
    selects which exact callback URL is used.
  - The self-hosted app should set this to `<origin>/auth/github/callback`.
- [Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
  - GitHub App user tokens are limited to resources both the user and app can access.
  - GitHub documents `GET /user/installations` and installation repository listing as the API path
    for checking visible installations and repositories.
  - GitHub recommends PKCE for the browser authorization flow.
- [Generating an installation access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
  - Installation access tokens are generated from the app private key and installation id.
  - Tokens can be narrowed to specific repositories and permissions.
  - Tokens expire after one hour.
- [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
  - This is the reference for mapping Nanite features to GitHub App permissions.
  - The `Starring` user permission covers `PUT /user/starred/{owner}/{repo}` for GitHub App user
    access tokens.
- [REST API endpoints for starring](https://docs.github.com/rest/activity/starring)
  - `PUT /user/starred/{owner}/{repo}` stars a repository for the authenticated user.
  - For fine-grained GitHub App user access, the endpoint requires `Starring` user permission
    `write` and `Metadata` repository permission `read`.
- [GitHub Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
  - GitHub lists automated starring under rank abuse and also prohibits activity incentivized by
    rewards when it drives inauthentic engagement. The Nanites support action must therefore be
    explicit, optional, and never a setup gate.
- [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
  - This is the reference for event names used in `default_events` and generated trigger filters.
- [Managing private keys for GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)
  - GitHub App private keys are required for app authentication and installation token generation.
  - Private keys do not expire automatically and must be protected and rotated manually.
- [Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
  - GitHub recommends securing app credentials and rotating compromised private keys or secrets.

## Current Repo Anchors

- `wrangler.jsonc` keeps the portable self-hosted template at the top level. Named SigVelo
  environments may carry explicit resource ids, but runtime GitHub App config is deployment
  metadata plus generated Worker secrets.
- `.dev.vars.example` and `.env.example` are deploy-button-safe and intentionally contain no
  key-value prompts. Local development examples live in
  [docs/dev.vars.local.example](../dev.vars.local.example) and
  [docs/env.local.example](../env.local.example).
- [docs/self-hosting.md](../self-hosting.md) documents deploy, setup, local reset, migrations, and
  smoke tests.
- [src/backend/github/index.ts](../../src/backend/github/index.ts) already centralizes GitHub App auth,
  GitHub OAuth token exchange, visible installation listing, repository listing, and scoped
  installation token issuance.
- [src/backend/api/routes/github.ts](../../src/backend/api/routes/github.ts) verifies GitHub webhook
  signatures with `GITHUB_WEBHOOK_SECRET` and dispatches events to the installation manager.
- [src/backend/auth/index.ts](../../src/backend/auth/index.ts) builds the callback URL from the current
  request origin, which is useful for self-hosted origins.
- [src/backend/agents/SigveloManagerConversationAgent.ts](../../src/backend/agents/SigveloManagerConversationAgent.ts)
  creates the GitHub manager messenger from deployment GitHub App config.

## Target Setup Flow

### 1. Cloudflare Deploy

The README and self-hosting guide expose:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/WebMCP-org/nanites)
```

Cloudflare clones the repo into the customer's GitHub/GitLab account, provisions supported
resources from `wrangler.jsonc`, runs the configured build and deploy commands, and deploys the
Worker.

The first deploy should not require any runtime secrets. The first-launch Worker can render `/setup`
with only provisioned resources and public config. The setup flow generates all long-lived secrets
after Cloudflare ownership is proven.

### 2. First Launch

When GitHub App config is missing:

- browser routes show `/setup`
- `/auth/github/login` redirects to `/setup`
- `/mcp` returns a setup-required error
- GitHub webhook route returns a setup-required response except for health/ping behavior that is
  safe without credentials

The setup page computes the deployed origin from the request:

```text
https://<customer-worker-origin>
```

It uses that origin to build:

```text
OAuth callback: https://<origin>/auth/github/callback
Webhook URL:    https://<origin>/api/github/webhook
Setup URL:      https://<origin>/setup/github/installed
Manifest redirect URL: https://<origin>/setup/github/manifest/callback
```

Before the GitHub manifest flow starts, setup must complete Cloudflare owner verification:

1. React calls the setup action exposed by `NanitesSetupAgent`. User-triggered setup work should
   prefer `setupAgent.stub`; use a same-origin HTTP route only when the response must set an
   HttpOnly cookie or handle a third-party redirect.
2. `NanitesSetupAgent` calls `addMcpServer()` for `https://mcp.cloudflare.com/mcp` with the deployed
   Worker callback host.
3. The Agents SDK handles Cloudflare MCP DCR, PKCE, callback state, token exchange, and token
   storage in the Agent's SQLite storage.
4. The user authorizes Cloudflare MCP access from Cloudflare's first-party screen. In the June 9,
   2026 smoke path, Cloudflare did not preselect the requested MCP write scope; the documented
   working selection was one account, `Custom`, `Deselect all`, then `Workers Scripts Write`.
5. The setup Agent calls MCP `execute()` to verify the selected account owns the deployed Worker
   script.
6. The setup Agent stores only short-lived setup authority until the GitHub App credentials have
   been written into Worker Secrets and are readable by the Worker, then removes the Cloudflare MCP
   server connection.

No Cloudflare MCP refresh token is required for V1. Setup needs short-lived authority to complete
the bootstrap, not ongoing control-plane access.

### 3. GitHub App Manifest

The setup page asks for the GitHub owner where the app should be created:

- personal account
- organization slug

Then it POSTs a GitHub App manifest to one of GitHub's first-party manifest endpoints:

```text
https://github.com/settings/apps/new
https://github.com/organizations/<org>/settings/apps/new
```

Example manifest shape:

```json
{
  "name": "Nanites app 1a2b",
  "url": "https://<origin>",
  "description": "Nanites runs small durable agents that maintain selected GitHub repositories through scoped events, schedules, and manual prompts.",
  "public": true,
  "redirect_url": "https://<origin>/setup/github/manifest/callback",
  "callback_urls": ["https://<origin>/auth/github/callback"],
  "setup_url": "https://<origin>/setup/github/installed",
  "setup_on_update": true,
  "request_oauth_on_install": false,
  "hook_attributes": {
    "url": "https://<origin>/api/github/webhook",
    "active": true
  },
  "default_permissions": {
    "actions": "write",
    "checks": "write",
    "contents": "write",
    "deployments": "write",
    "environments": "write",
    "issues": "write",
    "metadata": "read",
    "pages": "write",
    "pull_requests": "write",
    "repository_hooks": "write",
    "repository_projects": "write",
    "secrets": "write",
    "starring": "write",
    "statuses": "write",
    "workflows": "write"
  },
  "default_events": [
    "check_run",
    "check_suite",
    "commit_comment",
    "create",
    "delete",
    "deployment",
    "deployment_status",
    "fork",
    "issue_comment",
    "issues",
    "label",
    "milestone",
    "public",
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
    "pull_request_review_thread",
    "push",
    "release",
    "repository",
    "repository_dispatch",
    "star",
    "status",
    "watch",
    "workflow_dispatch",
    "workflow_job",
    "workflow_run"
  ]
}
```

The generated app asks for a broad repository-maintenance ceiling aligned with the current runtime:

- code and branch work: `contents`, `pull_requests`, `workflows`
- review and CI work: `actions`, `checks`, `statuses`
- repo operations: `deployments`, `environments`, `pages`, `repository_hooks`,
  `repository_projects`, `secrets`
- intake and feedback: `issues`, `metadata`, `starring`

Do not request repository administration, organization administration, security-events, members, or
enterprise permissions in the zero-config path.

Do not request OAuth on install in the first implementation slice. Let GitHub return to Nanites'
setup URL after installation, then run the normal Nanites GitHub OAuth flow and deployment
installation verification check.

### 4. Manifest Conversion

GitHub redirects to `/setup/github/manifest/callback?code=...&state=...`.

Nanites verifies the setup state, then calls:

```text
POST https://api.github.com/app-manifests/<code>/conversions
```

The response becomes the deployment's GitHub App config:

- app id
- app slug
- app HTML URL
- owner
- client id
- client secret
- webhook secret
- private key PEM
- granted permissions
- subscribed events

### 5. Install and Verify

After storing the GitHub App config, Nanites redirects the user to the stored app install URL:

```text
https://github.com/apps/<stored-app-slug>/installations/new
```

When GitHub redirects back to the setup URL after installation, Nanites must not trust the
`installation_id` query parameter by itself. The app should ask the user to sign in through the new
GitHub App OAuth flow, list visible installations through the user token, and record the returned
deployment installation only if GitHub says that user can see it.

That matches the existing browser auth model.

## Setup Ownership

Absolute zero-config has one hard security problem: before the GitHub App exists, a public Worker
has no customer identity. A random first visitor must not be able to claim the deployment by creating
their own GitHub App inside it.

Do not ship a first-visitor-wins setup flow.

Recommended owner guard:

- Use Cloudflare MCP OAuth in setup.
- Ask the user to sign in with Cloudflare, choose the account, and grant the minimal scopes needed
  to verify control of the deployed Worker and write generated setup secrets.
- Verify the selected account owns the deployed Worker route and script before GitHub App manifest
  creation is allowed.
- Use the granted Cloudflare MCP authority to write generated GitHub App credentials into
  customer-owned Worker Secrets through MCP `execute()`.

Direct Cloudflare dashboard OAuth has one resolved design catch: the OAuth client itself must exist
before the customer starts setup, and Cloudflare enforces pre-registered redirect URIs.

A live probe on June 9, 2026 tested the pure self-hosted idea directly:

- served a valid OAuth Client ID Metadata Document at
  `https://<temporary-worker>/.well-known/oauth-client`
- requested Cloudflare OAuth with that URL as `client_id`
- received `invalid_client`, identical to a deliberately fake URL client id
- requested Cloudflare OAuth with Wrangler's known registered client id and Wrangler's localhost
  callback, which redirected to login
- requested Cloudflare OAuth with Wrangler's known registered client id and the temporary Worker
  callback, which returned `invalid_request` because the `redirect_uri` was not pre-registered

So V1 should stop treating URL-as-client-id or arbitrary self-hosted callback URLs as viable
Cloudflare dashboard OAuth primitives.

The zero-copy strategy is now:

- Treat the customer-owned Worker as an MCP client of `https://mcp.cloudflare.com/mcp`.
- Let the Agents SDK MCP client discover Cloudflare metadata, dynamically register the public MCP
  OAuth client, generate PKCE state, handle the callback, and persist tokens in Agent SQLite.
- Let `NanitesSetupAgent` expose setup state and callable methods to React through `useAgent()`.
- Use MCP `execute()` from setup Agent methods to verify account/script ownership and write
  generated Worker secrets.
- Do not send the DCR-issued MCP token directly to `api.cloudflare.com`; live probes show it is an
  MCP token, not a Cloudflare REST API token.

This path needs no SigVelo-owned Cloudflare dashboard OAuth client and no SigVelo callback relay if
Cloudflare's managed API MCP server can perform the final Worker secret writes with user-granted
permissions.

The zero-copy fallback is:

- Create and promote one project-owned public Cloudflare dashboard OAuth client.
- Register a stable relay callback URL on that client.
- Have the relay redirect `code` and `state` back to the customer-owned Worker.
- Have the customer-owned Worker exchange the code using the original PKCE verifier and relay
  callback URL, then use the resulting Cloudflare OAuth token to verify Worker ownership and write
  generated secrets.

The relay must not own runtime data, GitHub credentials, installation tokens, model access, or
Nanite state. It is only a callback URL compatibility shim for Cloudflare's registered-client model.

The fully self-hosted fallback is:

- Ask the customer to create a Cloudflare OAuth client with their deployed Worker callback URL, or
  create a setup-scoped Cloudflare API token with `OAuth Client Write`.
- Use that authority to complete setup.

This fallback preserves total self-hosting, but it reintroduces dashboard setup and likely a
copy-paste operation. It is not the north-star path.

## Credential Storage

The lowest-friction setup stores generated GitHub App credentials inside the customer-owned
Cloudflare account instead of asking the user to copy them manually.

Recommended storage when Cloudflare MCP OAuth is available:

- Write sensitive fields to Worker Secrets for V1:
  - generated `AUTH_COOKIE_SECRET`
  - private key PEM
  - client secret
  - webhook secret
- Store non-sensitive app metadata in D1:
  - app id
  - slug
  - HTML URL
  - owner login/type
  - permissions JSON
  - events JSON
  - created/updated timestamps

Secrets Store remains future research. V1 uses per-Worker script secrets because the implemented
setup Agent already writes those through the Workers script secrets API.

Example table shape:

```sql
CREATE TABLE deployment_github_app_config (
  id TEXT PRIMARY KEY,
  app_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  html_url TEXT NOT NULL,
  owner_login TEXT,
  owner_type TEXT,
  client_id TEXT NOT NULL,
  client_secret_binding TEXT NOT NULL,
  webhook_secret_binding TEXT NOT NULL,
  private_key_binding TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  events_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Fallback storage if Cloudflare MCP OAuth is blocked:

- Store generated GitHub App credentials encrypted in D1.
- Protect setup with a manual operator-only setup gate.
- Do not ask the user for a Cloudflare API token in the primary path.

This fallback is not the north star. It exists only to keep local development and platform edge
cases unblocked.

## Code Changes

### Slice 1: Template-Safe Deploy

- Make `wrangler.jsonc` safe for a public self-hosted deploy.
- Remove hosted SigVelo GitHub App ids from the default self-host path.
- Remove custom hosted route/domain values from the public default path, or move them to a
  non-template operator path.
- Keep binding names stable:
  - `DB`
  - `WORKSPACE_FILES`
  - `OAUTH_KV`
  - `TOOL_OUTPUTS`
  - `AI`
  - `BROWSER`
  - `LOADER`
- Remove GitHub App secrets from initial required deploy secrets.
- Remove `AUTH_COOKIE_SECRET` from initial required deploy secrets. Generate and write it during
  setup after Cloudflare ownership is proven.
- Add `NanitesSetupAgent` as Cloudflare MCP OAuth setup owner. In the zero-copy path, let the
  Agents SDK MCP client handle Cloudflare API MCP DCR, PKCE, callback state, and token storage.
- `package.json` deploy scripts now route the public deploy through `scripts/deploy-self-host.mjs`.
  The script validates the public self-host template, builds, deploys once with Wrangler
  auto-provisioning, resolves the generated remote D1 id, applies D1 migrations, and redeploys:

```json
{
  "scripts": {
    "deploy": "node scripts/deploy-self-host.mjs",
    "deploy:validate": "node scripts/deploy-self-host.mjs --validate"
  }
}
```

- The deploy wrapper reads the `DB` database name and migrations directory from `wrangler.jsonc`
  before writing its temporary migration-only Wrangler config, so deploy and migration use the same
  binding source of truth.
- The deploy wrapper prefers `node_modules/.bin/vp` for build and Wrangler commands, then falls back
  to `vp` only when the local binary is missing. Workers Builds should therefore only need the
  normal dependency install step, not a globally installed Vite+ CLI.
- The deploy wrapper treats D1 migration apply failures as the first-line signal for conflicting
  default resources in the selected Cloudflare account. It leaves Wrangler's migration output intact,
  then prints the V1 constraint: one Nanites deployment per Cloudflare account, with a fresh
  `nanites-db` or one already created by this template's migration history.
- Do not add setup-time secret prompts. The primary Deploy to Cloudflare path should not need
  `package.json.cloudflare.bindings` descriptions until Nanites introduces an operator-provided
  value that cannot be generated by `/setup`.
- Keep `scripts/validate-self-host-template.mjs` in `deploy:validate` so the public template fails
  fast if generated secrets reappear in deploy-time examples, account-specific ids enter the default
  Wrangler config, required setup bindings are removed, or the package-manager/dependency setup
  stops producing local `vp` and `wrangler` binaries after dependency install.
- Smoke test Workers Builds with the local `node_modules/.bin/vp` resolution in the public deploy
  script.

### Slice 2: GitHub App Config Owner

- Add D1 migration for `deployment_github_app_config`.
- Add a backend owner module near the existing GitHub boundary, for example
  `src/backend/github/app-config.ts`.
- Expose:
  - `readDeploymentGitHubAppConfig(db, env)`
  - `requireDeploymentGitHubAppConfig(db, env)`
  - `saveDeploymentGitHubAppConfig(db, config)`
- Do not keep an env-var GitHub App config fallback. Nanites is pre-production; reset stale local
  state and use the generated deployment metadata path.
- Add setup-required error kinds in [src/backend/errors.ts](../../src/backend/errors.ts).

### Slice 3: Setup Agent and Routes

Add a setup Agent and thin setup routes under the existing Hono app:

- `NanitesSetupAgent` as an Agents SDK Durable Object
- `/agents/nanites-setup-agent/default/*` for setup Agent WebSocket/RPC and Cloudflare MCP callback
- `GET /api/setup/status` as a status read from the current Worker request `env`, used to detect
  generated-secret propagation without exposing secret values
- `GET /setup/github/manifest/callback`
- `GET /setup/github/installed`

The setup Agent should:

- verify the setup owner guard before allowing manifest creation
- generate and store an anti-CSRF state
- use `addMcpServer()` so the Agents SDK handles Cloudflare MCP DCR, PKCE, callback state, token
  exchange, and token storage
- expose only browser-initiated actions such as `connectCloudflare` and `startGitHubManifest` as
  `@callable()` methods; use same-Worker Durable Object RPC for manifest callbacks, status refresh,
  and repository installation
- store setup-scoped Cloudflare MCP authority only long enough to write generated secrets through
  MCP `execute()` and verify that the current Worker can read those generated bindings
- build the manifest from the current request origin
- return the GitHub manifest action/payload to React so the browser can POST to GitHub's
  first-party manifest endpoint
- exchange GitHub's temporary code for app credentials
- write generated credentials to Worker Secrets
- redirect the user to app installation only when generated secrets are already readable; otherwise
  keep setup in `secrets-propagating` until the Agent observes readability

After writing Worker Secrets, setup redirects back to `/setup` when the current Worker cannot read
the generated bindings yet. The setup Agent keeps the GitHub App step in `secrets-propagating` and
schedules current-Worker status checks until `readDeploymentGitHubAppConfig()` can read the
generated `AUTH_COOKIE_SECRET`, GitHub client secret, webhook secret, and private key.
If those bindings remain unreadable after the propagation window, the setup Agent marks GitHub App
setup as stalled and retryable so the user can rerun the manifest flow with a fresh state value.
Readable GitHub App config unlocks GitHub App installation, but it does not complete setup by
itself. The setup Agent keeps launch locked until the GitHub setup URL returns and Nanites verifies
the returned deployment GitHub App installation against the signed-in user's visible installations.

### Slice 4: Runtime Rewire

Replace direct reads of GitHub app values from `Env` with the deployment app config owner:

- [src/backend/github/index.ts](../../src/backend/github/index.ts)
  - `createGitHubAppAuth`
  - `createGitHubInstallationOctokit`
  - `exchangeGitHubOAuthCode`
- [src/backend/auth/index.ts](../../src/backend/auth/index.ts)
  - `startGitHubOAuthLogin`
  - `completeGitHubOAuthCallback`
- [src/backend/api/routes/github.ts](../../src/backend/api/routes/github.ts)
  - webhook signature verification
- [src/backend/agents/SigveloManagerConversationAgent.ts](../../src/backend/agents/SigveloManagerConversationAgent.ts)
  - GitHub manager messenger auth from deployment GitHub App config
- [src/frontend/routes/\_authenticated/nanites/route.tsx](../../src/frontend/routes/_authenticated/nanites/route.tsx)
  - show setup-required state instead of linking to the SigVelo app when config is missing

Expect several GitHub helper functions to become async because they need D1-backed config.

### Slice 5: Documentation and Smoke

- [README.md](../../README.md) now includes the Deploy to Cloudflare button for the public
  `WebMCP-org/nanites` repo URL.
- Rewrite [docs/self-hosting.md](../self-hosting.md) around:
  - click deploy
  - open setup
  - create GitHub App
  - install GitHub App
  - sign in
  - create/test first Nanite
- Keep manual Wrangler commands only for local reset and named operator environments, not as an
  alternate GitHub App setup path.
- Add one setup troubleshooting section:
  - Cloudflare MCP authorization failed
  - GitHub manifest callback expired
  - GitHub App install pending org approval
  - setup URL installation id could not be verified
  - Cloudflare deploy-button resource provisioning failure

## Tests

Use slice integration tests for app-local behavior.

Recommended tests:

- setup-required behavior when no GitHub App config exists
- setup route rejects missing/invalid setup claim
- manifest generation uses the current request origin for callback, webhook, setup, and redirect URLs
- manifest generation includes the expected permissions and events
- manifest callback rejects invalid state
- manifest callback stores encrypted sensitive fields
- GitHub OAuth login uses stored app config
- GitHub webhook route uses stored webhook secret
- install link uses stored app slug/html URL
- setup URL does not trust `installation_id` without GitHub-visible-installation verification

Mock only external GitHub HTTP boundaries, preferably with MSW. Do not mock app-local modules.

## Deploy-Button Smoke Test

Before claiming the path works:

1. Push a branch with template-safe `wrangler.jsonc`.
2. Open:

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/WebMCP-org/nanites
```

3. Confirm Cloudflare provisions:
   - D1
   - R2
   - KV namespaces
   - Durable Objects
   - Workers AI binding
4. Confirm whether deploy buttons handle:
   - Worker Loader binding
   - Browser binding
5. Confirm Workers Builds can run the package deploy script after dependency install.
6. Confirm remote D1 migrations run from the deploy command.
7. Confirm first launch reaches `/setup` without any required deploy secret.
8. Confirm Cloudflare API MCP DCR accepts the deployed Worker callback URL.
9. Confirm the Cloudflare API MCP OAuth callback reaches the deployed Worker and the Worker can
   exchange the code with PKCE.
10. Confirm Cloudflare API MCP `execute()` can verify script ownership and write generated Worker
    Secrets with the DCR-issued MCP token granted by the user.
11. Run the GitHub App Manifest flow against a test organization.
12. Confirm setup writes the generated GitHub credentials and `AUTH_COOKIE_SECRET` into
    customer-owned Cloudflare storage.
13. Install the generated GitHub App on a test repo.
14. Sign in through the generated GitHub App.
15. Create and test one Nanite.

If Worker Loader or Browser bindings are not supported by deploy-button provisioning, document the
minimum manual Cloudflare step and keep the issue isolated. Do not block the rest of the setup work
unless those bindings are required before the app can render `/setup`.

## Open Questions

- Can Deploy to Cloudflare provision `worker_loaders` and Browser bindings from `wrangler.jsonc`?
- Does Workers Builds invoke the package deploy script with dependencies installed and
  `node_modules/.bin/vp` available on a fresh Deploy to Cloudflare project?
- Should generated `AUTH_COOKIE_SECRET` become a broader `NANITES_INSTANCE_SECRET`, or should we
  keep one auth-cookie secret plus separate generated secret bindings for setup encryption?
- Will Cloudflare add a supported way to preselect a custom MCP permission set, or should V1
  explicitly keep the one manual `Custom` plus `Workers Scripts Write` selection in the setup docs?
- Does the DCR-issued Cloudflare MCP token get enough user-granted permission for the proven
  `secrets-bulk` MCP `execute()` call, or did the successful secret-write probe only work because
  the automation lane used an existing Wrangler bearer token?
- If Cloudflare API MCP cannot write Worker secrets, are we willing to run a stateless setup
  callback relay even though there will never be a hosted Nanites SaaS control plane?
- Does the Workers script secrets API deploy a new Worker version with updated secret bindings in
  the same way `wrangler secret put` does, and what is the observable propagation time?

## Acceptance Criteria

- A fresh customer can deploy Nanites from the public repo with the Cloudflare button.
- The first deployed page sends the customer into setup instead of failing on missing GitHub App
  secrets.
- The initial Cloudflare deploy does not prompt for Nanites runtime secrets.
- The setup flow uses Cloudflare MCP OAuth/PKCE, not a user-created Cloudflare API token.
- The setup flow writes the generated auth secret and GitHub App credentials into customer-owned
  Cloudflare storage without asking the customer to copy values.
- The setup flow creates a customer-owned GitHub App from a manifest with Nanites permissions and
  webhook/callback URLs derived from the deployed origin.
- The customer does not manually copy GitHub App private keys, webhook secrets, client secrets,
  callback URLs, webhook URLs, Cloudflare API tokens, or auth-cookie secrets.
- The runtime uses the customer-owned GitHub App for browser OAuth, webhook verification,
  installation token issuance, repository listing, and Nanite git/GitHub MCP capability.
- The setup URL does not trust spoofable `installation_id` query parameters.
- Existing Nanites boundaries remain intact: GitHub installation is the authority boundary, the
  manager owns policy/routing, Nanite sub-agents own work, and generated trigger handlers only emit
  manager intents.
