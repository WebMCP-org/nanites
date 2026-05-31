# Explain Nanites Imports

This is a reference note for [src/backend/nanites.ts](/src/backend/nanites.ts).

Use these first for product truth:

- [../architecture.md](/docs/architecture/architecture.md)
- [../execution-architecture.md](/docs/architecture/execution-architecture.md)
- [../roadmap.md](/docs/architecture/roadmap.md)
- [../user-stories.md](/docs/architecture/user-stories.md)

## Short version

Nanites are repo-scoped maintenance agents. In the current implementation, [NaniteManager](/src/backend/nanites.ts:716) is the thin installation-scoped control layer and [Nanite](/src/backend/nanites.ts:1054) is the durable worker that owns the live lane state, transcript-driven attempt state, support PR continuity, execution backend, and final artifact.

The big import block in `nanites.ts` looks intimidating, but it is mostly one file pulling together five concerns:

1. Cloudflare agent and execution primitives
2. Sigvelo contracts, domain types, and analytics writes
3. GitHub and support-PR integration
4. Nanites-specific prompt, MCP, browser, and runtime helpers
5. Shared projection and key helpers

## What Nanites are in practice

The current runtime shape is:

- `NaniteManager` keeps installation-scoped webhook dedupe state and routes events to the right worker.
- `Nanite` is a stable configured worker keyed by Nanite identity, not just a transient helper function.
- The active attempt is represented by the current AI chat session plus run context.
- The authoritative live lane snapshot is [NaniteLaneSnapshot](/packages/contracts/src/nanites.ts:655).
- The manager state is intentionally small: [NaniteManagerState](/packages/contracts/src/nanites.ts:692) only stores recent webhook keys.

That means the current branch direction is: derive configured Nanites on demand from code, keep the manager thin, and let the Nanite worker own the meaningful live state.

## How to read the imports

### 1. Cloudflare runtime substrate

These imports are the execution foundation. They are not Nanites-specific business logic.

- `@cloudflare/ai-chat`
  Gives Nanite its durable chat-agent base class, chat recovery hooks, and request lifecycle types.
- `@cloudflare/shell`
  Provides the durable `Workspace`, workspace-backed filesystem adapters, and the shared codemode prompt primitives.
- `@cloudflare/shell/git`
  Provides the workspace-native git layer used for status, diff, clone, commit, checkout, and push behavior.
- `@cloudflare/think/tools/execute`
  Creates `runStateCode`, the higher-level coordinated workspace execution tool.
- `@cloudflare/think/tools/workspace`
  Creates direct file tools like read, write, edit, list, find, grep, and delete.
- `agents`
  Provides the base `Agent` class, `@callable()` RPC surface, and `getAgentByName()` routing between Durable Object agents.
- `ai`
  Provides the model loop, tool wrapper, message validation, stream response helpers, and UI-message utilities.

If you only want the "what platform is this built on?" answer, it is: `Agent` for orchestration, Think/AI chat for the loop, and `Workspace` for durable file work.

### 2. Sigvelo contracts, domain types, and analytics

These imports define what Nanites are allowed to say about themselves and what gets written to business data.

- [@nanites/contracts/nanites](/packages/contracts/src/nanites.ts)
  This is the main contract file. It defines Nanite instances, triggers, lane snapshots, attempt projections, support-PR surfaces, browser verification payloads, and terminal tool schemas like `completeRunInputSchema` and `failRunInputSchema`.
- [@nanites/contracts/auth](/packages/contracts/src/auth.ts)
  Validated repository and authenticated actor shapes.
- [@nanites/contracts/ids](/packages/contracts/src/ids.ts)
  Branded installation and repository identifiers.
- `@nanites/domain/business`
  Cross-app business enums such as backend, variant, phase, status, and conclusion.
- `@nanites/db/client`
  Creates the DB client used for analytics and business facts.
- `@nanites/db/mutations/business`
  Records AI usage, platform usage, Nanite run facts, and support PR facts.
- `@nanites/observability/log-events` and `@nanites/observability/otel-attrs`
  Shared constant sets for structured logs and OpenTelemetry attributes.
- `zod`
  Runtime validation for all important cross-boundary payloads.

The contracts layer matters because `nanites.ts` is not just runtime code. It is a contract-enforcing runtime.

### 3. GitHub and repo integration boundary

These imports are how Nanites touch real repositories and GitHub surfaces.

