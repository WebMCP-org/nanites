# Modern Web Guidance manager starter investigation

**Date:** 2026-06-17
**Status:** Revised plan, reviewed against `alex/workflow-backed-nanite-runs` on 2026-06-22

## Recommendation

Offer **Modern Web Guidance** as a starter prompt in the Nanites manager after
setup finishes. Do not create it during setup. The manager should use the
starter prompt to ask which repository, URL, skills, and cadence the user wants,
then create a normal Nanite through the manager-owned creation path.

The resulting Nanite should be manual by default until the user asks for a
schedule or release trigger. Runs should audit the app against Chrome's Modern
Web Guidance, collect real browser evidence through Cloudflare Browser Run, and
end with one of four explicit outcomes:

- `complete`: opened a PR or produced a concrete change proposal.
- `no_change`: verified the target and found no useful change.
- `ask_manager`: needs a preview URL, login, approval, or cost-sensitive browser
  run.
- `fail`: browser/runtime/source inspection failed in a repeatable way.

Do not make this a push-triggered Nanite by default for the first release. The
manager should explicitly ask before enabling schedules, release triggers, or
other background browser-cost paths.

## What changed externally

Chrome's **Modern Web Guidance** is a skill and guide corpus, not the browser
automation API itself. The current install path is
`npx modern-web-guidance@latest install`, and the package includes local guide
content plus a semantic search index. As of 2026-06-17, npm reports
`modern-web-guidance@0.0.173`.

The browser-facing API is **WebMCP**. Chrome describes it as an early-preview
browser API that lets a web page register client-side tools with the agent's
browser tab. The important product split is:

- MCP covers backend or remote service tools.
- WebMCP covers frontend, tab-bound tools that know the rendered app state.
- Browser automation through CDP still matters as the fallback when a site has
  no WebMCP tools.

Cloudflare's current Agents/Think path now fits this shape. The latest npm
versions checked on 2026-06-21 are:

| Package                     | Branch repo range | npm latest     |
| --------------------------- | ----------------- | -------------- |
| `agents`                    | `^0.16.2`         | `0.16.2`       |
| `@cloudflare/think`         | `^0.10.0`         | `0.10.0`       |
| `@cloudflare/codemode`      | `^0.4.1`          | `0.4.1`        |
| `@cloudflare/ai-chat`       | `^0.8.6`          | `0.8.6`        |
| `wrangler`                  | `^4.100.0`        | `4.103.0`      |
| `@cloudflare/workers-types` | `^4.20260612.1`   | `4.20260621.1` |

Cloudflare Agents SDK source references:

- `cloudflare/agents` monorepo at `3b2af5444af5002cd54fd493452e03c721d31999`
- `agents` package `0.16.2`
- `@cloudflare/think` package `0.10.0`
- `@cloudflare/codemode` package `0.4.1`
- `@cloudflare/shell` package `0.4.0`
- `@cloudflare/ai-chat` package `0.8.6`

For browser work, the most relevant upstream references are the Think tools docs,
`packages/think/src/tools/execute.ts`, `packages/think/src/tools/browser.ts`, and
`packages/agents/src/browser/connector.ts`.

Modern Web Guidance source references:

- generated skill install target at `GoogleChrome/modern-web-guidance`
  (`18c2f84274f959df2b31b919c4b16a2cc65e82e1`, release `v0.0.173`)
- source and eval authoring repo at `GoogleChrome/modern-web-guidance-src`
  (`014e2600c4abbf564412c269baa03f1b11e4bbde`)

Use the generated `skills/modern-web-guidance` tree as the first source for the
starter prompt's linked skill corpus. Use the source repo when the
implementation needs guide metadata, tests, or generation scripts.

Vercel's Skills CLI source reference:

- `vercel-labs/skills` at `e5c075e3a84b37c5eb398ab74e581558d3fceb0e`
  (`skills@1.5.12`, MIT)

Use it as the reference for linked-skill extraction. The useful files are:

