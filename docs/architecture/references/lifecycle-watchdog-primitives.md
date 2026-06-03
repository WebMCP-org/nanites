# Nanite lifecycle watchdog primitives

This note records the current recommendation for detecting a Nanite run that appears stuck before it reaches a lifecycle outcome.

## Recommendation

Use a small watchdog built from Cloudflare Agents scheduling and Think stability checks.

- Use `this.schedule()` for a resettable one-shot watchdog timer on the Nanite agent.
- Reset that timer when the Nanite records meaningful activity.
- When the watchdog fires, call Think `waitUntilStable()` before submitting any continuation message.
- Submit a lifecycle continuation only when Think is stable, the run is still active, and no lifecycle tool has completed.
- If a lifecycle continuation has already been attempted, fail closed or ask for human help instead of looping.

Do not use a mid-turn reminder as the default. It can interrupt a model that is still making progress.

Do not use raw Durable Object alarms directly in the Nanite agent. The Agents SDK already multiplexes schedules, keepalive, fibers, and sub-agent recovery through the physical DO alarm.

## Why this shape

There are two separate failure modes:

| Failure mode                   | Signal                                                                                 | Response                                  |
| ------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| Turn stopped without lifecycle | Think emits `onChatResponse({ status: "completed" })`, then terminal submission status | Submit one lifecycle continuation         |
| Run appears stuck              | Active run has no useful activity for a timeout window                                 | Watchdog inspects stability before acting |

The first case is deterministic. Think has told us the model turn ended.

The second case is observational. Silence can mean a long model response, a slow tool call, provider delay, DO scheduling, or a real hang. The watchdog should inspect before nudging.

## First-party sources

### Cloudflare Agents scheduled tasks

Docs: https://developers.cloudflare.com/agents/api-reference/schedule-tasks/

Relevant behavior:

- `schedule()` supports delayed one-shot callbacks.
- `scheduleEvery()` supports intervals.
- Scheduled tasks are persisted in the Agent's SQLite storage and executed through Durable Object alarms.
- Delayed schedules can be made idempotent with `options.idempotent`.

Local source:

- `/tmp/cloudflare-agents-review/packages/agents/src/index.ts`
  - `schedule()` around `Agent.prototype.schedule`
  - `scheduleEvery()` around `Agent.prototype.scheduleEvery`
  - `alarm()` around `Agent.prototype.alarm`
- `/tmp/cloudflare-agents-review/packages/agents/src/tests/schedule.test.ts`

Use `schedule()` for the Nanite watchdog because the desired behavior is "run N minutes after the last activity", not "wake every N minutes forever".

### Cloudflare Durable Object alarms

Docs:

- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/

Relevant behavior:

- Each Durable Object has one physical alarm.
- Alarms are at-least-once and retried on handler failure.
- Alarms do not repeat automatically. The handler must schedule the next alarm.
- Cloudflare recommends scheduling alarms only when there is work to do.

Local source:

- `/tmp/cloudflare-agents-review/packages/agents/src/index.ts`
  - Agents SDK multiplexes scheduled rows, keepalive, facet routing, and recovery checks through its alarm handling.

Do not bypass the Agents scheduler for this feature unless the SDK cannot express the needed behavior.

### Cloudflare Agents durable execution

Docs: https://developers.cloudflare.com/agents/api-reference/durable-execution/

Relevant behavior:

- `keepAlive()` prevents idle eviction with a 30-second alarm heartbeat.
- `keepAliveWhile()` is the recommended wrapper for active async work.
- `runFiber()` and `startFiber()` are for work that needs recovery across Durable Object eviction.

Local source:

- `/tmp/cloudflare-agents-review/packages/agents/src/index.ts`
  - `keepAlive()` around `Agent.prototype.keepAlive`
  - `keepAliveWhile()` around `Agent.prototype.keepAliveWhile`
  - managed fiber code around `runFiber()` and `startFiber()`

This is not the first primitive to reach for. Think already wraps programmatic submissions with keepalive. The watchdog is not itself long-running work; it is a scheduled inspection point.

### Cloudflare Think stability detection

Docs: https://developers.cloudflare.com/agents/api-reference/think/

Relevant behavior:

- `hasPendingInteraction()` returns whether an assistant message has pending tool calls, pending approvals, or missing tool results.
- `waitUntilStable({ timeout })` waits until there are no pending tool results, no pending approvals, and no active turns.
- Cloudflare's server-driven message guidance says to call `waitUntilStable()` before `saveMessages()` from scheduled callbacks, webhooks, email handlers, or other non-chat entry points.

Local source:

- `/tmp/cloudflare-agents-review/packages/think/src/think.ts`
  - `hasPendingInteraction()` near the stability section
  - `waitUntilStable()` near the stability section
  - `submitMessages()` and `_drainSubmissions()` in the programmatic submission path

This is the key guard. The watchdog should not submit a continuation while Think is still active.

### Think programmatic submissions

Docs:

- https://developers.cloudflare.com/agents/api-reference/think/
- https://developers.cloudflare.com/agents/guides/autonomous-responses/

Local source:

- `/tmp/cloudflare-agents-review/packages/think/src/think.ts`
  - `submitMessages()`
  - `_scheduleSubmissionDrain()`
  - `_startSubmissionDrain()`
  - `_runSubmission()`

