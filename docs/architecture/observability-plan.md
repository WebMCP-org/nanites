# Nanites Observability Plan

Nanites observability should start as a product dashboard, not an analytics platform.

The first useful version should answer four customer questions:

- How much are Nanites costing?
- Which Nanites exist, who created them, and what are they allowed to touch?
- How often are Nanites running, and what outcomes are they producing?
- Which control-plane actions changed trust, authority, or spend?

Cloudflare operational logs, Sentry, and Cloudflare billing remain supporting tools. The product
dashboard should persist only the durable facts needed for cost allocation, run history, Nanite
provenance, and audit review.

## Reference Shape

The closest local reference is the ClickHouse/TanStack Router analytics prototype at:

```text
/Users/alexmnahas/contracting/zuplo/mcp-gateway-analytics
```

Borrow these ideas:

- customer question first, storage second
- URL-backed filters
- KPI strip plus compact charts
- event table with a selected-row detail sheet
- sanitized payload summaries instead of raw request bodies
- explicit "payload not retained" or "metadata only" states

Do not borrow these parts:

- ClickHouse
- HypeQuery
- OLAP rollup machinery
- generic APM framing
- a large cross-app analytics component framework

For Nanites, the dashboard question is not "what happened in the gateway?" It is:

```text
Are these durable maintainers producing trustworthy outcomes at an acceptable cost?
```

## Storage Decision

Keep the first version Cloudflare-native:

| Concern                 | First owner                  | Notes                                                                               |
| ----------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| Operational logs        | Cloudflare logs, Sentry      | Request/debug exhaust. Do not copy this stream into D1.                             |
| AI usage and cost facts | D1                           | Existing `ai_usage_facts`; request cost comes from the AI Gateway log when present. |
| Run summaries           | D1                           | Existing `nanite_run_facts`, written from manager and agent seams.                  |
| Nanite catalog          | D1 projection                | New narrow table. Manager state remains the runtime source of truth.                |
| Audit events            | D1                           | New append-only table for authority changes and spend-driving acts.                 |
| Large evidence          | R2 or current artifact store | Transcripts, raw webhook snapshots, generated source snapshots, debug bundles.      |

Do not add a Tail Worker, Analytics Engine, ClickHouse, or Logpush pipeline in the first pass. Those
can be added when D1 query volume or retention pressure becomes real.

## Library Alignment

Before implementation, align the fact writers with the libraries already in the runtime.

| Library or platform          | Product use                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| AI SDK `ai@6.0.196`          | Source for per-step and total model usage, finish reason, provider metadata, and telemetry metadata.  |
| `workers-ai-provider@3.1.14` | Source for Workers AI / AI Gateway model calls and AI SDK usage mapping.                              |
| Cloudflare AI Gateway        | Source for gateway log id, gateway metadata, estimated gateway cost, cached flag, duration, provider. |
| Cloudflare Agents SDK        | Source for runtime diagnostic events and Tail Worker-compatible operational streams.                  |
| Sentry                       | Trace/debug destination, not the product cost ledger.                                                 |
| GitHub / Octokit             | Source for human identity and GitHub-owned installation/repository shapes.                            |

Primary docs checked before this plan:

