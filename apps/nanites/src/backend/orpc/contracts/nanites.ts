import { z } from "zod";
import {
  githubAppPermissionNames,
  githubPullRequestTriggerActions,
} from "#/backend/github-types.ts";
import { naniteCapabilitySpecSchema } from "#/backend/nanites/github-mcp-capabilities.ts";

export const NANITE_MANAGER_NAME_DESCRIPTION =
  "Authorized installation-scoped Nanite manager agent name. The Installation Manager is the broad control plane for the selected GitHub installation.";
export const NANITE_TRIGGER_TEST_TIMEOUT_MS = 60_000;
export const NANITE_MANUAL_RUN_TIMEOUT_MS = 60_000;
export const NANITE_TRIGGER_TEST_INSTRUCTION = [
  "This is a trigger acceptance test.",
  "Do not modify GitHub.",
  "Inspect the trigger payload and runtime context.",
  "If the trigger and context look correct, call complete with a short summary and agentFeedback for the authoring agent.",
].join(" ");

const nonEmptyStringSchema = z.string().trim().min(1);
export const naniteManagerNameSchema = nonEmptyStringSchema.describe(
  NANITE_MANAGER_NAME_DESCRIPTION,
);
export const optionalNaniteManagerNameSchema = naniteManagerNameSchema.optional();
const naniteRunActorIdSchema = nonEmptyStringSchema
  .describe("Actor id recorded on manager-created Nanite runs, such as github:123.")
  .nullable();

const naniteScheduleSpecSchema = z
  .union([
    z.object({
      type: z.literal("scheduled"),
      date: nonEmptyStringSchema.describe("ISO timestamp for a one-time scheduled trigger."),
    }),
    z.object({
      type: z.literal("delayed"),
      delayInSeconds: z.number().int().positive().describe("Delay in seconds."),
    }),
    z.object({
      type: z.literal("cron"),
      cron: nonEmptyStringSchema.describe("Cron expression for a recurring schedule."),
    }),
    z.object({
      type: z.literal("interval"),
      intervalSeconds: z.number().int().positive().describe("Recurring interval in seconds."),
    }),
  ])
  .describe(
    [
      'Schedule spec. Examples: { "type": "cron", "cron": "0 8 * * *" },',
      '{ "type": "interval", "intervalSeconds": 3600 },',
      '{ "type": "delayed", "delayInSeconds": 300 }, or',
      '{ "type": "scheduled", "date": "2026-05-24T15:00:00.000Z" }.',
    ].join(" "),
  );

export const naniteTriggerSpecSchema = z
  .union([
    z.object({
      type: z.literal("manual"),
    }),
    z.object({
      type: z.literal("schedule"),
      schedule: naniteScheduleSpecSchema.describe(
        'Schedule that can start the Nanite, such as { "type": "cron", "cron": "0 8 * * *" }.',
      ),
    }),
    z.object({
      type: z.literal("github"),
      event: z.literal("pull_request"),
      repositories: z
        .array(nonEmptyStringSchema)
        .min(1)
        .describe("GitHub repositories whose pull requests trigger the Nanite."),
      actions: z
        .array(z.enum(githubPullRequestTriggerActions))
        .min(1)
        .describe("Pull request webhook actions that trigger the Nanite."),
    }),
    z.object({
      type: z.literal("github"),
      event: z.literal("push"),
      repository: nonEmptyStringSchema.describe(
        "GitHub repository whose pushes trigger the Nanite.",
      ),
      branch: nonEmptyStringSchema.describe("Branch whose pushes trigger the Nanite."),
    }),
    z.object({
      type: z.literal("webhook"),
      source: nonEmptyStringSchema.describe("External webhook source name."),
    }),
  ])
  .describe(
    [
      'Trigger configuration for a registered Nanite. GitHub triggers always use type: "github";',
      'use event: "pull_request" with repositories/actions for PR webhooks,',
      'or event: "push" with repository/branch for push webhooks.',
      'Schedule triggers use type: "schedule" and',
      'schedule: { "type": "cron", "cron": "0 8 * * *" } or another schedule spec.',
    ].join(" "),
  );

export const nanitePermissionSpecSchema = z
  .object({
    github: z
      .object({
        repositories: z
          .array(nonEmptyStringSchema)
          .default([])
          .describe("GitHub repositories the Nanite may operate on."),
        appPermissions: z
          .partialRecord(z.enum(githubAppPermissionNames), z.enum(["read", "write"]))
          .default({})
          .describe(
            [
              "Optional extra GitHub App permissions requested by the constrained Nanite Capability.",
              "GitHub MCP capability tiers infer the Nanite runtime's minimum token permissions;",
              'declare extras only for non-MCP repository operations, such as contents: "write"',
              "for workspace file edits or branch pushes.",
            ].join(" "),
          ),
      })
      .optional(),
  })
  .default({})
  .describe("Declared GitHub capability boundary for a Nanite.");