- `src/source-parser.ts` for accepting `owner/repo`, GitHub URLs, refs, subpaths, and
  `owner/repo@skill`
- `src/git.ts` for shallow clone behavior, auth fallback, LFS avoidance, and cleanup
- `src/skills.ts` for safe subpath handling and `SKILL.md` discovery
- `src/blob.ts` for the faster GitHub tree, raw-file, and cached-download path
- `src/add.ts` for tying parse, fetch, discover, filter, and install together

Do not vendor the whole CLI into SigVelo. Borrow the small source parsing and
discovery behavior needed for `repo -> extracted skill folder`.

## Current Nanites fit

The Nanites architecture already has the right boundary for this. A Nanite
definition stays thin: identity, scope, purpose, model, event source,
permissions, and stop conditions. The Think runtime owns the actual work.

Current repo state:

- `wrangler.jsonc` already declares `LOADER` and `BROWSER` bindings.
- `NanitesSetupAgent.checkBrowserBinding()` treats Browser Run as optional and
  labels it future preview verification support.
- `SigveloNaniteAgent.getTools()` creates the `execute` tool with workspace,
  git, artifacts, optional GitHub MCP connectors, and Browser Run only when
  manager-owned `runtimeConfig.browser` enables it.
- The setup wizard stops after repository selection plus launch. It should not
  ask for the Modern Web Guidance URL or create a Nanite.
- The Nanites manager empty state includes a Modern Web Guidance starter prompt
  that preloads the right intent without bypassing manager questions.
- `SigveloManagerConversationAgent` already loads the canonical Nanites authoring
  skill through `agents:skills`; `SigveloNaniteAgent` does not yet attach
  Nanite-selected skill sources.
- `sigvelo_create_nanite` supports manual, schedule, scheduleEvery, and GitHub
  event sources. Manual is enough for the starter-created Nanite.

Branch alignment:

- `NaniteRunWorkflow` is now the Run execution boundary. The Modern Web Guidance Nanite
  should finish by returning structured Workflow output, not by calling
  lifecycle tools.
- The manifest schema is strict and intentionally thin. There is no `scope.web`
  field yet, so the current branch keeps repository scope in the manifest and
  stores the target URL in manager-owned `runtimeConfig.browser`.
- Scheduled Nanites already install schedules on the Nanite sub-agent and route
  schedule ticks through `triggerSource`; the starter-created Nanite should stay
  manual unless the user asks for a cadence.
- `createExecuteTool()` is the right Browser Run surface. Keep using the Think
  helper instead of adding a second Nanite browser tool harness.
- `wrangler.jsonc` already declares `LOADER`, `BROWSER`, and
  `NANITE_RUN_WORKFLOW`. Browser Run stays an optional setup readiness item.

The immediate runtime gap is therefore smaller than the original plan: attach
the Modern Web Guidance corpus as a Think skill source selected by
manager-owned Nanite runtime config. Do not add a SigVelo-specific skill
retrieval tool unless Think skill sources prove insufficient.

## Agents SDK / Think primitive findings

Use Think primitives directly:

- `getSkills()` accepts any `SkillSource[]`, not only bundled
  `agents:skills` imports. The SDK already ships `skills.fromManifest(...)` for
  in-memory manifests and `skills.r2(...)` for R2-backed dynamic skills.
- Think initializes skills on startup, refreshes sources before each turn, and
  refreshes the system prompt when the source fingerprint changes.
- Skill content should flow through Think's existing tools:
  `activate_skill`, `read_skill_resource`, and optionally `run_skill_script`.
  Start linked GitHub skills with instructions and resources only; defer script
  execution until approval and sandbox policy exists.
- Tool order already gives Nanites the right composition: workspace tools,
  `getTools()`, extensions, session tools, skill tools, MCP tools, then client
  tools. Keep Nanite capability policy in manager-owned runtime config and
  `getTools()`, not in a large manifest extension.
