# Handoff: Think Lifecycle Control For Nanites

Created: 2026-05-24

## Purpose

Implement the next Nanite reliability pass. The problem is not that Think lacks long-running
primitives. The problem is that Sigvelo currently treats Nanite lifecycle completion as mostly
prompt-level guidance during the active Think turn, then hard-fails only after the turn ends without
a lifecycle tool call.

The fix should align with Cloudflare Think primitives:

- `beforeTurn`
- `beforeStep`
- `stopWhen`
- `onChatResponse`
- `submitMessages`
- Session context blocks and compaction
- existing Think Workspace / execute providers where they fit

Do not build a separate custom agent loop.

## Current Branch And Repo State

Workspace:

```text
/
```

Current branch during investigation:

```text
alex/chat-sdk-manager-cleanup
```

The worktree has unrelated dirty/untracked files. Do not normalize or revert them unless the user
explicitly asks. Known unrelated examples:

- `docs/architecture/references/README.md`
- many local tool/agent directories such as `.claude/skills/*`, `.adal/`, `.aider-desk/`
- screenshots and local smoke artifacts

This handoff adds only this reference document.

## Production Case Investigated

Nanite URL:

```text
https://app.sigvelo.com/nanites?account=WebMCP-org&installationId=122769206&naniteId=sigvelo-commit-bot
```

Manager:

```text
installation:122769206
```

Nanite:

```text
sigvelo-commit-bot
```

Run:

```text
d08164f2-024a-4b6a-98fb-b8adb4be5ffd
```

Request:

```text
Push an empty commit to the current branch (PR #76 in WebMCP-org/nanites).
Use the GitHub API to create an empty commit.
Message: "chore: empty commit"
```

Observed result:

```text
fail: The Think turn completed before the Nanite reported a lifecycle outcome.
```

Think submission result:

```text
status: completed
startedAt: 2026-05-24T15:20:20.346Z
completedAt: 2026-05-24T15:27:14.710Z
```

Important interpretation:

Think completed the model turn. The Nanite lifecycle did not complete because the model never called
`complete`, `no_change`, `fail`, or `ask_human`.

## Debug Method Used

MCPJam OAuth was used against production:

```bash
mcpjam oauth login \
  --url https://app.sigvelo.com/mcp \
  --scopes "nanites:read nanites:write" \
  --verify-tools \
  --credentials-out /tmp/sigvelo-mcp-creds.json \
  --step-timeout 120000
```

Then `sigvelo_debug_nanites` was called through MCP. MCPJam redacted one embedded code string in
its debug artifact and corrupted the nested JSON, so a direct authenticated JSON-RPC call was used
with the saved token to capture a clean payload.

Local debug artifacts from this investigation:

- `/tmp/sigvelo-mcp-creds.json`
- `/tmp/sigvelo-commit-bot-debug.json`
- `/tmp/sigvelo-commit-bot-direct-result.json`
- `/tmp/sigvelo-commit-bot-direct-payload.json`
- `/tmp/sigvelo-commit-bot-tools.json`
- `/tmp/sigvelo-commit-bot-workspace.json`

These are local, ephemeral artifacts. If missing, regenerate with MCPJam or the direct MCP call.
Do not commit them.

Direct MCP call shape used:

