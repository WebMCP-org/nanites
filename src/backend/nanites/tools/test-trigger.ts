import { MCP_SCOPES } from "#/shared/constants.ts";
import { z } from "zod";
import {
  NANITE_TRIGGER_TEST_INSTRUCTION,
  NANITE_TRIGGER_TEST_TIMEOUT_MS,
  type TestNaniteTriggerOutput,
} from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";
import { githubTriggerTestEventInputSchema } from "#/shared/utils/github.ts";

const testNaniteTriggerToolInputSchema = z.object({
  naniteId: nonEmptyStringSchema,
  event: githubTriggerTestEventInputSchema,
  testInstruction: nonEmptyStringSchema.default(NANITE_TRIGGER_TEST_INSTRUCTION),
  waitForTerminalOutcome: z.boolean().default(true),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(NANITE_TRIGGER_TEST_TIMEOUT_MS),
});

export const testNaniteTriggerTool = defineSigveloMcpTool({
  name: "sigvelo_test_nanite_trigger",
  title: "Test a SigVelo Nanite trigger",
  description:
    "Runs a GitHub webhook-shaped test event through generated trigger code, dispatches accepted runs, and optionally waits for a terminal Nanite outcome.",
  inputSchema: testNaniteTriggerToolInputSchema,
  outputSchema: createObjectOutputSchema("SigVelo Nanite trigger test result."),
  requiredScope: MCP_SCOPES.write,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, { context, manager }) {
    return manager.testNaniteTrigger({
      naniteId: input.naniteId,
      event: input.event,
      actorId: `github:${context.actor.githubUserId}`,
      testInstruction: input.testInstruction,
      waitForTerminalOutcome: input.waitForTerminalOutcome,
      timeoutMs: input.timeoutMs,
    });
  },
} satisfies SigveloMcpToolDefinition<
  typeof testNaniteTriggerToolInputSchema,
  TestNaniteTriggerOutput
>);
