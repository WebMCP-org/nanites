# Nanites Runtime Rewrite

This directory is the new Nanites control-plane home.

Current owners:

- `manager.ts` owns the manager agent state machine: registered Nanites, runs, trigger dedupe,
  human requests, and terminal status transitions.
- `nanite-agent.ts` owns the stable Think sub-agent runtime: durable chat history, workspace access,
  execution tools, GitHub-aware git auth, and lifecycle tools.
- `manager-chat.ts` owns the manager chat path and Chat SDK ingress.
- `tools/` owns the public Nanites manager tools with one file per public tool and shared
  definition/telemetry mechanics in `tools/define-tool.ts`.
- `github-mcp-capabilities.ts` owns permission-derived GitHub MCP tool inventory.
- `language-model.ts` owns the Workers AI language-model adapter used by Nanite runtimes.
- `triggers.ts` owns generated inbound trigger execution through Worker Loader and the small GitHub
  event fixture library used by trigger acceptance tests.
- `tool-output.ts` owns temporary output artifacts and inline output budgeting.

The manager `testNaniteTrigger` callable is the authoring-agent acceptance loop. It builds a
fixture event, runs the Nanite's generated inbound trigger, dispatches the real Think sub-agent,
waits for a lifecycle outcome, and returns any `agentFeedback` the Nanite provides to the coding
agent. MCP exposes that same manager primitive as `sigvelo_test_nanite_trigger`; browser UI can call
the manager callable directly when it needs trigger testing.

Nanites own their GitHub change proposal strategy through their workspace, git, GitHub tools, and
prompt contract. Do not add manager-owned branch naming, support-lane state, or a single enforced PR
publisher around them. When a Nanite needs stacked PRs, the prompt-level contract is enough: bottom
branch targets the default branch, higher branches target the branch below, PRs stay small and
reviewable, and `complete.outputUrl` points at the best review entrypoint.

GitHub MCP access should be Nanite-scoped. The Installation Manager may use broad GitHub MCP
access for the selected installation while it investigates and delegates, but each Nanite runtime
gets a separate token for only the Nanite's repositories and derived token permissions. The manager
then exposes only the GitHub MCP tools derived from that Nanite's GitHub App permissions. Do not use
classic PAT assumptions here; GitHub installations cannot mint them, and the official GitHub MCP
server does not automatically scope-filter installation tokens. Prefer Workspace git tools for code
changes and GitHub MCP for PR/search/status operations.

Do not add a shared Nanites contracts package by default. The browser already gets typed RPC through
the Agents SDK when it talks to the manager agent. Validate untrusted boundaries such as MCP
registration and model-authored lifecycle tool calls; do not make the manager defensively re-parse
state it owns.

Add new modules only when a real vertical path needs them.
