import { getAgentByName } from "agents";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { SigveloMcpAuthProps } from "#/backend/mcp/auth-context.ts";
import {
  createNaniteInputSchema,
  optionalNaniteManagerNameSchema,
  startNaniteRunToolInputSchema,
  testNaniteTriggerToolInputSchema,
  type CreateNaniteOutput,
  type StartNaniteManualRunOutput,
  type TestNaniteTriggerOutput,
} from "#/backend/orpc/contracts/nanites.ts";
import {
  type CancelNaniteRunsOutput,
  type DeprovisionNanitesOutput,
  type InspectNaniteDebugOutput,
  naniteDebugIncludeSections,
  naniteRunStatuses,
  naniteRuntimeActivityStates,
  type NaniteManager,
  type ResetNaniteDebugOutput,
} from "#/backend/nanites/host.ts";
import { buildNaniteManagerKey } from "#/shared/nanites.ts";

export type NaniteToolSurface = "mcp" | "manager_chat";

export type NaniteToolContext = {
  surface: NaniteToolSurface;
  actor: {
    kind: "github_user";
    githubUserId: SigveloMcpAuthProps["githubUserId"];
    githubLogin: SigveloMcpAuthProps["githubLogin"];
  };
  githubInstallationId: SigveloMcpAuthProps["githubInstallationId"];
  managerName: string;
  requestId: string;
};

export type NaniteManagerToolRuntime = Pick<
  NaniteManager,
  | "cancelRuns"
  | "deprovisionNanites"
  | "exploreNaniteWorkspace"
  | "inspectNaniteDebug"
  | "registerNanite"
  | "resetNaniteDebug"
  | "startNaniteManualRun"
  | "testNaniteTrigger"
>;

export type NaniteToolRuntime = {
  context: NaniteToolContext;
  manager: NaniteManagerToolRuntime;
};

export type NaniteTool<TInputSchema extends z.ZodType, TOutput> = {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: TInputSchema;
    annotations?: ToolAnnotations;
  };
  handler(input: z.output<TInputSchema>, runtime: NaniteToolRuntime): Promise<TOutput>;
};

export async function resolveAuthorizedNaniteToolRuntime(input: {
  env: Env;
  props: SigveloMcpAuthProps;
  surface: NaniteToolContext["surface"];
  managerName?: string;
  requestId?: string;
}): Promise<NaniteToolRuntime> {
  const managerName = buildNaniteManagerKey(input.props.githubInstallationId);
  if (input.managerName && input.managerName !== managerName) {
    throw new Error(`Unknown Nanite manager: ${input.managerName}`);
  }

  return {
    context: {
      surface: input.surface,
      actor: {
        kind: "github_user",
        githubUserId: input.props.githubUserId,
        githubLogin: input.props.githubLogin,
      },
      githubInstallationId: input.props.githubInstallationId,
      managerName,
      requestId: input.requestId ?? crypto.randomUUID(),
    },
    manager: await getAgentByName<Env, NaniteManager>(input.env.SigveloNaniteManager, managerName),
  };
}

const nonEmptyStringSchema = z.string().min(1);
const naniteRunStatusSchema = z.enum(naniteRunStatuses);
const naniteActivitySchema = z.enum(naniteRuntimeActivityStates);
const thinkSubmissionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "aborted",
  "skipped",
  "error",
]);

export const createNaniteToolInputSchema = createNaniteInputSchema.describe(
  "Create or update a stable Nanite through the authorized installation-scoped manager.",
);

export const createNaniteTool = {
  name: "sigvelo_create_nanite",
  config: {
    title: "Create or update a Sigvelo Nanite",
    description: "Registers a stable Nanite spec with the authorized installation-scoped manager.",
    inputSchema: createNaniteToolInputSchema,
  },
  async handler(input, { context, manager }) {
    const nanite = await manager.registerNanite({
      manifest: input.manifest,
      enabled: input.enabled,
    });

    return {
      managerName: context.managerName,
      naniteId: nanite.manifest.id,
      versionId: nanite.latestVersion.versionId,
      manifestHash: nanite.latestVersion.manifestHash,
    };
  },
} satisfies NaniteTool<typeof createNaniteToolInputSchema, CreateNaniteOutput>;

