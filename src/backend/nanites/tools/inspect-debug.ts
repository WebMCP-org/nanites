import { z } from "zod";
import {
  naniteDebugIncludeSections,
  naniteRunStatuses,
  naniteRuntimeActivityStates,
  type InspectNaniteDebugOutput,
} from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  optionalNaniteManagerNameSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

const naniteRunStatusSchema = z.enum(naniteRunStatuses);
const naniteActivitySchema = z.enum(naniteRuntimeActivityStates);
const thinkSubmissionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "aborted",
  "skipped",
  "error",
]);

const inspectDebugToolInputSchema = z
  .object({
    managerName: optionalNaniteManagerNameSchema,
    naniteId: nonEmptyStringSchema.optional(),
    runId: nonEmptyStringSchema.optional(),
    status: z.union([naniteRunStatusSchema, z.array(naniteRunStatusSchema)]).optional(),
    activity: z.union([naniteActivitySchema, z.array(naniteActivitySchema)]).optional(),
    limit: z.number().int().min(1).max(100).default(25),
    include: z
      .array(z.enum(naniteDebugIncludeSections))
      .default(["nanites", "runs", "runtimeActivity"]),
    transcript: z
      .object({
        limit: z.number().int().min(1).max(200).default(25),
        query: nonEmptyStringSchema.optional(),
        roles: z.array(nonEmptyStringSchema).optional(),
        includeParts: z.boolean().default(false),
        maxTextLength: z.number().int().min(200).max(40_000).default(4_000),
        maxPartLength: z.number().int().min(1_000).max(40_000).default(12_000),
      })
      .optional(),
    submissions: z
      .object({
        limit: z.number().int().min(1).max(100).default(25),
        status: z
          .union([thinkSubmissionStatusSchema, z.array(thinkSubmissionStatusSchema)])
          .optional(),
      })
      .optional(),
  })
  .describe("Inspect Nanite manager state plus optional child-owned Think transcript/submissions.");

export const inspectDebugTool = defineSigveloMcpTool({
  name: "sigvelo_debug_nanites",
  title: "Debug Sigvelo Nanites",
  description:
    "Inspects manager-owned Nanite state and, when requested, delegates to the child Think sub-agent for transcript and submission inspection.",
  inputSchema: inspectDebugToolInputSchema,
  outputSchema: createObjectOutputSchema("Sigvelo Nanite debug inspection output."),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async execute(input, { manager }) {
    // @ts-ignore Cloudflare's concrete DO stub type can recursively expand the full manager RPC graph here.
    return manager.inspectNaniteDebug(input);
  },
} satisfies SigveloMcpToolDefinition<typeof inspectDebugToolInputSchema, InspectNaniteDebugOutput>);
