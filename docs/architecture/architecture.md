# Nanites Architecture

## Purpose

This is the canonical long-term Nanites product document.

It defines the stable product boundaries, the collaborator model, and the installation-scoped ontology future work should preserve.

Use [execution-architecture.md](/docs/architecture/execution-architecture.md) for build-now runtime decisions and [roadmap.md](/docs/architecture/roadmap.md) for the next few sprints.

## Product Model

Nanites are small durable agents that own a vertical maintenance responsibility across a GitHub installation.

They are not defined primarily by one trigger type such as PR review.

They can be triggered by:

- pull request events
- schedules
- manual operator actions
- webhook events
- generated inbound trigger handlers
- future repository lifecycle hooks

The stable product boundaries are:

- installation
- nanite
- run outcome
- change proposal
- GitHub feedback surface

Repos are scope targets inside a GitHub installation. They are not the top-level runtime hierarchy.

The platform should support many cheap, durable Nanites under one installation. Each Nanite should be addressable, observable, and able to own a narrow responsibility such as a documentation page family, a package release surface, a test lane, or a maintenance loop.

## Primary Product Nouns

The product should use three primary nouns:

- `Installation`: the GitHub App permission boundary and Nanite manager
- `Nanite`: the durable agent that owns one vertical responsibility
- `Run`: one Nanite execution caused by a trigger, schedule, or manual prompt
- `Run Outcome`: the lifecycle result of one Nanite Run
- `Change Proposal`: the primary reviewable artifact produced by a Run, usually a pull request or simple pull request stack entrypoint

`Run` is the user-facing and API term for one Nanite execution, but it should not force another Durable Object layer until concurrent run isolation, retention, or recovery requires it.

Everything else is runtime or integration detail unless it materially affects trust, timing, or the next user decision.

## Nanite Definition Shape

The stable Nanite definition should stay intentionally thin.

A Nanite is primarily:

- `Scope`: which repos, files, packages, docs, or surfaces it owns
- `Soul`: what purpose it serves and what behavior/tradeoffs it should prefer
- `Stop conditions`: what counts as done, blocked, failed, or waiting

That is the durable product identity.

Capabilities should not be hand-authored into giant Nanite manifests unless they materially affect trust or user-facing behavior.

Default capability sources should be:

- repo-local instructions such as `AGENTS.md`
- repo-local Codex config, skills, and plugins
- configured MCP servers
- runtime-owned CLI surfaces such as Sigvelo publishing and completion commands

This keeps Nanites legible as product objects instead of turning them into another agent runtime.

## Runtime Generation Boundary

Nanite behavior should default to stable Cloudflare Think sub-agents parameterized by scope, soul, stop conditions, Think memory, MCP attachments, and tool policy.

Do not generate a Durable Object class for the Nanite itself by default. A stable Nanite agent already gives the product what it needs:

- durable state and Think memory
- live token streaming through the Agents SDK
- direct UI connection through sub-agent routing
- workspace and code intelligence tools
- lifecycle reporting
- the ability to propose child Nanites for manager validation

Dynamic Worker generation should be reserved for each Nanite's inbound trigger handler.

Generated inbound trigger handlers can own arbitrary event logic:

- normalize random webhook payloads
- evaluate unusual schedule or environment predicates
- debounce, dedupe, and route noisy external events

Generated trigger handlers should emit owner-only dispatch or noop intents to the installation
manager. They can use scoped, read-oriented Octokit to interpret events when the webhook payload is
not enough. They should not directly own GitHub write authority, Nanite lifecycle state,
cross-Nanite dispatch, or the UI contract.

The manifest trigger is only a candidate filter for manager intake. It can keep a 10,000-Nanite
installation from evaluating every generated trigger on every webhook, but it should stay coarse and
derived from cheap event facts. The generated TypeScript trigger remains the actual event decision.

