# Ask Manager Escalation Plan

## Purpose

Replace the Nanite-local `ask_human` lifecycle path with manager-owned escalation.

When a Nanite discovers that its current manifest, repository scope, GitHub permissions, or policy
context is not enough to complete a run, it should ask its installation manager for a decision. It
should not create an app-local approval inbox, and it should not fail only because the manager might
be able to widen the Nanite's authorized scope.

## Decision

Use `ask_manager` as a Nanite lifecycle tool and `waiting_for_manager` as the paused run state.

The manager is the authority boundary:

- It may update the Nanite manifest through the same registration path used by normal create/update.
- It may resume the run by submitting one durable Think turn to the Nanite sub-agent.
- It may reject the escalation and let the Nanite finish with `fail`.
- It may point to GitHub or setup when the requested authority needs external installation action.

Do not build a custom app-local approval UI for this path. GitHub comments, issues, and pull requests
remain the normal collaboration surface. Cloudflare Workflow approval or MCP elicitation can be added
later for cases that truly need durable user interaction.

Match the Cloudflare Agents SDK shapes directly:

- the manager reaches a Nanite with `this.subAgent(SigveloNaniteAgent, name)`
- the Nanite reaches its manager with `this.parentAgent(SigveloNaniteManager)`
- approved resume work is accepted by `submitMessages(messages, { idempotencyKey, metadata })`
- resume status is inspected with `inspectSubmission(...)`, `listSubmissions(...)`, and
  `cancelSubmission(...)`

Do not add a SigVelo approval queue, manager inbox, or standalone orchestration layer for this
first pass.

## Implementation Status

The first slice is implemented: `ask_manager` accepts `{ request: string }`, the manager records a
`ManagerRequest`, and the run pauses as `waiting_for_manager`.

Manager approval, manifest mutation, external-action routing, and durable resume are still future
work. Add those only when there is a manager-owned action that can resolve a request.

## Prior Shape

The previous implementation had a real app-local checkpoint path:

- `SigveloNaniteAgent` exposed lifecycle tools: `complete`, `no_change`, `fail`, `ask_human`.
- `SigveloNaniteManager` stored `waiting_for_human` runs with a `HumanRequest`.
- the Nanite UI rendered `ask_human` as "Human decision needed".
- observability stored `waiting_for_human` as a run status and conclusion.

That path records a pause, but it does not model the actual owner of the next decision. In practice,
the next decision is usually the manager deciding whether this Nanite should have more scope.

## SDK Shape To Match

The Nanite is a Think sub-agent, also called a facet in the SDK docs. Keep the implementation close
to the SDK:

- Use `subAgent(Cls, name)` for parent-to-child RPC and child creation.
- Use `parentAgent(ParentClass)` for child-to-parent RPC. It verifies the recorded parent class and
  returns a typed stub for the immediate parent.
- Use `parentPath` and `selfPath` only when path identity is needed for routing or diagnostics.
- Keep facet-only Nanite classes out of production `new_sqlite_classes`; add test-only bindings only
  if local test harnesses need `ctx.exports` resolution.

Think has several turn APIs. For manager escalation, the target API is `submitMessages()` because the
manager needs durable acceptance, idempotent retry, and later status inspection.

Do not use these SDK primitives for the first slice:

- `continueLastTurn()`: manager decision is new input, not continuation of an unfinished assistant
  leaf.
- `chat(...)`: only use this if the manager must hold a streaming RPC open and owns forwarding,
  cancellation, and replay.
- `agentTool(...)` or `runAgentTool(...)`: use them later only if the manager model delegates work to
  a retained child agent and needs child-run replay or UI drill-in.
- Workflow `waitForApproval`, MCP elicitation, or tool `needsApproval`: use these only for a real
  user/external durable wait, not for manager-owned scope decisions.

## Manager Request

The `ask_manager` tool input should stay plain. The Nanite knows it is blocked; it does not need to
name the exact manifest patch or GitHub permission model.

```ts
type AskManagerInput = {
  request: string;
};
```

