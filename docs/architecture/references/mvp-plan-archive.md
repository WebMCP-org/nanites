# Sigvelo MVP and nanite substrate plan

## Status

Historical archive.

This file captures an earlier long-form MVP and substrate plan. The active Nanites docs now live in:

- `/docs/architecture/architecture.md`
- `/docs/architecture/execution-architecture.md`
- `/docs/architecture/roadmap.md`
- `/docs/architecture/user-stories.md`

## Purpose

This document is the implementation plan for the next clean pass on Sigvelo.

It is intentionally doing two jobs at once:

- define the narrow MVP we should actually ship
- preserve the good long-term architectural direction so we do not hard-code ourselves into a dead-end

The recent implementation spike taught us something important:

- the MVP should be much narrower than the full platform vision
- the substrate should still be designed like a real nanite system, not a one-off demo

That means this plan is not a rewrite back into a fake “just hard-code WebMCP” document.
It is also not a return to the earlier “vertical architecture” abstraction-heavy plan.

The correct middle ground is:

- one concrete nanite and one concrete user story for MVP
- on top of a general substrate built around soul, skills, tools, memory, transcript, and provider-backed context

## How to use this plan

This file is meant to be read by an implementation agent that does not have the full history in its head.

Use it in this order:

1. Read the executive summary and the product thesis.
2. Read the taxonomy section carefully. A lot of previous confusion came from using the wrong nouns.
3. Read the MVP scope and non-goals before touching code.
4. Read the nanite substrate section before making runtime decisions.
5. Read the implementation order and file guidance before editing.

This plan is intentionally long because the next agent should not need to reconstruct the product logic from scattered chats and partial diffs.

## Executive summary

Sigvelo should ship one brutally specific promise first:

> Install the GitHub App. We inspect your web app, add WebMCP where it makes sense, open a support PR, and keep that WebMCP layer from breaking as your team keeps shipping.

That is the MVP.

The company story can still be broader:

- maintenance agents that already know the job

But the first product experience should not look like a marketplace, a capability catalog, or a multi-vertical operating system.

The first shipped wedge should be:

- one GitHub App
- one nanite: `webmcp-maintainer`
- one repo-centric audit flow
- one support PR output
- one recurring maintenance loop

At the same time, we should preserve the right long-term architecture:

- nanites are parameterized agents
- their identity comes from soul, skills, tools, memory, and scope
- skill content should not be hard-coded into product branches forever
- provider-backed context and interchangeable agent files are the right direction

So the plan is:

- keep the substrate generic
- keep the product wedge specific

## Why this exists

### The customer problem

Teams are shipping more software than ever, and more of it is lightly maintained than they are willing to admit.

That is even more true for:

- internal apps
- operational dashboards
- admin tools
- AI-generated or AI-accelerated apps
- product surfaces that solve real business problems but never got a proper maintenance budget

These apps often lack what everyone knows they should have:

- observability
- accessibility
- agent-facing tooling
- security hardening
- stable maintenance workflows

The problem is not awareness. The problem is maintenance burden.

WebMCP is a perfect example of that burden:

- valuable enough to want
- easy enough to postpone
- easy enough to break
- subtle enough to drift without anyone noticing

That is exactly the class of work agents are good at.

### The product insight

Some classes of engineering work are not exciting feature work. They are maintenance work:

- important
- repetitive
- easy to deprioritize
- costly when neglected

WebMCP support belongs in that class.

So the product is not:

- “AI agents are cool”
- “the browser is the future”
- “here is a general autonomous coding platform”

The product is:

- WebMCP is useful
- teams do not want to hand-build and hand-maintain it
- Sigvelo can own that burden through GitHub PRs

### Why WebMCP first

WebMCP is a strong first wedge because it sits at the intersection of:

- real technical value
- real maintenance burden
- good demoability
- strong strategic relevance

It also has the right implementation shape for nanites:

- it is frontend-adjacent
- it can often be inferred from existing page structure and flows
- it benefits from real browser verification
- it produces reviewable diffs
- it drifts when UI code changes, which makes ongoing maintenance valuable

