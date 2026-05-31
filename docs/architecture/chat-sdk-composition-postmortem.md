# Chat SDK Composition Post-Mortem

Created: 2026-05-23

## Verdict

The previous implementation attempt violated the Nanites engineering thesis.

The product direction was right:

```text
Humans talk to the Sigvelo manager.
The manager routes, coordinates, or creates Nanites.
Nanites stay narrow and own scoped work.
```

The implementation direction was wrong. It added custom Sigvelo conversation code before proving the existing Chat SDK and Cloudflare Agents primitives. That inverted the desired maintenance model.

Sigvelo should keep custom code small. At integration boundaries, the default move is:

```text
copy the first-party example
swap the provider
compose existing library objects
add custom code only where Sigvelo owns product policy
```

I did the opposite. I started with a custom manager-message parser, custom result types, custom trust helpers, custom status rendering, and custom idempotency helpers. Even though that code was removed, the mistake matters because it shows the wrong reflex.

## Why It Was Wrong

The problem was not that the code was large. The problem was that the code owned responsibilities already covered by the libraries we were evaluating.

Chat SDK already gives us:

- provider webhook handling
- normalized `Thread` and `Message` objects
- `onNewMention`
- `onSubscribedMessage`
- thread subscription
- locks
- queues
- dedupe primitives
- reaction/post/edit operations through the adapter

Cloudflare `agents/chat-sdk` already gives us:

- `createChatSdkState()`
- `ChatSdkStateAgent`
- Durable Object SQLite storage for Chat SDK state
- sub-agent sharding under the current ingress Agent

The Cloudflare example already gives us the shape:

```text
Worker route
  -> ChatIngressAgent
  -> Chat SDK runtime
  -> provider adapter webhook
  -> ChatSdkStateAgent sub-agents
  -> application handler
```

The first code should have copied that shape and adapted Telegram to GitHub. Instead, I built custom abstractions that delayed contact with the actual library behavior.

## Principle Violated

This is the principle that should have controlled the work:

> Sigvelo should compose existing library primitives until a missing product boundary forces custom code.

For Nanites, custom code is justified when it owns:

- GitHub installation policy
- Nanite registry mutations
- capability validation
- trigger validation
- run lifecycle
- GitHub feedback policy
- Sigvelo UI links and product state

Custom code is not justified when the library already owns:

- message routing
- mentions
- subscriptions
- locks
- queues
- dedupe
- provider thread ids
- provider message ids
- reactions
- reply/edit transport

The failed Slice 0 crossed that line.

## Specific Mistakes

### Mistake 1: Ignored The Concrete Example

The Cloudflare `chat-sdk-messenger` example was the obvious starting point.

Relevant local sources:

- [Example README](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/examples/chat-sdk-messenger/README.md)
- [Example Worker and `ChatIngressAgent`](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/examples/chat-sdk-messenger/src/index.ts)
- [Example Wrangler config](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/examples/chat-sdk-messenger/wrangler.jsonc)
- [`agents/chat-sdk` adapter source](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/packages/agents/src/chat-sdk/adapter.ts)
- [`ChatSdkStateAgent` source](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/packages/agents/src/chat-sdk/agent.ts)

That example is Telegram-specific, but its runtime shape is not provider-specific. The README explicitly says the same ingress/state/AI shape can be adapted to other Chat SDK adapters.

The correct first implementation should have been:

```text
copy ChatIngressAgent shape
replace Telegram adapter with GitHub adapter
keep createChatSdkState()
export ChatSdkStateAgent
route GitHub comment webhooks through the ingress
post one simple reply
```

### Mistake 2: Treated The Manager API As The First Unknown

The manager API is not the first unknown.

The first unknown is whether this shape works cleanly in Sigvelo:

```text
Cloudflare Agent
  -> Vercel Chat SDK
  -> @chat-adapter/github
  -> agents/chat-sdk state
  -> Sigvelo manager call
```

The manager API should emerge after the ingress proves:

