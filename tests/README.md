# Agent Test Lanes

This directory contains the durable testing lanes for the root Nanites app.

Read [testing-golden-standard.md](../docs/testing-golden-standard.md) for the full philosophy. This README is the operational view.

## Lanes

- `tests/browser`: Vitest Browser Mode tests that mount real app surfaces and mock only HTTP with MSW.
- `tests/backend`: Workers runtime integration tests that send real requests through the Worker and mock only external providers we do not control.
- `tests/helpers`: Shared lane helpers such as browser worker setup and external HTTP mocking.
- `tests/e2e`: Nanites product e2e through real Worker, Agent, webhook, GitHub, and browser
  boundaries as needed.

## Rules

1. Durable tests exercise real product boundaries.
2. Durable tests do not mock app-internal modules, functions, or stores.
3. Synthetic payloads should use canonical app or provider types, and any raw external JSON the app immediately decodes should still pass through validation at that boundary.
4. Shared endpoint and transport paths should come from owner constants such as `src/shared/constants.ts`.
5. Assertions should target rendered output, HTTP behavior, persisted state, or published artifacts.
6. Nanites e2e is stricter than the lower lanes: no mocks anywhere except the explicit deterministic
   LLM provider shim when model output must be controlled.

## Current foundation

- Browser lane:
  - fail-fast MSW lifecycle in `tests/helpers/browser-msw-setup.ts`
  - local authenticated browsing is separate from this lane; browser tests stay MSW-backed and do not require a GitHub user token
  - no active browser tests are kept until they mount a real route/app surface
- Backend lane:
  - Worker runtime via `@cloudflare/vitest-pool-workers`
  - deployment auth coverage in `tests/backend/browser-auth-routes.test.ts`
  - generated trigger and signed webhook coverage in `tests/backend/nanite-trigger-runtime.test.ts`
  - GitHub external-boundary HTTP mocking in `tests/helpers/github-api-mock.ts`
- E2E lane:
  - lane config and stricter no-mock guidance are in `tests/e2e`
  - Nanites-specific no-mock rules in `tests/e2e/README.md`
  - next tests should replace todos one vertical behavior at a time

## Commands

- `vp test` or `vp run test` from the repository root runs the browser and backend lanes declared in `vite.config.ts`.
- `vp run test:e2e` runs the Nanites e2e lane declared in `tests/e2e/vitest.config.ts`.
- Worker and Browser Mode tests run through the repository root app config so `cloudflare:test` and browser globals are available.

## Current gaps

1. Browser auth/session flows still need explicit route-level coverage.
2. Backend tests still need more follow-up assertions through product-visible HTTP surfaces.
3. Additional webhook flows should cover run progression and published artifacts.
4. The first Playwright happy path still needs to be added.

## Local auth note

Live local browser verification should normally use real app OAuth at
`http://localhost:5173/auth/github/login`.

The dev-only `/auth/test/mint-session` helper requires a GitHub App user token for the app under
test. A plain `gh auth token` is a GitHub CLI token and GitHub rejects it for app installation
listing.

Provide it with one of:

- `GITHUB_TEST_USER_TOKEN`
- `x-github-test-user-token`
- `?githubAccessToken=...`
