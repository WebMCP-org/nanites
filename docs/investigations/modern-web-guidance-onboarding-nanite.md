# Modern Web Guidance onboarding Nanite investigation

**Date:** 2026-06-17
**Status:** Plan, not implemented

## Recommendation

Create one first-run Nanite during setup: **Modern Web Guidance**. It should be
manual by default, scoped to one selected repository and one web target URL when
setup can discover or ask for one. The first run should audit the app against
Chrome's Modern Web Guidance, collect real browser evidence through Cloudflare
Browser Run, and end with one of four explicit outcomes:

- `complete`: opened a PR or produced a concrete change proposal.
- `no_change`: verified the target and found no useful change.
- `ask_human`: needs a preview URL, login, approval, or cost-sensitive browser
  run.
- `fail`: browser/runtime/source inspection failed in a repeatable way.

Do not make this a push-triggered Nanite for the first release. The setup flow
should create the Nanite and offer to run its first audit, then let users opt
into schedules or GitHub-triggered runs later. That keeps setup useful without
creating a background browser-cost surprise.

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
versions checked on 2026-06-17 are:

| Package                     | Repo range today | npm latest     |
| --------------------------- | ---------------- | -------------- |
| `agents`                    | `^0.16.0`        | `0.16.2`       |
| `@cloudflare/think`         | `^0.9.0`         | `0.10.0`       |
| `@cloudflare/codemode`      | `^0.4.0`         | `0.4.1`        |
| `@cloudflare/ai-chat`       | `^0.8.5`         | `0.8.6`        |
| `wrangler`                  | `^4.100.0`       | `4.101.0`      |
| `@cloudflare/workers-types` | `^4.20260612.1`  | `4.20260617.1` |

Cloudflare Agents SDK source is now mirrored locally in `openSRC`:

- Agents monorepo:
  [openSRC/repos/github.com/cloudflare/agents/main](../../openSRC/repos/github.com/cloudflare/agents/main)
  (`8019e61b9695b2f7a1f89abb64ca09cb1f3c518e`).
- `agents` package:
  [openSRC/repos/github.com/cloudflare/agents/main/packages/agents](../../openSRC/repos/github.com/cloudflare/agents/main/packages/agents)
  (`0.16.2`).
- `@cloudflare/think` package:
  [openSRC/repos/github.com/cloudflare/agents/main/packages/think](../../openSRC/repos/github.com/cloudflare/agents/main/packages/think)
  (`0.10.0`).
- `@cloudflare/codemode` package:
  [openSRC/repos/github.com/cloudflare/agents/main/packages/codemode](../../openSRC/repos/github.com/cloudflare/agents/main/packages/codemode)
  (`0.4.1`).
- `@cloudflare/shell` package:
  [openSRC/repos/github.com/cloudflare/agents/main/packages/shell](../../openSRC/repos/github.com/cloudflare/agents/main/packages/shell)
  (`0.4.0`).
- `@cloudflare/ai-chat` package:
  [openSRC/repos/github.com/cloudflare/agents/main/packages/ai-chat](../../openSRC/repos/github.com/cloudflare/agents/main/packages/ai-chat)
  (`0.8.6`).

For browser work, the most relevant local files are the
[Think tools doc](../../openSRC/repos/github.com/cloudflare/agents/main/docs/think/tools.md),
[`packages/think/src/tools/execute.ts`](../../openSRC/repos/github.com/cloudflare/agents/main/packages/think/src/tools/execute.ts),
[`packages/think/src/tools/browser.ts`](../../openSRC/repos/github.com/cloudflare/agents/main/packages/think/src/tools/browser.ts),
and
[`packages/agents/src/browser/connector.ts`](../../openSRC/repos/github.com/cloudflare/agents/main/packages/agents/src/browser/connector.ts).

Modern Web Guidance is now mirrored locally in `openSRC`:

- Generated skill install target:
  [openSRC/repos/github.com/GoogleChrome/modern-web-guidance/main](../../openSRC/repos/github.com/GoogleChrome/modern-web-guidance/main)
  (`18c2f84274f959df2b31b919c4b16a2cc65e82e1`, release `v0.0.173`).
- Source and eval authoring repo:
  [openSRC/repos/github.com/GoogleChrome/modern-web-guidance-src/main](../../openSRC/repos/github.com/GoogleChrome/modern-web-guidance-src/main)
  (`014e2600c4abbf564412c269baa03f1b11e4bbde`).

Use the generated `skills/modern-web-guidance` tree as the first source for the
onboarding Nanite corpus. Use the source repo when the implementation needs
guide metadata, tests, or generation scripts.

