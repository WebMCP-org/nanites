import { z } from "zod";
import type { DeprovisionNaniteOutput } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

const deprovisionToolInputSchema = z
  .object({
    naniteId: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
  })
  .strict()
  .describe("Permanently deprovision one registered Nanite and remove its run history.");

export const deprovisionTool = defineSigveloMcpTool({
  name: "sigvelo_deprovision_nanite",
  title: "Deprovision a Sigvelo Nanite",
  description:
    "Permanently removes one registered Nanite, deletes its child agent, clears runtime activity, and removes its run history.",
  inputSchema: deprovisionToolInputSchema,
  outputSchema: createObjectOutputSchema("Sigvelo Nanite deprovisioning result."),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, { manager }) {
    return manager.deprovisionNanite({
      naniteId: input.naniteId,
      reason: input.reason,
    });
  },
} satisfies SigveloMcpToolDefinition<typeof deprovisionToolInputSchema, DeprovisionNaniteOutput>);
