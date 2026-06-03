# Nanites Runtime Rewrite

This directory is the new Nanites control-plane home.

Current owners:

- `host.ts` owns the manager agent state machine: registered Nanites, runs, trigger dedupe,
  human requests, and terminal status transitions.
- `agent.ts` owns the stable Think sub-agent runtime: durable chat history, workspace access,
  execution tools, GitHub-aware git auth, and lifecycle tools.
- `manager-conversation-agent.ts` and `chat-ingress.ts` own the manager chat path.
- `manager-tools.ts` owns the shared MCP-style Nanite manager tool context, schemas, explicit tool
  definitions, and handlers used by MCP and manager chat.
- `github-mcp-capabilities.ts` owns Nanite-scoped GitHub MCP capability validation.
- `language-model.ts` owns the Workers AI language-model adapter used by Nanite runtimes.
- `github-trigger-fixtures.ts` owns the small GitHub event fixture library used by trigger
  acceptance tests.
- `trigger-runtime.ts` owns generated inbound trigger execution through Worker Loader.

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

GitHub MCP capability should be Nanite-scoped. The Installation Manager may use broad GitHub MCP
access for the selected installation while it investigates and delegates, but each Nanite runtime
gets a separate token for only the Nanite's repositories and derived token permissions. The manager
then exposes only the GitHub MCP tools granted by that Nanite Capability. Do not use classic PAT
assumptions here; GitHub installations cannot mint them, and the official GitHub MCP server does not
automatically scope-filter installation tokens. Prefer Workspace git tools for code changes and
GitHub MCP for PR/search/status operations.

Do not add a shared Nanites contracts package by default. The browser already gets typed RPC through
the Agents SDK when it talks to the manager agent. Validate untrusted boundaries such as MCP
registration and model-authored lifecycle tool calls; do not make the manager defensively re-parse
state it owns.

Add new modules only when a real vertical path needs them.
