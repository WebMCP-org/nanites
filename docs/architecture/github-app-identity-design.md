# GitHub App Identity: One App Per Deployment

**Date:** 2026-06-13
**Status:** Current implementation direction.

Nanites hard-requires exactly one active GitHub App per deployment. GitHub is
the source of truth for installations and repositories; D1 stores projections
observed from GitHub plus the single deployment app's non-secret metadata.

## Decision

One deployment has one active `github_apps` row. That app mints browser OAuth
tokens, verifies webhooks, mints installation tokens, owns setup links, and
names Durable Object managers.

The manager key remains:

```text
app:<githubAppId>:installation:<githubInstallationId>
```

The app id stays in D1 facts and manager identity because it is an observed
fact, not public page state. Browser page state names only the selected
installation:

```text
/nanites?installationId=122769206
/observability?installationId=122769206&range=7d
```

## Invariants

- `resolveDeploymentGitHubApp` / `requireDeploymentGitHubApp` are the only
  runtime deployment-app resolvers.
- More than one active `github_apps` row is a deployment configuration error.
- Registering the same app refreshes its metadata and binding names.
- Registering a different app fails closed.
- Browser GitHub user-token cookies are bound to the deployment app by app id
  and client id.
- Page pickers change the URL scope. They do not mutate the session default.
- `/api/auth/installations/active` means "set default installation" for
  compatibility with older entry points, not page navigation.

## Setup

The setup wizard creates or restores one deployment app. If a deployment app
row already exists, setup must not start another GitHub App manifest flow. A
stalled app means generated Worker secrets are not readable yet or were lost;
creating another app is not a repair path because it produces orphaned GitHub
Apps and secret blocks.

Local restore follows the same invariant: `/setup/local/restore` restores
exactly one app row from `GITHUB_APP_<id>_*` environment blocks and rejects
multiple blocks with cleanup instructions.

## Projection

D1 mirrors what the deployment app can see through GitHub APIs:

- visible installations from `/user/installations`
- repository snapshots from installation repository listings
- facts and audit rows emitted by runtime work

Projection rows are cache data. If they disagree with GitHub, refresh from
GitHub and update D1; do not use D1 as visibility proof.

## Migration And Reset

The one-app database guard is a partial unique index on active GitHub Apps.
This migration intentionally does not choose a winner if an environment already
has more than one active app row. This repository is still pre-production, and
encoding an automatic cleanup policy would preserve a state shape we do not
want.

If an environment has multiple active `github_apps` rows, reset that environment
before applying this line of development:

1. Back up anything needed for investigation.
2. Wipe local `.wrangler` state or the remote pre-prod D1 database.
3. Re-run migrations.
4. Restore/register exactly one GitHub App.
5. Re-authenticate through the deployment app's real GitHub OAuth flow.

## Deferred

These are not part of the one-app deployment model:

- app-rotation flows
- bring-your-own-app coexistence
- cross-app visible-installation unions
- manager-name migration away from `app:<appId>:installation:<installationId>`
