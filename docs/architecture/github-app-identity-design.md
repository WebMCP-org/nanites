# GitHub App Identity: One App Per Deployment

**Date:** 2026-06-13
**Status:** Current implementation direction.

Nanites hard-requires exactly one active GitHub App per deployment. GitHub is
the source of truth for installations and repositories; D1 stores projections
observed from GitHub. Worker env stores the single deployment app identity and
credentials.

## Decision

One deployment has one configured GitHub App in Worker vars/secrets. That app
mints browser OAuth tokens, verifies webhooks, and mints installation tokens.
The deployment, not a manager name, selects that app.

The manager key is:

```text
installation:<githubInstallationId>
```

The app id stays in D1 facts, auth cookies, MCP auth props, and GitHub
messenger credentials because it is a real GitHub/security fact. It is not a
runtime routing dimension.

## Invariants

- `readDeploymentGitHubAppMetadata` and `requireDeploymentGitHubApp` are the
  only runtime deployment-app readers.
- The deployment app is configured by fixed Worker vars/secrets:
  `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`,
  `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_SECRET`, and
  `GITHUB_APP_WEBHOOK_SECRET`.
- Browser GitHub user-token cookies are bound to the deployment app by app id
  and client id.
- Browser sessions identify the signed-in human, not an installation choice.
- Runtime manager names derive from the deployment installation.

## Projection

D1 mirrors what the deployment app can see through GitHub APIs:

- the deployment installation verified through `/user/installations`
- repository snapshots from installation repository listings
- facts and audit rows emitted by runtime work

Projection rows are cache data. If they disagree with GitHub, refresh from
GitHub and update D1; do not use D1 as visibility proof.

## Reset

This repository is pre-production. If local GitHub App configuration drifts,
wipe local `.wrangler` state or the remote pre-prod D1 database, set the fixed
Worker vars/secrets from the provisioner, and re-authenticate through the
deployment app's real GitHub OAuth flow.

## Deferred

These are not part of the one-app deployment model:

- app-rotation flows
- bring-your-own-app coexistence
- cross-app visible-installation unions
