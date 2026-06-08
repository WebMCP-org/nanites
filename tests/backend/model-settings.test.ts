import { env } from "cloudflare:test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import { createDbClient } from "#/backend/db/index.ts";
import {
  DEFAULT_NANITES_MODEL_ID,
  fetchNanitesModelCatalog,
  readInstallationModelSettings,
  recordInstallationModelSmokeTest,
  saveInstallationModelSettings,
  smokeTestNanitesModel,
} from "#/backend/nanites/model-settings.ts";

function envWithModelCatalog(models: unknown[]): Env {
  return {
    ...env,
    AI: {
      models: async () => models,
    },
  } as Env;
}

const kimiCatalogModel = {
  id: "@cf/moonshotai/kimi-k2.6",
  name: "Kimi K2.6",
  description: "Moonshot text model.",
  task: { name: "Text Generation" },
  tags: ["Cloudflare-hosted", "Function calling"],
  properties: [{ property_id: "context-window", value: "262,100" }],
};

beforeAll(async () => {
  await env.DB.exec("CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY);");
  try {
    await env.DB.prepare("SELECT 1 FROM installation_model_settings LIMIT 1").run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("no such table: installation_model_settings")) {
      throw error;
    }
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS installation_model_settings (github_installation_id integer PRIMARY KEY NOT NULL, account_id text, provider text NOT NULL, provider_label text NOT NULL, model_id text NOT NULL, model_name text NOT NULL, gateway_id text NOT NULL, byok_alias text, updated_by_github_user_id integer, updated_by_github_login text, last_tested_at integer, last_test_status text, last_test_message text, last_test_latency_ms integer, created_at integer NOT NULL, updated_at integer NOT NULL, FOREIGN KEY (account_id) REFERENCES accounts(id) ON UPDATE no action ON DELETE set null);",
    );
  }
});

test("model settings default to DeepSeek V4 Pro", async () => {
  const settings = await readInstallationModelSettings(
    createDbClient(env.DB),
    8_000_000 + Math.floor(Math.random() * 1_000_000),
  );

  expect(settings).toMatchObject({
    modelId: DEFAULT_NANITES_MODEL_ID,
    modelName: "DeepSeek V4 Pro",
    provider: "deepseek",
    gatewayId: "default",
    source: "default",
  });
});

test("model catalog returns no models when Cloudflare model search is unavailable", async () => {
  const catalog = await fetchNanitesModelCatalog(env as Env);

  expect(catalog.models).toEqual([]);
});

test("model catalog reads Cloudflare text-generation search results", async () => {
  const catalog = await fetchNanitesModelCatalog(
    envWithModelCatalog([
      {
        id: "openai/gpt-4.1-mini",
        name: "gpt-4.1-mini",
        description: "OpenAI small model.",
        task: { name: "Text Generation" },
        tags: ["Third-party", "Function calling"],
        properties: [{ property_id: "context-window", value: "1,047,576" }],
      },
      {
        id: "@cf/black-forest-labs/flux-1-schnell",
        name: "flux-1-schnell",
        task: { name: "Text-to-Image" },
        tags: ["Cloudflare-hosted"],
      },
    ]),
  );

  expect(catalog.models).toContainEqual(
    expect.objectContaining({
      id: "openai/gpt-4.1-mini",
      provider: "openai",
      providerLabel: "OpenAI",
      source: "third-party",
      contextWindowTokens: 1_047_576,
    }),
  );
  expect(catalog.models.map((model) => model.id)).not.toContain(
    "@cf/black-forest-labs/flux-1-schnell",
  );
});

test("installation model settings persist selected model, gateway, and BYOK alias", async () => {
  const githubInstallationId = 9_000_000 + Math.floor(Math.random() * 1_000_000);
  const db = createDbClient(env.DB);

  const saved = await saveInstallationModelSettings(db, envWithModelCatalog([kimiCatalogModel]), {
    githubInstallationId,
    accountId: null,
    modelId: "@cf/moonshotai/kimi-k2.6",
    gatewayId: "test_gateway",
    byokAlias: "kimi-prod",
    actorGithubUserId: 1,
    actorGithubLogin: "octocat",
  });

  expect(saved).toMatchObject({
    githubInstallationId,
    modelId: "@cf/moonshotai/kimi-k2.6",
    modelName: "Kimi K2.6",
    provider: "kimi",
    gatewayId: "test_gateway",
    byokAlias: "kimi-prod",
    source: "saved",
  });

  const readBack = await readInstallationModelSettings(db, githubInstallationId);
  expect(readBack).toEqual(saved);
});

test("smoke test records only the saved model selection", async () => {
  const githubInstallationId = 10_000_000 + Math.floor(Math.random() * 1_000_000);
  const db = createDbClient(env.DB);

  await saveInstallationModelSettings(db, envWithModelCatalog([kimiCatalogModel]), {
    githubInstallationId,
    accountId: null,
    modelId: "@cf/moonshotai/kimi-k2.6",
    gatewayId: "test_gateway",
    byokAlias: null,
  });

  await recordInstallationModelSmokeTest(db, {
    githubInstallationId,
    modelId: DEFAULT_NANITES_MODEL_ID,
    gatewayId: "default",
    byokAlias: null,
    result: {
      status: "success",
      message: "wrong model",
      latencyMs: 1,
    },
  });
  expect((await readInstallationModelSettings(db, githubInstallationId)).lastTestStatus).toBeNull();

  await recordInstallationModelSmokeTest(db, {
    githubInstallationId,
    modelId: "@cf/moonshotai/kimi-k2.6",
    gatewayId: "test_gateway",
    byokAlias: null,
    result: {
      status: "success",
      message: "ok",
      latencyMs: 12,
    },
  });

  expect(await readInstallationModelSettings(db, githubInstallationId)).toMatchObject({
    lastTestStatus: "success",
    lastTestMessage: "ok",
    lastTestLatencyMs: 12,
  });
});

test("smoke test routes through Cloudflare AI Gateway with BYOK alias", async () => {
  const calls: unknown[][] = [];
  const result = await smokeTestNanitesModel({
    env: {
      ...env,
      AI: {
        run: async (...args: unknown[]) => {
          calls.push(args);
          return { response: "ok" };
        },
      },
    } as Env,
    modelId: DEFAULT_NANITES_MODEL_ID,
    gatewayId: "default",
    byokAlias: "deepseek-prod",
  });

  expect(result.status).toBe("success");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[0]).toBe(DEFAULT_NANITES_MODEL_ID);
  expect(calls[0]?.[2]).toMatchObject({
    gateway: {
      id: "default",
      skipCache: true,
      metadata: {
        sigvelo_surface: "settings",
        sigvelo_action: "model_smoke_test",
      },
    },
    extraHeaders: {
      "cf-aig-byok-alias": "deepseek-prod",
    },
  });
});

test("settings API requires browser authentication", async () => {
  const response = await nanitesHttpApp.request("/api/settings/model", {}, env);

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    code: "authentication_required",
  });
});