export const debugNanitesToolInputSchema = z
  .object({
    managerName: optionalNaniteManagerNameSchema,
    naniteId: nonEmptyStringSchema.optional(),
    runId: nonEmptyStringSchema.optional(),
    status: z.union([naniteRunStatusSchema, z.array(naniteRunStatusSchema)]).optional(),
    activity: z.union([naniteActivitySchema, z.array(naniteActivitySchema)]).optional(),
    limit: z.number().int().min(1).max(100).default(25),
    include: z
      .array(z.enum(naniteDebugIncludeSections))
      .default(["nanites", "runs", "runtimeActivity"]),
    transcript: z
      .object({
        limit: z.number().int().min(1).max(200).default(25),
        query: nonEmptyStringSchema.optional(),
        roles: z.array(nonEmptyStringSchema).optional(),
        includeParts: z.boolean().default(false),
        maxTextLength: z.number().int().min(200).max(40_000).default(4_000),
        maxPartLength: z.number().int().min(1_000).max(40_000).default(12_000),
      })
      .optional(),
    submissions: z
      .object({
        limit: z.number().int().min(1).max(100).default(25),
        status: z
          .union([thinkSubmissionStatusSchema, z.array(thinkSubmissionStatusSchema)])
          .optional(),
      })
      .optional(),
  })
  .describe("Inspect Nanite manager state plus optional child-owned Think transcript/submissions.");

export const debugNanitesTool = {
  name: "sigvelo_debug_nanites",
  config: {
    title: "Debug Sigvelo Nanites",
    description:
      "Inspects manager-owned Nanite state and, when requested, delegates to the child Think sub-agent for transcript and submission inspection.",
    inputSchema: debugNanitesToolInputSchema,
  },
  async handler(input, { manager }) {
    return manager.inspectNaniteDebug(input);
  },
} satisfies NaniteTool<typeof debugNanitesToolInputSchema, InspectNaniteDebugOutput>;

export const deprovisionNanitesToolInputSchema = z
  .object({
    managerName: optionalNaniteManagerNameSchema,
    naniteIds: z.array(nonEmptyStringSchema).min(1).max(100),
    reason: nonEmptyStringSchema,
  })
  .describe("Permanently deprovision registered Nanites and remove their run history.");

type DeprovisionNanitesToolOutput = DeprovisionNanitesOutput & {
  ok: true;
  managerName: string;
};

export const deprovisionNanitesTool = {
  name: "sigvelo_deprovision_nanites",
  config: {
    title: "Deprovision Sigvelo Nanites",
    description:
      "Permanently removes registered Nanites, deletes their child agents, clears runtime activity, and removes their run history.",
    inputSchema: deprovisionNanitesToolInputSchema,
  },
  async handler(input, { context, manager }) {
    return {
      ok: true,
      managerName: context.managerName,
      ...(await manager.deprovisionNanites({
        naniteIds: input.naniteIds,
        reason: input.reason,
      })),
    };
  },
} satisfies NaniteTool<typeof deprovisionNanitesToolInputSchema, DeprovisionNanitesToolOutput>;

export const startNaniteRunTool = {
  name: "sigvelo_start_nanite_run",
  config: {
    title: "Start a Sigvelo Nanite run",
    description:
      "Starts a direct manual run for one registered Nanite and dispatches it through the real Nanite manager path.",
    inputSchema: startNaniteRunToolInputSchema,
  },
  async handler(input, { context, manager }) {
    const { managerName: _managerName, ...startInput } = input;
    return manager.startNaniteManualRun({
      ...startInput,
      actorId: `github:${context.actor.githubUserId}`,
      manualRequestId: input.manualRequestId ?? context.requestId,
    });
  },
} satisfies NaniteTool<typeof startNaniteRunToolInputSchema, StartNaniteManualRunOutput>;

export const cancelNaniteRunsToolInputSchema = z
  .object({
    managerName: optionalNaniteManagerNameSchema,
    naniteId: nonEmptyStringSchema.optional(),
    runIds: z.array(nonEmptyStringSchema).min(1).max(100).optional(),
    olderThanIso: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(100).default(25),
    reason: nonEmptyStringSchema,
  })
  .describe("Cancel pending or running Nanite runs.");

type CancelNaniteRunsToolOutput = CancelNaniteRunsOutput & {
  ok: true;
  managerName: string;
  naniteId?: string;
};

