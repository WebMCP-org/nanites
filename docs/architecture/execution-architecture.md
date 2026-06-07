# Nanites execution architecture

## Purpose

This is the build-now Nanites runtime document.

It describes the installation-manager-to-many-Nanites runtime model, the Think sub-agent runtime, generated inbound trigger handlers, Workspace-backed file work, and the operational rules the next implementation work should follow.

Use [architecture.md](/docs/architecture/architecture.md) for the long-term product model. Use this file for runtime decisions and current implementation work.

## Core model

Nanites have three distinct runtime concerns:

- **Installation control plane**: one Durable Object agent per GitHub installation. It owns auth, GitHub webhook intake, the Nanite registry, trigger dispatch policy, generated trigger handler registration, GitHub capability issuance, and the aggregate UI index.
- **Nanite actor plane**: stable Cloudflare Think sub-agents under the installation manager. A Nanite owns its durable identity, Think memory, live chat transcript, token stream, current work, workspace-backed investigation, and change proposal pointer.
- **Inbound trigger plane**: per-Nanite generated Dynamic Worker code for machine-originated GitHub webhook, schedule, or routing logic. Trigger handlers emit owner-only dispatch or noop intents to the installation manager; they do not own GitHub writes, Nanite lifecycle authority, or Nanite topology.

Active Nanite execution should route through Think sub-agents with Workspace-backed file work, because the product surface is the Nanite agent chat and final GitHub outcome rather than a detailed backend phase machine.

The intended long-term shape is:

- **Installation manager** owns the GitHub installation boundary, Nanite registry, event dispatch, and policy
- **Nanite Think sub-agents** own the runtime narrative, transcript, Think memory, Runs, and change proposal pointer
- **Generated trigger handlers** own arbitrary event routing logic only
- **Workspace** owns durable file inspection and edits
- **GitHub CI** owns command reproduction, build, typecheck, and test truth

GitHub feedback should be bounded and deterministic: dispatch the Nanite, point reviewers at the live Nanite chat, and publish only the native GitHub surface that fits the run outcome.

## Engineering posture

Nanites are pre-production, and the old runtime was never released. Prefer deletion and direct use
of platform primitives over compatibility shims, mirrored schemas, or speculative harness code.

Use these rules when changing Nanites:

- **Use Cloudflare primitives directly.** Reach for Agents SDK state, Think turns, Workspace,
  Dynamic Workers, Durable Object facets, Wrangler, and Cloudflare MCP before inventing Sigvelo
  wrappers. Add a wrapper only when it owns policy, auth, lifecycle, retries, or cleanup.
- **Use Octokit at GitHub boundaries.** Constrain GitHub event names, permission names, check
  statuses, deployment states, and request payloads with Octokit types and `satisfies`. Keep
  GitHub-owned data in Octokit/webhook shapes until a concrete non-GitHub boundary requires a
  projection. Do not create Sigvelo DTOs that rename, subset, or normalize standard GitHub facts.
- **Validate untrusted boundaries, then trust internal owners.** Validate MCP `create_nanite`
  inputs, generated Nanite lifecycle tool calls, GitHub webhooks, external API responses, and browser
  route/search input. Do not make the manager re-parse state it owns, mirror TypeScript types with
  Zod, add `schemaVersion` fields before a migration exists, or accept caller-supplied timestamps
  and ids for manager-owned events.
- **Model permission boundaries, not tool micromanagement.** A permission spec should describe
  scoped GitHub repositories, GitHub App grants, Cloudflare resources, and network policy. Do not ask
  the authoring model for MCP tiers or tool allowlists; derive runtime tool inventory from the
  granted permissions.
- **Keep the work model small.** A Run is `running`, `waiting_for_human`, `complete`,
  `no_change`, `fail`, or `canceled`. The Think transcript is the detailed execution record.
  Manager state is a lookup and summary index, not a phase machine.
- **Let e2e tests earn modules.** Do not add `runtime.ts`, `github.ts`, `testing.ts`, packages, or
  builders because the plan names them. Add them when a failing e2e test needs a real owner.
