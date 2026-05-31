# Agent App Testing Golden Standard

This document defines the testing philosophy for the Nanites app and the durable test lanes that enforce it.

The short version:

- we test the application, not isolated helpers
- we mock only the external systems we do not control
- when we fake an external boundary, we fake it with contract-validated payloads
- durable assertions target user-visible behavior, response shapes, and persisted artifacts

## Context

Nanites is a Cloudflare Worker backend with a React + TanStack Router frontend and an oRPC/OpenAPI surface.

That stack gives us clear product boundaries:

- browser UI routes
- Worker HTTP routes
- GitHub webhooks at `POST /api/github/webhook`
- typed RPC transport under `/rpc`
- OpenAPI routes under `/api`

Those boundaries should own our durable regressions.

## Repo signals

The current repo already points toward the right testing doctrine:

- the Worker entrypoint routes real webhook traffic, then OpenAPI and RPC handlers
- the lint configuration bans `vi`/`jest` mock APIs in tests
- browser tests run in Vitest Browser Mode with Playwright
- backend tests run in the Workers runtime with `@cloudflare/vitest-pool-workers`
- browser tests use MSW only at the HTTP boundary
- shared route and RPC constants live in app code under `src/shared/constants`
- synthetic GitHub payloads and GitHub API fixtures are contract-gated before tests inject them

This is the correct direction for this app.

## Non-negotiable doctrine

## 1. Disposable TDD unit tests only

Short-lived unit tests are allowed while shaping new behavior.

They are not the durable testing strategy.

Once the behavior is covered by the correct browser, backend, or e2e lane, temporary helper-heavy tests should be deleted or demoted. Durable regressions should live on real boundaries.

## 2. No app-internal mocks in durable tests

Durable tests do not use:

- `vi.mock`
- `vi.fn`
- `spyOn`
- jest mocks
- fake app stores
- fake router implementations
- stubbed app modules

Durable tests should execute real app code paths.

The one acceptable place to fake behavior is at an external boundary we do not control, such as GitHub HTTP traffic.

## 3. Schema-first contracts at every synthetic edge

Any payload invented by a test should be runtime-validated before the app consumes it.

That includes:

- MSW responses returned to the browser
- signed GitHub webhook payloads
- mocked GitHub REST responses in backend tests

For internal app contracts, prefer schemas from `@nanites/contracts/*`.

For external provider payloads that are not part of `@nanites/contracts`, prefer the provider's canonical types and keep fixture shaping local to the tests that need it. Add a runtime schema only when raw external JSON is immediately consumed structurally by the app.

The important rule is not where the schema lives. The important rule is that durable fixtures are not unchecked JSON blobs.

## 4. Real integration surfaces over implementation details

Durable assertions should target outcomes such as:

- rendered UI states
- auth/session behavior visible at the route layer
- HTTP status and response shape
- warmed manager state
- run progression
- published support artifacts

Durable assertions should avoid:

- helper call counts
- internal method ordering
- assertions that only prove wiring inside a single function

## 5. Webhook authenticity is part of the product contract

GitHub webhooks should be signed exactly as GitHub signs them.

Real backend and e2e lanes should not bypass signature verification except for explicit negative tests.

If a durable test needs a webhook, it should build a contract-validated payload, serialize it, sign it, and send it through the real route.

## 6. Exact LLM prose is not a durable assertion target

For agent flows, assert milestones and artifacts:

- run started
- run completed
- final state visible in UI
- artifact or support output exists

Do not pin durable tests to exact generated wording unless the wording itself is the product contract.

## The three durable lanes

## Type 1: Browser slice tests

Runner:

- Vitest Browser Mode with Playwright

Purpose:

- validate real browser runtime behavior
- validate route-tree behavior and frontend data flow
- keep the backend synthetic in this lane by mocking HTTP only

Allowed:

- MSW browser worker handlers
- per-test handler overrides
- contract-validated response payloads
- production-faithful router mounting

Disallowed:

- app module mocks
- fake stores for app internals
- replacing the real route tree with hand-rolled component probes when the goal is product coverage

Current implementation in this repo:

- `tests/helpers/browser-test.ts`
- `tests/helpers/browser-msw-setup.ts`
- `tests/helpers/msw-browser-worker.ts`
- `tests/helpers/render-app.tsx`
- `tests/browser/repositories.browser.test.tsx`

The standard for this lane is: mount a real app surface, keep MSW at the HTTP edge, and assert rendered outcomes.

## Type 2: Backend integration tests

Runner:

- `@cloudflare/vitest-pool-workers`

Purpose:

- validate Worker routes and runtime behavior
- validate auth, webhook ingestion, and downstream state changes
- execute real app code under the Workers runtime

Allowed:

- real HTTP requests against the Worker entrypoint
- real signed webhook delivery
- external-boundary mocks for GitHub only
- follow-up assertions against durable state or product-visible outputs

Disallowed:

- mocking app modules such as `github.ts`, router code, or Nanites internals
- bypassing the route layer to test behavior that should be proven by request flow

Current implementation in this repo:

- `tests/backend/vitest.config.ts`
- `tests/backend/github-webhook-boundary.test.ts`
- `tests/contracts/github-webhooks.ts`
- `tests/contracts/github-rest.ts`
- `tests/helpers/github-api-mock.ts`

The standard for this lane is: send a real request in, then prove a real downstream outcome.

## Type 3: E2E system tests

Runner:

- Playwright

Purpose:

- validate full user-story correctness across the real frontend and backend
- prove the app works as a product, not just as separate technical slices

Allowed:

- real browser automation
- real backend
- real user actions
- real webhook simulation when required for system progression
- real low-cost model usage when economically safe

Disallowed:

