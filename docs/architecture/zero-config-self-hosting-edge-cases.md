# Zero-Config Self-Hosting Edge Cases

Last checked: June 25, 2026.

This investigation defines how the setup flow should behave when the happy path is interrupted,
replayed, or pointed at pre-existing Cloudflare/GitHub state.

The V1 product rule is intentionally narrow:

- one Nanites deployment per Cloudflare account
- one generated customer-owned GitHub App per Nanites deployment
- no manual secret entry in the primary path
- no attempt to import arbitrary older GitHub Apps during setup

That rule keeps the setup flow understandable. The customer can click through first-party
Cloudflare and GitHub screens, but Nanites does not promise to reconcile every old self-hosting
attempt in the same account.

## First-party evidence

- Cloudflare's
  [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
  clones a public Git repo into the user's GitHub/GitLab account, lets the user configure project
  details, and deploys the Worker in the user's Cloudflare account.
- Cloudflare Workers
  [secrets docs](https://developers.cloudflare.com/workers/configuration/secrets/) say
  `wrangler secret put` creates a new Worker version and deploys it immediately. The API also
  exposes Worker script secret operations, including
  [bulk patching script secrets](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/bulk_update/).
- Cloudflare Wrangler
  [configuration docs](https://developers.cloudflare.com/workers/wrangler/configuration/) define
  `secrets.required`, local `.dev.vars`/`.env` behavior, and say Wrangler will not delete Worker
  secrets unless `wrangler secret delete` is run.
- Cloudflare Agents
  [state docs](https://developers.cloudflare.com/agents/runtime/lifecycle/state/) describe Agent
  state as persistent, SQLite-backed, and synchronized to connected WebSocket clients.
- Cloudflare Agents
  [MCP client docs](https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/)
  describe `addMcpServer()`, OAuth-required `authUrl` responses, and automatic callback/token
  handling.
- Cloudflare documents its managed
  [Cloudflare API MCP server](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
  as a remote MCP server at `https://mcp.cloudflare.com/mcp` that exposes the Cloudflare API
  through `search()` and `execute()`.
- GitHub's
  [GitHub App Manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
  creates a customer-owned GitHub App registration and generates the app id, client secret, webhook
  secret, and private key during the manifest conversion handshake. GitHub requires the manifest
  flow to finish within one hour.
- GitHub's
  [manifest conversion endpoint](https://docs.github.com/en/rest/apps/apps#create-a-github-app-from-a-manifest)
  exchanges the temporary manifest code for the app's generated configuration.
- GitHub's
  [user-visible installations endpoint](https://docs.github.com/rest/apps/installations#list-app-installations-accessible-to-the-user-access-token)
  lists installations of the GitHub App that the signed-in user can access. Nanites uses this as
  the post-install verification boundary instead of trusting the raw `installation_id` query
  parameter.

## Current setup boundary

The current branch implements this setup split:

- `/setup` renders the setup wizard and reads `NanitesSetupAgent` state through `useAgent()`.
- `NanitesSetupAgent` owns Cloudflare MCP OAuth, setup state, setup claims, GitHub manifest
  generation, Worker secret writes, and secret propagation checks.
- HTTP setup routes remain only for third-party redirects and cookie-bearing responses:
  `/setup/github/manifest/callback`, `/setup/github/installed`, and `/setup/github/verify`.
- The GitHub App metadata row is stored in D1 under one deployment-wide id, `current`.
- The generated secret values live in Worker secret bindings:
  `AUTH_COOKIE_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET`, and
  `GITHUB_WEBHOOK_SECRET`.
- Setup completes only after Nanites can read the generated runtime config and verify the returned
  deployment GitHub installation through the signed-in user's visible installations.

That makes the setup Agent the source of truth for wizard state. React should render Agent state
and call Agent RPC methods; it should not keep a parallel setup state machine.

## Edge-case matrix

| Scenario                                                                               | Expected V1 behavior                                                                                                                                                                     | Current state                                                                                                                                           | Gap                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh Deploy to Cloudflare, no GitHub App config                                       | Route the user to `/setup`, connect Cloudflare, create a GitHub App manifest, write secrets, install app, verify installation, launch.                                                   | Implemented locally. `/auth/github/login` and `/mcp` return setup-required when config is missing.                                                      | Still needs live deploy-button smoke against a fresh Cloudflare account.                                                                                     |
| Same Worker redeployed after successful setup                                          | Preserve D1 metadata and Worker secrets; `/setup` should skip completed steps and runtime should continue using the same app.                                                            | Mostly covered. Wrangler docs say secrets are not deleted unless explicitly deleted. Agent `refresh()` reads D1 metadata plus current env secrets.      | Add a release smoke that redeploys after setup and confirms the app stays configured.                                                                        |
| New Worker in an org that already has an old Nanites GitHub App                        | Create a new GitHub App for the new Worker. Warn the user to uninstall the old app from overlapping repos if they no longer want duplicate webhooks.                                     | Not explicitly messaged in UI/docs yet.                                                                                                                 | Add setup copy/troubleshooting for old apps and duplicate installations.                                                                                     |
| User wants to reuse an existing GitHub App with a new Worker                           | Do not import it in V1. Create a fresh deployment-owned app through `/setup`; for local/pre-production drift, reset state and rerun setup.                                               | Implemented. Runtime GitHub App config is read from deployment metadata plus generated Worker secrets, not env-only app ids.                            | Add UI/docs copy explaining why reuse is not part of V1.                                                                                                     |
| Old GitHub App exists but old private key/client secret/webhook secret are unavailable | Do not import it. GitHub generated these secrets during manifest conversion, but the new Worker cannot recover them later.                                                               | Current setup creates a new app.                                                                                                                        | Add docs explaining why reuse is not magic.                                                                                                                  |
| Old and new GitHub Apps are both installed on the same repo                            | Both apps can receive GitHub events if both webhooks are active. Nanites should not try to dedupe another app's webhooks.                                                                | No special handling.                                                                                                                                    | Add docs warning and a post-setup checklist to uninstall stale apps.                                                                                         |
| User starts setup from a custom domain                                                 | Verify the Cloudflare account owns the custom domain route and knows the Worker script name.                                                                                             | Out of the prompt-free V1 path. `workers.dev` can infer the script name from the hostname.                                                              | Add an operator path for custom-domain-first setup if it matters.                                                                                            |
| User changes the Worker URL after setup                                                | Existing GitHub App URLs still point at the old origin. The user must update the GitHub App registration or rerun setup for the new deployment.                                          | Current manifest URLs are generated from the origin used during setup.                                                                                  | Add troubleshooting for URL drift and custom-domain cutover.                                                                                                 |
| Wrong Cloudflare account selected                                                      | Cloudflare verification should fail before GitHub App creation.                                                                                                                          | Implemented. The setup Agent checks memberships, Workers subdomain or custom domain route, and script ownership through MCP.                            | Improve error copy so the user knows to reconnect with the owning account.                                                                                   |
| Cloudflare MCP OAuth is cancelled or fails                                             | Stay on the Cloudflare step with a retryable failure. No GitHub App should be created.                                                                                                   | Implemented as `cloudflare.failed`.                                                                                                                     | Add UI copy for retry.                                                                                                                                       |
| Cloudflare MCP OAuth grants read access but not Workers Scripts Write                  | Ownership verification may pass, but Worker secret write will fail. The GitHub App step should become retryable.                                                                         | Secret write failures become `cloudflareWorkerSecretWriteFailed`.                                                                                       | Confirm live Cloudflare permission UI still requires manual Custom + Workers Scripts Write selection, or remove this note when Cloudflare improves defaults. |
| Cloudflare MCP token is ready from a previous attempt                                  | Reuse it only if it has the expected setup scope and can still verify the current Worker; otherwise reconnect.                                                                           | Current code removes an authenticating server whose `auth_url` has unexpected scope and removes failed servers before retry.                            | Consider explicit disconnect/reset for stale ready servers that verify the wrong account.                                                                    |
| Setup claim expires before GitHub App creation finishes                                | Reject the GitHub step and require reconnecting Cloudflare. Do not ask for manual secrets.                                                                                               | Implemented. Setup claim TTL is one hour.                                                                                                               | UI should say the setup session expired and reconnecting Cloudflare is the fix.                                                                              |
| Setup is opened in a different browser/profile after Cloudflare proof                  | The second browser lacks the HttpOnly setup claim. It must reconnect Cloudflare.                                                                                                         | Implemented by setup claim and connection-state checks.                                                                                                 | Add UI copy for cross-browser/profile attempts.                                                                                                              |
| Two operators run setup concurrently                                                   | One setup Agent instance owns the deployment. Once one browser starts Cloudflare setup, another browser cannot mutate Cloudflare setup state until that owner claim is reset or expires. | Implemented. Browser-local setup owner claims guard Cloudflare setup mutation, and callback state/claim binding rejects older GitHub manifest attempts. | Add UI copy for single-operator setup and cross-browser/profile attempts.                                                                                    |
| User abandons the GitHub manifest form                                                 | Returning to `/setup` should allow a fresh manifest attempt with a new state.                                                                                                            | Covered by tests. `startGitHubManifest()` is allowed from `creating`, `failed`, and stalled states.                                                     | Good enough for V1.                                                                                                                                          |
| GitHub manifest flow exceeds one hour                                                  | GitHub conversion should fail; setup should show a retryable GitHub App failure.                                                                                                         | Conversion failure maps to `githubAppManifestConversionFailed`.                                                                                         | Add UI copy that retrying creates a fresh manifest.                                                                                                          |
| User lacks permission to create a GitHub App in the selected org                       | GitHub blocks creation. Nanites remains retryable; the user can choose a personal account or another org.                                                                                | GitHub owns the failure before callback.                                                                                                                | Add UI copy before org creation: use an org where you can create GitHub Apps.                                                                                |
| GitHub App name collision                                                              | Retry with a fresh generated suffix.                                                                                                                                                     | Manifest names are generated from random manifest state. GitHub `422` would surface as conversion/manifest failure depending on where it occurs.        | Good enough for V1; mention retry.                                                                                                                           |
| User edits generated GitHub App permissions/events before creation                     | Nanites should reject or warn if the returned app lacks the minimum permissions/events.                                                                                                  | Implemented. Manifest conversion validates returned permissions/events before Worker secret writes.                                                     | Good enough for V1.                                                                                                                                          |
| Manifest conversion succeeds but Worker secret write fails                             | Mark GitHub App setup failed and retryable. A GitHub App may now exist but not be usable by this Worker.                                                                                 | Implemented. D1 metadata is saved only after secret writes succeed, and setup preserves the orphan app URL plus cleanup instructions when available.    | Good enough for V1.                                                                                                                                          |
| Worker secret write succeeds but D1 metadata save fails                                | Retry setup. Existing generated secrets may be overwritten by the next successful attempt; the app created in the failed attempt may be orphaned.                                        | Possible. Secrets are written before metadata is saved.                                                                                                 | Consider saving a temporary "conversion started" record with app URL before writing secrets, or document orphan cleanup.                                     |
| D1 metadata exists but generated secrets are not yet readable                          | Keep GitHub App in `secrets-propagating`, schedule checks, and do not unlock launch.                                                                                                     | Implemented. After the retry window, setup marks `secrets-propagation-stalled`.                                                                         | Measure real Cloudflare propagation time during live smoke.                                                                                                  |
| D1 metadata exists but one generated secret was deleted later                          | Runtime config should become unreadable and setup should fall back to propagation/stalled state.                                                                                         | `readDeploymentGitHubAppConfig()` returns null if any required generated secret is missing.                                                             | Add operator troubleshooting for deleted secrets.                                                                                                            |
| Generated secrets exist but D1 metadata was deleted/reset                              | Setup cannot reconstruct app id, client id, slug, owner, permissions, and events from only secret bindings. Treat as unconfigured and rerun setup.                                       | Implemented. Env-only GitHub App config fallback has been deleted.                                                                                      | Document that D1 metadata is part of the generated app config.                                                                                               |
| User installs GitHub App but closes the setup tab before returning                     | Returning to `/setup` should show GitHub App complete if secrets are readable, but launch remains locked until installation verification runs.                                           | Agent state shows app complete and repositories ready; the repository step links back to GitHub installation again.                                     | Good enough for V1.                                                                                                                                          |
| GitHub redirects to `/auth/github/callback` with `installation_id` and no OAuth state  | Treat it as an install/update callback, not a failed OAuth login. Start GitHub login with returnTo `/setup/github/verify?...`.                                                           | Implemented in auth route and setup route tests.                                                                                                        | Good enough for V1.                                                                                                                                          |
| GitHub setup URL omits `installation_id`                                               | Reject verification.                                                                                                                                                                     | Covered. `/setup/github/installed` requires a positive `installation_id`.                                                                               | Good enough for V1.                                                                                                                                          |
| Attacker spoofs an `installation_id` query param                                       | Do not trust it. Verify that the signed-in user can see that installation through GitHub's user-installations API.                                                                       | Covered. `/setup/github/verify` lists visible installations and matches the requested id.                                                               | Good enough for V1.                                                                                                                                          |
| Signed-in GitHub user cannot see the installation                                      | Reject setup verification and return to repository step.                                                                                                                                 | Current route throws `setupInstallationVerificationFailed`.                                                                                             | Improve UI to make the fix clear: sign in as a user with access or reinstall app.                                                                            |
| User installs the app on no repositories                                               | Setup should not launch until at least one repository is visible for the installation.                                                                                                   | Implemented. Setup verification lists installation repositories and rejects empty access before recording setup state.                                  | Good enough for V1.                                                                                                                                          |
| App installation permissions are changed later                                         | Runtime GitHub calls can fail with 403 or missing events. The UI should surface "reinstall/update GitHub App permissions."                                                               | Signed `installation.new_permissions_accepted` webhooks move completed setup back to repository repair for the deployment installation.                 | Add broader runtime readiness checks when runtime GitHub calls fail outside webhook paths.                                                                   |
| App installation is suspended/uninstalled later                                        | Runtime should prompt reinstall when GitHub no longer lists the deployment installation.                                                                                                 | Signed `installation.deleted`, `installation.suspend`, and `installation_repositories.removed` webhooks move completed setup back to repository repair. | Dashboard copy can still improve, but V1 has a durable setup repair transition.                                                                              |
| Manual fallback env config exists                                                      | Do not treat env-only GitHub App ids as setup-complete. `/setup` owns GitHub App creation and verification, and install verification requires the setup claim.                           | Implemented. Env-only app config and no-claim install verification paths have been deleted.                                                             | Good enough for V1.                                                                                                                                          |
| Local dev `.dev.vars` exists with placeholder values                                   | Do not treat placeholders as valid config.                                                                                                                                               | `readConfiguredSecret()` rejects values starting with `replace-with-`.                                                                                  | Good enough for V1.                                                                                                                                          |
| Deploy-button build/provisioning fails before `/setup` exists                          | The user is still in Cloudflare's deploy/build flow. Nanites cannot repair a Worker that did not deploy.                                                                                 | Not app-handled.                                                                                                                                        | Keep `vp run deploy:validate` and deploy-button smoke steps in docs.                                                                                         |
| Deploy creates conflicting default D1/R2/KV names in a non-fresh account               | V1 assumes account freshness or one Nanites deployment per Cloudflare account.                                                                                                           | Self-hosting docs already call this out.                                                                                                                | Add clearer troubleshooting for default resource conflicts.                                                                                                  |
| Runtime model access fails after setup                                                 | Setup may complete but the app cannot run Nanite work.                                                                                                                                   | Setup now creates or configures the deployment AI Gateway and verifies the Worker `AI` binding, but it does not run an AI smoke that spends credits.    | Add final readiness smoke: one short non-tool model call and one tool-capable Nanite run after explicit approval.                                            |

## Review-derived risks

Four focused review passes found additional edge cases that should feed the next cleanup PR.

### Cloudflare authority and setup ownership

- Generated GitHub credentials currently pass through Cloudflare MCP `execute()` as plaintext tool
  arguments before they become Worker Secrets. If Cloudflare MCP logs, stores, retries, or exposes
  tool inputs, the setup path may temporarily place the GitHub private key, client secret, webhook
  secret, and auth-cookie secret outside Worker Secrets. V1 needs either a safer first-party secret
  write path or an explicit threat-model decision that this MCP transfer is acceptable.
- Cloudflare MCP authority is removed only after generated runtime config is readable. Failed secret
  writes, metadata-save failures, abandoned setup, expired setup claims, and
  `secrets-propagation-stalled` can leave the setup Agent holding Cloudflare MCP authority longer
  than the plan claims. The Agent should disconnect on terminal failure and offer an explicit
  reconnect/reset path.
- A ready Cloudflare MCP connection is reused without rechecking that it has the setup write scope.
  Ownership proof can pass with read permissions, then the flow creates a GitHub App and fails only
  when Worker secret writes need `workers_scripts:write`. Add a preflight write-scope check before
  GitHub App manifest creation.
- `cloudflareWorkerSecretWriteFailed` is currently modeled as an internal server failure, but
  missing Worker secret write permission is a user-fixable setup issue. The setup callback should
  route it back to `/setup` with reconnect/permission repair copy instead of surfacing as a 500.
- Deploy to Cloudflare lets users customize Worker names. The prompt-free path should open setup
  from `workers.dev`, where the setup Agent can infer the script name from the hostname.
- The custom-domain ownership check currently covers Workers Custom Domains, not legacy Workers
  Routes. V1 should either document "Custom Domains only" or add Workers Routes ownership
  verification.
- The deploy-button smoke list needs to explicitly verify top-level KV/R2 provisioning when the
  public template omits account-specific resource ids/names.

### GitHub App and repository verification

- Setup verification now requires at least one visible repository and proves the generated app can
  mint an installation token before marking repository setup complete.
- Manifest conversion now rejects returned app config that lacks Nanites' minimum permissions/events
  before writing secrets or marking the GitHub App complete.
- Claimed GitHub setup verification is bound to an install nonce stored in Agent state. Manual
  fallback remains available once a runtime config already exists.
- Later `setup_action=update` callbacks after generated setup route through the same setup
  verification path without requiring the original setup claim.
- App uninstall, suspension, app deletion, repository-removal, and new-permission-accepted webhooks
  now move the deployment installation back to repository repair. `github_app_authorization`
  revocation remains session/user-token repair rather than installation repair because the webhook
  does not identify a deployment installation.
- Manual app reuse can appear configured without proving that callback URLs, setup URL, webhook URL,
  permissions, or events match the current Worker. Keep manual reuse advanced, and add a validation
  checklist before treating it as healthy.
- Org GitHub App creation permission failures happen on GitHub before Nanites receives a callback.
  The UI should say this up front and keep setup retryable if the user returns without a callback.

### State recovery and partial setup

- The deployment installation id is now persisted in deployment GitHub App metadata. If setup Agent
  state is reset while D1 metadata and Worker secrets survive, refresh restores the repository step
  to complete and leaves the upstream star/launch gates to be re-verified from current browser
  state.
- Missing the current D1 baseline now fails before GitHub App manifest creation because setup
  preflights the metadata table.
- Secret write happens before metadata save. If old metadata already exists and new secrets are
  written but metadata save fails, runtime config can combine the old app id/client id with new
  secrets. Avoid mixing generations by storing a generation id, writing metadata before secrets when
  possible, or refusing setup retry when old metadata exists without an explicit reset.
- Stale repository state is cleared whenever the GitHub App generation changes.
- Orphan GitHub App cleanup is actionable when manifest conversion succeeds and later setup work
  fails; setup preserves the orphan app URL and cleanup instructions.
- `/setup/github/verify` passes current-runtime config readability into Agent refresh so stale
  Agent env does not block setup after generated secrets are readable.
- Webhook ping now requires configured deployment GitHub App secrets and signature verification.
  Smoke tests should still include a signed webhook delivery, not only a ping status check.
- Secret deletion/rotation needs an operator recovery model. Missing generated secrets now look like
  propagation failure, but coordinated rotation touches auth cookies, GitHub client secret, webhook
  secret, private key, GitHub App settings, and existing sessions.
- Manual env fallback has been deleted. D1 deployment metadata plus generated Worker secrets are the
  single runtime GitHub App config source.

### Public setup surface

- The setup Agent is intentionally available before GitHub sign-in, but mutable Cloudflare setup now
  requires a browser-local setup owner claim. A second visitor can still observe public setup state,
  but `connectCloudflare()` returns a non-mutating owner-required result instead of moving setup into
  connecting or failed states. The owner claim can be reset by the claiming browser and otherwise
  expires after one hour.
- Setup-claim expiry is bound to the GitHub manifest attempt through the stored claim hash and
  expiry. Expired in-flight manifest state is cleared during refresh instead of being revived by a
  later setup claim.

## Existing GitHub App on the org

This is the most important customer-facing edge case.

If the user already has a Nanites-looking GitHub App in the org and deploys a fresh Worker, V1 should
create a new app. Reusing the old app is not zero-config because the new Worker needs secrets that
GitHub generated for the old app:

- GitHub App private key
- GitHub App client secret
- GitHub App webhook secret
- GitHub App id/client id/slug metadata

The private key and secrets are sensitive credentials. The new Worker cannot recover them from
GitHub just because the same user owns the org. The old app also probably points its OAuth callback,
setup URL, and webhook URL at the old Worker origin.

So the V1 UX should say:

1. Create the new GitHub App for this Worker.
2. Install it on the repos this Worker should manage.
3. If an older Nanites app is installed on the same repos and should no longer run, uninstall it
   from GitHub.

An "import existing app" feature can exist later, but it is an advanced/manual path. It should ask
the operator to provide or regenerate credentials and update app URLs. It should not be part of the
primary click-through setup story.

## Remaining release-hardening list

Before we call the zero-config path release-ready, tighten these items:

1. Add a Cloudflare MCP secret-transfer threat-model decision or replace plaintext `execute()`
   secret writes with a safer first-party secret-write path.
2. Add UI copy for expired setup claim, wrong Cloudflare account, insufficient Cloudflare MCP
   permissions, setup from a different browser profile, old GitHub Apps, duplicate installations,
   and post-setup repository repair.
3. Add broader runtime readiness checks when GitHub runtime calls fail because an installation was
   removed, suspended, or lost permissions outside webhook-visible paths.
4. Document `github_app_authorization.revoked` as a session/user-token repair signal and make the
   browser sign-in recovery copy explicit.
5. Smoke a redeploy after successful setup and confirm D1 metadata plus Worker secrets survive.
6. Smoke a fresh Deploy to Cloudflare run and measure generated secret propagation time.
7. Smoke deploy-button provisioning for unnamed KV/R2 resources, Browser Run, and Worker Loader.
8. Add a final readiness smoke after launch: GitHub installation token works, at least one repo is
   visible, a signed webhook verifies, and the default model can complete a small
   function-calling-compatible turn.

## Current V1 position

The flow is conceptually sound for zero-copy setup:

1. Cloudflare deploy creates the customer-owned Worker and resources.
2. Cloudflare MCP OAuth proves the setup browser controls the Cloudflare account that owns the
   Worker.
3. GitHub App Manifest creates the customer-owned GitHub App and returns generated credentials.
4. Nanites writes those credentials into customer-owned Worker secrets through Cloudflare MCP.
5. Nanites stores non-secret app metadata in D1.
6. GitHub setup URL plus GitHub OAuth verifies the actual installed app installation.

The honest limitation is reuse. A fresh Worker cannot safely adopt an old GitHub App without old
app credentials and URL changes. For V1, the simpler and safer story is: each deployed Nanites
Worker gets its own generated GitHub App, and users remove stale apps from overlapping repositories
when they retire an older Worker.
