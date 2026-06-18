import { z } from "zod";
import type { ResetNaniteDebugOutput } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";
import { resolveReferencedNaniteRepositoryFullNames } from "#/backend/nanites/tools/authorization.ts";
import { MCP_SCOPES } from "#/mcp.ts";

const resetDebugToolInputSchema = z
  .object({
    naniteId: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
  })
  .describe("Reset child-owned Nanite debug state.");

export const resetDebugTool = defineSigveloMcpTool({
  name: "sigvelo_reset_nanite_debug",
  title: "Reset SigVelo Nanite debug state",
  description: "Clears child-owned Think messages and durable submissions for one Nanite.",
  inputSchema: resetDebugToolInputSchema,
  outputSchema: createObjectOutputSchema("SigVelo Nanite debug reset result."),
  authorization: {
    requiredScope: MCP_SCOPES.write,
    repositoryPolicy: {
      type: "runtime",
      access: "write",
      resolve: resolveReferencedNaniteRepositoryFullNames({ type: "referenced_nanites" }),
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async execute(input, { manager }) {
    return manager.resetNaniteDebug({
      naniteId: input.naniteId,
    });
  },
} satisfies SigveloMcpToolDefinition<typeof resetDebugToolInputSchema, ResetNaniteDebugOutput>);
