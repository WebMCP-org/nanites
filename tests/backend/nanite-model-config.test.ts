import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import {
  normalizeNaniteManifestModelConfig,
  resolveNaniteRunModelSnapshot,
  type SigveloNaniteManager,
} from "#/backend/agents/SigveloNaniteManager.ts";
import { createDbClient } from "#/backend/db/index.ts";
import {
  DEFAULT_NANITES_MODEL_ID,
  saveInstallationModelSettings,
} from "#/backend/nanites/model-settings.ts";

const kimiCatalogModel = {
  id: "@cf/moonshotai/kimi-k2.6",
  name: "Kimi K2.6",
  description: "Moonshot text model.",
  task: { name: "Text Generation" },
  tags: ["Cloudflare-hosted", "Function calling"],
  properties: [{ property_id: "context-window", value: "262,100" }],
};

function envWithModelCatalog(models: unknown[], overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    ...overrides,
    AI: {
      models: async () => models,
    },
  } as Env;
}

function getInstallationManager(githubInstallationId: number) {
  return getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<SigveloNaniteManager>,
    `installation:${githubInstallationId}`,
  );
}

beforeAll(async () => {
  await env.DB.exec(
    [
      "CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY);",
      "CREATE TABLE IF NOT EXISTS installation_model_settings (github_installation_id integer PRIMARY KEY NOT NULL, account_id text, provider text NOT NULL, provider_label text NOT NULL, model_id text NOT NULL, model_name text NOT NULL, gateway_id text NOT NULL, byok_alias text, updated_by_github_user_id integer, updated_by_github_login text, last_tested_at integer, last_test_status text, last_test_message text, last_test_latency_ms integer, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (account_id) REFERENCES accounts(id) ON UPDATE no action ON DELETE set null);",
    ].join("\n"),
  );
});

test("selected Nanite model config resolves through the Cloudflare catalog", async () => {
  const manifest = await normalizeNaniteManifestModelConfig(
    envWithModelCatalog([kimiCatalogModel]),
    {
      id: "selected-kimi",
      name: "Selected Kimi",
      description: "Uses a selected catalog model.",
      model: {
        mode: "selected",
        modelId: " @cf/moonshotai/kimi-k2.6 ",
      },
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

  expect(manifest.model).toEqual({
    mode: "selected",
    modelId: "@cf/moonshotai/kimi-k2.6",
  });
  expect(snapshot).toMatchObject({
    configMode: "selected",
    selectionSource: "manifest",
    runtimePath: "workers_ai_gateway",
    effectiveModelId: "@cf/moonshotai/kimi-k2.6",
    effectiveProvider: "kimi",
    effectiveModelName: "Kimi K2.6",
    effectiveGatewayId: "deployment_gateway",
    manifestVersionId: "manifest-selected",
  });
});

test("legacy Nanite manifests missing model normalize to deployment default", async () => {
  const manifest = await normalizeNaniteManifestModelConfig(envWithModelCatalog([]), {
    id: "legacy-missing-model",
    name: "Legacy missing model",
    description: "Persisted before manifest model policy was required.",
    eventSource: { type: "manual" },
    permissions: {},
  } as Parameters<typeof normalizeNaniteManifestModelConfig>[1]);

  expect(manifest.model).toEqual({ mode: "deployment_default" });
});

test("selected Nanite model config rejects models missing from the catalog", async () => {
  await expect(
    normalizeNaniteManifestModelConfig(envWithModelCatalog([]), {
      id: "missing-model",
      name: "Missing model",
      description: "Should fail before registration.",
      model: {
        mode: "selected",
        modelId: "deepseek/not-in-catalog",
      },
      eventSource: { type: "manual" },
      permissions: {},
    }),
  ).rejects.toThrow("Nanites model selection is invalid");
});

test("Nanite runs ignore saved installation model settings and use manifest policy", async () => {
  const githubInstallationId = 20_000_000 + Math.floor(Math.random() * 1_000_000);
  const db = createDbClient(env.DB);
  await saveInstallationModelSettings(db, envWithModelCatalog([kimiCatalogModel]), {
    githubInstallationId,
    accountId: null,
    modelId: "@cf/moonshotai/kimi-k2.6",
    gatewayId: "saved_gateway",
    byokAlias: "saved-key",
  });

  const manager = await getInstallationManager(githubInstallationId);
  await manager.registerNanite({
    manifest: {
      id: "manual-default-model",
      name: "Manual default model",
      description: "Uses deployment default despite saved installation settings.",
      model: {
        mode: "deployment_default",
      },
      eventSource: { type: "manual" },
      permissions: {},
    },
  });

  const run = await manager.startRun({
    naniteId: "manual-default-model",
    trigger: {
      type: "manual",
      requestId: crypto.randomUUID(),
      actorId: null,
      message: "Record the run model snapshot.",
    },
  });

  expect(run.model).toMatchObject({
    configMode: "deployment_default",
    selectionSource: "deployment_default",
    effectiveModelId: DEFAULT_NANITES_MODEL_ID,
    effectiveProvider: "deepseek",
  });
  expect(run.model.effectiveGatewayId).not.toBe("saved_gateway");
});
