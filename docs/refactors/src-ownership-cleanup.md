# Route And Runtime Ownership Cleanup

## Status

Accepted planning target, revised after review.

This document is the source of truth for the `src` ownership cleanup. It should
guide the implementation pass, not preserve the current tree.

## Goal

Make the codebase navigable on first contact. A new contributor should be able
to infer ownership from the path before opening the file.

The cleanup should:

- use TanStack Router as the frontend structure;
- keep route-specific frontend code inside `src/frontend/routes`;
- use `src/frontend/lib` for cross-route browser app plumbing;
- use `src/frontend/hooks` for reusable React behavior;
- use owner/resource directories on the backend;
- use deep Nanites runtime modules where CRUD/MVC does not fit;
- use horizontal slices when a repeated shape makes the next file obvious;
- delete `src/shared`;
- combine one-caller or same-concept modules instead of spreading them across
  tiny files.

## Non-Goals

- Do not change product behavior.
- Do not change route URLs or TanStack route IDs.
- Do not rename Durable Object export classes.
- Do not move Cloudflare bindings or hand-edit `env.d.ts`.
- Do not keep compatibility shims just to preserve old import paths.
- Do not create a new one-file directory after deleting an old one.

## Notation

```text
old/path.ts -> new/path.ts    rename or move
old/path.ts ^ new/path.ts     combine old file into new owner
old/path.ts !                 verify usage, then delete if unused
```

Use `index.ts` for a directory's main owner file. Avoid names like `http.ts`,
`controller.ts`, `server.ts`, or `routes.ts` when the file is simply the entry
for that owner.

## Current Frontend Inventory

The generated TanStack route tree currently exposes only:

```text
/              login screen
/mcp-authorize MCP OAuth approval/setup screen
/nanites       authenticated Nanites runtime page
```

`/_authenticated` is a pathless auth layout route. Everything else in the
frontend is either route-private implementation, cross-route browser plumbing,
reusable UI/hooks, or dead/stale styling.

Current deletion signals:

- `src/frontend/lib/` is empty today, but should become the home for real
  cross-route browser app plumbing instead of staying as a placeholder.
- `src/frontend/styles/dashboard.css` contains route styles for login, MCP,
  route states, account menu, Nanites runtime, workspace, and old dashboard/admin
  surfaces in one file.
- A text check found 52 dashboard CSS class selectors with no matching frontend
  TS/TSX usage, including `admin-*`, `app-topbar*`, `agent-metric*`,
  `dashboard__welcome`, `app-code-block*`, and several old app shell selectors.
- `Select.tsx` and `Tooltip.tsx` are not directly imported by routes, but they
  are used by `CodeBlock`, `Message`, and `PromptInput`; do not delete them
  before tracing internal UI imports.

## TanStack Router Direction

Use TanStack Router's file-based routing doctrine directly:

- Route files stay under `src/frontend/routes`.
- Private implementation files and folders use the `-` prefix so they are
  excluded from route generation.
- Cross-route browser plumbing belongs in `src/frontend/lib`.
- Reusable React behavior belongs in `src/frontend/hooks`.
- Cross-route visual primitives belong in `src/frontend/ui`.
- The route tree can mix flat and directory routes where it improves
  readability.
- `src/frontend/routeTree.gen.ts` is generated and should not be hand-edited.

Keep route files honest:

- Simple routes should just be the route file. `routes/index.tsx` can own the
  login screen, and `routes/mcp-authorize.tsx` can own the MCP authorize screen.
- Use a directory route when a route earns colocated implementation files.
  `routes/_authenticated/nanites/route.tsx` should own `/nanites`.
- Private files inside a route directory use the `-` prefix. Do not create a
  route shell plus a separate `-page.tsx` unless the route file has a real
  loader/guard surface that deserves separation.

Do not add `frontend/app` or `frontend/features`. If a file only serves a route,
it belongs beside that route in a private `-` file or folder. If a file serves
multiple routes but is not UI, put it in `frontend/lib` or `frontend/hooks`.

References:

- TanStack Router file-based routing:
  https://tanstack.com/router/latest/docs/routing/file-based-routing
- TanStack Router route-private files and folders:
  https://tanstack.com/router/latest/docs/routing/routing-concepts#excluding-files-and-folders-from-routes
- TanStack Router file naming conventions:
  https://tanstack.com/router/v1/docs/framework/react/routing/file-naming-conventions

## Backend Direction

The backend should be owner-first, not layer-first.

Use MVC/resource shape where the app behaves like a traditional HTTP server:

- `backend/auth`
- `backend/github`
- `backend/mcp`

Use deep runtime modules where Nanites does not fit CRUD:

- Nanite manager
- Nanite agent
- manager chat
- trigger runtime
- tools
- GitHub MCP capability

`backend/index.ts` should be the Hono app entry. Individual owners may expose
their own `index.ts` when the directory has a main HTTP/controller surface.

