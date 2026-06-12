# Handoff: GitHub App identity mismatch + multi-app/installation data model

**Date:** 2026-06-11
**Author:** Claude (session with Alex), for the next investigating agent
**Status:** Open — root cause strongly suspected but unconfirmed; design work needed

## TL;DR

Production can no longer mint GitHub installation tokens for installation
`122769206` (GitHub returns 404 on `POST /app/installations/122769206/access_tokens`),
which blocks all nanite work for that installation. The leading hypothesis: the
self-host setup flow was exercised against production and **replaced the
deployment's GitHub App identity** (the singleton `deployment_github_app_config`
row and/or the `GITHUB_APP_*` worker secrets) with a _different_ app, while the
D1 account/installation rows and the live installations still belong to the
_original_ app. Underneath the immediate breakage is a data-model gap: the
system was built assuming **one GitHub App, SaaS-style**, and the self-host
pivot makes app identity per-deployment — and potentially plural.

Your job: (1) confirm the root cause and produce a remediation plan for Alex's
production, (2) inventory every single-app assumption in the code/data layer,
(3) propose the app/installation/repo selection story (data model + UI) so
users can't end up in this state silently.

## Immediate symptom and how to reproduce

Via the Sigvelo MCP (Claude Code plugin `sigvelo`, authenticated as
`MiguelsPizza`, githubUserId 94631653):

1. `sigvelo_whoami` → binds to `githubInstallationId: 122769206`, scopes
   `nanites:read`/`nanites:write`. Works.
2. `sigvelo_create_nanite` with any manifest scoped to a repository (e.g.
   `WebMCP-org/nanites`) → fails with:

   ```
   HttpError: Not Found - https://docs.github.com/rest/reference/apps#create-an-installation-access-token-for-an-app
   ```

   The failure path is `registerNanite` → `assertRepositoriesBelongToInstallation`
   → `listReposAccessibleToInstallation` (src/backend/github/index.ts) → octokit
   app auth → installation token mint → **404 from GitHub**.

A 404 on that endpoint means the app JWT authenticated fine but the
installation ID **does not belong to that app** (or was uninstalled). User-level
OAuth (the MCP session, browser auth) still works, which is consistent: only
app-credential ↔ installation pairing is broken.

Alex also reports user-visible weirdness pointing at the same root: "the repos,
the organizations, and the accounts my GitHub app was installed on kind of got
messed up when I did the self-hosting thing."

## Evidence gathered so far

- Production worker `nanites-app-production` (account `ad0d45931959d888de55865d02260ef8`,
  D1 `f5bbbd9d-2035-4ffe-94ff-c1df40116d37`) has secrets: `AUTH_COOKIE_SECRET`,
  `CLOUDFLARE_ACCOUNT_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET`,
  `GITHUB_WEBHOOK_SECRET`, `SENTRY_DSN`.
- `deployment_github_app_config` (src/backend/db/schema.ts:234) is a
  **singleton** (`id = "current"`) storing appId, slug, ownerLogin,
  `selectedGithubInstallationId`, clientId, and _bindings_ that point at the
  worker secrets above. The setup flow (NanitesSetupAgent +
  src/backend/api/routes/setup.ts) writes both the row and the secrets — see
  recent commits `04394a2` (worker secret write content type), `f5df47f`
  (surface which installation-verification check fails), `41804e3`
  (PKCS#1→PKCS#8 key conversion). This churn window is when things likely
  diverged.
- Historical logs show installation `122769206` was actively used by nanite
  managers (`/agents/sigvelo-nanite-manager/installation:122769206/...`) as
  recently as early June.
- The manager DO for `installation:122769206` is currently **empty** (no
  nanites, no runs) — consistent with Alex's old nanites living under a
  different manager/installation, or state having been reset during testing.
- Webhook signature verification uses `GITHUB_WEBHOOK_SECRET`; if the app
  identity changed, webhooks from the _old_ app would now fail verification
  too (worth checking the funnel — `auth_funnel_facts` / webhook logs).

## Leading hypothesis (confirm or kill)

Setup-flow testing registered a **new GitHub App** (via the manifest flow) and
saved it as the deployment's `"current"` app config + secrets. Installation
`122769206` belongs to the **old** app. Every code path that authenticates
as-the-app now uses new-app credentials against old-app installation IDs that
are still referenced by: D1 rows (`accounts`, `account_installations`,
`account_repositories`, `account_people`), MCP session grants, manager DO
names (`installation:<id>`), and OAuth client expectations.

## Investigation tasks (suggested order)

1. **Identify the current app.** Read `deployment_github_app_config` row
   `"current"` from production D1 (appId, slug, ownerLogin, updatedAt). Compare
   `updatedAt` against the setup-flow testing window. Note: direct prod D1
   queries and prod deploys require Alex's explicit approval in-session — ask,
   or have him run the query.
2. **Enumerate the truth from GitHub.** Using the worker's current credentials
   (JWT), call `GET /app` and `GET /app/installations`. Does the app match the
   D1 row? Is `122769206` in the list? Which installations ARE?
3. **Map the stale references.** Query `account_installations` /
   `account_repositories` for installation IDs and check each against the
   current app's installation list. Quantify the divergence.
4. **Check webhook health** since the app switch (signature failures in logs /
   `auth_funnel_facts`).
5. **Decide remediation for Alex's prod** — likely one of:
   - (a) restore the original app's credentials (if the old app still exists
     and Alex controls it), or
   - (b) commit to the new app: install it on the right orgs/repos, then
     reconcile/purge stale D1 rows and stale manager DOs, and re-bind MCP
     grants. Write the exact steps; don't execute destructive ones without
     Alex.
