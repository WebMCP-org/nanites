# Nanite Model Config Plan

## Purpose

Nanites should run on the cheapest model that can reliably do their narrow job.

Model choice belongs to the manager-authored Nanite configuration. Credential management and payment
paths belong outside the Nanite manifest.

## Current Boundary

The live `sigvelo_create_nanite` schema is strict and requires a `manifest.model` field. Agents must
include an explicit model id in create payloads.

Current Nanite manifests contain:

- identity: `id`, `name`, `description`
- model: explicit Cloudflare model id string
- intake: `eventSource`
- authority: `permissions`
- generated behavior: root `triggerSource` for machine sources

## V1 Shape

Use one required string:

```ts
type NaniteManifest = {
  model: string;
};
```

Example:

```json
{
  "model": "deepseek/deepseek-v4-pro"
}
```

There is no deployment default, installation default, model fallback, BYOK alias, gateway id, or raw
provider key in the manifest. If a model is not valid or runnable, registration or execution should
fail normally.

The manager authoring prompt should tell agents to inspect the current Cloudflare model catalog and
pick the cheapest reliable model for the Nanite's job. Prefer DeepSeek when it is suitable and
available.

## Validation

At registration:

1. Require `manifest.model`.
2. Trim the model id.
3. Verify the model exists in Cloudflare's supported model surface.

Registration also verifies that keyed third-party model providers have an API key for the selected
GitHub installation. Workers AI models are deployment-owned and do not require installation keys.

Do not keep a local fallback catalog. If Cloudflare catalog validation is unavailable, use a cheap
gateway smoke test or let the run fail with the provider error.

## Hosted BYOK Direction

Hosted Nanites exposes a small provider-key surface during MCP authorization, not a model picker:

- DeepSeek
- OpenAI
- Anthropic
- Google

Keys live at the GitHub installation boundary. They do not belong in Nanite manifests. The MCP
authorization screen blocks consent until the chosen installation has at least one saved provider
key, making it clear that model-backed Nanites need an AI key before use.

Cloudflare AI Gateway supports REST/OpenAI-compatible requests with `author/model` ids and BYOK
stored provider keys. That is the right future runtime path for hosted third-party models.

## Non-Goals

- No default model policy in Nanite manifests.
- No installation-default model layer.
- No failure fallback to another model.
- No credential-profile system in manifests.
- No BYOK aliases in manifests.
- No local fallback model catalog.
- No general hosted model picker UI.
- No keyed-provider aliases in V1.

## Source Owners

- Manifest types: `src/backend/agents/SigveloNaniteManager.ts`
- MCP create schema: `src/backend/nanites/tools/create-nanite.ts`
- Registration validation: `SigveloNaniteManager.registerNanite`
- Catalog fetch and model lookup: `src/backend/nanites/model-settings.ts`
- Runtime model creation: `src/backend/nanites/language-model.ts`
- Nanite turn resolution: `SigveloNaniteAgent.getTurnModel`
- Run state and dispatch: `SigveloNaniteManager.startRun`
- Observability persistence: `src/backend/db/schema.ts` and
  `src/backend/observability/recorders.ts`
- Agent-facing docs and examples: `plugins/nanites/skills/nanites/SKILL.md`,
  `plugins/nanites/commands/create-nanite.md`,
  `plugins/nanites/skills/nanites/references/authoring.md`, and
  `plugins/nanites/assets/examples/*.json`

## Acceptance Tests

- `sigvelo_create_nanite` accepts an explicit model id string.
- `sigvelo_create_nanite` rejects manifests missing `model`.
- `sigvelo_create_nanite` rejects credential fields in manifests.
- Registration trims and validates the model id through Cloudflare's model surface.
- Runtime uses the Nanite manifest model for every run turn.
- Run records include an immutable resolved model snapshot.
- AI usage facts include the actual request model and gateway id.
- MCP authorization collects an installation provider key before consent when no key exists.

## Agent Guidance

Creation agents should pick the cheapest reliable model for the Nanite's vertical responsibility:

- simple scheduled checks and summaries should use cheap, fast models
- code-editing Nanites should use models that have proven reliable on repo work
- broad or uncertain Nanites should be split before upgrading every run to a premium model

Agents must include `manifest.model` as an explicit model id string.