Schedules are different from webhooks because Cloudflare Agents already have durable schedules.
Use first-party Agent schedules backed by Durable Object alarms and owned by the Nanite sub-agent to
wake one Nanite trigger path. The manager validates and installs schedule changes, but it should not
own the recurring callback as installation-wide dispatch logic. The scheduled callback should
normalize the tick into a machine event and let the owning Nanite's generated TypeScript trigger
decide whether to start a Run.
Use `schedule` as the product/API type; cron is only one supported Cloudflare Agent schedule mode.
Represent the value as an explicit schedule shape, not a bare string:

```ts
type NaniteScheduleSpec =
  | { type: "scheduled"; date: string }
  | { type: "delayed"; delayInSeconds: number }
  | { type: "cron"; cron: string }
  | { type: "interval"; intervalSeconds: number };
```

For the GitHub-first product, generated trigger handlers should use raw Octokit instead of a Sigvelo-specific GitHub helper library. Octokit is already well documented, familiar to code-writing models, and maps directly to GitHub's API surface. Sigvelo should provide the runtime wrapper, a scoped Octokit client, generated-code typings, and intent helpers such as dispatchSelf, noop, and record.

The generated code should be ordinary Worker-compatible TypeScript so authoring agents get type
errors back during trigger tests:

```ts
export default {
  async handle(event, ctx) {
    if (event.type !== "github.push") {
      return ctx.noop("Not a push event.");
    }

    const [owner, repo] = event.payload.repository.full_name.split("/");
    const comparison = await ctx.octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${event.payload.before}...${event.payload.after}`,
    });

    const files = comparison.data.files?.map((file) => file.filename) ?? [];
    const relevantFiles = files.filter((file) => file.startsWith("packages/react-webmcp/"));
    if (relevantFiles.length === 0) {
      return ctx.noop("No React WebMCP package changes");
    }

    return ctx.dispatchSelf({
      sourceRepo: event.payload.repository.full_name,
      before: event.payload.before,
      after: event.payload.after,
      files: relevantFiles,
    });
  },
};
```

Generated trigger code should be easy for another coding agent to author. The authoring environment should include:

- the Sigvelo trigger runtime contract and examples
- Octokit types
- a pre-bundled Octokit client for Worker Loader execution
- local Octokit source and docs fetched through `opensrc` when deeper API behavior matters
- clear guidance that generated trigger handlers route events and return intents; Nanite Think sub-agents do the actual work

## Capability Model

Nanites should prefer imported capability over Sigvelo-specific reinvention.

The default model should be:

- Sigvelo defines the Nanite's scope, soul, and stop conditions
- the pulled repository contributes repo-native instructions and local skills
- MCP contributes external knowledge and tool capability
- runtime-owned CLIs contribute trust-sensitive actions

Examples:

- docs lookup should come from MCP or repo docs, not hardcoded prompt text when the live source already exists
- coding behavior should come from the executor's native shell/edit/tool model, not from a duplicate Sigvelo-authored tool catalog
- publishing, verification, and explicit finish should remain runtime-owned because they are part of the trust boundary

For GitHub API capability, the manager should issue scoped GitHub App installation tokens and attach
a constrained GitHub MCP inventory to the Nanite. A GitHub installation cannot mint classic PATs, and
the official GitHub MCP server cannot automatically scope-filter GitHub App installation tokens. The
model that creates a Nanite may request a GitHub MCP capability tier or specific tools, but the
installation manager validates the effective repositories, app permissions, and MCP tools.

The default split should be:

- Workspace git tools own repository edits, branches, commits, and pushes
- GitHub MCP owns PR lookup, PR creation/update, PR/check reads, and other GitHub API tasks
- the manager owns capability validation and token issuance
- the Nanite owns the work strategy, including whether to create one PR or a stack of PRs

This is the cleanest way to support many future Nanites without multiplying product-specific tool surfaces.

## Run Semantics

These rules are part of the product contract:

- a new trigger creates a fresh Run for a Nanite
- a Run starts from the Nanite's durable identity plus Think-owned memory
- resume only applies within the same active Run
- old full transcripts are not reused across Runs
- any durable memory that survives across Runs should come from Think, not a Sigvelo-owned memory layer
- backend choice is internal unless it changes the outcome, timing, or required next action
- support PR reuse is an output strategy, not the primary mental model

Executor-local context such as repo-local skills, MCP configuration, or short-term conversation history may be rebuilt for each Run. Durable Nanite identity should stay compact and explicit.

## Core Hierarchy

```text
Installation
  -> Nanites
    -> Runs
      -> Change proposals
