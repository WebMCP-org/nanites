import { createSigveloAgentLanguageModel } from "#/backend/nanites/language-model.ts";

test("Nanite language model defaults to DeepSeek through AI Gateway", () => {
  const model = createSigveloAgentLanguageModel({
    env: {
      AI: { run: async () => new Response("{}") },
      NANITES_LLM_BASE_URL: "",
      NANITES_LLM_FIXTURE: "",
    } as unknown as Env,
    sessionAffinity: "run-123",
  });

  expect(model).toMatchObject({
    modelId: "deepseek/deepseek-v4-pro",
    provider: "workersai.chat",
    settings: { sessionAffinity: "run-123" },
  });
  expect((model as { config?: { gateway?: unknown } }).config?.gateway).toEqual({
    id: "default",
    skipCache: true,
  });
});
