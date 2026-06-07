# Nanites Source Index

This is the current source map for Nanites runtime work.

It now includes:

- local SigVelo runtime files
- current `opensrc/` mirrors
- live sibling-repo code in `../npm-packages`, `../char-ai-saas`, and `../WebMCP`
- the extra inputs still needed before deeper executor work

## Current Baseline

From `opensrc/sources.json` on `2026-05-15` after refreshing Cloudflare source:

- `agents` `0.12.4`
- `@cloudflare/think` `0.6.1`
- `@cloudflare/ai-chat` `0.7.0`
- `@cloudflare/shell` `0.3.7`
- `wrangler` `4.92.0`
- `@cloudflare/workers-types` `4.20260515.1`
- `@tanstack/react-router` `1.168.13`

Fresh main-branch mirrors were also pulled into:

- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/workers-sdk/main`

Important local note:

- `../npm-packages` and `../char-ai-saas` both have dirty worktrees right now.
- `../WebMCP` also has a heavily dirty worktree.
- Treat sibling repos as live local references, not clean branches to auto-pull over.

## Local SigVelo Files

Current runtime entrypoints:

- `src/server.ts`
- `wrangler.jsonc`
- `src/backend/agents/SigveloNaniteManager.ts`
- `src/backend/agents/SigveloNaniteAgent.ts`
- `src/backend/nanites/triggers.ts`
- `src/backend/nanites/github-mcp-capabilities.ts`

Historical hybrid execution seams:

- old `hybrid-execution.ts` and `current-attempt-context.ts` paths are no longer active runtime
  entrypoints

Runtime-owned trust surfaces:

- `src/backend/nanites/github-mcp-capabilities.ts`
- `src/backend/github/index.ts`

Contracts and persisted product shape:

- `src/backend/agents/SigveloNaniteManager.ts`
- `src/backend/github/index.ts`
- `src/backend/db/schema.ts`
- `src/backend/db/schema.ts`

Canonical Nanites docs:

- `docs/architecture/architecture.md`
- `docs/architecture/execution-architecture.md`
- `docs/architecture/roadmap.md`
- `docs/architecture/user-stories.md`

## `../char-ai-saas` Sources

Use Char as a pattern source for control-plane and client-tool execution, not as a runtime to copy wholesale.

Control plane and RPC boundary:

- `../char-ai-saas/apps/char-ai-saas/worker/chat/thread-manager.ts`
- `../char-ai-saas/packages/shared-types/src/agent-contracts.ts`

Why they matter:

- thin DO facade over modular runtime helpers
- explicit `@callable()` RPC boundary
- authenticated tool policy validation
- clear separation between persisted state and ephemeral connection state

Tool orchestration and client-tools split:

- `../char-ai-saas/apps/char-ai-saas/worker/chat/thread-agent/chat-orchestrator.ts`
- `../char-ai-saas/apps/char-ai-saas/worker/chat/thread-agent/tool-definitions.ts`

Why they matter:

- `siteTools` trust-boundary parsing
- `createToolsFromClientSchemas(...)` path
- explicit prevention of bad fallback when the client sends an empty tool set
- good example of keeping product tools small and focused

Embed runtime and approval loop:

- `../char-ai-saas/apps/char-ai-saas/src/embed/agent/hooks/useThreadRuntime.tsx`
- `../char-ai-saas/apps/char-ai-saas/src/embed/agent/hooks/useThreadRuntime.client-tools.test.tsx`

Why they matter:

- `onToolCall` driven client execution
- client approval queue pattern
- local execution with server-owned governance checks
- useful for Nanites resume and approval UX thinking even though Nanites is repo-centric, not chat-widget-centric

Architecture notes and reference repo policy:

- `../char-ai-saas/SELF_HOSTED_ARCHITECTURE.md`
- `../char-ai-saas/PLAN.md`
- `../char-ai-saas/externalReferenceRepos/README.md`

Working take:

- Char already solved a clean control-plane/data-plane split.
- Nanites should borrow the boundary discipline, not the whole product surface.

## `../npm-packages` Sources

Use `npm-packages` as the implementation source for the `webmcp-maintainer` lane.

Strict WebMCP contract and schema behavior:

- `../npm-packages/packages/webmcp-types/src/tool.ts`
- `../npm-packages/packages/webmcp-polyfill/src/index.ts`

Why they matter:

- canonical tool annotations and schema types
- Standard Schema plus JSON Schema export expectations
- runtime normalization and validation rules

Browser MCP bridge:

- `../npm-packages/packages/webmcp-ts-sdk/src/browser-server.ts`
- `../npm-packages/packages/global/src/index.ts`

Why they matter:

- `BrowserMcpServer` is the actual `navigator.modelContext` bridge shape
- native-versus-polyfill capture and replacement flow
- good reference for how much magic should stay in the browser layer versus SigVelo

React registration path:

- `../npm-packages/packages/react-webmcp/src/useWebMCP.ts`

Why it matters:

- lifecycle-safe registration and cleanup
- compatibility handling around runtimes that return no unregister handle
- useful when Nanites patches React repos instead of static HTML

Relay and browser-to-local transport:

- `../npm-packages/packages/webmcp-local-relay/src/bridgeServer.ts`
- `../npm-packages/packages/webmcp-local-relay/src/browser/widgetRuntime.ts`

Why they matter:

- concrete browser-to-local relay flow
- source discovery and reconnect behavior
- useful fallback path when customer environments already expose tools locally

Codemode bridge:

- `../npm-packages/packages/codemode/src/webmcp.ts`
- `../npm-packages/packages/codemode/src/iframe-executor.ts`

Why they matter:

- page-local multi-tool orchestration pattern
- browser-native isolated execution model
- useful as a comparison point, not the default Nanites coding executor

Browser verification and tool discovery:

- `../npm-packages/packages/chrome-devtools-mcp/src/tools/webmcp.ts`
- `../npm-packages/packages/chrome-devtools-mcp/tests/tools/webmcp.test.ts`

Why they matter:

- real fallback order for `navigator.modelContext` versus `navigator.modelContextTesting`
- verification of content normalization on tool execution
- strong fit for Nanites browser validation when a live preview exists

Helpful docs inside the repo:

- `../npm-packages/docs/MCPB_PACKAGE_PHILOSOPHY.md`
- `../npm-packages/docs/react-webmcp-guide.md`
- `../npm-packages/packages/global/WEBMCP-CONFORMANCE-REFERENCES.md`

## `../WebMCP` Sources

Use `WebMCP` as the strongest current reference for no-mock system testing and release confidence.

System e2e operations:

- `../WebMCP/docs/ops/testing-and-release.md`
- `../WebMCP/playwright.system.config.ts`
- `../WebMCP/scripts/run-system-e2e-stack.mjs`

Real browser helpers and specs:

- `../WebMCP/tests/playwright/extension-context.ts`
- `../WebMCP/tests/system/mcp-b-system-real-browser.spec.ts`
- `../WebMCP/apps/extension/e2e/extension-real-browser.spec.ts`

Why they matter:

- root scripts build real artifacts before e2e
- Playwright starts the local product stack instead of intercepting requests
- browser tests load the real MV3 extension into Chromium
- system tests assert observable app, iframe, auth, storage, socket, and MCP behavior
- test helpers hide launch/readiness mechanics without replacing product modules

Nanites should copy the boundary discipline, not the exact product stack. In particular, Nanites e2e
should be stricter about GitHub and Cloudflare: if the behavior under test is a webhook, check run,
installation token, Worker runtime, Durable Object, or Agent chat, the e2e test should cross the
real boundary. The only planned substitution is a deterministic LLM provider shim when model output
must be controlled.

## Cloudflare `opensrc/` Mirrors

Core runtime:

- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/packages/agents/src/index.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/packages/agents/src/workflows.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/packages/think/src/think.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/packages/think/src/extensions/manager.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/packages/think/src/extensions/host-bridge.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/packages/think/src/tools/execute.ts`

