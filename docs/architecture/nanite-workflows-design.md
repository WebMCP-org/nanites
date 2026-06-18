# NaniteWorkflows: Feature Design

> Status: future design note. This is not part of the current release baseline or the
> self-hosting path in `docs/self-hosting.md`; it records a possible post-release workflow
> runtime.

## Overview

NaniteWorkflows is a one-shot, fan-out orchestration layer built on top of the existing
Nanite runtime. A workflow runs many ephemeral task agents in parallel, collects their
structured results, and synthesizes a final output — all coordinated by a script the model
writes and the Manager executes.

This document captures the full design rationale, architecture, open questions, and phased
implementation plan. It is intended as the reference spec for a future implementation sprint.

---

## Motivation

The existing Nanite model covers recurring, surface-scoped maintenance well. A persistent
Nanite owns one vertical, responds to events, and keeps memory across runs. That model does
not fit bulk one-time jobs:

- Audit every API route in `src/routes/` for missing auth
- Migrate 200 files from one pattern to another
- Cross-check security findings from three independent angles
- Draft a refactor plan from several independent viewpoints before committing to one

These jobs share a shape: fan out to N workers, collect typed results, synthesize. The
trigger-dispatch-Nanite path is wrong for them — there is no ongoing surface to own, no
reason for the workers to persist, and no event to react to. What is needed is a script that
starts a bunch of agents, waits for them, and handles their output.

The Claude Code dynamic workflows feature solves the same problem in the CLI. The design
below borrows heavily from that model and adapts it to the Cloudflare Workers + Durable
Objects runtime.

---

## Design Principles

These follow directly from the existing `execution-architecture.md` posture:

- **Use Cloudflare primitives directly.** Worker Loader for script execution, subAgent for
  ephemeral task agents, R2 for shared workspace snapshots, alarms for aggregate recovery.
  Add a wrapper only when it owns policy, auth, lifecycle, or cleanup.
- **Workflows are orthogonal to persistent Nanites.** They share infrastructure — Dynamic
  Workers, Think sub-agents, Manager coordination — but execution semantics are completely
  separate. A `workflow_dispatch` intent routes into a new `startWorkflow` path; it never
  touches the existing `startRun` → `dispatchRun` Nanite chain.
- **Structured outputs are the contract.** Every task has a Zod schema. The schema is the
  boundary between task execution and aggregate synthesis. Free-form task results are not
  accepted.
- **Scripts are persistent artifacts.** The script that runs a workflow is stored in R2,
  addressable by `workflowId`. Runs are reproducible. Scripts can be edited and relaunched.
- **Resumability is a first-class guarantee.** Completed task results are cached
  permanently in SQLite. If a run is paused or the DO is evicted, resuming re-dispatches
  only the incomplete tasks.

---

## How It Differs from Persistent Nanites

|                        | Persistent Nanite                | Workflow Task                                   |
| ---------------------- | -------------------------------- | ----------------------------------------------- |
| Lifetime               | Long-lived, survives across runs | Ephemeral, exists for one run                   |
| Identity               | Named surface, owned forever     | Named `wf:{id}:t:{taskId}`                      |
| Trigger                | Event, schedule, manual          | Script-defined fan-out                          |
| Memory                 | Durable Think memory             | None — structured result only                   |
| State after completion | Retained                         | Deleted after result is persisted               |
| Workspace              | Own clone                        | Read-only view of shared snapshot               |
| Tool inventory         | Full capability set              | Declared per-task (`tools: ["workspace:read"]`) |

---

## Architecture

### Layer 1: WorkflowScript (Dynamic Worker)

A workflow script is user-authored TypeScript that runs inside a Worker Loader bundle,
exactly like the existing generated trigger handlers in `triggers.ts`. It exports two
functions: `plan` and `aggregate`.

