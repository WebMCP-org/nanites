# Nanite Lifecycle Watchdog Primitives

> Historical reference.

This plan was superseded by Workflow-backed Runs. Active Run durability now belongs to
`NaniteRunWorkflow` via `ThinkWorkflow.step.prompt()`, documented in
`workflow-backed-nanite-runs.md`.

Do not reintroduce lifecycle continuation prompts, watchdog nudges, or manager-driven
`submitMessages()` repair for normal Runs. Add a new watchdog only if production evidence shows a
failure mode that Cloudflare Workflows and Think prompt recovery do not cover.
