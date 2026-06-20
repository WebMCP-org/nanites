# Nanites roadmap

## Current milestone

The current milestone is release-hardening the installation-scoped Nanite runtime.

The core runtime shape is now:

- one installation manager per GitHub installation
- many stable Think Nanite sub-agents under that manager
- SDK-native sub-agent chat routing for live token streaming
- per-Nanite generated inbound trigger handlers for machine-originated GitHub webhook and schedule logic
- Nanite-scoped GitHub MCP capability for PR, search, and status operations

The next job is to make the release boring: verify production MCP flows, keep the UI truthful, and
remove any remaining stale shapes from docs, tests, or public API surfaces.

## Current product truth

Nanites are installation-scoped durable agents.

They:

- are durable sub-agents under a GitHub installation manager
- own one vertical maintenance responsibility
- receive GitHub events, schedules, manual messages, or generated trigger dispatches
- can reuse one durable change-proposal surface when code changes exist
- stream the live agent chat in SigVelo
- keep GitHub as the clean artifact and feedback surface
- can propose child Nanites when a vertical should split

The user-facing model should stay:

- Installation
- Nanite
- Change Proposal

Run detail remains useful, but it should not force another durable layer before concurrent isolation or retention needs it.

Support PR continuity, backend routing, and recovery behavior remain implementation details behind that model. The Nanite transcript is the primary runtime surface.

Nanite definitions should stay thin:

- scope
- soul
- stop conditions

Capabilities should come primarily from the pulled repo, configured MCP servers, permission-derived
tool inventory, and runtime-owned CLI surfaces rather than an ever-growing SigVelo-authored tool
manifest.

Generated Dynamic Worker code should be used for each Nanite's inbound trigger handler:

- interpret GitHub webhook payloads in their provider shape
- evaluate custom schedule or environment predicates
- decide whether an event should start the owning Nanite
- propose Nanite creation intents

The installation manager validates generated trigger output before dispatching work.

For GitHub trigger handlers, generated code should use the `@sigvelo/nanite-trigger` authoring
facade. SigVelo should provide the Worker Loader runtime wrapper, Octokit-backed webhook/REST types,
and the manager intent API; a live scoped Octokit runtime client is separate authority work.

Human prompts are not trigger events. Manual chats and manual run prompts go directly through the stable Think Nanite.

## Done for the current release

### Runtime

- installation manager owns the GitHub installation boundary and Nanite registry
- stable `NaniteAgent extends Think` sub-agent owns live chat, Think memory, current work, and workspace
- browser connects to Nanites with Agents SDK sub-agent routing
- Workspace is the default active execution path
- GitHub feedback surfaces point at the live Nanite chat
- explicit lifecycle tools report success, failure, no-change, or manager checkpoint
- phase-heavy runtime detail is demoted to transcript, telemetry, and debug tools
- generated Nanite runtime classes are not on the active path

### Trigger and MCP capability

- generated inbound trigger handlers run through Worker Loader
- trigger intent contract covers dispatch and noop
- GitHub webhook normalization happens in stable manager-owned code before generated trigger execution
- generated trigger examples use the typed trigger facade and manager intents
- MCP authoring/debug tools can create, start, test, inspect, cancel, deprovision, and explore Nanites
- GitHub MCP tool inventory is derived per Nanite from validated GitHub App permissions

### Release validation still required

- deploy the exact release diff to production
- create fresh Nanites through production MCP
- run manual, generated-trigger, and GitHub MCP smoke paths
- confirm direct Think transcript streaming in the UI
- verify stale failed/running Nanite cleanup tools still work in production

## Next release work

### Goal

Make generated inbound triggers and GitHub MCP capability feel routine rather than experimental.

### Deliverables

- schedule intake through the same generated trigger handler path
- generated-code authoring guidance for the typed trigger facade, fixtures, and manager intents
- explicit policy for a live Octokit runtime facade in generated Worker Loader handlers
- manager validation and rate limits around trigger output
- GitHub repository metadata from installation repository objects where it affects routing
- hydration telemetry and failure history
- pre-work escalation policy based on repo size, prior behavior, and task needs
- workspace bootstrap that layers SigVelo identity over repo-local `AGENTS.md` / `.codex` / `.agents`
- Nanite-scoped completion boundary for publish, inspect, verify, complete, and fail
- MCP and skill bootstrap as the default capability path

### Non-goals

- no perfect heuristic on day one
- no heavy scoring model for repo selection
- no giant SigVelo-specific agent manifest for Nanite capabilities
- no generated trigger handler with raw GitHub write authority

## Outcome-first product pass

### Goal

Make the product outcome-first instead of operator-first.

### Deliverables

- installation-level Nanite roster with repo/package/doc filters
- repo list signals for suitability and likely backend
- dashboard metrics that reflect real usage and health
- Nanite view that leads with purpose, current status, change proposal, verification, files changed, and next action
- explicit approval and resume checkpoints for risky changes

### Non-goals

- no attempt to move full observability into GitHub
- no comment-heavy review workflows
- no exposing backend mechanics as primary product concepts
- no making support PR lanes the main mental model for understanding a run

## Later work

- more named Nanites that fit the same installation/Nanite/change-proposal model
- stronger installation-level portfolio views
- richer human steering inside live runs
- Nanite-created Nanites with approval, provenance, and inherited/downscoped capability
- optional lighter-weight executors for Nanites that do not need a full coding agent
- generated owner Nanites only after generated trigger handlers have a stable capability and reporting contract

## Explicit non-goals for now

- do not turn SigVelo into a generic PR annotation bot
- do not make GitHub the primary runtime observability surface
- do not generate Nanite runtime classes by default
- do not give generated trigger handlers root lifecycle or GitHub write authority
