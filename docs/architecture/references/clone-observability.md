# Nanite workspace hydration deep dive

## Status

Reference.

This note captures the historical failure mode analysis for the old workspace hydration path.

Parts of the diagnosis are historical. In particular, the active runtime now already passes `depth: 1` during workspace hydration. Use `/docs/architecture/execution-architecture.md` for the current execution model.

## The Problem

Nanite runs fail silently on large GitHub repos. The root cause is that the current workspace hydration path clones the repo using isomorphic-git, which creates a `.git` directory with a packfile binary blob. For large repos, this packfile exceeds SQLite's blob size limit, producing:

```
string or blob too big: SQLITE_TOOBIG
```

For even larger repos, the DO gets OOM-killed by the platform before the SQLite write even happens, leaving zero telemetry — the run simply vanishes.

## Observed Failures

### `SQLITE_TOOBIG` (confirmed)

Run `manual:c460df73-e506-4a26-9159-d3342f6b3ab1` on the sigvelo repo itself failed with `SQLITE_TOOBIG`. The `filesTouched` list stops at `/.git/objects/pack` — the clone died trying to write the packfile to the workspace's SQLite-backed filesystem. The R2 overflow (for files >1.5MB) either didn't trigger or wasn't enough.

### Silent death (suspected OOM)

Run `manual:1ee081af-2232-431e-8c5b-7d164a604206` on repo ID `70998340` (a multi-GB repo) has zero telemetry across 30 days in Workers Observability. No events, no agent lifecycle entries, nothing. The NaniteManager for the repo only has a single `agents:state:update`. The DO was likely killed by the platform for exceeding the 128MB memory limit during isomorphic-git's in-memory packfile decompression — before any JS error handler could run.

## How Hydration Works Today

### The clone call

```
apps/nanites/src/backend/nanites.ts — prepareWorkspace() method
```

1. Gets a GitHub installation access token
2. Calls `ensurePhase("preparing", ...)` — the last status update before the clone
3. Creates workspace directories and metadata files
4. Calls `git.clone({ url, branch, username, password })` — **no `depth` param, no `onProgress`**
5. After clone completes, calls `workspace.getWorkspaceInfo()` and emits a "hydrated" activity

The clone is wrapped by `executeScheduledRun()` in a try/catch that routes errors to `finalizeImplicitFailure()`. But if the DO is killed by the platform (OOM), no catch block runs.

### isomorphic-git

The `@cloudflare/shell` git wrapper uses isomorphic-git, a pure-JS git implementation. During clone:

1. Downloads the git packfile over HTTP — **buffered entirely in DO memory**
2. Decompresses git objects from the packfile — **also in memory**
3. Writes files to the filesystem adapter, which routes to SQLite (inline, <1.5MB) or R2 (overflow)

The packfile itself (`.git/objects/pack/pack-*.pack`) is a single large binary. For a repo with thousands of files, this can easily exceed both the DO's 128MB memory limit and SQLite's blob size limit.

### What isomorphic-git supports but we don't use

- **`depth` parameter** — shallow clone. Already accepted by `@cloudflare/shell`'s `clone()` method but not passed by `prepareWorkspace()`. Would dramatically reduce packfile size.
- **`onProgress` callback** — emits `{ phase, loaded, total }` during clone. Supported by isomorphic-git but not forwarded by `@cloudflare/shell`'s wrapper.
- **`onMessage` callback** — server-side messages during clone. Same situation.

## Why `.git` Exists (and Why It Might Not Need To)

The Nanite currently uses isomorphic-git for these operations after hydration:

- `git.status()` — detect workspace changes before commit
- `git.add({ filepath: "." })` — stage all changes
- `git.commit(...)` — create a commit
- `git.push(...)` — push the support PR branch
- `git.diff()` — get changed files for the artifact
- `git.branch(...)` — create/switch branches
- `git.log({ depth: 1 })` — read the latest commit
- `git.checkout(...)` — switch branches

All of these are for the **publish step** — creating and pushing the support PR. The investigation step only reads files from the workspace.

Every one of these operations could be replaced with GitHub REST API calls:

- **status/diff** — compare workspace files against the base tree SHA via Trees API
- **commit + push** — create blobs, assemble a tree, create a commit, update the ref — all via the Git Data API (`/repos/{owner}/{repo}/git/blobs`, `/git/trees`, `/git/commits`, `/git/refs`)
- **branch** — create/update refs via the Refs API
- **log** — already available from the context passed to `startRun()`

If git operations were replaced with API calls, the entire `.git` directory becomes unnecessary. The workspace would be a plain file tree, and hydration could use the GitHub tarball API instead of git clone — streaming a `.tar.gz` and extracting files directly into the workspace with minimal memory overhead.

## Source Files

### Nanite implementation

