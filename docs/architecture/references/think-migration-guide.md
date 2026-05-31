# Nanites Think Context Guide

This archived note was originally an implementation guide for moving Nanites from the
`AIChatAgent`-based runtime to Think with Session-backed storage and context assembly.

That migration is no longer the active release task. Current release architecture uses stable Think
Nanite sub-agents, SDK-native sub-agent chat routing, generated inbound trigger handlers only, and a
manager that owns policy, registry, routing, and capability validation.

It is not the product source of truth. Use these first:

- [../architecture.md](/docs/architecture/architecture.md)
- [../execution-architecture.md](/docs/architecture/execution-architecture.md)
- [long-term-composability.md](/docs/architecture/references/long-term-composability.md)

## Current decision

Nanites run on Think.

The reason is not that Nanites need a better chat abstraction. The reason is that Nanites have
durable lane identity and need strict context management.

Think gives Nanites the right primitives for:

- programmatic turns via `saveMessages()`
- durable continuation via `continueLastTurn()`
- recovery via `unstable_chatRecovery` and `onChatRecovery()`
- bounded replay via Session compaction
- explicit context blocks instead of replaying raw transcript history

Do not adopt Think as a license to make Nanites into unbounded forever chats.

The durable thing is the Nanite lane. The model context should stay bounded.

## Problems this note was written to avoid

The old runtime path had three structural problems:

1. It persists a chat transcript but has no real compaction strategy.
2. It filters out `runtime-status` messages before replay, but otherwise replays too much conversational history to the model.
3. It uses attempt-oriented primitives (`runKey`, synthetic follow-up messages, recovery prompts) to approximate what Think already models directly.

The immediate smell is:

- `maxPersistedMessages = 50`
- raw user and assistant turns survive across attempts
- logs and follow-up text can become model-visible if they are not tagged as filtered runtime status
- old attempt context is noisy but still sticky

That is not a stable foundation for lane-owned memory.

## Target context model

Nanites should be modeled like this:

- **Nanite lane**: the durable worker and product noun
- **Current attempt**: transient execution metadata for one triggered pass
- **Session transcript**: the working chat history for the current attempt window
- **Context blocks**: the durable memory and runtime-owned summaries that survive beyond one attempt

The key rule is:

The model should learn about older work through compacted summaries and explicit memory blocks, not through raw transcript replay.

## Storage model

Use Session for conversation storage, but split Nanite state into four buckets.

### 1. Session transcript

Use for:

- current attempt operator prompts
- recent model reasoning and tool use
- the current attempt's publish / verify / pause loop

Do not treat this as the canonical long-term memory surface.

### 2. Lane memory context block

Use for durable facts the Nanite should carry forward across attempts:

- stable repo facts
- human constraints
- known preview quirks
- prior reviewer guidance worth preserving
- branch or PR lane invariants

This should be writable by the runtime and, carefully, by the model.

### 3. Current attempt context block

Use for runtime-owned attempt summary:

- trigger
- current scope
- current prepared checkout
- latest generic output URL or change proposal state
- latest GitHub evidence the Nanite chose to inspect
- outstanding blocker or next action

This should be rewritten by the runtime as the attempt advances. It should not depend on the model to stay correct.

### 4. Searchable archived history

Use Session search or another archive path for:

- older attempts
- old operator notes
- old failures
- prior support PR outcomes

This history should be retrievable on demand, not replayed by default.

## Context policy

The Think runtime only helps if Nanites follow strict context hygiene.

### Default replay policy

On a normal turn, the model should receive:

- the frozen system prompt
- lane memory
- current attempt block
- the tail of the current transcript

It should not receive:

- raw logs from prior attempts
- stale operator chatter
- old browser verification transcripts
- superseded follow-up prompts
- raw runtime status spam

### Attempt boundary policy

Starting a new attempt should clear the working transcript by default.

Keep:

- lane memory
- support PR state
- current work URL
- searchable archived history
- durable business facts

Clear:

- current session transcript
- prior attempt-only follow-up prompts
- prior attempt tool chatter
- prior attempt logs pasted by operators

This is the simplest escape hatch and the safest default.

If the product later wants "continue prior transcript" as an advanced operator control, make that explicit and opt-in.

## Recommended context blocks

The first pass should keep the block set small.

### `soul`

Readonly.

Contains the stable Nanite identity and execution rules that currently live in `buildSystemPrompt()`.

### `repo`

Readonly.

Contains stable repository facts:

- repository name
- default branch
- configured MCP servers
- configured Nanite definition

### `lane-memory`

Writable.

Contains durable facts that survive across attempts but should remain compact.

