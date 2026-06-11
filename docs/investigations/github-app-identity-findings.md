# GitHub App identity mismatch — findings and remediation runbook

**Date:** 2026-06-11
**Status:** Root cause CONFIRMED. The manual restore runbook below is
**superseded**: Alex chose a clean-slate path — rebuild the data model as
multi-app native, wipe prod entirely, and re-run setup fresh. See
[../architecture/github-app-identity-design.md](../architecture/github-app-identity-design.md)
(v2). The runbook is kept for reference in case a fast restore is ever needed
before the refactor lands.
**Predecessor:** [github-app-identity-handoff.md](github-app-identity-handoff.md)

## Root cause (confirmed)

Production (`nanites-app-production`, app.sigvelo.com) authenticates as GitHub App
**"Nanites cwkawta7yc"** (slug `nanites-cwkawta7yc`, OAuth client_id
`Iv23liVNJyQNgvanmgMI`) — a throwaway app created by the setup manifest flow
during self-host testing on 2026-06-10 evening. Installation **122769206**
belongs to the original app **Sigvelo** (app_id `3280686`, client_id
`Iv23livMdvwnhX6rzSeX`, owned by **WebMCP-org**). GitHub correctly returns 404
when the deployment's app JWT tries to mint a token for an installation it
does not own.

### Evidence

1. **Live OAuth probe** — `GET https://app.sigvelo.com/auth/github/login`
   302-redirects to `github.com/login/oauth/authorize?client_id=Iv23liVNJyQNgvanmgMI`.
   That client_id resolves (via the GitHub authorize page) to app
   **"Nanites cwkawta7yc"**. The name matches the manifest generator
   `Nanites ${nameSuffix}` at `src/backend/agents/NanitesSetupAgent.ts:390`,
   and the app is created `public: false` — unambiguously a setup-flow product.
2. **GitHub org truth** — `GET /orgs/WebMCP-org/installations` (admin:org token)
   shows installation `122769206` is **alive, not suspended**, repository
   selection `all`, and belongs to `app_slug: sigvelo`, `app_id: 3280686`.
   `nanites-cwkawta7yc` has **no installation on WebMCP-org**.
3. **App registry** — `GET /apps/sigvelo` confirms the Sigvelo app still
   exists, owned by **WebMCP-org** (so Alex can mint fresh credentials for it;
   the old private-key file is not needed).