```js
const result = await fetch("https://app.sigvelo.com/mcp", {
  method: "POST",
  headers: {
    authorization: `Bearer ${creds.accessToken}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": creds.protocolVersion || "2025-11-25",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "sigvelo_debug_nanites",
      arguments: {
        managerName: "installation:122769206",
        naniteId: "sigvelo-commit-bot",
        include: ["nanites", "runs", "runtimeActivity", "manifest", "transcript", "submissions"],
        transcript: {
          limit: 120,
          includeParts: true,
          maxTextLength: 40000,
          maxPartLength: 40000,
        },
        submissions: { limit: 50 },
      },
    },
  }),
});
```

## What Actually Happened In The Transcript

The transcript showed one user message and one assistant message. The assistant message contained
tool-call parts only. There was no final assistant text and no lifecycle tool call.

High-level sequence:

1. The Nanite read PR `#76` through GitHub MCP successfully.
2. It tried `git.clone` without an explicit `dir`, which defaulted into the workspace root.
3. It retried clone into `/workspace/sigvelo`.
4. It hit partial checkout / `.git` state problems.
5. It tried to repair checkout and pull/fetch state.
6. It saw local changes would be overwritten by checkout.
7. It found `HEAD` pointed at `refs/heads/main`, but there was no local `main`.
8. It manually rewrote `.git/HEAD`.
9. It created a local `refs/heads/main` pointing at the branch SHA.
10. It verified the current commit.
11. It inspected globals/env for auth/token helpers.
12. The Think turn completed with no lifecycle tool.

This was not max-step exhaustion:

```text
execute tool calls: 22
list tool calls: 4
read tool calls: 1
grep tool calls: 1
GitHub PR read calls: 1
```

The run got stuck in a debugging loop because the task asked for the GitHub API, but the prompt and
tool affordances led the model into workspace/git hydration.

## Workspace State Left Behind

The commit-bot workspace is polluted and should be reset before using this Nanite again:

- repo-looking files exist at workspace root `/`
- `/workspace/sigvelo` also exists
- `/workspace/sigvelo/.git/HEAD` points to:

```text
refs/heads/alex/nanite-prod-trigger-smoke-20260522
```

Observed workspace info:

```text
fileCount: 2178
directoryCount: 491
totalBytes: 39985373
r2FileCount: 5
```

## Council Decision

Three review agents looked at the issue from separate angles:

1. Think primitives
2. Nanite lifecycle/product semantics
3. Tool/workspace ergonomics

Consensus:

- Do not raise `maxSteps`; `1000` already lets the model debug too long.
- Make lifecycle completion part of the active Think control loop.
- Use `stopWhen` to end the turn once a lifecycle tool is called.
- Use `beforeStep` to force terminal decision behavior after repeated failures or a soft step budget.
- Use `onChatResponse` for one no-lifecycle repair turn.
- Make `ask_human` and `fail` semantically sharper.
- Fix workspace/git affordances so the model cannot accidentally clone into `/` or hand-repair `.git`.
- Turn on Think Session compaction, but treat it as long-term hygiene, not the root fix for this case.

## Implementation Pass 1: Lifecycle Control

Implement this first. Keep the change small.

### 1. Lower The Operational Step Budget

Current code:

- `apps/nanites/src/backend/nanites/agent.ts`
- constant: `naniteMaxSteps = 1000`

Decision:

- lower to an operational cap, likely `40` or `50`
- do not use `1000` as the default run budget

Reason:

`1000` turns tool failure into an unbounded debugging loop. Nanites are vertical maintenance agents,
not open-ended coding assistants.

### 2. Stop On Lifecycle Tool Calls

Use the AI SDK stop condition that Think already accepts through `beforeTurn`.

Target location:

- `apps/nanites/src/backend/nanites/agent.ts`
- `beforeTurn(ctx)`

Add `stopWhen` for lifecycle tools:

- `complete`
- `no_change`
- `fail`
- `ask_human`

Think composes this with its own `stepCountIs(maxSteps)` bound.

Reference:

- `/tmp/cloudflare-agents-review/docs/think/lifecycle-hooks.md`
- `/tmp/cloudflare-agents-review/packages/think/src/think.ts`

Important source behavior:

```text
beforeTurn returns TurnConfig.
TurnConfig.stopWhen is additive with Think's stepCountIs(maxSteps).
```

### 3. Add `beforeStep` Loop Control

Target location:

- `apps/nanites/src/backend/nanites/agent.ts`
- add near existing `beforeTurn`, `afterToolCall`, `onStepFinish`

Use Think's `beforeStep` primitive to restrict behavior while the turn is still active.

Policy:

- after a soft step budget, expose only lifecycle tools
- after repeated material failures, expose only lifecycle tools
- summarize the blocker in a short system override
- require exactly one lifecycle tool call

