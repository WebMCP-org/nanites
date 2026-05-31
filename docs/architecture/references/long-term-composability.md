# Long-Term Composability

This note captures the long-term builder and extensibility direction for Nanites.

It is not the product source of truth. Use these first:

- [../architecture.md](/docs/architecture/architecture.md)
- [../execution-architecture.md](/docs/architecture/execution-architecture.md)
- [explain-nanites-imports.md](/docs/architecture/references/explain-nanites-imports.md)

## Decision summary

The right long-term direction is:

- keep the manager thin
- keep the Nanite worker as the durable noun
- make the authored surface declarative and composable
- stay aligned with Cloudflare Session-style context assembly underneath
- avoid making `run` the primary product noun

The clearest product API is probably `Nanite.create(...)` or `Nanite.define(...)`, not `Session.create(...)`.

`Session` is still the right inspiration for:

- memory
- context blocks
- prompt assembly
- compaction
- conversation continuity

But `Session` is not the right top-level product noun for:

- triggers
- GitHub or support-PR ownership
- execution backend hints
- verification policy
- exit behavior
- lane continuity

## The key distinction

There are two different questions:

1. What should the authored API feel like?
2. What should the runtime compile to underneath?

The answer should be:

- authored API: `Nanite.create(...)` or `Nanite.define(...)`
- underlying context/memory layer: Session-style composition

That gives Nanites the right product noun without throwing away Cloudflare-aligned building blocks.

## Recommended authored shape

The API should read in lifecycle order and use domain nouns:

```ts
const webmcpMaintainer = Nanite.create(this)
  .withIdentity({
    id: "support-pr-maintainer",
    label: "WebMCP maintainer",
  })
  .startsWhen([
    Trigger.manual({ label: "Manual WebMCP maintainer run" }),
    Trigger.githubPullRequest({
      source: "contributor",
      actions: ["opened", "synchronize", "reopened"],
    }),
  ])
  .worksOn(Work.supportPrLane())
  .beforeWork([
    BeforeWork.waitForChecks(),
    BeforeWork.checkoutHeadBranch(),
    BeforeWork.collectReviewComments(),
  ])
  .withVariant("workspace-browser")
  .withMemory(
    Memory.buffer({
      description: "Learned facts, durable repo notes, and human constraints.",
      maxTokens: 1100,
    }),
  )
  .withSoul(Context.static(WEBMCP_SOUL.content))
  .withSkills(Context.repoSkills([WEBMCP_MAINTAINER_SKILL.key]))
  .withMcpServers([
    MCP.server({
      name: "WebMCP Documentation",
      url: "https://docs.mcp-b.ai/mcp",
    }),
  ])
  .withExitPolicy(
    ExitPolicy.explicit({
      success: [ExitCondition.changesPublished(), ExitCondition.requiredVerificationPassed()],
      pause: [ExitCondition.awaitingExternalChecks()],
      failure: [ExitCondition.missingExplicitExitTool()],
      maxReminders: 4,
    }),
  );
```

The important point is not the exact method names. The important point is that the declaration reads like one durable worker definition, not like a bag of low-level runtime options.

## What should be configurable

This builder direction is valuable because it gives Nanites a real extension seam for:

- triggers
- work ownership and artifact style
- GitHub collaboration mode
- prompt and memory context
- MCP server requirements
- execution backend hints
- verification policy
- exit rules

Those are the things that should be declared once and compiled into runtime behavior.

## What should stay outside the builder

The builder should not absorb repo-catalog or installation-control concerns.

Keep these outside:

- installation discovery
- repo list hydration
- manager routing topology
- cross-repo orchestration
- request-scoped Durable Object lookup

Those belong in the control plane, not in the Nanite definition itself.

This matches the current branch direction:

