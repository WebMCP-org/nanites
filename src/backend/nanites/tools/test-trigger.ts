import { z } from "zod";
import {
  NANITE_TRIGGER_TEST_INSTRUCTION,
  NANITE_TRIGGER_TEST_TIMEOUT_MS,
  type TestNaniteTriggerOutput,
} from "#/backend/agents/SigveloNaniteManager.ts";
import { githubTriggerFixtureIds } from "#/backend/nanites/triggers.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  optionalNaniteManagerNameSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

const testNaniteTriggerToolInputSchema = z
  .object({
    naniteId: nonEmptyStringSchema,
    event: z.object({
      fixture: z.enum(githubTriggerFixtureIds),
      overrides: z.record(z.string(), z.unknown()).default({}),
    }),
    testInstruction: nonEmptyStringSchema.default(NANITE_TRIGGER_TEST_INSTRUCTION),
    waitForTerminalOutcome: z.boolean().default(true),
    timeoutMs: z.number().int().min(1_000).max(120_000).default(NANITE_TRIGGER_TEST_TIMEOUT_MS),
  })
  .extend({
    managerName: optionalNaniteManagerNameSchema,
  });

export const testNaniteTriggerTool = defineSigveloMcpTool({
  name: "sigvelo_test_nanite_trigger",
  title: "Test a Sigvelo Nanite trigger",
  description:
    "Builds a realistic fixture event, runs generated trigger code, dispatches accepted runs, and optionally waits for a terminal Nanite outcome.",
  inputSchema: testNaniteTriggerToolInputSchema,
  outputSchema: createObjectOutputSchema("Sigvelo Nanite trigger test result."),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute(input, { context, manager }) {
    //@ts-ignore Super Deep types
    return manager.testNaniteTrigger({
      naniteId: input.naniteId,
      event: input.event,
      actorId: `github:${context.actor.githubUserId}`,
      testInstruction: input.testInstruction,
      waitForTerminalOutcome: input.waitForTerminalOutcome,
      timeoutMs: input.timeoutMs,
      requestId: context.requestId,
    });
  },
} satisfies SigveloMcpToolDefinition<
  typeof testNaniteTriggerToolInputSchema,
  TestNaniteTriggerOutput
>);
