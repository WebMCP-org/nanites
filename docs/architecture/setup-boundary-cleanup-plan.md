# Setup Boundary Cleanup Plan

## Decision

Partially agree with moving setup work to Agent callables.

The clean boundary is not "remove Hono from setup." The clean boundary is:

- `NanitesSetupAgent` owns setup state, Cloudflare MCP, GitHub App manifest completion, Worker
  secret writes, and setup state transitions.
- `src/backend/github/index.ts` owns GitHub API calls through Octokit and GitHub-owned response
  shapes.
- Hono remains for third-party redirects, current-request `env` probes, GitHub browser-auth cookies,
  and responses that must set or clear HttpOnly cookies.

This matches the existing zero-config setup direction: React renders `useAgent()` state and uses
typed Agent `stub` methods for browser-initiated setup work, while same-origin HTTP remains only
where the browser/provider/cookie boundary requires it.

## Current Boundary Inventory

| Surface                            | Current owner                           | Target owner                                 | Reason                                                                                                                                                       |
| ---------------------------------- | --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/setup` state stream              | `NanitesSetupAgent` via `useAgent()`    | Keep Agent                                   | Durable setup state already has one owner.                                                                                                                   |
| Connect Cloudflare                 | `setupAgent.stub.connectCloudflare()`   | Keep Agent callable                          | Browser-initiated setup action with Agent-owned MCP OAuth state.                                                                                             |
| Start GitHub manifest form         | `setupAgent.stub.startGitHubManifest()` | Keep Agent callable                          | Browser-initiated setup action guarded by the setup claim bound to the Agent connection.                                                                     |
| GitHub manifest conversion         | `NanitesSetupAgent` raw `fetch`         | GitHub module with Octokit                   | GitHub API boundary, should use Octokit response types and request error handling.                                                                           |
| GitHub App secret writes           | `NanitesSetupAgent`                     | Keep Agent                                   | Cloudflare setup authority and state transition belong to setup Agent.                                                                                       |
| `/setup/github/manifest/callback`  | Hono route delegates to Agent           | Keep Hono route                              | GitHub redirects to HTTP; route reads setup claim cookie and returns redirect.                                                                               |
| `/setup/github/installed`          | Hono route                              | Keep Hono route                              | GitHub setup URL redirects to HTTP; route must bounce through GitHub OAuth login.                                                                            |
| `/setup/github/verify`             | Hono route plus Agent state call        | Keep Hono route, keep Agent state transition | Route reads GitHub auth cookies, may refresh/set session cookies, verifies spoofable `installation_id`, then records setup state in Agent.                   |
| `/api/setup/status`                | Hono route calls Agent refresh          | Keep narrow Hono route                       | It reads the current Worker request `env`; this is needed while generated secrets propagate and the long-lived Durable Object may still have older bindings. |
| Upstream star GET/PUT              | Hono route plus Agent state call        | Keep Hono route for now                      | It requires GitHub browser-auth cookies, may refresh token cookies, and clears the HttpOnly setup claim cookie on success.                                   |
| GitHub user install/star API calls | Raw GitHub helper `fetch`               | GitHub module with Octokit                   | GitHub API boundary, no reason to carry hand-rolled request helpers.                                                                                         |

## Implementation Plan

### 1. Fix the Existing Setup-State Guardrail

`vp test tests/backend/setup-routes.test.ts` originally exposed a setup-state mismatch around
manual GitHub App fallback. That fallback has since been deleted because Nanites is pre-production.
Generated deployment metadata plus Worker secrets are the only GitHub App config source.

Resolve this before changing API plumbing:

- Require the setup claim for GitHub App install verification.
- Keep fresh zero-config setup strict: generated GitHub App creation requires Cloudflare ownership
  proof and deployment metadata.

### 2. Move GitHub Manifest Conversion to the GitHub Owner Module

Add a GitHub-owned function in `src/backend/github/index.ts`:

- Create an unauthenticated/setup Octokit client using the same base URL, API version, timeout, and
  user-agent conventions as the existing GitHub clients.
- Use `octokit.rest.apps.createFromManifest({ code })`.
- Type the returned app with
  `RestEndpointMethodTypes["apps"]["createFromManifest"]["response"]["data"]`.
- Convert `RequestError` into `AppError("githubAppManifestConversionFailed")` with
  `githubResponseStatus`.
- Run through `observeGitHubOperation({ operation: "app.manifest.convert" }, ...)`.

Then update `NanitesSetupAgent.completeGitHubManifestFromCallback(...)` to call that GitHub module
function and delete:

- `GITHUB_API_BASE_URL`
- `GITHUB_API_VERSION`
- `githubManifestConversionSchema`
- the local raw `exchangeGitHubManifestCode(...)`

The setup Agent should still write Worker secrets, persist deployment GitHub App metadata, schedule
secret propagation checks, and update wizard state.

### 3. Replace Raw GitHub User Fetch Helpers with Octokit

In `src/backend/github/index.ts`, delete the generic raw helpers:

- `fetchGitHubUserApiJson(...)`
- `fetchGitHubUserApi(...)`

Use `createGitHubUserOctokit(accessToken)` for all user-authenticated GitHub calls:

- `fetchGitHubViewer(...)` already does this; keep it.
- `listVisibleInstallations(...)` should use
  `octokit.paginate(octokit.rest.apps.listInstallationsForAuthenticatedUser, { per_page },
(response) => response.data.installations)`.
- `listInstallationRepositories(...)` should use
  `octokit.paginate(octokit.rest.apps.listInstallationReposForAuthenticatedUser,
{ installation_id, per_page }, (response) => response.data.repositories)`.
- `checkAuthenticatedUserStarredNanites(...)` should use
  `octokit.rest.activity.checkRepoIsStarredByAuthenticatedUser({ owner, repo })`; return `false`
  only for `RequestError.status === 404`.
- `starNanitesRepositoryForAuthenticatedUser(...)` should use
  `octokit.rest.activity.starRepoForAuthenticatedUser({ owner, repo })`.

Keep the public return shapes unchanged for callers. The change is transport ownership, not product
contract churn.

### 4. Keep Hono, But Narrow It to HTTP-Only Responsibilities

Do not add new setup Hono routes for browser-initiated setup actions.

Keep `src/backend/api/routes/setup.ts` focused on:

- parsing provider callback query params
- reading and clearing setup claim cookies
- reading and refreshing GitHub browser-auth cookies through `requireGitHubUserToken(...)`
- recording the verified deployment installation through setup-owned state
- redirecting the browser to GitHub or back to `/setup`
- passing verified state transitions to `NanitesSetupAgent`

Do not move GitHub browser auth tokens into the setup Agent connection state. The setup Agent route is
intentionally available before normal app auth exists; making it also own authenticated GitHub user
cookies would blur the bootstrap and browser-auth boundaries.

### 5. Keep the Status Route Until Secret Propagation Has a Better Primitive

`GET /api/setup/status` should stay, but document it in code as a current-request `env` probe.

Reason: after the setup Agent writes generated Worker secrets, the Durable Object may still be using
older `env` bindings. A fresh Worker request can observe whether generated secrets are readable and
pass only the boolean readability signal back into Agent state.

Do not replace the root route loader's setup check with an Agent callable unless there is a first
class loader-safe Agent client and a way to preserve the current-request `env` behavior.

### 6. Keep Upstream Star as HTTP for Now

The upstream star button is browser-initiated, but it is not a good Agent callable candidate yet.

It currently needs all of these HTTP properties:

- read sealed GitHub user token cookies
- refresh the GitHub token and append `Set-Cookie` when needed
- clear invalid browser-auth cookies on auth failure
- clear the HttpOnly setup claim cookie after success

An Agent callable cannot currently express those response-cookie effects cleanly. Keep the Hono route
and make its GitHub API calls Octokit-backed through the GitHub owner module.

### 7. Update Tests in Place

Keep tests black-box at the route/Agent boundary:

- Update GitHub API intercepts to tolerate Octokit headers and methods, but keep matching actual
  GitHub URLs.
- Keep fixtures GitHub-shaped.
- Do not add Vitest module mocks for app-local GitHub or setup modules.
- Preserve tests that prove browser actions use Agent callables: there should still be no
  `/api/setup/github/manifest/start` route.
- Add or update a focused test for the manifest conversion function's `RequestError` mapping if the
  route test no longer covers it clearly.

Run after each slice:

```sh
vp test tests/backend/setup-routes.test.ts
vp check
```

Run full validation before shipping:

```sh
vp test
```

## Non-Goals

- Do not replace Hono redirects with Agent RPC.
- Do not pass GitHub user access tokens through React or Agent callable inputs.
- Do not make the setup Agent a second browser-auth owner.
- Do not add DTOs or `Pick` types around GitHub installation, repository, or manifest conversion
  responses.
- Do not rewrite the setup UI flow; keep the current wizard and only change the backend boundaries.

## Expected End State

The setup flow has three boring owners:

- Agent callables for setup-owned interactive actions.
- Hono for HTTP provider, cookie, redirect, and current-request `env` boundaries.
- Octokit for GitHub API calls and GitHub-owned response shapes.

That should remove raw GitHub request code and reduce setup route responsibilities without hiding
real HTTP boundaries behind Agent RPC.
