# Drizzle + oRPC First-Party Reference

Source-backed notes for the Nanites foundations pass. This document is intentionally narrow: Drizzle, drizzle-zod, oRPC, and the fetch-handler wiring needed for a Cloudflare Worker API surface.

All repo paths below are relative to `/`.

## Why This Note Exists

The foundations plan needs real implementation constraints, not product speculation. This note answers:

- what Drizzle actually supports for D1 and schema definition
- what drizzle-zod can and cannot infer automatically
- what oRPC needs in order to generate a real OpenAPI surface
- how those pieces fit into the existing worker without adding another framework layer

## Primary Local Sources

### Drizzle

- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-orm/src/d1/driver.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-orm/src/d1/session.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-kit/src/index.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-kit/tests/cli/d1http.config.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-orm/src/sqlite-core/table.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-orm/src/sqlite-core/columns/common.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-orm/src/sqlite-core/columns/all.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-orm/src/sqlite-core/unique-constraint.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-orm/src/sqlite-core/indexes.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-orm/src/relations.ts`

### drizzle-zod

- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-zod/src/schema.ts`
- `opensrc/repos/github.com/drizzle-team/drizzle-orm/drizzle-zod/README.md`

### oRPC

- `opensrc/repos/github.com/unnoq/orpc/packages/server/src/builder.ts`
- `opensrc/repos/github.com/unnoq/orpc/packages/server/src/error.ts`
- `opensrc/repos/github.com/unnoq/orpc/packages/contract/src/route.ts`
- `opensrc/repos/github.com/unnoq/orpc/playgrounds/cloudflare-worker/worker/index.ts`
- `opensrc/repos/github.com/unnoq/orpc/playgrounds/cloudflare-worker/worker/routers/index.ts`
- `opensrc/repos/github.com/unnoq/orpc/playgrounds/cloudflare-worker/worker/middlewares/auth.ts`
- `opensrc/repos/github.com/unnoq/orpc/playgrounds/cloudflare-worker/worker/middlewares/db.ts`
- `opensrc/repos/github.com/unnoq/orpc/playgrounds/cloudflare-worker/src/lib/orpc.ts`

### Project Context

- `src/server.ts`
- `wrangler.jsonc`
- `docs/architecture/execution-architecture.md`

## Official Docs

### Drizzle

- https://orm.drizzle.team/docs/overview
- https://orm.drizzle.team/kit-docs/overview
- https://orm.drizzle.team/docs/get-started/d1-new

### oRPC

- https://orpc.unnoq.com
- https://orpc.unnoq.com/docs/openapi/openapi-specification
- https://orpc.unnoq.com/docs/adapters/fetch

## Drizzle: What Matters For Nanites

### D1 Client Setup

Drizzle’s D1 driver is thin. The main supported shape is:

```ts
import { drizzle } from "drizzle-orm/d1";

const db = drizzle(env.DB);
```

If a schema object is passed, Drizzle also enables the relational `db.query.*` API:

```ts
import * as schema from "./schema";

const db = drizzle(env.DB, { schema });
```

Useful config from `drizzle-orm/src/d1/driver.ts`:

- `schema`
- `logger`
- `casing`

### D1 HTTP Migration Config

