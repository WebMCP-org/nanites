# Nanites Source Index

This source map is for Nanites runtime work. It names the repo-local files to read first and records
which external reference themes shaped the current design without depending on any local checkout
layout.

## Current Baseline

Runtime design was checked against these package versions on 2026-05-15:

- `agents` `0.12.4`
- `@cloudflare/think` `0.6.1`
- `@cloudflare/ai-chat` `0.7.0`
- `@cloudflare/shell` `0.3.7`
- `wrangler` `4.92.0`
- `@cloudflare/workers-types` `4.20260515.1`
- `@tanstack/react-router` `1.168.13`

Fresh main-branch mirrors were also pulled into:

- `opensrc/repos/github.com/cloudflare/agents/main`
- `opensrc/repos/github.com/cloudflare/workers-sdk/main`

## Local SigVelo Files

Current runtime entrypoints:

- `src/server.ts`
- `wrangler.jsonc`
- `src/backend/agents/SigveloNaniteManager.ts`
- `src/backend/agents/SigveloNaniteAgent.ts`
- `src/backend/nanites/triggers.ts`
- `src/backend/nanites/github-mcp-capabilities.ts`

Runtime-owned trust surfaces:

- `src/backend/nanites/github-mcp-capabilities.ts`
- `src/backend/github/index.ts`

Contracts and persisted product shape:

- `src/backend/agents/SigveloNaniteManager.ts`
- `src/backend/github/index.ts`
- `src/backend/db/schema.ts`

Canonical Nanites docs:

- `docs/architecture/architecture.md`
- `docs/architecture/execution-architecture.md`
- `docs/architecture/roadmap.md`
- `docs/architecture/user-stories.md`

## External Reference Themes

Control-plane and client-tool execution references mattered for:

- thin Durable Object facades over modular runtime helpers
- explicit RPC boundaries
- authenticated tool policy validation
- separation between persisted state and ephemeral connection state
- client approval queues with server-owned governance checks

Browser WebMCP references mattered for:

- canonical tool annotations and schema export expectations
- browser-side registration and cleanup
- native-versus-polyfill capture and replacement flow
- browser-to-local relay and reconnect behavior
- verification against real preview surfaces

No-mock system testing references mattered for:

- building real artifacts before e2e
- starting the local product stack instead of intercepting requests
- asserting observable app, iframe, auth, storage, socket, and MCP behavior
- hiding launch/readiness mechanics without replacing product modules

Cloudflare runtime references mattered for:

- Agents, Think, Workspace, Shell, Codemode, Worker Loader, Workflows, and Durable Objects
- generated Dynamic Worker code as the trigger primitive
- Workflow-backed run orchestration
- Workspace-backed file and git operations
- MCP attachment through the Think runtime

## Cloudflare `opensrc/` Sources

Core runtime:

- `opensrc/repos/github.com/cloudflare/agents/main/packages/agents/src/index.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/packages/agents/src/workflows.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/packages/think/src/think.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/packages/think/src/extensions/manager.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/packages/think/src/extensions/host-bridge.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/packages/think/src/tools/execute.ts`

Execution-focused docs:

- `opensrc/repos/github.com/cloudflare/agents/main/docs/think/index.md`
- `opensrc/repos/github.com/cloudflare/agents/main/docs/think/tools.md`
- `opensrc/repos/github.com/cloudflare/agents/main/docs/think/lifecycle-hooks.md`
- `opensrc/repos/github.com/cloudflare/agents/main/docs/sessions.md`
- `opensrc/repos/github.com/cloudflare/agents/main/docs/workflows.md`
- `opensrc/repos/github.com/cloudflare/agents/main/docs/durable-execution.md`
- `opensrc/repos/github.com/cloudflare/agents/main/docs/long-running-agents.md`
- `opensrc/repos/github.com/cloudflare/agents/main/docs/mcp-client.md`
- `opensrc/repos/github.com/cloudflare/agents/main/design/loopback.md`

Useful implementation mirrors:

- `opensrc/repos/github.com/cloudflare/agents/packages/shell/src/git/index.ts`

Examples worth keeping nearby:

- `opensrc/repos/github.com/cloudflare/agents/main/examples/dynamic-workers/src/server.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/examples/dynamic-workers-playground/src/server.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/examples/dynamic-workers-playground/src/logging.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/examples/workspace-chat/src/server.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/examples/github-webhook/src/server.ts`
- `opensrc/repos/github.com/cloudflare/agents/main/examples/codemode/README.md`

## Other Needed Items

These inputs are still worth making explicit before more runtime work lands:

- use GitHub repository size and related metadata from Octokit-shaped installation repository
  objects instead of inferring executor choice from partial local DTOs
- decide the default browser-side WebMCP patch lane per repo shape: CDN tag, package install,
  React package, or relay/testing-only path
- keep runtime-owned terminal actions separate from borrowed executor patterns: publish, verify,
  complete, fail
- refresh upstream references only when the relevant API actually moved
- treat external examples as boundary guidance, not implementation to copy

## Five Starting Files

- `src/backend/agents/SigveloNaniteManager.ts`
- `src/backend/agents/SigveloNaniteAgent.ts`
- `src/backend/nanites/triggers.ts`
- `docs/architecture/references/github-mcp-capability-assignment.md`
- `docs/architecture/execution-architecture.md`
