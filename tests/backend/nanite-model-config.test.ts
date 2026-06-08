import { env } from "cloudflare:test";
import {
  normalizeNaniteManifestModelConfig,
  resolveNaniteRunModelSnapshot,
  type NaniteManifest,
} from "#/backend/agents/SigveloNaniteManager.ts";

const kimiCatalogModel = {
  id: "@cf/moonshotai/kimi-k2.6",
  name: "Kimi K2.6",
  description: "Moonshot text model.",
  task: { name: "Text Generation" },
  tags: ["Cloudflare-hosted", "Function calling"],
  properties: [{ property_id: "context-window", value: "262,100" }],
};

function envWithModelCatalog(models: unknown[], overrides: Record<string, unknown> = {}): Env {
  return {
    ...env,
    ...overrides,
    AI: {
      models: async () => models,
    },
  } as Env;
}

test("Nanite model id resolves through the Cloudflare catalog", async () => {
  const manifest = await normalizeNaniteManifestModelConfig(
    envWithModelCatalog([kimiCatalogModel]),
    {
      id: "selected-kimi",
      name: "Selected Kimi",
      description: "Uses a selected catalog model.",
      model: " @cf/moonshotai/kimi-k2.6 ",
      eventSource: { type: "manual" },
      permissions: {},
    },
  );

  const snapshot = await resolveNaniteRunModelSnapshot({
    env: envWithModelCatalog([kimiCatalogModel], {
      NANITES_AI_GATEWAY_ID: "deployment_gateway",
    }),
    manifest,
    manifestVersionId: "manifest-selected",
    resolvedAt: "2026-06-08T00:00:00.000Z",
  });

  expect(manifest.model).toBe("@cf/moonshotai/kimi-k2.6");
  expect(snapshot).toMatchObject({
    runtimePath: "workers_ai_gateway",
    effectiveModelId: "@cf/moonshotai/kimi-k2.6",
    effectiveProvider: "kimi",
    effectiveModelName: "Kimi K2.6",
    effectiveGatewayId: "deployment_gateway",
    manifestVersionId: "manifest-selected",
  });
});

test("Nanite manifests missing model id are rejected", async () => {
  const missingModelManifest = {
    id: "missing-model-config",
    name: "Missing model config",
    description: "Should fail because manifest model policy is required.",
    eventSource: { type: "manual" },
    permissions: {},
  } as NaniteManifest;

  await expect(
    normalizeNaniteManifestModelConfig(envWithModelCatalog([]), missingModelManifest),
  ).rejects.toThrow("Nanites model selection is invalid");
});

test("Nanite model id rejects models missing from the catalog", async () => {
  await expect(
    normalizeNaniteManifestModelConfig(envWithModelCatalog([]), {
      id: "missing-model",
      name: "Missing model",
      description: "Should fail before registration.",
      model: "deepseek/not-in-catalog",
      eventSource: { type: "manual" },
      permissions: {},
    }),
  ).rejects.toThrow("Nanites model selection is invalid");
});

test("Nanite run snapshots do not re-query the catalog after registration", async () => {
  const manifest = await normalizeNaniteManifestModelConfig(
    envWithModelCatalog([kimiCatalogModel]),
    {
      id: "selected-kimi",
      name: "Selected Kimi",
      description: "Uses a selected catalog model.",
      model: "@cf/moonshotai/kimi-k2.6",
      eventSource: { type: "manual" },
      permissions: {},
    },
  );

  const snapshot = await resolveNaniteRunModelSnapshot({
    env: envWithModelCatalog([], {
      NANITES_AI_GATEWAY_ID: "deployment_gateway",
    }),
    manifest,
    manifestVersionId: "manifest-selected",
    resolvedAt: "2026-06-08T00:00:00.000Z",
  });

  expect(snapshot).toMatchObject({
    effectiveModelId: "@cf/moonshotai/kimi-k2.6",
    effectiveProvider: "kimi",
    effectiveGatewayId: "deployment_gateway",
  });
});
