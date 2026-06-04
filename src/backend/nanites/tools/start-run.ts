import { z } from "zod";
import {
  NANITE_MANUAL_RUN_TIMEOUT_MS,
  type StartNaniteManualRunOutput,
} from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  optionalNaniteManagerNameSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

const startNaniteRunToolInputSchema = z
  .object({
    naniteId: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    manualRequestId: nonEmptyStringSchema.optional(),
    waitForTerminalOutcome: z.boolean().default(false),
    timeoutMs: z.number().int().min(1_000).max(120_000).default(NANITE_MANUAL_RUN_TIMEOUT_MS),
  })
  .extend({
    managerName: optionalNaniteManagerNameSchema,
  });

export const startNaniteRunTool = defineSigveloMcpTool({
  name: "sigvelo_start_nanite_run",
  title: "Start a Sigvelo Nanite run",
  description:
    "Starts a direct manual run for one registered Nanite and dispatches it through the real Nanite manager path.",
  inputSchema: startNaniteRunToolInputSchema,
  outputSchema: createObjectOutputSchema("Sigvelo Nanite manual run start result."),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, { context, manager }) {
    //@ts-ignore Super Deep types
    return manager.startNaniteManualRun({
      naniteId: input.naniteId,
      message: input.message,
      actorId: `github:${context.actor.githubUserId}`,
      manualRequestId: input.manualRequestId ?? context.requestId,
      waitForTerminalOutcome: input.waitForTerminalOutcome,
      timeoutMs: input.timeoutMs,
    });
  },
} satisfies SigveloMcpToolDefinition<
  typeof startNaniteRunToolInputSchema,
  StartNaniteManualRunOutput
>);