- GitHub webhook routing works without body-consumption bugs
- `@chat-adapter/github` sees the expected event shapes
- `onNewMention` fires for PR, issue, and review comments
- `thread.subscribe()` records durable subscription state
- `onSubscribedMessage` routes follow-ups
- `thread.post`, edit, and reactions work from Workers
- `ChatSdkStateAgent` works as a sub-agent in this app

Starting with a pure manager API skipped all of that.

### Mistake 3: Rebuilt Conversation Primitives

The failed code introduced custom primitives for:

- command classification
- trust mapping
- idempotency keys
- render hashes
- status summaries
- provider-independent surfaces
- manager message results

Some of those concepts may eventually exist. They should not exist before the Chat SDK adapter has forced their shape.

The first slice should not define a replacement conversation model. It should use Chat SDK `Thread`, Chat SDK `Message`, and GitHub adapter raw payloads directly.

### Mistake 4: Made Provider-Agnostic Too Early

Multi-messenger matters, but provider-agnostic code is not the same as pre-provider code.

The right order is:

```text
GitHub adapter running through Chat SDK
small seam where provider-specific data enters Sigvelo policy
second provider arrives
extract only the duplicated shape
```

The wrong order is:

```text
invent provider-agnostic manager message types
write pure parser tests
later discover the adapter shape does not match the invented model
```

Provider-agnostic should be an outcome of composing adapters, not a custom abstraction invented before using one.

### Mistake 5: Confused Architecture Boundary With Build Sequence

The architecture boundary is still correct:

```text
Ingress owns chat plumbing.
Manager owns product decisions.
Nanites own scoped work.
```

But the build sequence should start at the library boundary, not at a new internal abstraction.

Correct sequence:

```text
Chat SDK ingress spike
minimal GitHub mention handler
manager call with a tiny input
only then product-specific manager behavior
```

Wrong sequence:

```text
custom manager input type
custom parser
custom renderer
custom idempotency
no Chat SDK
```

### Mistake 6: Violated The Existing Nanites Docs

The canonical docs already say to prefer platform primitives over Sigvelo-shaped layers.

Relevant local docs:

- [Nanites README, platform primitives](/docs/architecture/README.md)
- [Execution architecture, use Cloudflare primitives directly](/docs/architecture/execution-architecture.md)
- [Architecture, use Octokit at GitHub boundary](/docs/architecture/architecture.md)

The failed code added a Sigvelo-shaped layer at exactly the place where the library shape should have been tested.

## Correct Rule Going Forward

Before adding custom code around a third-party integration, answer these questions in order:

1. Is there a first-party or upstream example that already shows the runtime shape?
2. Can we copy that shape with the smallest provider swap?
3. Does the library already own this state or behavior?
4. Can the product requirement be expressed as a callback, adapter option, or small handler?
5. What exact behavior is missing from the library?
6. Is the missing behavior Sigvelo policy, or just premature internal preference?

Only write custom code after question 5 has a concrete answer.

## Correct First Implementation

The next implementation should be a Chat SDK spike, not a manager abstraction spike.

### Goal

Prove that GitHub human comments can enter Sigvelo through the same library shape as the Cloudflare example.

### Scope

Implement the smallest usable path:

```text
GitHub issue_comment / pull_request_review_comment
  -> SigveloChatIngress
  -> Chat SDK GitHub adapter
  -> agents/chat-sdk state
  -> onNewMention
  -> eyes reaction
  -> thread.subscribe()
  -> one simple thread.post()
```

No Nanite creation. No target resolution. No custom command model. No broad manager parser.

### Files To Copy From Conceptually

Start from:

- [Chat SDK example `src/index.ts`](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/examples/chat-sdk-messenger/src/index.ts)
- [Chat SDK example `wrangler.jsonc`](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/examples/chat-sdk-messenger/wrangler.jsonc)

Then adapt to Sigvelo:

- [Worker entrypoint](/apps/nanites/src/server.ts)
- [Current GitHub webhook path](/apps/nanites/src/backend/github.ts)
- [Worker config](/apps/nanites/wrangler.jsonc)
- [Agent package manifest](/apps/nanites/package.json)

### Dependencies