Use horizontal slices when the files share a repeated shape. The clearest
current example is Nanites tools: each public tool has an input schema, execution
body, output shape, description, and registration entry. One file per tool makes
the folder scannable because the pattern repeats.

Look for the same pattern in other owners during implementation. Good candidates
have several siblings with the same lifecycle and names a contributor can guess.
Bad candidates are one-off helpers that only exist because a large function was
split mechanically.

## Backend Horizontal Slice Findings

A backend scan found a few places where horizontal files would improve
navigation:

- Nanites tools are the strongest case. Each public MCP tool repeats the same
  shape: input schema, execution body, output shape, description, annotations,
  and registration.
- GitHub backend operations are a moderate case. `backend/github.ts` mixes
  GitHub client setup, OAuth token exchange, installation/repository reads,
  app installation token issuance, and webhook dispatch. Split out the webhook
  adapter, but keep the normal GitHub operations together until they grow beyond
  one deep owner file.
- Auth is an owner, but it should be deep, not a folder of endpoint files. The
  Hono entry should delegate to `backend/auth`, while auth route actions,
  test-auth, agent request authorization, cookie policy, and session behavior
  collapse into a couple of deep auth modules.

Use these as conditional splits, not automatic line-count splits:

- MCP OAuth authorization is one cohesive consent flow today. Keep it in
  `mcp/oauth.ts` unless a later implementation proves that extracting consent
  cookies improves locality.
- DB facts have two sibling recorders today. Keep them together as `db/facts.ts`
  unless a third fact family appears or the implementation needs a predictable
  `facts/<fact-name>.ts` pattern.

Do not horizontally split these yet:

- Auth endpoint files, auth cookies by cookie name, GitHub installations by
  endpoint, or GitHub client helpers by mechanism. Those helpers become less
  useful when separated.
- Nanite manager and Nanite agent. They are deep runtime owners with stateful
  public interfaces.
- GitHub MCP capability policy and lazy Git auth. They are Nanites runtime
  policy modules, not repeated GitHub CRUD operations.
- DB schema. Keeping the Drizzle schema in one file is more searchable than a
  folder of one-off table files at the current size.

## Shared Policy

Delete `src/shared`.

Move code to the owner that gives the name meaning:

- return-to URL behavior goes to root `src/auth.ts`, because it is used by both
  frontend and backend auth.
- GitHub app URLs and GitHub webhook field readers combine into one pure
  `src/github.ts` module.
- MCP route strings and scope constants move to root `src/mcp.ts`, because
  browser routes and backend MCP handlers both use them.
- Nanite agent names and manager key helpers move to root `src/nanites.ts`,
  because the browser runtime and backend actors both use them.
- backend logging constants, event names, OpenTelemetry attributes, and setup
  move to `backend/logging.ts`.
- tiny environment parsing helpers should be local, even if duplicated.

Do not replace `shared` with `common`, `lib`, or `utils`.

## Target Tree With Moves

