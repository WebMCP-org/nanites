# Durable Object clean-slate rewrite — how to run the next one

Record of the `NanitesSetupAgent` rewrite (June 2026, 2,756 → ~1,500 lines) and a short
process for doing the same to another Durable Object. The _design_ findings below are
specific to the setup agent — the other DOs do different jobs and will have different
debt. The process and the platform facts are the reusable part.

## Kickoff: what the agent actually needs from you

1. **Empty (or delete) the target file first.** Agents drift toward patch-Edits when
   the old file is on disk — its structure acts as an attractor and each small edit
   looks like progress. An empty file makes that impossible and forces the one-shot
   rewrite. Git keeps the old version; the agent should consult it as _reference
   material_ via `git show HEAD:<path>`, never as the thing being modified. (Pasting
   the old contents into the chat is the part that's unnecessary — it duplicates what
   git already has.)
2. **State the clean-slate mandate explicitly.** "Rewrite X from scratch as if nothing
   else exists; all contracts are negotiable; update every consumer (routes, React,
   tests) to the new design." Without this, an agent will dutifully preserve the
   accidental API surface — which _is_ the debt.
3. **List any behavior you already know you want changed or dropped.** (For the setup
   agent, nothing was specified, so judgment calls — e.g. dropping the setup-owner
   token — were made and flagged for veto.)

A sufficient kickoff is roughly:

> I emptied `src/backend/agents/<Name>.ts` (old version is in git). Rewrite it from
> scratch — clean, minimal, no tech debt. Don't preserve existing contracts; update all
> consumers and tests to the new design. Behavior changes I want: …

## Process that worked

1. **Map consumers before designing.** Grep for the class name and every export. The
   consumer list separates load-bearing exports from internal ceremony that leaked out.
2. **List the jobs, not the mechanisms.** Write down what the DO must actually
   accomplish; treat every token system, state machine, and migration as negotiable.
3. **Hunt for duplicated first-party logic before designing replacements.** The biggest
   cleanup wins are usually code that re-implements something the `Agent` base class
   already ships. Walk the checklist in "First-party source map" below against the old
   file's helpers before deciding what the new file needs to contain at all.
4. **Verify SDK call shapes against real source, not memory.** This rewrite read
   `node_modules/agents/dist/*.d.ts`. Better: the full SDK source is vendored under
   `opensrc/` — read that for actual behavior (e.g. what `removeMcpServer` cleans up),
   not just types.
5. **One-shot write, then consumers, then tests.** Incremental edits to a churned file
   preserve its accidental structure.
6. **Flag judgment calls for veto** in the summary (dropped guards, changed timeouts,
   removed error kinds) rather than asking about each one mid-flight.

## First-party source map (`opensrc/`)

Full vendored sources for the stack live under `opensrc/repos/github.com/...`
(`opensrc/sources.json` lists packages, but its per-version paths are stale — the
agents repo is checked out at `agents/main`). Caveat: `main` is ahead of the installed
package; before relying on a feature, confirm it exists in
`node_modules/agents/dist/*.d.ts` (all of the built-ins listed below exist in the
installed `agents@0.14.5`).

Agents SDK repo root: `opensrc/repos/github.com/cloudflare/agents/main/`