Suggested thresholds:

```text
soft step budget: 25
repeated same-class tool failure threshold: 2
hard max steps: 40-50
```

Repeated failures should be grouped coarsely by:

- tool name
- error class/message family
- target path/repo/ref when available

Do not build a complex analytics system. Start with enough state to catch loops like:

- `execute` repeatedly failing around clone/fetch/checkout
- workspace reads showing partial `.git`
- GitHub auth/token rejection

### 4. Strengthen Lifecycle Tool Descriptions

Current lifecycle tools are generic status setters.

Target location:

- `apps/nanites/src/backend/nanites/agent.ts`
- `complete`
- `no_change`
- `fail`
- `ask_human`

Decision criteria:

`complete`:

- requested outcome happened
- include output URL when there is one
- for empty commit, use commit URL, branch URL, or PR URL

`no_change`:

- investigation proves no action is needed
- not valid for imperative tasks such as "push a commit" unless equivalent state already exists

`ask_human`:

- missing permission or approval can unblock the run
- ambiguous target branch/repo
- branch protection or policy needs human choice
- destructive/risky action needs confirmation

`fail`:

- target state is impossible
- requested API/tool path is unavailable
- deterministic tool/API error repeats
- task cannot be completed within granted capabilities

Add a hard instruction:

```text
After two materially similar failures, stop debugging and call fail or ask_human.
```

### 5. Add One No-Lifecycle Repair Turn

Target location:

- `apps/nanites/src/backend/nanites/agent.ts`
- `onChatResponse(result)`

Current fallback in `onSubmissionStatus` tells the manager the run failed after the submission is
terminal. Keep that safety net, but add an earlier Think-native repair path.

Behavior:

- if `result.status === "completed"`
- and the manager run is still active
- and the assistant message contains no lifecycle tool call
- and this is not already a lifecycle-repair turn
- submit one repair message through `submitMessages`

Repair message:

```text
You ended the run without calling a lifecycle tool.
Call exactly one lifecycle tool now: complete, no_change, fail, or ask_human.
Do not call any investigation, workspace, git, execute, or GitHub tools.
Use the evidence already in the transcript.
```

How to cap the repair:

- store repair intent in submission metadata, or encode it in the repair message id
- in `beforeTurn`, detect repair turns and set:
  - low `maxSteps`, ideally `1` or `2`
  - `activeTools` to lifecycle tools only
  - `toolChoice` if supported cleanly by AI SDK/Think type surface

Use `submitMessages`, not a custom run loop.

## Implementation Pass 2: Tool And Workspace Affordances

Do this after lifecycle control.

### 1. Stop Treating Hydration As Universal

Current prompt over-biases toward workspace/git:

- `apps/nanites/src/backend/nanites/agent.ts`
- `buildRunPrompt`
- `getSystemPrompt`

Problem:

The commit-bot task explicitly said "Use the GitHub API", but the Nanite treated workspace hydration
as required.

Decision:

Add "execution plane" language:

```text
First classify the task's execution plane:
- GitHub API/MCP
- Workspace files/git
- trigger/routing
- human/product decision

Do not hydrate or repair workspace git for API-only tasks.
Use workspace checkout only when local file inspection or file edits are needed.
```

### 2. Add A Safe Repository Checkout Provider

Use Think execute provider primitives instead of model-authored raw git setup.

Target:

- `apps/nanites/src/backend/nanites/agent.ts`
- provider list passed to `createExecuteTool`
- possibly new file under `apps/nanites/src/backend/nanites/`

Shape:

```text
repo.ensureCheckout({ repository, ref?, branch?, baseDir? })
repo.currentCheckout({ repository })
```

Policy:

- derive safe checkout dir, such as `/repos/WebMCP-org/nanites`
- reject clone into `/`
- preflight existing `.git/config`
- verify remote matches requested repo
- fetch/checkout idempotently
- on clone failure, clean only the attempted checkout directory
- return a clear typed error that suggests `fail` or `ask_human` when appropriate