The `drizzle-kit` D1 HTTP config shape in `drizzle-kit/src/index.ts` supports:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/*",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_API_TOKEN!,
  },
  verbose: true,
  strict: true,
});
```

For Nanites, this is enough. Nothing in the source suggests a custom migration wrapper is needed for the first pass.

### SQLite Schema Features Worth Using Early

From the SQLite core sources, the useful primitives for the foundations pass are:

- `text(...)`, including `enum` metadata and JSON mode
- `integer(...)`, including timestamp modes
- `blob(...)` with JSON/bigint modes if needed later
- `.primaryKey()`
- `.notNull()`
- `.unique()`
- `.default(...)`
- `.$defaultFn(...)`
- `.references(...)`
- table-level `unique().on(...)`
- table-level `index(...).on(...)`

That means the foundations doc should lean on actual database constraints for:

- `(installation_id, repo)` uniqueness
- run identity and dedupe keys
- foreign-key integrity between config, runs, and findings

not just TypeScript-level conventions.

### Relations

Drizzle relations are straightforward and useful once there are multiple linked tables:

```ts
import { relations } from "drizzle-orm";

export const repoConfigsRelations = relations(repoConfigs, ({ one, many }) => ({
  installation: one(installations, {
    fields: [repoConfigs.installationId],
    references: [installations.id],
  }),
  reviewRuns: many(reviewRuns),
}));
```

This is worth using once Nanites has more than one table, but it should follow the real storage model. It should not be used to justify speculative tables.

## drizzle-zod: Where Inference Helps, and Where It Stops

### What It Gives You

`drizzle-zod` can derive Zod schemas directly from a Drizzle table:

```ts
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";

const selectSchema = createSelectSchema(installations);
const insertSchema = createInsertSchema(installations);
const updateSchema = createUpdateSchema(installations);
```

It also supports field-level refinement and replacement:

```ts
const insertSchema = createInsertSchema(installations, {
  githubInstallationId: (schema) => schema.positive(),
  status: z.enum(["active", "suspended", "removed"]),
});
```

Normal Zod `.describe(...)` metadata can then be applied for OpenAPI descriptions.

### Caveat: Row Shapes Are Not Always API Shapes

This is the biggest practical limitation for Nanites.

`createSelectSchema(table)` gives you a schema for the row Drizzle sees. It does not automatically solve:

- branded IDs
- domain enums when the DB column is just `text`
- public/private field separation
- structured config contracts when the DB stores raw JSON blobs
- narrower API contracts than the underlying table

So the rule for the foundations pass should be:

1. derive from Drizzle first
2. refine or replace fields where the domain contract is narrower than the storage row
3. avoid claiming that every API contract is a pure mechanical projection of the DB

That means “SSOT” should be interpreted carefully:

- the DB schema is the storage source of truth
- the API contract can still be derived from it, but sometimes only after explicit refinement

### Concrete Recommendation

Use `drizzle-zod` for:

- installation rows
- repo-config rows
- review-run rows

Do not rely on it alone for:

- large JSON config documents
- branded identifiers unless fields are retyped
- user-facing enums if the DB schema has not encoded those values clearly

## D1 Migration Workflow

The basic workflow is source-backed and simple:

```bash
vp dlx drizzle-kit generate
vp dlx drizzle-kit migrate
```

`push` also exists and is useful for development:

```bash
vp dlx drizzle-kit push
```

### Operational Caveat

Drizzle also exposes a programmatic D1 migrator, but that should not be the default Nanites deployment model.

The foundations pass should assume:

- migrations are generated outside request handling
- migrations are applied intentionally
- the worker does not mutate schema at runtime during normal traffic

This keeps the data layer boring, which is what the foundations pass should optimize for.

## oRPC: What Is Actually Required

### Core Builder Model

The base setup is small:

```ts
import { os, ORPCError } from "@orpc/server";

const base = os.$context<{ req: Request; env: Env }>();

const authed = base.use(async ({ context, next }) => {
  const user = await getUser(context.req);
  if (!user) throw new ORPCError("UNAUTHORIZED");
  return next({ context: { user } });
});
```

This is a good fit for the Nanites worker because it already has a custom fetch handler in `src/server.ts`.

### OpenAPI Is Inferred, Not Magic

The Cloudflare worker playground shows the actual shape:

- define procedures with `.route(...)`
- add `.input(...)`
- add `.output(...)`
- add `.errors(...)` where needed
- mount an `OpenAPIHandler`
- mount `OpenAPIReferencePlugin`
- use a schema converter such as `ZodToJsonSchemaConverter`

Without those pieces, `/api/spec.json` does not materialize just because a router object exists.

### Route Metadata Is Part Of The Contract

The source-backed route shape looks like:

```ts
const getPlanet = authed
  .route({
    method: "GET",
    path: "/planets/{id}",
    summary: "Get a planet by ID",
    tags: ["Planets"],
  })
  .input(z.object({ id: z.number() }))
  .output(PlanetSchema)
  .handler(async ({ input, context }) => {
    return context.db.find(input.id);
  });
```

For Nanites, this matters because the OpenAPI surface will only be useful if the procedures are deliberate about:

- route shape
- input/output schemas
- error contracts
- descriptions and tags

### Errors Are Part Of The Surface

oRPC’s `.errors(...)` API is worth adopting early because it keeps error responses typed and visible in the OpenAPI output:

```ts
const getRepoConfig = authed
  .route({ method: "GET", path: "/nanites/{repo}", tags: ["Nanites"] })
  .errors({
    NOT_FOUND: {
      message: "Repository config not found",
      data: z.object({ repo: z.string() }),
    },
  })
  .input(z.object({ repo: z.string() }))
  .output(repoConfigSchema)
  .handler(async ({ input, errors }) => {
    throw errors.NOT_FOUND({ data: { repo: input.repo } });
  });
```

For a foundations pass, this is a better investment than building many routes. One or two good routes with real error contracts are enough.

## Worker Integration Pattern

The Cloudflare worker playground provides the clearest reference shape:

```ts
import { BatchHandlerPlugin, onError, RPCHandler } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

const schemaConverters = [new ZodToJsonSchemaConverter()];

const rpcHandler = new RPCHandler(router, {
  interceptors: [onError((error) => console.error(error))],
  plugins: [new BatchHandlerPlugin()],
});

const openApiHandler = new OpenAPIHandler(router, {
  interceptors: [onError((error) => console.error(error))],
  plugins: [
    new SmartCoercionPlugin({ schemaConverters }),
    new OpenAPIReferencePlugin({
      schemaConverters,
      specGenerateOptions: {
        info: { title: "Nanites API", version: "0.1.0" },
      },
    }),
  ],
});
```

Then the worker fetch handler tries the oRPC routes before falling back:

```ts
const rpcResult = await rpcHandler.handle(request, {
  prefix: "/rpc",
  context: { req: request, env },
});

if (rpcResult.matched) return rpcResult.response;

const apiResult = await openApiHandler.handle(request, {
  prefix: "/api",
  context: { req: request, env },
});

if (apiResult.matched) return apiResult.response;
```

### Practical Nanites Take

No Hono layer is required for the foundations pass.

The existing worker can:

- keep `routeAgentRequest(...)` for agent routes
- add oRPC fetch handling for `/api/*` and optionally `/rpc/*`
- serve OpenAPI from the plugin-backed handler

That is simpler than introducing another routing framework just to wrap standard `Request` and `Response`.

## Client Typing Note

The playground client pattern is useful, but the important part is the router type, not `typeof` on a type alias.

Use the actual router type exported by the worker router module. Keep this explicit when the client is added later; do not copy type snippets blindly.

## What This Means For The Foundations Plan

### Good Defaults

- use `packages/db` for Drizzle schema and client
- use D1 with generated migrations
- use table-level uniqueness and indexes early
- use `drizzle-zod` as the base schema layer
- use oRPC fetch handlers directly in the worker
- use `.route(...)`, `.input(...)`, `.output(...)`, and `.errors(...)` from day one

### Things To Avoid In The First Pass

- claiming that every domain contract is a direct unmodified DB projection
- runtime schema migration inside normal worker request handling
- adding Hono just to mount API routes
- building many speculative CRUD endpoints before the first real workflow exists

### Minimal “Bones” Shape

If the goal is just to set the repo bones, the Drizzle + oRPC layer only needs enough structure to support:

- `GET /api/health`
- one minimal repo-config read/write surface
- one real DB client factory
- one real migration path
- one real OpenAPI spec endpoint

Everything else can follow the first concrete Nanites execution loop.

## Bottom Line

Drizzle and oRPC are both a good fit for Nanites, but only if the plan stays concrete.

The strongest source-backed conclusions are:

- Drizzle on D1 is straightforward.
- `drizzle-zod` is useful, but not sufficient for every domain contract.
- oRPC can provide both typed RPC and OpenAPI directly from the worker.
- OpenAPI generation depends on disciplined procedure contracts, not just a router object.
- The foundations pass should prefer a small number of real tables and routes over a broad speculative product model.