That makes it ideal as the first specialized nanite.

## Product positioning

### Company-level story

At the company level, Sigvelo can still be framed as:

- maintenance agents that already know the job

That is useful because it leaves room for future wedges:

- WebMCP maintenance
- observability maintenance
- accessibility maintenance
- design-system maintenance
- security maintenance

### MVP product story

The MVP product story should be much narrower:

- self-healing WebMCP for existing web apps

More concrete:

- install the GitHub App
- get a WebMCP readiness audit
- receive a support PR
- keep the integration healthy over time

### What not to lead with

Do not lead the product with:

- multi-nanite marketplace framing
- secrets, memories, scopes, tool catalogs
- cross-repo orchestration
- “verticals”
- “capabilities”
- Char as the primary entry point
- browser philosophy debates

Those may all matter later. They are not what gets the first customer to install the GitHub App.

The first buyer wants to understand one thing:

- will this take WebMCP maintenance off my team’s plate?

## Taxonomy decisions

This section matters because a lot of the previous implementation confusion came from using the wrong nouns too early.

### Keep these nouns

#### GitHub App

The installation surface and trust boundary.

#### Installation

The GitHub org or user account where the app is installed.

#### Selected repos

The repos the customer wants Sigvelo to audit and maintain.

This is more important in MVP than any installation-wide product taxonomy field.

#### Nanite

A specialized agent with:

- a purpose
- a soul
- skills
- tools
- memory and transcript
- optional secrets and scoped capabilities

#### Run

A single execution of a nanite against a repo.

#### Support PR

The concrete GitHub artifact produced by the nanite when it finds useful work to ship.

#### Soul

The identity and mission framing for a nanite.

This is the “what job do I have” layer.

#### Skill

Task-specific guidance and implementation doctrine loaded into the nanite.

This is the “how do I do this job well” layer.

#### Tool surface

The actual operations the nanite can perform:

- workspace inspection
- editing
- git
- browser verification
- publishing

#### Memory

The persistent context the nanite can carry across runs or sessions.

This is not required to be elaborate in MVP, but it is part of the correct long-term architecture.

### Avoid these nouns for MVP

#### `vertical`

This word caused confusion because it mixed:

- product strategy
- installation taxonomy
- nanite specialization
- future catalog thinking

Do not use it as the main product noun in MVP.

#### `mainVertical`

Do not build the MVP around this field.

It encodes too much product certainty too early and distracts from the real early user decision:

- which repos should Sigvelo audit?

#### `enabledCapabilities`

This is a better future noun than `vertical`, but it is still broader than what we need to ship first.

It may come back later. It should not dominate the first product and runtime rewrite.

## What we are actually shipping

### MVP definition

The MVP should ship the following experience:

1. A user lands on the Sigvelo site and understands the WebMCP maintenance promise.
2. They install the GitHub App.
3. They authenticate with GitHub.
4. They pick one or more repos to audit.
5. Sigvelo inspects those repos and identifies good WebMCP candidates.
6. For good candidates, the WebMCP nanite opens a support PR.
7. The user reviews and merges in GitHub.
8. As the team keeps shipping, Sigvelo opens follow-up maintenance PRs when the WebMCP layer drifts.

That is enough to get real customer feedback.

### What the MVP is not

The MVP is not:

- a generalized maintenance-agent control plane
- a multi-nanite product catalog
- a broad installation capability router
- a cross-repo intelligence engine
- a fully generalized agent marketplace

Those are credible long-term directions. They are not required to validate the first wedge.

## The specific wedge

### Nanite

Ship one nanite first:

- `webmcp-maintainer`

### Scope

Bias the first version toward:

- internal or operator-facing web apps
- React/Next/Vite style frontends
- Astro sites with meaningful interactive flows
- repos where there are obvious read, navigation, or form actions to expose

### Tool classes to support first

The first generated WebMCP layer should focus on a small set of tool classes:

- navigation tools
- read/state tools
- form prefill or submit tools