- **Keep Nanites e2e no-mock.** Lower backend/browser lanes may mock external HTTP when they are
  testing a narrower boundary. Nanites e2e should not. Use real Worker/Agent boundaries, real signed
  GitHub webhooks, real Durable Object state, real GitHub test resources when GitHub output is asserted,
  and real browser journeys when UI is under test. The only allowed substitution is an explicit
  deterministic LLM provider shim, currently the CopilotKit LLM mock if model output must be
  controlled.
- **Do not recreate prototype contracts.** The old shared contracts package has been removed. New
  manager UI should use Agents SDK typed RPC, manager state, and Nanite sub-agent chat directly.

## Runtime Shape

### Installation manager

The installation manager is the top-level Durable Object agent for a GitHub installation:

```text
/agents/nanite-manager/installation:{githubInstallationId}
```

It should own:

- GitHub installation auth and capability issuance
- GitHub webhook intake
- generated trigger handler registration
- Nanite creation, deletion, pause, and lookup
- dispatch limits
- aggregate UI state
- GitHub feedback policy

It should not own the live transcript for each Nanite. The manager can index summaries, pointers, and lossy runtime projections for roster UI, but the Nanite sub-agent is the runtime owner.

### Nanite Think sub-agents

Nanites should be stable Think sub-agents under the installation manager:

```text
/agents/nanite-manager/installation:{githubInstallationId}/sub/nanite-agent/{naniteName}
```

The browser should connect directly to this address with `useAgent({ sub: [...] })` and `useAgentChat`.

A Nanite should own:

- durable purpose, scope, stop conditions, and Think memory
- live token streaming
- transcript and current Run
- workspace-backed repo inspection and edits
- MCP and skill attachments
- change proposal pointer
- lifecycle tools such as `complete`, `no_change`, `fail`, and `ask_human`
- child Nanite proposals when a vertical should split

Do not use a custom `/live` tunnel for new UI paths. The SDK sub-agent route is the canonical live route.

### Generated inbound trigger handlers

Use Dynamic Workers for generated trigger logic, not for the Nanite runtime class by default.

Machine-originated Nanite event sources use generated inbound trigger source. Generated trigger handlers are useful when event handling needs arbitrary code:

- GitHub webhook payload predicates
- cross-repo routing
- weather, time, calendar, or business-rule predicates
- source-to-target mapping
- debouncing and dedupe

Generated trigger handlers should return stable intents:

```text
dispatch_self
record_noop
```

The installation manager validates and executes those intents. Trigger handlers should not directly receive raw GitHub write tokens, dispatch other Nanites, or bypass manager policy.

The Nanite manifest `eventSource` is a coarse candidate filter only. For GitHub webhooks, it should be
enough to avoid offering every event to every Nanite at large installation sizes, but it should not
become the behavior language. Use it for cheap facts such as event family, repository, and optional
action/branch shape. Use root `triggerSource` TypeScript for the real decision.

Schedules should follow the Cloudflare Agent scheduling primitive rather than installation-wide
dispatch logic. The Agents SDK persists schedules in SQLite and wakes the Durable Object with alarms.
Sub-agent/facet schedules delegate the physical alarm to the root owner, and deleting the sub-agent
cancels its schedule prefix. That means a scheduled Nanite should have a first-party Agent schedule
owned by the Nanite sub-agent. The manager validates the schedule and asks the Nanite to install or
update it, but the schedule row belongs to the sub-agent path. The callback wakes exactly that
Nanite's trigger path, normalizes the tick into a machine event, then runs the Nanite's generated
TypeScript trigger. It should not scan every Nanite on each tick.
Use Cloudflare Agent schedule language directly. `eventSource.type` should be `schedule` for
`schedule(when, callback, payload)` or `scheduleEvery` for
`scheduleEvery(intervalSeconds, callback, payload)`:

```ts
type NaniteScheduledEventSource =
  | { type: "schedule"; when: string | number }
  | { type: "scheduleEvery"; intervalSeconds: number };
```

For `schedule.when`, use a number for delayed seconds, a cron string for recurring schedules, or an
ISO date string when the runtime should call `schedule(new Date(...))`.