- Skill selection should also stay in manager-owned runtime config. Use a tiny
  URL list such as `runtimeConfig.skillUrls`; the runtime can resolve each URL
  into cached workspace metadata without expanding the public Nanite manifest.
- `createExecuteTool(this, overrides)` already owns Workspace, Worker Loader,
  codemode, and optional `cdp.*` Browser Run wiring. Keep the unified `execute`
  tool for repo plus browser work.
- `ThinkWorkflow.step.prompt()` remains the Run boundary for typed outcomes.
  Use `submitMessages()` only for one-off durable turns that are not full Runs.

## Proposed Starter-Created Nanite

Name: `Modern Web Guidance`

Purpose: keep one web app aligned with modern web platform guidance using repo
inspection plus live browser evidence.

Default scope:

- One selected GitHub repository.
- One target URL selected through the manager conversation.
- Public or preview pages only for the first release. Authenticated flows should
  require manager approval because Browser Run can act on page sessions.

Default event source:

```json
{
  "type": "manual"
}
```

Current-compatible manifest shape:

```json
{
  "id": "modern-web-guidance",
  "name": "Modern Web Guidance",
  "description": "Audits and improves the selected web app using Chrome Modern Web Guidance and browser evidence.",
  "model": "openai/gpt-5.5",
  "eventSource": { "type": "manual" },
  "permissions": {
    "github": {
      "repositories": ["OWNER/REPO"],
      "appPermissions": {
        "contents": "write",
        "pull_requests": "write",
        "actions": "read",
        "deployments": "read",
        "metadata": "read"
      }
    }
  }
}
```

The target URL and cadence should not be hidden in prose forever. Add a small
structured web scope before implementation, for example:

```ts
type NaniteWebScope = {
  targetUrls: string[];
  allowAuthenticatedBrowserSession: boolean;
  preferredEvidence: Array<"screenshot" | "console" | "accessibility" | "performance" | "webmcp">;
};
```

The exact model id should still follow the existing model doctrine: inspect the
current Cloudflare AI catalog and choose the cheapest reliable
function-calling/code-editing model for this Nanite's narrow job.

For the first release, prefer a manager-owned config record or first-run prompt
payload over adding `scope.web` to the manifest. Add manifest shape only when
export/import or trigger routing needs it.

## Runtime wiring

Use the existing `execute` tool as the main surface. Installed
`@cloudflare/think` already supports:

```ts
createExecuteTool(this, {
  browser: this.env.BROWSER,
  session: { mode: "dynamic" },
});
```

When `browser` is present, the code sandbox exposes `cdp.*` for Chrome DevTools
Protocol work. That means the Nanite can load a live URL, inspect DOM and
accessibility state, capture screenshots, read console/network state, and test
interactions from the same execution environment that can inspect and patch the
repo.

Implementation details:

- Browser access is gated by manager-owned runtime config, not only by the
  Worker binding existing.
- Update the Nanite system/task prompts so browser-capable Nanites know `cdp.*`
  exists inside `execute`.
- Require evidence before `complete` or `no_change` for browser-audit runs.
- Use dynamic sessions first. Add host-side session cleanup when reusable
  browser sessions are introduced.
- Keep Browser Run optional in global setup readiness. It becomes required only
  for creating or running this Nanite with browser evidence enabled.

`createBrowserTools()` is useful if SigVelo later wants a separate browser-only
tool surface with `browser_execute` and quick actions, but the unified `execute`
tool is a better first fit because this Nanite needs repo state, git, GitHub,
artifacts, and browser evidence in one plan.

## Modern Web Guidance corpus

Do not run `npx modern-web-guidance@latest` inside the Worker runtime. The npm
package is large and includes offline search assets. Pulling it into the Worker
bundle or running a package manager inside Think would make the first release
fragile.

Use linked Think skill sources installed into the Nanite workspace. The authored
runtime config should stay tiny:

```ts
type NaniteRuntimeSkills = {
  skillUrls: string[];
};
```

