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
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";
import { resolveReferencedNaniteRepositoryFullNames } from "#/backend/nanites/tools/authorization.ts";
import { MCP_SCOPES } from "#/mcp.ts";

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
        query: z.string().optional(),
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
  title: "Debug SigVelo Nanites",
  description:
    "Inspects manager-owned Nanite state and, when requested, delegates to the child Think sub-agent for transcript and submission inspection.",
  inputSchema: inspectDebugToolInputSchema,
  outputSchema: createObjectOutputSchema("SigVelo Nanite debug inspection output."),
  authorization: {
    requiredScope: MCP_SCOPES.read,
    repositoryPolicy: {
      type: "runtime",
      access: "read",
      resolve: resolveReferencedNaniteRepositoryFullNames({
        type: "all_nanites_when_unscoped",
      }),
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async execute(input, { manager }) {
    return manager.inspectNaniteDebug(input);
  },
} satisfies SigveloMcpToolDefinition<typeof inspectDebugToolInputSchema, InspectNaniteDebugOutput>);
