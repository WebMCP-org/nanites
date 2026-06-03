# Nanites Run Model Handoff

This archived handoff translated an earlier Nanites product-model cleanup into engineering guidance.

It is useful for attempt-state and UI-copy details, but it is no longer the active product model.
Current release docs use Installation, Nanite, and Change Proposal as the primary user-facing nouns;
run or work-attempt detail is supporting implementation language.

Authoritative product direction still lives in:

- [architecture.md](/docs/architecture/architecture.md)
- [execution-architecture.md](/docs/architecture/execution-architecture.md)
- [roadmap.md](/docs/architecture/roadmap.md)
- [user-stories.md](/docs/architecture/user-stories.md)

## Archived decision

Keep the runtime sophistication.

This note previously recommended simplifying the product model to three primary nouns:

- `Nanite`: a durable helper configured for a repo
- `Run`: one fresh attempt to do one piece of work
- `Change Proposal`: the output of a run

Today a change proposal may be:

- a support PR
- a no-change result
- an explicit failure with reason

For the current release, prefer the canonical user-facing model:

- `Installation`: the GitHub App permission boundary and Nanite manager
- `Nanite`: a durable helper under an installation
- `Change Proposal`: the reviewable output of a work attempt

Support PR continuity stays. It is an output strategy, not the main noun users have to learn.

## Product contract

These rules should be treated as stable unless there is an explicit product decision to change them:

- new trigger means new run
- new run means fresh working conversation
- resume only happens inside the same run
- old transcripts are not reused across runs
- any memory that survives across runs must be explicit and compact
- backend selection is internal unless it changes trust, timing, or the next required action
- support PR reuse is an output strategy, not the primary product model
- the UI must always answer: what is it doing, what changed, what is it waiting on, what should happen next

## State machine

Recommended user-facing run states:

```text
queued
  -> preparing
  -> investigating
  -> editing
  -> verifying
  -> publishing
  -> paused
  -> completed
  -> failed
  -> superseded
```

Notes:

- `paused` is the user-facing state when the run is waiting on checks, deployments, or other external readiness signals
- `resume` is not a new run; it is a transition from `paused` back into an active state inside the same run
- `superseded` is a terminal state for the old run when a new trigger starts a replacement run
- `completed` should cover shipped proposal and no-change outcomes; the outcome label carries the difference

Recommended mapping from current runtime states:

- `queued` -> `queued`
- `preparing` -> `preparing`
- `investigating` -> `investigating`
- `editing` -> `editing`
- `verifying` -> `verifying`
- `publishing` -> `publishing`
- `awaiting_checks` -> `paused`
- `completed` with success or no-change outcome -> `completed`
- `completed` with failed outcome -> `failed`
- `stale` -> `superseded`

## UI copy changes

The current repo page and contracts may still expose `lane`, `current attempt`, and support-PR-heavy
wording. The next copy pass should make the outcome easy to understand without making `run` a top
level product noun.

Recommended label changes:

- `Signal Nanite` -> `Start run`
- `Starting…` -> `Starting run…`
- `What is a lane?` -> `How runs work`
- `A lane is one repo-scoped nanite with a stable support PR and transcript that can be superseded by new attempts over time.` -> `A Nanite is a repo helper. Each trigger starts a new run. If the run publishes code, Sigvelo may reuse the current change proposal instead of opening a new one.`
- `Selected backend` -> `Execution backend`
- `Work` -> `Work log`
- `PR` -> `Change proposal`
- `Awaiting checks` -> `Paused for checks`
- `No current activity on this Nanite yet.` -> `No recent work for this Nanite.`

Recommended run header fields, in order:

- run goal
- repo and ref used
- current status
- change proposal
- verification state
- files changed
- blocker or next action

Recommended secondary details:

- execution backend
- preview source
- sticky comment link
- raw transcript

## Contract and naming follow-up

The old shared contracts package has been removed. Do not reintroduce `lane` as a primary product
noun in new manager or Nanite runtime surfaces:

- `naniteLaneSnapshot`
- `naniteLaneState`
- `lane-memory`
- `currentAttempt`

That is acceptable for now as internal implementation language.

Short-term rule:

- do not rename runtime structures just to satisfy product copy

Medium-term direction:

- keep internal names if renaming would create churn without user value
- add product-facing adapters that expose `paused`, work-attempt, and change-proposal language at the API and UI boundary where it matters
- only rename internal types when the mismatch starts creating implementation mistakes

## What to hide

Do not make users reason about these by default:

- runtime backend details
- hydration fallback
- recovery branches
- checkpoint commits
- transcript filtering
- chat recovery mechanics
- support PR bootstrap behavior

Keep them in observability, debugging surfaces, and engineering docs.

## What to show

Show these on the main run surface:

- what the run is trying to do
- what repo state it used
- whether it is active, paused, completed, failed, or superseded
- what proposal or outcome it produced
- whether the result is verified
- what changed
- what happens next

## Next-sprint invariants

- Do not reuse old chat transcript as hidden memory for a new run.
- Do not make support PR identity the main explanation for what a Nanite is.
- Do not expose backend routing as a primary product concept.
- Do not let pause and resume semantics stay implicit in the UI.
- Do not require a reviewer to parse raw transcript data before they can find the outcome.

## Non-goals

- No runtime rewrite just to achieve the new product story.
- No broad contract rename from `lane` to `run` in one pass.
- No attempt to remove support PR reuse.
- No attempt to hide backend choice when it explains reliability or wait time.
- No attempt to turn GitHub into the main observability surface.

## Implementation checklist

- Update product docs and UI copy so `Installation`, `Nanite`, and `Change Proposal` are the visible nouns.
- Add a user-facing `paused` state that maps from current `awaiting_checks` behavior.
- Make fresh-run semantics explicit in operator and product documentation.
- Reorder the run view so outcome and next action appear before transcript detail.
- Keep support PR continuity working, but describe it as the current change-proposal surface.
