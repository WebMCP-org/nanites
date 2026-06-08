import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSigveloNanitesMcpServer, registerSigveloNaniteTools } from "#/backend/mcp/index.ts";
import { createSigveloThinkTools, naniteTools } from "#/backend/nanites/tools/index.ts";
import { MCP_SCOPES } from "#/mcp.ts";

const deploymentDefaultModel = { mode: "deployment_default" } as const;

test("Nanite tool registry declares the canonical manager tools explicitly", () => {
  expect(naniteTools.map((tool) => tool.name)).toEqual([
    "sigvelo_whoami",
    "sigvelo_create_nanite",
    "sigvelo_debug_nanites",
    "sigvelo_deprovision_nanite",
    "sigvelo_start_nanite_run",
    "sigvelo_cancel_nanite_runs",
    "sigvelo_test_nanite_trigger",
    "sigvelo_explore_nanite_workspace",
    "sigvelo_reset_nanite_debug",
  ]);
});

test("Nanite tool names do not drift into duplicate MCP registrations", () => {
  const toolNames = naniteTools.map((tool) => tool.name);
  expect(new Set(toolNames).size).toBe(toolNames.length);
});

test("Nanite tools use flattened MCP SDK metadata", () => {
  for (const tool of naniteTools) {
    expect(tool).toHaveProperty("title");
    expect(tool).toHaveProperty("description");
    expect(tool).toHaveProperty("inputSchema");
    expect(tool).toHaveProperty("outputSchema");
    expect(tool).toHaveProperty("execute");
    expect(tool).not.toHaveProperty("config");
    expect(tool).not.toHaveProperty("handler");
  }
});

test("Nanite debug transcript query accepts empty strings to list transcript messages", () => {
  const debugTool = naniteTools.find((tool) => tool.name === "sigvelo_debug_nanites");

  expect(
    debugTool?.inputSchema.safeParse({
      include: ["transcript"],
      transcript: {
        query: "",
      },
    }).success,
  ).toBe(true);
});

test("Nanite create schema rejects singular GitHub event source filter keys", () => {
  const createTool = naniteTools.find((tool) => tool.name === "sigvelo_create_nanite");
  const result = createTool?.inputSchema.safeParse({
    manifest: {
      id: "singular-event-source",
      name: "Singular event source",
      description: "Should fail because GitHub filters use plural array keys.",
      model: deploymentDefaultModel,
      eventSource: {
        type: "github",
        event: "push",
        repository: "WebMCP-org/nanites",
        branch: "main",
      },
      triggerSource: "export default { async handle(_event, ctx) { return ctx.noop('test'); } };",
      permissions: {},
    },
  });

  expect(result?.success).toBe(false);
  if (result && !result.success) {
    expect(JSON.stringify(result.error.issues)).toContain("event");
    expect(JSON.stringify(result.error.issues)).toContain("repository");
    expect(JSON.stringify(result.error.issues)).toContain("branch");
  }
});

test("Nanite create schema rejects generic webhook event sources until a real source exists", () => {
  const createTool = naniteTools.find((tool) => tool.name === "sigvelo_create_nanite");
  const result = createTool?.inputSchema.safeParse({
    manifest: {
      id: "stripe-webhook",
      name: "Stripe webhook",
      description: "Should fail because Nanites only support GitHub webhook intake right now.",
      model: deploymentDefaultModel,
      eventSource: {
        type: "webhook",
        source: "stripe",
      },
      triggerSource: "export default { async handle(_event, ctx) { return ctx.noop('test'); } };",
      permissions: {},
    },
  });

  expect(result?.success).toBe(false);
  if (result && !result.success) {
    expect(JSON.stringify(result.error.issues)).toContain("source");
  }
});

test("Nanite create schema rejects old trigger source manifest fields", () => {
  const createTool = naniteTools.find((tool) => tool.name === "sigvelo_create_nanite");
  const result = createTool?.inputSchema.safeParse({
    manifest: {
      id: "rejected-trigger-source",
      name: "Legacy trigger source",
      description: "Should fail because trigger source is a root manifest field now.",
      model: deploymentDefaultModel,
      trigger: {
        type: "github",
        events: ["push"],
      },
      inboundTrigger: {
        sourceCode: "export default { async handle(_event, ctx) { return ctx.noop('test'); } };",
      },
      permissions: {},
    },
  });

  expect(result?.success).toBe(false);
  if (result && !result.success) {
    expect(JSON.stringify(result.error.issues)).toContain("trigger");
    expect(JSON.stringify(result.error.issues)).toContain("inboundTrigger");
  }
});

