import { Think, Workspace, defaultContextOverflowClassifier } from "@cloudflare/think";
import type {
  Session,
  StepContext,
  ThinkSubmissionInspection,
  ThinkSubmissionStatus,
  ToolCallContext,
  ToolCallResultContext,
  TurnConfig,
  TurnContext,
} from "@cloudflare/think";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { createExtensionTools } from "@cloudflare/think/tools/extensions";
import { createWorkspaceTools } from "@cloudflare/think/tools/workspace";
import { createWorkspaceStateBackend } from "@cloudflare/shell";
import type { FileInfo } from "@cloudflare/shell";
import type { ToolProvider } from "@cloudflare/codemode";
import { GitHubMcpConnector } from "#/backend/nanites/github-mcp-connector.ts";
import { ToolProviderConnector } from "#/backend/nanites/tool-provider-connector.ts";
import { getLogger } from "@logtape/logtape";
import { callable } from "agents";
import { hasToolCall, tool, type LanguageModel, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import { AppError, describeError, parseOptionalAppIsoDate } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { createDbClient } from "#/backend/db/index.ts";
import {
  issueScopedGitHubInstallationToken,
  type GitHubAppPermissions,
} from "#/backend/github/index.ts";
import { gitToolsWithGitHubInstallationAuth } from "#/backend/nanites/git-auth.ts";
import { deriveNaniteGitHubMcpAccess } from "#/backend/nanites/github-mcp-capabilities.ts";
import {
  NaniteToolOutputArtifactStore,
  naniteToolOutputArtifactReadInputSchema,
  wrapToolSetForNaniteOutputBudget,
} from "#/backend/nanites/tool-output.ts";
import {
  createNaniteRunLanguageModel,
  createSigveloAgentLanguageModel,
  NANITES_AI_GATEWAY_ID,
} from "#/backend/nanites/language-model.ts";
import type {
  CompleteNaniteRunInput,
  ManagedNanite,
  NaniteAgentFeedback,
  NaniteManifest,
  NaniteRunModelSnapshot,
  NaniteRunRecord,
  NaniteRunStatus,
  NaniteRuntimeActivityState,
  NaniteScheduledEventSourceSpec,
  NaniteScheduleWhen,
  NaniteTriggerEvent,
  RecordNaniteRuntimeActivityInput,
  SigveloNaniteManager,
  StartNaniteRunInput,
} from "#/backend/agents/SigveloNaniteManager.ts";
import { getDispatchIntents, runGeneratedTrigger } from "#/backend/nanites/triggers.ts";
import { getGitHubWebhookRepositoryFullName, getGitHubWebhookRepositoryId } from "#/github.ts";
import { parseNaniteManagerKey } from "#/nanites.ts";
import {
  buildNaniteAiGatewayMetadata,
  naniteTriggerActor,
  recordAiUsageFact,
  recordAuditEvent,
  resolveNaniteBillingAttribution,
  systemActor,
} from "#/backend/observability/recorders.ts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Bump whenever the persisted state shape changes incompatibly. Everything in
 * this state is run-scoped bookkeeping mirrored from the manager, so a reset
 * on version mismatch is safe.
 */
const NANITE_AGENT_STATE_VERSION = 3;

export type NaniteChatErrorRecord = {
  runId: string | null;
  error: string;
  occurredAt: string;
};

export type NaniteAgentState = {
  version: number;
  naniteId: string | null;
  managerName: string | null;
  manifest: NaniteManifest | null;
  activeRunId: string | null;
  activeRunModel: NaniteRunModelSnapshot | null;
  trigger: NaniteTriggerEvent | null;
  /** Last observed model/tool activity, read by the lifecycle watchdog. */
  lastActivityAt: string | null;
  /**
   * Last chat/stream error, kept durable so the eventual unreported-completion
   * summary can name the real cause (facet console logs do not reliably reach
   * Workers Logs).
   */
  lastChatError: NaniteChatErrorRecord | null;
  lifecycleContinuationAttempted: boolean;
  interruptedRetryCount: number;
  watchdogScheduleId: string | null;
  updatedAt: string | null;
};

function createInitialNaniteAgentState(): NaniteAgentState {
  return {
    version: NANITE_AGENT_STATE_VERSION,
    naniteId: null,
    managerName: null,
    manifest: null,
    activeRunId: null,
    activeRunModel: null,
    trigger: null,
    lastActivityAt: null,
    lastChatError: null,
    lifecycleContinuationAttempted: false,
    interruptedRetryCount: 0,
    watchdogScheduleId: null,
    updatedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Public IO types
// ---------------------------------------------------------------------------

export type StartNaniteAgentInput = {
  managerName: string;
  nanite: ManagedNanite;
  run: NaniteRunRecord;
};

export type NaniteWorkspaceInfo = {
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  r2FileCount: number;
  repositoryRoot: string | null;
};

export type NaniteWorkspaceExploreInput =
  | {
      action: "info";
    }
  | {
      action: "list";
      path: string;
      limit: number;
    }
  | {
      action: "read";
      path: string;
      maxBytes: number;
    }
  | {
      action: "search";
      path: string;
      query: string;
      limit: number;
      maxFileBytes: number;
    };

export type NaniteWorkspaceExploreOutput =
  | {
      action: "info";
      info: NaniteWorkspaceInfo;
    }
  | {
      action: "list";
      path: string;
      entries: FileInfo[];
    }
  | {
      action: "read";
      path: string;
      content: string | null;
      truncated: boolean;
    }
  | {
      action: "search";
      path: string;
      query: string;
      matches: Array<{ path: string; line: number; text: string }>;
      truncated: boolean;
    };

export type NaniteTranscriptInspectInput = {
  limit?: number;
  query?: string;
  roles?: string[];
  includeParts?: boolean;
  maxTextLength?: number;
  maxPartLength?: number;
};

export type NaniteSubmissionsInspectInput = {
  limit?: number;
  status?: ThinkSubmissionStatus | ThinkSubmissionStatus[];
};

export type NaniteDebugInspectInput = {
  transcript?: NaniteTranscriptInspectInput | false;
  submissions?: NaniteSubmissionsInspectInput | false;
};

export type NaniteDebugInspectOutput = {
  transcript?: unknown[];
  submissions?: ThinkSubmissionInspection[];
  /** Internal onStart steps that failed on this wake; empty when boot was clean. */
  onStartDegradations?: { step: string; error: string }[];
};

export type NaniteDebugResetOutput = {
  clearedMessages: boolean;
  deletedSubmissions: number;
};

export type NaniteAgentMaintenanceInput = {
  managerName: string;
  nanite: ManagedNanite;
  completedBeforeIso?: string;
  submissionDeleteLimit?: number;
};

export type NaniteAgentMaintenanceOutput = {
  activeRunId: string | null;
  reconciledActiveSubmission: boolean;
  deletedSubmissions: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const naniteMaxSteps = 200;
const naniteLifecycleTools = ["complete", "no_change", "fail", "ask_human"] as const;
const naniteLifecycleContinuationSuffix = "lifecycle-continuation";
const naniteWatchdogDelaySeconds = 180;
const naniteWatchdogIdleMs = naniteWatchdogDelaySeconds * 1000;
const naniteWatchdogStabilityTimeoutMs = 1_000;
const naniteInterruptedSubmissionError = "Submission was interrupted after messages were applied.";
const naniteInterruptedSubmissionMaxRetries = 1;
const naniteDebugPartMaxLength = 12_000;
const naniteToolOutputBudgetExcludedTools = new Set([
  "complete",
  "no_change",
  "fail",
  "ask_human",
  "create_child_nanite",
  "artifact_read",
]);
const terminalSubmissionStatuses = new Set<ThinkSubmissionStatus>([
  "completed",
  "aborted",
  "skipped",
  "error",
]);
const naniteLogger = getLogger(LOGGING.NANITES_CATEGORY);

const NANITE_WORKSPACE_MEASURE_ENTRY_LIMIT = 50_000;
const NANITE_NON_REPOSITORY_DIRECTORIES = new Set([
  "bin",
  "dev",
  "etc",
  "lib",
  "proc",
  "root",
  "sbin",
  "sys",
  "tmp",
  "usr",
  "var",
]);

const agentFeedbackSchema: z.ZodType<NaniteAgentFeedback> = z.object({
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  suggestions: z.array(z.string().min(1)).optional(),
});

const aiGatewayLogDetailSchema = z
  .object({
    id: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    tokens_in: z.number().finite().optional(),
    tokens_out: z.number().finite().optional(),
    cost: z.number().finite().optional(),
    cached: z.boolean().optional(),
    duration: z.number().finite().optional(),
    success: z.boolean().optional(),
    status_code: z.number().int().optional(),
  })
  .passthrough();
type AiGatewayLogDetail = z.output<typeof aiGatewayLogDetailSchema>;
const metadataRecordSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalSubmissionStatus(
  status: ThinkSubmissionStatus,
): status is "completed" | "aborted" | "skipped" | "error" {
  return terminalSubmissionStatuses.has(status);
}

function isLifecycleTerminalStatus(status: NaniteRunStatus): boolean {
  return (
    status === "complete" || status === "no_change" || status === "fail" || status === "canceled"
  );
}

function createUserMessage(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function buildLifecycleContinuationSubmissionId(runId: string): string {
  return `${runId}:${naniteLifecycleContinuationSuffix}`;
}

function getActivityStateAfterTool(toolName: string): NaniteRuntimeActivityState {
  switch (toolName) {
    case "complete":
    case "no_change":
    case "fail":
      return "idle";
    case "ask_human":
      return "waiting_for_human";
    default:
      return "thinking";
  }
}

function getUsageNumber(
  usage: StepContext["usage"],
  field: "inputTokens" | "outputTokens" | "totalTokens",
): number | null {
  const value = usage[field];
  return typeof value === "number" ? value : null;
}

function usageWithGatewayTokens(
  usage: StepContext["usage"],
  log: AiGatewayLogDetail | null,
): StepContext["usage"] {
  const inputTokens = log?.tokens_in ?? usage.inputTokens;
  const outputTokens = log?.tokens_out ?? usage.outputTokens;
  const totalTokens =
    typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : usage.totalTokens;

  return { ...usage, inputTokens, outputTokens, totalTokens };
}

function providerMetadataWithGatewayLog(
  providerMetadata: unknown,
  log: AiGatewayLogDetail | null,
): unknown {
  if (!log) {
    return providerMetadata;
  }

  const metadata = metadataRecordSchema.safeParse(providerMetadata).data ?? {};
  const gatewayMetadata = metadataRecordSchema.safeParse(metadata.gateway).data ?? {};

  return {
    ...metadata,
    gateway: {
      ...gatewayMetadata,
      logId: log.id,
      cached: log.cached,
      durationMs: log.duration,
      success: log.success,
      statusCode: log.status_code,
      costUsd: log.cost,
    },
  };
}

function getRunRepository(run: NaniteRunRecord): {
  githubRepositoryId: number | null;
  repository: string | null;
} {
  if (run.trigger.type !== "github") {
    return { githubRepositoryId: null, repository: null };
  }

  return {
    githubRepositoryId: getGitHubWebhookRepositoryId(run.trigger.event),
    repository: getGitHubWebhookRepositoryFullName(run.trigger.event),
  };
}

function getTextFromModelMessage(message: TurnContext["messages"][number]): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .flatMap((part) => ("text" in part && typeof part.text === "string" ? [part.text] : []))
      .join("");
  }

  return "";
}

/**
 * Submissions can queue, so the turn currently running is not necessarily the
 * most recently accepted run. The run prompt's first line is the durable
 * marker that maps a turn back to its run.
 */
function getRunIdFromTurn(ctx: TurnContext): string | null {
  for (const message of [...ctx.messages].reverse()) {
    if (message.role !== "user") {
      continue;
    }

    const match = getTextFromModelMessage(message).match(
      /^Start Nanite work attempt (?<runId>[0-9a-f-]{36})\./m,
    );
    if (match?.groups?.runId) {
      return match.groups.runId;
    }
  }

  return null;
}

function textFromMessage(message: UIMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function trimText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function summarizeDebugPart(part: unknown, maxLength: number): unknown {
  const serialized = JSON.stringify(part);
  if (!serialized || serialized.length <= maxLength) {
    return part;
  }

  const partType =
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    typeof (part as { type?: unknown }).type === "string"
      ? (part as { type: string }).type
      : "unknown";
  const headLength = Math.floor(maxLength * 0.7);
  const tailLength = Math.max(maxLength - headLength - 160, 0);
  const preview = [
    serialized.slice(0, headLength),
    `\n\n[SigVelo debug truncated ${serialized.length - headLength - tailLength} characters from this message part.]\n\n`,
    tailLength > 0 ? serialized.slice(-tailLength) : "",
  ].join("");

  return {
    type: partType,
    sigveloDebug: {
      truncated: true,
      originalChars: serialized.length,
      previewChars: preview.length,
      message: "This transcript part was too large to return inline through the debug MCP tool.",
    },
    preview,
  };
}

function inspectTranscript(
  messages: UIMessage[],
  input: NaniteTranscriptInspectInput = {},
): unknown[] {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 200);
  const query = input.query?.trim().toLowerCase();
  const roles = input.roles ? new Set(input.roles) : null;
  const maxTextLength = Math.min(Math.max(input.maxTextLength ?? 4_000, 200), 40_000);
  const filtered = messages.filter((message) => {
    if (roles && !roles.has(message.role)) {
      return false;
    }
    return !query || textFromMessage(message).toLowerCase().includes(query);
  });

  return filtered.slice(-limit).map((message) => {
    if (input.includeParts) {
      const maxPartLength = Math.min(
        Math.max(input.maxPartLength ?? naniteDebugPartMaxLength, 1_000),
        40_000,
      );
      return {
        ...message,
        parts: message.parts.map((part) => summarizeDebugPart(part, maxPartLength)),
      };
    }

    return {
      id: message.id,
      role: message.role,
      text: trimText(textFromMessage(message), maxTextLength),
      partTypes: message.parts.map((part) => part.type),
    };
  });
}

function resolveCloudflareScheduleWhen(when: NaniteScheduleWhen): Date | string | number {
  if (typeof when === "number") {
    return when;
  }

  const date = new Date(when);
  return Number.isNaN(date.getTime()) ? when : date;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function formatTrigger(trigger: NaniteTriggerEvent): string {
  return JSON.stringify(trigger, null, 2);
}

function formatPromptList(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- none declared";
}

function formatGitHubAppPermissions(permissions: GitHubAppPermissions | undefined): string {
  const entries = Object.entries(permissions ?? {});
  return entries.length > 0
    ? entries.map(([permission, access]) => `- ${permission}: ${access}`).join("\n")
    : "- none declared";
}

function buildNaniteTaskContext(input: {
  manifest: NaniteManifest | null;
  trigger: NaniteTriggerEvent | null;
}): string {
  const manifestContext = input.manifest
    ? [
        `Nanite id: ${input.manifest.id}`,
        `Name: ${input.manifest.name}`,
        `Description: ${input.manifest.description}`,
        "",
        "Repository scope from permissions.github.repositories:",
        formatPromptList(input.manifest.permissions.github?.repositories ?? []),
        "",
        "GitHub app permissions from permissions.github.appPermissions:",
        formatGitHubAppPermissions(input.manifest.permissions.github?.appPermissions),
        "",
        "Event source from manifest.eventSource:",
        JSON.stringify(input.manifest.eventSource, null, 2),
        "",
        "Generated trigger source from manifest.triggerSource:",
        input.manifest.triggerSource?.trim() || "none declared",
        "",
        "Full Nanite manifest JSON:",
        JSON.stringify(input.manifest, null, 2),
        "",
        "Use this manifest as the authority for scope, trigger behavior, and permission grants.",
        "Operate only inside the declared repository and permission scope. If the task needs another repository, permission, or event source, use ask_human or fail with the missing config.",
      ].join("\n")
    : "No Nanite manifest has been attached yet.";

  return [
    "Nanite task context",
    "",
    manifestContext,
    "",
    "Active run trigger payload:",
    input.trigger ? formatTrigger(input.trigger) : "No active run trigger has been attached yet.",
  ].join("\n");
}

function getTriggerTestInstruction(trigger: NaniteTriggerEvent): string | null {
  if (trigger.type !== "github") {
    return null;
  }

  const instruction = trigger.input?.sigveloTestInstruction;
  return typeof instruction === "string" && instruction.trim() ? instruction.trim() : null;
}

const naniteGitSafetyInstructions = [
  "Before committing or pushing, verify the current branch, upstream branch, remote default branch, and latest remote head for the branch you plan to update.",
  "If a push is rejected, fetch the remote branch and reconcile with rebase or merge before pushing again. Do not assume GitHub or the git tool is stale.",
] as const;

function buildRunPrompt(input: StartNaniteAgentInput): string {
  const manualMessage =
    input.run.trigger.type === "manual" && input.run.trigger.message
      ? `\n\nManual operator message:\n${input.run.trigger.message}`
      : "";
  const testInstruction = getTriggerTestInstruction(input.run.trigger);
  const testInstructionMessage = testInstruction
    ? `\n\nTrigger acceptance test instruction:\n${testInstruction}`
    : "";

  return [
    `Start Nanite work attempt ${input.run.runId}.`,
    "",
    `Nanite id: ${input.nanite.manifest.id}`,
    `Nanite name: ${input.nanite.manifest.name}`,
    `Description: ${input.nanite.manifest.description}`,
    "",
    "Trigger payload:",
    formatTrigger(input.run.trigger),
    manualMessage,
    testInstructionMessage,
    "",
    "First classify the task's execution plane: GitHub API/MCP, workspace files/git, trigger/routing, or human/product decision.",
    "Do not hydrate or repair workspace git for API-only tasks. Use workspace checkout only when local file inspection or file edits are needed.",
    "Use the workspace, git, MCP, and code execution tools as needed for the chosen execution plane.",
    "Use Workspace read/list/grep/find for repository file review. Use execute with state.* and git.* for coordinated filesystem and git work.",
    "For GitHub triggers that require repository inspection or edits, hydrate the durable workspace idempotently: if no matching .git/config exists, clone the trigger repository once into an explicit safe directory; otherwise fetch or pull the relevant branch/ref instead of cloning again.",
    "The execute tool runs Worker-compatible JavaScript, not a Node.js shell: do not use require(), child_process, or subprocess commands. Use state.* and git.* inside execute instead.",
    "Do not use GitHub MCP to read repository files, list commits, or list branches; reserve GitHub MCP for pull requests, metadata, comments, checks, and workflow status.",
    "Use Workspace git tools for repository changes and branch pushes.",
    "Use GitHub MCP for GitHub API tasks: finding existing PRs, creating PRs, updating PR metadata, reading PR details, and reading check or workflow status.",
    "Do not use GitHub MCP file-write tools unless this Nanite was explicitly granted them. Do not merge pull requests unless this Nanite was explicitly granted merge authority.",
    "For GitHub changes, manage branches and pull requests yourself with git, gh, or Octokit instead of expecting SigVelo to publish a support lane for you.",
    "Reuse an existing open PR when that is the coherent review surface for your responsibility.",
    "When stacked PRs are useful: the bottom branch targets the repo default branch, each higher branch targets the branch below it, every PR stays small and independently reviewable, and every PR description includes stack ordering.",
    "Use gh stack only when it is available. Otherwise use plain git branches and gh pr create --base <previous-branch>.",
    "Never push directly to a default branch.",
    ...naniteGitSafetyInstructions,
    "When you call complete, set outputUrl to the most useful result URL: the primary PR, top PR, stack entrypoint, or another explicit output URL. If no URL exists, make the summary self-contained.",
    "If you hit roadblocks immediately or repeat materially similar failures, assume the Nanite may be misconfigured. Stop debugging and call ask_human or fail with the clearest blocker.",
    "When the attempt reaches a terminal outcome, call exactly one lifecycle tool: complete, no_change, fail, or ask_human.",
  ].join("\n");
}

function buildNaniteSystemPrompt(): string {
  return [
    "You are a SigVelo Nanite: a durable maintenance agent for one narrow responsibility inside a GitHub installation.",
    "Your transcript, workspace, and memory are durable. Keep durable memory compact and evidence-backed.",
    "Use nanite_task_context for the current manifest, repository scope, permission grants, generated trigger source, and active trigger payload.",
    "Use the smallest execution plane that can satisfy the run: github.* tools inside execute for pull requests, checks, comments, and metadata; Workspace for repository files, edits, and git; generated trigger context for event routing; ask_human for missing authority or product decisions.",
    "Do not use github.* tools to inspect repository files, commits, or branches. Use Workspace read/list/grep/find and execute git tools so file evidence stays in the durable workspace.",
    "The execute tool runs Worker-compatible JavaScript with state.*, git.*, and (when GitHub permissions are granted) github.* providers. Discover github.* methods with codemode.search/codemode.describe. It is not a shell and cannot use require(), child_process, or subprocess commands.",
    "Use artifact_read for saved SigVelo tool-output artifacts such as toolout_...; do not look for those artifacts in the workspace.",
    "Keep GitHub-facing output concise. Keep detailed investigation in this transcript.",
    "",
    "Do not claim success without evidence. If authority, configuration, approval, or target scope is missing, use ask_human. If the target state is impossible or a deterministic tool/API error repeats, use fail.",
    "Finish exactly once with complete, no_change, fail, or ask_human.",
  ].join("\n");
}

function buildLifecycleContinuationPrompt(): string {
  return [
    "You stopped without reporting the Nanite run outcome.",
    "Use the transcript evidence already available and call exactly one lifecycle tool now: complete, no_change, fail, or ask_human.",
    "Do not investigate further unless a lifecycle tool requires the final summary or human request details.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

type ScheduledTriggerPayload = {
  eventSource: NaniteScheduledEventSourceSpec;
};

type LifecycleWatchdogPayload = {
  runId: string;
};

type LastStepDiagnostic = {
  runId: string | null;
  stepNumber: number;
  finishReason: string;
  rawFinishReason: string | null;
  toolCallCount: number;
  toolResultCount: number;
};

/**
 * The methods this agent calls on its parent manager. The concrete DO stub
 * type expands the manager's full RPC graph and trips TS2589, so the cast is
 * confined to `parentManager()`.
 */
type ParentManagerRpc = {
  getSnapshot: SigveloNaniteManager["getSnapshot"];
  startRun: (input: StartNaniteRunInput) => Promise<NaniteRunRecord>;
  dispatchRun: SigveloNaniteManager["dispatchRun"];
  completeRun: SigveloNaniteManager["completeRun"];
  askHuman: SigveloNaniteManager["askHuman"];
  recordUnreportedRunCompletion: SigveloNaniteManager["recordUnreportedRunCompletion"];
  recordRuntimeActivity: (input: RecordNaniteRuntimeActivityInput) => Promise<unknown>;
};

export class SigveloNaniteAgent extends Think<Env, NaniteAgentState> {
  initialState: NaniteAgentState = createInitialNaniteAgentState();
  extensionLoader = this.env.LOADER;
  override maxSteps = naniteMaxSteps;
  override chatRecovery = { noProgressTimeoutMs: 10 * 60 * 1000 };
  override classifyChatError = defaultContextOverflowClassifier;
  override contextOverflow = { reactive: true, maxRetries: 2 };
  // Never externalize evicted transcript media into the workspace: repos are
  // cloned at the workspace root, so a written /attachments directory would
  // collide with (and git-shadow) a repo's own files. Drop the bytes instead.
  override mediaEviction = { externalizeToWorkspace: false };
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.WORKSPACE_FILES,
    namespace: "nanite",
    name: () => this.name,
  });

  private lastStepDiagnostic: LastStepDiagnostic | null = null;
  private currentTurnContinuation = false;

  override async onStart(): Promise<void> {
    if (this.state.version !== NANITE_AGENT_STATE_VERSION) {
      this.setState(createInitialNaniteAgentState());
    }
  }

  override getModel(): LanguageModel {
    return createSigveloAgentLanguageModel({
      env: this.env,
      sessionAffinity: this.state.activeRunId ?? this.name,
    });
  }

  override getSystemPrompt(): string {
    return buildNaniteSystemPrompt();
  }

  override configureSession(session: Session): Session {
    return session
      .withContext("nanite_identity", {
        description: "Stable SigVelo Nanite identity, tool routing rules, and lifecycle rules.",
        maxTokens: 4000,
        provider: {
          get: async () => this.getSystemPrompt(),
        },
      })
      .withContext("nanite_task_context", {
        description:
          "Current Nanite manifest, repository scope, permission grants, generated trigger source, and active run trigger payload.",
        maxTokens: 20_000,
        provider: {
          get: async () =>
            buildNaniteTaskContext({
              manifest: this.state.manifest,
              trigger: this.state.trigger,
            }),
        },
      })
      .withContext("memory", {
        description:
          "Durable Nanite memory for stable facts, preferences, repo conventions, and lessons that should survive across Runs. Keep it compact and evidence-backed.",
        maxTokens: 2000,
      });
  }

  override getTools(): ToolSet {
    const workspaceTools = createWorkspaceTools(this.workspace);
    const artifactStore = this.createToolOutputArtifactStore();
    const githubMcpConnector = this.createGitHubMcpConnector();
    const extensionTools = this.extensionManager
      ? {
          ...createExtensionTools({ manager: this.extensionManager }),
          ...this.extensionManager.getTools(),
        }
      : {};

    return {
      ...workspaceTools,
      execute: createExecuteTool({
        ctx: this.ctx,
        tools: workspaceTools,
        state: createWorkspaceStateBackend(this.workspace),
        connectors: [
          new ToolProviderConnector(this.ctx, this.createGitToolProvider()),
          new ToolProviderConnector(this.ctx, artifactStore.provider()),
          ...(githubMcpConnector ? [githubMcpConnector] : []),
        ],
        loader: this.env.LOADER,
      }),
      ...extensionTools,
      artifact_read: tool({
        description:
          "Inspect saved SigVelo tool-output artifacts. With no args, lists current-run artifacts. With artifactId, reads a bounded slice. With pattern, grep-searches one artifact or all current-run artifacts.",
        inputSchema: naniteToolOutputArtifactReadInputSchema,
        execute: async (input) => artifactStore.readParsedToolInput(input),
      }),
      complete: tool({
        description:
          "Mark the active Nanite work attempt complete only after the requested outcome happened. Include the most useful output URL when one exists, such as the commit, branch, PR, or run result URL.",
        inputSchema: z.object({
          summary: z.string().min(1),
          outputUrl: z.string().url().nullable().optional(),
          agentFeedback: agentFeedbackSchema.optional(),
        }),
        execute: async ({ summary, outputUrl, agentFeedback }) =>
          this.finishRun({
            status: "complete",
            summary,
            outputUrl: outputUrl ?? null,
            agentFeedback: agentFeedback ?? null,
          }),
      }),
      no_change: tool({
        description:
          "Mark the active Nanite work attempt finished with no changes needed only when investigation proves no action is needed. This is not valid for imperative tasks such as pushing a commit unless the equivalent target state already exists.",
        inputSchema: z.object({
          summary: z.string().min(1),
          agentFeedback: agentFeedbackSchema.optional(),
        }),
        execute: async ({ summary, agentFeedback }) =>
          this.finishRun({
            status: "no_change",
            summary,
            outputUrl: null,
            agentFeedback: agentFeedback ?? null,
          }),
      }),
      fail: tool({
        description:
          "Mark the active Nanite work attempt failed when the target state is impossible, the requested API/tool path is unavailable, a deterministic tool/API error repeats, or the task cannot be completed within the granted permissions. After two materially similar failures, stop debugging and use fail or ask_human.",
        inputSchema: z.object({
          summary: z.string().min(1),
          agentFeedback: agentFeedbackSchema.optional(),
        }),
        execute: async ({ summary, agentFeedback }) =>
          this.finishRun({
            status: "fail",
            summary,
            outputUrl: null,
            agentFeedback: agentFeedback ?? null,
          }),
      }),
      ask_human: tool({
        description:
          "Pause the active Nanite work attempt and ask a human for a decision, permission, approval, access, ambiguous target branch/repo clarification, branch protection/policy choice, or destructive/risky action confirmation. After two materially similar failures, stop debugging and use ask_human or fail.",
        inputSchema: z.object({
          summary: z.string().min(1),
          requestedScopes: z.array(z.string().min(1)).default([]),
        }),
        execute: async ({ summary, requestedScopes }) => {
          const run = await this.parentManager().askHuman({
            runId: this.getActiveRunId(),
            summary,
            requestedScopes,
          });
          await this.clearWatchdog();
          return {
            accepted: true,
            status: run.status,
            summary: run.summary,
            requestedScopes: run.humanRequest.requestedScopes,
          };
        },
      }),
      create_child_nanite: tool({
        description:
          "Record a proposed child Nanite. The manager may create it after policy validation.",
        inputSchema: z.object({
          name: z.string().min(1),
          description: z.string().min(1),
          reason: z.string().min(1),
        }),
        execute: async ({ name, description, reason }) => ({
          recorded: true,
          name,
          description,
          reason,
          message:
            "Child Nanite creation is manager-governed. This proposal is now visible in the transcript.",
        }),
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Turn lifecycle
  // -------------------------------------------------------------------------

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    this.currentTurnContinuation = ctx.continuation;
    await this.refreshManifestFromManager();

    const runId = getRunIdFromTurn(ctx) ?? this.state.activeRunId;
    if (runId && runId !== this.state.activeRunId) {
      const run = await this.readRun(runId);
      this.setState({
        ...this.state,
        activeRunId: runId,
        activeRunModel: run?.model ?? this.state.activeRunModel,
        updatedAt: nowIso(),
      });
    }

    this.touchActivity();
    await this.reportRuntimeActivity("thinking");
    naniteLogger.debug(LOG_EVENTS.NANITE_TURN_STARTED, {
      ...this.logContext(),
      continuation: ctx.continuation,
      messageCount: ctx.messages.length,
      toolCount: Object.keys(ctx.tools).length,
      maxSteps: this.maxSteps,
    });

    return {
      maxSteps: this.maxSteps,
      model: await this.getTurnModel(runId),
      sendReasoning: true,
      tools: this.wrapTurnToolsForOutputBudget(ctx.tools),
      stopWhen: naniteLifecycleTools.map((toolName) => hasToolCall(toolName)),
      // AI Gateway owns upstream-provider retries (NANITES_AI_GATEWAY_REQUEST_DEFAULTS); cap the
      // AI SDK's own retry so the two layers don't compound into ~10 attempts. 1 still covers a
      // transient worker→gateway transport blip.
      maxRetries: 1,
    };
  }

  override async beforeToolCall(ctx: ToolCallContext): Promise<void> {
    this.touchActivity();
    await this.reportRuntimeActivity("tool_calling", { toolName: ctx.toolName });
  }

  override async afterToolCall(ctx: ToolCallResultContext): Promise<void> {
    this.touchActivity();
    await this.reportRuntimeActivity(getActivityStateAfterTool(ctx.toolName), {
      toolName: ctx.toolName,
      error: ctx.success ? null : describeError(ctx.error),
    });

    const logProperties = {
      ...this.logContext(),
      [OTEL_ATTRS.NANITE_TOOL_NAME]: ctx.toolName,
      toolCallId: ctx.toolCallId,
      stepNumber: ctx.stepNumber,
      durationMs: ctx.durationMs,
      success: ctx.success,
    };
    if (ctx.success) {
      naniteLogger.debug(LOG_EVENTS.NANITE_TOOL_CALL_FINISHED, logProperties);
    } else {
      naniteLogger.error(LOG_EVENTS.NANITE_TOOL_CALL_FINISHED, {
        ...logProperties,
        error: describeError(ctx.error),
      });
    }
  }

  override onStepFinish(ctx: StepContext): void {
    this.touchActivity();
    this.lastStepDiagnostic = {
      runId: this.state.activeRunId,
      stepNumber: ctx.stepNumber,
      finishReason: ctx.finishReason,
      rawFinishReason: ctx.rawFinishReason ?? null,
      toolCallCount: ctx.toolCalls.length,
      toolResultCount: ctx.toolResults.length,
    };

    naniteLogger.debug(LOG_EVENTS.NANITE_STEP_FINISHED, {
      ...this.logContext(),
      stepNumber: ctx.stepNumber,
      finishReason: ctx.finishReason,
      rawFinishReason: ctx.rawFinishReason ?? undefined,
      toolCallCount: ctx.toolCalls.length,
      toolResultCount: ctx.toolResults.length,
      inputTokens: getUsageNumber(ctx.usage, "inputTokens") ?? undefined,
      outputTokens: getUsageNumber(ctx.usage, "outputTokens") ?? undefined,
      totalTokens: getUsageNumber(ctx.usage, "totalTokens") ?? undefined,
      maxSteps: this.maxSteps,
    });
    this.ctx.waitUntil(
      this.recordStepUsage(ctx).catch((error: unknown) => {
        naniteLogger.warn(LOG_EVENTS.OBSERVABILITY_FACT_RECORD_FAILED, {
          ...this.logContext(),
          operation: "ai_usage.step",
          error: describeError(error),
        });
      }),
    );
  }

  override onChatError(error: unknown): unknown {
    const described = describeError(error);
    this.setState({
      ...this.state,
      lastChatError: {
        runId: this.state.activeRunId,
        error: described,
        occurredAt: nowIso(),
      },
      updatedAt: nowIso(),
    });
    this.ctx.waitUntil(this.reportRuntimeActivity("error", { error: described }));
    this.ctx.waitUntil(
      this.recordChatErrorAuditEvent(described).catch((recordError: unknown) => {
        naniteLogger.warn(LOG_EVENTS.OBSERVABILITY_FACT_RECORD_FAILED, {
          ...this.logContext(),
          operation: "run.chat_error.audit",
          error: describeError(recordError),
        });
      }),
    );
    naniteLogger.error(LOG_EVENTS.NANITE_CHAT_ERROR, {
      ...this.logContext(),
      error: described,
    });
    return error;
  }

  /**
   * Chat errors are persisted to the audit table because they otherwise leave
   * no durable trace: the run terminalizes later through the watchdog or
   * submission status with a generic summary, and facet console logs are
   * unreliable in production.
   */
  private async recordChatErrorAuditEvent(error: string): Promise<void> {
    const identity = parseNaniteManagerKey(this.requireManagerName());
    if (!identity) {
      return;
    }

    const runId = this.state.activeRunId;
    await recordAuditEvent(createDbClient(this.env.DB), {
      eventName: "audit.run.chat_error",
      githubAppId: identity.githubAppId,
      githubInstallationId: identity.githubInstallationId,
      naniteId: this.state.naniteId,
      runKey: runId,
      actor: this.state.trigger
        ? naniteTriggerActor(this.state.trigger)
        : systemActor("maintenance"),
      targetType: "run",
      targetId: runId,
      outcome: "failure",
      metadata: { error },
    });
  }

  // -------------------------------------------------------------------------
  // Run intake from the manager
  // -------------------------------------------------------------------------

  async enqueueFromManager(input: StartNaniteAgentInput): Promise<void> {
    const acceptedAt = nowIso();
    this.setState({
      version: NANITE_AGENT_STATE_VERSION,
      naniteId: input.nanite.manifest.id,
      managerName: input.managerName,
      manifest: input.nanite.manifest,
      activeRunId: input.run.runId,
      activeRunModel: input.run.model,
      trigger: input.run.trigger,
      lastActivityAt: acceptedAt,
      lastChatError: null,
      lifecycleContinuationAttempted: false,
      interruptedRetryCount: 0,
      watchdogScheduleId: this.state.watchdogScheduleId,
      updatedAt: acceptedAt,
    });
    await this.armWatchdog(input.run.runId);
    naniteLogger.info(LOG_EVENTS.NANITE_AGENT_RUN_ACCEPTED, {
      ...this.logContext(input.run.runId),
      [OTEL_ATTRS.NANITE_RUN_KEY]: input.run.triggerKey,
      [OTEL_ATTRS.NANITE_RUN_STATUS]: input.run.status,
      versionId: input.run.model.manifestVersionId,
    });

    await this.submitMessages([createUserMessage(buildRunPrompt(input))], {
      submissionId: input.run.runId,
      idempotencyKey: input.run.triggerKey,
      metadata: {
        managerName: input.managerName,
        naniteId: input.nanite.manifest.id,
        runId: input.run.runId,
      },
    });
    naniteLogger.info(LOG_EVENTS.NANITE_AGENT_RUN_SUBMITTED, {
      ...this.logContext(input.run.runId),
      [OTEL_ATTRS.NANITE_RUN_KEY]: input.run.triggerKey,
      [OTEL_ATTRS.NANITE_SUBMISSION_ID]: input.run.runId,
    });
  }

  async cancelRunFromManager(input: { runId: string; reason: string }): Promise<void> {
    await this.cancelRunSubmissions(input.runId, input.reason);
    if (this.state.activeRunId === input.runId) {
      await this.clearWatchdog();
      this.setState({
        ...this.state,
        activeRunId: null,
        activeRunModel: null,
        updatedAt: nowIso(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Scheduled triggers
  // -------------------------------------------------------------------------

  async syncScheduleFromManager(input: {
    managerName: string;
    nanite: ManagedNanite;
  }): Promise<void> {
    this.syncIdentityFromManager(input);

    const schedules = await this.listSchedules();
    await Promise.all(
      schedules
        .filter((schedule) => schedule.callback === "handleScheduledTrigger")
        .map((schedule) => this.cancelSchedule(schedule.id)),
    );

    const eventSource = input.nanite.manifest.eventSource;
    if (
      !input.nanite.enabled ||
      (eventSource.type !== "schedule" && eventSource.type !== "scheduleEvery")
    ) {
      return;
    }

    const payload: ScheduledTriggerPayload = { eventSource };
    if (eventSource.type === "schedule") {
      await this.schedule(
        resolveCloudflareScheduleWhen(eventSource.when),
        "handleScheduledTrigger",
        payload,
        { idempotent: true },
      );
    } else {
      await this.scheduleEvery(eventSource.intervalSeconds, "handleScheduledTrigger", payload);
    }
  }

  async handleScheduledTrigger(payload: ScheduledTriggerPayload): Promise<void> {
    await this.refreshManifestFromManager();
    const manifest = this.state.manifest;
    if (
      !manifest ||
      (manifest.eventSource.type !== "schedule" && manifest.eventSource.type !== "scheduleEvery") ||
      typeof manifest.triggerSource !== "string"
    ) {
      return;
    }

    const scheduledAt = nowIso();
    const manager = this.parentManager();
    const trigger: Extract<NaniteTriggerEvent, { type: "schedule" }> = {
      type: "schedule",
      eventSource: payload.eventSource,
      scheduledAt,
    };

    const triggerResult = await runGeneratedTrigger({
      loader: this.env.LOADER,
      sourceCode: manifest.triggerSource,
      cacheKey: `${this.requireManagerName()}:${manifest.id}:schedule`,
      event: {
        type: "schedule.tick",
        naniteId: manifest.id,
        eventSource: payload.eventSource,
        scheduledAt,
      },
    });
    if (!triggerResult.ok) {
      const run = await manager.startRun({
        naniteId: manifest.id,
        trigger: {
          ...trigger,
          input: { triggerError: `Trigger failed before model dispatch: ${triggerResult.error}` },
        },
      });
      await manager.recordUnreportedRunCompletion({
        runId: run.runId,
        status: "error",
        error: `Trigger failed before model dispatch: ${triggerResult.error}`,
      });
      return;
    }

    const dispatch = getDispatchIntents(triggerResult.intents)[0];
    if (!dispatch) {
      return;
    }

    const run = await manager.startRun({
      naniteId: manifest.id,
      trigger: { ...trigger, input: dispatch.input },
    });
    await manager.dispatchRun({ runId: run.runId });
  }

  // -------------------------------------------------------------------------
  // Lifecycle watchdog
  // -------------------------------------------------------------------------

  async checkLifecycleWatchdog(payload: LifecycleWatchdogPayload): Promise<void> {
    if (this.state.activeRunId !== payload.runId) {
      return;
    }

    const run = await this.readRun(payload.runId);
    if (
      !run ||
      run.naniteId !== this.state.naniteId ||
      isLifecycleTerminalStatus(run.status) ||
      run.status === "waiting_for_human"
    ) {
      await this.clearWatchdog();
      return;
    }

    const lastActivityMs = this.state.lastActivityAt
      ? new Date(this.state.lastActivityAt).getTime()
      : 0;
    if (Date.now() - lastActivityMs < naniteWatchdogIdleMs) {
      await this.armWatchdog(payload.runId);
      return;
    }

    const stable = await this.waitUntilStable({ timeout: naniteWatchdogStabilityTimeoutMs });
    if (!stable) {
      await this.armWatchdog(payload.runId);
      return;
    }

    if (!this.state.lifecycleContinuationAttempted) {
      await this.submitLifecycleContinuation(payload.runId);
      await this.armWatchdog(payload.runId);
      return;
    }

    await this.parentManager().recordUnreportedRunCompletion({
      runId: payload.runId,
      status: "error",
      error: [
        "Nanite lifecycle watchdog found the run stable without a lifecycle outcome after a lifecycle continuation was already attempted.",
        this.chatErrorSummaryLine(payload.runId),
      ]
        .filter((line): line is string => Boolean(line))
        .join(" "),
    });
    await this.clearWatchdog();
    this.setState({
      ...this.state,
      activeRunId: null,
      activeRunModel: null,
      updatedAt: nowIso(),
    });
  }

  private async armWatchdog(runId: string): Promise<void> {
    const current = this.state.watchdogScheduleId;
    if (current) {
      await this.cancelSchedule(current);
    }

    const schedule = await this.schedule(naniteWatchdogDelaySeconds, "checkLifecycleWatchdog", {
      runId,
    } satisfies LifecycleWatchdogPayload);
    this.setState({
      ...this.state,
      watchdogScheduleId: schedule.id,
      updatedAt: nowIso(),
    });
  }

  private async clearWatchdog(): Promise<void> {
    const current = this.state.watchdogScheduleId;
    if (!current) {
      return;
    }

    await this.cancelSchedule(current);
    this.setState({
      ...this.state,
      watchdogScheduleId: null,
      updatedAt: nowIso(),
    });
  }

  /** Cheap durable activity marker — read by the watchdog instead of re-arming alarms. */
  private touchActivity(): void {
    this.setState({
      ...this.state,
      lastActivityAt: nowIso(),
    });
  }

  // -------------------------------------------------------------------------
  // Submission outcomes
  // -------------------------------------------------------------------------

  protected override async onSubmissionStatus(
    submission: ThinkSubmissionInspection,
  ): Promise<void> {
    if (!isTerminalSubmissionStatus(submission.status)) {
      return;
    }

    const runId = this.resolveSubmissionRunId(submission);
    if (!runId) {
      return;
    }

    const run = await this.readRun(runId);
    if (!run || run.naniteId !== this.state.naniteId) {
      return;
    }

    const diagnostic = this.lastStepDiagnostic;
    const logProperties = {
      ...this.logContext(runId),
      [OTEL_ATTRS.NANITE_SUBMISSION_ID]: submission.submissionId,
      status: submission.status,
      error: submission.error,
      lastStepNumber: diagnostic?.runId === runId ? diagnostic.stepNumber : undefined,
      lastFinishReason: diagnostic?.runId === runId ? diagnostic.finishReason : undefined,
      maxSteps: this.maxSteps,
    };
    if (submission.status === "error") {
      naniteLogger.error(LOG_EVENTS.NANITE_SUBMISSION_STATUS, logProperties);
    } else {
      naniteLogger.info(LOG_EVENTS.NANITE_SUBMISSION_STATUS, logProperties);
    }

    if (isLifecycleTerminalStatus(run.status) || run.status === "waiting_for_human") {
      // The run already reported through a lifecycle tool; nothing to repair.
      if (isLifecycleTerminalStatus(run.status) && this.state.activeRunId === runId) {
        await this.clearWatchdog();
        this.setState({
          ...this.state,
          activeRunId: null,
          activeRunModel: null,
          updatedAt: nowIso(),
        });
      }
      return;
    }

    // The submission ended but the run never reported a lifecycle outcome.
    if (
      submission.status === "error" &&
      submission.error === naniteInterruptedSubmissionError &&
      (await this.retryInterruptedSubmission(run))
    ) {
      return;
    }

    if (
      submission.status === "completed" &&
      submission.metadata?.lifecycleContinuation !== true &&
      !this.state.lifecycleContinuationAttempted &&
      (await this.submitLifecycleContinuation(runId))
    ) {
      return;
    }

    await this.parentManager().recordUnreportedRunCompletion({
      runId,
      status: submission.status,
      error: this.buildNoLifecycleSummary(runId, submission, diagnostic),
    });
    await this.clearWatchdog();
    this.setState({
      ...this.state,
      activeRunId: this.state.activeRunId === runId ? null : this.state.activeRunId,
      activeRunModel: this.state.activeRunId === runId ? null : this.state.activeRunModel,
      updatedAt: nowIso(),
    });
  }

  private resolveSubmissionRunId(submission: ThinkSubmissionInspection): string | null {
    const metadataRunId =
      typeof submission.metadata?.runId === "string" ? submission.metadata.runId : null;
    if (metadataRunId) {
      return metadataRunId;
    }

    return this.state.activeRunId === submission.submissionId ? this.state.activeRunId : null;
  }

  private buildNoLifecycleSummary(
    runId: string,
    submission: ThinkSubmissionInspection,
    diagnostic: LastStepDiagnostic | null,
  ): string {
    return [
      "The Think turn completed before the Nanite reported a lifecycle outcome.",
      `Submission status: ${submission.status}.`,
      `Lifecycle continuation attempted: ${this.state.lifecycleContinuationAttempted ? "yes" : "no"}.`,
      submission.error ? `Submission error: ${submission.error}.` : null,
      diagnostic
        ? `Last step: ${diagnostic.stepNumber}; finishReason=${diagnostic.finishReason}; rawFinishReason=${diagnostic.rawFinishReason ?? "none"}; toolCallCount=${diagnostic.toolCallCount}; toolResultCount=${diagnostic.toolResultCount}.`
        : "Last step: unavailable.",
      this.chatErrorSummaryLine(runId),
    ]
      .filter((line): line is string => Boolean(line))
      .join(" ");
  }

  private chatErrorSummaryLine(runId: string): string | null {
    const chatError = this.state.lastChatError;
    if (!chatError || (chatError.runId !== null && chatError.runId !== runId)) {
      return null;
    }
    return `Last chat error: ${chatError.error} (at ${chatError.occurredAt}).`;
  }

  private async retryInterruptedSubmission(run: NaniteRunRecord): Promise<boolean> {
    if (this.state.interruptedRetryCount >= naniteInterruptedSubmissionMaxRetries) {
      return false;
    }

    const nanite = (await this.parentManager().getSnapshot()).nanites[run.naniteId];
    if (!nanite) {
      return false;
    }

    const retryAttempt = this.state.interruptedRetryCount + 1;
    const managerName = this.requireManagerName();
    this.setState({
      ...this.state,
      activeRunId: run.runId,
      activeRunModel: run.model,
      interruptedRetryCount: retryAttempt,
      lastActivityAt: nowIso(),
      updatedAt: nowIso(),
    });

    await this.reportRuntimeActivity("thinking");
    await this.submitMessages(
      [
        createUserMessage(
          [
            buildRunPrompt({ managerName, nanite, run }),
            "",
            `Automatic retry ${retryAttempt}/${naniteInterruptedSubmissionMaxRetries}: the previous Think submission was interrupted before a lifecycle outcome.`,
          ].join("\n"),
        ),
      ],
      {
        submissionId: `${run.runId}:retry:${retryAttempt}`,
        idempotencyKey: `${run.triggerKey}:retry:${retryAttempt}`,
        metadata: {
          managerName,
          naniteId: nanite.manifest.id,
          runId: run.runId,
          retryAttempt,
        },
      },
    );
    naniteLogger.warn(LOG_EVENTS.NANITE_SUBMISSION_STATUS, {
      ...this.logContext(run.runId),
      [OTEL_ATTRS.NANITE_SUBMISSION_ID]: `${run.runId}:retry:${retryAttempt}`,
      status: "retrying",
      error: naniteInterruptedSubmissionError,
      retryAttempt,
      maxRetries: naniteInterruptedSubmissionMaxRetries,
    });
    return true;
  }

  private async submitLifecycleContinuation(runId: string): Promise<boolean> {
    const run = await this.readRun(runId);
    if (!run || run.naniteId !== this.state.naniteId || run.status !== "running") {
      return false;
    }

    this.setState({
      ...this.state,
      lifecycleContinuationAttempted: true,
      lastActivityAt: nowIso(),
      updatedAt: nowIso(),
    });

    const submissionId = buildLifecycleContinuationSubmissionId(run.runId);
    const result = await this.submitMessages(
      [createUserMessage(buildLifecycleContinuationPrompt())],
      {
        submissionId,
        idempotencyKey: `${run.triggerKey}:${naniteLifecycleContinuationSuffix}`,
        metadata: {
          managerName: this.requireManagerName(),
          naniteId: run.naniteId,
          runId: run.runId,
          lifecycleContinuation: true,
        },
      },
    );

    naniteLogger.warn(LOG_EVENTS.NANITE_SUBMISSION_STATUS, {
      ...this.logContext(runId),
      [OTEL_ATTRS.NANITE_SUBMISSION_ID]: submissionId,
      status: result.accepted
        ? "lifecycle_continuation_submitted"
        : "lifecycle_continuation_exists",
    });
    return true;
  }

  private async cancelRunSubmissions(runId: string, reason: string): Promise<void> {
    await Promise.all([
      this.cancelSubmission(runId, reason),
      this.cancelSubmission(buildLifecycleContinuationSubmissionId(runId), reason),
      ...Array.from({ length: naniteInterruptedSubmissionMaxRetries }, (_, index) =>
        this.cancelSubmission(`${runId}:retry:${index + 1}`, reason),
      ),
    ]);
  }

  // -------------------------------------------------------------------------
  // Debug + maintenance
  // -------------------------------------------------------------------------

  async inspectDebug(input: NaniteDebugInspectInput = {}): Promise<NaniteDebugInspectOutput> {
    await this.reconcileActiveTerminalSubmission();

    const output: NaniteDebugInspectOutput = {};
    if (input.transcript !== false) {
      output.transcript = inspectTranscript(await this.getMessages(), input.transcript ?? {});
    }

    if (input.submissions !== false) {
      output.submissions = await this.listSubmissions({
        limit: Math.min(Math.max(input.submissions?.limit ?? 25, 1), 100),
        status: input.submissions?.status,
      });
    }

    output.onStartDegradations = this.getOnStartDegradations().map((degradation) => ({
      step: degradation.step,
      error: describeError(degradation.error),
    }));

    return output;
  }

  async resetDebugState(): Promise<NaniteDebugResetOutput> {
    await this.clearMessages();
    const deletedSubmissions = await this.deleteSubmissions({ limit: 500 });
    await this.clearWatchdog();
    this.setState({
      ...this.state,
      activeRunId: null,
      activeRunModel: null,
      lifecycleContinuationAttempted: false,
      interruptedRetryCount: 0,
      updatedAt: nowIso(),
    });

    return {
      clearedMessages: true,
      deletedSubmissions,
    };
  }

  async maintainFromManager(
    input: NaniteAgentMaintenanceInput,
  ): Promise<NaniteAgentMaintenanceOutput> {
    this.syncIdentityFromManager(input);
    const reconciledActiveSubmission = await this.reconcileActiveTerminalSubmission();
    const deletedSubmissions = await this.deleteSubmissions({
      completedBefore: parseOptionalAppIsoDate(input.completedBeforeIso, "completedBeforeIso"),
      limit: Math.min(Math.max(input.submissionDeleteLimit ?? 100, 1), 500),
    });

    return {
      activeRunId: this.state.activeRunId,
      reconciledActiveSubmission,
      deletedSubmissions,
    };
  }

  private async reconcileActiveTerminalSubmission(): Promise<boolean> {
    const activeRunId = this.state.activeRunId;
    if (!activeRunId) {
      return false;
    }

    const submissions = await this.listSubmissions({
      limit: 25,
      status: [...terminalSubmissionStatuses],
    });
    const submission = submissions.find(
      (candidate) => this.resolveSubmissionRunId(candidate) === activeRunId,
    );
    if (!submission) {
      return false;
    }

    await this.onSubmissionStatus(submission);
    return true;
  }

  // -------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------

  @callable()
  async getWorkspaceInfo(): Promise<NaniteWorkspaceInfo> {
    const info = await this.workspace.getWorkspaceInfo();
    const repositoryRoot = await this.findRepositoryRoot();
    return this.measureWorkspaceSubtree({ ...info, repositoryRoot });
  }

  @callable()
  async exploreWorkspace(
    input: NaniteWorkspaceExploreInput,
  ): Promise<NaniteWorkspaceExploreOutput> {
    switch (input.action) {
      case "info":
        return {
          action: "info",
          info: await this.getWorkspaceInfo(),
        };
      case "list":
        return {
          action: "list",
          path: input.path,
          entries: await this.workspace.readDir(input.path, {
            limit: input.limit,
          }),
        };
      case "read": {
        const content = await this.workspace.readFile(input.path);
        const truncated = content !== null && content.length > input.maxBytes;
        return {
          action: "read",
          path: input.path,
          content: truncated ? content.slice(0, input.maxBytes) : content,
          truncated,
        };
      }
      case "search":
        return this.searchWorkspace(input);
    }
  }

  private async searchWorkspace(
    input: Extract<NaniteWorkspaceExploreInput, { action: "search" }>,
  ): Promise<Extract<NaniteWorkspaceExploreOutput, { action: "search" }>> {
    const caseInsensitiveQuery = input.query.toLowerCase();
    const matches: Array<{ path: string; line: number; text: string }> = [];
    const directories = [input.path];

    while (directories.length > 0 && matches.length < input.limit) {
      const directory = directories.shift() ?? "/";
      for (const entry of await this.workspace.readDir(directory, { limit: 1_000 })) {
        if (entry.type === "directory") {
          directories.push(entry.path);
          continue;
        }

        if (entry.type !== "file" || entry.size > input.maxFileBytes) {
          continue;
        }

        const content = await this.workspace.readFile(entry.path);
        if (!content) {
          continue;
        }

        content.split("\n").some((line, index) => {
          if (!line.toLowerCase().includes(caseInsensitiveQuery)) {
            return false;
          }
          matches.push({
            path: entry.path,
            line: index + 1,
            text: trimText(line, 1_000),
          });
          return matches.length >= input.limit;
        });
      }
    }

    return {
      action: "search",
      path: input.path,
      query: input.query,
      matches,
      truncated: directories.length > 0 || matches.length >= input.limit,
    };
  }

  private async findRepositoryRoot(): Promise<string | null> {
    const topLevel = await this.workspace.readDir("/", { limit: 1_000 });
    for (const entry of topLevel) {
      if (entry.type !== "directory" || NANITE_NON_REPOSITORY_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const children = await this.workspace.readDir(entry.path, { limit: 1_000 });
      if (children.some((child) => child.name === ".git")) {
        return entry.path;
      }
    }
    return null;
  }

  private async measureWorkspaceSubtree(info: NaniteWorkspaceInfo): Promise<NaniteWorkspaceInfo> {
    const root = info.repositoryRoot;
    if (!root) {
      return info;
    }

    let fileCount = 0;
    let directoryCount = 0;
    let totalBytes = 0;
    let scanned = 0;
    const directories = [root];

    while (directories.length > 0 && scanned < NANITE_WORKSPACE_MEASURE_ENTRY_LIMIT) {
      const directory = directories.shift() ?? root;
      for (const entry of await this.workspace.readDir(directory, { limit: 1_000 })) {
        scanned += 1;
        if (entry.type === "directory") {
          directoryCount += 1;
          directories.push(entry.path);
        } else {
          fileCount += 1;
          totalBytes += entry.size ?? 0;
        }
        if (scanned >= NANITE_WORKSPACE_MEASURE_ENTRY_LIMIT) {
          break;
        }
      }
    }

    return {
      fileCount,
      directoryCount,
      totalBytes,
      r2FileCount: info.r2FileCount,
      repositoryRoot: root,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private parentManager(): ParentManagerRpc {
    return this.env.SigveloNaniteManager.getByName(
      this.requireManagerName(),
    ) as unknown as ParentManagerRpc;
  }

  private requireManagerName(): string {
    const managerName = this.state.managerName ?? this.parentPath.at(-1)?.name;
    if (!managerName) {
      throw new AppError("naniteAgentManagerRequired");
    }
    return managerName;
  }

  private getActiveRunId(): string {
    const runId = this.state.activeRunId;
    if (!runId) {
      throw new AppError("naniteAgentActiveRunRequired");
    }
    return runId;
  }

  private async readRun(runId: string | null): Promise<NaniteRunRecord | null> {
    if (!runId) {
      return null;
    }
    return (await this.parentManager().getSnapshot()).runs[runId] ?? null;
  }

  private syncIdentityFromManager(input: { managerName: string; nanite: ManagedNanite }): void {
    this.setState({
      ...this.state,
      naniteId: input.nanite.manifest.id,
      managerName: input.managerName,
      manifest: input.nanite.manifest,
      updatedAt: nowIso(),
    });
  }

  private async refreshManifestFromManager(): Promise<void> {
    const snapshot = await this.parentManager().getSnapshot();
    const manifest = snapshot.nanites[this.state.naniteId ?? this.name]?.manifest ?? null;
    if (!manifest || JSON.stringify(manifest) === JSON.stringify(this.state.manifest)) {
      return;
    }

    this.setState({
      ...this.state,
      naniteId: manifest.id,
      managerName: this.requireManagerName(),
      manifest,
      updatedAt: nowIso(),
    });
  }

  private async finishRun(input: {
    status: CompleteNaniteRunInput["status"];
    summary: string;
    outputUrl: string | null;
    agentFeedback: NaniteAgentFeedback | null;
  }): Promise<{
    accepted: true;
    status: NaniteRunStatus;
    summary: string;
    outputUrl: string | null;
  }> {
    const run = await this.parentManager().completeRun({
      runId: this.getActiveRunId(),
      ...input,
    });
    await this.clearWatchdog();

    return {
      accepted: true,
      status: run.status,
      summary: run.summary,
      outputUrl: run.outputUrl,
    };
  }

  private async reportRuntimeActivity(
    state: NaniteRuntimeActivityState,
    options: { toolName?: string | null; error?: string | null } = {},
  ): Promise<void> {
    const naniteId = this.state.naniteId;
    if (!naniteId) {
      return;
    }

    try {
      await this.parentManager().recordRuntimeActivity({
        naniteId,
        runId: this.state.activeRunId,
        state,
        toolName: options.toolName ?? null,
        error: options.error ?? null,
      });
    } catch (error) {
      naniteLogger.warn(LOG_EVENTS.NANITE_RUNTIME_ACTIVITY_RECORDED, {
        ...this.logContext(),
        error: `recordRuntimeActivity failed: ${describeError(error)}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Models + usage
  // -------------------------------------------------------------------------

  private async getTurnModel(runId: string | null): Promise<LanguageModel> {
    const run = await this.readRun(runId);
    const runModel = run?.model ?? this.state.activeRunModel;
    const modelId = runModel?.effectiveModelId ?? this.state.manifest?.model;
    if (!modelId) {
      throw new AppError("nanitesModelSelectionInvalid", {
        details: {
          reason: "Nanite turns require a resolved run model or a registered manifest model.",
          modelId: null,
        },
      });
    }

    return createNaniteRunLanguageModel({
      env: this.env,
      sessionAffinity: runId ?? this.name,
      gatewayMetadata: await this.buildTurnGatewayMetadata(run),
      modelId,
      gatewayId: runModel?.effectiveGatewayId ?? NANITES_AI_GATEWAY_ID,
    });
  }

  private async buildTurnGatewayMetadata(
    run: NaniteRunRecord | null,
  ): Promise<Record<string, string> | undefined> {
    try {
      const identity = parseNaniteManagerKey(this.requireManagerName());
      const naniteId = this.state.naniteId;
      if (!identity || !naniteId || !run) {
        return undefined;
      }

      const billing = await resolveNaniteBillingAttribution(createDbClient(this.env.DB), {
        githubInstallationId: identity.githubInstallationId,
        naniteId,
        actor: naniteTriggerActor(run.trigger),
      });

      return buildNaniteAiGatewayMetadata({
        githubInstallationId: identity.githubInstallationId,
        naniteId,
        runKey: run.runId,
        billingGithubUserId: billing.githubUserId,
        repository: getRunRepository(run).repository,
      });
    } catch (error) {
      naniteLogger.warn(LOG_EVENTS.OBSERVABILITY_FACT_RECORD_FAILED, {
        ...this.logContext(),
        operation: "ai_gateway.metadata",
        error: describeError(error),
      });
      return undefined;
    }
  }

  private async recordStepUsage(ctx: StepContext): Promise<void> {
    const identity = parseNaniteManagerKey(this.requireManagerName());
    const run = await this.readRun(this.state.activeRunId);
    if (!identity || !run) {
      return;
    }

    const repository = getRunRepository(run);
    const requestId = `${run.runId}:step:${ctx.stepNumber}:${ctx.response.id}`;
    const aiGatewayLogId = this.env.AI.aiGatewayLogId || undefined;
    const aiGatewayLog = await this.readAiGatewayLogDetail(
      aiGatewayLogId,
      run.model.effectiveGatewayId,
    );
    const actor = naniteTriggerActor(run.trigger);
    const db = createDbClient(this.env.DB);
    const billing = await resolveNaniteBillingAttribution(db, {
      githubInstallationId: identity.githubInstallationId,
      naniteId: run.naniteId,
      actor,
    });

    await recordAiUsageFact(db, {
      githubAppId: identity.githubAppId,
      githubInstallationId: identity.githubInstallationId,
      githubRepositoryId: repository.githubRepositoryId,
      naniteId: run.naniteId,
      runKey: run.runId,
      requestId,
      provider: aiGatewayLog?.provider ?? null,
      model: aiGatewayLog?.model ?? run.model.effectiveModelId,
      sessionAffinity: run.runId,
      isContinuation: this.currentTurnContinuation,
      stepCount: ctx.stepNumber + 1,
      finishReason: ctx.finishReason,
      usage: usageWithGatewayTokens(ctx.usage, aiGatewayLog),
      providerMetadata: providerMetadataWithGatewayLog(ctx.providerMetadata, aiGatewayLog),
      providerBilledTotalCostUsdMicros:
        aiGatewayLog?.cost === undefined ? undefined : Math.round(aiGatewayLog.cost * 1_000_000),
      aiGatewayId: run.model.effectiveGatewayId,
      aiGatewayLogId: aiGatewayLog?.id ?? aiGatewayLogId,
      aiGatewayEventId: requestId,
      actor,
      billing,
      startedAt: ctx.response.timestamp,
      completedAt: new Date(),
    });
  }

  private async readAiGatewayLogDetail(
    logId: string | undefined,
    gatewayId: string | null,
  ): Promise<AiGatewayLogDetail | null> {
    if (!gatewayId || !logId) {
      return null;
    }

    try {
      const result = aiGatewayLogDetailSchema.safeParse(
        await this.env.AI.gateway(gatewayId).getLog(logId),
      );
      return result.success ? result.data : null;
    } catch (error) {
      naniteLogger.warn(LOG_EVENTS.OBSERVABILITY_FACT_RECORD_FAILED, {
        ...this.logContext(),
        operation: "ai_gateway.get_log",
        aiGatewayLogId: logId,
        error: describeError(error),
      });
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // GitHub MCP + git auth
  // -------------------------------------------------------------------------

  /**
   * GitHub MCP tools live inside the codemode sandbox as `github.*` —
   * discoverable via codemode.search, zero prompt-token cost, and gated by
   * the same derived capability as before. Returns null when the manifest
   * grants no GitHub access, so the sandbox simply has no github namespace.
   */
  private createGitHubMcpConnector(): GitHubMcpConnector | null {
    const manifest = this.state.manifest;
    const githubPermissions = manifest?.permissions.github;
    const capability =
      githubPermissions && githubPermissions.repositories.length > 0
        ? deriveNaniteGitHubMcpAccess({ appPermissions: githubPermissions.appPermissions })
        : null;
    if (!githubPermissions || !capability) {
      return null;
    }

    return new GitHubMcpConnector(this.ctx, {
      createHeaders: async () => {
        const identity = parseNaniteManagerKey(this.requireManagerName());
        if (!identity) {
          throw new AppError("naniteAgentGithubMcpInstallationRequired");
        }

        const scopedToken = await issueScopedGitHubInstallationToken({
          env: this.env,
          githubAppId: identity.githubAppId,
          installationId: identity.githubInstallationId,
          repositories: githubPermissions.repositories,
          permissions: capability.appPermissions,
        });
        const headers: Record<string, string> = {
          Authorization: `Bearer ${scopedToken.token}`,
          "X-MCP-Tools": capability.tools.join(","),
          "X-MCP-Exclude-Tools": capability.deniedTools.join(","),
        };
        if (capability.readonly) {
          headers["X-MCP-Readonly"] = "true";
        }
        return headers;
      },
    });
  }

  private createGitToolProvider(): ToolProvider {
    return gitToolsWithGitHubInstallationAuth(this.workspace, {
      getAllowedRepositories: () => this.state.manifest?.permissions.github?.repositories ?? [],
      issueToken: () => this.issueGitToolToken(),
    });
  }

  private async issueGitToolToken(): Promise<string | null> {
    const identity = parseNaniteManagerKey(this.requireManagerName());
    const permissions = this.state.manifest?.permissions.github;
    if (!identity || !permissions || permissions.repositories.length === 0) {
      return null;
    }

    const scopedToken = await issueScopedGitHubInstallationToken({
      env: this.env,
      githubAppId: identity.githubAppId,
      installationId: identity.githubInstallationId,
      repositories: permissions.repositories,
      permissions: permissions.appPermissions ?? {},
    });
    return scopedToken.token;
  }

  private createToolOutputArtifactStore(): NaniteToolOutputArtifactStore {
    return new NaniteToolOutputArtifactStore({
      kv: this.env.TOOL_OUTPUTS,
      managerName: this.state.managerName,
      naniteId: this.state.naniteId,
      naniteName: this.name,
      runId: this.state.activeRunId,
    });
  }

  private wrapTurnToolsForOutputBudget(tools: ToolSet): ToolSet {
    const artifactStore = this.createToolOutputArtifactStore();
    return wrapToolSetForNaniteOutputBudget(tools, {
      excludedToolNames: naniteToolOutputBudgetExcludedTools,
      persistArtifact: (artifact) => artifactStore.persist(artifact),
      onTruncated: ({ toolName, toolCallId, artifactId, originalChars, returnedChars }) => {
        naniteLogger.warn(LOG_EVENTS.NANITE_TOOL_OUTPUT_TRUNCATED, {
          ...this.logContext(),
          [OTEL_ATTRS.NANITE_TOOL_NAME]: toolName,
          [OTEL_ATTRS.NANITE_TOOL_OUTPUT_ARTIFACT_ID]: artifactId,
          [OTEL_ATTRS.NANITE_TOOL_OUTPUT_ORIGINAL_CHARS]: originalChars,
          [OTEL_ATTRS.NANITE_TOOL_OUTPUT_RETURNED_CHARS]: returnedChars,
          toolCallId,
        });
      },
    });
  }

  private logContext(runId = this.state.activeRunId) {
    return {
      [OTEL_ATTRS.AGENT_CLASS]: "SigveloNaniteAgent",
      [OTEL_ATTRS.AGENT_NAME]: this.name,
      [OTEL_ATTRS.NANITE_ID]: this.state.naniteId ?? undefined,
      [OTEL_ATTRS.NANITE_MANAGER_NAME]: this.state.managerName ?? undefined,
      [OTEL_ATTRS.NANITE_RUN_ID]: runId ?? undefined,
    };
  }
}