Each URL points at a GitHub skill repo or skill subpath, for example
`GoogleChrome/modern-web-guidance/skills/modern-web-guidance`.
The runtime resolves the URL list into workspace cache entries:

1. Store only the approved URLs in manager-owned `runtimeConfig.skillUrls`; do
   not extend the public Nanite manifest.
2. For each URL, normalize the source using Vercel Skills CLI semantics:
   `owner/repo`, GitHub URLs, refs, subpaths, and `owner/repo@skill`.
3. Resolve the link to a commit SHA and derive a stable fingerprint from source,
   ref, SHA, subpath, and selected skill.
4. Check the Nanite workspace first for
   `.sigvelo/skills/<fingerprint>/<skill-name>/SKILL.md`.
5. On a cache miss, run a Worker-native extractor that borrows the small Vercel
   CLI behaviors SigVelo needs: source parsing, safe subpath handling,
   `SKILL.md` discovery, requested-skill filtering, and GitHub tree/blob/raw file
   fetches. Do not run the CLI binary, `git clone`, `gh`, `child_process`, temp
   `fs` directories, or a package manager inside the Worker.
6. Write `SKILL.md` and its selected `references/`, `assets/`, and templates
   into the Nanite workspace under the reserved prefix. Workspace already spills
   large files to the configured R2 bucket, so do not add a separate skill
   bucket yet.
7. Record the resolved URL, ref, commit SHA, skill path, workspace prefix, and
   fingerprint in the Nanite workspace skill index after install; manager-owned
   runtime config keeps only the approved URLs.
8. Return a tiny workspace-backed `SkillSource` from
   `SigveloNaniteAgent.getSkills()` for Nanites with cached skill links. It
   should list/load `SKILL.md` metadata and lazily read resources from the
   workspace.
9. Start with instructions and references only. Keep `run_skill_script` disabled
   for linked skills until a real trust policy exists.
10. Let the Nanite cite the package version, commit SHA, and skill fingerprint
    in its run summary.

This gives users current guidance without tying every Nanite run to npm,
network availability, a 30 MB-plus runtime asset, or a custom SigVelo retrieval
tool. It also keeps the cache inside the Nanite's durable execution plane instead
of creating another storage path.

## WebMCP behavior

The Nanite should prefer WebMCP tools when the inspected site exposes them, but
WebMCP should not be a first-release prerequisite.

Browser workflow:

1. Open the target URL through Browser Run/CDP.
2. Check for `document.modelContext` first. Also check
   `navigator.modelContextTesting` for local/polyfill/testing environments.
3. List registered tools if the API is present.
4. Prefer WebMCP tools for app-specific actions such as opening records,
   reading current page state, or invoking safe app commands.
5. Fall back to DOM/CDP automation when no WebMCP tools exist.

Patch workflow:

- If the app lacks WebMCP and the repo shape supports it, the Nanite may propose
  a PR that adds app-local WebMCP tools.
- Use the local WebMCP packages when they match the repo shape, but do not add
  a large dependency by default.
- Avoid destructive tools. Client-side WebMCP tools should expose inspectable
  state and safe commands first.

Cloudflare Browser Run has a lab-mode WebMCP path, but the installed
`BrowserConnectorSessionOptions` do not currently expose a `lab` option. Before
claiming native Browser Run WebMCP support, confirm the upstream connector path
or add a lower-level session creation path that can request lab sessions.

## Specialist Nanite trigger model

The stronger long-term shape is not one Web Steward Nanite that owns a shared
browser and controls a fleet. Each specialist Nanite can own its own Browser Run
session, CDP inspection, skill profile, memory, and lifecycle outcome. The
interesting product question is when each specialist should wake up.

Nanites already have the right runtime split:

- `eventSource` is the cheap manager-level candidate filter: event family,
  repository, action, branch, or schedule shape.
- `triggerSource` is generated Worker-compatible TypeScript that makes the real
  relevance decision for that Nanite.