This is enough to make the product useful without pretending to solve the whole space on day one.

### What a good first PR should contain

The support PR should add a narrow, opinionated slice:

- WebMCP or polyfill wiring
- a small set of DOM-backed tools
- analytics or instrumentation hooks if we can add them cleanly
- browser verification
- ideally a preview URL or equivalent verification artifact

The PR should not:

- try to rewrite the app
- generate a giant tool catalog
- alter product logic unnecessarily

## User story in detail

The cleanest version of the user story is:

> Install the GitHub App, select the repos you want audited, and Sigvelo opens a PR that adds and then maintains WebMCP support for the apps that are good candidates.

Break that into concrete user-facing moments.

### Landing page moment

The user should immediately understand:

- what Sigvelo does
- why it matters
- what the next action is

The right message is:

- Sigvelo adds and maintains WebMCP for your existing web apps through GitHub PRs

Supporting points:

- no new infrastructure
- no hand-maintained agent layer
- reviewable diffs
- browser-verified changes

The CTA should be concrete:

- install GitHub App and get a WebMCP readiness audit + sample PR

### Setup moment

The setup flow should feel lightweight:

1. authenticate with GitHub
2. choose installation
3. choose repos to audit

If there is only one nanite in MVP, do not force a fake product-picker step.

### Audit moment

After repo selection, the user should get a clear answer for each repo:

- good candidate
- already instrumented
- poor candidate

The audit output should also say:

- why it is or is not a fit
- what kinds of tools are likely to be generated
- whether a support PR will be produced

### PR moment

The support PR is the product moment.

It should communicate:

- what Sigvelo added
- why those changes are safe
- what was verified
- how the tools map to real page behavior

### Maintenance moment

After merge, the user should not need to remember the WebMCP layer manually.

The maintenance loop should:

- notice relevant product changes
- re-run the nanite when appropriate
- open follow-up repair PRs if the WebMCP layer drifts

That is where the “self-healing” story becomes credible.

## Long-term architecture we should keep

This is the part I do not want to lose from the earlier plan.

The product wedge should be narrow. The nanite substrate should still be designed correctly.

### Nanites should be parameterized agents

A nanite should not just be a hard-coded branch in the product codebase.

A nanite should be assembled from:

- soul
- skills
- tool surface
- scoped context
- memory
- run transcript
- optional secrets

That keeps the architecture aligned with where agent systems are going generally.

### Soul, skills, and tools should be interchangeable inputs

The WebMCP maintainer is only the first specialization.

The runtime should make it easy to swap or add:

- a different soul
- different skill content
- different tools
- different provider-backed context

That does not mean we need a marketplace UI in MVP. It means the runtime should not be built as a dead-end one-off.

### Skill content should not be product-hardcoded forever

For the first implementation, local checked-in skill content is acceptable and probably preferable because it is:

- inspectable
- versioned
- easy to iterate
- easy to debug

But the interface should be designed so the source can evolve later:

- local checked-in content now
- synced content next
- R2-backed or remote provider-backed content later

The runtime should care about:

- `SkillProvider`

not about whether the bytes came from disk, repo sync, or R2.

### Provider-backed context is the right direction

The earlier plan was correct to keep Cloudflare `Session` and `SkillProvider` in view.

That is still the right long-term direction because it gives us:

- a standard context assembly model
- a standard place for soul and skills
- a cleaner path to persistent context and searchable context later
- a reusable shape across different nanites

### Keep runtime identity explicit

A nanite’s identity should come from explicit inputs:

- which soul it has
- which skills are loaded
- which tools are exposed
- what repo scope it has
- what secrets it has
- what memory it can access

That is better than hiding identity in product enums.

## Guidance on Cloudflare Agents SDK usage

The earlier plan also had useful architectural guidance here. Keep the good parts.

### Use `Session` and `SkillProvider` as the context model

The nanite runtime should compose context in a way that looks like:

- session
- soul block
- skills block
- tool surface
- transcript-backed run state

We should not discard that just because the MVP wedge is only one nanite.

### Do not blindly migrate everything to `Think`

