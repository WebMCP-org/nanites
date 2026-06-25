# Historical: Think Lifecycle Control For Nanites

Created: 2026-05-24

This reference is superseded by `docs/architecture/references/workflow-backed-nanite-runs.md`.

The investigation found that direct Think submissions could complete without a model-facing
`complete`, `no_change`, `fail`, or `ask_manager` tool call. The proposed repair path used
`stopWhen`, lifecycle tools, and manager-submitted repair prompts.

That plan is intentionally not active. Nanite Runs now use `NaniteRunWorkflow` with
`ThinkWorkflow.step.prompt()`. Workflow output is a discriminated union, the Workflow reports it with
`reportComplete()`, and the Nanite's SDK Workflow callbacks project results or pre-output failures
through the Manager.

Do not rebuild lifecycle tools, lifecycle repair submissions, or `submitMessages()`-based Run
resumption from this historical note.
