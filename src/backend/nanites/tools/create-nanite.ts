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

const naniteScheduleSpecSchema = z.union([
  z.object({
    type: z.literal("scheduled"),
    date: nonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("delayed"),
    delayInSeconds: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("cron"),
    cron: nonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("interval"),
    intervalSeconds: z.number().int().positive(),
  }),
]);

const naniteTriggerSpecSchema = z.union([
  z.object({
    type: z.literal("manual"),
  }),
  z.object({
    type: z.literal("schedule"),
    schedule: naniteScheduleSpecSchema,
  }),
  z.object({
    type: z.literal("github"),
    events: z.array(z.enum(emitterEventNames)).min(1).optional(),
    repositories: z.array(nonEmptyStringSchema).min(1).optional(),
    actions: z.array(nonEmptyStringSchema).min(1).optional(),
    branches: z.array(nonEmptyStringSchema).min(1).optional(),
  }),
  z.object({
    type: z.literal("webhook"),
    source: nonEmptyStringSchema,
  }),
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

const createNaniteToolInputSchema = z
  .object({
    managerName: optionalNaniteManagerNameSchema,
    manifest: z.object({
      id: nonEmptyStringSchema,
      name: nonEmptyStringSchema,
      description: nonEmptyStringSchema,
      trigger: naniteTriggerSpecSchema,
      inboundTrigger: z
        .object({
          sourceCode: nonEmptyStringSchema,
        })
        .optional(),
      permissions: nanitePermissionSpecSchema,
      capabilities: naniteCapabilitySpecSchema.optional(),
    }),
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