export const createNaniteInputSchema = z
  .object({
    managerName: optionalNaniteManagerNameSchema,
    manifest: z.object({
      id: nonEmptyStringSchema.describe("Stable Nanite identifier within the manager."),
      name: nonEmptyStringSchema.describe("Human-facing Nanite name."),
      description: nonEmptyStringSchema.describe("Human-facing Nanite purpose."),
      trigger: naniteTriggerSpecSchema,
      inboundTrigger: z
        .object({
          sourceCode: nonEmptyStringSchema.describe(
            "TypeScript source for the Nanite's generated inbound trigger handler.",
          ),
        })
        .optional(),
      permissions: nanitePermissionSpecSchema,
      capabilities: naniteCapabilitySpecSchema.optional(),
    }),
    enabled: z.boolean().default(true).describe("Whether the registered Nanite can start runs."),
  })
  .describe("Create or update a stable Nanite.");

export const managerInputSchema = z
  .object({
    managerName: naniteManagerNameSchema,
  })
  .describe("Look up one authorized Nanite manager.");

export const agentFeedbackSchema = z
  .object({
    severity: z.enum(["info", "warning", "error"]),
    message: nonEmptyStringSchema.describe("Feedback from the Nanite to the authoring agent."),
    suggestions: z
      .array(nonEmptyStringSchema)
      .optional()
      .describe("Concrete suggestions for the authoring agent, if any."),
  })
  .describe("Structured feedback returned by a Nanite lifecycle tool.");

export const humanRequestOutputSchema = z
  .object({
    id: z.string().describe("Human request identifier."),
    summary: z.string().describe("Short summary of the decision or access requested from a human."),
    requestedScopes: z.array(z.string()).describe("Scopes requested by the Nanite."),
    createdAt: z.string().describe("Timestamp when the human request was created."),
    resolvedAt: z
      .string()
      .nullable()
      .describe("Timestamp when the human request was resolved, if any."),
  })
  .describe("Human checkpoint requested by a running Nanite.");

export const naniteRunOutputSchema = z
  .object({
    runId: z.string().describe("Manager-owned run identifier."),
    naniteId: z.string().describe("Registered Nanite identifier."),
    versionId: z.string().describe("Source version used for this run."),
    triggerKey: z.string().describe("Stable trigger dedupe key."),
    status: z
      .enum(["running", "waiting_for_human", "complete", "no_change", "fail", "canceled"])
      .describe("Current run lifecycle status."),
    summary: z.string().nullable().describe("Latest high-level run summary, if any."),
    outputUrl: z.string().nullable().describe("Published output URL, if the run produced one."),
    agentFeedback: agentFeedbackSchema
      .nullable()
      .describe("Structured Nanite-to-authoring-agent feedback, if the run provided it."),
    humanRequest: humanRequestOutputSchema.nullable(),
    chatUrl: z.string().describe("Sigvelo Nanite chat URL."),
    startedAt: z.string().describe("Timestamp when the run started."),
    updatedAt: z.string().describe("Timestamp when the run was last updated."),
    dispatchError: z
      .string()
      .nullable()
      .describe("Latest manager-to-Nanite dispatch error, if the run failed to start."),
    completedAt: z
      .string()
      .nullable()
      .describe("Timestamp when the run reached a terminal state, if any."),
  })
  .describe("Nanite run summary owned by the manager Agent.");

export const createNaniteOutputSchema = z
  .object({
    managerName: naniteManagerNameSchema,
    naniteId: z.string().describe("Registered Nanite identifier."),
    versionId: z.string().describe("Nanite manifest version now active for the Nanite."),
    manifestHash: z.string().describe("SHA-256 hash of the submitted Nanite manifest."),
  })
  .describe("Create/update result for a Nanite registration.");

export const managerStateOutputSchema = z
  .object({
    managerName: naniteManagerNameSchema,
    state: z.unknown().describe("Current manager Agent state."),
  })
  .describe("Nanite manager Agent state.");

const manualRunRequestSchema = z.object({
  naniteId: nonEmptyStringSchema.describe("Registered Nanite to run."),
  message: nonEmptyStringSchema.describe("Manual instruction sent to the Nanite."),
  manualRequestId: nonEmptyStringSchema
    .optional()
    .describe("Optional stable request id used for manual-run idempotency."),
  waitForTerminalOutcome: z
    .boolean()
    .default(false)
    .describe("Whether to wait for the Nanite to finish before returning."),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(NANITE_MANUAL_RUN_TIMEOUT_MS)
    .describe("Maximum time to wait for a terminal Nanite outcome."),
});