Add only the libraries required for the spike:

```text
chat
@chat-adapter/github
```

`agents` is already installed. Use `agents/chat-sdk` from the installed `agents` package.

### Agent Shape

Use the example's shape:

```ts
export { ChatSdkStateAgent } from "agents/chat-sdk";

export class SigveloChatIngress extends Agent<Env> {
  private bot?: Chat;

  onStart() {
    this.bot = new Chat({
      userName: "sigvelo",
      adapters: { github },
      state: createChatSdkState(),
      concurrency: { strategy: "burst", debounceMs: 600 },
    });

    this.bot.onNewMention(async (thread, message) => {
      await thread.subscribe();
      await thread.createSentMessageFromMessage(message).addReaction("eyes");
      await thread.post("Sigvelo received this manager request.");
    });
  }
}
```

The reaction API comes from the Chat SDK `SentMessage` wrapper around the incoming GitHub message. Do not invent a Sigvelo reaction wrapper before checking the library.

### Routing Shape

Keep the existing public webhook URL:

```text
POST /api/github/webhook
```

Route by `X-GitHub-Event` before the body is read:

| GitHub event                  | Handler                       |
| ----------------------------- | ----------------------------- |
| `pull_request`                | existing manager webhook path |
| `push`                        | existing manager webhook path |
| `issue_comment`               | `SigveloChatIngress`          |
| `pull_request_review_comment` | `SigveloChatIngress`          |
| `ping`                        | simple success                |

The GitHub adapter reads the request body internally. The existing Octokit webhook handler also needs the raw body. Do not read the body in the router.

### Wrangler Shape

