import { MCP_SCOPES } from "#/shared/constants.ts";
import { z } from "zod";
import type { StartNaniteManualRunOutput } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";
import { resolveReferencedNaniteRepositoryFullNames } from "#/backend/nanites/tools/authorization.ts";

const startNaniteRunToolInputSchema = z.object({
  naniteId: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  manualRequestId: nonEmptyStringSchema.optional(),
});

export const startNaniteRunTool = defineSigveloMcpTool({
  name: "sigvelo_start_nanite_run",
  title: "Start a SigVelo Nanite run",
  description:
    "Starts a direct manual run for one registered Nanite and dispatches it through the real Nanite manager path.",
  inputSchema: startNaniteRunToolInputSchema,
  outputSchema: createObjectOutputSchema("SigVelo Nanite manual run start result."),
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
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, { context, manager }) {
    return manager.startNaniteManualRun({
      naniteId: input.naniteId,
      message: input.message,
      actorId: `github:${context.actor.githubUserId}`,
      actor: context.actor,
      manualRequestId: input.manualRequestId ?? context.requestId,
    });
  },
} satisfies SigveloMcpToolDefinition<
  typeof startNaniteRunToolInputSchema,
  StartNaniteManualRunOutput
>);