- [NaniteManagerState](/packages/contracts/src/nanites.ts:692) is small and dispatch-oriented.
- [NaniteLaneState](/packages/contracts/src/nanites.ts:686) is the durable worker-owned state.
- Repo state should resolve through the installation manager plus per-Nanite trigger decisions, not a shared dispatch layer.
- [repository-manager.ts](/apps/nanites/src/backend/nanites/repository-manager.ts) already derives configured Nanites from code and treats each Nanite as the owner of its live snapshot.

## How Session should fit

The right relationship to Session is:

- do not expose raw `Session.create(...)` as the top-level Nanite product API
- do use Session-like primitives under the hood for context and memory
- do keep a seam so Nanite context assembly can stay Cloudflare-compatible over time

That means the internal compiler can reasonably map authored Nanite clauses into lower-level layers like:

```ts
type CompiledNanite = {
  identity: NaniteIdentityConfig;
  triggerPolicy: TriggerPolicy;
  workPolicy: WorkPolicy;
  variant: NaniteVariant;
  context: SessionContextConfig;
  mcp: NaniteMcpConfig;
  exitPolicy: NaniteExitPolicy;
};
```

And the context portion can then compile into Session-style behavior:

```ts
const sessionContext = Session.create(this)
  .withContext("soul", compiled.context.soul)
  .withContext("memory", compiled.context.memory)
  .withContext("skills", compiled.context.skills)
  .compactAfter(compiled.context.compaction);
```

That keeps the good part of Session without forcing Session to become the product abstraction for every Nanite concern.

## Where the staged refactor went wrong

The main problem was not the goal. The problem was the order of abstraction.

The refactor reached for:

- authored DSL
- compiler
- runtime recipe
- surface modules
- policy helpers

before the primary noun had stabilized in code.

The result was too many overlapping nouns:

- manager
- owner
- run
- scope
- surface
- recipe

That made the architecture look more extensible while making the code harder to reason about.

The cleanest description of the failure is:

The refactor modeled Nanites like a framework before fully modeling them as durable workers.

## The deepest mismatch

`run` became too important too early.

That created pressure for:

- run keys
- run recipes
- run composition
- run projections
- run-level contracts
- run-level surfaces

But the thing that actually exists over time is the Nanite lane, not the run.

The healthier mental model is:

- `Nanite` is the worker
- the lane or owned artifact is what it carries forward
- the transcript is continuity
- a run is an attempt or a slice of history

That is why the current branch feels healthier where it promotes:

- [NaniteLaneSnapshot](/packages/contracts/src/nanites.ts:655)
- code-derived configured Nanites
- Nanite-owned snapshots

and demotes manager-owned run lists.

## Immediate language correction

The next cleanup should mostly de-emphasize `run` in public language and contracts.

Keep `runKey` if needed internally, but treat it as attempt correlation, not the main noun.

Prefer public language like:

- Nanite snapshot
- Nanite detail
- current attempt
- signal Nanite
- reconcile lane
- support PR lane

Avoid letting the API read like the product is built around runs.

## Surface seam guidance

A surface seam is still a good idea.

The mistake was making the surface contract too broad before there was more than one real collaboration mode.

Keep the seam, but keep it small.

A future surface module should contribute only a few things:

- prompt additions
- tools
- initialization behavior
- completion validation
- continuation guidance

Do not require a large default interface until a second real surface proves the need.

## What success looks like

The next rewrite should count as successful only if these are true:

- `Nanite` is the obvious durable noun
- the builder materially changes runtime behavior instead of decorating hardcoded logic
- manager/control-plane concerns remain outside the Nanite definition
- a second trigger or surface can be added without generic-runtime surgery everywhere
- the implementation is easier to trace than the monolith, not just more modular on paper

## Bottom line

The long-term direction should be:

- public authored API: `Nanite.create(...)`
- underlying memory/context strategy: Session-compatible
- durable product noun: Nanite lane
- supporting historical noun: run or attempt

That preserves Cloudflare alignment, keeps the product API honest, and avoids repeating the main failure mode of the staged refactor: too much framework before the Nanite itself was legible.