`request` is the natural-language ask. It should say what the Nanite tried, what blocked it, and what
authority or context it thinks would let it continue. It can include URLs, PR numbers, filenames,
repository guesses, permission names, and setup clues.

The manager wraps that input with the run id, request id, and `createdAt` when it stores the pause.
Do not ask the Nanite to send a manifest patch, permission diff, external-context object, or policy
decision. The manager owns interpretation and validation.

Do not introduce a custom durable decision queue. The product decisions are `applied`, `rejected`,
and `external_action_required`; the execution state after an approved resume belongs to Think's
submission record: `pending`, `running`, `completed`, `aborted`, `skipped`, or `error`.

The first implementation slice should remove today's `requestedScopes` shape instead of preserving
it. Structured telemetry starts when the manager decides what authority was requested and whether it
can grant it.

## Manager Rules

The manager can apply an inferred change only when all of these are true:

- every affected repository belongs to the active GitHub installation
- affected GitHub App permissions are already granted to the installation
- the change is a widening or clarification of the same Nanite responsibility, not a new job

The manager must not auto-grant:

- access outside the installation
- GitHub App permissions the app was not installed with
- merge authority
- default-branch pushes
- broad file-write GitHub MCP tools
- GitHub MCP denied tools such as review mutation, repository creation, projects, gist, or Copilot
  assignment
- a new repository or event family unrelated to the Nanite's responsibility
- generated trigger write authority or cross-Nanite dispatch

Do not infer trigger or event-source edits in the first pass. If a running Nanite thinks its trigger
is wrong, it should explain that in `request`; the manager can reject or route it to authoring/setup
work.

If the request needs GitHub App re-approval, repository installation changes, or a product/security
choice, the manager records `external_action_required` and links to the GitHub/setup surface that can
resolve it.

GitHub comments or issues may explain a manager request when the run already has a GitHub surface,
but they are not approval tokens. Keep at most one concise escalation comment per blocked artifact
and reuse or edit it for repeated status updates.

## GitHub Interaction

GitHub comment ingress already reaches the manager:

- `src/backend/api/routes/github.ts` routes `issue_comment` and `pull_request_review_comment`
  webhooks into `SigveloChatIngress`.
- `SigveloChatIngress` reacts, subscribes to the thread, posts a status message, and queues a
  manager turn.
- `SigveloManagerConversationAgent` submits the GitHub message into the manager Think conversation
  and publishes the reply back to the same GitHub thread.

Use that path for clarification and manager conversation. Do not require the user to open the
SigVelo app to approve, reject, or clarify. The app can show the escalation and link to GitHub or
setup, but GitHub remains the normal conversation artifact.

## Runtime Flow

1. The Nanite calls `ask_manager`.
2. The manager validates the run is active and moves it to `waiting_for_manager`, recording a
   request id.
3. The original Think submission finishes with the run still in `waiting_for_manager`.
4. A later manager action reads `request` and checks whether a manifest change is safe.
5. If approved, the manager re-registers the Nanite with the updated manifest.
6. The manager moves the run back to `running`.
7. The manager gets the child with `subAgent(SigveloNaniteAgent, naniteId)`.
8. The manager uses the existing manager-owned Nanite submission path, generalized if needed.
9. The Nanite submits one durable Think turn:

```ts
const submissionId = `manager-resolution:${runId}:${requestId}`;

await this.submitMessages(messages, {
  submissionId,
  idempotencyKey: `${submissionId}:${manifestVersionId}`,
  metadata: {
    source: "manager_escalation",
    runId,
    requestId,
    manifestVersionId,
  },
});
```

The continuation should use Think's programmatic message path with an idempotency key derived from
the run id, manager request id, and manifest version, plus a deterministic `submissionId` derived
from the run id and request id. Do not call the normal run dispatch path for resume; that would
replay the original run prompt as if a new run had started. Do not use `continueLastTurn()`; the
prior turn ended normally by reporting a lifecycle pause, and the manager decision is new input.