```

Meanings:

- installation: GitHub App permission boundary
- nanite: one durable agent under the installation
- run: one execution caused by a trigger, user message, or schedule
- run outcome: the lifecycle result of a Run
- change proposal: the primary reviewable artifact produced by a Run
- GitHub feedback surface: the clean external projection of Nanite work back into GitHub

## User Story Shape

The long-term user story should feel like:

1. User signs in with GitHub.
2. User selects an accessible installation.
3. User sees the Nanites configured for that installation.
4. User can filter or group them by repo, package, docs area, or responsibility.
5. User sees recent work, status, and schedule/trigger info.
6. User can understand what each Nanite does and how it is triggered.

That means the main runtime surface is installation-centric, not PR-centric.

PRs are one trigger among several.

## Recommended Long-Term Boundaries

### Auth boundary

Use `githubInstallationId` as the authorization boundary.

### Product surface boundary

Use installation as the primary runtime surface. Repos are important filters and scope targets, not required manager layers.

### Behavior boundary

Use the Nanite sub-agent as the unit of "what this helper is."

### Execution boundary

Use a Run as the unit of actual work.

Keep the execution backend replaceable. The product contract is Installation -> Nanite -> Change Proposal, not "one specific model loop."

### GitHub integration boundary

Use Octokit as the default GitHub boundary.

Keep GitHub-specific implementation thin and native:

- webhook handling
- installation and user auth clients
- repo and pull request reads
- checks, comments, refs, commits, and PR writes

Avoid a second internal type vocabulary for standard GitHub objects unless a true product contract needs it.

## Durable Object / Agent Shape

The likely stable model is:

### Installation manager

```text
installation:{githubInstallationId}
```

Owns:

- GitHub installation boundary
- Nanite registry
- webhook intake
- generated trigger handler registration
- schedule registration
- trigger dedupe and dispatch limits
- cross-repo dashboard state
- GitHub feedback policy and capability issuance
- child Nanite proposal validation

### Nanite sub-agents

```text
installation:{githubInstallationId}/sub/nanite-agent/{naniteName}
```

Owns:

- durable Nanite identity, Think memory, and status
- live chat transcript and token stream
- current and recent Runs
- workspace-backed investigation and edits
- change proposal pointer
- lifecycle tools such as complete, no-change, fail, ask-human, and create-child-nanite

Use Agents SDK sub-agent routing for browser access. The UI should connect directly to the Nanite sub-agent instead of reading a mirrored transcript from the manager.

### Generated inbound trigger handlers

```text
installation:{githubInstallationId}:nanite:{naniteName}:trigger
```

Owns:

- generated event normalization and routing logic
- arbitrary trigger predicates
- arbitrary trigger predicates
- calls back to the installation manager with owner-only dispatch or noop intents

Does not own:

- raw GitHub write authority
- final lifecycle transitions
- Think-owned Nanite memory
- Nanite topology changes
- the UI contract

Human prompts are not trigger-handler events. If a user chats with a Nanite, clicks "run now", or calls the MCP run tool with a prompt, that prompt goes directly through the stable Think sub-agent path. Generated trigger code is for machine-originated inbound signals such as GitHub webhooks, schedule ticks, and external webhooks.

## Class Count vs Instance Count

Do not confuse class count with instance count.

Preferred direction:

- small number of agent/DO classes
- large number of keyed instances

Avoid:

- one global singleton for everything
- one agent class per Nanite behavior
- one architectural layer per trigger type

Preferred:

- one installation manager class
- one stable Nanite Think sub-agent class
- optional generated trigger handlers for arbitrary event logic
- Nanite behavior expressed through scope, soul, stop conditions, Think memory, and tools before generated code

## Nanite Types

Examples of Nanites:

- `typecheck`
- `browser-smoke-test`
- `dependency-bump-helper`
- `test-fixer`
- `docs-syncer`
- `release-prep`

These should be treated as durable Nanite instances first, not as separate Durable Object classes by default.

That list is future-facing.

## Trigger Types

Triggers are inputs to the installation manager and Nanites.

```text
generated trigger handler or manager intake -> Nanite dispatch -> Run
```

Examples:

- PR event triggers `browser-smoke-test`
- schedule triggers `dependency-bump-helper`
- manual action triggers `test-fixer`
- webhook event triggers `docs-syncer`
- each package docs Nanite evaluates the same package-change event with its own Trigger Handler

Use stable manager code for webhook verification and coarse event normalization. Invoke the candidate Nanite's generated trigger handler when trigger logic itself needs arbitrary code. The handler returns JSON intents; the manager validates and executes them.

## GitHub feedback surface

GitHub should be treated as the external feedback layer, not the primary observability layer.

That surface should stay intentionally small:

- one check run
- optional one canonical PR comment
- a link back to the live Nanite detail
- concise status and artifact summary

This belongs naturally to the installation manager and Nanite because:

- it must respect the GitHub installation boundary
- it may reflect cross-repo work from one Nanite
- it may reflect work from many Nanites under one installation
- it is an output projection, not an execution environment

The model should be:

- Nanites generate artifacts and live state
- the installation manager enforces GitHub capability and projection policy
- GitHub stays clean while Sigvelo carries the deeper execution story

## Change proposal continuity

When a Nanite produces code changes, Sigvelo should prefer one stable change-proposal surface per Nanite per target repo instead of opening a new PR each time.

Today that surface is usually a support PR.

The default behavior should be:

- zero open PRs when there is no current code change to carry
- at most one open PR per Nanite per target repo when that Nanite does have ongoing work
- new Runs update the existing branch and PR instead of creating another one
- merged changes on the default branch cause the Nanite to refresh or rebase its existing work

Why this belongs in the architecture:

- it keeps the GitHub artifact stable across Runs
- it gives human feedback a single canonical place to accumulate
- it avoids repo spam from repetitive machine-opened PRs
- it preserves continuity without forcing the product story to revolve around PR lanes

This does not mean every Run must publish to GitHub.

It means the system should model change-proposal continuity explicitly once Nanites start publishing their own changes.

## Config Direction

Current implementation direction:

- Nanite definitions are authored in code
- repository scope is derived from the repositories visible to the active installation
- do not add D1-backed Nanite configuration until users can actually author or edit it

Do not carry a compatibility layer for repo-file config while the product is still code-authored.

## Scheduling Direction

Installation-owned recurring Nanites are a natural fit for sub-agents because Cloudflare Agents scheduling persists on the agent via Durable Object alarms and SQLite.

That means the likely long-term direction is:

- the installation manager owns global schedule policy and visibility
- each Nanite can own its own recurring schedule when the schedule belongs to its responsibility
- generated trigger handlers can evaluate unusual schedule predicates and dispatch Nanites
- Nanites do the actual work

## Workflow Direction

If some Nanites become:

- long-running
- retry-heavy
- multi-step
- approval-gated

then Cloudflare Workflows may become the right execution primitive for Runs.

That decision should be made later.

It is not required to prove the current feature direction.

## Current implementation relationship

The current implementation should intentionally underbuild this architecture.

For now:

- one installation manager and one stable Nanite Think sub-agent path are enough
- one generated trigger handler spike is enough
- the code should not pretend generated owner Nanites already exist
- the code should not add repo or run manager layers before they earn their keep

## Design Rule

Document the bigger system.

Build the smaller one.
