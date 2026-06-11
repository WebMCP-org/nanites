import { env } from "cloudflare:test";
import {
  fetchNanitesModelCatalog,
  validateNanitesModelId,
} from "#/backend/nanites/model-settings.ts";

test("model catalog accepts Cloudflare rows with array-valued properties", async () => {
  Object.assign(env, {
    AI: {
      models: async () => [
        {
          id: "8a5d00bd-de28-4a28-b37a-ce46d01ebaeb",
          name: "@cf/moonshotai/kimi-k2.6",
          task: {
            id: "c329a1f9-323d-4e91-b2aa-582dd4188d34",
            name: "Text Generation",
            description: "Family of generative text models.",
          },
          tags: [],
          properties: [
            {
              property_id: "context_window",
              value: "262144",
            },
            {
              property_id: "function_calling",
              value: "true",
            },
            {
              property_id: "price",
              value: [
                {
                  unit: "per M input tokens",
                  price: 0.95,
                  currency: "USD",
                },
              ],
            },
          ],
        },
      ],
    },
  });

  const catalog = await fetchNanitesModelCatalog(env);

  await expect(validateNanitesModelId(env, "@cf/moonshotai/kimi-k2.6")).resolves.toBe(
    "@cf/moonshotai/kimi-k2.6",
  );
  expect(catalog.models).toEqual([
    expect.objectContaining({
      id: "@cf/moonshotai/kimi-k2.6",
      capabilities: ["Function calling"],
      contextWindowTokens: 262144,
    }),
  ]);
});
