# Contributing

Nanites is a Cloudflare Worker app built with Vite+. Use the repository root for all commands.

## Setup

```bash
vp install
vp run dev
```

## Before opening a pull request

Run the release gates:

```bash
vp check
vp test
vp build
```

If you change `wrangler.jsonc` bindings, regenerate Worker types:

```bash
vp exec wrangler types env.d.ts --include-runtime false
```

## Code standards

- Use `#/...` for app-local imports rooted at `src`.
- Prefer slice integration tests for app-local behavior.
- Do not use Vitest or Jest mocks, stubs, or spies for app-local code.
- Mock external HTTP boundaries only, preferably with MSW.
- Use Cloudflare, GitHub, MCP, and Octokit primitives directly unless a local wrapper owns policy,
  auth, lifecycle, retries, or cleanup.
- Do not add compatibility shims for pre-release Nanites surfaces. Update callers and delete stale
  shapes in the same change.