6. **Inventory single-app assumptions** for the design work. Known suspects:
   - `deployment_github_app_config` singleton `"current"` row (one app per
     deployment, silently replaceable — no history, no guard against orphaning
     installations).
   - D1 fact tables key on `github_installation_id` with **no app_id column**
     — installation IDs are only unique _per app_.
   - `getAgentByName(env.SigveloNaniteManager, "installation:<id>")` — DO
     identity also lacks app scoping.
   - Webhook ingress assumes one webhook secret (one app).
   - Browser/MCP auth assumes one OAuth client (`GITHUB_CLIENT_SECRET`).
   - `/api/auth/installations/visible` and the session's
     `requireActiveGithubInstallationId` (src/backend/auth/session.ts) — how do
     they behave when the user has installations of _multiple_ apps?

## Design brief (Alex's framing, lightly structured)

The original model was SaaS: one GitHub App, many users, maybe some
self-hosters reusing the main app. The real model after the self-host pivot:

- **One deployment ↔ one GitHub App** is probably the right _invariant_ per
  instance (each self-hoster registers their own app via the setup manifest
  flow), but the app and the "client" (deployment owner) can differ, a user
  can be associated with **multiple apps** (e.g. Alex: the SaaS app + his
  self-host test app), and orgs can have multiple apps installed.
- The data layer must therefore record **which app** every installation/repo/
  account row belongs to (add `github_app_id` columns or equivalent), and the
  runtime must **verify** app↔installation pairing instead of 404ing deep in a
  token mint — surface "this installation belongs to app X, but this
  deployment is app Y" as a first-class, user-visible state with a re-link
  flow.
- Changing the deployment's app via setup must not silently orphan data:
  either block when live installations reference the old app, or run an
  explicit migration/cleanup step.
- UI story: users need to see and choose app → installation (org/account) →
  repositories explicitly, with mismatches impossible or loudly flagged —
  "make sure the UI allows people to not fuck things up."

Deliverable for this part: a short design doc (data-model changes, setup-flow
guards, UI selection flow, migration plan for existing rows) — not an
implementation.

## Constraints and context you should keep

- **Self-host-first**: Deploy-to-Cloudflare button → setup flow provisions
  everything; optional features are runtime-configurable (see
  `/api/client-config`, commit `8bd0164`). Root `wrangler.jsonc` is the
  generic template; Alex's prod is `wrangler.production.jsonc`. Deploys are
  manual `vp run deploy:prod` (Workers Builds is NOT connected).
- Production now runs current main (deployed by Alex 2026-06-11 ~21:10 UTC,
  plus the runtime-Sentry deploy after `8bd0164`), including the DO-rewrite
  watchdogs and failure persistence (`audit.run.failed`,
  `audit.run.chat_error`, run facts with real failure reasons) — use those
  tables; they're the new observability spine.
- Useful tools: `sigvelo` MCP (whoami/create/debug), Cloudflare observability
  MCP (worker logs; use relative timeframes with reference
  `1970-01-01T00:00:00Z`), `wrangler` (read ops fine; secret writes/deploys/
  D1 prod queries need Alex), Sentry MCP (org `mcp-b-h2`, project
  `sigvelo-agent-backend` — backend events flowing as of today).
- Related pending repro task (blocked on this fix): create a nanite that
  ingests a huge diff and long-poll it — on the new code the watchdog should
  terminalize it with a real persisted error within ~6 minutes; that is the
  success criterion.