Store the resume `submissionId` for status inspection, cancellation, and audit linkage. Do not mirror
Think's submission state into a separate SigVelo queue.

## Implementation Slices

### 1. Rename the lifecycle path

- Rename lifecycle tool `ask_human` to `ask_manager`.
- Rename run status/activity state `waiting_for_human` to `waiting_for_manager`.
- Rename `HumanRequest` to `ManagerRequest`.
- Replace `summary` and `requestedScopes` with required `request`.
- Update Nanite prompts so missing authority routes to `ask_manager`, not `fail` or app approval.
- Update UI copy to "Manager decision needed" or "Waiting for manager".
- Normalize existing dev/staging state only if preserving current rows matters.

Keep this slice behavior-preserving except for naming. Do not add approval workflows, automatic
capability granting, or a manager policy engine in this slice. Because Nanites is pre-production,
prefer a hard rename over compatibility aliases.

### 2. Match SDK parent-child RPC

- Replace ad hoc parent lookup with `parentAgent(SigveloNaniteManager)` where the Nanite needs to
  ask the manager.
- Keep manager-to-Nanite calls on `subAgent(SigveloNaniteAgent, naniteId)`.
- Keep `ask_manager` as a lifecycle tool, not a Workflow approval, client-tool approval, or MCP
  elicitation.
- Add no public sub-agent route or production migration unless the class is also bound as a
  top-level Durable Object.

### 3. Add manager validation and manifest application

- Add a manager method that interprets `request`.
- Validate any inferred manifest change against installation repositories and installed GitHub App
  permissions.
- Apply safe changes through `registerNanite`.
- In the first pass, apply only changes that map cleanly to existing registration validation.
  Otherwise reject or record `external_action_required`.
- Record the decision on the run.
- Record actor, run id, previous manifest hash, next manifest hash, and what changed.
- Keep rejection explicit and explainable.

Do not add a new manager-planning subsystem. The existing manifest registration path is enough for
the first version.

### 4. Resume approved runs

- After an `applied` decision, set the run back to `running`.
- Submit one continuation message to the same Nanite Think sub-agent with `submitMessages(...)`.
- Reuse or generalize the existing manager-owned Nanite submission path instead of creating a second
  dispatch path.
- Use a deterministic `submissionId` derived from run id and request id.
- Use an idempotency key derived from run id, request id, and manifest version id.
- Record the resume `submissionId`.
- Use `inspectSubmission(...)` or `listSubmissions(...)` for follow-up status.
- Use `cancelSubmission(...)` for durable cancellation; do not try to pass `AbortSignal` across
  Durable Object RPC.
- Include the decision summary, new manifest version id, and what changed.
- Keep the run id unchanged.
- Reject stale resumes when the run is no longer `waiting_for_manager` or the request id does not
  match the latest manager escalation.
- Do not move the run back to `running` until the original `ask_manager` Think submission is stable
  in the waiting state.

### 5. Route external action to GitHub/setup

- For repository installation or GitHub App permission gaps, return an `external_action_required`
  decision with an output URL.
- Prefer GitHub issue/PR/comment surfaces when the run already has a coherent GitHub artifact.
- Link to the app only for setup or detailed run inspection.
- After external setup, re-read installation repositories and GitHub App metadata before re-running
  the same registration validation path.

### 6. Update persisted names and observability

- Hard-rename `waiting_for_human` to `waiting_for_manager` in run status and conclusion enums.
- If deployed data needs preserving, run a one-time state rewrite for `nanite_run_facts.status`,
  `nanite_run_facts.conclusion`, `nanite_catalog.last_run_status`, and active Durable Object manager
  state. Do not keep permanent legacy aliases.
- Keep dashboard display copy generic as "Waiting" so future wording changes do not split product
  semantics again.
