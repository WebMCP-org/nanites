import { emitterEventNames } from "@octokit/webhooks";
import { z } from "zod";
import { naniteCapabilitySpecSchema } from "#/backend/nanites/github-mcp-capabilities.ts";
import type { ManagedNanite } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  optionalNaniteManagerNameSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

const naniteManualEventSourceSpecSchema = z.object({
  type: z.literal("manual"),
});

const naniteMachineEventSourceSpecSchema = z.union([
  z
    .object({
      type: z.literal("schedule"),
      when: z
        .union([z.number().int().positive(), nonEmptyStringSchema])
        .describe(
          "Cloudflare Agent schedule() argument. Use a number for delay seconds, a cron string for recurring schedules, or an ISO date string for a one-shot Date schedule.",
        ),
    })
    .strict()
    .describe("Cloudflare Agent schedule() event source."),
  z
    .object({
      type: z.literal("scheduleEvery"),
      intervalSeconds: z
        .number()
        .int()
        .positive()
        .describe("Cloudflare Agent scheduleEvery() interval in seconds."),
    })
    .strict()
    .describe("Cloudflare Agent scheduleEvery() event source."),
  z
    .object({
      type: z.literal("github"),
      events: z.array(z.enum(emitterEventNames)).min(1).optional(),
      repositories: z.array(nonEmptyStringSchema).min(1).optional(),
      actions: z.array(nonEmptyStringSchema).min(1).optional(),
      branches: z.array(nonEmptyStringSchema).min(1).optional(),
    })
    .strict()
    .describe(
      "GitHub event source candidate filter. Use plural array keys: events, repositories, actions, and branches. Put behavior in manifest.triggerSource.",
    ),
]);

const nanitePermissionSpecSchema = z
  .object({
    github: z
      .object({
        repositories: z.array(nonEmptyStringSchema).default([]),
        appPermissions: z.record(z.string(), z.enum(["read", "write"])).default({}),
      })
      .optional(),
  })
  .default({});

const naniteManifestBaseSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  permissions: nanitePermissionSpecSchema,
  capabilities: naniteCapabilitySpecSchema.optional(),
});

const naniteManifestSchema = z.union([
  naniteManifestBaseSchema
    .extend({
      eventSource: naniteManualEventSourceSpecSchema,
    })
    .strict(),
  naniteManifestBaseSchema
    .extend({
      eventSource: naniteMachineEventSourceSpecSchema,
      triggerSource: nonEmptyStringSchema.describe(
        "Worker-compatible TypeScript source that decides whether this event source dispatches the Nanite.",
      ),
    })
    .strict(),
]);

const createNaniteToolInputSchema = z
  .object({
    managerName: optionalNaniteManagerNameSchema,
    manifest: naniteManifestSchema,
    enabled: z.boolean().default(true),
  })
  .describe("Create or update a stable Nanite through the authorized installation-scoped manager.");

export const createNaniteTool = defineSigveloMcpTool({
  name: "sigvelo_create_nanite",
  title: "Create or update a Sigvelo Nanite",
  description: "Registers a stable Nanite spec with the authorized installation-scoped manager.",
  inputSchema: createNaniteToolInputSchema,
  outputSchema: createObjectOutputSchema("Registered Sigvelo Nanite record."),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, { manager }) {
    return manager.registerNanite({
      manifest: input.manifest,
      enabled: input.enabled,
    });
  },
} satisfies SigveloMcpToolDefinition<typeof createNaniteToolInputSchema, ManagedNanite>);