```typescript
import { z } from "zod"; // pre-bundled with @sigvelo/nanite-workflow
import { defineWorkflow } from "@sigvelo/nanite-workflow";

const AuditFinding = z.object({
  file: z.string(),
  line: z.number(),
  issue: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});

export default defineWorkflow({
  async plan(ctx, args) {
    const routes = await ctx.workspace.glob("src/routes/**/*.ts");
    return [
      ctx.phase(
        "audit",
        routes.map((file) =>
          ctx.task({
            id: `audit:${file}`,
            prompt: `Audit ${file} for missing auth middleware.`,
            outputSchema: AuditFinding, // Zod schema — auto-embeds JSON Schema in prompt
            model: "haiku", // cheap read task
            effort: "low",
            maxTurns: 2,
            tools: ["workspace:read"], // read-only
          }),
        ),
      ),
      ctx.phase(
        "verify",
        ctx.task({
          id: "cross-check",
          prompt: "Challenge the audit findings. Flag any that look incorrect.",
          outputSchema: AuditFinding,
          model: "sonnet",
          effort: "high",
          maxTurns: 4,
        }),
      ),
    ];
  },

  async aggregate(ctx, results: z.infer<typeof AuditFinding>[]) {
    const critical = results.filter((r) => r.severity === "high");
    return { findings: results, critical, total: results.length };
  },
});
```

**Key properties of the script surface:**

- `defineWorkflow` is the only authoring primitive. No raw Worker APIs.
- `z` (Zod) is pre-bundled alongside `@sigvelo/nanite-workflow` in the Worker Loader
  runtime, the same way `@sigvelo/nanite-trigger` is pre-bundled for triggers.
- `plan` receives `ctx` (workspace, args) and returns either a flat `TaskDefinition[]` or a
  `Phase[]` containing tasks.
- `aggregate` receives `ctx` and a typed results array derived from the declared
  `outputSchema`. Full TypeScript inference if the script is authored with `tsc`.
- `args` is the typed payload passed at invocation time (see Saved Workflows below).

---

### Layer 2: WorkflowRunRecord (in Manager DO state)

The Manager owns `WorkflowRunRecord` alongside `NaniteRunRecord`. No new DO class is needed
for the record itself.

```typescript
type WorkflowRunStatus =
  | "planning" // plan() script executing
  | "running" // task agents executing
  | "aggregating" // aggregate() script executing
  | "complete"
  | "fail"
  | "canceled";

type WorkflowRunRecord = {
  workflowId: string;
  installationId: number;
  scriptR2Key: string; // R2 path to the persisted script source
  scriptHash: string;
  status: WorkflowRunStatus;
  phases: WorkflowPhaseRecord[];
  totalTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  budgetUsd: number | null; // hard ceiling; null = no limit
  spentUsd: number; // running total across all task agents
  result: unknown | null; // validated aggregate output
  startedAt: string;
  completedAt: string | null;
};

type WorkflowPhaseRecord = {
  phaseId: string;
  label: string;
  status: "pending" | "running" | "complete" | "fail";
  taskIds: string[];
  startedAt: string | null;
  completedAt: string | null;
};
```

The Manager gets three new callables:

```typescript
// MCP/manual entry point
startWorkflow(script: string, args?: unknown, budget?: number): WorkflowRunRecord

// Called by WorkflowRun DO as tasks complete
workflowTaskComplete(workflowId: string, taskId: string, result: unknown, costUsd: number): void

// Called by WorkflowRun DO when aggregate finishes
workflowComplete(workflowId: string, result: unknown | null, error?: string): WorkflowRunRecord
```

---

### Layer 3: WorkflowRun DO (subAgent off Manager)

The WorkflowRun Durable Object manages execution state for one workflow run. It is a
subAgent of the Manager with name `wf:{workflowId}`.

**Responsibilities:**

- Owns a SQLite table of task states (`task_id`, `phase_id`, `status`, `result`,
  `cost_usd`, `started_at`, `completed_at`). All transitions are idempotent upserts.
- Executes the `plan()` script via Worker Loader to get the phase/task list.
- Maintains a concurrency semaphore: max N tasks executing simultaneously. The limit is
  per-installation (not global) to prevent one workflow from starving others.
- Dispatches task agents as `subAgent(WorkflowTaskAgent, "wf:{workflowId}:t:{taskId}")`.
- Sets an alarm for the aggregate phase. **Must use an alarm**, not an inline defer.
  Cloudflare can evict an idle DO after 10–140 seconds. The alarm ensures the aggregate
  phase runs even after eviction/hibernation.
