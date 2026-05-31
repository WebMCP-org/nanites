# Agent Test Lanes

This directory contains the durable testing lanes for `apps/nanites`.

Read [testing-golden-standard.md](../docs/testing-golden-standard.md) for the full philosophy. This README is the operational view.

## Lanes

- `tests/browser`: Vitest Browser Mode tests that mount real app surfaces and mock only HTTP with MSW.
- `tests/backend`: Workers runtime integration tests that send real requests through the Worker and mock only external providers we do not control.
- `tests/contracts`: Test-local fixture builders for durable synthetic edges, typed from the same provider and runtime surfaces the app uses.
- `tests/helpers`: Shared lane helpers such as browser worker setup, route-tree rendering, and external HTTP mocking.
- `tests/e2e`: Nanites product e2e through real Worker, Agent, webhook, GitHub, and browser
  boundaries as needed.

## Rules

1. Durable tests exercise real product boundaries.
2. Durable tests do not mock app-internal modules, functions, or stores.
3. Synthetic payloads should use canonical app or provider types, and any raw external JSON the app immediately decodes should still pass through a runtime schema at that boundary.
4. Shared endpoint and transport paths should come from app-owned constants under `src/shared/constants`.
5. Assertions should target rendered output, HTTP behavior, persisted state, or published artifacts.
6. Nanites e2e is stricter than the lower lanes: no mocks anywhere except the explicit deterministic
   LLM provider shim when model output must be controlled.

## Current foundation

- Browser lane:
  - real route-tree harness in `tests/helpers/render-app.tsx`
  - fail-fast MSW lifecycle in `tests/helpers/browser-msw-setup.ts`
  - typed MSW worker access through `tests/helpers/browser-test.ts`
  - dashboard route slice in `tests/browser/repositories.browser.test.tsx`
  - local authenticated browsing is separate from this lane; browser tests stay MSW-backed and do not require a GitHub user token
- Backend lane:
  - Worker runtime via `@cloudflare/vitest-pool-workers`
  - signed webhook boundary test in `tests/backend/github-webhook-boundary.test.ts`
  - GitHub external-boundary fixture builders in `tests/contracts`
- E2E lane:
  - real Worker smoke test in `tests/e2e/nanites-runtime.e2e.test.ts`
  - Nanites-specific no-mock rules in `tests/e2e/README.md`
  - next tests should replace todos one vertical behavior at a time

## Commands

- `vp test` or `vp run test` from `apps/nanites` runs the browser and backend lanes declared in `vite.config.ts`.
- `vp run test:e2e` runs the Nanites e2e lane declared in `tests/e2e/vitest.config.ts`.
- Root `vp test` intentionally excludes `apps/nanites`; Worker and Browser Mode tests must run through the app config so `cloudflare:test` and browser globals are available.

## Current gaps

1. Browser auth/session flows still need explicit route-level coverage.
2. Backend tests still need more follow-up assertions through product-visible HTTP surfaces.
3. Additional webhook flows should cover run progression and published artifacts.
4. The first Playwright happy path still needs to be added.

## Local auth note

Live local browser verification through `/auth/test/mint-session` requires a real GitHub user token.

Provide it with one of:

- `GITHUB_TEST_USER_TOKEN`
- `x-github-test-user-token`
- `?githubAccessToken=...`