The earlier correction still stands:

- do not replace the custom Nanite runtime with `Think` just because `Think` exists

Sigvelo already has real needs around:

- run lifecycle
- workspace hydration
- GitHub publishing
- run artifacts
- transcript projection

Use Cloudflare’s primitives as composition references, not as a reason to surrender runtime control.

### Keep the transcript as the durable run narrative

The strongest implementation learning was that transcript-projected run state is the correct foundation.

Keep that.

The runtime should not drift back into:

- transcript in one place
- separate append-only event log in another
- mutable snapshot state in a third

## Source pack and reading order

The next implementation agent should not start by guessing. Read the relevant code and reference material first.

Do not read everything blindly. Read in this order.

### 1. Current product and planning docs

Read first:

- [architecture.md](/docs/architecture/architecture.md)
- [execution-architecture.md](/docs/architecture/execution-architecture.md)
- [roadmap.md](/docs/architecture/roadmap.md)
- [user-stories.md](/docs/architecture/user-stories.md)

Purpose:

- understand the intended nanite direction
- understand the current runtime shape
- understand the next few sprints and product priorities

### 2. Sigvelo runtime and contract files

Read next:

- [nanites.ts](/apps/nanites/src/backend/nanites.ts)
- [github.ts](/apps/nanites/src/backend/github.ts)
- [session.ts](/apps/nanites/src/backend/browser-auth/session.ts)
- [auth.ts](/apps/nanites/src/backend/orpc/routers/auth.ts)
- [nanites.ts](/apps/nanites/src/backend/orpc/routers/nanites.ts)
- [repos.$repoId.tsx](/apps/nanites/src/frontend/routes/_authenticated/repos.$repoId.tsx)
- [nanites-chat.ts](/apps/nanites/src/shared/nanites-chat.ts)
- [auth.ts](/packages/contracts/src/auth.ts)
- [nanites.ts](/packages/contracts/src/nanites.ts)
- [installations.ts](/packages/db/src/schema/installations.ts)
- [installations.ts](/packages/db/src/zod/installations.ts)

Purpose:

- identify what substrate already exists
- identify what product-layer code should be discarded
- identify what contract shapes are worth preserving

### 3. Current nanite skill area

If present on the reset point, inspect:

- [provider.ts](/apps/nanites/src/backend/nanites/skills/provider.ts)
- [registry.ts](/apps/nanites/src/backend/nanites/skills/registry.ts)
- [webmcp-maintainer.ts](/apps/nanites/src/backend/nanites/skills/content/webmcp-maintainer.ts)
- [webmcp-soul.ts](/apps/nanites/src/backend/nanites/skills/content/webmcp-soul.ts)

If they are absent after reset, recreate them as the first concrete skill-provider slice.

Purpose:

- keep soul and skill content out of ad hoc product branches
- align the runtime with a provider-backed skill model early

### 4. Cloudflare Agents SDK reference sources

Read these to confirm the intended shape of session and skill composition:

- [think.ts](/opensrc/repos/github.com/cloudflare/agents/packages/think/src/think.ts)
- [session.ts](/opensrc/repos/github.com/cloudflare/agents/packages/agents/src/experimental/memory/session/session.ts)
- [context.ts](/opensrc/repos/github.com/cloudflare/agents/packages/agents/src/experimental/memory/session/context.ts)
- [skills.ts](/opensrc/repos/github.com/cloudflare/agents/packages/agents/src/experimental/memory/session/skills.ts)
- [skills.test.ts](/opensrc/repos/github.com/cloudflare/agents/packages/agents/src/tests/experimental/memory/session/skills.test.ts)
- [init-lifecycle.test.ts](/opensrc/repos/github.com/cloudflare/agents/packages/agents/src/tests/experimental/memory/session/init-lifecycle.test.ts)
- [mcp-client.md](/opensrc/repos/github.com/cloudflare/agents/docs/mcp-client.md)
- [resumable-streaming.md](/opensrc/repos/github.com/cloudflare/agents/docs/resumable-streaming.md)
- [workspace.md](/opensrc/repos/github.com/cloudflare/agents/docs/workspace.md)

