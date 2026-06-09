---
name: nanites
description: Use when setting up SigVelo access, creating or updating Nanites, writing generated inbound triggers, testing Nanites through MCP, debugging Nanite runs, or improving the Nanites plugin itself. This is the single canonical SigVelo Nanites skill; load focused references as needed.
---

# SigVelo Nanites

Nanites are small durable agents that own one vertical maintenance responsibility inside a GitHub installation. Use this skill for the full Nanite loop: setup, manifest authoring, generated trigger code, MCP acceptance tests, runtime debugging, and plugin upkeep.

## Load Order

- For product or runtime work inside the Nanites repo, read the architecture docs named in `AGENTS.md` before changing runtime behavior.
- For MCP authoring or debugging, load only the focused reference you need:
  - Manifest and trigger authoring: `references/authoring.md`
  - Setup, MCP testing, and troubleshooting: `references/operations.md`
- Prefer improving this skill or one existing reference when a Nanite task teaches reusable operating knowledge.

## Operating Model

- Keep the Nanite definition thin: identity, scope, purpose, stop conditions, `model`, `eventSource`, `permissions`, and root `triggerSource` when the source is machine-originated.
- Generated trigger code routes machine-originated events. It does not own maintenance work, repository writes, cross-Nanite fanout, or lifecycle state.
- Human prompts go directly to the Think Nanite through chat or `sigvelo_start_nanite_run`.
- The installation manager owns policy, capability validation, dispatch, dedupe, and GitHub feedback surfaces.
- The Think Nanite owns investigation, workspace changes, GitHub MCP work, lifecycle outcome, and memory.
- GitHub MCP inventory is derived from `permissions.github.appPermissions`; do not put MCP tiers, tool allowlists, or `capabilities` in `sigvelo_create_nanite`.

## Nanite Quality Bar

- One Nanite owns one durable vertical responsibility, not a generic repo bot or one-off job.
- Its manifest names a clear scope, purpose, and finish condition that another agent can inspect later.
- Its trigger wakes the owning Nanite only when the event gives enough signal for useful work.
- Its permissions cover the repositories and GitHub App grants it needs, with no tool micromanagement.
- Its behavior is proven through `sigvelo_test_nanite_trigger` or `sigvelo_start_nanite_run`, terminal status, and `agentFeedback`.

## Workflow

1. Verify access with `sigvelo_whoami`.
2. Inspect existing Nanites with `sigvelo_debug_nanites` before creating or changing one.
3. Draft a strict `sigvelo_create_nanite` payload: `manifest.id`, `name`, `description`, `model`, `eventSource`, `permissions`, and `triggerSource` for GitHub or schedule sources.
4. Register or update one Nanite with `sigvelo_create_nanite`. For related fleets, create and validate one Nanite before moving to the next.
5. Test generated triggers with `sigvelo_test_nanite_trigger`. Use fixture overrides that satisfy the trigger's repository, branch, action, and path filters.
6. Test manual behavior with `sigvelo_start_nanite_run`.
7. Inspect terminal run status, transcript, submissions, workspace, and `agentFeedback`; iterate until the Nanite actually works.
8. For cleanup, use `sigvelo_cancel_nanite_runs`, `sigvelo_reset_nanite_debug`, or `sigvelo_deprovision_nanite` with an explicit reason.

## Design Rules

- Create many small Nanites instead of one broad maintainer.
- Use `eventSource` as a coarse candidate filter and `triggerSource` as the real generated TypeScript decision. Do not use legacy `trigger` or `inboundTrigger` fields.
- Always include `manifest.model` as an explicit Cloudflare model id string. Pick the cheapest reliable model for the Nanite's job from the current Cloudflare model catalog or provider-native AI Gateway surface; prefer DeepSeek when it is suitable and available.
- Prefer `import { defineGitHubTrigger } from "@sigvelo/nanite-trigger"` for GitHub triggers.
- Return `ctx.noop(...)` with a useful reason for irrelevant events.
- Keep `ctx.dispatchSelf(...)` input small, flat, and JSON-serializable.
- Never write repository changes from a generated trigger. Dispatch the Think Nanite.
- Let the Nanite decide whether to update an existing PR, open a new PR, or create stacked PRs.
- Use generic lifecycle `outputUrl` for the final review URL.
- Do not add manager-owned workflow harnesses unless they enforce product policy or an authorization boundary.
- Do not pass manager names, MCP tiers, runtime classes, tool allowlists, caller-owned ids, or caller-owned timestamps into Nanite manifests.