export const cancelNaniteRunsTool = {
  name: "sigvelo_cancel_nanite_runs",
  config: {
    title: "Cancel Sigvelo Nanite runs",
    description: "Cancels pending or running Nanite runs through the manager cancellation path.",
    inputSchema: cancelNaniteRunsToolInputSchema,
  },
  async handler(input, { context, manager }) {
    return {
      ok: true,
      managerName: context.managerName,
      ...(input.naniteId ? { naniteId: input.naniteId } : {}),
      ...(await manager.cancelRuns({
        runIds: input.runIds,
        naniteId: input.naniteId,
        olderThanIso: input.olderThanIso,
        limit: input.limit,
        reason: input.reason,
      })),
    };
  },
} satisfies NaniteTool<typeof cancelNaniteRunsToolInputSchema, CancelNaniteRunsToolOutput>;

export const testNaniteTriggerTool = {
  name: "sigvelo_test_nanite_trigger",
  config: {
    title: "Test a Sigvelo Nanite trigger",
    description:
      "Builds a realistic fixture event, runs generated trigger code, dispatches accepted runs, and optionally waits for a terminal Nanite outcome.",
    inputSchema: testNaniteTriggerToolInputSchema,
  },
  async handler(input, { context, manager }) {
    const { managerName: _managerName, ...testInput } = input;
    return manager.testNaniteTrigger({
      ...testInput,
      actorId: `github:${context.actor.githubUserId}`,
      requestId: context.requestId,
    });
  },
} satisfies NaniteTool<typeof testNaniteTriggerToolInputSchema, TestNaniteTriggerOutput>;

export const exploreNaniteWorkspaceToolInputSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("info"),
      managerName: optionalNaniteManagerNameSchema,
      naniteId: nonEmptyStringSchema,
    }),
    z.object({
      action: z.literal("list"),
      managerName: optionalNaniteManagerNameSchema,
      naniteId: nonEmptyStringSchema,
      path: nonEmptyStringSchema.default("/"),
      limit: z.number().int().min(1).max(1_000).default(200),
    }),
    z.object({
      action: z.literal("read"),
      managerName: optionalNaniteManagerNameSchema,
      naniteId: nonEmptyStringSchema,
      path: nonEmptyStringSchema,
      maxBytes: z.number().int().min(1_000).max(1_000_000).default(100_000),
    }),
    z.object({
      action: z.literal("search"),
      managerName: optionalNaniteManagerNameSchema,
      naniteId: nonEmptyStringSchema,
      path: nonEmptyStringSchema.default("/"),
      query: nonEmptyStringSchema,
      limit: z.number().int().min(1).max(500).default(50),
      maxFileBytes: z.number().int().min(1_000).max(1_000_000).default(200_000),
    }),
  ])
  .describe("Explore a Nanite's child-owned Think workspace.");

type ExploreNaniteWorkspaceToolOutput = Awaited<
  ReturnType<NaniteManagerToolRuntime["exploreNaniteWorkspace"]>
>;

export const exploreNaniteWorkspaceTool = {
  name: "sigvelo_explore_nanite_workspace",
  config: {
    title: "Explore a Sigvelo Nanite workspace",
    description:
      "Reads child-owned Think workspace information, directory listings, file content, or text search results for one Nanite.",
    inputSchema: exploreNaniteWorkspaceToolInputSchema,
  },
  async handler(input, { manager }) {
    return manager.exploreNaniteWorkspace(input);
  },
} satisfies NaniteTool<
  typeof exploreNaniteWorkspaceToolInputSchema,
  ExploreNaniteWorkspaceToolOutput
>;

export const resetNaniteDebugToolInputSchema = z
  .object({
    managerName: optionalNaniteManagerNameSchema,
    naniteId: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
  })
  .describe("Reset child-owned Nanite debug state.");

type ResetNaniteDebugToolOutput = ResetNaniteDebugOutput & {
  ok: true;
  reason: string;
};

export const resetNaniteDebugTool = {
  name: "sigvelo_reset_nanite_debug",
  config: {
    title: "Reset Sigvelo Nanite debug state",
    description: "Clears child-owned Think messages and durable submissions for one Nanite.",
    inputSchema: resetNaniteDebugToolInputSchema,
  },
  async handler(input, { manager }) {
    return {
      ok: true,
      reason: input.reason,
      ...(await manager.resetNaniteDebug({ naniteId: input.naniteId })),
    };
  },
} satisfies NaniteTool<typeof resetNaniteDebugToolInputSchema, ResetNaniteDebugToolOutput>;

export const naniteTools = [
  createNaniteTool,
  debugNanitesTool,
  deprovisionNanitesTool,
  startNaniteRunTool,
  cancelNaniteRunsTool,
  testNaniteTriggerTool,
  exploreNaniteWorkspaceTool,
  resetNaniteDebugTool,
] as const;

export type NaniteToolName = (typeof naniteTools)[number]["name"];