- When all tasks in a phase are complete, advances to the next phase.
- When all phases are complete, fires the aggregate alarm.
- Runs the `aggregate()` script via Worker Loader with the collected results.
- Reports to `Manager.workflowComplete()` with the final result.
- Self-deletes (or is GC'd by Manager maintenance) after a retention window.

**Recovery path:**

If the WorkflowRun DO is evicted mid-run, the alarm re-fires. On alarm:

1. Read SQLite to find which tasks are complete and which are still pending/running.
2. Re-dispatch any tasks whose DO was evicted (their state in SQLite is `running` but their
   DO no longer exists).
3. Continue normally. Completed task results are replayed from SQLite — never from memory.

This mirrors the existing `maintainNanites` stale-run detection in `SigveloNaniteManager`.

---

### Layer 4: WorkflowTaskAgent (ephemeral Think sub-agent)

Each task is a Think sub-agent with name `wf:{workflowId}:t:{taskId}`. It is a stripped
version of `SigveloNaniteAgent` with the persistent parts removed.

**What it has:**

- A single Think turn (or bounded multi-turn via `maxTurns`)
- Read-only Workspace access via the shared snapshot (see Layer 5)
- Declared tool inventory from the task definition
- Per-task model and effort settings
- The output schema embedded in the system prompt as JSON Schema
- A `complete(result)` callable that validates the result against the schema and reports to
  WorkflowRun

**What it does not have:**

- Durable Think memory
- Manifest, trigger, or schedule machinery
- Write tools (unless the task explicitly declares them)
- The ability to spawn child workflows or task agents

**After completion:**

1. Structured result is validated against the Zod schema.
2. If valid: result is persisted to WorkflowRun SQLite, then the task DO is deleted.
3. If invalid: task is re-dispatched up to a retry limit (default: 2 retries). After the
   retry limit, the task is marked `fail` and WorkflowRun decides whether to continue or
   abort the workflow.
4. Evidence retention: structured result, transcript excerpt (first N tokens), and cost are
   persisted to WorkflowRun SQLite before the DO is deleted. Evidence survives GC.

**Cleanup:**

WorkflowRun calls `deleteSubAgent(WorkflowTaskAgent, taskId)` after result is confirmed
persisted. At workflow completion, `deleteSubAgent(WorkflowRunDO, workflowId)` cascades to
any remaining task agents via the naming hierarchy.

---

### Layer 5: Shared Read-Only Workspace Snapshot

For read-heavy workflows (audits, research, migration planning), cloning the repo N times is
wasteful. The WorkflowRun clones the repo once into an R2 prefix `wf:{workflowId}/ws/` at
the start of the `planning` phase. Task agents mount this prefix as a read-only Workspace
view.

**For read tasks:** task agents get workspace access to the shared snapshot prefix. No write
tools in inventory.

**For write tasks:** tasks do not directly mutate files. They return structured patch
descriptions (file path, old content, new content, or a diff). The aggregate phase applies
patches serially in the WorkflowRun's own writable Workspace. This keeps git auth and
repository-scoped installation tokens centralized, consistent with the existing `git-auth.ts`
pattern.

**Open question:** Does `@cloudflare/think` Workspace support read-only mounting from an
existing R2 prefix? If not, the fallback for v1 is: each task clones its own Workspace
(wasteful but correct). Shared snapshot is a v2 optimization.

---

## The Phases Concept

Phases group tasks that run together, separated by sequential gates. Phases run one at a
time; tasks within a phase run in parallel (up to the concurrency limit).

```
Phase 1: "read"     → N tasks run in parallel → all complete
Phase 2: "verify"   → M tasks run in parallel → all complete
Phase 3: "apply"    → K tasks run in parallel → all complete
aggregate()         → synthesis of all results
```

The output of phase N is available to the plan at definition time only if the phases are
pre-defined. For dynamic phases (where phase 2 tasks depend on phase 1 results), the script
can return a `LazyPhase` whose task list is a function of the previous phase's results:

```typescript
ctx.lazyPhase("verify", (phase1Results) =>
  phase1Results
    .filter(r => r.severity === "high")
    .map(r => ctx.task({ id: `verify:${r.file}`, ... }))
)
```

`LazyPhase` is resolved by the WorkflowRun DO after the prior phase completes. The
`aggregate()` script still runs once at the very end with all results from all phases.

---

## Script Validation

The workflow script goes through the same validation envelope as trigger scripts in
`triggers.ts`:

| Check                     | Detail                                                                        |
| ------------------------- | ----------------------------------------------------------------------------- |
| Static forbidden patterns | `eval`, `new Function`, dynamic `import()`                                    |
| Byte limit                | 64KB (same as trigger scripts)                                                |
| Bundle validation         | Worker Loader must bundle successfully                                        |
| Plan result schema        | `plan()` must return `TaskDefinition[]` or `Phase[]`; max task count enforced |
| Output schema presence    | Every task must declare an `outputSchema`                                     |
| Permission scoping        | Task `tools` must be a subset of the workflow's declared permission spec      |
| Budget declaration        | If `budgetUsd` is declared, it must be a positive finite number               |

Validation runs at `startWorkflow` time before any tasks are dispatched. A validation
failure returns an error to the caller immediately; no `WorkflowRunRecord` is created.

---

## Scale Controls

Two separate concurrency budgets:

**Per-workflow concurrency:** How many task agents execute simultaneously within one
WorkflowRun. Default: 16 (matching Cloudflare's suggested agent cap). Configurable per
workflow script via `defineWorkflow({ maxConcurrency: N })`.

**Per-installation concurrency:** How many active WorkflowRuns can exist simultaneously for
one GitHub installation. Prevents a single installation from starving the platform with many
large fan-outs. Default: 3 simultaneous workflow runs. Enforced by the Manager at
`startWorkflow` time (same pattern as `countActiveRunsForNanite`).

**Hard caps (non-configurable):**

- Max tasks per workflow run: 1000
- Max phases per workflow run: 20
- Max task retries: 2

---

## Budget Controls

```typescript
defineWorkflow({
  maxConcurrency: 16,
  budgetUsd: 5.00,        // hard ceiling for the entire workflow run
  ...
})
```

The WorkflowRun tracks `spentUsd` as a running total across all task agents. On each
`workflowTaskComplete` callback, `spentUsd` is updated. If `spentUsd >= budgetUsd`, the
WorkflowRun cancels all pending tasks and marks the run `fail` with a budget-exceeded
reason. In-flight tasks are allowed to complete (their results are retained) but no new
tasks are dispatched.

Cost is reported per task (from Think submission metadata) and summed in `WorkflowRunRecord`.
The Manager's `workflowComplete` output includes total cost so it appears in the run record.

---

## Quality Patterns

These are patterns the script author can implement using the primitives above. They do not
require special infrastructure — they are emergent from phases + schemas + adversarial task
prompts.

### Adversarial cross-check

Run two tasks on the same target with opposing prompts. Aggregate reconciles disagreements.
Both tasks use the same `outputSchema`, making the merge trivial.

```typescript
return routes.flatMap((file) => [
  ctx.task({ id: `audit:${file}`, prompt: `Find auth issues in ${file}.`, outputSchema }),
  ctx.task({
    id: `challenge:${file}`,
    prompt: `Challenge the findings for ${file}. Flag false positives.`,
    outputSchema,
  }),
]);
```

### Multi-angle planning

Draft a plan from several independent angles before committing. Run N planning tasks, then
use the aggregate to weigh them and select the strongest.

```typescript
return ANGLES.map((angle) =>
  ctx.task({
    id: `plan:${angle.id}`,
    prompt: `Draft a refactor plan for this module from the angle: ${angle.description}.`,
    outputSchema: PlanSchema,
    effort: "high",
  }),
);
```

### Plan-then-write (two-phase)

Phase 1: all tasks run in `plan` permission mode and return proposed changes as structured
output. Phase 2: aggregate reviews the proposals, the aggregate result is a merge plan.
A separate manual step applies the changes.

```typescript
return [
  ctx.phase(
    "propose",
    files.map((f) =>
      ctx.task({
        id: `propose:${f}`,
        prompt: `Propose changes to migrate ${f} to the new pattern.`,
        outputSchema: PatchSchema,
        permissionMode: "plan", // read-only; returns proposed diff, does not apply
      }),
    ),
  ),
];
// aggregate receives PatchSchema[] and returns a ranked merge plan
```

---

## Saved Workflows and Args

A WorkflowScript stored in R2 under a well-known key becomes a named workflow, triggerable
by name from MCP or manually:

```typescript
// MCP tool call
sigvelo_start_workflow({ name: "audit-auth", args: { paths: ["src/routes/"] } });
```

The `args` value is passed to `plan(ctx, args)` as typed structured data. The script author
declares the args shape:

```typescript
const Args = z.object({ paths: z.array(z.string()) });

export default defineWorkflow({
  argsSchema: Args,
  async plan(ctx, args: z.infer<typeof Args>) {
    const files = await ctx.workspace.glob(args.paths.map(p => `${p}**/*.ts`).join(","));
    ...
  },
});
```

Named workflows appear in the MCP tool list alongside the Nanite tools. They can also be
attached to a scheduled `eventSource` on a Nanite manifest (the Nanite's trigger dispatches
the workflow instead of running the Nanite itself) — though this is a later extension.

---

## Workflow Script as Persistent Artifact

Every workflow run persists its script source to R2 at `wf/{workflowId}/script.ts` before
executing. This enables:

- **Inspection:** retrieve the exact script that ran for a given `workflowId`.
- **Diff:** compare scripts across runs of the same named workflow.
- **Relaunch:** pass a stored script key to `startWorkflow` instead of a new source string.
- **Debugging:** edit the stored script and relaunch to iterate on a workflow without
  re-authoring from scratch.

The `WorkflowRunRecord` stores `scriptR2Key` pointing to this artifact.

---

## Resumability

Resumability is a first-class guarantee, not an optimization:

- All task results are persisted to WorkflowRun SQLite before the task DO is deleted.
- WorkflowRun SQLite transitions are idempotent upserts. Re-delivering a `taskComplete`
  callback for an already-completed task is a no-op.
- On resume (WorkflowRun DO alarm re-fires, or explicit resume call), the DO reads SQLite to
  find which tasks are still `pending` or `running` and re-dispatches only those.
- Completed task results are replayed from SQLite — they are never re-computed.
- The aggregate script receives the full results array regardless of when tasks completed.

This mirrors the existing `waitForTerminalRuns` polling loop and `staleRunningAfterMs`
maintenance in `SigveloNaniteManager`.

---

## Observability

The Manager's `WorkflowRunRecord` carries enough information for the UI to show:

- Overall workflow status and elapsed time
- Phase breakdown: phase name, status, task count, completed count
- Running total cost (`spentUsd`)
- Per-task status (via WorkflowRun DO SQLite, accessible via debug callable)

The `sigvelo_debug_nanites` MCP tool should be extended to include `workflows` as an
`include` section, returning `WorkflowRunRecord[]` for a given installation.

A new MCP tool `sigvelo_cancel_workflow_run` mirrors `sigvelo_cancel_nanite_runs`.

---

## Manager Changes Summary

### New state fields

```typescript
type NaniteManagerState = {
  // ... existing fields ...
  workflows: Record<string, WorkflowRunRecord>; // new
  workflowOrder: string[]; // new — most-recent-first
};
```

### New callables

```typescript
startWorkflow(input: StartWorkflowInput): WorkflowRunRecord
workflowTaskComplete(input: WorkflowTaskCompleteInput): void
workflowComplete(input: WorkflowCompleteInput): WorkflowRunRecord
cancelWorkflowRun(input: CancelWorkflowRunInput): WorkflowRunRecord
inspectWorkflowDebug(input: InspectWorkflowDebugInput): InspectWorkflowDebugOutput
```

### Trigger intent extension (separate path)

A trigger script may return a `workflow_dispatch` intent as a third intent type alongside
`dispatch_self` and `noop`. When the Manager sees `workflow_dispatch`, it calls
`startWorkflow` — it does not touch the existing `startRun` → `dispatchRun` Nanite chain.
This keeps the two execution models strictly separate at the dispatch layer while allowing
the same trigger script to choose between them.

```typescript
export type TriggerIntent =
  | { type: "dispatch_self"; input: TriggerDispatchInput }
  | { type: "noop"; reason: string }
  | { type: "workflow_dispatch"; workflowName: string; args?: unknown }; // new
```

The Manager validates that `workflowName` refers to a known named workflow before accepting
the intent.

---

## New Package: `@sigvelo/nanite-workflow`

Mirrors `@sigvelo/nanite-trigger`. Pre-bundled into the Worker Loader runtime so script
authors do not manage dependencies.

Exports:

```typescript
// Core authoring primitive
defineWorkflow(definition: WorkflowDefinition): WorkflowExport

// Context types
WorkflowPlanContext       // ctx in plan()
WorkflowAggregateContext  // ctx in aggregate()

// Task and phase builders (also on ctx)
task(definition: TaskDefinition): TaskDefinition
phase(label: string, tasks: TaskDefinition[]): Phase
lazyPhase(label: string, fn: (prevResults: unknown[]) => TaskDefinition[]): LazyPhase

// Re-exported for convenience
export { z } from "zod";
```

---

## Relationship to WorkflowTaskAgent Class

`WorkflowTaskAgent` is a new class, not a mode flag on `SigveloNaniteAgent`. The overlap is
significant (both use Think, both use Workspace), but the differences are deep enough that a
separate class is cleaner:

- `WorkflowTaskAgent` has no manifest, no trigger, no schedule sync, no `ask_human` tool,
  no lifecycle watchdog.
- `WorkflowTaskAgent` reports to `WorkflowRun` via `complete(result)` rather than to the
  Manager via `completeRun`.
- `WorkflowTaskAgent` has a hard `maxTurns` limit (no open-ended execution).
- `WorkflowTaskAgent` has an `outputSchema` in its system context at all times.

Estimated size: ~200 lines, heavily pattern-following `SigveloNaniteAgent`.

---

## Total New Code Estimate

| Component                                           | Estimated lines | Notes                                            |
| --------------------------------------------------- | --------------- | ------------------------------------------------ |
| `WorkflowRunRecord` type + Manager state            | ~120            | New state fields, callables, transitions         |
| `WorkflowTaskAgent` class                           | ~200            | Stripped NaniteAgent                             |
| `WorkflowRun` DO                                    | ~300            | SQLite task table, semaphore, alarm, phase logic |
| Script execution wrapper (plan + aggregate)         | ~80             | Thin layer on existing `runGeneratedTrigger`     |
| `@sigvelo/nanite-workflow` types + `defineWorkflow` | ~150            | Authoring surface                                |
| Script validation                                   | ~60             | Reuses trigger validation patterns               |
| MCP tool extensions                                 | ~100            | `start_workflow`, `cancel_workflow_run`, debug   |
| **Total**                                           | **~1000 lines** | Heavily pattern-following existing code          |

The Manager already handles spawning subAgents, tracking run state, waiting for terminal
outcomes, and running Dynamic Worker scripts. The new code is primarily plumbing those
existing capabilities together with a new execution shape.

---

## Open Questions

**1. Workspace read-only sharing**
Does `@cloudflare/think` Workspace support read-only mounting from an existing R2 prefix?
The current `SigveloNaniteAgent` always creates its own Workspace. If shared mounting is not
supported, v1 falls back to each task cloning its own Workspace. Shared snapshot is a v2
optimization.

**2. DO Facets availability**
`execution-architecture.md` mentions Durable Object facets as a direction. The current
design uses the existing `subAgent` pattern (which creates standard DOs) rather than facets.
If CF facets become available in the Agents SDK, the naming hierarchy
(`wf:{workflowId}:t:{taskId}`) already maps cleanly to a facet path.

**3. Single-turn Think API**
Does `@cloudflare/think` expose a "run one turn and return" API, or does each task agent own
a full Think session and terminate it after `maxTurns = 1`? If the latter, session startup
overhead multiplied by N tasks is a meaningful cost for large fan-outs.

**4. Per-installation concurrency budget**
What is the right default? 3 simultaneous workflow runs was proposed but not validated
against expected usage patterns. This needs a real number based on resource consumption
estimates.

**5. Aggregate LLM cost gate**
Should the aggregate phase require explicit `budgetUsd` headroom beyond what was spent on
tasks? A workflow that burns its entire budget on tasks leaves nothing for synthesis. One
approach: reserve a fixed percentage of `budgetUsd` for the aggregate phase and enforce it
at task dispatch time.

**6. `lazyPhase` complexity**
`LazyPhase` requires the WorkflowRun DO to re-invoke the Worker Loader between phases to
evaluate the lazy function with phase N's results. This is functionally straightforward but
adds a Worker Loader round-trip per lazy phase. Evaluate whether the complexity is worth it
for v1 or if static phases only is sufficient.

---

## Non-Goals

- **Replacing persistent Nanites.** Workflows are for one-shot bulk jobs. Recurring
  maintenance surfaces belong on persistent Nanites with trigger handlers.
- **Cross-workflow coordination.** Workflows do not share state or message each other.
- **Nested fan-out.** Task agents cannot spawn their own workflows or subtasks.
- **User-visible phase graph UI.** The Manager's `WorkflowRunRecord` carries enough for a
  simple status view. A rich phase graph UI is a later product pass.
- **Generated workflow classes.** The roadmap explicitly excludes generated Nanite runtime
  classes as a default. Generated workflow scripts (the `plan` + `aggregate` code) are
  different from generated runtime classes and are in scope. Generated runtime classes are not.
- **Real-time task output streaming.** Task agents report a single structured result at
  completion. Intermediate token streaming within a task is not exposed to the workflow
  caller in v1.

---

## Implementation Phases

### Phase 1: Foundation (minimal viable)

Deliver a workflow that runs a flat list of tasks (no phases) with static Zod schemas and
collects structured results.

- `WorkflowRunRecord` in Manager state
- `WorkflowTaskAgent` class (no Workspace, no phases, single Think turn)
- `WorkflowRun` DO with flat task table, semaphore, and join logic
- Plan script execution via Worker Loader (flat `TaskDefinition[]` only)
- Aggregate script execution via Worker Loader
- Script validation (byte limit, forbidden patterns, task schema presence)
- `startWorkflow`, `workflowTaskComplete`, `workflowComplete` Manager callables
- `sigvelo_start_workflow` MCP tool
- Script persisted to R2

**What Phase 1 does not include:** phases, lazy phases, shared workspace, budget cap, named
workflows/args, adversarial patterns, `workflow_dispatch` trigger intent.

### Phase 2: Phases + Workspace + Budget

- Phase concept in plan output and WorkflowRun execution
- `LazyPhase` support
- Shared R2 workspace snapshot (if Workspace mounting is confirmed)
- `budgetUsd` enforcement with per-task cost tracking
- Alarm-based aggregate recovery (replace inline join)
- Retry logic for failed tasks (up to 2 retries)

### Phase 3: Authoring Surface + Saved Workflows

- `@sigvelo/nanite-workflow` package with Zod pre-bundled
- Named workflow registration (save script to well-known R2 key)
- `args` / `argsSchema` in `defineWorkflow`
- `sigvelo_start_workflow` accepts `name` + `args` as alternative to raw script
- `workflow_dispatch` trigger intent

### Phase 4: Quality Patterns + Observability

- Per-task `effort` and `permissionMode` enforcement
- `plan` permission mode for write-task proposals
- `WorkflowTaskCompleted` hook for schema validation before result commit
- Debug callables for inspecting WorkflowRun SQLite
- UI surface for workflow run status (phase breakdown, cost, elapsed time)

---

## Source References

Architecture decisions in this document were informed by:

- `docs/architecture/execution-architecture.md` — runtime posture and CF primitive guidance
- `src/backend/agents/SigveloNaniteManager.ts` — Manager callable patterns, run records,
  subAgent lifecycle
- `src/backend/agents/SigveloNaniteAgent.ts` — Think sub-agent structure, Workspace usage
- `src/backend/nanites/triggers.ts` — Worker Loader / Dynamic Worker execution pattern
- Claude Code dynamic workflows documentation (`code.claude.com/docs/en/workflows.md`) —
  phases, resumability, script persistence, quality patterns
- Claude Code structured outputs documentation — Zod schema pattern, output validation,
  retry on mismatch
- Claude Code subagents documentation — per-agent model/effort/maxTurns/tools, context
  isolation guarantees
- Claude Code agent loop documentation — `maxBudgetUsd`, effort levels, parallel tool
  execution semantics
