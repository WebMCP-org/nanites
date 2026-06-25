# Nanites E2E Lane

This lane is for product e2e tests that run through real product boundaries.

## Purpose

E2E owns user-story confidence for Nanites.

Browser and backend lanes prove technical correctness at narrower boundaries. This lane proves the
Nanites product path the way a user or external system experiences it: signed triggers, Durable
Object state, Agents SDK RPC or WebSocket chat, stable Nanite agent execution, GitHub output,
and live log visibility.

## Rules

1. No mocks in this lane, including app-internal mocks, `vi.mock`, MSW, global `fetch` mocks,
   Playwright route interception, fake GitHub clients, fake Durable Objects, or fake Agents SDK
   transports.
2. The only allowed substitution is a sanctioned deterministic LLM provider shim, currently the
   CopilotKit LLM mock if a test needs model output. The rest of the stack must stay real.
3. If a webhook is needed for progression, send a real signed webhook through the real route.
4. If GitHub writes are asserted, use a real GitHub test installation/repository/token. Do not
   replace Octokit with a fake client in e2e.
5. If Cloudflare runtime behavior is asserted, use the real Worker runtime boundary available to the
   lane: `@cloudflare/vitest-pool-workers` for Worker-boundary tests or Playwright plus local dev
   server when the browser journey matters.
6. Assert milestones, status transitions, logs, checks, and artifacts. Do not assert exact LLM prose.
7. Add Playwright only when the user-visible browser journey is the behavior under test.

## First target scenario

The first real Nanites e2e test should stay narrow and vertical:

1. Register one fixture Nanite through the real manager/control-plane boundary.
2. Deliver one real signed GitHub webhook event through the real route.
3. Observe exactly one visible run.
4. Let the fixture Nanite reach one terminal state through the real Workflow output boundary.
5. Assert one durable product artifact: a run summary, check output, or live chat pointer.

## Research References

Use system-test references that start real services, drive real browser/app paths, and assert
observable product behavior. Nanites should be stricter about GitHub and Cloudflare: do not
substitute those surfaces when they are the behavior under test.

Cloudflare Agents SDK e2e references are useful for real Worker, Durable Object, WebSocket/RPC,
dynamic Worker, and process-restart patterns. Do not copy model/provider mocks into Nanites e2e
unless the explicit LLM shim is the behavior boundary being controlled.

Relevant local mirrors:

- `opensrc/repos/github.com/cloudflare/agents/packages/think/src/e2e-tests`
- `opensrc/repos/github.com/cloudflare/agents/packages/agents/src/e2e-tests`
- `opensrc/repos/github.com/cloudflare/agents/packages/codemode/e2e`

## Commands

From the repository root:

```bash
vp run test:e2e
```