Purpose:

- use the SDK the way it actually wants to be used
- borrow the good parts of `Session` and `SkillProvider`
- avoid replacing the custom Nanite runtime with `Think` blindly

### 5. First-party WebMCP and skill references

Read the local first-party references before writing the WebMCP maintainer skill content:

- [README.md](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/packages/agent-skills/README.md)
- [prompt.ts](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/packages/agent-skills/src/prompt.ts)
- [disclosure.ts](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/packages/agent-skills/src/disclosure.ts)
- [SKILL.md](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/skills/webmcp/SKILL.md)
- [SKILL.md](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/skills/webmcp-setup/SKILL.md)
- [README.md](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/packages/global/README.md)
- [global.ts](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/packages/global/src/global.ts)
- [README.md](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/packages/react-webmcp/README.md)
- [useWebMCP.ts](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/packages/react-webmcp/src/useWebMCP.ts)
- [model-context.ts](/Users/alexmnahas/personalRepos/WebMCP-org/npm-packages/packages/webmcp-types/src/model-context.ts)

Purpose:

- keep the WebMCP maintainer aligned with first-party WebMCP implementation patterns
- write better soul and skill content than a generic SDK example would provide

### 6. Landing site target files

When implementing the first real support PR flow, inspect the actual target app:

- [package.json](/apps/landing/package.json)
- [astro.config.mjs](/apps/landing/astro.config.mjs)
- [BaseLayout.astro](/apps/landing/src/layouts/BaseLayout.astro)
- [index.astro](/apps/landing/src/pages/index.astro)
- [about.astro](/apps/landing/src/pages/about.astro)

Purpose:

- understand whether the landing site is a good first WebMCP maintenance target
- verify framework constraints before shaping the skill

If something must survive restore and power the run UI, it should be represented in the durable transcript or clearly derived from it.

## System principles

These are the guardrails for the next implementation pass.

### 1. Sell the outcome, hide the platform

Customers buy:

- support PRs
- browser verification
- maintenance relief

They do not buy:

- our internal runtime taxonomy
- our provider architecture
- our memory model

Those still matter, but they belong below the product line.

### 2. Keep the wedge specific

Do not expand the product scope because the substrate is general.

The product can stay:

- one nanite
- one problem
- one reviewable output

while the runtime stays reusable.

### 3. Prioritize repo selection over installation taxonomy

The most important early user choice is:

- which repos should Sigvelo audit?

That is a more valuable MVP decision surface than:

- which product category is enabled for the installation?

### 4. The PR is the unit of trust

The support PR is where the product earns credibility.

That means:

- clean diff
- clear explanation
- real verification
- safe review story

Everything else is in service of that moment.

### 5. Co-locate unstable concepts

Do not split code into many modules just because that is what a later cleanup might want.

In this phase, it is acceptable and often preferable to keep a concept in one large file if:

- the concept is still evolving
- naming is good
- sections are clear
- duplication is controlled

The goal is ease of reasoning, especially for the AI maintainer.

### 6. Dedupe aggressively inside those large files

“Keep it together” does not mean:

- copy logic everywhere
- stack patches on top of patches
- let naming drift

It means:

- keep the concept co-located
- make the logic internally coherent

### 7. Use the repo’s real workflow

If the repo uses `vp`, the nanite must learn `vp`.

If the repo supports browser verification, the nanite should use it where useful.

The runtime and skills should push the agent toward the repo’s actual tooling, not generic defaults.

## MVP UX surfaces

### Landing page

The landing page should communicate:

- what this does
- who it is for
- how it works
- what the next action is

Recommended core message:

- Self-healing WebMCP for existing web apps.

Recommended subhead:

- Install the GitHub App, get a PR that adds WebMCP to your core flows, and keep it working as your UI changes.

Do not overload the first screen with:

- multi-agent taxonomy
- future vertical catalog
- cross-repo orchestration

### Setup flow

The setup flow should be:

