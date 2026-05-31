# Nanites user stories

## Purpose

These user stories define the product shape future work should reinforce.

They are not implementation tickets. They are the reference language for deciding whether a change improves the product or just adds more infrastructure.

## Priority now

### Repo selection

As a repo owner, I can tell which repositories are worth running Sigvelo on before I open them.

Signals should include:

- whether a public-facing web surface likely exists
- whether preview infrastructure likely exists
- whether the repo looks too large or process-heavy for the default path

### Trustworthy run outcome

As a reviewer, I can open a run and immediately see:

- what change proposal I am supposed to review
- whether the result is verified, unverified, or failed verification
- which preview or environment produced that result
- which files changed
- what the Nanite wants me to do next

### Large-repo reliability

As an investor, evaluator, or first-time user, I can run Sigvelo on a serious repository without the product failing at hydration before it proves value.

That means backend routing and fallback are product requirements, not internal implementation details.

## Priority next

### Stable change proposal surface

As a maintainer, when repeated runs produce code changes, Sigvelo reuses the current change proposal instead of opening a new PR every time it touches the same area.

### Honest verification

As a frontend lead, I can trust the verification label because Sigvelo only claims `verified` when it observed a real preview and produced browser evidence against it.

### Human checkpoints

As a reviewer, I can approve, redirect, or reject a risky Nanite action without losing the rest of the run context.

## Later

### Portfolio view

As an account owner, I can see which repos are healthy, which Nanites are active, which change proposals are open, and which repos are blocked on preview or runtime issues.

### Multiple specialists

As a team, I can add more named Nanites over time without changing the core mental model of installation, Nanite, and change proposal.

Examples:

- `webmcp-maintainer`
- `keep-browser-smoke-path-green`
- `test-fixer`
- `docs-syncer`

## Anti-stories

These are behaviors the product should avoid.

- As a user, I do not want Sigvelo to flood GitHub with many comments.
- As a reviewer, I do not want to parse raw transcript data before I can understand the outcome.
- As a maintainer, I do not want a new PR every time the same Nanite revisits the same area of work.
- As an operator, I do not want backend routing to be invisible when it affects run behavior or reliability.