- Record the requested pause as run state, not structured access telemetry.
- Record structured audit data when the manager resolves the request:
  - `audit.manager_escalation.applied` with the approved manifest change, previous manifest hash,
    next manifest hash, actor, request id, and run id.
  - `audit.manager_escalation.rejected` with actor, request id, run id, and stable reason code.
  - `audit.manager_escalation.external_action_required` with actor, request id, run id, stable reason
    code, and setup/output URL.
  - `audit.manager_escalation.resumed` with request id, run id, manifest version id, and Think
    `submissionId`.
- Keep manager-escalation audit metadata small and sanitized. Do not store raw prompts, tool output,
  transcripts, or GitHub payloads in `metadata_json`.

## Tests

Add slice integration coverage before broader UI polish:

- Nanite fixture calls `ask_manager` and the manager records `waiting_for_manager`.
- Manager rejects a repository outside the installation.
- Manager rejects a GitHub App permission not granted to the installation.
- Manager applies a safe inferred repository/permission change through `registerNanite`.
- An applied decision resumes the same run and produces a continuation turn.
- Manager resume waits until the original `ask_manager` submission is stable in
  `waiting_for_manager`.
- Resume uses the deterministic `manager-resolution:${runId}:${requestId}` submission id.
- Duplicate manager resume calls do not produce duplicate continuation turns.
- GitHub MCP denied tools remain denied after a permission expansion.
- git auth still cannot clone, fetch, push, or inspect repositories outside
  `manifest.permissions.github.repositories`.
- observability query tests prove waiting KPIs and filters count manager-waiting rows.
- Existing cancel behavior skips waiting manager runs unless explicit run ids are supplied.

Run focused checks during implementation:

```sh
vp test tests/backend/nanite-trigger-runtime.test.ts
vp test tests/browser/runtime-chat-recovery.test.tsx
vp check
```

## Non-Goals

- No app-local approval inbox.
- No new Workflow dependency for the first slice.
- No SDK `needsApproval` path for manager-owned scope decisions.
- No automatic GitHub App permission re-approval.
- No self-granting Nanites.
- No broad "planner manager" abstraction before concrete escalation cases require it.
- No custom durable queue that mirrors Think submissions.
- No backwards-compatibility aliases unless active deployed data forces a temporary cleanup.
- No GitHub comment spam.
- No generated trigger handler escalation or GitHub feedback writes.

## Source Owners

- Nanite lifecycle tools: `src/backend/agents/SigveloNaniteAgent.ts`
- Run state and manifest registration: `src/backend/agents/SigveloNaniteManager.ts`
- GitHub MCP capability derivation: `src/backend/nanites/github-mcp-capabilities.ts`
- MCP create/update schema: `src/backend/nanites/tools/create-nanite.ts`
- Observability enums and facts: `src/backend/db/schema.ts`,
  `src/backend/observability/recorders.ts`, `src/backend/observability/queries.ts`
- GitHub manager conversation ingress: `src/backend/api/routes/github.ts`,
  `src/backend/agents/SigveloChatIngress.ts`,
  `src/backend/agents/SigveloManagerConversationAgent.ts`
- Nanite runtime UI: `src/frontend/routes/_authenticated/nanites/-runtime-chat.tsx`,
  `src/frontend/routes/_authenticated/nanites/route.tsx`

## References

- Refreshed Cloudflare Agents SDK snapshot via `opensrc fetch github.com/cloudflare/agents` before
  this plan update.
- Cloudflare Agents sub-agents: `subAgent(...)`, `parentAgent(...)`, `parentPath`, `selfPath`,
  `hasSubAgent(...)`, and `listSubAgents(...)`
- Cloudflare Think programmatic submissions: `submitMessages(...)`, `inspectSubmission(...)`,
  `listSubmissions(...)`, `cancelSubmission(...)`
- Cloudflare Think turn selection: use `saveMessages(...)` only when the manager can wait, `chat(...)`
  only for direct streaming RPC, and `agentTool(...)` / `runAgentTool(...)` only for retained child
  delegation.
- Cloudflare HITL patterns: use tool approval, Workflow approval, or MCP elicitation only when a
  real user/external wait is required.
- Existing Nanite registration path: `SigveloNaniteManager.registerNanite`