1. install GitHub App
2. authenticate with GitHub
3. choose installation
4. choose repos to audit

That is enough for the first version.

### Repo page

The repo page should answer:

- is this repo eligible?
- which nanite can run here?
- what did the last audit find?
- is there an open support PR?
- what maintenance history exists?

### Run page

The run page should show:

- current status
- phase
- structured execution rail
- final artifact
- PR outcome

The run UI is valuable because it makes the agent legible during review and debugging.

## WebMCP maintainer behavior

The `webmcp-maintainer` nanite should own one loop.

### Step 1: inspect and determine candidacy

The nanite should inspect:

- app shape
- framework
- route structure
- visible workflows
- whether useful agent-facing actions exist
- whether WebMCP already exists

Possible outcomes:

- good candidate, implement
- already instrumented, repair or no-op
- poor candidate, explain why and stop without PR

This is better than assuming every selected repo deserves a PR.

### Step 2: add or repair the WebMCP layer

When the repo is a fit, the nanite should:

- add minimal, reviewable instrumentation
- expose only a small number of useful tools
- bind those tools to real app behavior
- avoid rewriting business logic

### Step 3: verify

The nanite should verify:

- the page loads
- the integration boots correctly
- the expected tools exist
- the tools read or act against real DOM-backed behavior
- the changes do not obviously break the page

### Step 4: publish support PR

When useful changes are present, the nanite should:

- commit them
- push a branch
- open or update the support PR
- record the PR result in the run artifact

### Step 5: maintain over time

After merge, future changes should be able to trigger the nanite again when the WebMCP layer is likely to drift.

That is the maintenance promise.

## Implementation boundaries

### Product layer

The product layer owns:

- GitHub App install flow
- repo selection
- audit orchestration
- run visibility
- support PR visibility

### Nanite substrate

The nanite substrate owns:

- run lifecycle
- transcript and projection
- workspace hydration
- skill loading
- tool composition
- browser/workspace execution
- support PR publishing

### Skill system

The skill system owns:

- how skill content is represented
- how it is loaded
- how the nanite references it
- how the source can evolve from local content to synced or R2 content later

## Skill and soul architecture

This is important enough to spell out explicitly.

### Soul

The soul should contain:

- mission
- behavioral framing
- boundaries
- priorities

For `webmcp-maintainer`, that means:

- maintain agent-ready WebMCP instrumentation
- prefer narrow DOM-backed tools
- avoid destructive behavior
- verify against the real page

### Skills

Skills should contain:

- implementation guidance
- repo-specific best practices
- verification checklist
- tool design preferences

The skill content should be allowed to evolve independently of the core runtime.

### Tool surface

The runtime tool surface should remain composable and explicit.

For the WebMCP maintainer, that likely means:

- workspace read and write
- search and inspection
- git
- browser or preview verification
- support PR publishing

### Memory

Memory is not the center of MVP, but the architecture should not preclude it.

At minimum, the system should be able to evolve toward:

- run history awareness
- repo-specific long-lived context
- later, cross-run maintenance knowledge

## Source-of-truth decisions

### Run truth

The run transcript plus projected snapshot is the durable run truth.

### Skill truth

For now:

- local checked-in skill content is acceptable

Later:

- synced or provider-backed skill content should be allowed

The abstraction should be:

- provider-backed skills

not:

- hard-coded product branching

### Repo truth

The actual repo contents remain the source of truth for:

- candidacy
- implementation surface
- drift

### Product truth

The customer-visible truth is:

- selected repos
- latest audit status
- latest support PR state
- maintenance history

## Implementation order

This is the recommended execution order after reset.

### Step 0: reset to the last clean substrate commit

Recommended reset target is around:

- `319cb29` for transcript-projected run state

Potentially also keep:

- `1343c2f` for structured run stream UI
- `c11f2e3` for streamed runtime-status classification fix

Everything after that should be reconsidered, not blindly re-applied.

### Step 1: preserve the transcript-projected runtime foundation

Keep and stabilize:

- transcript-projected run state
- run snapshot projection
- structured run stream UI

