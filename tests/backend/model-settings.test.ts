import { env } from "cloudflare:test";
import {
  fetchNanitesModelCatalog,
  resolveDefaultSigveloAgentModelSettings,
  resolveNanitesModelSettings,
  validateNanitesModelId,
} from "#/backend/nanites/model-settings.ts";

function envWithModelCatalog(models: unknown[], overrides: Record<string, unknown> = {}): Env {
  return {
    ...env,
    ...overrides,
    AI: {
      models: async () => models,
    },
  } as Env;
}

test("model catalog returns no models when Cloudflare model search is unavailable", async () => {
  const catalog = await fetchNanitesModelCatalog(env as Env);

  expect(catalog.models).toEqual([]);
});

test("model catalog reads Cloudflare text-generation search results", async () => {
  const catalog = await fetchNanitesModelCatalog(
    envWithModelCatalog([
      {
        id: "02c16efa-29f5-4304-8e6c-3d188889f875",
        name: "@cf/qwen/qwq-32b",
        description: "Qwen reasoning model.",
        task: { name: "Text Generation" },
        tags: ["Cloudflare-hosted"],
        properties: [{ property_id: "context-window", value: "24,000" }],
      },
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
      {
        id: "02c16efa-29f5-4304-8e6c-3d188889f875",
        name: "catalog display name",
        task: { name: "Text Generation" },
        tags: ["Third-party"],
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
  expect(catalog.models).toContainEqual(
    expect.objectContaining({
      id: "@cf/qwen/qwq-32b",
      provider: "qwen",
      providerLabel: "Qwen",
      source: "cloudflare-hosted",
      contextWindowTokens: 24_000,
    }),
  );
  expect(catalog.models.map((model) => model.id)).not.toContain(
    "@cf/black-forest-labs/flux-1-schnell",
  );
  expect(catalog.models.map((model) => model.id)).not.toContain(
    "02c16efa-29f5-4304-8e6c-3d188889f875",
  );
});

test("model validation trims and checks the Cloudflare catalog", async () => {
  await expect(
    validateNanitesModelId(
      envWithModelCatalog([
        {
          id: "@cf/moonshotai/kimi-k2.6",
          name: "Kimi K2.6",
          task: { name: "Text Generation" },
          tags: ["Cloudflare-hosted"],
        },
      ]),
      " @cf/moonshotai/kimi-k2.6 ",
    ),
  ).resolves.toBe("@cf/moonshotai/kimi-k2.6");

  await expect(
    validateNanitesModelId(envWithModelCatalog([]), "deepseek/not-in-catalog"),
  ).rejects.toThrow("Nanites model selection is invalid");
});

test("runtime settings resolve from env and explicit model id", () => {
  expect(
    resolveDefaultSigveloAgentModelSettings(
      envWithModelCatalog([], { NANITES_AI_GATEWAY_ID: "deployment-gateway" }),
    ),
  ).toMatchObject({
    modelId: "deepseek/deepseek-v4-pro",
    provider: "deepseek",
    gatewayId: "deployment-gateway",
  });

  expect(
    resolveNanitesModelSettings(
      envWithModelCatalog([], { NANITES_AI_GATEWAY_ID: "deployment-gateway" }),
      "@cf/moonshotai/kimi-k2.6",
    ),
  ).toMatchObject({
    modelId: "@cf/moonshotai/kimi-k2.6",
    modelName: "Kimi K2.6",
    provider: "kimi",
    gatewayId: "deployment-gateway",
  });
});
