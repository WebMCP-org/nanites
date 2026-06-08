import { z } from "zod";
import type { CancelNaniteRunsOutput } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

const cancelRunsToolInputSchema = z
  .object({
    naniteId: nonEmptyStringSchema.optional(),
    runIds: z.array(nonEmptyStringSchema).min(1).max(100).optional(),
    olderThanIso: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(100).default(25),
    reason: nonEmptyStringSchema,
  })
  .describe("Cancel pending or running Nanite runs.");

export const cancelRunsTool = defineSigveloMcpTool({
  name: "sigvelo_cancel_nanite_runs",
  title: "Cancel SigVelo Nanite runs",
  description: "Cancels pending or running Nanite runs through the manager cancellation path.",
  inputSchema: cancelRunsToolInputSchema,
  outputSchema: createObjectOutputSchema("SigVelo Nanite run cancellation result."),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async execute(input, { context, manager }) {
    //@ts-ignore Super Deep types
    return manager.cancelRuns({
      runIds: input.runIds,
      naniteId: input.naniteId,
      olderThanIso: input.olderThanIso,
      limit: input.limit,
      reason: input.reason,
      actor: context.actor,
      requestId: context.requestId,
    });
  },
} satisfies SigveloMcpToolDefinition<typeof cancelRunsToolInputSchema, CancelNaniteRunsOutput>);
