import { Think, Workspace, defaultContextOverflowClassifier } from "@cloudflare/think";
import type { Session, ThinkSubmissionInspection, ThinkSubmissionStatus } from "@cloudflare/think";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { createExtensionTools } from "@cloudflare/think/tools/extensions";
import { createWorkspaceTools } from "@cloudflare/think/tools/workspace";
import { createWorkspaceStateBackend } from "@cloudflare/shell";
import type { FileInfo } from "@cloudflare/shell";
import type { ToolProvider } from "@cloudflare/codemode";
import { getLogger } from "@logtape/logtape";
import {
  APP_ERRORS,
  AppError,
  describeError,
  describeErrorWithStack,
  parseOptionalAppIsoDate,
} from "#/backend/errors.ts";
import { LOG_EVENTS } from "#/backend/logging.ts";
import { LOGGING } from "#/backend/logging.ts";
import { OTEL_ATTRS } from "#/backend/logging.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { callable } from "agents";
import { hasToolCall, tool, type LanguageModel, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import type { GitHubAppPermissions } from "#/backend/github/index.ts";
import { issueScopedGitHubInstallationToken } from "#/backend/github/index.ts";
import { gitToolsWithGitHubInstallationAuth } from "#/backend/nanites/git-auth.ts";
import { deriveNaniteGitHubMcpAccess } from "#/backend/nanites/github-mcp-capabilities.ts";
import { NaniteToolOutputArtifactStore } from "#/backend/nanites/tool-output.ts";
import { wrapToolSetForNaniteOutputBudget } from "#/backend/nanites/tool-output.ts";
import {
  createNaniteRunLanguageModel,
  createSigveloAgentLanguageModel,
} from "#/backend/nanites/language-model.ts";
import type {
  AskHumanInput,
  CompleteNaniteRunInput,
  NaniteAgentFeedback,
  ManagedNanite,
  NaniteManifest,
  NaniteRuntimeActivityState,
  NaniteRunRecord,
  NaniteRunModelSnapshot,
  NaniteScheduledEventSourceSpec,
  NaniteScheduleWhen,
  NaniteTriggerEvent,
  SigveloNaniteManager,
} from "#/backend/agents/SigveloNaniteManager.ts";
import { getDispatchIntents, runGeneratedTrigger } from "#/backend/nanites/triggers.ts";
import { getGitHubWebhookRepositoryFullName, getGitHubWebhookRepositoryId } from "#/github.ts";
import {
  buildNaniteAiGatewayMetadata,
  naniteTriggerActor,
  recordAiUsageFact,
  resolveNaniteBillingAttribution,
} from "#/backend/observability/recorders.ts";
import type {
  ChatResponseResult,
  StepContext,
  ToolCallContext,
  ToolCallResultContext,
  TurnConfig,
  TurnContext,
} from "@cloudflare/think";

export type NaniteAgentState = {
  naniteId: string | null;
  managerName: string | null;
  activeRunId: string | null;
  activeRunModel: NaniteRunModelSnapshot | null;
  manifest: NaniteManifest | null;
  trigger: NaniteTriggerEvent | null;
  interruptedSubmissionRetriesByRun: Record<string, number>;
  lifecycleWatchdog: NaniteLifecycleWatchdog | null;
  summary: string | null;
  outputUrl: string | null;
  updatedAt: string | null;
};

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

const metadataRecordSchema = z.record(z.string(), z.unknown());

type AiGatewayLogDetail = z.output<typeof aiGatewayLogDetailSchema>;

export type NaniteLifecycleWatchdog = {
  runId: string;
  lastActivityAt: string;
  continuationAttempted: boolean;
  scheduleId: string | null;
};

export type NaniteWorkspaceInfo = {
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  r2FileCount: number;
  repositoryRoot: string | null;
};

export type StartNaniteAgentInput = {
  managerName: string;
  nanite: ManagedNanite;
  run: NaniteRunRecord;
};

type ScheduledTriggerPayload = {
  eventSource: NaniteScheduledEventSourceSpec;
};

type LifecycleWatchdogPayload = {
  runId: string;
  lastActivityAt: string;
};

function resolveCloudflareScheduleWhen(when: NaniteScheduleWhen): Date | string | number {
  if (typeof when === "number") {
    return when;
  }

  const date = new Date(when);
  return Number.isNaN(date.getTime()) ? when : date;
}

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

export type NaniteWorkspaceExploreInput =
  | {
      action: "info";
    }
  | {
      action: "list";
      path?: string;
      limit?: number;
    }
  | {
      action: "read";
      path: string;
      maxBytes?: number;
    }
  | {
      action: "search";
      path?: string;
      query: string;
      limit?: number;
      maxFileBytes?: number;
    };

export type NaniteDebugInspectOutput = {
  transcript?: unknown[];
  submissions?: ThinkSubmissionInspection[];
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

const terminalSubmissionStatuses = new Set<ThinkSubmissionStatus>([
  "completed",
  "aborted",
  "skipped",
  "error",
]);
const naniteMaxSteps = 200;
const naniteLifecycleWatchdogDelaySeconds = 180;
const naniteLifecycleWatchdogStabilityTimeoutMs = 1_000;
const naniteLifecycleTools = ["complete", "no_change", "fail", "ask_human"] as const;
const naniteLifecycleContinuationSuffix = "lifecycle-continuation";
const naniteLifecycleWatchdogCallback = "checkLifecycleWatchdog";
const naniteToolOutputBudgetExcludedTools = new Set([
  "complete",
  "no_change",
  "fail",
  "ask_human",
  "create_child_nanite",
  "artifact_read",
]);
const naniteDebugPartMaxLength = 12_000;
const naniteInterruptedSubmissionError = "Submission was interrupted after messages were applied.";
const naniteInterruptedSubmissionMaxRetries = 1;
const githubMcpServerName = "github";
const githubMcpServerUrl = "https://api.githubcopilot.com/mcp/";
const naniteLogger = getLogger(LOGGING.NANITES_CATEGORY);

function buildLifecycleContinuationSubmissionId(runId: string): string {
  return `${runId}:${naniteLifecycleContinuationSuffix}`;
}

function resolveLifecycleResponseRunId(requestId: string): string {
  const continuationSuffix = `:${naniteLifecycleContinuationSuffix}`;
  return requestId.endsWith(continuationSuffix)
    ? requestId.slice(0, -continuationSuffix.length)
    : requestId;
}

const agentFeedbackSchema: z.ZodType<NaniteAgentFeedback> = z.object({
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  suggestions: z.array(z.string().min(1)).optional(),
});

type LastStepDiagnostic = {
  runId: string | null;
  stepNumber: number;
  finishReason: string;
  rawFinishReason: string | null;
  toolCallCount: number;
  toolResultCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

function isTerminalSubmissionStatus(
  status: ThinkSubmissionStatus,
): status is "completed" | "aborted" | "skipped" | "error" {
  return terminalSubmissionStatuses.has(status);
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampSubmissionDeleteLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 100, 1), 500);
}

function getUsageNumber(
  usage: StepContext["usage"],
  field: "inputTokens" | "outputTokens" | "totalTokens",
): number | null {
  const value = usage[field];
  return typeof value === "number" ? value : null;
}

function gatewayCostUsdMicros(log: AiGatewayLogDetail | null): number | undefined {
  const costUsd = log?.cost;
  return costUsd === undefined ? undefined : Math.round(costUsd * 1_000_000);
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

function createRunLogContext(agent: SigveloNaniteAgent, runId = agent.state.activeRunId) {
  return {
    [OTEL_ATTRS.AGENT_CLASS]: "SigveloNaniteAgent",
    [OTEL_ATTRS.AGENT_NAME]: agent.name,
    [OTEL_ATTRS.NANITE_ID]: agent.state.naniteId ?? undefined,
    [OTEL_ATTRS.NANITE_MANAGER_NAME]: agent.state.managerName ?? undefined,
    [OTEL_ATTRS.NANITE_RUN_ID]: runId ?? undefined,
  };
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

export function inspectTranscript(
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
    if (!query) {
      return true;
    }
    return textFromMessage(message).toLowerCase().includes(query);
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

function workspaceRootPath(path: string | undefined): string {
  return path?.trim() || "/";
}

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

function createInitialNaniteAgentState(): NaniteAgentState {
  return {
    naniteId: null,
    managerName: null,
    activeRunId: null,
    activeRunModel: null,
    manifest: null,
    trigger: null,
    interruptedSubmissionRetriesByRun: {},
    lifecycleWatchdog: null,
    summary: null,
    outputUrl: null,
    updatedAt: null,
  };
}

function setStateWithoutProtocolBroadcast(
  agent: SigveloNaniteAgent,
  state: NaniteAgentState,
): void {
  const broadcastControl = agent as unknown as { _suppressProtocolBroadcasts?: boolean };
  const previous = broadcastControl._suppressProtocolBroadcasts;
  broadcastControl._suppressProtocolBroadcasts = true;
  try {
    agent.setState(state);
  } finally {
    broadcastControl._suppressProtocolBroadcasts = previous;
  }
}

function createUserMessage(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

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

function buildNaniteManifestTaskContext(manifest: NaniteManifest | null): string {
  if (!manifest) {
    return "No Nanite manifest has been attached yet.";
  }

  return [
    `Nanite id: ${manifest.id}`,
    `Name: ${manifest.name}`,
    `Description: ${manifest.description}`,
    "",
    "Repository scope from permissions.github.repositories:",
    formatPromptList(manifest.permissions.github?.repositories ?? []),
    "",
    "GitHub app permissions from permissions.github.appPermissions:",
    formatGitHubAppPermissions(manifest.permissions.github?.appPermissions),
    "",
    "Event source from manifest.eventSource:",
    JSON.stringify(manifest.eventSource, null, 2),
    "",
    "Generated trigger source from manifest.triggerSource:",
    manifest.triggerSource?.trim() || "none declared",
    "",
    "Full Nanite manifest JSON:",
    JSON.stringify(manifest, null, 2),
    "",
    "Use this manifest as the authority for scope, trigger behavior, and permission grants.",
    "Operate only inside the declared repository and permission scope. If the task needs another repository, permission, or event source, use ask_human or fail with the missing config.",
  ].join("\n");
}

export function buildNaniteTaskContext(input: {
  manifest: NaniteManifest | null;
  trigger: NaniteTriggerEvent | null;
}): string {
  return [
    "Nanite task context",
    "",
    buildNaniteManifestTaskContext(input.manifest),
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
  "Never force push. If a branch history rewrite appears necessary, stop and use ask_human with the exact branch, remote head, local head, and why a normal fetch/rebase/push path is not enough.",
] as const;

export function buildRunPrompt(input: StartNaniteAgentInput): string {
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

export function buildNaniteSystemPrompt(): string {
  return [
    "You are a SigVelo Nanite: a durable maintenance agent for one narrow responsibility inside a GitHub installation.",
    "Your transcript, workspace, and memory are durable. Keep durable memory compact and evidence-backed.",
    "Use nanite_task_context for the current manifest, repository scope, permission grants, generated trigger source, and active trigger payload.",
    "Use the smallest execution plane that can satisfy the run: GitHub MCP for pull requests, checks, comments, and metadata; Workspace for repository files, edits, and git; generated trigger context for event routing; ask_human for missing authority or product decisions.",
    "Do not use GitHub MCP to inspect repository files, commits, or branches. Use Workspace read/list/grep/find and execute git tools so file evidence stays in the durable workspace.",
    "The execute tool runs Worker-compatible JavaScript with state.* and git.* providers. It is not a shell and cannot use require(), child_process, or subprocess commands.",
    "Use artifact_read for saved SigVelo tool-output artifacts such as toolout_...; do not look for those artifacts in the workspace.",
    "Keep GitHub-facing output concise. Keep detailed investigation in this transcript.",
    "",
    "Do not claim success without evidence. If authority, configuration, approval, or target scope is missing, use ask_human. If the target state is impossible or a deterministic tool/API error repeats, use fail.",
    "Finish exactly once with complete, no_change, fail, or ask_human.",
  ].join("\n");
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

function isNaniteLifecycleToolName(
  toolName: string,
): toolName is (typeof naniteLifecycleTools)[number] {
  return (naniteLifecycleTools as readonly string[]).includes(toolName);
}

function getToolNameFromMessagePart(part: UIMessage["parts"][number]): string | null {
  if ("toolName" in part && typeof part.toolName === "string") {
    return part.toolName;
  }

  if ("type" in part && typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }

  return null;
}

export function messageHasLifecycleToolCall(message: UIMessage): boolean {
  return message.parts.some((part) => {
    const toolName = getToolNameFromMessagePart(part);
    return toolName !== null && isNaniteLifecycleToolName(toolName);
  });
}

function buildLifecycleContinuationPrompt(): string {
  return [
    "You stopped without reporting the Nanite run outcome.",
    "Use the transcript evidence already available and call exactly one lifecycle tool now: complete, no_change, fail, or ask_human.",
    "Do not investigate further unless a lifecycle tool requires the final summary or human request details.",
  ].join("\n");
}

function getParentManagerName(agent: SigveloNaniteAgent): string {
  const managerName = agent.state.managerName ?? agent.parentPath.at(-1)?.name;
  if (!managerName) {
    throw new AppError("naniteAgentManagerRequired");
  }

  return managerName;
}

function parseManagerInstallationId(managerName: string) {
  const installationId = managerName.startsWith("installation:")
    ? Number(managerName.slice("installation:".length))
    : Number.NaN;
  return Number.isInteger(installationId) && installationId > 0 ? installationId : null;
}

function getRunRepository(input: NaniteRunRecord): {
  githubRepositoryId: number | null;
  repository: string | null;
} {
  if (input.trigger.type !== "github") {
    return {
      githubRepositoryId: null,
      repository: null,
    };
  }

  return {
    githubRepositoryId: getGitHubWebhookRepositoryId(input.trigger.event),
    repository: getGitHubWebhookRepositoryFullName(input.trigger.event),
  };
}

function modelSettingsFromRunSnapshot(snapshot: NaniteRunModelSnapshot) {
  return {
    provider: snapshot.effectiveProvider,
    providerLabel: snapshot.effectiveProviderLabel,
    modelId: snapshot.effectiveModelId,
    modelName: snapshot.effectiveModelName,
    gatewayId: snapshot.effectiveGatewayId,
  };
}

function isLifecycleTerminalStatus(status: NaniteRunRecord["status"]): boolean {
  return (
    status === "complete" || status === "no_change" || status === "fail" || status === "canceled"
  );
}

type ParentManagerRpc = {
  getSnapshot: SigveloNaniteManager["getSnapshot"];
  startRun: SigveloNaniteManager["startRun"];
  dispatchRun: SigveloNaniteManager["dispatchRun"];
  recordUnreportedRunCompletion: SigveloNaniteManager["recordUnreportedRunCompletion"];
  recordRuntimeActivity: SigveloNaniteManager["recordRuntimeActivity"];
  completeRun: SigveloNaniteManager["completeRun"];
  askHuman: SigveloNaniteManager["askHuman"];
};

export class SigveloNaniteAgent extends Think<Env, NaniteAgentState> {
  initialState: NaniteAgentState = createInitialNaniteAgentState();
  extensionLoader = this.env.LOADER;
  override maxSteps = naniteMaxSteps;
  override waitForMcpConnections = { timeout: 10_000 };
  override chatRecovery = { noProgressTimeoutMs: 10 * 60 * 1000 };

  private parentManager(): ParentManagerRpc {
    return this.env.SigveloNaniteManager.getByName(
      getParentManagerName(this),
    ) as unknown as ParentManagerRpc;
  }

  private async readActiveRun(runId: string | null): Promise<NaniteRunRecord | null> {
    if (!runId) {
      return null;
    }
    return (await this.parentManager().getSnapshot()).runs[runId] ?? null;
  }

  private async buildTurnGatewayMetadata(
    runId: string | null,
  ): Promise<Record<string, string> | undefined> {
    try {
      const managerName = this.state.managerName ?? getParentManagerName(this);
      const githubInstallationId = parseManagerInstallationId(managerName);
      const naniteId = this.state.naniteId;
      const run = await this.readActiveRun(runId);

      if (!githubInstallationId || !naniteId || !run) {
        return undefined;
      }

      const db = createDbClient(this.env.DB);
      const billing = await resolveNaniteBillingAttribution(db, {
        githubInstallationId,
        naniteId,
        actor: naniteTriggerActor(run.trigger),
      });
      const repository = getRunRepository(run).repository;

      return buildNaniteAiGatewayMetadata({
        githubInstallationId,
        naniteId,
        runKey: run.runId,
        billingGithubUserId: billing.githubUserId,
        repository,
      });
    } catch (error) {
      naniteLogger.warn(LOG_EVENTS.OBSERVABILITY_FACT_RECORD_FAILED, {
        ...createRunLogContext(this),
        operation: "ai_gateway.metadata",
        error: describeError(error),
      });
      return undefined;
    }
  }

  private async getTurnModel(runId: string | null): Promise<LanguageModel> {
    const run = await this.readActiveRun(runId);
    const runModel = run?.model ?? this.state.activeRunModel;
    if (!runModel) {
      throw new AppError("nanitesModelSelectionInvalid", {
        details: {
          reason: "Nanite turns require a resolved run model.",
          modelId: null,
        },
      });
    }

    return createNaniteRunLanguageModel({
      env: this.env,
      sessionAffinity: runId ?? this.name,
      gatewayMetadata: await this.buildTurnGatewayMetadata(runId),
      modelSettings: modelSettingsFromRunSnapshot(runModel),
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
        ...createRunLogContext(this),
        operation: "ai_gateway.get_log",
        aiGatewayLogId: logId,
        error: describeError(error),
      });
      return null;
    }
  }

  private async recordStepUsage(ctx: StepContext): Promise<void> {
    const runId = this.state.activeRunId;
    const managerName = this.state.managerName ?? getParentManagerName(this);
    const githubInstallationId = parseManagerInstallationId(managerName);
    const run = await this.readActiveRun(runId);

    if (!githubInstallationId || !run) {
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
      githubInstallationId,
      naniteId: run.naniteId,
      actor,
    });

    await recordAiUsageFact(db, {
      githubInstallationId,
      githubRepositoryId: repository.githubRepositoryId,
      naniteId: run.naniteId,
      runKey: run.runId,
      requestId,
      provider: aiGatewayLog?.provider ?? run.model.effectiveProvider,
      model: aiGatewayLog?.model ?? run.model.effectiveModelId,
      sessionAffinity: run.runId,
      isContinuation: this.currentTurnContinuation,
      stepCount: ctx.stepNumber + 1,
      finishReason: ctx.finishReason,
      usage: usageWithGatewayTokens(ctx.usage, aiGatewayLog),
      providerMetadata: providerMetadataWithGatewayLog(ctx.providerMetadata, aiGatewayLog),
      providerBilledTotalCostUsdMicros: gatewayCostUsdMicros(aiGatewayLog),
      aiGatewayId: run.model.effectiveGatewayId,
      aiGatewayLogId: aiGatewayLog?.id ?? aiGatewayLogId,
      aiGatewayEventId: requestId,
      actor,
      billing,
      startedAt: ctx.response.timestamp,
      completedAt: new Date(),
    });
  }

  override classifyChatError = defaultContextOverflowClassifier;
  override contextOverflow = { reactive: true, maxRetries: 2 };
  private lastStepDiagnostic: LastStepDiagnostic | null = null;
  private currentTurnContinuation = false;
  private completedResponsesWithoutLifecycle = new Set<string>();

  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.WORKSPACE_FILES,
    namespace: "nanite",
    name: () => this.name,
  });

  override getModel(): LanguageModel {
    return createSigveloAgentLanguageModel({
      env: this.env,
      sessionAffinity: this.state.activeRunId ?? this.name,
    });
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

  override getSystemPrompt(): string {
    return buildNaniteSystemPrompt();
  }

  override getTools(): ToolSet {
    const workspaceTools = createWorkspaceTools(this.workspace);
    const artifactStore = this.createToolOutputArtifactStore();
    const extensionTools = this.extensionManager
      ? {
          ...createExtensionTools({ manager: this.extensionManager }),
          ...this.extensionManager.getTools(),
        }
      : {};

    return {
      ...workspaceTools,
      execute: createExecuteTool({
        tools: workspaceTools,
        state: createWorkspaceStateBackend(this.workspace),
        providers: [this.createGitToolProvider(), artifactStore.provider()],
        loader: this.env.LOADER,
      }),
      ...extensionTools,
      artifact_read: tool({
        description:
          "Inspect saved SigVelo tool-output artifacts. With no args, lists current-run artifacts. With artifactId, reads a bounded slice. With pattern, grep-searches one artifact or all current-run artifacts.",
        inputSchema: z.object({
          artifactId: z.string().min(1).optional(),
          offset: z.number().int().min(0).optional(),
          maxChars: z.number().int().min(1).max(100_000).optional(),
          pattern: z.string().min(1).optional(),
          regex: z.boolean().optional(),
          caseSensitive: z.boolean().optional(),
          contextLines: z.number().int().min(0).max(10).optional(),
          matchLimit: z.number().int().min(1).max(500).optional(),
          listLimit: z.number().int().min(1).max(100).optional(),
        }),
        execute: async (input) => artifactStore.read(input),
      }),
      complete: tool({
        description:
          "Mark the active Nanite work attempt complete only after the requested outcome happened. Include the most useful output URL when one exists, such as the commit, branch, PR, or run result URL.",
        inputSchema: z.object({
          summary: z.string().min(1),
          outputUrl: z.string().url().nullable().optional(),
          agentFeedback: agentFeedbackSchema.optional(),
        }),
        execute: async ({ summary, outputUrl, agentFeedback }) => {
          const run = await this.finishRun({
            runId: this.getActiveRunId(),
            status: "complete",
            summary,
            outputUrl: outputUrl ?? null,
            agentFeedback: agentFeedback ?? null,
          });
          return {
            accepted: true,
            status: run.status,
            summary: run.summary,
            outputUrl: run.outputUrl,
          };
        },
      }),
      no_change: tool({
        description:
          "Mark the active Nanite work attempt finished with no changes needed only when investigation proves no action is needed. This is not valid for imperative tasks such as pushing a commit unless the equivalent target state already exists.",
        inputSchema: z.object({
          summary: z.string().min(1),
          agentFeedback: agentFeedbackSchema.optional(),
        }),
        execute: async ({ summary, agentFeedback }) => {
          const run = await this.finishRun({
            runId: this.getActiveRunId(),
            status: "no_change",
            summary,
            outputUrl: null,
            agentFeedback: agentFeedback ?? null,
          });
          return {
            accepted: true,
            status: run.status,
            summary: run.summary,
            outputUrl: run.outputUrl,
          };
        },
      }),
      fail: tool({
        description:
          "Mark the active Nanite work attempt failed when the target state is impossible, the requested API/tool path is unavailable, a deterministic tool/API error repeats, or the task cannot be completed within the granted permissions. After two materially similar failures, stop debugging and use fail or ask_human.",
        inputSchema: z.object({
          summary: z.string().min(1),
          agentFeedback: agentFeedbackSchema.optional(),
        }),
        execute: async ({ summary, agentFeedback }) => {
          const run = await this.finishRun({
            runId: this.getActiveRunId(),
            status: "fail",
            summary,
            outputUrl: null,
            agentFeedback: agentFeedback ?? null,
          });
          return {
            accepted: true,
            status: run.status,
            summary: run.summary,
            outputUrl: run.outputUrl,
          };
        },
      }),
      ask_human: tool({
        description:
          "Pause the active Nanite work attempt and ask a human for a decision, permission, approval, access, ambiguous target branch/repo clarification, branch protection/policy choice, or destructive/risky action confirmation. After two materially similar failures, stop debugging and use ask_human or fail.",
        inputSchema: z.object({
          summary: z.string().min(1),
          requestedScopes: z.array(z.string().min(1)).default([]),
        }),
        execute: async ({ summary, requestedScopes }) => {
          const run = await this.askHuman({
            runId: this.getActiveRunId(),
            summary,
            requestedScopes,
          });
          return {
            accepted: true,
            status: run.status,
            summary: run.summary,
            requestedScopes: run.humanRequest?.requestedScopes ?? requestedScopes,
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

  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    this.currentTurnContinuation = ctx.continuation;
    await this.refreshManifestFromManager();
    const runId = getRunIdFromTurn(ctx);
    if (runId && runId !== this.state.activeRunId) {
      const run = await this.readActiveRun(runId);
      setStateWithoutProtocolBroadcast(this, {
        ...this.state,
        activeRunId: runId,
        activeRunModel: run?.model ?? this.state.activeRunModel,
        updatedAt: nowIso(),
      });
    }

    if (runId) {
      await this.refreshLifecycleWatchdog(runId);
    }
    await this.reportRuntimeActivity("thinking");
    naniteLogger.info(LOG_EVENTS.NANITE_TURN_STARTED, {
      ...createRunLogContext(this),
      continuation: ctx.continuation,
      messageCount: ctx.messages.length,
      toolCount: Object.keys(ctx.tools).length,
      maxSteps: this.maxSteps,
    });

    return {
      maxSteps: this.maxSteps,
      model: await this.getTurnModel(runId ?? this.state.activeRunId),
      sendReasoning: true,
      tools: this.wrapTurnToolsForOutputBudget(ctx.tools),
      stopWhen: naniteLifecycleTools.map((toolName) => hasToolCall(toolName)),
    };
  }

  override async beforeToolCall(ctx: ToolCallContext): Promise<void> {
    await this.refreshLifecycleWatchdog();
    await this.reportRuntimeActivity("tool_calling", {
      toolName: ctx.toolName,
    });
  }

  override async afterToolCall(ctx: ToolCallResultContext): Promise<void> {
    await this.refreshLifecycleWatchdog();
    await this.reportRuntimeActivity(getActivityStateAfterTool(ctx.toolName), {
      toolName: ctx.toolName,
      error: ctx.success ? null : describeError(ctx.error),
    });

    const base = {
      ...createRunLogContext(this),
      [OTEL_ATTRS.NANITE_TOOL_NAME]: ctx.toolName,
      toolCallId: ctx.toolCallId,
      stepNumber: ctx.stepNumber,
      durationMs: ctx.durationMs,
      success: ctx.success,
    };

    if (ctx.success) {
      naniteLogger.info(LOG_EVENTS.NANITE_TOOL_CALL_FINISHED, base);
      return;
    }

    naniteLogger.error(LOG_EVENTS.NANITE_TOOL_CALL_FINISHED, {
      ...base,
      error: describeError(ctx.error),
    });
  }

  override onStepFinish(ctx: StepContext): void {
    const diagnostic: LastStepDiagnostic = {
      runId: this.state.activeRunId,
      stepNumber: ctx.stepNumber,
      finishReason: ctx.finishReason,
      rawFinishReason: ctx.rawFinishReason ?? null,
      toolCallCount: ctx.toolCalls.length,
      toolResultCount: ctx.toolResults.length,
      inputTokens: getUsageNumber(ctx.usage, "inputTokens"),
      outputTokens: getUsageNumber(ctx.usage, "outputTokens"),
      totalTokens: getUsageNumber(ctx.usage, "totalTokens"),
    };

    this.lastStepDiagnostic = diagnostic;
    if (diagnostic.runId) {
      this.ctx.waitUntil(this.refreshLifecycleWatchdog(diagnostic.runId));
    }

    naniteLogger.info(LOG_EVENTS.NANITE_STEP_FINISHED, {
      ...createRunLogContext(this),
      stepNumber: diagnostic.stepNumber,
      finishReason: diagnostic.finishReason,
      rawFinishReason: diagnostic.rawFinishReason ?? undefined,
      toolCallCount: diagnostic.toolCallCount,
      toolResultCount: diagnostic.toolResultCount,
      inputTokens: diagnostic.inputTokens ?? undefined,
      outputTokens: diagnostic.outputTokens ?? undefined,
      totalTokens: diagnostic.totalTokens ?? undefined,
      maxSteps: this.maxSteps,
    });
    this.ctx.waitUntil(
      this.recordStepUsage(ctx).catch((error: unknown) => {
        naniteLogger.warn(LOG_EVENTS.OBSERVABILITY_FACT_RECORD_FAILED, {
          ...createRunLogContext(this),
          operation: "ai_usage.step",
          error: describeError(error),
        });
      }),
    );
  }

  override async onChatResponse(result: ChatResponseResult): Promise<void> {
    await this.refreshLifecycleWatchdog();
    const hasLifecycleToolCall = messageHasLifecycleToolCall(result.message);
    if (result.status === "completed" && !hasLifecycleToolCall) {
      this.completedResponsesWithoutLifecycle.add(result.requestId);
    } else {
      this.completedResponsesWithoutLifecycle.delete(result.requestId);
    }

    naniteLogger.info(LOG_EVENTS.NANITE_CHAT_RESPONSE, {
      ...createRunLogContext(this),
      requestId: result.requestId,
      continuation: result.continuation,
      status: result.status,
      error: result.error,
      messagePartCount: result.message.parts.length,
      hasLifecycleToolCall,
    });
    await this.cancelSubmissionAfterLifecycleResponse(
      resolveLifecycleResponseRunId(result.requestId),
    );
  }

  override onChatError(error: unknown): unknown {
    this.ctx.waitUntil(this.refreshLifecycleWatchdog());
    this.ctx.waitUntil(this.reportRuntimeActivity("error", { error: describeError(error) }));
    naniteLogger.error(LOG_EVENTS.NANITE_CHAT_ERROR, {
      ...createRunLogContext(this),
      error: describeError(error),
    });

    return error;
  }

  @callable()
  async enqueueFromManager(input: StartNaniteAgentInput): Promise<void> {
    try {
      await this.acceptRunFromManager(input);
    } catch (error) {
      throw new AppError("naniteAgentRunAcceptFailed", {
        cause: error,
        details: { reason: describeErrorWithStack(error) },
        message: `${APP_ERRORS.naniteAgentRunAcceptFailed.message}: ${describeErrorWithStack(error)}`,
      });
    }

    try {
      await this.submitRunFromManager(input);
    } catch (error) {
      throw new AppError("naniteAgentRunSubmitFailed", {
        cause: error,
        details: { reason: describeErrorWithStack(error) },
        message: `${APP_ERRORS.naniteAgentRunSubmitFailed.message}: ${describeErrorWithStack(error)}`,
      });
    }
  }

  @callable()
  async syncScheduleFromManager(input: {
    managerName: string;
    nanite: ManagedNanite;
  }): Promise<void> {
    this.syncStateFromManager(input);
    await this.cancelScheduledTriggerRows();

    const eventSource = input.nanite.manifest.eventSource;
    if (
      !input.nanite.enabled ||
      (eventSource.type !== "schedule" && eventSource.type !== "scheduleEvery")
    ) {
      return;
    }

    const payload: ScheduledTriggerPayload = { eventSource };
    switch (eventSource.type) {
      case "schedule":
        await this.schedule(
          resolveCloudflareScheduleWhen(eventSource.when),
          "handleScheduledTrigger",
          payload,
          { idempotent: true },
        );
        return;
      case "scheduleEvery":
        await this.scheduleEvery(eventSource.intervalSeconds, "handleScheduledTrigger", payload);
        return;
    }
  }

  async handleScheduledTrigger(payload: ScheduledTriggerPayload): Promise<void> {
    await this.refreshManifestFromManager();
    const manifest = this.state.manifest;
    if (
      !manifest ||
      (manifest.eventSource.type !== "schedule" && manifest.eventSource.type !== "scheduleEvery")
    ) {
      return;
    }

    const scheduledAt = nowIso();
    const trigger: Extract<NaniteTriggerEvent, { type: "schedule" }> = {
      type: "schedule",
      eventSource: payload.eventSource,
      scheduledAt,
    };
    const manager = this.parentManager();
    const triggerSource = manifest.triggerSource;
    if (typeof triggerSource !== "string") {
      return;
    }

    const triggerResult = await runGeneratedTrigger({
      loader: this.env.LOADER,
      sourceCode: triggerSource,
      cacheKey: `${this.state.managerName ?? getParentManagerName(this)}:${manifest.id}:schedule`,
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
          input: {
            triggerError: `Trigger failed before model dispatch: ${triggerResult.error}`,
          },
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
      trigger: {
        ...trigger,
        input: dispatch.input,
      },
    });
    await manager.dispatchRun({ runId: run.runId });
  }

  async checkLifecycleWatchdog(payload: LifecycleWatchdogPayload): Promise<void> {
    const watchdog = this.state.lifecycleWatchdog;
    if (
      !watchdog ||
      watchdog.runId !== payload.runId ||
      watchdog.lastActivityAt !== payload.lastActivityAt ||
      this.state.activeRunId !== payload.runId
    ) {
      return;
    }

    const manager = this.parentManager();
    const run = (await manager.getSnapshot()).runs[payload.runId];
    if (!run || run.naniteId !== this.state.naniteId || isLifecycleTerminalStatus(run.status)) {
      await this.clearLifecycleWatchdog(payload.runId);
      return;
    }
    if (run.status === "waiting_for_human") {
      await this.clearLifecycleWatchdog(payload.runId);
      return;
    }

    const stable = await this.waitUntilStable({
      timeout: naniteLifecycleWatchdogStabilityTimeoutMs,
    });
    if (!stable) {
      await this.refreshLifecycleWatchdog(payload.runId);
      return;
    }

    if (!watchdog.continuationAttempted) {
      await this.submitLifecycleContinuation(payload.runId);
      return;
    }

    const failedRun = await manager.recordUnreportedRunCompletion({
      runId: payload.runId,
      status: "error",
      error:
        "Nanite lifecycle watchdog found the run stable without a lifecycle outcome after a lifecycle continuation was already attempted.",
    });
    await this.clearLifecycleWatchdog(payload.runId);
    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      activeRunId: this.state.activeRunId === payload.runId ? null : this.state.activeRunId,
      activeRunModel: this.state.activeRunId === payload.runId ? null : this.state.activeRunModel,
      summary: failedRun.summary,
      outputUrl: failedRun.outputUrl,
      updatedAt: failedRun.updatedAt,
    });
  }

  @callable()
  async cancelRunFromManager(input: { runId: string; reason: string }): Promise<void> {
    await this.cancelRunSubmissions(input.runId, input.reason);
    if (this.state.activeRunId === input.runId) {
      await this.clearLifecycleWatchdog(input.runId);
      setStateWithoutProtocolBroadcast(this, {
        ...this.state,
        activeRunId: null,
        activeRunModel: null,
        updatedAt: nowIso(),
      });
    }
  }

  @callable()
  async listFiles(path: string): Promise<FileInfo[]> {
    return this.workspace.readDir(path);
  }

  @callable()
  async readFileContent(path: string): Promise<string | null> {
    return this.workspace.readFile(path);
  }

  @callable()
  async getWorkspaceInfo(): Promise<NaniteWorkspaceInfo> {
    const info = await this.workspace.getWorkspaceInfo();
    const repositoryRoot = await this.findRepositoryRoot();
    return this.measureWorkspaceSubtree({ ...info, repositoryRoot });
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
      const entries = await this.workspace.readDir(directory, { limit: 1_000 });
      for (const entry of entries) {
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

  @callable()
  async inspectDebug(input: NaniteDebugInspectInput = {}): Promise<NaniteDebugInspectOutput> {
    const output: NaniteDebugInspectOutput = {};

    await this.reconcileActiveTerminalSubmission();

    if (input.transcript !== false) {
      output.transcript = inspectTranscript(await this.getMessages(), input.transcript ?? {});
    }

    if (input.submissions !== false) {
      output.submissions = await this.listSubmissions({
        limit: Math.min(Math.max(input.submissions?.limit ?? 25, 1), 100),
        status: input.submissions?.status,
      });
    }

    return output;
  }

  @callable()
  async resetDebugState(): Promise<NaniteDebugResetOutput> {
    await this.clearMessages();
    const deletedSubmissions = await this.deleteSubmissions({ limit: 500 });
    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      activeRunId: null,
      activeRunModel: null,
      interruptedSubmissionRetriesByRun: {},
      lifecycleWatchdog: null,
      updatedAt: nowIso(),
    });

    return {
      clearedMessages: true,
      deletedSubmissions,
    };
  }

  @callable()
  async maintainFromManager(
    input: NaniteAgentMaintenanceInput,
  ): Promise<NaniteAgentMaintenanceOutput> {
    this.syncStateFromManager(input);
    const reconciledActiveSubmission = await this.reconcileActiveTerminalSubmission();
    const deletedSubmissions = await this.deleteSubmissions({
      completedBefore: parseOptionalAppIsoDate(input.completedBeforeIso, "completedBeforeIso"),
      limit: clampSubmissionDeleteLimit(input.submissionDeleteLimit),
    });

    return {
      activeRunId: this.state.activeRunId,
      reconciledActiveSubmission,
      deletedSubmissions,
    };
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
      case "list": {
        const path = workspaceRootPath(input.path);
        return {
          action: "list",
          path,
          entries: await this.workspace.readDir(path, {
            limit: Math.min(Math.max(input.limit ?? 200, 1), 1_000),
          }),
        };
      }
      case "read": {
        const content = await this.workspace.readFile(input.path);
        const maxBytes = Math.min(Math.max(input.maxBytes ?? 100_000, 1_000), 1_000_000);
        if (content === null || content.length <= maxBytes) {
          return {
            action: "read",
            path: input.path,
            content,
            truncated: false,
          };
        }

        return {
          action: "read",
          path: input.path,
          content: content.slice(0, maxBytes),
          truncated: true,
        };
      }
      case "search":
        return this.searchWorkspace(input);
    }
  }

  private async searchWorkspace(
    input: Extract<NaniteWorkspaceExploreInput, { action: "search" }>,
  ): Promise<Extract<NaniteWorkspaceExploreOutput, { action: "search" }>> {
    const root = workspaceRootPath(input.path);
    const query = input.query;
    const caseInsensitiveQuery = query.toLowerCase();
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
    const maxFileBytes = Math.min(Math.max(input.maxFileBytes ?? 200_000, 1_000), 1_000_000);
    const matches: Array<{ path: string; line: number; text: string }> = [];
    const directories = [root];

    while (directories.length > 0 && matches.length < limit) {
      const directory = directories.shift() ?? "/";
      for (const entry of await this.workspace.readDir(directory, { limit: 1_000 })) {
        if (entry.type === "directory") {
          directories.push(entry.path);
          continue;
        }

        if (entry.type !== "file" || entry.size > maxFileBytes) {
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
          return matches.length >= limit;
        });
      }
    }

    return {
      action: "search",
      path: root,
      query,
      matches,
      truncated: directories.length > 0 || matches.length >= limit,
    };
  }

  private syncStateFromManager(input: { managerName: string; nanite: ManagedNanite }): void {
    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      naniteId: input.nanite.manifest.id,
      managerName: input.managerName,
      manifest: input.nanite.manifest,
      updatedAt: nowIso(),
    });
  }

  private async acceptRunFromManager(input: StartNaniteAgentInput): Promise<void> {
    const acceptedAt = nowIso();
    setStateWithoutProtocolBroadcast(this, {
      naniteId: input.nanite.manifest.id,
      managerName: input.managerName,
      activeRunId: input.run.runId,
      activeRunModel: input.run.model,
      manifest: input.nanite.manifest,
      trigger: input.run.trigger,
      interruptedSubmissionRetriesByRun: {},
      lifecycleWatchdog: null,
      summary: input.run.summary,
      outputUrl: input.run.outputUrl,
      updatedAt: acceptedAt,
    });
    await this.refreshLifecycleWatchdog(input.run.runId, acceptedAt);
    await this.attachGitHubMcpServer(input.nanite.manifest);
    naniteLogger.info(LOG_EVENTS.NANITE_AGENT_RUN_ACCEPTED, {
      [OTEL_ATTRS.AGENT_CLASS]: "SigveloNaniteAgent",
      [OTEL_ATTRS.AGENT_NAME]: this.name,
      [OTEL_ATTRS.NANITE_ID]: input.nanite.manifest.id,
      [OTEL_ATTRS.NANITE_MANAGER_NAME]: input.managerName,
      [OTEL_ATTRS.NANITE_RUN_ID]: input.run.runId,
      [OTEL_ATTRS.NANITE_RUN_KEY]: input.run.triggerKey,
      [OTEL_ATTRS.NANITE_RUN_STATUS]: input.run.status,
      versionId: input.run.versionId,
    });
  }

  private async submitRunFromManager(input: StartNaniteAgentInput): Promise<void> {
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
      ...createRunLogContext(this, input.run.runId),
      [OTEL_ATTRS.NANITE_RUN_KEY]: input.run.triggerKey,
      [OTEL_ATTRS.NANITE_SUBMISSION_ID]: input.run.runId,
    });
  }

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

    const manager = this.parentManager();
    const diagnostic = this.lastStepDiagnostic;
    const diagnosticError =
      submission.status === "completed"
        ? this.buildNoLifecycleSubmissionSummary({
            submission,
            diagnostic,
          })
        : submission.error;

    naniteLogger.info(LOG_EVENTS.NANITE_SUBMISSION_STATUS, {
      ...createRunLogContext(this, runId),
      [OTEL_ATTRS.NANITE_SUBMISSION_ID]: submission.submissionId,
      status: submission.status,
      error: diagnosticError,
      lastStepNumber: diagnostic?.runId === runId ? diagnostic.stepNumber : undefined,
      lastFinishReason: diagnostic?.runId === runId ? diagnostic.finishReason : undefined,
      maxSteps: this.maxSteps,
    });

    if (
      submission.status === "error" &&
      diagnosticError === naniteInterruptedSubmissionError &&
      (await this.retryInterruptedSubmission(runId))
    ) {
      return;
    }

    if (
      submission.status === "completed" &&
      this.completedResponsesWithoutLifecycle.has(
        submission.requestId ?? submission.submissionId,
      ) &&
      !this.isLifecycleContinuationSubmission(submission) &&
      (await this.submitLifecycleContinuation(runId))
    ) {
      return;
    }

    const run = await manager.recordUnreportedRunCompletion({
      runId,
      status: submission.status,
      error: diagnosticError,
    });
    if (isLifecycleTerminalStatus(run.status)) {
      await this.clearLifecycleWatchdog(run.runId);
    }

    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      activeRunId:
        this.state.activeRunId === null || this.state.activeRunId === run.runId
          ? isLifecycleTerminalStatus(run.status)
            ? null
            : run.runId
          : this.state.activeRunId,
      activeRunModel:
        this.state.activeRunId === null || this.state.activeRunId === run.runId
          ? isLifecycleTerminalStatus(run.status)
            ? null
            : run.model
          : this.state.activeRunModel,
      summary: run.summary,
      outputUrl: run.outputUrl,
      updatedAt: run.updatedAt,
    });
  }

  private async retryInterruptedSubmission(runId: string): Promise<boolean> {
    const retriesByRun = this.state.interruptedSubmissionRetriesByRun ?? {};
    const retryCount = retriesByRun[runId] ?? 0;
    if (retryCount >= naniteInterruptedSubmissionMaxRetries) {
      return false;
    }

    const manager = this.parentManager();
    const snapshot = await manager.getSnapshot();
    const run = snapshot.runs[runId];
    if (!run || run.naniteId !== this.state.naniteId) {
      return false;
    }

    const nanite = snapshot.nanites[run.naniteId];
    if (!nanite) {
      return false;
    }

    const retryAttempt = retryCount + 1;
    const submissionId = `${run.runId}:retry:${retryAttempt}`;
    const managerName = this.state.managerName ?? getParentManagerName(this);
    const retriedAt = nowIso();
    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      activeRunId: runId,
      activeRunModel: run.model,
      interruptedSubmissionRetriesByRun: {
        ...retriesByRun,
        [runId]: retryAttempt,
      },
      updatedAt: retriedAt,
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
        submissionId,
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
      ...createRunLogContext(this, runId),
      [OTEL_ATTRS.NANITE_SUBMISSION_ID]: submissionId,
      status: "retrying",
      error: naniteInterruptedSubmissionError,
      retryAttempt,
      maxRetries: naniteInterruptedSubmissionMaxRetries,
    });
    return true;
  }

  private isLifecycleContinuationSubmission(submission: ThinkSubmissionInspection): boolean {
    return submission.metadata?.lifecycleContinuation === true;
  }

  private async cancelRunSubmissions(runId: string, reason: string): Promise<void> {
    await Promise.all([
      this.cancelSubmission(runId, reason),
      this.cancelSubmission(buildLifecycleContinuationSubmissionId(runId), reason),
    ]);
  }

  private async submitLifecycleContinuation(runId: string): Promise<boolean> {
    const manager = this.parentManager();
    const snapshot = await manager.getSnapshot();
    const run = snapshot.runs[runId];
    if (!run || run.naniteId !== this.state.naniteId || run.status !== "running") {
      return false;
    }

    const nanite = snapshot.nanites[run.naniteId];
    if (!nanite) {
      return false;
    }

    const managerName = this.state.managerName ?? getParentManagerName(this);
    const submissionId = buildLifecycleContinuationSubmissionId(run.runId);
    const result = await this.submitMessages(
      [createUserMessage(buildLifecycleContinuationPrompt())],
      {
        submissionId,
        idempotencyKey: `${run.triggerKey}:${naniteLifecycleContinuationSuffix}`,
        metadata: {
          managerName,
          naniteId: nanite.manifest.id,
          runId: run.runId,
          lifecycleContinuation: true,
        },
      },
    );
    await this.markLifecycleContinuationAttempted(runId);

    naniteLogger.warn(LOG_EVENTS.NANITE_SUBMISSION_STATUS, {
      ...createRunLogContext(this, runId),
      [OTEL_ATTRS.NANITE_SUBMISSION_ID]: submissionId,
      status: result.accepted
        ? "lifecycle_continuation_submitted"
        : "lifecycle_continuation_exists",
    });
    return true;
  }

  private buildNoLifecycleSubmissionSummary(input: {
    submission: ThinkSubmissionInspection;
    diagnostic: LastStepDiagnostic | null;
  }): string {
    const diagnostic = input.diagnostic;
    const lifecycleContinuationAttempted = this.isLifecycleContinuationSubmission(input.submission);
    return [
      "The Think turn completed before the Nanite reported a lifecycle outcome.",
      `Submission status: ${input.submission.status}.`,
      `Lifecycle continuation attempted: ${lifecycleContinuationAttempted ? "yes" : "no"}.`,
      input.submission.error ? `Submission error: ${input.submission.error}.` : null,
      diagnostic
        ? `Last step: ${diagnostic.stepNumber}; finishReason=${diagnostic.finishReason}; rawFinishReason=${diagnostic.rawFinishReason ?? "none"}; toolCallCount=${diagnostic.toolCallCount}; toolResultCount=${diagnostic.toolResultCount}.`
        : "Last step: unavailable.",
    ]
      .filter((line): line is string => Boolean(line))
      .join(" ");
  }

  private async refreshManifestFromManager(): Promise<void> {
    const manager = this.parentManager();
    const snapshot = await manager.getSnapshot();
    const manifest = snapshot.nanites[this.state.naniteId ?? this.name]?.manifest ?? null;
    if (!manifest || JSON.stringify(manifest) === JSON.stringify(this.state.manifest)) {
      return;
    }

    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      naniteId: manifest.id,
      managerName: getParentManagerName(this),
      manifest,
      updatedAt: nowIso(),
    });
    await this.attachGitHubMcpServer(manifest);
  }

  private async cancelScheduledTriggerRows(): Promise<void> {
    const schedules = await this.listSchedules();
    await Promise.all(
      schedules
        .filter((schedule) => schedule.callback === "handleScheduledTrigger")
        .map((schedule) => this.cancelSchedule(schedule.id)),
    );
  }

  private async refreshLifecycleWatchdog(
    runId = this.state.activeRunId,
    lastActivityAt = nowIso(),
  ): Promise<void> {
    if (!runId) {
      return;
    }

    const current = this.state.lifecycleWatchdog;
    if (current?.runId === runId && current.scheduleId) {
      await this.cancelSchedule(current.scheduleId);
    }

    const schedule = await this.schedule(
      naniteLifecycleWatchdogDelaySeconds,
      naniteLifecycleWatchdogCallback,
      { runId, lastActivityAt } satisfies LifecycleWatchdogPayload,
    );

    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      lifecycleWatchdog: {
        runId,
        lastActivityAt,
        continuationAttempted: current?.runId === runId ? current.continuationAttempted : false,
        scheduleId: schedule.id,
      },
      updatedAt: lastActivityAt,
    });
  }

  private async markLifecycleContinuationAttempted(runId: string): Promise<void> {
    const current = this.state.lifecycleWatchdog;
    if (!current || current.runId !== runId) {
      return;
    }

    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      lifecycleWatchdog: {
        ...current,
        continuationAttempted: true,
      },
      updatedAt: nowIso(),
    });
  }

  private async clearLifecycleWatchdog(runId = this.state.activeRunId): Promise<void> {
    const current = this.state.lifecycleWatchdog;
    if (!current || (runId && current.runId !== runId)) {
      return;
    }

    if (current.scheduleId) {
      await this.cancelSchedule(current.scheduleId);
    }

    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      lifecycleWatchdog: null,
      updatedAt: nowIso(),
    });
  }

  private async reportRuntimeActivity(
    state: NaniteRuntimeActivityState,
    options: { toolName?: string | null; error?: string | null; runId?: string | null } = {},
  ): Promise<void> {
    const naniteId = this.state.naniteId;
    if (!naniteId) {
      return;
    }
    const runId = options.runId ?? this.state.activeRunId;

    try {
      const manager = this.parentManager();
      await manager.recordRuntimeActivity({
        naniteId,
        runId,
        state,
        toolName: options.toolName ?? null,
        error: options.error ?? null,
      });
    } catch (error) {
      naniteLogger.error(LOG_EVENTS.NANITE_SUBMISSION_STATUS, {
        ...createRunLogContext(this),
        error: `recordRuntimeActivity failed: ${describeError(error)}`,
      });
    }
  }

  private resolveSubmissionRunId(submission: ThinkSubmissionInspection): string | null {
    const metadataRunId =
      typeof submission.metadata?.runId === "string" ? submission.metadata.runId : null;
    if (metadataRunId) {
      return metadataRunId;
    }

    if (this.state.activeRunId === submission.submissionId) {
      return this.state.activeRunId;
    }

    return null;
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

  private createGitToolProvider(): ToolProvider {
    return gitToolsWithGitHubInstallationAuth(this.workspace, {
      getAllowedRepositories: () => this.state.manifest?.permissions.github?.repositories ?? [],
      issueToken: () => this.issueGitToolToken(),
    });
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
          ...createRunLogContext(this),
          [OTEL_ATTRS.NANITE_TOOL_NAME]: toolName,
          [OTEL_ATTRS.NANITE_TOOL_OUTPUT_ARTIFACT_ID]: artifactId,
          [OTEL_ATTRS.NANITE_TOOL_OUTPUT_ORIGINAL_CHARS]: originalChars,
          [OTEL_ATTRS.NANITE_TOOL_OUTPUT_RETURNED_CHARS]: returnedChars,
          toolCallId,
        });
      },
    });
  }

  private async issueGitToolToken(): Promise<string | null> {
    const managerName = getParentManagerName(this);
    const githubInstallationId = parseManagerInstallationId(managerName);
    const permissions = this.state.manifest?.permissions.github;
    if (!githubInstallationId || !permissions || permissions.repositories.length === 0) {
      return null;
    }

    const scopedToken = await issueScopedGitHubInstallationToken({
      env: this.env,
      installationId: githubInstallationId,
      repositories: permissions.repositories,
      permissions: permissions.appPermissions ?? {},
    });

    return scopedToken.token;
  }

  private async attachGitHubMcpServer(manifest: NaniteManifest): Promise<void> {
    const githubPermissions = manifest.permissions.github;
    if (!githubPermissions || githubPermissions.repositories.length === 0) {
      await this.removeGitHubMcpServers();
      return;
    }

    const capability = deriveNaniteGitHubMcpAccess({
      appPermissions: githubPermissions.appPermissions,
    });
    if (!capability) {
      await this.removeGitHubMcpServers();
      return;
    }

    const managerName = getParentManagerName(this);
    const githubInstallationId = parseManagerInstallationId(managerName);
    if (!githubInstallationId) {
      throw new AppError("naniteAgentGithubMcpInstallationRequired");
    }

    await this.removeGitHubMcpServers();
    const scopedToken = await issueScopedGitHubInstallationToken({
      env: this.env,
      installationId: githubInstallationId,
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

    const result = await this.addMcpServer(githubMcpServerName, githubMcpServerUrl, {
      transport: {
        type: "streamable-http",
        headers,
      },
      retry: {
        maxAttempts: 2,
        baseDelayMs: 500,
        maxDelayMs: 2_000,
      },
    });

    naniteLogger.info(LOG_EVENTS.NANITE_SUBMISSION_STATUS, {
      ...createRunLogContext(this),
      mcpServer: githubMcpServerName,
      mcpServerId: result.id,
      state: result.state,
      toolCount: capability.tools.length,
      readonly: capability.readonly,
    });
  }

  private async removeGitHubMcpServers(): Promise<void> {
    const servers = this.getMcpServers().servers;
    await Promise.all(
      Object.entries(servers)
        .filter(([, server]) => server.name === githubMcpServerName)
        .map(([serverId]) => this.removeMcpServer(serverId)),
    );
  }

  private getActiveRunId(): string {
    const runId = this.state.activeRunId;
    if (!runId) {
      throw new AppError("naniteAgentActiveRunRequired");
    }

    return runId;
  }

  private async finishRun(input: CompleteNaniteRunInput): Promise<NaniteRunRecord> {
    const manager = this.parentManager();
    const run = await manager.completeRun(input);
    await this.clearLifecycleWatchdog(input.runId);

    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      summary: run.summary,
      outputUrl: run.outputUrl,
      updatedAt: run.updatedAt,
    });

    return run;
  }

  private async askHuman(input: AskHumanInput): Promise<NaniteRunRecord> {
    const manager = this.parentManager();
    const run = await manager.askHuman(input);
    await this.clearLifecycleWatchdog(input.runId);

    setStateWithoutProtocolBroadcast(this, {
      ...this.state,
      summary: run.summary,
      updatedAt: run.updatedAt,
    });

    return run;
  }

  private async cancelSubmissionAfterLifecycleResponse(runId: string): Promise<void> {
    const manager = this.parentManager();
    const run = (await manager.getSnapshot()).runs[runId];
    if (!run) {
      await this.reportRuntimeActivity("idle");
      return;
    }

    if (run.status === "waiting_for_human") {
      await this.cancelRunSubmissions(runId, "Nanite lifecycle paused for human input.");
      await this.reportRuntimeActivity("waiting_for_human");
      return;
    }

    if (isLifecycleTerminalStatus(run.status)) {
      await this.cancelRunSubmissions(runId, `Nanite lifecycle finished with ${run.status}.`);
      await this.reportRuntimeActivity("idle", { runId });
      await this.clearLifecycleWatchdog(runId);
      if (this.state.activeRunId === runId) {
        setStateWithoutProtocolBroadcast(this, {
          ...this.state,
          activeRunId: null,
          activeRunModel: null,
          updatedAt: nowIso(),
        });
      }
      return;
    }
  }
}