## Current Nanites fit

The Nanites architecture already has the right boundary for this. A Nanite
definition stays thin: identity, scope, purpose, model, event source,
permissions, and stop conditions. The Think runtime owns the actual work.

Current repo state:

- `wrangler.jsonc` already declares `LOADER` and `BROWSER` bindings.
- `NanitesSetupAgent.checkBrowserBinding()` treats Browser Run as optional and
  labels it future preview verification support.
- `SigveloNaniteAgent.getTools()` creates the `execute` tool with workspace,
  git, artifacts, and optional GitHub MCP connectors, but it does not pass
  `browser: this.env.BROWSER`.
- The setup wizard currently has five steps: Cloudflare, GitHub App,
  repositories, upstream star, and launch. There is no initial-Nanite step.
- `sigvelo_create_nanite` supports manual, schedule, scheduleEvery, and GitHub
  event sources. Manual is enough for the onboarding Nanite.

The immediate runtime gap is therefore small: expose Browser Run to Nanites
through the existing `execute` tool, with a permission/capability gate so this
does not silently grant every Nanite browser access.

## Proposed onboarding Nanite

Name: `Modern Web Guidance`

Purpose: keep one web app aligned with modern web platform guidance using repo
inspection plus live browser evidence.

Default scope:

- One selected GitHub repository.
- One target URL if setup can discover it, or a user-entered URL.
- Public or preview pages only for the first release. Authenticated flows should
  require a human approval path because Browser Run can act on page sessions.

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

This can live in the manifest as a new top-level `scope.web` field, or in a
Nanite-specific config table keyed by installation and Nanite id. A manifest
field is simpler for self-host export/import; a config row is easier to edit in
the setup UI without changing the Nanite's identity.

## Runtime wiring

Use the existing `execute` tool as the main surface. Installed
`@cloudflare/think` already supports:

```ts
createExecuteTool({
  ctx: this.ctx,
  state: createWorkspaceStateBackend(this.workspace),
  browser: this.env.BROWSER,
  loader: this.env.LOADER,
  session: { mode: "dynamic" },
});
```

When `browser` is present, the code sandbox exposes `cdp.*` for Chrome DevTools
Protocol work. That means the Nanite can load a live URL, inspect DOM and
accessibility state, capture screenshots, read console/network state, and test
interactions from the same execution environment that can inspect and patch the
repo.

Implementation details to plan for:

- Gate browser access on an explicit Nanite capability, not only on the Worker
  binding existing.
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

Use a smaller release slice:

1. Start from the local generated skill tree at
   [openSRC/repos/github.com/GoogleChrome/modern-web-guidance/main/skills/modern-web-guidance](../../openSRC/repos/github.com/GoogleChrome/modern-web-guidance/main/skills/modern-web-guidance).
   Add a dev/release script later if this needs repeatable refreshes from
   `modern-web-guidance@latest`.
2. Start with webmcp, performance/LCP/INP, accessibility, forms, dialogs,
   popovers, passkeys, and CSP.
3. Store the package version and refresh timestamp with the extracted corpus.
4. Expose the corpus through a small retrieval tool or session context block:
   search by task, then read the exact guide.
5. Let the Nanite cite the guidance version in its run summary.

This gives users current guidance without tying every Nanite run to npm,
network availability, or a 30 MB-plus runtime asset.

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

The onboarding release can still create one broad Modern Web Guidance Nanite,
but the release plan should treat it as the seed of a guide-backed specialist
catalog. The follow-up design should decide which guides become durable
specialists, which stay as on-demand checks, and how setup installs or suggests
them based on repo evidence.

## Setup flow

Add a setup step between repository selection and launch:

1. Discover candidate web repositories from selected repos. Signals include
   `package.json`, Vite/Next/Astro/Remix dependencies, `wrangler.jsonc`, Pages
   config, deployments, GitHub Pages, and build workflow names.
2. Pick the strongest candidate by default, but let the user change it.
3. Ask for or infer a target URL. Prefer an existing deployment/preview URL.
4. Show Browser Run readiness for this Nanite. If `BROWSER` is missing, allow
   creation in "repo-only guidance" mode or block only the first browser audit.
5. Create the Nanite through the manager, not through the public MCP setup path.
6. On launch, show the created Nanite and offer `Run first audit`.

The setup agent should record why it picked a repository and URL. If discovery
is weak, the UI should make that explicit instead of silently creating a Nanite
with no usable target.

## First run behavior

The first audit should be narrow and evidence-backed:

1. Inspect the repo shape and identify the frontend stack.
2. Resolve the target URL and current commit SHA.
3. Fetch relevant Modern Web Guidance sections.
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
7. Finish through `complete`, `no_change`, `ask_human`, or `fail`.

Evidence should be saved as artifacts when possible, not only summarized in the
model transcript. At minimum, store target URL, commit SHA, run timestamp,
screenshot reference, console/network summary, WebMCP status, and guidance
version.

## Implementation plan

1. **Refresh Cloudflare packages**
   - Bump `@cloudflare/think` to `^0.10.0`.
   - Bump `agents` to `^0.16.2`, `@cloudflare/codemode` to `^0.4.1`,
     `@cloudflare/ai-chat` to `^0.8.6`, `wrangler` to `^4.101.0`, and
     `@cloudflare/workers-types` to `^4.20260617.1` if the lockfile does not
     already resolve them.
   - Run `vp install`, then `vp check` and `vp test`.

2. **Add browser capability to Nanite manifests**
   - Extend the manifest schema with a browser/web capability or web scope.
   - Keep GitHub permissions derived from GitHub app permissions as they are
     today.
   - Add a capability check in `SigveloNaniteAgent.getTools()` before passing
     `browser: this.env.BROWSER`.

3. **Expose CDP to browser-capable Nanites**
   - Pass `browser: this.env.BROWSER` and `session: { mode: "dynamic" }` into
     `createExecuteTool`.
   - Update system/task prompts and lifecycle expectations for evidence.
   - Add session cleanup if dynamic sessions can be promoted to longer-lived
     sessions.

4. **Build the Modern Web Guidance corpus path**
   - Add a script that fetches the current package and extracts selected guides.
   - Store version metadata.
   - Expose search/read to the Nanite via a small tool or context provider.

5. **Add onboarding creation to setup**
   - Add the wizard step.
   - Implement repo/site discovery.
   - Create the Nanite through the installation manager.
   - Launch into the created Nanite with a first-audit action.

6. **Add first-run template and artifacts**
   - Add a run starter prompt for "Modern Web Guidance audit".
   - Save browser evidence artifacts.
   - Add slice integration coverage for creation and first-run state transitions.

7. **Smoke the release path**
   - Self-host setup creates GitHub App, selects repo, creates onboarding
     Nanite, and reaches launch.
   - Browser Run and Worker Loader both execute from the deployed Worker.
   - A first audit on a public target ends in `no_change`, `ask_human`, or a PR,
     never an unreported active run.

## Open questions

- Where should the target URL live: manifest scope, Nanite config table, or
  first-run trigger payload?
- Which preview URL source should win when GitHub deployments, Cloudflare Pages,
  Workers preview URLs, and user-entered URLs disagree?
- What Browser Run cost warning belongs in setup before enabling scheduled
  audits?
- How should SigVelo persist browser evidence so a run outcome can link to it
  after transcript compaction?
- Do we need a low-level Browser Run lab-session path for WebMCP, or will
  Cloudflare expose that through `createExecuteTool`/`createBrowserTools` soon?
- Which Modern Web Guidance sections are enough for the release seed corpus?

## Sources

- Chrome Modern Web Guidance:
  <https://developer.chrome.com/docs/modern-web-guidance>
- Chrome Modern Web Guidance get started:
  <https://developer.chrome.com/docs/modern-web-guidance/get-started>
- Chrome Modern Web Guidance source:
  <https://github.com/GoogleChrome/modern-web-guidance-src>
- Chrome Modern Web Guidance skills list:
  <https://developer.chrome.com/docs/modern-web-guidance/explore-skills>
- Chrome WebMCP:
  <https://developer.chrome.com/docs/ai/webmcp>
- Chrome MCP vs WebMCP:
  <https://developer.chrome.com/docs/ai/webmcp/compare-mcp>
- WebMCP draft:
  <https://webmachinelearning.github.io/webmcp/>
- Cloudflare Agents SDK browser tooling changelog:
  <https://developers.cloudflare.com/changelog/post/2026-06-16-agents-sdk-v0161/>
- Cloudflare Think tools:
  <https://developers.cloudflare.com/agents/harnesses/think/tools/>
- Cloudflare Browser Run:
  <https://developers.cloudflare.com/browser-run/>
- Cloudflare Browser Run WebMCP:
  <https://developers.cloudflare.com/browser-run/features/webmcp/>
- Cloudflare Browser Run pricing:
  <https://developers.cloudflare.com/browser-run/pricing/>
- Chrome DevTools MCP:
  <https://github.com/ChromeDevTools/chrome-devtools-mcp>