4. **Timing** — setup-flow churn commits (`34de862`…`41804e3`, including the
   secret-write and PKCS#8 fixes) all land 2026-06-10 18:30–22:00 PT; the
   breakage was observed immediately after.
5. **Enabler** — `wrangler.production.jsonc` sets `NANITES_SHOW_SETUP: "true"`,
   so the production deployment exposes the setup flow that replaced the app
   identity. `saveDeploymentGitHubAppConfig()`
   (`src/backend/github/app-config.ts:147-189`) is a blind UPSERT with no
   guard against orphaning live installations.

Other apps installed on WebMCP-org from earlier experiments (not implicated,
but candidates for cleanup): `webmcp-org` (2934543, installation 112090357),
`char3-webmcp-org` (3161567, installation 118335607).

### Webhook health

Worker logs (7-day window) show only ~4 deliveries to `/api/github/webhook`,
all HTTP 200, zero signature failures. Interpretation: the Sigvelo app's
deliveries either stopped or its webhook secret happens to still match — more
likely, GitHub's deliveries for the org have been minimal this week. Once
remediated, check the Sigvelo app's **Advanced → Recent Deliveries** page for
the true delivery/failure history (only visible to the app owner).

## Remediation: restore the Sigvelo app (recommended)

Option (b) from the handoff (commit to the test app) is strictly worse: the
test app has a garbage name, is installed nowhere, and every D1 row, MCP
grant, and manager DO references Sigvelo's installation IDs. Restoring
Sigvelo makes all existing references consistent again.

All steps below are Alex-gated (GitHub app admin, worker secret writes, prod
D1 writes). Exact sequence:

### 1. GitHub app settings (github.com → WebMCP-org → Settings → Developer settings → GitHub Apps → Sigvelo)

- **Generate a new private key** (downloads a PKCS#1 `.pem`).
- **Generate a new client secret.**
- **Set a new webhook secret**; confirm webhook URL is
  `https://app.sigvelo.com/api/github/webhook` and Active.
- Confirm callback URL `https://app.sigvelo.com/auth/github/callback` and
  setup URL `https://app.sigvelo.com/setup/github/installed`.
- **Permission/event deltas vs current code minima**
  (`NanitesSetupAgent.ts:63-77`): Sigvelo lacks the `starring` permission and
  the `workflow_run` event. Add both (org must accept the permission-change
  prompt on the installation). Starring is now optional for launch
  (`c990256`) but the verification check may still compare; workflow_run
  matters for CI-triggered nanites.

### 2. Convert the private key to PKCS#8

The runtime expects PKCS#8 (the manifest flow converts it; see `41804e3`):

```sh
openssl pkcs8 -topk8 -nocrypt -in sigvelo.private-key.pem -out sigvelo.pkcs8.pem
```

### 3. Worker secrets (Alex runs)

```sh
wrangler secret put GITHUB_APP_PRIVATE_KEY --config wrangler.production.jsonc < sigvelo.pkcs8.pem
wrangler secret put GITHUB_CLIENT_SECRET   --config wrangler.production.jsonc
wrangler secret put GITHUB_WEBHOOK_SECRET  --config wrangler.production.jsonc
```

### 4. D1 config row (Alex runs against prod D1 `f5bbbd9d-2035-4ffe-94ff-c1df40116d37`)

```sql
UPDATE deployment_github_app_config SET
  app_id = 3280686,
  slug = 'sigvelo',
  html_url = 'https://github.com/apps/sigvelo',
  owner_login = 'WebMCP-org',
  owner_type = 'Organization',
  client_id = 'Iv23livMdvwnhX6rzSeX',
  selected_github_installation_id = 122769206,
  permissions_json = '<JSON of the app permissions after step 1 edits>',
  events_json = '<JSON of the app events after step 1 edits>',
  updated_at = unixepoch()
WHERE id = 'current';
```

Before running, `SELECT * FROM deployment_github_app_config WHERE id='current'`
and save the output (it documents the test app's identity for the audit trail).

### 5. Verify

- `sigvelo_whoami` then `sigvelo_create_nanite` against `WebMCP-org/nanites`
  — the previously failing token mint should now succeed.
- Browser login at app.sigvelo.com (now goes through the Sigvelo OAuth client).
- Redeliver a recent webhook from the Sigvelo app's Advanced page → expect 200.
- Then run the pending repro task: huge-diff nanite + long-poll; watchdog
  should terminalize with a persisted error within ~6 minutes.

### 6. Cleanup

- Set `NANITES_SHOW_SETUP: "false"` in `wrangler.production.jsonc` and deploy
  (prevents recurrence until setup-flow guards exist — see design doc).
- Delete the `nanites-cwkawta7yc` GitHub App (owner account: whichever account
  Alex chose during the manifest redirect — check
  github.com/settings/apps and WebMCP-org org app settings).
- Audit D1 for rows created during setup testing: `accounts`,
  `account_installations`, `account_repositories`, `account_people` rows whose
  `github_installation_id` is NOT in the Sigvelo app's installation list
  (`GET /app/installations` with restored credentials). Quantify before
  deleting.
- Optionally uninstall/delete the stale `webmcp-org` and `char3-webmcp-org`
  apps if they are dead experiments.
- Investigate separately why manager DO `installation:122769206` is empty
  (old nanites may have been reset during testing — restoring the app will
  not bring nanite state back).

## Open questions for Alex

1. Which account owns `nanites-cwkawta7yc` (personal vs org)? Needed only for
   deletion.
2. Do any nanites/state need recovering from before 2026-06-10, or is the
   empty manager DO acceptable as a fresh start?

## Design follow-up

The data-model and guard work that prevents this class of failure is specced
in [../architecture/github-app-identity-design.md](../architecture/github-app-identity-design.md).
