import { MCP_SCOPES } from "#/shared/constants.ts";
import { z } from "zod";
import type { DeprovisionNaniteOutput } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";
import { resolveReferencedNaniteRepositoryFullNames } from "#/backend/nanites/tools/authorization.ts";

const deprovisionToolInputSchema = z
  .object({
    naniteId: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
  })
  .strict()
  .describe("Permanently deprovision one registered Nanite and remove its run history.");

export const deprovisionTool = defineSigveloMcpTool({
  name: "sigvelo_deprovision_nanite",
  title: "Deprovision a SigVelo Nanite",
  description:
    "Permanently removes one registered Nanite, deletes its child agent, clears runtime activity, and removes its run history.",
  inputSchema: deprovisionToolInputSchema,
  outputSchema: createObjectOutputSchema("SigVelo Nanite deprovisioning result."),
  authorization: {
    requiredScope: MCP_SCOPES.write,
    repositoryPolicy: {
      type: "runtime",
      access: "write",
      resolve: resolveReferencedNaniteRepositoryFullNames("referenced_nanites"),
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, { context, manager }) {
    return manager.deprovisionNanite({
      naniteId: input.naniteId,
      reason: input.reason,
      actor: context.actor,
      requestId: context.requestId,
    });
  },
} satisfies SigveloMcpToolDefinition<typeof deprovisionToolInputSchema, DeprovisionNaniteOutput>);
