# Nanite Model Config Plan

## Purpose

Nanites should run on the cheapest model that can reliably do their narrow job.

This plan makes model selection part of the manager-authored Nanite configuration while keeping the
live UI unchanged. The existing settings page remains useful as an operator/catalog/smoke-test
surface, but Nanite creation stays MCP and manager dictated.

## Current Boundary

The live `sigvelo_create_nanite` schema is strict and does not yet accept a `manifest.model` field.
Agents must not include model config in create payloads until this plan is implemented.

Current Nanite manifests contain:

- identity: `id`, `name`, `description`
- intake: `eventSource`
- authority: `permissions`
- generated behavior: root `triggerSource` for machine sources

Model config should join that manifest as runtime policy. It should not become credential
management, tool selection, or a second capability manifest.

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

## Non-Goals

- No new UI for Nanite model selection.
- No credential-profile system.
- No raw provider keys in Nanite manifests.
- No BYOK alias selection in Nanite manifests.
- No dynamic routing policy.
- No per-installation model default unless a later product decision reintroduces it.
- No failure fallback to a different model.
- No runtime compatibility branch for manifests missing `model` after migration.

The existing settings page remains a model catalog and smoke-test surface. Implementing this plan
must stop using saved installation model settings as the default for Nanite runs. If installation
defaults come back later, they should be designed as a real product layer rather than kept as hidden
runtime behavior.

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
2. Normalize persisted manager state before any runtime code reads `manifest.model`. For this
   pre-production cut, legacy manifests missing `model` should become
   `{ mode: "deployment_default" }` and then be persisted. Do not keep a long-lived runtime branch
   for missing model config.
3. Update plugin authoring docs and examples so MCP agents always provide model config.
4. Validate selected model config during `registerNanite`:
   - accept `mode: "deployment_default"` directly
   - for `mode: "selected"`, trim strings
   - require non-empty `modelId`
   - fetch the Cloudflare catalog and reject unknown `modelId`
5. Replace Nanite runtime model resolution in `SigveloNaniteAgent.getTurnModel`: selected manifest
   model wins; `deployment_default` uses `DEFAULT_NANITES_MODEL_SETTINGS`; Nanite runs do not call
   `readInstallationModelSettings`.
6. Resolve a run model snapshot when a Run starts, not when it completes. Store compact immutable
   fields on the run record, such as `configMode`, `selectionSource`, `runtimePath`,
   `effectiveModelId`, `effectiveProvider`, `effectiveModelName`, `effectiveGatewayId`,
   `manifestVersionId`, and `resolvedAt`.
7. Use the run model snapshot for every turn in that Run. Do not derive historical run facts from the
   current Nanite manifest.
8. Add D1 projection/fact fields for the resolved model policy. `nanite_run_facts` stores the
   per-run effective policy snapshot. `ai_usage_facts` stores per-request provider/model/log data and
   the gateway id used to read AI Gateway logs.
9. Reproject existing catalog rows from normalized manager state so model policy fields are populated.
10. Keep the existing settings page as the model catalog and smoke-test surface.

## Acceptance Tests

- `sigvelo_create_nanite` accepts `manifest.model.mode = "deployment_default"`.
- `sigvelo_create_nanite` accepts a catalog-backed selected model.
- `sigvelo_create_nanite` rejects selected model ids missing from the catalog.
- Runtime uses a selected Nanite model when present.
- Runtime resolves `deployment_default` to `DEFAULT_NANITES_MODEL_SETTINGS`.
- Runtime does not use saved installation model settings for Nanite runs.
- Legacy Nanites missing `manifest.model` are migrated to deployment default before runtime use.
- Run records include an immutable resolved model snapshot.
- AI usage facts include the actual request model and gateway id.
- AI Gateway log lookup uses the resolved gateway id.

## Agent Guidance

When this plan is implemented, creation agents should pick the cheapest reliable model for the
Nanite's vertical responsibility:

- simple scheduled checks and summaries should use cheap, fast models
- code-editing Nanites should use models that have proven reliable on repo work
- broad or uncertain Nanites should be split before upgrading every run to a premium model

Until implementation lands, agents should continue using the current strict manifest schema without
`manifest.model`.
