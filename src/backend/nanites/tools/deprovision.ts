import { z } from "zod";
import type { DeprovisionNanitesOutput } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  optionalNaniteManagerNameSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

const deprovisionToolInputSchema = z
  .object({
    managerName: optionalNaniteManagerNameSchema,
    naniteIds: z.array(nonEmptyStringSchema).min(1).max(100),
    reason: nonEmptyStringSchema,
  })
  .describe("Permanently deprovision registered Nanites and remove their run history.");

export const deprovisionTool = defineSigveloMcpTool({
  name: "sigvelo_deprovision_nanites",
  title: "Deprovision Sigvelo Nanites",
  description:
    "Permanently removes registered Nanites, deletes their child agents, clears runtime activity, and removes their run history.",
  inputSchema: deprovisionToolInputSchema,
  outputSchema: createObjectOutputSchema("Sigvelo Nanite deprovisioning result."),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, { manager }) {
    return manager.deprovisionNanites({
      naniteIds: input.naniteIds,
      reason: input.reason,
    });
  },
} satisfies SigveloMcpToolDefinition<typeof deprovisionToolInputSchema, DeprovisionNanitesOutput>);
