import { env } from "cloudflare:test";
import { validateNanitesModelId } from "#/backend/nanites/model-settings.ts";

test("model validation accepts Workers AI ids without reading the Cloudflare catalog", async () => {
  Object.assign(env, {
    AI: {
      models: async () => {
        throw new Error("model catalog should not be read");
      },
    },
  });

  await expect(validateNanitesModelId(env, "@cf/moonshotai/kimi-k2.6")).resolves.toBe(
    "@cf/moonshotai/kimi-k2.6",
  );
});

test("model validation accepts provider-native ids", async () => {
  await expect(validateNanitesModelId(env, "deepseek/deepseek-v4-pro")).resolves.toBe(
    "deepseek/deepseek-v4-pro",
  );
});

test("model validation rejects invalid model ids", async () => {
  await expect(validateNanitesModelId(env, "not a model id")).rejects.toMatchObject({
    kind: "nanitesModelSelectionInvalid",
  });
});