In the MCP trigger acceptance loop, generated TypeScript compile/runtime failures are trigger
diagnostics, not Nanite Run Outcomes. The tool should return the diagnostic directly to the
authoring model unless the Nanite was actually dispatched.

Human prompts bypass generated trigger code. Chat messages, "run now" actions, and MCP manual run prompts go directly to the stable Nanite Think sub-agent. Trigger handlers are for machine-originated inbound signals only.

#### GitHub-first trigger contract

For the GitHub-first product, generated trigger handlers should be plain Worker-compatible
TypeScript that receives the webhook payload and a manager intent API.

Prefer the virtual `@sigvelo/nanite-trigger` authoring package over local ad hoc types. It exposes
Octokit-backed webhook payload types, Octokit REST method type references, and the small runtime
manager intent API:

```ts
type TriggerContext = {
  dispatchSelf(payload: TriggerDispatchInput): TriggerIntent;
  noop(reason: string): TriggerIntent;
  record(message: string, data?: unknown): TriggerIntent;
};
```

Generated trigger validation currently catches static, bundle, load, and runtime contract errors
before accepting the dynamic Worker. Deep Octokit semantic diagnostics may be skipped until a
dedicated validation Worker owns that typecheck path outside the manager Durable Object.
The trigger runtime does not currently receive a live Octokit client; GitHub read/write authority
belongs to the Nanite Think agent through its explicit tools and to the manager through validated
lifecycle and result-surface operations.

Example push trigger:

```ts
import { defineGitHubTrigger } from "@sigvelo/nanite-trigger";

export default defineGitHubTrigger({
  event: "push",
  async handle(event, ctx) {
    if (event.payload.repository.full_name !== "WebMCP-org/npm-packages") {
      return ctx.noop("Different repository");
    }

    const changed = event.payload.commits.flatMap((commit) => [
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? []),
    ]);
    const relevantFiles = changed.filter((file) => file.startsWith("packages/react-webmcp/"));

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
});
```

The generated-code authoring skill should instruct coding agents to fetch or inspect Octokit source locally with `opensrc` when needed, rely on Octokit types instead of inventing GitHub wrappers, and return manager intents instead of mutating Nanite state directly.

Worker Loader should provide a pre-bundled Octokit runtime so generated handlers do not need to manage dependency installation.

## Runtime split

### Workspace

`Workspace` is the default execution plane for active Nanite work.

It should handle:

- small, medium, and large repositories when upstream Workspace can hydrate them reliably
- file reads, writes, search, and diffs
- git-backed edits inside the durable virtual filesystem
- prompt-driven investigation that does not need real processes
- GitHub CI and check-log interpretation

Workspace reliability is a product requirement because it keeps the default Nanite path fast, cheap, and easy to reason about.

The current recommended direction is:

- use Think sub-agents for the durable Nanite runtime
- use Workspace for file work and code intelligence
- attach constrained MCP servers, including GitHub MCP, as Nanite capability rather than adding
  manager-owned API harnesses
- use GitHub CI as the default source of lint, typecheck, and test truth
- keep stable completion boundaries for final success, failure, and no-change outcomes

This keeps Sigvelo on the code-intelligence layer and avoids carrying a container runtime as a default product dependency.

### GitHub MCP capability

GitHub MCP should be assigned per Nanite, not enabled globally.

The manager should derive an effective GitHub capability assignment from the Nanite's repositories,
requested GitHub App permissions, and runtime policy. The model creating the Nanite should not choose
an MCP tier or individual MCP tools.

Use GitHub App installation tokens, not classic PATs. Installation tokens can be downscoped to the
Nanite's repositories and app permissions. The official GitHub MCP server accepts app tokens, but it
does not automatically hide tools based on app-token permissions, so Sigvelo must provide an explicit
`X-MCP-Tools`/`X-MCP-Exclude-Tools` inventory.

Default guidance:

- use Workspace git tools for branch, commit, push, and diff work
- use GitHub MCP for pull request search, pull request creation/update, and status/check reads
- do not expose merge, file-write, repository-create, or workflow-run tools by default
- let Nanites create stacked PRs through prompt guidance and GitHub tools instead of reintroducing a
  manager-owned support lane