| What                                             | Where (relative to repo root)                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Agent` base class (the whole thing, ~11k lines) | `packages/agents/src/index.ts`                                                                                                                                                                                                                                           |
| MCP client manager, OAuth provider, transports   | `packages/agents/src/mcp/` (`client.ts`, `do-oauth-client-provider.ts`)                                                                                                                                                                                                  |
| Scheduling internals                             | `packages/agents/src/schedule.ts`                                                                                                                                                                                                                                        |
| Retry internals                                  | `packages/agents/src/retries.ts`                                                                                                                                                                                                                                         |
| React hooks (`useAgent`) / browser client        | `packages/agents/src/react.tsx`, `client.ts`                                                                                                                                                                                                                             |
| Prose docs (one per feature)                     | `docs/*.md` — `state.md`, `scheduling.md`, `queue.md`, `retries.md`, `durable-execution.md`, `long-running-agents.md`, `callable-methods.md`, `sub-agents.md`, `readonly-connections.md`, `server-driven-messages.md`, `routing.md`, `mcp-client.md`, `observability.md` |
| Runnable 1p examples                             | `examples/` — `github-webhook`, `dynamic-workers`, `mcp-client`, `auth-agent`, `email-agent`, `push-notifications`, `playground`                                                                                                                                         |

Also vendored and useful: `cloudflare/workers-oauth-provider`, `cloudflare/workerd`
(runtime types), `workers-sdk` (wrangler, vitest-pool-workers — test harness questions),
`octokit/auth-app.js`, `octokit/webhooks.js`, `honojs/hono`,
`modelcontextprotocol/typescript-sdk`.

### Don't re-implement: `Agent` built-ins checklist

Before keeping (or writing) a helper, check whether the old code hand-rolled one of
these. This is historically the biggest source of deletable code:

- **Retry with backoff + jitter** → `this.retry(fn, options)` (`docs/retries.md`).
  Schedules, queues, and workflows also retry automatically via a `retry` option.
- **FIFO background work / "process later" tables** → `this.queue(callback, payload)`,
  `dequeue`, `dequeueAll`, `getQueue` (`docs/queue.md` — SQLite-backed, automatic).
- **Delayed / recurring work, hand-rolled alarms** → `this.schedule(when, cb, payload,
{ idempotent })`, `this.scheduleEvery`, `getSchedules`, `cancelSchedule`
  (`docs/scheduling.md`). Don't touch `onAlarm`/`alarm()` directly.
- **Long tasks that must survive DO eviction** → fibers: `runFiber`/`startFiber` +
  `stash()` checkpoints + `onFiberRecovered()` (`docs/durable-execution.md`,
  `docs/long-running-agents.md`).
- **Keeping the DO alive during external waits** → `keepAlive()` /
  `keepAliveWhile(fn)`.
- **Parent/child agent plumbing** → `subAgent()` / `parentAgent()`
  (`docs/sub-agents.md`).
- **Pushing state/messages to connected browsers** → `this.setState` (auto-broadcast)
  and `this.broadcast()` (`docs/state.md`, `docs/server-driven-messages.md`); per-client
  guards via `setConnectionReadonly` (`docs/readonly-connections.md`).
- **Raw SQLite access** → `this.sql` tagged template (`docs/state.md`).
- **Email send/reply** → `sendEmail` / `replyToEmail` (`docs/email.md`).

### Think / chat stack (what the Sigvelo DOs are built on)

`SigveloNaniteAgent` and `SigveloManagerConversationAgent` import `@cloudflare/think`
(`Think`, `Session`, `Workspace`, submissions, workspace/execute tools);
`SigveloChatIngress` builds on `agents/chat-sdk`; the frontend uses
`@cloudflare/ai-chat/react`. All of that is vendored in the same repo:

| What                                                                                                           | Where (relative to `…/cloudflare/agents/main/`)                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Think` agent class — turn lifecycle, submissions, `defineScheduledTasks` (~10.8k lines)                       | `packages/think/src/think.ts`                                                                                                                        |
| Think tools: workspace, execute, sandbox, browser, extensions                                                  | `packages/think/src/tools/`                                                                                                                          |
| Host bridge / extensions (`HostBridgeLoopback`)                                                                | `packages/think/src/extensions/` (`host-bridge.ts`, `manager.ts`)                                                                                    |
| Messengers — Think owns the webhook route + durable reply fiber (chat-sdk, telegram, delivery)                 | `packages/think/src/messengers/`                                                                                                                     |
| Think framework (file-based agent discovery, codegen)                                                          | `packages/think/src/framework/`                                                                                                                      |
| Think prose docs                                                                                               | `docs/think/` — `lifecycle-hooks.md`, `programmatic-submissions.md`, `messengers.md`, `sub-agents.md`, `tools.md`, `client-tools.md`, `workflows.md` |
| Think starters (complete apps; `coding-agent` is closest to Sigvelo's domain)                                  | `think-starters/` — `basic`, `coding-agent` (see `agents/coder/` + `skills/`), `customer-support`, `personal-assistant`                              |
| Think examples                                                                                                 | `examples/think-chat-sdk`, `think-submissions`, `think-workflows`, `think-react-router`, `think-tanstack-start`                                      |
| Chat SDK state adapter (`ChatSdkStateAgent` — subscriptions, locks, queues, dedupe, thread state in DO SQLite) | `packages/agents/src/chat-sdk/` + `docs/chat-sdk.md`                                                                                                 |
| Chat turn internals (resumable streams, message reconciler, recovery, submit concurrency)                      | `packages/agents/src/chat/`                                                                                                                          |
| `useAgentChat` + chat React helpers                                                                            | `packages/ai-chat/src/react.tsx`                                                                                                                     |
| `Workspace` implementation (filesystem, git, memory)                                                           | `packages/shell/src/`                                                                                                                                |

Think-specific check-before-hand-rolling list (mirrors the `Agent` checklist above):

- **Hooking into the chat turn** → Think owns `streamText` and fires lifecycle hooks on
  every entry path (`docs/think/lifecycle-hooks.md`) — don't wrap or fork the turn loop
  to inject behavior.
- **"Start a turn durably, return fast, poll the result"** → `submitMessages()` /
  submission statuses (`docs/think/programmatic-submissions.md`) — likely overlaps with
  any hand-rolled run-acceptance machinery.
- **Receiving webhooks and replying on the same channel** → messengers
  (`docs/think/messengers.md`) — Think can own the webhook route, durable reply fiber,
  and conversation routing.
- **Scheduled agent behavior** → `defineScheduledTasks` in `think.ts` rather than raw
  `this.schedule` for Think agents.

## What the setup-agent rewrite specifically changed (for reference, not reuse)

- Two overlapping auth tokens → one setup-claim cookie issued on Cloudflare ownership
  proof.
- `@callable` WebSocket methods + per-connection claim sync → plain HTTP routes that
  read the cookie and call ordinary RPC methods; `useAgent` kept only for state sync.
- A "generation key" state machine mirroring D1 → derive GitHub App / repository status
  from the D1 row on every `refresh()`.
- Server-stored wizard navigation (`currentStepOverride`) → client `useState`.
- Deleted: legacy state normalizers, a readiness "check" that was static UI copy, the
  always-complete `deploy` step, error-message string matching at the RPC boundary.

## What the nanite manager + agent rewrite specifically changed (for reference, not reuse)

June 2026, `SigveloNaniteManager` + `SigveloNaniteAgent` rewritten together (they share
contracts). Tests needed almost no changes because the load-bearing exports (state
types, status enums, MCP-tool method shapes) were deliberately kept.

- `setStateWithoutProtocolBroadcast` poked a private (`_suppressProtocolBroadcasts`)
  that does not exist in the installed `agents` dist — the whole hack was a silent
  no-op. Deleted; plain `setState`.
- Trigger tests ran the generated trigger twice (once standalone for noop reasons, once
  via the webhook path). Fixed by making the production path (`handleGitHubWebhook`)
  return a per-nanite evaluation report (intents, noop reasons, skip reason,
  dispatches) that the test path consumes.
- Watchdog cancel/re-create of an alarm on every tool call → one alarm that re-arms
  from its own callback and compares a `lastActivityAt` state field.
- In-memory `Set` tracking "completed responses without a lifecycle tool call" →
  derive it durably: when a submission terminalizes and the manager still shows the
  run as `running`, no lifecycle tool fired.
- Manager/agent chat-message types moved to `SigveloChatIngress.ts` (the manager's
  `handleChatMessage` had no callers — chat routes through
  `SigveloManagerConversationAgent`).
- Dead exports dropped: `resumeRun`, `failRun`, `listFiles`/`readFileContent`
  callables, `chatUrl` + `versionId` run fields, `HandleManagerChatMessageOutput`.
- State-versioning split: the manager registry is the source of truth → keep persisted
  field names, no destructive reset; the agent state is run-scoped bookkeeping → a
  `version` stamp with reset-on-mismatch in `onStart()`.

## Platform facts verified during this rewrite (reusable)

- **DO RPC strips error classes.** An `AppError` thrown in the DO arrives at the caller
  as a bare `Error`. For methods called over RPC, return
  `{ ok: true } | { ok: false, errorKind }` unions and rebuild typed errors route-side.
- **Persisted DO state survives deploys.** Reshaping the state type means new code reads
  old-shape JSON. A `version` field checked in `onStart()` (reset, or migrate if the DO
  state is the source of truth) prevents that.
- **`this.state` is broadcast to every connected WebSocket client.** Nonces, token
  hashes, and one-time secrets belong in `ctx.storage`, validated with zod on read.
- **`addMcpServer(...)` returns a union** — `{ state: "authenticating", authUrl }` or
  `{ state: "ready" }` (persisted OAuth tokens can skip the redirect). Handle both.
- **`configureOAuthCallback({ customHandler })`** types the handler as returning
  `Response` but awaits it, so async handlers work behind a cast.
- **Custom OAuth scopes** = override `createMcpOAuthProvider()` with a
  `DurableObjectOAuthClientProvider` subclass that extends `clientMetadata`.
- **`this.schedule(secs, "method", payload, { idempotent: true })`** dedupes on
  callback + payload — safe to re-arm from a hot path without piling up alarms.
- **Worker secrets written via the Cloudflare API only appear in new isolates**, and a
  DO's `env` is frozen for its lifetime. To observe propagation, fetch your own public
  origin so a fresh isolate evaluates `env`, and let routes pass the result back as a
  hint.
- **`Response.redirect()` has immutable headers** — construct
  `new Response(null, { status: 302, headers: { location } })` to append `Set-Cookie`.
- **The Cloudflare MCP execute sandbox ignores unknown `cloudflare.request` options**;
  content type must go through `contentType`, not `headers`.
- **Grep any private-API poke against the installed dist before carrying it forward.**
  `(agent as unknown)._suppressProtocolBroadcasts` matched nothing in
  `node_modules/agents/dist` — the "feature" had silently become a no-op across SDK
  upgrades.
- **Think's declared scheduled tasks (`getScheduledTasks`/`defineScheduledTasks`) only
  accept interval/wall-clock English schedules** (`every N minutes`, `every day at
HH:MM`) — not cron strings or one-shot dates. Manifest-driven cron/date schedules
  still need raw `this.schedule`/`this.scheduleEvery`.
- **Never re-arm a one-shot date schedule from maintenance** — `schedule(pastDate, ...)`
  fires immediately. Only recurring schedules (cron, intervals) are safe to resync.
- **Concrete DO stubs of large agents trip TS2589** (type instantiation too deep).
  Confine one `as unknown as { method: Class["method"] }` cast to a single private
  accessor instead of scattering `@ts-ignore` at call sites.