| File                                                            | What to look at                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/nanites/src/backend/nanites.ts`                           | Everything. ~2950 lines. The Nanite and NaniteManager DOs.                       |
| `prepareWorkspace()`                                            | The clone call, workspace directory setup, post-clone info emission              |
| `executeScheduledRun()`                                         | The try/catch wrapping prepareWorkspace; routes to `finalizeImplicitFailure()`   |
| `emitNaniteActivity()`                                          | How progress/state is sent to frontend via projection sync to NaniteManager      |
| `ensurePhase()`                                                 | Phase transitions that the frontend renders — currently no clone progress detail |
| `git.status()`, `git.add()`, `git.commit()`, `git.push()` calls | The publishing step — search for `this.git()` to find all usage                  |
| `finalizeImplicitFailure()`                                     | How errors are captured and persisted as run failures                            |
| `syncManagerProjection()`                                       | Cross-DO call that sends projection updates back to the NaniteManager            |

### @cloudflare/shell git wrapper

| File                                                                              | What to look at                                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `opensrc/repos/github.com/cloudflare/agents/packages/shell/src/git/index.ts`      | `createGit()` factory and all git method wrappers (~400 lines). `clone()` at the top — accepts `depth` but not `onProgress`/`onMessage`. |
| `opensrc/repos/github.com/cloudflare/agents/packages/shell/src/git/fs-adapter.ts` | Adapts the Workspace filesystem to isomorphic-git's expected `fs` API. This is where file writes during clone go through.                |
| `opensrc/repos/github.com/cloudflare/agents/packages/shell/src/git/provider.ts`   | Git tool provider for MCP/shell integration — the tools the Nanite LLM calls.                                                            |

### Workspace storage

| File                                                                         | What to look at                                                                        |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `opensrc/repos/github.com/cloudflare/agents/packages/shell/src/workspace.ts` | Workspace class — SQLite + R2 storage, inline threshold (~1.5MB), `getWorkspaceInfo()` |
| `opensrc/repos/github.com/cloudflare/agents/packages/shell/src/backend.ts`   | `StateBackend` interface — the SQLite storage layer that hits `SQLITE_TOOBIG`          |

### Agents SDK observability

| File                                                                                    | What to look at                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `opensrc/repos/github.com/cloudflare/agents/packages/agents/src/observability/index.ts` | Diagnostics channel definitions, `Observability` interface                           |
| `opensrc/repos/github.com/cloudflare/agents/packages/agents/src/observability/agent.ts` | All agent event types — what Workers Observability can show                          |
| `opensrc/repos/github.com/cloudflare/agents/packages/agents/src/index.ts`               | Main Agent class — `_emit()`, error hooks, destroy/abort, queue/schedule retry logic |

### GitHub API integration (already exists)

| File                                 | What to look at                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/nanites/src/backend/github.ts` | Existing Octokit usage — already fetches file content via Contents API (see `getContent` calls). Pattern for authenticated GitHub API access with installation tokens. |

### isomorphic-git types (not in opensrc)

| File                                                                              | What to look at                                                                                          |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `node_modules/.pnpm/isomorphic-git@1.37.5/node_modules/isomorphic-git/index.d.ts` | `clone()` signature with `onProgress`/`onMessage`, `GitProgressEvent` type, all available git operations |

## Key Constraints

- **Durable Object memory limit**: 128MB. isomorphic-git buffers the entire packfile in memory during clone.
- **SQLite blob size limit**: Platform-enforced. The packfile is written as a single blob and hits `SQLITE_TOOBIG` for large repos.
- **R2 overflow threshold**: ~1.5MB. Files larger than this should go to R2, but the packfile may hit SQLite's hard limit before the overflow logic runs.
- **No clone timeout**: The 300s timeout in `executeScheduledRun()` only starts AFTER `prepareWorkspace()` returns. The clone itself can hang forever.
- **Platform kills are silent**: When Cloudflare kills a DO for exceeding limits, no JS code executes. No error event, no telemetry, no trace. The run disappears.

## Quick Win Available Now

Adding `depth: 1` to the `git.clone()` call in `prepareWorkspace()` would dramatically reduce packfile size (no history, just the latest tree). This is a one-line change and the `@cloudflare/shell` wrapper already supports the `depth` parameter. It won't fix the fundamental architecture but will raise the ceiling on repo size significantly.

## Where This Is Heading

The long-term direction is to eliminate `.git` from the workspace entirely:

1. **Hydrate via GitHub tarball API** instead of git clone — stream a `.tar.gz`, extract files directly into the workspace. No packfile, no object store, minimal memory.
2. **Publish via GitHub Git Data API** instead of isomorphic-git — create blobs, trees, commits, and refs through REST calls. Already partially patterned in `github.ts`.
3. **The workspace becomes a plain file tree** — no `.git` directory, no SQLite blob pressure from packfiles, no isomorphic-git dependency for the hot path.

This eliminates both failure modes (`SQLITE_TOOBIG` and OOM) and removes the packfile as a bottleneck entirely. The tradeoff is implementing the publish step against GitHub's API, but all the auth and Octokit infrastructure already exists.