See
[references/github-mcp-capability-assignment.md](/docs/architecture/references/github-mcp-capability-assignment.md)
for the source-backed capability model.

## Routing policy

### Phase 1

Route active GitHub-triggered work to the Nanite Think sub-agent and its Workspace.

When the run has a GitHub feedback surface, the manager should point it at the live Nanite sub-agent chat. Intermediate runtime detail belongs in the transcript, not in GitHub phase copy.

### Phase 2

Add explicit repo-shape handling before a Nanite attempts work that is likely to exceed Workspace limits.

Installation repository data now stays Octokit-shaped. [src/backend/github/index.ts](/src/backend/github/index.ts)
returns the full GitHub installation repository objects, and
[src/backend/db/schema.ts](/src/backend/db/schema.ts) persists the full repository
JSON alongside relational indexes. Future routing should read GitHub-owned metadata from those
provider-shaped objects instead of extending a Sigvelo repository DTO.

Add:

- GitHub `repository.size`
- prior workspace hydration failures
- prior hydration duration
- post-hydration file count and byte count
- lightweight preview and deployment signal presence where available

When Workspace is not enough, prefer GitHub-native mechanisms: CI logs, GitHub API tree/blob operations, and pull request checks. Do not reintroduce a container backend as the default fallback.

## Persistence model

Use layered persistence.

1. Durable Nanite transcript and submission state live in Think.
2. Durable file state lives in Workspace.
3. GitHub remains the source of truth for repository history, CI results, checks, and pull requests.

Executor-local conversation state should be treated the same way: rebuildable within a Run, explicit when persisted across waits, and never the primary product artifact.

## Browser verification

Preview verification remains a separate concern from repo execution.

For browser-facing maintenance Nanites, preview verification remains:

1. patch a narrow WebMCP layer
2. publish or refresh a GitHub change proposal from the Nanite workspace
3. inspect GitHub-native evidence such as checks, logs, comments, or deployment links
4. verify one real preview candidate when the repository exposes one

Do not broaden the product into “Sigvelo boots every customer app itself.” The immediate job is a Think/Workspace runtime that can use GitHub-native signals when local process execution would otherwise be tempting.

## Observability requirements

Observability is product surface, not debug exhaust.

Every Nanite Run should make these things legible:

- Think submission status
- hydration or checkout status
- GitHub CI/check status when command execution matters
- preview discovery status
- verification state
- change proposal outcome

GitHub stays thin. Sigvelo carries the full runtime story.

## UX implications

The current repo page in [src/frontend/routes/\_authenticated/repos.$repoId.tsx](/src/frontend/routes/_authenticated/repos.$repoId.tsx:1435) already exposes live state well, but it is still operator-first.

The next product pass should make the primary review surface outcome-first:

- run goal
- current status
- change proposal
- verification state
- preview or environment source
- files touched
- blocker or next required action

The transcript and raw state remain available, but they should not be the first thing a reviewer has to parse.

## Current implementation status

Release baseline:

- old unreleased manager/run prototype code has been removed or quarantined outside the active
  runtime path
- [src/backend/agents/SigveloNaniteManager.ts](/src/backend/agents/SigveloNaniteManager.ts)
  owns the installation manager state machine: registered Nanites, source versions, runs,
  trigger dedupe, human requests, and terminal transitions
- [src/backend/nanites/triggers.ts](/src/backend/nanites/triggers.ts)
  loads per-Nanite generated inbound trigger source through Worker Loader and returns JSON intents
  for the manager to validate
- [src/backend/nanites/github-mcp-capabilities.ts](/src/backend/nanites/github-mcp-capabilities.ts)
  derives Nanite-scoped GitHub MCP capability assignments
- stable Nanite runtime execution goes through Think sub-agents, not generated Think facets
- new live UI routes should use Agents SDK sub-agent routing, not a custom `/live` tunnel
- GitHub MCP capability is attached per Nanite and constrained by manager-validated repository,
  permission, and tool inventory