Programmatic submissions are the current available primitive for "one follow-up turn after the model stops". The proposed Think chained-continuation RFC would be cleaner later because it can hide synthetic continuation prompts from persisted user-visible transcript history.

### Sub-agent scheduling behavior

Docs: https://developers.cloudflare.com/agents/api-reference/sub-agents/

Relevant behavior:

- `schedule()` and `scheduleEvery()` work inside sub-agents.
- The top-level parent owns the physical alarm, but the callback runs with the sub-agent as `this`.
- `keepAlive()` and `keepAliveWhile()` delegate heartbeat ownership to the top-level parent for sub-agents.

Local source:

- `/tmp/cloudflare-agents-review/docs/sub-agents.md`
- `/tmp/cloudflare-agents-review/packages/agents/src/index.ts`
  - facet schedule delegation around `_cf_scheduleForFacet`
  - facet keepalive delegation around `_cf_acquireFacetKeepAlive`

This matters if Nanites remain modeled as child agents under a manager. The Nanite agent can own the logical watchdog even though the parent owns the physical alarm.

## Sigvelo code links

Nanite agent runtime:

- `src/backend/nanites/agent.ts`
  - `beforeTurn()` sets model, tools, max steps, and lifecycle `stopWhen`.
  - `onStepFinish()` records the last step diagnostic.
  - `onChatResponse()` observes completed Think responses.
  - `onSubmissionStatus()` owns the final fallback when a Think submission ends without a lifecycle tool.
  - lifecycle tools are `complete`, `no_change`, `fail`, and `ask_human`.

Nanite manager and run state:

- `src/backend/nanites/host.ts`
  - `NaniteRunStatus`
  - run transition rules
  - `recordRunCompletion()`
  - `recordUnreportedRunCompletion()`
  - runtime activity recording

Current tests:

- `tests/backend/nanite-debug-transcript.test.ts`
- `tests/e2e` currently owns the future full-flow lane config and guidance.

## Proposed implementation

Add a small watchdog around active Nanite runs.

### State

Prefer one persisted object on the Nanite agent state:

```ts
type NaniteLifecycleWatchdog = {
  runId: string;
  lastActivityAt: string;
  continuationAttempted: boolean;
  scheduleId: string | null;
};
```

Keep it small. Do not add a transcript parser or failure classifier.

### Activity points

Refresh `lastActivityAt` and reschedule the watchdog when any of these happen:

- run accepted
- turn started
- step finished
- tool call started
- tool call finished
- chat response completed, errored, or aborted
- lifecycle tool accepted

The timeout should start conservative. Three minutes is a reasonable first value for production observation.

### Watchdog callback

The scheduled callback should:

1. Read the active run.
2. Return if the run is missing or terminal.
3. Return if `lastActivityAt` changed after this watchdog was scheduled.
4. Call `waitUntilStable({ timeout: 1_000 })`.
5. If unstable, reschedule the watchdog and record runtime activity only if useful.
6. If stable and no lifecycle continuation has been attempted, submit one lifecycle continuation.
7. If stable and a lifecycle continuation has already been attempted, fail closed with a clear summary.

The continuation prompt should be direct:

```text
You stopped without reporting the Nanite run outcome.
Use the transcript evidence already available and call exactly one lifecycle tool now: complete, no_change, fail, or ask_human.
Do not investigate further unless a lifecycle tool requires the final summary or human request details.
```

### Schedule mechanics

Use a one-shot delayed schedule:

```ts
await this.schedule(180, "checkLifecycleWatchdog", { runId, lastActivityAt });
```

When activity happens, cancel the previous schedule if a schedule id is known, then create a new one. If cancellation fails because the schedule already fired, the callback still checks `lastActivityAt` and exits.

Do not rely on delayed-schedule idempotency for timer reset semantics. Delayed schedules dedupe by callback and payload, so the reset behavior should come from canceling the previous schedule and writing the latest `lastActivityAt` into both state and callback payload.

Do not use `scheduleEvery()` unless the resettable one-shot version proves too awkward.

### Relationship to the current PR

The current PR handles the deterministic stopped-turn case:

- Think response completes.
- No lifecycle tool is present.
- Submit one lifecycle continuation.
- If that still omits lifecycle, fail closed.

The watchdog should be a follow-up only if production shows active runs that never reach `onChatResponse()` or terminal submission status. It should share the same continuation path instead of introducing a second prompt shape.

## Non-goals

- Do not reintroduce a step-count reminder.
- Do not inject prompts while `waitUntilStable()` says Think is still active.
- Do not parse the full transcript to classify failures.
- Do not use raw DO alarms unless Agents scheduling cannot satisfy the need.
- Do not add an indefinite nudge loop.
- Do not lower `naniteMaxSteps` as part of this watchdog.

## Open questions

- Should the watchdog timeout be 3 minutes, 5 minutes, or manager-configurable?
- Should the first stale active-turn event only record runtime activity, with continuation reserved for the second stale check?
- Should stale tool execution get separate treatment through tool-level timeouts rather than lifecycle continuation?
- Should `ask_human` be preferred over `fail` when the watchdog fires after a lifecycle continuation was already attempted?