Reference:

- `/tmp/cloudflare-agents-review/packages/think/src/tools/execute.ts`
- `/tmp/cloudflare-agents-review/packages/shell/src/git/index.ts`
- `apps/nanites/src/backend/nanites/git-auth.ts`
- `apps/nanites/src/backend/nanites/git-tools-with-lazy-auth.ts`

### 3. Guard Raw `git.clone`

Finding:

Cloudflare shell's `git.clone` defaults `dir` to `/`.

Reference:

- `/tmp/cloudflare-agents-review/packages/shell/src/git/index.ts`

Sigvelo exposes `git.*` through `execute`.

Decision:

Either:

- wrap/replace `git.clone` so GitHub clones require an explicit safe dir, or
- make `repo.ensureCheckout` the preferred tool and block `git.clone` into `/`.

Minimal policy:

```text
Reject GitHub clone where dir is missing or "/".
```

### 4. Remove Misleading Unauthenticated Retry

Target:

- `apps/nanites/src/backend/nanites/git-tools-with-lazy-auth.ts`

Finding:

For `clone`, `fetch`, and `pull`, the lazy auth wrapper can retry without auth after an
installation-token auth rejection.

Decision:

For repositories inside the Nanite's granted GitHub scope:

- do not retry unauthenticated after auth rejection
- return a clear failure
- tell the Nanite to call `ask_human` or `fail`

This prevents half-written checkout state and avoids masking permission/config errors.

### 5. Add API-Only GitHub Commit Affordance If Needed

The production request was "Use the GitHub API to create an empty commit."

If GitHub MCP already exposes enough git-data API tools for:

- get ref
- get commit/tree
- create commit
- update ref

then update prompt/tool guidance to prefer those.

If not, add a narrow Sigvelo/Nanite tool:

```text
github.createEmptyCommit({ repository, branch, message })
```

This should use the installation token and app permissions already scoped by the manager. Keep it
small and capability-bound.

## Implementation Pass 3: Session Hygiene

Do this after the loop-control fix unless the code is already open in the same area.

Target:

- `apps/nanites/src/backend/nanites/agent.ts`
- `configureSession(session)`

Current state:

- `withContext("nanite_identity", ...)`
- `withContext("memory", ...)`

Missing:

- `.onCompaction(...)`
- `.compactAfter(...)`
- `.withCachedPrompt()`

Decision:

Add Think Session compaction using Cloudflare's helper:

```ts
import { createCompactFunction } from "agents/experimental/memory/utils/compaction-helpers";
```

Compaction summary should preserve:

- current run goal
- target repo/ref/PR
- lifecycle status
- completed actions
- attempted tools
- repeated blockers
- open human questions
- next required lifecycle decision

Reference:

- `/tmp/cloudflare-agents-review/docs/sessions.md`
- `/tmp/cloudflare-agents-review/docs/think/lifecycle-hooks.md`
- `/tmp/cloudflare-agents-review/packages/agents/src/experimental/memory/utils/compaction.ts`

## Source Links

### Sigvelo Runtime

- `/apps/nanites/src/backend/nanites/agent.ts`
- `/apps/nanites/src/backend/nanites/host.ts`
- `/apps/nanites/src/backend/nanites/git-auth.ts`
- `/apps/nanites/src/backend/nanites/git-tools-with-lazy-auth.ts`
- `/apps/nanites/src/backend/nanites/tool-output-budget.ts`
- `/apps/nanites/src/backend/nanites/tool-output-artifacts.ts`
- `/apps/nanites/src/backend/workers-ai.ts`
- `/apps/nanites/src/backend/mcp/server.ts`

### Canonical Nanites Docs

- `/docs/architecture/README.md`
- `/docs/architecture/architecture.md`
- `/docs/architecture/execution-architecture.md`
- `/docs/architecture/roadmap.md`
- `/docs/architecture/user-stories.md`

### Cloudflare Think / Agents Source