- network stubs for the core product flow
- assertions on exact model prose

Status:

- reserved but not scaffolded yet in the repository root app

The standard for this lane is: assert user-visible progression and artifacts, not internal implementation.

## Current implemented foundation

The repo currently has the following durable foundation in place:

- lane-specific Vitest configs for browser and backend tests
- fail-fast MSW browser worker lifecycle management in Browser Mode setup
- a real route-tree browser harness over the app dashboard
- app-owned route and RPC constants
- contract-validated GitHub webhook fixture builders
- contract-validated mocked GitHub REST responses
- a signed backend webhook test that warms real manager state

Representative files:

- `vite.config.ts`
- `tests/browser/vitest.config.ts`
- `tests/backend/vitest.config.ts`
- `tests/helpers/browser-msw-setup.ts`
- `tests/browser/repositories.browser.test.tsx`
- `tests/backend/github-webhook-boundary.test.ts`
- `tests/helpers/render-app.tsx`
- `tests/contracts/github-webhooks.ts`
- `tests/contracts/github-rest.ts`
- `src/shared/constants/routes.ts`
- `src/shared/constants/rpc.ts`

## What still needs to happen

The foundation is real, but it is not complete.

The next work is:

1. Add browser coverage for auth/session redirects and installation states on real route surfaces.
2. Add backend auth and installation revalidation tests through real Worker requests.
3. Add more webhook flows that prove run progression or published artifacts, not just warmed manager state.
4. Add the first Playwright happy-path e2e journey.
5. Encode lane policy in CI so the doctrine is enforced by automation.

## Coverage matrix

Every critical surface should have an explicit durable lane owner.

| Surface                           | Minimum lane      | Why                                            |
| --------------------------------- | ----------------- | ---------------------------------------------- |
| Browser auth/session routes       | Backend + Browser | correctness plus UI handling                   |
| Repository selector/dashboard     | Browser + E2E     | route/runtime behavior plus user journey       |
| GitHub webhook ingestion          | Backend + E2E     | signed contract handling plus full progression |
| Nanite runtime transitions        | Backend           | request-driven state correctness               |
| Support PR/check output           | Backend + E2E     | output correctness plus user-visible result    |
| RPC/OpenAPI auth and error shapes | Backend           | contract and status-shape correctness          |

## Practical opinions for this app

1. Browser Mode should remain the default frontend durable lane. It catches real browser and routing behavior that jsdom-style tests miss.
2. Backend confidence should come from request-driven Worker tests, not a large pile of helper specs.
3. The no-mocks lint rule is a feature, not a nuisance. It protects the doctrine.
4. GitHub is the main external system we do not control, so it is the right place to allow careful external-boundary fakes.
5. E2E should stay narrow and high-signal. One stable user-story flow is better than several brittle ones.

## Writing tests with AI

AI-generated tests are useful only when the prompt includes the lane, the real code under test, and the existing test patterns for that lane.

When asking an agent to write or revise tests for the repository root app, include:

- the source file or route being tested, including imports and relevant types
- the matching lane config: `vite.config.ts`, `tests/browser/vitest.config.ts`, `tests/backend/vitest.config.ts`, or `tests/e2e/vitest.config.ts`
- one nearby test from the same lane
- any contract schemas or fixture builders used at the boundary
- this document and `tests/README.md`

Tell the agent which lane owns the behavior:

- Browser route behavior belongs in `tests/browser` with Browser Mode and MSW handlers at the HTTP boundary.
- Worker route, auth, oRPC, webhook, and state behavior belongs in `tests/backend` with `@cloudflare/vitest-pool-workers`.
- Nanites full-flow behavior belongs in `tests/e2e` and should not use MSW or app-internal mocks.

Be explicit about what not to do. Durable tests must not use `vi.mock`, `vi.fn`, `spyOn`, fake stores, or mocked app modules. If a fake is needed, it should sit at an external boundary such as GitHub REST or Browser Mode HTTP.

Good prompts name the behavior and the edge cases:

```text
Add backend tests for the MCP OAuth token route. Use the Worker runtime lane in tests/backend.
Send real requests through worker.fetch. Cover missing code, invalid client, successful token
exchange, and refresh-token exchange. Do not mock app modules. Use existing OAuth schemas and
follow tests/backend/mcp-oauth.test.ts style.
```

Review generated tests before keeping them:

- Do they assert an observable outcome such as rendered UI, status code, response body, persisted state, run progression, or published GitHub artifact?
- Would the test still pass if the implementation changed but the behavior stayed correct?
- Are synthetic payloads parsed through canonical schemas or typed fixture builders?
- Are MSW handlers registered through the browser worker and reset by setup, not by ad hoc local lifecycle code?
- Does the command exit? Use `vp test`, `vp run test`, or `vp run test:e2e`, not watch mode.

Common fixes for AI output:

- Replace Jest APIs with the repo's Vitest/Vite+ APIs.
- Remove app-internal mocks and assert through a product boundary instead.
- Shorten verbose test names to the behavior under test.
- Replace unchecked JSON fixtures with schema-validated builders.
- Move setup into lane helpers only when more than one test needs it.

## Research sources

- Vitest Browser Mode guide: https://vitest.dev/guide/browser/
- MSW Vitest Browser Mode recipe: https://mswjs.io/docs/recipes/vitest-browser-mode
- OpenAPI TypeScript testing with MSW: https://openapi-ts.dev/openapi-fetch/testing
- Cloudflare Workers Vitest integration: https://developers.cloudflare.com/workers/testing/vitest-integration/
- GitHub webhook signature validation: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- Playwright best practices: https://playwright.dev/docs/best-practices
- oRPC OpenAPI getting started: https://orpc.dev/docs/openapi/getting-started