Execution-focused docs:

- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/docs/think/index.md`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/docs/think/tools.md`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/docs/think/lifecycle-hooks.md`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/docs/sessions.md`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/docs/workflows.md`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/docs/durable-execution.md`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/docs/long-running-agents.md`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/docs/mcp-client.md`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/design/loopback.md`

Useful implementation mirrors:

- `opensrc/repos/github.com/cloudflare/agents/packages/shell/src/git/index.ts`

Examples worth keeping nearby:

- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/examples/dynamic-workers/src/server.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/examples/dynamic-workers-playground/src/server.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/examples/dynamic-workers-playground/src/logging.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/examples/workspace-chat/src/server.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/examples/github-webhook/src/server.ts`
- `/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/main/examples/codemode/README.md`

Working take after the refresh:

- `Think` should be the host run/chat harness, not assumed to be the generated deployment unit.
- `WorkerLoader` Dynamic Workers are the generated-code primitive for Nanites.
- Generated code should receive loopback bindings or Think extension host bridges, not raw secrets.
- `globalOutbound: null`, Tail Workers, and custom limits are first-class runtime controls.
- Durable Object facets are the candidate for generated durable state. They need a spike before becoming the default.
- Workers for Platforms dispatch namespaces are useful for later user Worker deployment and routing, but are not the core primitive for the first Nanites rewrite.

## Official Docs

Agents:

- https://developers.cloudflare.com/agents/
- https://developers.cloudflare.com/agents/workflows/
- https://developers.cloudflare.com/agents/human-in-the-loop/

Browser rendering:

- https://developers.cloudflare.com/browser-rendering/
- https://developers.cloudflare.com/browser-rendering/playwright/
- https://developers.cloudflare.com/browser-rendering/workers-bindings/

## Other Needed Items

These are the extra inputs still missing or still worth making explicit before more runtime work lands:

- Use GitHub repository size and related metadata from Octokit-shaped installation
  repository objects instead of inferring executor choice from partial local DTOs.
- Decide the default browser-side WebMCP patch lane per repo shape:
  `@mcp-b/global` CDN tag,
  package install with `@mcp-b/global`,
  `@mcp-b/react-webmcp`,
  or a relay-only/testing-only path.
- Keep SigVelo runtime-owned terminal actions separate from borrowed executor patterns:
  publish,
  verify,
  complete,
  fail.
- Refresh `opensrc/` or Char external refs only when the relevant upstream API actually moved.
  Do not auto-pull dirty sibling worktrees as part of routine Nanites edits.
- Treat Char as the best reference for control-plane discipline and client-tool approval flow.
  Treat `npm-packages` as the best reference for browser WebMCP instrumentation and verification surfaces.

## Five Starting Files

If I had to hand someone only five starting files right now, I would choose:

- `src/backend/agents/SigveloNaniteManager.ts`
- `src/backend/agents/SigveloNaniteAgent.ts`
- `src/backend/nanites/triggers.ts`
- `../char-ai-saas/apps/char-ai-saas/worker/chat/thread-agent/chat-orchestrator.ts`
- `docs/architecture/references/github-mcp-capability-assignment.md`
