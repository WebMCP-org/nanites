# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.
Use `#/...` for app-local source imports rooted at `src/`.
This app is still pre-production. For D1 schema work, prefer regenerating local migration history from the current Drizzle schema over preserving obsolete migration chains.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command               | Purpose                   |
| --------------------- | ------------------------- |
| `npx wrangler dev`    | Local development         |
| `npx wrangler deploy` | Deploy to Cloudflare      |
| `npx wrangler types`  | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.
Do not create custom `Env` extension interfaces or hand-written env augmentation files for Worker bindings or secrets. Declare them in `wrangler.jsonc`, run `wrangler types`, and use the generated `Env` type directly.

## Testing Doctrine

- Default to slice integration tests for app-local behavior.
- Do not use Vitest or Jest mocks, stubs, or spies for app-local code. If you think you need one, the test lane is probably wrong.
- Mock external HTTP boundaries only, preferably with MSW.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`