Still missing or incomplete:

- generated trigger handler registration UI and authoring skill examples
- schedule intake through the same generated trigger handler path
- lifecycle tools beyond the current completion, no-change, failure, and human checkpoint tools

## Release hardening target

The current release work should harden the installation-manager/Nanite sub-agent model rather than
introduce another runtime path.

Deliver:

- production smoke coverage for chat-first Nanite surfaces
- production smoke coverage for manual run, generated trigger, and GitHub MCP paths
- GitHub feedback surfaces that consistently point at the live chat instead of narrating internal phases
- final outcome handling for success, failure, no-change, and human checkpoint
- generated trigger handler examples and fixtures for arbitrary event routing
- removal or demotion of stale phase-heavy state from product-facing surfaces

Do not try to solve every future runtime problem in the same pass.

## Source map

### Local product and runtime files

- [docs/architecture/architecture.md](/docs/architecture/architecture.md)
- [docs/architecture/roadmap.md](/docs/architecture/roadmap.md)
- [src/backend/agents/SigveloNaniteManager.ts](/src/backend/agents/SigveloNaniteManager.ts)
- [src/backend/agents/SigveloNaniteAgent.ts](/src/backend/agents/SigveloNaniteAgent.ts)
- [src/backend/nanites/triggers.ts](/src/backend/nanites/triggers.ts)
- [src/backend/nanites/github-mcp-capabilities.ts](/src/backend/nanites/github-mcp-capabilities.ts)
- [src/backend/github/index.ts](/src/backend/github/index.ts)
- [src/backend/db/schema.ts](/src/backend/db/schema.ts)
- [src/frontend/routes/\_authenticated/nanites/route.tsx](/src/frontend/routes/_authenticated/nanites/route.tsx)

### Sibling working repos

`../char-ai-saas` gives the best current reference for control-plane versus client-execution boundaries:

- `../char-ai-saas/apps/char-ai-saas/worker/chat/thread-manager.ts`
- `../char-ai-saas/apps/char-ai-saas/worker/chat/thread-agent/chat-orchestrator.ts`
- `../char-ai-saas/apps/char-ai-saas/src/embed/agent/hooks/useThreadRuntime.tsx`
- `../char-ai-saas/packages/shared-types/src/agent-contracts.ts`

`../npm-packages` gives the best current reference for browser-side WebMCP instrumentation and verification:

- `../npm-packages/packages/webmcp-polyfill/src/index.ts`
- `../npm-packages/packages/webmcp-ts-sdk/src/browser-server.ts`
- `../npm-packages/packages/react-webmcp/src/useWebMCP.ts`
- `../npm-packages/packages/webmcp-local-relay/src/bridgeServer.ts`
- `../npm-packages/packages/webmcp-local-relay/src/browser/widgetRuntime.ts`
- `../npm-packages/packages/codemode/src/webmcp.ts`
- `../npm-packages/packages/chrome-devtools-mcp/src/tools/webmcp.ts`

### Local first-party source mirrors

- [opensrc/repos/github.com/cloudflare/agents/docs/workspace.md](/opensrc/repos/github.com/cloudflare/agents/docs/workspace.md)
- [opensrc/repos/github.com/cloudflare/agents/docs/codemode.md](/opensrc/repos/github.com/cloudflare/agents/docs/codemode.md)
- [opensrc/repos/github.com/cloudflare/agents/packages/shell/src/git/index.ts](/opensrc/repos/github.com/cloudflare/agents/packages/shell/src/git/index.ts)

## Other needed inputs

Before Sprint 2 lands, keep these inputs explicit:

- use GitHub `repository.size` and related metadata from the stored Octokit repository object
  instead of routing from incomplete local DTOs
- decide the default WebMCP patch lane per target repo:
  CDN `@mcp-b/global`,
  package install,
  `@mcp-b/react-webmcp`,
  or relay/testing-only
- keep runtime-owned terminal actions stable even if the executor changes:
  publish,
  verify,
  complete,
  fail
- refresh `opensrc/` or sibling repo references when the relevant upstream API moves, but do not auto-pull dirty sibling worktrees