```text
src/
|-- client.tsx
|-- server.ts
|-- auth.ts                           <- shared/auth-return-to.ts
|-- github.ts                         <- shared/github-app.ts ^ shared/github-webhook-fields.ts
|-- mcp.ts                            <- shared/constants/mcp.ts
|-- nanites.ts                        <- shared/constants/nanites.ts ^ shared/nanites.ts
|-- backend/
|   |-- index.ts                       <- backend/http.ts
|   |-- logging.ts                     <- shared/logger.ts ^ shared/observability/*
|   |-- auth/
|   |   |-- index.ts                   <- browser-auth/routes.ts ^ browser-auth/test-auth.ts ^ browser-auth/agent-request.ts ^ auth endpoints from backend/http.ts
|   |   `-- session.ts                 <- browser-auth/session.ts ^ browser-auth/cookies.ts ^ browser-auth/policy.ts
|   |-- db/
|   |   |-- index.ts                   <- db/client.ts
|   |   |-- schema.ts                  <- db/business-schema.ts ^ shared/domain/business.ts
|   |   |-- facts.ts                   <- db/business-mutations.ts
|   |   `-- migrations/
|   |-- github/
|   |   |-- index.ts                   <- GitHub client ^ OAuth ^ installations ^ tokens from backend/github.ts
|   |   `-- webhook.ts                 <- handleGitHubWebhook ^ webhook route branching from backend/http.ts
|   |-- mcp/
|   |   |-- index.ts                   <- mcp/server.ts ^ mcp/auth-context.ts
|   |   `-- oauth.ts                   <- mcp/oauth.ts
|   `-- nanites/
|       |-- manager.ts                 <- nanites/host.ts
|       |-- nanite-agent.ts            <- nanites/agent.ts
|       |-- manager-chat.ts            <- nanites/manager-conversation-agent.ts ^ nanites/chat-ingress.ts
|       |-- git-auth.ts                <- nanites/git-auth.ts ^ nanites/git-tools-with-lazy-auth.ts
|       |-- github-mcp-capabilities.ts <- nanites/github-mcp-capabilities.ts
|       |-- language-model.ts          <- nanites/language-model.ts
|       |-- triggers.ts                <- nanites/trigger-runtime.ts ^ nanites/github-trigger-fixtures.ts
|       |-- tool-output.ts             <- nanites/tool-output-artifacts.ts ^ nanites/tool-output-budget.ts
|       `-- tools/
|           |-- index.ts               <- nanites/manager-tools.ts
|           |-- define-tool.ts          <- shared tool definition/telemetry helpers
|           |-- whoami.ts              <- sigvelo_whoami
|           |-- create-nanite.ts       <- sigvelo_create_nanite
|           |-- start-run.ts           <- sigvelo_start_nanite_run
|           |-- test-trigger.ts        <- sigvelo_test_nanite_trigger
|           |-- inspect-debug.ts       <- sigvelo_debug_nanites
|           |-- reset-debug.ts         <- sigvelo_reset_nanite_debug
|           |-- cancel-runs.ts         <- sigvelo_cancel_nanite_runs
|           |-- deprovision.ts         <- sigvelo_deprovision_nanite
|           `-- explore-workspace.ts   <- sigvelo_explore_nanite_workspace
`-- frontend/
    |-- instrument.ts
    |-- lib/
    |   |-- auth.ts                    <- routes/-auth-client.ts
    |   |-- http-client.ts             <- frontend/http-client.ts
    |   |-- route-state.tsx            <- routes/-route-state.tsx
    |   `-- router.ts                  <- frontend/router.ts
    |-- hooks/
    |   `-- use-stick-to-bottom.ts     <- ui/components/useStickToBottom.ts if kept reusable
    |-- routes/
    |   |-- __root.tsx
    |   |-- index.tsx                 <- login route and screen
    |   |-- mcp-authorize.tsx         <- MCP authorize route and screen
    |   `-- _authenticated/
    |       |-- route.tsx              <- pathless authenticated layout
    |       `-- nanites/
    |           |-- route.tsx          <- /nanites route and primary runtime screen
    |           |-- -runtime-chat.tsx  <- nanite-runtime-chat.tsx ^ route-only chat UI
    |           `-- nanites.css        <- Nanites selectors from dashboard.css
    `-- ui/
        |-- components/                <- retained cross-route UI components
        |-- design-tokens/
        `-- styles/
```

## Consolidation Rules

Apply these rules during implementation:

- If a file has one production importer and no independent concept, combine it.
- Tests do not count as production importers.
- Split Nanites tools horizontally: one file per public tool. Keep repeated
  mechanics in `nanites/tools/define-tool.ts`, and keep registration in
  `nanites/tools/index.ts`.
- Keep `nanites/tools` limited to public manager tools. Runtime output budgeting
  and artifact capture belong in `nanites/tool-output.ts`.
- Combine trigger runtime and GitHub trigger fixtures into `nanites/triggers.ts`
  unless the fixture catalog grows into a repeated event-family pattern.
- Keep deep modules deep. `manager.ts` and `nanite-agent.ts` may remain large if
  their public interface is clearer than a helper forest.
- Do not keep `index.ts` as a barrel. It should own behavior for that directory
  or be the directory's primary entry.
- Use the horizontal-slice test elsewhere: if a contributor can predict the next
  file from the product noun and every sibling has the same internal shape,
  splitting is good navigation. If the split creates bespoke helper names, fold
  the helper back into its owner.

## Frontend Cleanup Rules

- Route files own routes. Simple route files can include the full route UI.
- Use directory routes with `route.tsx` only when a route earns colocated private
  files.
- Prefix route-only helper files with `-` so TanStack ignores them.
- `frontend/lib` is for cross-route browser app plumbing: router setup,
  typed HTTP client, auth/session helpers, route-state helpers, Sentry/browser
  instrumentation helpers.
- `frontend/hooks` is for reusable React behavior used outside one route owner.
- Move route-only UI out of `frontend/ui`.
- Keep `frontend/ui` small and boring: primitives used by more than one route or
  by another retained primitive.
- Delete placeholder files or folders inside `frontend/lib` and `frontend/hooks`
  if they do not earn their name.
- Delete stale dashboard/admin/app-shell CSS after verifying class usage.
- Preserve CSS load order:
  1. primitive tokens/base styles;
  2. primitive component styles;
  3. route-owned CSS.

## Test Plan

- Update imports after moves.
- Combine tests for merged modules:
  - tool output artifact and output budget tests become one tool-output test;
  - lazy git auth tests target `git-auth.ts`.
- Keep broad integration lanes in `tests/backend` and `tests/browser`.
- Regenerate TanStack route output through the normal Vite+/TanStack flow.
- Run:

```bash
vp check
vp test
```

## Implementation Notes

- `src/server.ts` remains the Wrangler entrypoint.
- Durable Object export class names stay stable even if files move.
- `src/frontend/routeTree.gen.ts` is generated and should not be hand-edited.
- `wrangler.jsonc` migration paths should continue pointing at
  `src/backend/db/migrations`.