export const startNaniteManualRunInputSchema = manualRunRequestSchema
  .extend({
    actorId: naniteRunActorIdSchema,
  })
  .describe("Manager-owned direct manual run input.");

export const startNaniteRunToolInputSchema = manualRunRequestSchema
  .extend({
    managerName: optionalNaniteManagerNameSchema,
  })
  .describe("Start a direct manual run for one registered Nanite.");

export const startNaniteManualRunOutputSchema = z
  .object({
    ok: z.boolean(),
    managerName: naniteManagerNameSchema,
    naniteId: z.string(),
    runs: z.array(naniteRunOutputSchema.passthrough()),
  })
  .describe("Result of a manager-owned manual Nanite run.");

const testNaniteTriggerRequestSchema = z
  .object({
    naniteId: nonEmptyStringSchema.describe("Registered Nanite whose inbound trigger to test."),
    event: z
      .object({
        fixture: z
          .enum([
            "github.pull_request.opened",
            "github.pull_request.synchronize",
            "github.pull_request.reopened",
            "github.pull_request.closed",
            "github.push",
          ])
          .describe("GitHub webhook fixture to send through the Nanite trigger path."),
        overrides: z
          .record(z.string(), z.unknown())
          .default({})
          .describe("Partial payload override applied to the selected fixture."),
      })
      .describe("Fixture event used to test the Nanite trigger."),
    testInstruction: nonEmptyStringSchema
      .default(NANITE_TRIGGER_TEST_INSTRUCTION)
      .describe("Instruction injected into the real Nanite run created by this trigger test."),
    waitForTerminalOutcome: z
      .boolean()
      .default(true)
      .describe("Whether to wait for the Nanite to finish before returning."),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(NANITE_TRIGGER_TEST_TIMEOUT_MS)
      .describe("Maximum time to wait for a terminal Nanite outcome."),
  })
  .describe("End-to-end trigger acceptance test for a registered Nanite.");

export const testNaniteTriggerInputSchema = testNaniteTriggerRequestSchema
  .extend({
    actorId: naniteRunActorIdSchema,
    requestId: nonEmptyStringSchema
      .optional()
      .describe("Optional request id included in the synthetic webhook delivery id."),
  })
  .describe("Manager-owned trigger acceptance test input.");

export const testNaniteTriggerToolInputSchema = testNaniteTriggerRequestSchema
  .extend({
    managerName: optionalNaniteManagerNameSchema,
  })
  .describe("Tool input for an end-to-end trigger acceptance test.");

export const testNaniteTriggerOutputSchema = z
  .object({
    ok: z.boolean(),
    managerName: naniteManagerNameSchema,
    naniteId: z.string(),
    event: z.object({
      fixture: z.string(),
      deliveryId: z.string(),
      repository: z.string(),
      pullNumber: z.number().nullable(),
      action: z.string().nullable(),
      headSha: z.string().nullable(),
      branch: z.string().nullable(),
      afterSha: z.string().nullable(),
    }),
    acceptance: z.object({
      fixtureBuilt: z.boolean(),
      triggerAcceptedEvent: z.boolean(),
      runCreated: z.boolean(),
      modelDispatched: z.boolean(),
      terminalOutcomeReached: z.boolean(),
    }),
    runs: z.array(naniteRunOutputSchema),
    agentFeedback: agentFeedbackSchema.nullable(),
    error: z.string().nullable(),
  })
  .describe("Result of a Nanite trigger acceptance test.");

export type CreateNaniteInput = z.infer<typeof createNaniteInputSchema>;
export type ManagerInput = z.infer<typeof managerInputSchema>;
export type StartNaniteManualRunInput = z.input<typeof startNaniteManualRunInputSchema>;
export type StartNaniteManualRunOutput = z.output<typeof startNaniteManualRunOutputSchema>;
export type StartNaniteRunToolInput = z.output<typeof startNaniteRunToolInputSchema>;
export type TestNaniteTriggerInput = z.input<typeof testNaniteTriggerInputSchema>;
export type TestNaniteTriggerToolInput = z.output<typeof testNaniteTriggerToolInputSchema>;
export type HumanRequestOutput = z.infer<typeof humanRequestOutputSchema>;
export type NaniteRunOutput = z.infer<typeof naniteRunOutputSchema>;
export type CreateNaniteOutput = z.infer<typeof createNaniteOutputSchema>;
export type ManagerStateOutput = z.infer<typeof managerStateOutputSchema>;
export type TestNaniteTriggerOutput = z.infer<typeof testNaniteTriggerOutputSchema>;
