import { env } from "cloudflare:test";
import { createNaniteTool } from "#/backend/nanites/tools/create-nanite.ts";
import { validateGeneratedTriggerSource } from "#/backend/nanites/triggers.ts";
import docsSyncerExample from "../../plugins/nanites/assets/examples/docs-syncer.push.nanite.json?raw";
import prReviewExample from "../../plugins/nanites/assets/examples/pr-review.pull-request.nanite.json?raw";

const exampleFiles = [
  {
    file: "plugins/nanites/assets/examples/docs-syncer.push.nanite.json",
    source: docsSyncerExample,
  },
  {
    file: "plugins/nanites/assets/examples/pr-review.pull-request.nanite.json",
    source: prReviewExample,
  },
];

test("Nanite plugin examples satisfy the create tool schema", () => {
  for (const { file, source } of exampleFiles) {
    const payload = JSON.parse(source) as unknown;
    const result = createNaniteTool.inputSchema.safeParse(payload);

    if (!result.success) {
      throw new Error(`${file}: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
  }
});

test("Nanite plugin examples include trigger source that bundles in the runtime", async () => {
  for (const { file, source } of exampleFiles) {
    const payload = JSON.parse(source) as {
      manifest?: {
        triggerSource?: unknown;
      };
    };
    const triggerSource = payload.manifest?.triggerSource;

    expect(typeof triggerSource).toBe("string");

    const result = await validateGeneratedTriggerSource({
      loader: env.LOADER,
      sourceCode: triggerSource as string,
      event: null,
      cacheKey: `plugin-example-${file}-${crypto.randomUUID()}`,
    });

    if (!result.ok) {
      throw new Error(`${file}: ${result.error}`);
    }
  }
});

test("Nanite plugin examples avoid legacy manifest fields", () => {
  for (const { source } of exampleFiles) {
    const payload = JSON.parse(source) as {
      manifest?: Record<string, unknown>;
    };
    const manifest = payload.manifest ?? {};

    expect(manifest).not.toHaveProperty("trigger");
    expect(manifest).not.toHaveProperty("inboundTrigger");
    expect(manifest).not.toHaveProperty("capabilities");
  }
});

test("Nanite plugin examples include explicit model ids", () => {
  for (const { source } of exampleFiles) {
    const payload = JSON.parse(source) as {
      manifest?: {
        model?: unknown;
      };
    };

    expect(payload.manifest?.model).toBe("@cf/moonshotai/kimi-k2.7-code");
  }
});
