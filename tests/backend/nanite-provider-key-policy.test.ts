import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import {
  assertNaniteModelKeyBelongsToInstallation,
  type SigveloNaniteManager,
} from "#/backend/agents/SigveloNaniteManager.ts";

beforeAll(async () => {
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

beforeEach(() => {
  Object.assign(env, {
    AI: {
      models: async () => [
        {
          id: "openai/gpt-5.5",
          name: "GPT 5.5",
          task: { name: "Text Generation" },
          tags: ["Third-party"],
        },
        {
          id: "google/gemini-2.5-pro",
          name: "Gemini 2.5 Pro",
          task: { name: "Text Generation" },
          tags: ["Third-party"],
        },
        {
          id: "@cf/moonshotai/kimi-k2.6",
          name: "Kimi K2.6",
          task: { name: "Text Generation" },
          tags: ["Cloudflare-hosted"],
        },
      ],
    },
  });
});

function installationManager(githubInstallationId: number) {
  return getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<SigveloNaniteManager>,
    `installation:${githubInstallationId}`,
  );
}

function seedProviderKey(githubInstallationId: number, provider: string) {
  return env.DB.prepare(
    [
      "INSERT OR REPLACE INTO installation_ai_provider_keys",
      "(github_installation_id, provider, encrypted_api_key, key_last4, created_at, updated_at)",
      "VALUES (?, ?, 'encrypted-test-key', 'test', 0, 0)",
    ].join(" "),
  )
    .bind(githubInstallationId, provider)
    .run();
}

function manualNaniteManifest(model: string) {
  return {
    id: `model-policy-${crypto.randomUUID()}`,
    name: "Model policy test Nanite",
    description: "Exercises installation-scoped model key policy.",
    model,
    eventSource: { type: "manual" },
    permissions: {},
  } as const;
}

test("third-party model registration requires a matching installation provider key", async () => {
  const githubInstallationId = Math.floor(Math.random() * 1_000_000) + 1;
  const manager = await installationManager(githubInstallationId);

  await expect(
    assertNaniteModelKeyBelongsToInstallation({
      env: env as Env,
      githubInstallationId,
      modelId: "openai/gpt-5.5",
    }),
  ).rejects.toThrow("Nanites model selection is invalid");

  await seedProviderKey(githubInstallationId, "google");

  await expect(
    assertNaniteModelKeyBelongsToInstallation({
      env: env as Env,
      githubInstallationId,
      modelId: "openai/gpt-5.5",
    }),
  ).rejects.toThrow("Nanites model selection is invalid");

  await seedProviderKey(githubInstallationId, "openai");

  await expect(
    manager.registerNanite({
      manifest: manualNaniteManifest("openai/gpt-5.5"),
    }),
  ).resolves.toMatchObject({
    manifest: {
      model: "openai/gpt-5.5",
    },
  });
});

test("Cloudflare-hosted model registration does not require an installation provider key", async () => {
  const githubInstallationId = Math.floor(Math.random() * 1_000_000) + 1;
  const manager = await installationManager(githubInstallationId);

  await expect(
    manager.registerNanite({
      manifest: manualNaniteManifest("@cf/moonshotai/kimi-k2.6"),
    }),
  ).resolves.toMatchObject({
    manifest: {
      model: "@cf/moonshotai/kimi-k2.6",
    },
  });
});