### `current-attempt`

Runtime-owned.

Contains the current execution snapshot in plain language. This is where the runtime should explain:

- what triggered this attempt
- what checkout is actually prepared
- what the support PR state is
- whether the Nanite is blocked, waiting, or ready to finish

### Optional `history-index`

Searchable.

Contains compact summaries of prior attempts if the model needs to look back.

## Old pattern mapping

### Avoid reintroducing these patterns

- `saveMessages((messages) => [...messages, createSyntheticUserMessage(...)])`
- `queueRuntimeFollowUpTurn(...)`
- `recoverInterruptedChatTurn(...)`
- ad hoc replay of prior transcript messages with local filtering

### With these Think patterns

- `saveMessages()` for runtime-injected follow-up turns
- `continueLastTurn()` for continuation after interruption or pause
- `onChatRecovery()` for durable turn recovery
- `assembleContext()` for explicit context assembly
- Session compaction instead of message-count truncation

## Historical migration phases

These phases are retained as context for old branch review. They are not the current release plan.

### Phase 1: Port the Nanite class to Think

Keep the current Nanite tool surface and runtime contracts. Do not redesign behavior at the same time.

The goal of this phase is to replace the chat substrate, not the Nanite product model.

### Phase 2: Add attempt-aware context assembly

Implement `assembleContext()` so the model sees:

- compacted lane memory
- current attempt summary
- transcript tail only

Do not ship Think with raw full-history replay.

### Phase 3: Replace synthetic resume paths

Move:

- explicit follow-up prompts
- interrupted chat recovery
- scheduled runtime follow-ups

onto:

- `saveMessages()`
- `continueLastTurn()`
- `onChatRecovery()`

### Phase 4: Add explicit operator escape hatches

Expose buttons or RPC actions for:

- end current attempt
- fail current attempt
- clear working transcript
- reset lane state
- start fresh attempt

These should be product features, not debugging tricks.

## Product escape hatches

The Think runtime should expose explicit controls.

### Start fresh attempt

Behavior:

- ends or supersedes the current attempt
- clears session transcript
- preserves lane memory and lane-owned surfaces
- starts a new current attempt block

This should be the default behavior for "start a new run" unless the product later adds a separate "continue transcript" action.

### Clear transcript

Behavior:

- clears only the working Session history
- preserves lane memory
- preserves support PR state
- preserves current work URL

Use this when the model is confused but the lane should stay intact.

### End attempt

Behavior:

- marks the current attempt completed or cancelled
- preserves transcript for inspection
- prevents further automatic continuation

### Reset lane

Behavior:

- clears transcript
- clears lane memory
- clears recovery checkpoints
- clears active runtime-owned state

Use this sparingly. This is the "factory reset" button.

## Rules for model-visible logs

Operators will paste logs. Some of that is useful. Most of it should not become durable model context.

Adopt these rules:

- pasted logs belong in the working transcript unless promoted
- only summarized conclusions belong in `lane-memory`
- runtime error spam should stay runtime-owned
- if a log explains a durable repo fact, reduce it to one short fact before persisting it

Do not let raw logs become the long-term memory layer.

## Risks

### Risk: Session becomes an excuse for unbounded replay

Mitigation:

- enforce attempt boundary clearing
- keep lane memory separate from transcript
- compact aggressively

### Risk: the runtime and the model see different realities

Mitigation:

- make `current-attempt` runtime-owned
- include prepared checkout facts, not just trigger scope
- keep support PR and preview state in the runtime summary block

### Risk: operators lose useful debugging context

Mitigation:

- preserve transcript in searchable history or archived branches
- expose clear transcript controls separately from full reset

## Concrete implementation rules

Use these defaults:

1. One Think Session per Nanite lane.
2. Starting a new attempt clears Session message history.
3. `lane-memory` survives new attempts.
4. `current-attempt` is rebuilt by the runtime at attempt start and updated during execution.
5. Only the current transcript tail is replayed to the model.
6. Older attempt history is searchable, not replayed.
7. A clear-transcript button is required.
8. An end-attempt button is required.

## Non-goals

This context work should not try to solve all Nanite product design at once.

Do not combine it with:

- a full authored DSL rewrite
- a new trigger model
- a new support PR strategy
- a new UI information architecture

The context model should make Nanites more reliable first.

## Suggested success criteria

The context model is successful when:

- a resumed Nanite does not need raw old transcript to stay oriented
- starting a new attempt reliably resets model confusion
- durable Nanite memory survives attempt resets
- operator controls can end or clear a bad attempt without factory-resetting the lane
- old attempt history remains inspectable without polluting the active model context