This is the best runtime foundation we found.

### Step 2: define the WebMCP maintainer as a real nanite, not a product enum

Add or keep:

- nanite identity
- specialization or role metadata
- soul
- skill keys
- tool surface

But do this as nanite definition work, not as installation taxonomy work.

### Step 3: implement a clean skill-provider path

Use:

- local checked-in skill content first
- provider interface from the beginning

The runtime should not care whether the skill bytes come from:

- local repo files
- synced storage
- R2

### Step 4: ship GitHub install + repo selection

Make repo selection the main early user decision.

Do not block the MVP behind a broad product picker.

### Step 5: implement repo audit and candidacy output

Before automatic PRs, the system should be able to explain:

- is this repo a good WebMCP candidate?
- why or why not?
- what initial tool surface is likely?

### Step 6: ship manual bootstrap support PRs

This is the first end-to-end trust loop:

- run nanite
- make changes
- verify
- publish PR

### Step 7: automate bootstrap after repo selection

Once the manual path is believable:

- trigger audit/bootstrap automatically after repo selection

### Step 8: ship recurring maintenance

After the bootstrap loop is solid:

- re-run on relevant future changes
- publish maintenance PRs when drift is detected

## File and code guidance

### Runtime

Primary runtime work remains centered in:

- `apps/nanites/src/backend/nanites.ts`

That is acceptable while the concept is still fluid.

Keep the file well-sectioned. Do not split it for aesthetics alone.

### Auth and setup

Repo selection and install flow will likely touch:

- `apps/nanites/src/backend/browser-auth/session.ts`
- `apps/nanites/src/backend/orpc/routers/auth.ts`
- `apps/nanites/src/frontend/routes/_authenticated.tsx`
- related setup components

### GitHub integration

Support PR publishing and repo resolution will likely touch:

- `apps/nanites/src/backend/github.ts`

### Contracts

Keep contracts aligned with the substrate:

- `packages/contracts/src/auth.ts`
- `packages/contracts/src/nanites.ts`

Do not let contracts become a graveyard of abandoned product taxonomy.

### Skills

Skill content and provider code should live under:

- `apps/nanites/src/backend/nanites/skills/`

That gives us a clean place for:

- soul content
- skill content
- provider logic
- future remote-content sync

## Metrics and feedback loops

The MVP should optimize for learning, not for looking like a full platform.

Track:

- install rate
- repo selection rate
- percentage of repos that are good candidates
- percentage of first PRs that are merged
- time from install to first PR
- frequency of follow-up maintenance PRs
- whether the generated tools actually get used
- how much manual intervention is needed

The most important feedback questions are:

- Did the user install?
- Did they trust the first PR?
- Did they merge it?
- Did later PRs save them work?

## Go-to-market implications

### Sell the outcome

The first sales story should be:

- We add WebMCP to your app and keep it from breaking.

### Concierge is acceptable

The first customer version does not need to be perfectly automated behind the scenes.

What matters is the customer experiences:

- fast install
- clear audit
- clean PR
- believable maintenance loop

### Char is a follow-on, not the entry point

Char remains a good downstream story:

- apps maintained by Sigvelo become naturally usable by Char

But do not make that the primary entry point for MVP.

The customer should first understand the maintenance value on its own.

## Things explicitly deferred

These can come later if the wedge works:

- multiple nanites in the product UI
- installation-wide capability taxonomy
- cross-repo maintenance workflows
- org-wide documentation propagation
- backend-to-frontend coordination nanites
- broad maintenance catalog

Do not build too much product surface for these before one wedge is proven.

## Summary

The right next build is:

- one concrete product promise
- one concrete nanite
- one concrete output
- on top of a general nanite substrate

That means:

- narrow MVP
- broad-compatible architecture

Specifically:

- ship `webmcp-maintainer` first
- keep transcript-projected run state
- keep the structured run UI
- keep the skill/provider/soul direction
- make repo selection the key setup decision
- use support PRs as the unit of trust
- let future breadth come after customer proof, not before it
