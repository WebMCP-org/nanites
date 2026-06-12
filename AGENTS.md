# Repository Instructions

## Toolchain

This repository uses Vite+, a unified toolchain around Vite, Rolldown, Vitest, Oxlint, Oxfmt, and Vite Task. Use the `vp` CLI for package management and validation.

- Run `vp install` after pulling remote changes.
- Run `vp check` and `vp test` before publishing code changes.
- Use `vp run dev` from the repository root to start the Nanites app.

## Nanites Runtime

For Nanites product or runtime work, read these first:

1. `docs/architecture/README.md`
2. `docs/architecture/architecture.md`
3. `docs/architecture/execution-architecture.md`
4. `docs/architecture/roadmap.md`
5. `docs/architecture/user-stories.md`

## Cloudflare Workers

Use `#/...` for app-local imports rooted at `src`.

Run `vp exec wrangler types env.d.ts --include-runtime false` from the repository root after changing bindings in `wrangler.jsonc`. Do not hand-write Worker binding types.

## Testing

- Default to slice integration tests for app-local behavior.
- Do not use Vitest or Jest mocks, stubs, or spies for app-local code.
- Mock external HTTP boundaries only, preferably with MSW.
- Never keep unit tests. If a unit test helps as scaffolding while developing, delete it before the change is finished.
