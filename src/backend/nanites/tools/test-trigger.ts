import { MCP_SCOPES } from "#/shared/constants.ts";
import { z } from "zod";
import {
  NANITE_TRIGGER_TEST_INSTRUCTION,
  NANITE_TRIGGER_TEST_TIMEOUT_MS,
  type TestNaniteTriggerOutput,
} from "#/backend/agents/SigveloNaniteManager.ts";
import {
  githubIssuesFixtureIds,
  githubPullRequestFixtureIds,
  type GitHubTriggerFixtureInput,
} from "#/backend/nanites/triggers.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";
import { resolveReferencedNaniteRepositoryFullNames } from "#/backend/nanites/tools/authorization.ts";

const githubTriggerFixtureOverridesSchema = z.record(z.string(), z.unknown()).optional();
const githubTriggerFixtureInputSchema = z.discriminatedUnion("fixture", [
  z.object({
    fixture: z.enum(githubPullRequestFixtureIds),
    overrides: githubTriggerFixtureOverridesSchema,
  }),
  z.object({
    fixture: z.enum(githubIssuesFixtureIds),
    overrides: githubTriggerFixtureOverridesSchema,
  }),
  z.object({ fixture: z.literal("push"), overrides: githubTriggerFixtureOverridesSchema }),
]) satisfies z.ZodType<GitHubTriggerFixtureInput>;

const testNaniteTriggerToolInputSchema = z.object({
  naniteId: nonEmptyStringSchema,
  event: githubTriggerFixtureInputSchema,
  testInstruction: nonEmptyStringSchema.default(NANITE_TRIGGER_TEST_INSTRUCTION),
  waitForTerminalOutcome: z.boolean().default(true),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(NANITE_TRIGGER_TEST_TIMEOUT_MS),
});

export const testNaniteTriggerTool = defineSigveloMcpTool({
  name: "sigvelo_test_nanite_trigger",
  title: "Test a SigVelo Nanite trigger",
  description:
    "Builds a realistic fixture event, runs generated trigger code, dispatches accepted runs, and optionally waits for a terminal Nanite outcome.",
  inputSchema: testNaniteTriggerToolInputSchema,
  outputSchema: createObjectOutputSchema("SigVelo Nanite trigger test result."),
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