- Generated triggers return either `dispatch_self` with a small JSON payload or
  `noop` with a reason.
- If the trigger returns `noop`, no model run or Browser Run session is needed.
- If the trigger dispatches, that Nanite starts its own Run and can use its own
  browser capability.

That means a Modern Web Guidance fleet can be cheap even if many Nanites exist.
For PRs, every relevant candidate Nanite can inspect the webhook payload and
changed files before spending model or browser budget. The specialist can also
start a Run and then finish `no_change` if deeper repo or browser inspection
proves the PR does not matter.

Examples:

- `lcp-image-priority`: candidate on PRs touching HTML, app routes, image
  components, or asset manifests; dispatch only when changed files can affect
  above-the-fold images or page metadata.
- `accessible-forms`: candidate on PRs touching form components, validation
  utilities, labels, or design-system fields; dispatch only when diffs include
  form controls or error-message behavior.
- `dialog-popover-modernization`: candidate on PRs touching modals, dropdowns,
  popovers, menus, or top-layer UI; dispatch when the diff suggests custom
  visibility/focus management.
- `webmcp-instrumentation`: candidate on PRs touching app shell, routing,
  client entrypoints, or existing WebMCP/polyfill files; dispatch when the site
  lacks or changes `document.modelContext` tool registration.
- `inp-long-tasks`: candidate on PRs touching client JavaScript, hydration,
  analytics, interaction handlers, or large dependency changes; dispatch when
  the change could affect interaction latency.

The first release can still start from one broad Modern Web Guidance Nanite, but
the release plan should treat it as the seed of a guide-backed specialist
catalog. The follow-up design should decide which guides become durable
specialists, which stay as on-demand checks, and how the manager suggests them
based on repo evidence.

## Manager Starter Flow

Setup should not create this Nanite. After setup, the manager empty state should
offer a starter prompt that keeps creation in the normal manager path:

1. Confirm which installed repository the user wants to operate on. Signals include
   `package.json`, Vite/Next/Astro/Remix dependencies, `wrangler.jsonc`, Pages
   config, deployments, GitHub Pages, and build workflow names.
2. Ask for or infer a target URL. Prefer an existing deployment/preview URL.
3. Ask when the Nanite should run: manual only, on releases, on schedule, or on
   another explicit trigger.
4. Select the Modern Web Guidance linked skill and any supporting skills.
5. Show Browser Run readiness for this Nanite. If `BROWSER` is missing, allow
   creation in "repo-only guidance" mode or block only the first browser audit.
6. Create the Nanite through the manager's standard Nanite creation path.

The manager should record why it picked a repository and URL. If discovery is
weak, the chat should make that explicit instead of silently creating a Nanite
with no usable target.

## First run behavior

The first audit should be narrow and evidence-backed:

1. Inspect the repo shape and identify the frontend stack.
2. Resolve the target URL and current commit SHA.
3. Activate the linked Modern Web Guidance skill and read relevant resources.
4. Run Browser Run against the URL:
   - screenshot
   - console errors
   - network failures
   - accessibility snapshot or tree inspection where practical
   - basic interaction check for primary navigation
   - WebMCP tool presence/status
   - performance evidence focused on LCP/INP inputs, not a full Lighthouse clone
5. Decide whether there is a small, useful code change.
6. If changing code, patch the repo, run local validation, and open a PR or
   change proposal.
7. Finish through `complete`, `no_change`, `ask_manager`, or `fail`.

Evidence should be saved as artifacts when possible, not only summarized in the
model transcript. At minimum, store target URL, commit SHA, run timestamp,
screenshot reference, console/network summary, WebMCP status, and guidance
version.

## Implementation plan

This can land as a small PR stack. Do not add a first-class SigVelo stack model;
use normal branch stacking if review size needs it.

1. **Keep setup small**
   - Browser access is already gated by `runtimeConfig.browser`.
   - Setup creates the GitHub App, records repository selection, and launches
     the manager. It does not create the Modern Web Guidance Nanite.
   - Do not add manifest `scope.web` until export/import or trigger routing
     needs it.