Add one top-level Agent binding for the ingress, following the example:

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "SigveloChatIngress",
        "class_name": "SigveloChatIngress",
      },
    ],
  },
  "migrations": [
    {
      "tag": "v_next",
      "new_sqlite_classes": ["SigveloChatIngress"],
    },
  ],
}
```

Do not add a separate top-level binding for `ChatSdkStateAgent`. The example uses it as a sub-agent under the ingress.

### First Tests

Tests should prove library composition, not custom parsing.

Add tests for:

- `SigveloChatIngress` imports and constructs with `createChatSdkState()`
- `ChatSdkStateAgent` is exported from the Worker entrypoint
- `issue_comment` routes to the ingress without consuming the body first
- `pull_request` and `push` still route to the existing manager webhook path
- a signed GitHub mention produces one accepted handler call

Avoid tests for:

- custom command parsing
- custom idempotency algorithms
- custom status rendering
- custom provider-independent surfaces

Those come later, only if the Chat SDK shape requires them.

## What Custom Code Is Allowed In The First Spike

Allowed:

- `SigveloChatIngress` Agent class
- GitHub adapter configuration
- webhook header dispatch
- env validation for required GitHub adapter credentials
- minimal handler body inside `onNewMention`
- feature flag or staging guard if needed

Not allowed:

- custom message parser
- custom thread model
- custom dedupe store
- custom lock/queue logic
- custom subscription store
- custom manager-message result schema
- custom status renderer
- custom Nanite target resolver
- autonomous Nanite creation

## When Custom Sigvelo Code Becomes Justified

Custom manager code becomes justified after the spike proves the ingress and we need Sigvelo-specific policy.

Examples:

- deciding whether a GitHub author may mutate Nanites
- mapping a GitHub installation to a manager Agent name
- deciding whether a request should start a Run
- validating Nanite scope and capability
- recording manager-created Nanite provenance
- linking a Chat SDK thread to a Sigvelo run
- rendering Sigvelo URLs into a provider reply

Even then, use the library objects as inputs. Do not invent a parallel message model unless a second provider proves that the repeated shape is real.

## Corrected Implementation Sequence

### Slice 1: Copy The Chat SDK Example Shape

Deliver:

- `chat` and `@chat-adapter/github` installed
- `SigveloChatIngress extends Agent`
- `createChatSdkState()` used inside the Agent
- `ChatSdkStateAgent` exported
- GitHub comment events routed to ingress
- one `onNewMention` handler that subscribes and posts a simple reply

Exit:

- one GitHub mention travels through Chat SDK in Workers
- no custom conversation framework exists

### Slice 2: Replace The Placeholder Reply With A Manager Call

Deliver:

- minimal manager callable for a raw manager request
- input built from Chat SDK `thread`, Chat SDK `message`, and GitHub raw payload
- manager returns only reply text and optional linked URL

Exit:

- the ingress still owns chat plumbing
- the manager owns the answer
- no duplicated Chat SDK state exists

### Slice 3: Use Chat SDK Subscription For Follow-Ups

Deliver:

- `thread.subscribe()` on first mention
- `onSubscribedMessage` calls the same manager path
- one editable status reply if the adapter supports edit in the needed GitHub surface

Exit:

- GitHub follow-ups stay in GitHub
- Sigvelo does not own a custom subscription system

### Slice 4: Add Manager Policy

Deliver:

- author trust gate
- scope validation
- capability validation
- provenance for manager-created Nanites
- idempotency only where Chat SDK delivery dedupe is insufficient

Exit:

- custom code exists only for Sigvelo policy
- Chat SDK still owns conversation infrastructure

## Review Checklist For Future Work

Before approving code in this area, check:

- Did the code start from the Cloudflare Chat SDK example shape?
- Is `createChatSdkState()` used instead of a custom state store?
- Is `ChatSdkStateAgent` exported and used as infrastructure only?
- Are mentions and follow-ups handled through `onNewMention` and `onSubscribedMessage`?
- Are locks, queues, dedupe, and subscriptions left to Chat SDK unless a concrete gap is proven?
- Are GitHub thread ids left as Chat SDK ids until Sigvelo needs a safe Agent name?
- Does the manager receive library-shaped input first, not an invented generic message model?
- Is every custom type tied to Sigvelo policy, not adapter plumbing?
- Did tests prove the library path before testing product parsing?

## Source Anchors

Cloudflare Agents and Chat SDK:

- [Cloudflare Chat SDK example README](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/examples/chat-sdk-messenger/README.md)
- [Cloudflare Chat SDK example ingress](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/examples/chat-sdk-messenger/src/index.ts)
- [Cloudflare Chat SDK example Wrangler config](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/examples/chat-sdk-messenger/wrangler.jsonc)
- [`agents/chat-sdk` export](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/packages/agents/src/chat-sdk/index.ts)
- [`createChatSdkState` source](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/packages/agents/src/chat-sdk/adapter.ts)
- [`ChatSdkStateAgent` source](/Users/alexmnahas/.opensrc/repos/github.com/cloudflare/agents/0.13.2/packages/agents/src/chat-sdk/agent.ts)

Vercel Chat SDK:

- [Chat runtime](/Users/alexmnahas/.opensrc/repos/github.com/vercel/chat/4.29.0/packages/chat/src/chat.ts)
- [Thread API](/Users/alexmnahas/.opensrc/repos/github.com/vercel/chat/4.29.0/packages/chat/src/thread.ts)
- [GitHub adapter implementation](/Users/alexmnahas/.opensrc/repos/github.com/vercel/chat/4.29.0/packages/adapter-github/src/index.ts)

Sigvelo Nanites:

- [Nanites README](/docs/architecture/README.md)
- [Nanites architecture](/docs/architecture/architecture.md)
- [Nanites execution architecture](/docs/architecture/execution-architecture.md)
- [Worker entrypoint](/apps/nanites/src/server.ts)
- [GitHub webhook handler](/apps/nanites/src/backend/github.ts)
- [Nanite manager](/apps/nanites/src/backend/nanites/host.ts)

## Bottom Line

The next implementation should not start with a new Sigvelo conversation framework.

It should start by adapting the upstream Chat SDK Agents example as directly as possible:

```text
ChatIngressAgent from the example
  + GitHub adapter
  + createChatSdkState()
  + ChatSdkStateAgent
  + one mention handler
```

Only after that path works should Sigvelo add manager policy. Custom code belongs behind proven library composition, not in front of it.