test("Nanite create schema requires triggerSource for machine event sources", () => {
  const createTool = naniteTools.find((tool) => tool.name === "sigvelo_create_nanite");
  const result = createTool?.inputSchema.safeParse({
    manifest: {
      id: "missing-trigger-source",
      name: "Missing trigger source",
      description: "Should fail because GitHub event sources must own behavior in code.",
      model: deploymentDefaultModel,
      eventSource: {
        type: "github",
        events: ["push"],
      },
      permissions: {},
    },
  });

  expect(result?.success).toBe(false);
  if (result && !result.success) {
    expect(JSON.stringify(result.error.issues)).toContain("triggerSource");
  }
});

test("Nanite create schema rejects model-authored runtime capabilities", () => {
  const createTool = naniteTools.find((tool) => tool.name === "sigvelo_create_nanite");
  const result = createTool?.inputSchema.safeParse({
    manifest: {
      id: "capability-config",
      name: "Capability config",
      description: "Should fail because runtime tool inventory is derived from permissions.",
      model: deploymentDefaultModel,
      eventSource: { type: "manual" },
      permissions: {
        github: {
          repositories: ["WebMCP-org/docs"],
          appPermissions: { contents: "write", pull_requests: "write" },
        },
      },
      capabilities: {
        githubMcp: {
          tier: "github_pr_author",
        },
      },
    },
  });

  expect(result?.success).toBe(false);
  if (result && !result.success) {
    expect(JSON.stringify(result.error.issues)).toContain("capabilities");
  }
});

test("Nanite create schema requires explicit model config", () => {
  const createTool = naniteTools.find((tool) => tool.name === "sigvelo_create_nanite");

  const missingModel = createTool?.inputSchema.safeParse({
    manifest: {
      id: "missing-model",
      name: "Missing model",
      description: "Should fail because model policy is required.",
      eventSource: { type: "manual" },
      permissions: {},
    },
  });

  expect(missingModel?.success).toBe(false);
  if (missingModel && !missingModel.success) {
    expect(JSON.stringify(missingModel.error.issues)).toContain("model");
  }

  expect(
    createTool?.inputSchema.safeParse({
      manifest: {
        id: "deployment-default-model",
        name: "Deployment default model",
        description: "Uses the deployment default model.",
        model: deploymentDefaultModel,
        eventSource: { type: "manual" },
        permissions: {},
      },
    }).success,
  ).toBe(true);
});

test("Nanite create schema accepts selected model ids but rejects credential fields", () => {
  const createTool = naniteTools.find((tool) => tool.name === "sigvelo_create_nanite");
  const selected = createTool?.inputSchema.safeParse({
    manifest: {
      id: "selected-model",
      name: "Selected model",
      description: "Uses a selected model.",
      model: {
        mode: "selected",
        modelId: " deepseek/deepseek-v4-pro ",
      },
      eventSource: { type: "manual" },
      permissions: {},
    },
  });

  expect(selected?.success).toBe(true);
  if (selected?.success) {
    expect(selected.data).toMatchObject({
      manifest: {
        model: {
          mode: "selected",
          modelId: "deepseek/deepseek-v4-pro",
        },
      },
    });
  }

  const credentialField = createTool?.inputSchema.safeParse({
    manifest: {
      id: "selected-model-with-key",
      name: "Selected model with key",
      description: "Should fail because credentials stay out of manifests.",
      model: {
        mode: "selected",
        modelId: "deepseek/deepseek-v4-pro",
        byokAlias: "prod-key",
      },
      eventSource: { type: "manual" },
      permissions: {},
    },
  });

  expect(credentialField?.success).toBe(false);
  if (credentialField && !credentialField.success) {
    expect(JSON.stringify(credentialField.error.issues)).toContain("byokAlias");
  }
});