- [#/backend/github.ts](/src/backend/github.ts)
  The main GitHub boundary. It gets installation tokens, creates and updates GitHub check runs, finds or creates support PRs, updates PR bodies and sticky comments, and inspects support-PR environments for checks, deployments, and preview candidates.
- [#/backend/business-data.ts](/src/backend/business-data.ts)
  Higher-level business-data helper logic such as Workers AI pricing readiness.
- [#/backend/nanites/installation-config.ts](/src/backend/nanites/installation-config.ts)
  Loads configured Nanite instances and decides which configured Nanites target or source a given repository.

This is also the cleanest answer to "where does repo selection happen?": the manager loads configured Nanites, then routes to the worker selected by installation config plus trigger context.

### 4. Shared Nanites helpers

These imports are the glue that turns transcript events into a UI- and GitHub-friendly runtime story.

- [#/shared/constants/nanites.ts](/src/shared/constants/nanites.ts)
  Shared constants like the GitHub check-run name.
- [#/shared/nanites.ts](/src/shared/nanites.ts)
  Stable key builders and naming helpers such as `buildNaniteKey`, `buildSupportBranchName`, and run URLs.
- [#/shared/nanites-chat.ts](/src/shared/nanites-chat.ts)
  The transcript/projection layer. It defines Nanite UI message types, runtime activity parts, and `reduceNaniteRunProjection()`, which turns immutable attempt metadata plus transcript history into the current projection.

If one import group is the conceptual center of the runtime, it is `nanites-chat.ts`. That file is why the live state can be derived from the chat log instead of being hand-maintained in many places.

### 5. Prompt and MCP composition

These imports tell the model who it is and what remote MCP dependencies it needs.

- [#/backend/nanites/skills/provider.ts](/src/backend/nanites/skills/provider.ts)
  Resolves prompt fragments for a Nanite definition.
- [#/backend/nanites/skills/registry.ts](/src/backend/nanites/skills/registry.ts)
  Maps Nanite skill keys to embedded prompt documents.
- [#/backend/nanites/mcp/provider.ts](/src/backend/nanites/mcp/provider.ts)
  Resolves and formats required MCP server context, including failure handling.
- [#/backend/nanites/mcp/registry.ts](/src/backend/nanites/mcp/registry.ts)
  Registry of MCP servers declared by Nanite config.

This is the answer to "where do the Nanite's soul, skills, and MCP servers come from?": the configured definition in contracts points to prompt and MCP keys, and these provider/registry modules resolve them into runtime context.

### 6. Support PR and browser verification helpers

These imports are the support-PR collaboration surface.

- [#/backend/nanites/browser/support-pr-preview.ts](/src/backend/nanites/browser/support-pr-preview.ts)
  Runs the real preview verification pass and returns the verification report.
- [#/backend/nanites/github-check-output.ts](/src/backend/nanites/github-check-output.ts)
  Formats the active and superseded GitHub check-run output.
- [#/backend/nanites/support-pr-runtime.ts](/src/backend/nanites/support-pr-runtime.ts)
  Support-PR-specific document builders, sticky comment helpers, bootstrap-file rules, resume follow-up text, and preview verification block replacement.
- [#/backend/nanites/runtime-contracts.ts](/src/backend/nanites/runtime-contracts.ts)
  Encodes "can this run finish?", "should this turn continue?", and "how should environment updates affect the active attempt?" rules.

These helpers are the current support-PR seam. Even though the runtime still lives in one big file, most of the support-PR policy has already been pushed into dedicated helpers.

### 7. Execution, persistence, and observability helpers

These imports exist because the old prototype mixed runtime state, durable side storage, and GitHub workflow concerns beyond the chat transcript.

- [#/backend/nanites/context-store.ts](/src/backend/nanites/context-store.ts)
  Tiny SQLite-backed key/value store for attempt-local context.
- [#/backend/workers-ai.ts](/src/backend/workers-ai.ts)
  Creates the Workers AI model with prompt caching and session affinity behavior.
- [#/backend/nanites/observability.ts](/src/backend/nanites/observability.ts)
  Nanites-specific logging and observability wiring.
- [#/backend/sentry.ts](/src/backend/sentry.ts)
  AI SDK telemetry wiring.
- [#/backend/nanites/hybrid-execution.ts](/src/backend/nanites/hybrid-execution.ts)
  Old backend-routing decisions, checkout plans, fallback messages, and normalized repository status helpers.

This group is why the old prototype could say "prepare the environment" without embedding every workflow detail inline.

## The important ownership boundary

The conversation converged on this model:

- the manager should be thin
- the Nanite worker should be authoritative
- the active attempt is best understood as the current chat/execution session
- support PR continuity belongs to the Nanite lane, not to the manager

That maps well onto the current code:

- [NaniteManagerState](/packages/contracts/src/nanites.ts:692) is already small.
- [NaniteLaneState](/packages/contracts/src/nanites.ts:686) is the stable worker-owned state.
- The worker exposes [getSnapshot()](/src/backend/nanites.ts:1452) and [getPersistedTranscriptMessages()](/src/backend/nanites.ts:1447), which makes it possible for the UI to talk to workers directly.
- [repository-manager.ts](/src/backend/nanites/repository-manager.ts) already fans out from the manager to each configured Nanite and asks each one for its snapshot.

That is why the strongest refactor takeaway is not "invent a new abstraction." It is "keep pushing authority down to the Nanite worker and keep the manager as config-plus-routing."

## The shortest mental model

If you are staring at the imports and want the least confusing way to think about them:

- `NaniteManager` answers: which Nanites exist for this installation, and which one should receive this event?
- `Nanite` answers: what is this lane doing right now, what does the transcript say happened, what support PR exists, what checks and previews exist, and how does this attempt end?
- `contracts/nanites.ts` answers: what state shapes and tool payloads are legal?
- `shared/nanites-chat.ts` answers: how do transcript events reduce into a current projection?
- `backend/github.ts` answers: how do we touch GitHub safely?
- `backend/nanites/*` answers: how do prompt loading, MCP wiring, support-PR policy, workspace routing, and browser verification actually work?

## Refactor direction from the conversation

The smallest credible refactor direction is still:

- keep `NaniteManager` as a thin orchestrator and router
- keep live lane ownership on `Nanite`
- keep transcript-derived attempt state on `Nanite`
- avoid reintroducing manager-owned duplicate truth for support PRs, attempt projections, or artifacts

The larger lane-owned rewrite can happen later. The useful immediate rule is simpler:

`NaniteManager` should know where to send work.

`Nanite` should know what happened.
