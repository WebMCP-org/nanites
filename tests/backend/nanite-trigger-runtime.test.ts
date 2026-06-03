import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { validateGeneratedTriggerSource } from "#/backend/nanites/trigger-runtime.ts";
import type { SigveloNaniteManager } from "#/backend/nanites/host.ts";

function getManager() {
  return getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<SigveloNaniteManager>,
    `trigger-validation-${crypto.randomUUID()}`,
  );
}

test("generated trigger validation accepts source that bundles and exports the runtime contract", async () => {
  const result = await validateGeneratedTriggerSource({
    loader: env.LOADER,
    cacheKey: `valid-trigger-${crypto.randomUUID()}`,
    event: null,
    sourceCode: `
export default {
  async handle(event, ctx) {
    if (event.name !== "push") {
      return ctx.noop("Not a push.");
    }

    return ctx.dispatchSelf({ repository: event.payload.repository.full_name });
  },
};
`,
  });

  expect(result).toEqual({ ok: true });
});

test("generated trigger validation rejects source that does not export handle", async () => {
  const result = await validateGeneratedTriggerSource({
    loader: env.LOADER,
    cacheKey: `missing-handle-${crypto.randomUUID()}`,
    event: null,
    sourceCode: `export default { notHandle() { return null; } };`,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain("phase=response");
    expect(result.error).toContain("export default { handle(event, ctx) }");
  }
});

test("generated trigger validation rejects forbidden dynamic code before bundling", async () => {
  const result = await validateGeneratedTriggerSource({
    loader: env.LOADER,
    cacheKey: `dynamic-code-${crypto.randomUUID()}`,
    event: null,
    sourceCode: `
export default {
  async handle() {
    return eval("({ type: 'noop', reason: 'dynamic' })");
  },
};
`,
  });

  expect(result).toMatchObject({ ok: false });
  if (!result.ok) {
    expect(result.error).toContain("phase=static");
    expect(result.error).toContain("eval");
  }
});

test("nanite registration stores generated triggers only after validation passes", async () => {
  const manager = await getManager();

  await manager.registerNanite({
    manifest: {
      id: "valid-generated-trigger",
      name: "Valid generated trigger",
      description: "Registers source that satisfies the trigger runtime contract.",
      trigger: {
        type: "github",
        events: ["push"],
        repositories: ["WebMCP-org/nanites"],
        branches: ["main"],
      },
      inboundTrigger: {
        sourceCode: `
export default {
  async handle(_event, ctx) {
    return ctx.noop("validated");
  },
};
`,
      },
      permissions: {},
    },
  });

  expect((await manager.getSnapshot()).nanites["valid-generated-trigger"]?.manifest).toMatchObject({
    id: "valid-generated-trigger",
    inboundTrigger: {
      sourceCode: expect.stringContaining("async handle"),
    },
  });
});