test("Nanite deprovision schema accepts only one Nanite id", () => {
  const deprovisionTool = naniteTools.find((tool) => tool.name === "sigvelo_deprovision_nanite");

  expect(
    deprovisionTool?.inputSchema.safeParse({
      naniteId: "docs-syncer",
      reason: "No longer needed.",
    }).success,
  ).toBe(true);

  const result = deprovisionTool?.inputSchema.safeParse({
    naniteIds: ["docs-syncer", "release-helper"],
    reason: "No longer needed.",
  });

  expect(result?.success).toBe(false);
  if (result && !result.success) {
    expect(JSON.stringify(result.error.issues)).toContain("naniteId");
    expect(JSON.stringify(result.error.issues)).toContain("naniteIds");
  }
});

test("Nanite create schema accepts Cloudflare schedule event source language", () => {
  const createTool = naniteTools.find((tool) => tool.name === "sigvelo_create_nanite");
  const triggerSource =
    "export default { async handle(_event, ctx) { return ctx.noop('test'); } };";

  expect(
    createTool?.inputSchema.safeParse({
      manifest: {
        id: "cron-schedule",
        name: "Cron schedule",
        description: "Uses Cloudflare Agent schedule().",
        model: deploymentDefaultModel,
        eventSource: {
          type: "schedule",
          when: "0 9 * * *",
        },
        triggerSource,
        permissions: {},
      },
    }).success,
  ).toBe(true);

  expect(
    createTool?.inputSchema.safeParse({
      manifest: {
        id: "interval-schedule",
        name: "Interval schedule",
        description: "Uses Cloudflare Agent scheduleEvery().",
        model: deploymentDefaultModel,
        eventSource: {
          type: "scheduleEvery",
          intervalSeconds: 3600,
        },
        triggerSource,
        permissions: {},
      },
    }).success,
  ).toBe(true);
});

test("Nanite create schema rejects old nested schedule discriminants", () => {
  const createTool = naniteTools.find((tool) => tool.name === "sigvelo_create_nanite");
  const result = createTool?.inputSchema.safeParse({
    manifest: {
      id: "old-schedule",
      name: "Old schedule",
      description: "Should fail because schedules use Cloudflare method names now.",
      model: deploymentDefaultModel,
      eventSource: {
        type: "schedule",
        schedule: {
          type: "cron",
          cron: "0 9 * * *",
        },
      },
      triggerSource: "export default { async handle(_event, ctx) { return ctx.noop('test'); } };",
      permissions: {},
    },
  });

  expect(result?.success).toBe(false);
  if (result && !result.success) {
    expect(JSON.stringify(result.error.issues)).toContain("when");
    expect(JSON.stringify(result.error.issues)).toContain("schedule");
  }
});

test("Think tools are translated from the same SigVelo registry", () => {
  const thinkTools = createSigveloThinkTools({
    env: {} as Env,
    getProps: () => null,
  });

  expect(Object.keys(thinkTools)).toEqual(naniteTools.map((tool) => tool.name));
  expect(thinkTools.sigvelo_whoami).toMatchObject({
    title: "Inspect SigVelo authorization",
    description: "Returns the GitHub actor and installation bound to this tool session.",
  });
});

test("MCP tools/list exposes schemas, output schemas, and annotations", async () => {
  const server = createSigveloNanitesMcpServer();
  registerSigveloNaniteTools(server, {
    env: {} as Env,
    getProps: () => ({
      authKind: "mcp",
      githubUserId: 1,
      githubLogin: "octocat",
      githubInstallationId: 2,
      clientId: "test-client",
      scopes: [MCP_SCOPES.read, MCP_SCOPES.write],
      authorizedAt: new Date(0).toISOString(),
    }),
  });

  const client = new Client({ name: "nanite-tool-registry-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listedTools = await client.listTools();
  const listedToolByName = new Map(listedTools.tools.map((tool) => [tool.name, tool]));
  const whoami = listedToolByName.get("sigvelo_whoami");
  const createNanite = listedToolByName.get("sigvelo_create_nanite");

  expect([...listedToolByName.keys()]).toEqual(naniteTools.map((tool) => tool.name));
  expect(whoami?.annotations).toMatchObject({
    readOnlyHint: true,
    destructiveHint: false,
  });
  expect(whoami?.outputSchema).toMatchObject({ type: "object" });
  expect(createNanite?.inputSchema).toMatchObject({ type: "object" });
  expect(createNanite?.outputSchema).toMatchObject({ type: "object" });
  for (const listedTool of listedTools.tools) {
    expect(JSON.stringify(listedTool.inputSchema)).not.toContain("managerName");
  }

  await client.close();
  await server.close();
});
