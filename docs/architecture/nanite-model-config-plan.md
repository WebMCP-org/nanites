# Nanite Model Config Plan

## Purpose

Nanites should run on the cheapest model that can reliably do their narrow job.

This implemented plan makes model selection part of the manager-authored Nanite configuration.
Nanite creation stays MCP and manager dictated.

## Current Boundary

The live `sigvelo_create_nanite` schema is strict and requires a `manifest.model` field. Agents must
include model config in create payloads.

Current Nanite manifests contain:

- identity: `id`, `name`, `description`
- model policy: `model`
- intake: `eventSource`
- authority: `permissions`
- generated behavior: root `triggerSource` for machine sources

Model config is runtime policy. It must not become credential management, tool selection, or a
second capability manifest.

## V1 Shape

Use one required discriminated union with no optional fields:

```ts
type NaniteModelConfig =
  | { mode: "deployment_default" }
  | {
      mode: "selected";
      modelId: string;
    };
```

Use `mode: "deployment_default"` when the Nanite should inherit the deployment's configured default
model. Use `mode: "selected"` when the Nanite needs a concrete model override.

For V1, do not add an installation-default model layer. Keep the effective runtime chain simple:

```ts
effectiveModel =
  manifest.model.mode === "selected"
    ? resolveSelectedModel(manifest.model.modelId)
    : DEFAULT_NANITES_MODEL_SETTINGS;
```

`deployment_default` is not failure fallback. It is an explicit selection mode that resolves to the
deployment default. If a selected model fails, the run records a normal model/runtime failure; V1 does
not retry on a different model.

The selected V1 path uses the Cloudflare Workers AI binding / AI Gateway path. The deployment owns
the gateway id. Do not put `gatewayId`, BYOK aliases, provider API keys, `cf-aig-authorization`
tokens, or provider auth headers in Nanite manifests.

BYOK belongs to a later provider-native AI Gateway runtime, not this V1 manifest shape. If that
runtime is added, introduce an explicit runtime discriminant instead of extending `selected` with
credential fields.

## Future Hosted Cost Model

The hosted Nanites product should assume AI credits are the dominant marginal cost. Self-hosted
operators can bring their own Cloudflare account, Workers AI binding, AI Gateway, and provider
secrets through deployment configuration. Hosted users need a product-level way to pay for or attach
model credits without turning each Nanite manifest into a credential document.

The likely next shape is a small account or installation settings surface, simpler than the deleted
settings page:

- choose the model runtime surface: Cloudflare-hosted Workers AI or AI Gateway provider route
- store provider API keys or Cloudflare AI Gateway BYOK aliases at the account/installation boundary
- let `manifest.model` continue to pick model policy only
- validate selected models against the relevant Cloudflare documentation/catalog for that runtime
- smoke-test the selected runtime/key before allowing it to become the active billing path

Do not put raw API keys, BYOK aliases, provider headers, gateway ids, or billing-account choices in
Nanite manifests. A Nanite should only say which model policy it wants; the deployment or
installation should own how that model call is paid for and authorized.

## Non-Goals

- No new UI for Nanite model selection.
- No credential-profile system.
- No raw provider keys in Nanite manifests.
- No BYOK alias selection in Nanite manifests.
- No dynamic routing policy.
- No per-installation model default unless a later product decision reintroduces it.
- No failure fallback to a different model.
- No runtime compatibility branch for manifests missing `model`.

If installation defaults come back later, they should be designed as a real product layer rather
than kept as hidden runtime behavior.

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

## Implementation Steps

1. Add `manifest.model` to `NaniteManifestBase` and the strict MCP create schema.
2. Update plugin authoring docs and examples so MCP agents always provide model config.
3. Validate model config during `registerNanite`:
   - accept `mode: "deployment_default"` directly
   - for `mode: "selected"`, trim strings
   - require non-empty `modelId`
   - fetch the Cloudflare catalog and reject unknown `modelId`
4. Replace Nanite runtime model resolution in `SigveloNaniteAgent.getTurnModel`: selected manifest
   model wins; `deployment_default` uses `DEFAULT_NANITES_MODEL_SETTINGS`.
5. Resolve a run model snapshot when a Run starts, not when it completes. Store compact immutable
   fields on the run record, such as `configMode`, `selectionSource`, `runtimePath`,
   `effectiveModelId`, `effectiveProvider`, `effectiveModelName`, `effectiveGatewayId`,
   `manifestVersionId`, and `resolvedAt`.
6. Use the run model snapshot for every turn in that Run. Do not derive historical run facts from the
   current Nanite manifest.
7. Add D1 projection/fact fields for the resolved model policy. `nanite_run_facts` stores the
   per-run effective policy snapshot. `ai_usage_facts` stores per-request provider/model/log data and
   the gateway id used to read AI Gateway logs.

## Acceptance Tests

- `sigvelo_create_nanite` accepts `manifest.model.mode = "deployment_default"`.
- `sigvelo_create_nanite` accepts a catalog-backed selected model.
- `sigvelo_create_nanite` rejects selected model ids missing from the catalog.
- Runtime uses a selected Nanite model when present.
- Runtime resolves `deployment_default` to `DEFAULT_NANITES_MODEL_SETTINGS`.
- Nanite manifests missing `manifest.model` are rejected at the create/register boundary.
- Run records include an immutable resolved model snapshot.
- AI usage facts include the actual request model and gateway id.
- AI Gateway log lookup uses the resolved gateway id.

## Agent Guidance

When this plan is implemented, creation agents should pick the cheapest reliable model for the
Nanite's vertical responsibility:

- simple scheduled checks and summaries should use cheap, fast models
- code-editing Nanites should use models that have proven reliable on repo work
- broad or uncertain Nanites should be split before upgrading every run to a premium model

Agents must include `manifest.model` in the current strict manifest schema.