2. **Attach the guidance corpus through Think skills**
   - Add the smallest authored shape: `runtimeConfig.skillUrls: string[]`.
   - Add a pre-turn or manager sync that checks the Nanite workspace cache first
     and installs only missing skill URLs.
   - Port the needed Vercel Skills CLI logic into a Worker-native extractor:
     source parsing, safe subpath handling, `SKILL.md` discovery, requested-skill
     filtering, and GitHub tree/blob/raw fetches.
   - After install, persist resolved metadata in the workspace skill index:
     approved URL, ref, commit SHA, skill path, workspace prefix, and
     fingerprint.
   - Add `SigveloNaniteAgent.getSkills()` that returns a workspace-backed
     `SkillSource` for the configured workspace prefix.
   - Keep script execution disabled for linked skills.

3. **Add the first-run prompt and evidence artifacts**
   - Include the target URL, repository, and guidance version in the run prompt.
   - Require screenshot, console/network summary, WebMCP status, and guidance
     references before `complete` or `no_change`.
   - Save evidence through the existing tool-output artifact path where possible.

4. **Smoke the release path**
   - Self-host setup creates GitHub App, selects repo, and reaches launch.
   - The manager starter prompt creates the Modern Web Guidance Nanite after
     asking for URL and cadence.
   - Browser Run and Worker Loader both execute from the deployed Worker.

## Open questions

- Should target URL edits mutate `runtimeConfig.browser`, or should one-off runs
  override it with a prompt payload?
- Which preview URL source should win when GitHub deployments, Cloudflare Pages,
  Workers preview URLs, and user-entered URLs disagree?
- What Browser Run cost warning belongs in the manager conversation before
  enabling scheduled audits?
- How should SigVelo persist browser evidence so a run outcome can link to it
  after transcript compaction?
- Do we need a low-level Browser Run lab-session path for WebMCP, or will
  Cloudflare expose that through `createExecuteTool`/`createBrowserTools` soon?
- What exact workspace prefix and cleanup policy should linked skills use?
- Which linked skill sources are trusted enough to enable `run_skill_script`?

## Sources

- Chrome Modern Web Guidance:
  <https://developer.chrome.com/docs/modern-web-guidance>
- Chrome Modern Web Guidance get started:
  <https://developer.chrome.com/docs/modern-web-guidance/get-started>
- Chrome Modern Web Guidance source:
  <https://github.com/GoogleChrome/modern-web-guidance-src>
- Chrome Modern Web Guidance skills list:
  <https://developer.chrome.com/docs/modern-web-guidance/explore-skills>
- Vercel Skills CLI:
  <https://github.com/vercel-labs/skills>
- Chrome WebMCP:
  <https://developer.chrome.com/docs/ai/webmcp>
- Chrome MCP vs WebMCP:
  <https://developer.chrome.com/docs/ai/webmcp/compare-mcp>
- WebMCP draft:
  <https://webmachinelearning.github.io/webmcp/>
- Cloudflare Agents SDK browser tooling changelog:
  <https://developers.cloudflare.com/changelog/post/2026-06-16-agents-sdk-v0161/>
- Cloudflare Think:
  <https://developers.cloudflare.com/agents/harnesses/think/>
- Cloudflare Think tools:
  <https://developers.cloudflare.com/agents/harnesses/think/tools/>
- Cloudflare Think workflows:
  <https://developers.cloudflare.com/agents/harnesses/think/workflows/>
- Cloudflare Browser Run:
  <https://developers.cloudflare.com/browser-run/>
- Cloudflare Browser Run WebMCP:
  <https://developers.cloudflare.com/browser-run/features/webmcp/>
- Cloudflare Browser Run pricing:
  <https://developers.cloudflare.com/browser-run/pricing/>
- Chrome DevTools MCP:
  <https://github.com/ChromeDevTools/chrome-devtools-mcp>
