import { env } from "cloudflare:test";
import { createDbClient } from "#/backend/db/index.ts";
import {
  hasInstallationAiProviderKey,
  listInstallationAiProviderKeySummaries,
  readInstallationAiProviderApiKey,
  saveInstallationAiProviderKey,
} from "#/backend/nanites/provider-keys.ts";
import { createNaniteRunLanguageModel } from "#/backend/nanites/language-model.ts";

beforeAll(async () => {
  Object.assign(env, {
    AUTH_COOKIE_SECRET: "provider-key-test-secret",
    CLOUDFLARE_ACCOUNT_ID: "test-cloudflare-account-id",
    CLOUDFLARE_API_TOKEN: "test-cloudflare-api-token",
    NANITES_LLM_BASE_URL: "",
    NANITES_LLM_FIXTURE: "",
  });
  await env.DB.exec(
    [
      "CREATE TABLE IF NOT EXISTS installation_ai_provider_keys (",
      "github_installation_id integer NOT NULL,",
      "provider text NOT NULL,",
      "encrypted_api_key text NOT NULL,",
      "key_last4 text NOT NULL,",
      "created_at integer NOT NULL,",
      "updated_at integer NOT NULL,",
      "PRIMARY KEY(github_installation_id, provider)",
      ");",
    ].join(" "),
  );
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("installation provider keys are saved without exposing raw API keys", async () => {
  const db = createDbClient(env.DB);
  const summary = await saveInstallationAiProviderKey({
    db,
    env: env as Env,
    githubInstallationId: 123,
    provider: "deepseek",
    apiKey: "sk-test-deepseek-key",
  });

  expect(summary).toMatchObject({
    provider: "deepseek",
    keyLast4: "-key",
  });
  await expect(hasInstallationAiProviderKey(db, 123, "deepseek")).resolves.toBe(true);
  await expect(hasInstallationAiProviderKey(db, 123, "openai")).resolves.toBe(false);

  const rows = await env.DB.prepare(
    "SELECT encrypted_api_key, key_last4 FROM installation_ai_provider_keys WHERE github_installation_id = ? AND provider = ?",
  )
    .bind(123, "deepseek")
    .all<{ encrypted_api_key: string; key_last4: string }>();
  expect(rows.results[0]?.encrypted_api_key).not.toContain("sk-test-deepseek-key");
  expect(rows.results[0]?.key_last4).toBe("-key");
  await expect(
    readInstallationAiProviderApiKey({
      db,
      env: env as Env,
      githubInstallationId: 123,
      provider: "deepseek",
    }),
  ).resolves.toBe("sk-test-deepseek-key");
});

test("installation provider key summaries are grouped by installation", async () => {
  const db = createDbClient(env.DB);
  await saveInstallationAiProviderKey({
    db,
    env: env as Env,
    githubInstallationId: 456,
    provider: "openai",
    apiKey: "sk-test-openai-key",
  });

  const summaries = await listInstallationAiProviderKeySummaries(db, [123, 456, 789]);

  expect(summaries.get(123)?.map((summary) => summary.provider)).toEqual(["deepseek"]);
  expect(summaries.get(456)?.map((summary) => summary.provider)).toEqual(["openai"]);
  expect(summaries.has(789)).toBe(false);
});

test("third-party Nanite runtime models require the matching installation API key", async () => {
  const db = createDbClient(env.DB);
  const modelSettings = {
    provider: "openai",
    providerLabel: "OpenAI",
    modelId: "openai/gpt-5.5",
    modelName: "GPT 5.5",
    gatewayId: "default",
  };

  await expect(
    createNaniteRunLanguageModel({
      db,
      env: env as Env,
      githubInstallationId: 900,
      sessionAffinity: "run_without_key",
      modelSettings,
    }),
  ).rejects.toThrow("Nanites model selection is invalid");

  await saveInstallationAiProviderKey({
    db,
    env: env as Env,
    githubInstallationId: 900,
    provider: "openai",
    apiKey: "sk-test-openai-runtime-key",
  });

  const model = await createNaniteRunLanguageModel({
    db,
    env: env as Env,
    githubInstallationId: 900,
    sessionAffinity: "run_with_key",
    modelSettings,
    gatewayMetadata: {
      installation_id: "900",
      nanite_id: "runtime-test",
      run_key: "run_with_key",
    },
  });

  expect(isRecord(model)).toBe(true);
  if (!isRecord(model)) {
    throw new Error("Expected AI SDK language model object.");
  }
  expect(model.provider).toBe("cloudflare-ai-gateway.chat");
  expect(model.modelId).toBe("openai/gpt-5.5");
});