- [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [AI SDK event callbacks](https://ai-sdk.dev/docs/ai-sdk-core/event-listeners)
- [Cloudflare AI Gateway Worker bindings](https://developers.cloudflare.com/ai-gateway/integrations/worker-binding-methods/)
- [Cloudflare AI Gateway custom metadata](https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/)
- [Cloudflare Agents observability](https://developers.cloudflare.com/agents/runtime/operations/observability/)
- [Sentry Vercel AI integration](https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/integrations/vercelai/)

### AI SDK Usage Shape

Consume AI SDK usage instead of parsing provider-specific response bodies.

The recorder should accept AI SDK `LanguageModelUsage`:

- `inputTokens`
- `inputTokenDetails.noCacheTokens`
- `inputTokenDetails.cacheReadTokens`
- `inputTokenDetails.cacheWriteTokens`
- `outputTokens`
- `outputTokenDetails.textTokens`
- `outputTokenDetails.reasoningTokens`
- `totalTokens`
- `raw`

For streaming/multi-step calls, prefer the AI SDK final `totalUsage` for the D1 aggregate row. Keep
per-step usage available to logs or trace spans, but do not create one D1 row per step unless the UI
needs step-level cost later.

Use AI SDK telemetry metadata for correlation:

```text
functionId: "nanite.run.model"
metadata: {
  accountId,
  githubInstallationId,
  githubRepositoryId,
  repository,
  naniteId,
  runKey,
  actorGithubUserId,
  billingGithubUserId,
  requestId
}
```

For product Nanite model calls, set `recordInputs: false` and `recordOutputs: false`. Raw prompts
and model responses should only be captured in an explicit short-lived debugging mode.

The same fields should be added through the model-call path, not rebuilt inside each caller.

### Cloudflare AI Gateway Shape

Every Nanite model request should go through the configured AI Gateway path when available.

Use Gateway metadata for Cloudflare-side search, spend limits, and later reconciliation. Cloudflare
only saves five custom metadata entries, so the first set should be cost-oriented:

| Metadata key      | Value                                 |
| ----------------- | ------------------------------------- |
| `installation_id` | GitHub installation id.               |
| `nanite_id`       | Nanite id.                            |
| `run_key`         | Run key.                              |
| `billing_user_id` | GitHub user id being charged/blamed.  |
| `repo`            | GitHub repository `full_name` if set. |

D1 keeps the fuller actor story. AI Gateway metadata is a narrow index for Cloudflare logs and
future spend limits.

Set `eventId` on the gateway request to the local AI usage event id when the provider path allows
it. After the request completes, read `env.AI.aiGatewayLogId` and store it on `ai_usage_facts`.

Do not call `env.AI.gateway(...).getLog()` on the hot path unless we need a gateway-only field that
the AI SDK did not return. If we use it later, run it asynchronously and treat gateway `cost` as an
estimated reconciliation value, not the primary ledger.

If payload logging is enabled at the gateway, request and response bodies must still be excluded for
Nanite model calls unless a separate debugging mode is explicitly enabled. Metrics, token counts,
model, provider, status, duration, and cost can remain logged.

### Agents SDK Observability Shape

Keep the existing app-local `agents/observability` bridge for runtime diagnostics. Agents SDK events
are useful for:

- RPC calls and errors
- message request/response lifecycle
- Think submission status
- schedule lifecycle
- MCP client operations
- workflow state transitions

These events should feed logs and future Tail Workers. They should not become the product cost or
audit source of truth. Product facts should be emitted at Sigvelo-owned domain transitions where
account, installation, Nanite, run, actor, and billing attribution are known.

### Sentry Shape

The installed `@sentry/cloudflare` package exports `vercelAIIntegration`, which can capture AI SDK
spans through the SDK's telemetry hooks. Keep that available for traces with input/output recording
disabled. Do not query Sentry to build customer dashboards or cost allocation.

## GitHub Attribution Contract

Every analytics fact should carry a common attribution block when the information is known.

Minimum fields:

| Field                       | Purpose                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `actor_kind`                | `github_user`, `github_webhook`, `schedule`, `system`, or `agent`. |
| `actor_github_user_id`      | Human actor id when the actor is a GitHub user.                    |
| `actor_github_login`        | Human actor login when safe to display.                            |
| `actor_source`              | Browser, MCP, manager chat, webhook, schedule, or maintenance.     |
| `billing_github_user_id`    | GitHub user currently responsible for cost attribution.            |
| `billing_github_login`      | Display login for that billing attribution.                        |
| `billing_attribution_basis` | Why this user is responsible.                                      |
| `request_id`                | Request or tool-call correlation id.                               |

`actor` answers "who performed this action?" `billing_*` answers "whose Nanite work should this
spend roll up under?"

Initial attribution policy:

| Situation                    | Actor                  | Billing attribution                                         |
| ---------------------------- | ---------------------- | ----------------------------------------------------------- |
| Browser manual action        | Signed-in GitHub user. | Same GitHub user.                                           |
| MCP tool call                | MCP OAuth GitHub user. | Same GitHub user unless the action runs an existing Nanite. |
| Scheduled Nanite run         | `schedule`.            | Nanite creator until explicit ownership exists.             |
| GitHub webhook-triggered run | `github_webhook`.      | Nanite creator until explicit ownership exists.             |
| Maintenance cleanup          | `system`.              | Null unless cleaning up a specific user-created Nanite.     |
| Nanite continuation          | `agent`.               | Existing run billing attribution.                           |

This avoids a false claim that every automated run was directly started by a person while still
letting the dashboard answer "which user's Nanites are spending money?"

Later, add explicit Nanite ownership or cost-center fields. Do not invent teams or billing accounts
before users need them.

## Part 1: Good Bones

Part 1 should create the smallest durable model that can support the first dashboard without
painting the codebase into a corner.

### 1. Wire Existing Cost Facts

The cost dashboard should start with `ai_usage_facts`.

Current useful fields already exist:

- `accountId`
- `githubInstallationId`
- `githubRepositoryId`
- `runKey`
- `requestId`
- `provider`
- `model`
- `sessionAffinity`
- `stepCount`
- `finishReason`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `reasoningTokens`
- `cachedInputTokens`
- `cacheWriteTokens`
- `rawUsageJson`
- `providerMetadataJson`
- `providerBilledTotalCostUsdMicros`
- `estimatedTotalCostUsdMicros`
- `startedAt`
- `completedAt`

Proposed additions before the first cost UI:

- `naniteId`
- `aiGatewayLogId`
- `aiGatewayEventId`
- `actorKind`
- `actorGithubUserId`
- `actorGithubLogin`
- `actorSource`
- `billingGithubUserId`
- `billingGithubLogin`
- `billingAttributionBasis`

First implementation rule:

```text
one AI usage row per model request, not one row per token chunk
```

For multi-step agent turns, upsert by `requestId` and store the final AI SDK `totalUsage`. If the
Nanite agent cannot reliably connect usage, run, actor, billing attribution, and AI Gateway log id
yet, fix that boundary before building cost charts.

Cost should come from the Cloudflare AI Gateway log for the actual model request. Do not maintain a
local model pricing table or calculate public-list-price estimates in the route/recorder layer. If
the Gateway log does not expose `cost`, leave cost empty for that row. Use USD micros for all stored
amounts. Do not store floating point dollars.

The first cost views should group by:

- account
- GitHub installation
- repository
- Nanite
- run
- provider/model
- day

Cloudflare account-level infrastructure billing remains external in this phase. The dashboard can
show directly counted quantities, such as model tokens or workspace hydration events, but it should
not pretend to allocate Worker, D1, R2, or Durable Object billing per run until that attribution is
real.

### 2. Write Run Facts

`nanite_run_facts` should become the durable run summary table.

Write or upsert a row when:

- a run is created
- dispatch starts or fails
- the Nanite reports terminal lifecycle
- stale-run maintenance changes the visible outcome
- workspace hydration records final counts or failure

The table already has enough shape for the first pass: installation, repository, `runKey`,
`naniteId`, trigger kind, actor, status, conclusion, phase, counters, workspace hydration metrics,
started/completed timestamps, and summary.

Do not add per-tool rows here. Tool calls can remain logs until the UI has a specific question that
requires a D1 fact.

### 3. Add A Nanite Catalog Projection

Manager state owns the live Nanite registry. D1 should hold a queryable projection for dashboard and
audit joins.

Proposed table: `nanite_catalog`

Minimum fields:

| Field                       | Purpose                                             |
| --------------------------- | --------------------------------------------------- |
| `id`                        | Row id.                                             |
| `account_id`                | Tenant/account join.                                |
| `github_installation_id`    | Installation boundary.                              |
| `nanite_id`                 | Manifest id.                                        |
| `name`                      | Display name.                                       |
| `enabled`                   | Current visible enabled state.                      |
| `event_source_type`         | `manual`, `github`, `schedule`, or `scheduleEvery`. |
| `latest_version_id`         | Joins audit events to the current definition.       |
| `created_by_github_user_id` | Creator provenance.                                 |
| `created_by_github_login`   | Creator display.                                    |
| `updated_by_github_user_id` | Last human editor.                                  |
| `updated_by_github_login`   | Last human editor display.                          |
| `created_at`                | Creation time.                                      |
| `updated_at`                | Last projected manager update.                      |

Optional after first cut:

- `repository_count`
- `trigger_event_count`
- `permission_count`
- `last_run_at`
- `last_run_status`

Do not copy the full manifest into relational columns. If full definition snapshots become needed,
put them in R2 or a JSON column after a concrete UI or audit need appears.

### 4. Add Append-Only Audit Events

Proposed table: `audit_events`

Grain:

```text
one row per control-plane action that changes authority, trust, spend, or visibility
```

Minimum fields:

| Field                    | Purpose                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| `id`                     | Event id.                                                                         |
| `occurred_at`            | When the action happened.                                                         |
| `event_name`             | Stable dotted name.                                                               |
| `account_id`             | Account boundary when known.                                                      |
| `github_installation_id` | Installation boundary when known.                                                 |
| `nanite_id`              | Nanite target when known.                                                         |
| `run_key`                | Run target when known.                                                            |
| `actor_kind`             | `github_user`, `github_webhook`, `schedule`, `system`, or `agent`.                |
| `actor_id`               | Stable actor id.                                                                  |
| `actor_login`            | Display login when safe.                                                          |
| `actor_github_user_id`   | GitHub user id when available.                                                    |
| `actor_github_login`     | GitHub login when available.                                                      |
| `billing_github_user_id` | GitHub user currently responsible for cost attribution when applicable.           |
| `billing_github_login`   | Display login for billing attribution when applicable.                            |
| `billing_basis`          | Why this billing user is responsible.                                             |
| `surface`                | `browser`, `mcp`, `manager_chat`, `github_webhook`, `schedule`, or `maintenance`. |
| `target_type`            | `nanite`, `run`, `trigger_source`, `permissions`, `auth`, or `installation`.      |
| `target_id`              | Target identifier.                                                                |
| `outcome`                | `success`, `failure`, `denied`, or `noop`.                                        |
| `reason_code`            | Stable machine reason when useful.                                                |
| `request_id`             | Request correlation.                                                              |
| `metadata_json`          | Small sanitized metadata only.                                                    |

Initial event names:

- `audit.nanite.created`
- `audit.nanite.updated`
- `audit.nanite.deprovisioned`
- `audit.nanite.enabled`
- `audit.nanite.disabled`
- `audit.nanite.trigger_source.updated`
- `audit.nanite.permissions.updated`
- `audit.run.started`
- `audit.run.canceled`
- `audit.manager_escalation.resolved`
- `audit.mcp.authorization.granted`
- `audit.mcp.authorization.denied`

Audit rows must not store raw prompts, OAuth tokens, GitHub webhook bodies, tool outputs, model
responses, cookies, request headers, or full generated source.

### 5. Keep Event Detail Thin

Do not create a wide `observability_events` table on day one.

The first Event Explorer can union these durable sources:

- `audit_events`
- `nanite_run_facts`
- `ai_usage_facts`
- selected `platform_usage_facts`

Add a dedicated `nanite_run_events` table only when the UI needs a timeline that cannot be answered
from run summaries, audit rows, and logs. If that table is added, it should start with lifecycle
milestones only:

- `nanite.run.created`
- `nanite.run.dispatch_started`
- `nanite.run.dispatch_failed`
- `nanite.workspace_hydration.completed`
- `nanite.workspace_hydration.failed`
- `nanite.lifecycle.completed`
- `nanite.lifecycle.failed`
- `nanite.lifecycle.no_change`
- `nanite.lifecycle.waiting_for_manager`
- `nanite.run.canceled`

## Backend Shape

Prefer one small backend module and one route file:

```text
src/backend/observability/recorders.ts
src/backend/observability/queries.ts
src/backend/api/routes/observability.ts
```

`recorders.ts` should own inserts and upserts for:

- `recordNaniteCatalogProjection`
- `recordAuditEvent`
- `recordNaniteRunFact`
- `recordAiUsageFact`
- `buildNaniteAiGatewayMetadata`
- `resolveNaniteBillingAttribution`

`queries.ts` should own dashboard reads:

- `getObservabilityOverview`
- `getNaniteCostBreakdown`
- `getNaniteCatalogRows`
- `getRunFeed`
- `getAuditFeed`
- `getObservabilityEventDetail`
- `getObservabilityFilterOptions`

The Hono route should stay boring:

```text
GET /api/observability/overview
GET /api/observability/costs
GET /api/observability/nanites
GET /api/observability/runs
GET /api/observability/audit
GET /api/observability/events/:eventId
GET /api/observability/filter-options/:filter
```

Use Zod validators at the HTTP boundary. Do not introduce HypeQuery or a generated client just for
this dashboard.

## Frontend Shape

Start with a GitHub-authenticated product route shell:

```text
src/frontend/routes/_authenticated/observability/route.tsx
src/frontend/routes/_authenticated/observability/-search.ts
src/frontend/routes/_authenticated/observability/-queries.ts
src/frontend/routes/_authenticated/observability/observability.css
```

Add child routes only after the first page becomes too large:

```text
/observability
/observability/runs
/observability/audit
/observability/nanites
```

The initial URL search contract should be small:

| Field            | Use                             |
| ---------------- | ------------------------------- |
| `range`          | `24h`, `7d`, `30d`.             |
| `environment`    | Local/staging/production label. |
| `installationId` | GitHub installation filter.     |
| `repository`     | GitHub `full_name` filter.      |
| `naniteId`       | Nanite filter.                  |
| `outcome`        | Run/audit outcome filter.       |
| `surface`        | Browser/MCP/webhook/schedule.   |
| `search`         | Text search.                    |
| `selectedEvent`  | Detail sheet row.               |
| `cursor`         | Feed pagination.                |
| `live`           | 30-second refresh toggle.       |

Keep page logic route-owned. Extract shared components only when two views use them.

First extracted components, if needed:

```text
-KpiStrip.tsx
-CostOverTimeChart.tsx
-CostBreakdownChart.tsx
-RunOutcomeChart.tsx
-CostBreakdownTable.tsx
-RunFeedTable.tsx
-AuditFeedTable.tsx
-EventDetailSheet.tsx
-FilterChipStrip.tsx
```

Do not copy the old analytics app's component tree wholesale.

### Visual-First Dashboard

The observability page should be visual first. The first screen should read as a dashboard, not a
report.

Use charts, compact KPI comparisons, color-coded outcomes, and ranked breakdowns before tables.
Tables are for inspection and drill-down, not the primary explanation.

The first visual set should include:

- cost over time
- cost by Nanite
- cost by repository
- cost by provider/model
- runs by outcome
- top Nanites by estimated cost
- top Nanites by run count

Use a focused React charting library when implementation needs one. Recharts is a reasonable default
if the bundle impact is acceptable. Keep chart data shaped by backend query functions so the route
does not perform heavy aggregation in React.

Avoid walls of explanatory text. Empty, loading, and low-data states should still show the dashboard
structure with clear zero states, not replace the page with paragraphs.

## Part 2: Product Surface

Part 2 turns the facts into a useful customer-facing dashboard.

### Overview

Top cards:

- estimated AI cost
- runs
- successful runs
- failed runs
- no-change runs
- waiting-for-manager runs
- active Nanites
- newly created Nanites

Primary panels:

- cost over time
- cost by Nanite
- cost by repository
- runs by outcome
- top Nanites by run count
- top Nanites by estimated cost
- recent notable events

### Cost

This is the most important early page.

Show:

- total estimated AI cost for the selected range
- cost by Nanite
- cost by run
- cost by repository
- cost by provider/model
- token counts by input/output/cached/reasoning when known
- high-cost run outliers

Every cost label should say `estimated` unless the provider supplies a billed cost for that exact
request.

### Nanites

Show:

- Nanite name
- creator
- enabled state
- event source type
- repositories or repository count
- created date
- last run date
- run count
- success/fail/no-change split
- estimated cost in range

This answers "who created which Nanites" and "which ones are running often."

### Runs

Show:

- status and conclusion
- timestamp
- Nanite
- repository
- trigger kind
- actor
- summary
- estimated cost
- duration
- output URL when present

The run detail should lead with outcome, cost, change proposal, verification state, and next action.
Transcript and raw debug state stay behind the primary review surface.

### Audit

Show:

- timestamp
- event
- actor
- surface
- target
- outcome
- reason
- request id

Audit detail can show sanitized metadata and links to retained artifacts. It should not show raw
payloads by default.

## Security Model

GitHub is the identity source for customer observability. The deployment GitHub installation is the
authorization boundary.

Do not add a Nanites user or role model. The app can store GitHub ids, logins, installation ids, and
repository ids as facts for provenance, joins, and audit review. Those stored facts do not grant
access. Every customer-facing read should start from the current GitHub-authenticated viewer and the
deployment installation resolved by server-side setup state.

Default rules:

- A signed-in viewer can see observability for the one deployment GitHub installation.
- Repository-level filters and rows are limited to repositories recorded for that deployment
  installation.
- There is no installation picker, cross-installation union, or personal-account fallback in v1.
- Installation-wide cost, catalog, and audit views should require a stronger GitHub signal such as
  organization owner, installation admin, repository admin, or repository maintain access when that
  distinction becomes necessary.
- The GitHub App owner is not automatically a customer-route superuser.

When the current GitHub session is missing, the deployment installation is unavailable, a repository
filter is outside the deployment installation, or a required admin signal is missing, deny the read.
Do not fall back to cached database relationships as authorization.

## Access Control Sequence

Build the route and data model so local development is simple. Fixture and local-only states can
render without production data, but real observability rows require the GitHub-authenticated session.

For real installation data, use the existing GitHub-authenticated session first:

1. Viewer signs in with GitHub.
2. Backend resolves the deployment installation from setup metadata and GitHub projections.
3. Backend returns observability rows only for that deployment installation.
4. Backend rejects repository filters outside that deployment installation.
5. Later, tighten installation-wide views to GitHub organization owner, repository admin,
   repository maintain, or installation admin when the product needs an admin-only view.

When the product needs enterprise identity beyond GitHub OAuth, revisit GitHub OIDC or IdP-backed
access. Do not block the first dashboard on that decision.

## Privacy And Retention

Never store these in D1 observability tables:

- OAuth tokens
- cookies
- authorization headers
- raw prompts
- raw model responses
- raw tool outputs
- raw GitHub webhook bodies
- full generated trigger source
- private key material

Allowed D1 substitutes:

- counts
- byte lengths
- token counts
- low-cardinality classes
- hashes when needed
- sanitized reason codes
- artifact keys
- boolean flags

Default retention:

- D1 facts: keep long enough for customer reporting and early billing review.
- R2/debug artifacts: short retention by default.
- Cloudflare/Sentry operational logs: provider retention.

Do not write retention automation in the first planning slice unless storage pressure appears during
implementation.

## Validation

Do not add dedicated observability read-path or dashboard tests for v1. Observability is a reporting
surface, so query and UI bugs can be repaired without risking Nanites core functionality.

Keep validation focused on the ingestion pipeline:

- Make recorder calls hard to skip by wiring them directly at Nanite lifecycle and run lifecycle
  owners.
- Keep ingestion writes non-blocking for core Nanite behavior unless the owner path already requires
  the write.
- Validate the reporting surface with local browser smoke checks and real D1 rows while iterating.

## Implementation Order

1. Add `nanite_catalog`, `audit_events`, and narrow AI usage attribution schema changes.
2. Add recorder functions for catalog, audit, run facts, and AI usage facts.
3. Wire recorders at Nanite create/update/deprovision, manual start/cancel, run create/complete, and
   AI usage completion.
4. Add observability query functions and Hono routes.
5. Add an ungated `/observability` route shell with URL-backed search state.
6. Build overview and cost panels first.
7. Add Nanite roster, runs feed, and audit feed.
8. Add access checks around real data.

## Non-Goals

- no ClickHouse
- no Tail Worker
- no full log ingestion into D1
- no per-token event rows
- no generic APM page
- no raw payload viewer
- no perfect billing reconciliation
