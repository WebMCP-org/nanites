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
      gatewayId: string;
      byokAlias: string | null;
    };
```

Use `mode: "deployment_default"` when the Nanite should inherit the deployment's configured default
model. Use `mode: "selected"` when the Nanite needs a concrete model override.

For V1, do not add an installation-default model layer. Keep the effective runtime chain simple:

```ts
effectiveModel =
  manifest.model.mode === "selected" ? manifest.model : DEFAULT_NANITES_MODEL_SETTINGS;
```

## Non-Goals

- No new UI for Nanite model selection.
- No credential-profile system.
- No raw provider keys in Nanite manifests.
- No dynamic routing policy.
- No per-installation model default unless a later product decision reintroduces it.
- No fallback catalog or compatibility shape for old manifest model fields.

## Implementation Steps

1. Add `manifest.model` to `NaniteManifestBase` and the strict MCP create schema.
2. Update plugin authoring docs and examples so MCP agents always provide model config.
3. Validate selected model config during `registerNanite`:
   - accept `mode: "deployment_default"` directly
   - for `mode: "selected"`, trim strings
   - require non-empty `modelId` and `gatewayId`
   - require `byokAlias` to be either a non-empty string or `null`
   - fetch the Cloudflare catalog and reject unknown `modelId`
4. Resolve the language model from the Nanite manifest at runtime.
5. Preserve the actual model/gateway used in run and AI usage records so historical runs remain
   understandable after a Nanite model changes.
6. Keep the existing settings page as the model catalog and smoke-test surface.

## Acceptance Tests

- `sigvelo_create_nanite` accepts `manifest.model.mode = "deployment_default"`.
- `sigvelo_create_nanite` accepts a catalog-backed selected model.
- `sigvelo_create_nanite` rejects selected model ids missing from the catalog.
- Runtime uses a selected Nanite model when present.
- Runtime falls back to `DEFAULT_NANITES_MODEL_SETTINGS` for deployment-default Nanites.
- Run/usage records include the actual model used.

## Agent Guidance

When this plan is implemented, creation agents should pick the cheapest reliable model for the
Nanite's vertical responsibility:

- simple scheduled checks and summaries should use cheap, fast models
- code-editing Nanites should use models that have proven reliable on repo work
- broad or uncertain Nanites should be split before upgrading every run to a premium model

Until implementation lands, agents should continue using the current strict manifest schema without
`manifest.model`.