Local clean clone used during investigation:

- `/tmp/cloudflare-agents-review`

Important files:

- `/tmp/cloudflare-agents-review/docs/think/index.md`
- `/tmp/cloudflare-agents-review/docs/think/lifecycle-hooks.md`
- `/tmp/cloudflare-agents-review/docs/think/programmatic-submissions.md`
- `/tmp/cloudflare-agents-review/docs/think/sub-agents.md`
- `/tmp/cloudflare-agents-review/docs/sessions.md`
- `/tmp/cloudflare-agents-review/docs/durable-execution.md`
- `/tmp/cloudflare-agents-review/docs/long-running-agents.md`
- `/tmp/cloudflare-agents-review/packages/think/src/think.ts`
- `/tmp/cloudflare-agents-review/packages/think/src/tools/execute.ts`
- `/tmp/cloudflare-agents-review/packages/shell/src/git/index.ts`
- `/tmp/cloudflare-agents-review/packages/agents/src/experimental/memory/utils/compaction.ts`

Installed package versions in `apps/nanites/node_modules`:

```text
@cloudflare/think 0.7.2
agents 0.13.2
```

### Debug Artifacts

Local artifacts from production investigation:

- `/tmp/sigvelo-mcp-creds.json`
- `/tmp/sigvelo-commit-bot-debug.json`
- `/tmp/sigvelo-commit-bot-direct-result.json`
- `/tmp/sigvelo-commit-bot-direct-payload.json`
- `/tmp/sigvelo-commit-bot-tools.json`
- `/tmp/sigvelo-commit-bot-workspace.json`

These should not be committed. Regenerate if needed.

## Tests To Add Or Update

Focus tests on behavior, not exact model prose.

### Unit Tests

Add or extend tests around:

- lifecycle `stopWhen` configuration includes lifecycle tools
- no-lifecycle assistant completion triggers exactly one repair submission
- repair submission exposes only lifecycle tools
- repeated similar tool failures trigger terminal-only step config
- `ask_human`/`fail` prompt/tool descriptions include stop-debugging criteria
- API-only task prompt does not require workspace hydration
- `git.clone` without safe dir is rejected or routed through safe wrapper

### Worker/Agent Tests

Use existing Workers test style.

Cases:

1. Nanite completes with lifecycle tool:
   - manager does not create repair submission
   - run terminal status is tool outcome

2. Nanite completes without lifecycle:
   - first Think submission completes
   - repair submission is queued
   - repair turn has lifecycle-only tools

3. Repair turn still fails to call lifecycle:
   - manager fallback marks run failed
   - summary says lifecycle contract was violated

4. Repeated git/workspace failure:
   - beforeStep restricts tools
   - Nanite cannot keep calling `execute` forever

5. API-only manual run:
   - prompt classifies GitHub API path
   - no forced checkout/hydration instruction

### Validation

Run:

```bash
vp install
vp check
vp test
vp build
```

For focused work, start with likely lanes:

```bash
vp test -- tests/backend/*nanite* tests/backend/*mcp*
```

Then run the full suite before release.

## Non-Goals

Do not do these in the first implementation pass:

- Do not replace Think.
- Do not write a custom model loop around Think.
- Do not increase `maxSteps` as the primary fix.
- Do not mirror full transcripts into GitHub.
- Do not solve all GitHub write operations at once.
- Do not generalize into a large Sigvelo tool framework.
- Do not commit `/tmp` debug artifacts or OAuth credentials.

## Expected Outcome

After the fix:

- A Nanite that succeeds calls `complete` or `no_change`.
- A Nanite that needs authority or judgment calls `ask_human`.
- A Nanite that hits repeated deterministic tool failure calls `fail`.
- A Think turn that forgets lifecycle gets one bounded repair turn.
- A Nanite cannot spend hundreds of steps repairing irrelevant workspace/git state.
- API-only GitHub tasks do not automatically hydrate workspace git.
- Long-lived Nanites get Think Session compaction so old tool-debug transcripts do not dominate future context.
