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
  "model": "@cf/moonshotai/kimi-k2.6"
}
```

There is no deployment default, installation default, model fallback, BYOK alias, gateway id, or
provider credential in the manifest. If a model is not valid or runnable, registration or execution
should fail normally.

The manager authoring prompt should tell agents to inspect the current Cloudflare model catalog and
provider-native AI Gateway surfaces, then pick the cheapest reliable function-calling text model for
the Nanite's job. Prefer Cloudflare-hosted function-calling models unless a provider-native model is
known to support the tool loop required by Nanite runtimes.

## Validation

At registration:

1. Require `manifest.model`.
2. Trim the model id.
3. Verify the model exists in Cloudflare's supported model surface and advertises function calling,
   or is a supported provider-native AI Gateway model id.

Do not keep a local fallback catalog. If Cloudflare catalog validation is unavailable for a
provider-native id, accept the provider-native id shape and let the Cloudflare AI binding,
AI Gateway, and account billing own the runtime truth. If a catalog row is available and does not
advertise function calling, reject it because Nanite and manager turns depend on runtime tools.

## Self-Hosted Model Execution

Self-hosted Nanites should not collect provider API keys in the Nanites UI, MCP authorization flow,
Nanite manifests, or D1.

All model execution goes through the customer-owned Cloudflare deployment:

- Cloudflare-hosted Workers AI models run through the Worker `AI` binding.
- Third-party model ids also run through the Worker `AI` binding with the deployment AI Gateway id.
- Cloudflare owns provider authentication, unified billing, BYOK storage, rate limits, and budget
  controls at the account/gateway layer.

Nanites only stores the selected model id and immutable run snapshot metadata.

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

## References

- [Cloudflare Workers AI model: Kimi K2.6](https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/) -
  Cloudflare-hosted `@cf/moonshotai/kimi-k2.6` model with multi-turn tool calling.
- [Cloudflare AI Gateway Workers Bindings](https://developers.cloudflare.com/ai-gateway/integrations/worker-binding-methods/) -
  `env.AI.run()` accepts Workers AI `@cf/...` ids and third-party `{author}/{model}` ids
  through the deployment AI Gateway.

## Acceptance Tests

- `sigvelo_create_nanite` accepts an explicit model id string.
- `sigvelo_create_nanite` rejects manifests missing `model`.
- `sigvelo_create_nanite` rejects credential fields in manifests.
- Registration trims and validates the model id through Cloudflare's model surface or supported
  provider-native id shape.
- Runtime uses the Nanite manifest model for every run turn.
- Run records include an immutable resolved model snapshot.
- AI usage facts include the actual request model and gateway id.
- MCP authorization does not collect model provider credentials.

## Agent Guidance

Creation agents should pick the cheapest reliable model for the Nanite's vertical responsibility:

- simple scheduled checks and summaries should use cheap, fast models
- code-editing Nanites should use models that have proven reliable on repo work
- broad or uncertain Nanites should be split before upgrading every run to a premium model

Agents must include `manifest.model` as an explicit model id string.
