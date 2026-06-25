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
import type { FileInfo } from "@cloudflare/shell";
import type { ToolProvider } from "@cloudflare/codemode";
import type { SkillSource } from "agents/skills";
import type { WorkflowInfo, WorkflowStatus } from "agents/workflows";
import { GitHubMcpConnector } from "#/backend/nanites/github-mcp-connector.ts";
import { createNaniteWorkspaceSkillSource } from "#/backend/nanites/linked-skills.ts";
import { ToolProviderConnector } from "#/backend/nanites/tool-provider-connector.ts";
import { getLogger } from "@logtape/logtape";
import { callable, getAgentByName } from "agents";
import { tool, type LanguageModel, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import { AppError, describeError, parseOptionalAppIsoDate } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { createDbClient } from "#/backend/db/index.ts";
import {
  issueScopedGitHubInstallationToken,
  type GitHubAppPermissions,
} from "#/backend/github/index.ts";
import {
  gitCheckoutTools,
  gitHubRepositoryFromGitConfig,
  githubRepositoryCheckoutDir,
  gitToolsWithGitHubInstallationAuth,
} from "#/backend/nanites/git-auth.ts";
import {
  deriveNaniteGitHubMcpAccess,
  resolveNaniteGitHubPermissionRepositoryFullNames,
} from "#/backend/nanites/github-mcp-capabilities.ts";
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
import {
  type ManagedNanite,
  type NaniteManifest,
  type NaniteManagerState,
  type NaniteRunRecord,
  type NaniteRuntimeConfig,
  type NaniteRuntimeActivityState,
  type NaniteScheduledEventSourceSpec,
  type NaniteScheduleWhen,
  type NaniteTriggerEvent,
  type RecordNaniteRuntimeActivityInput,
  type StartNaniteRunInput,
} from "#/backend/agents/SigveloNaniteManager.ts";
import {
  NANITE_RUN_WORKFLOW_NAME,
  naniteRunWorkflowResultSchema,
  type NaniteRunWorkflowParams,
  type NaniteRunWorkflowResult,
} from "#/backend/agents/NaniteRunWorkflow.ts";
import { getDispatchIntents, runGeneratedTrigger } from "#/backend/nanites/triggers.ts";
import {
  getGitHubWebhookRepositoryFullName,
  getGitHubWebhookRepositoryId,
} from "#/shared/utils/github.ts";
import { parseNaniteManagerKey } from "#/shared/utils/nanites.ts";
import {
  buildNaniteAiGatewayMetadata,
  naniteTriggerActor,
  recordAiUsageFact,
  resolveNaniteBillingAttribution,
} from "#/backend/observability/recorders.ts";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Bump whenever the persisted state shape changes incompatibly. Everything in
 * this state is run-scoped bookkeeping mirrored from the manager, so a reset
 * on version mismatch is safe.
 */
const NANITE_AGENT_STATE_VERSION = 5;

export type NaniteAgentState = {
  version: number;
  naniteId: string | null;
  managerName: string | null;
  manifest: NaniteManifest | null;
  runtimeConfig: NaniteRuntimeConfig | null;
  activeRunId: string | null;
  trigger: NaniteTriggerEvent | null;
  updatedAt: string | null;
};

function createInitialNaniteAgentState(): NaniteAgentState {
  return {
    version: NANITE_AGENT_STATE_VERSION,
    naniteId: null,
    managerName: null,
    manifest: null,
    runtimeConfig: null,
    activeRunId: null,
    trigger: null,
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

export type NaniteWorkspaceCheckout =
  | { repository: string; dir: string; status: "cloned" | "fetched"; error: null }
  | { repository: string; dir: null; status: "skipped" | "failed"; error: string };

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

export type NaniteRunWorkflowInspection = {
  workflow: {
    workflowId: string;
    workflowName: string;
    status: WorkflowInfo["status"];
    metadata: Record<string, unknown> | null;
    error: WorkflowInfo["error"];
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  } | null;
};

export type NaniteDebugResetOutput = {
  clearedMessages: boolean;
  deletedSubmissions: number;
};

export type NaniteAgentMaintenanceOutput = {
  activeRunId: string | null;
  deletedSubmissions: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const naniteMaxSteps = 200;
// Nanite tools can legitimately run for minutes without streaming chunks; keep
// stream-stall recovery off globally and let Workflow-owned runs decide.
const naniteChatStreamStallTimeoutMs = 0;
const naniteDebugPartMaxLength = 12_000;
const terminalWorkflowStatuses = new Set<WorkflowStatus>(["complete", "errored", "terminated"]);
const naniteToolOutputBudgetExcludedTools = new Set(["create_child_nanite", "artifact_read"]);
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
      .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
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
  runtimeConfig: NaniteRuntimeConfig | null;
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
        "Operate only inside the declared repository and permission scope. If the task needs another repository, permission, or event source, ask the manager with a plain-language request or fail with the missing config.",
      ].join("\n")
    : "No Nanite manifest has been attached yet.";

  return [
    "Nanite task context",
    "",
    manifestContext,
    "",
    "Runtime configuration:",
    input.runtimeConfig ? JSON.stringify(input.runtimeConfig, null, 2) : "No runtime config.",
    "",
    "Active run trigger payload:",
    input.trigger ? formatTrigger(input.trigger) : "No active run trigger has been attached yet.",
  ].join("\n");
}

function browserRuntimeConfig(
  runtimeConfig: NaniteRuntimeConfig | null,
): NaniteRuntimeConfig["browser"] | null {
  const browser = runtimeConfig?.browser;
  return browser?.enabled === true ? browser : null;
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

function hasGitHubContentsPermission(manifest: NaniteManifest): boolean {
  const level = manifest.permissions.github?.appPermissions.contents;
  return level === "read" || level === "write";
}

function formatWorkspacePreparation(checkouts: NaniteWorkspaceCheckout[] | undefined): string {
  if (!checkouts || checkouts.length === 0) {
    return "No manifest repositories were prepared.";
  }

  return checkouts
    .map((checkout) => {
      const location = checkout.dir ? ` at ${checkout.dir}` : "";
      const error = checkout.error ? ` (${checkout.error})` : "";
      return `- ${checkout.repository}: ${checkout.status}${location}${error}`;
    })
    .join("\n");
}

function buildRunPrompt(
  input: StartNaniteAgentInput & {
    workspaceCheckouts?: NaniteWorkspaceCheckout[];
  },
): string {
  const manualMessage =
    input.run.trigger.type === "manual" && input.run.trigger.message
      ? `\n\nManual operator message:\n${input.run.trigger.message}`
      : "";
  const testInstruction = getTriggerTestInstruction(input.run.trigger);
  const testInstructionMessage = testInstruction
    ? `\n\nTrigger acceptance test instruction:\n${testInstruction}`
    : "";
  const browser = browserRuntimeConfig(input.nanite.runtimeConfig ?? null);
  const browserInstruction = browser
    ? [
        "",
        "Browser Run capability:",
        `Target URL: ${browser.targetUrl}`,
        "Use cdp.* inside execute for browser evidence: screenshot, console/network summary, WebMCP status, and focused accessibility or performance observations.",
        "When you click a link or control, verify a postcondition before claiming success: URL/path/hash, title/h1, DOM state, scroll position, or focus changed as expected.",
        browser.evidenceRequired
          ? "Do not return complete or no_change for this browser-audit run until the evidence is captured or explain the missing evidence with ask_manager/fail."
          : "Browser evidence is optional for this run.",
      ].join("\n")
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
    "Workspace checkout preparation:",
    formatWorkspacePreparation(input.workspaceCheckouts),
    browserInstruction,
    "",
    "First classify the task's execution plane: GitHub API/MCP, workspace files/git, trigger/routing, or human/product decision.",
    "Use the workspace, git, MCP, and code execution tools as needed for the chosen execution plane.",
    "Use prepared checkout paths before cloning repositories yourself.",
    "Use Workspace read/list/grep/find for repository file review. Use execute with state.* and git.* for coordinated filesystem and git work.",
    "The execute tool runs Worker-compatible JavaScript, not a Node.js shell: do not use require(), child_process, or subprocess commands. Use state.* and git.* inside execute instead.",
    "Do not use GitHub MCP to read repository files, list commits, or list branches; reserve GitHub MCP for pull requests, metadata, issue comments, scoped issue filing, checks, and workflow status.",
    "Use Workspace git tools for repository changes and branch pushes.",
    "Use GitHub MCP for GitHub API tasks: finding existing PRs, creating PRs, updating PR metadata, reading PR details, reading check or workflow status, commenting on issues, and filing scoped follow-up issues.",
    "Do not use GitHub MCP file-write tools unless this Nanite was explicitly granted them. Do not merge pull requests unless this Nanite was explicitly granted merge authority.",
    "For GitHub changes, manage branches with git.* and pull requests with github.* instead of expecting SigVelo to publish a support lane for you.",
    "Before work that may open a PR, run a small github.* pull request lookup through execute; if GitHub MCP is unavailable, ask the manager before changing files.",
    "Reuse an existing open PR when that is the coherent review surface for your responsibility.",
    "When stacked PRs are useful: the bottom branch targets the repo default branch, each higher branch targets the branch below it, every PR stays small and independently reviewable, and every PR description includes stack ordering.",
    "For stacked PRs, use plain git branches and create each PR with github.* against the correct base branch.",
    "Never push directly to a default branch.",
    ...naniteGitSafetyInstructions,
    "When the work is complete, set outputUrl to the most useful result URL in the structured result: the primary PR, top PR, stack entrypoint, or another explicit output URL. If no URL exists, make the summary self-contained.",
    "If you hit roadblocks immediately or repeat materially similar failures, assume the Nanite may be misconfigured. Stop debugging and ask the manager or fail with the clearest blocker.",
    "When the attempt reaches an outcome, return exactly one structured result kind: complete, no_change, fail, or ask_manager.",
  ].join("\n");
}

function buildNaniteSystemPrompt(): string {
  return [
    "You are a SigVelo Nanite: a durable maintenance agent for one narrow responsibility inside a GitHub installation.",
    "Your transcript, workspace, and memory are durable. Keep durable memory compact and evidence-backed.",
    "Use nanite_task_context for the current manifest, repository scope, permission grants, generated trigger source, and active trigger payload.",
    "Use the smallest execution plane that can satisfy the run: github.* tools inside execute for pull requests, checks, issue comments, scoped issue filing, and metadata; Workspace for repository files, edits, and git; generated trigger context for event routing; manager request for missing authority or product decisions.",
    "Do not use github.* tools to inspect repository files, commits, or branches. Use Workspace read/list/grep/find and execute git tools so file evidence stays in the durable workspace.",
    "The execute tool runs Worker-compatible JavaScript with state.*, git.*, and (when GitHub permissions are granted) github.* providers. Use direct provider calls for common methods; use codemode.search/codemode.describe only when the method shape is unfamiliar. It is not a shell and cannot use require(), child_process, or subprocess commands.",
    'Common execute shapes: `await git.status({ dir })`, `await state.readFile({ path })`, `await github.list_pull_requests({ owner, repo, state: "open" })`.',
    "Use artifact_read for saved SigVelo tool-output artifacts such as toolout_...; do not look for those artifacts in the workspace.",
    "Keep GitHub-facing output concise. Keep detailed investigation in this transcript.",
    "",
    "Do not claim success without evidence. If authority, configuration, approval, or target scope is missing, ask the manager. If the target state is impossible or a deterministic tool/API error repeats, fail.",
    "Finish exactly once with a structured result: complete, no_change, fail, or ask_manager.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

type ScheduledTriggerPayload = {
  eventSource: NaniteScheduledEventSourceSpec;
};

/**
 * The methods this agent calls on its parent manager. The concrete DO stub
 * type expands the manager's full RPC graph and trips TS2589, so the cast is
 * confined to `parentManager()`.
 */
type ParentManagerRpc = {
  getSnapshot: () => Promise<NaniteManagerState>;
  startRun: (input: StartNaniteRunInput) => Promise<NaniteRunRecord>;
  dispatchRun: (input: { runId: string }) => Promise<NaniteRunRecord>;
  recordWorkflowResult: (input: {
    runId: string;
    naniteId: string;
    result: NaniteRunWorkflowResult;
  }) => Promise<NaniteRunRecord>;
  recordRunFailureWithoutWorkflowOutput: (input: {
    runId: string;
    error: string;
  }) => Promise<NaniteRunRecord>;
  recordRuntimeActivity: (input: RecordNaniteRuntimeActivityInput) => Promise<unknown>;
};

/**
 * Classifies a repository-checkout error as an infra/auth failure (fail the run) versus a repo
 * that is legitimately unavailable (advisory). git/isomorphic-git surface most failures as plain
 * Error with no typed taxonomy, so structural checks (AppError) are preferred and message checks
 * are the fallback for the auth signals git emits.
 */
function isInfraCheckoutFailure(error: unknown): boolean {
  if (error instanceof AppError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  // git-auth raises this sentinel when an in-scope repo could not be issued an installation token.
  if (message.includes("outside this Nanite's git scope")) {
    return true;
  }
  // GitHub auth rejection (bad/expired/forbidden installation token), mirroring git-auth's own check.
  return /\b(?:401|403)\b/.test(message) && /unauthori[sz]ed|forbidden/i.test(message);
}

export class SigveloNaniteAgent extends Think<Env, NaniteAgentState> {
  initialState: NaniteAgentState = createInitialNaniteAgentState();
  extensionLoader = this.env.LOADER;
  override maxSteps = naniteMaxSteps;
  override chatStreamStallTimeoutMs = naniteChatStreamStallTimeoutMs;
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
      // The manifest model is the single source of truth for this Nanite — used by
      // both interactive chat (here) and runs (getTurnModel). beforeTurn refreshes
      // it from the manager, so a model switch on the card applies on the next turn.
      modelId: this.state.manifest?.model,
    });
  }

  override getSystemPrompt(): string {
    return buildNaniteSystemPrompt();
  }

  override getSkills(): SkillSource[] {
    return [
      createNaniteWorkspaceSkillSource({
        workspace: this.workspace,
        sourceUrls: () => this.state.runtimeConfig?.skillUrls ?? [],
        beforeRefresh: () => this.refreshManifestFromManager(),
      }),
    ];
  }

  override configureSession(session: Session): Session {
    return session
      .withContext("nanite_identity", {
        description: "Stable SigVelo Nanite identity, tool routing rules, and run-output rules.",
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
              runtimeConfig: this.state.runtimeConfig,
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
    const browser = browserRuntimeConfig(this.state.runtimeConfig);
    const extensionTools = this.extensionManager
      ? {
          ...createExtensionTools({ manager: this.extensionManager }),
          ...this.extensionManager.getTools(),
        }
      : {};

    return {
      ...workspaceTools,
      execute: createExecuteTool(this, {
        tools: workspaceTools,
        connectors: [
          new ToolProviderConnector(this.ctx, this.createGitToolProvider()),
          new ToolProviderConnector(this.ctx, artifactStore.provider()),
          ...(githubMcpConnector ? [githubMcpConnector] : []),
        ],
        browser: browser ? this.env.BROWSER : undefined,
        session: browser ? { mode: "dynamic" as const } : undefined,
      }),
      ...extensionTools,
      artifact_read: tool({
        description:
          "Inspect saved SigVelo tool-output artifacts. With no args, lists current-run artifacts. With artifactId, reads a bounded slice. With pattern, grep-searches one artifact or all current-run artifacts.",
        inputSchema: naniteToolOutputArtifactReadInputSchema,
        execute: async (input) => artifactStore.readToolInput(input),
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
      this.setState({
        ...this.state,
        activeRunId: runId,
        updatedAt: nowIso(),
      });
    }

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
      // AI Gateway owns upstream-provider retries (NANITES_AI_GATEWAY_REQUEST_DEFAULTS); cap the
      // AI SDK's own retry so the two layers don't compound into ~10 attempts. 1 still covers a
      // transient worker→gateway transport blip.
      maxRetries: 1,
    };
  }

  override async beforeToolCall(ctx: ToolCallContext): Promise<void> {
    await this.reportRuntimeActivity("tool_calling", { toolName: ctx.toolName });
  }

  override async afterToolCall(ctx: ToolCallResultContext): Promise<void> {
    await this.reportRuntimeActivity("thinking", {
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

  override async onWorkflowComplete(
    workflowName: string,
    workflowId: string,
    result?: unknown,
  ): Promise<void> {
    if (workflowName !== NANITE_RUN_WORKFLOW_NAME) {
      return;
    }

    const parsed = naniteRunWorkflowResultSchema.safeParse(result);
    if (!parsed.success) {
      await this.projectWorkflowError(
        workflowId,
        `Nanite Run Workflow completed with invalid structured output: ${parsed.error.message}`,
      );
      return;
    }

    const naniteId = this.state.naniteId;
    if (!naniteId) {
      await this.projectWorkflowError(
        workflowId,
        "Nanite Run Workflow completed without Nanite state.",
      );
      return;
    }

    const manager = await this.parentManager();
    await manager.recordWorkflowResult({ runId: workflowId, naniteId, result: parsed.data });
    this.clearActiveWorkflowRun(workflowId);
  }

  override async onWorkflowError(
    workflowName: string,
    workflowId: string,
    error: string,
  ): Promise<void> {
    if (workflowName !== NANITE_RUN_WORKFLOW_NAME) {
      return;
    }

    await this.projectWorkflowError(
      workflowId,
      `Nanite Run Workflow failed before reporting structured output: ${error}`,
    );
  }

  // -------------------------------------------------------------------------
  // Run intake from the manager
  // -------------------------------------------------------------------------

  async startRunWorkflowFromManager(input: StartNaniteAgentInput): Promise<string> {
    this.acceptWorkflowRun(input);
    try {
      const runId = await this.runWorkflow<NaniteRunWorkflowParams>(
        NANITE_RUN_WORKFLOW_NAME,
        {
          runId: input.run.runId,
          managerName: input.managerName,
        },
        {
          id: input.run.runId,
          metadata: {
            naniteId: input.run.naniteId,
            triggerType: input.run.trigger.type,
            // Durable model snapshot: a Workflow can outlive the manager's capped run history,
            // so getTurnModel falls back to this when the run record has been evicted.
            modelId: input.run.model.effectiveModelId,
            gatewayId: input.run.model.effectiveGatewayId,
          },
        },
      );

      naniteLogger.info(LOG_EVENTS.NANITE_AGENT_RUN_SUBMITTED, {
        ...this.logContext(input.run.runId),
        [OTEL_ATTRS.NANITE_RUN_KEY]: input.run.triggerKey,
        [OTEL_ATTRS.NANITE_SUBMISSION_ID]: runId,
        source: "think_workflow",
      });
      return runId;
    } catch (error) {
      this.clearActiveWorkflowRun(input.run.runId);
      throw error;
    }
  }

  async prepareWorkflowRun(input: {
    managerName: string;
    runId: string;
    workspaceCheckouts?: NaniteWorkspaceCheckout[];
  }): Promise<string> {
    const { nanite, run } = await this.requireWorkflowRunContext(input);
    this.acceptWorkflowRun({ managerName: input.managerName, nanite, run });
    return buildRunPrompt({
      managerName: input.managerName,
      nanite,
      run,
      workspaceCheckouts: input.workspaceCheckouts,
    });
  }

  async prepareWorkflowWorkspace(input: {
    managerName: string;
    runId: string;
  }): Promise<NaniteWorkspaceCheckout[]> {
    const { nanite, run } = await this.requireWorkflowRunContext(input);
    this.acceptWorkflowRun({ managerName: input.managerName, nanite, run });

    const repositories = resolveNaniteGitHubPermissionRepositoryFullNames(nanite.manifest);
    if (!hasGitHubContentsPermission(nanite.manifest)) {
      return repositories.map((repository) => ({
        repository,
        dir: null,
        status: "skipped",
        error: "Manifest does not grant GitHub contents read/write permission.",
      }));
    }

    return Promise.all(
      repositories.map(async (repository): Promise<NaniteWorkspaceCheckout> => {
        try {
          return await this.prepareRepositoryCheckout(repository);
        } catch (error) {
          // Infra/auth failures (token issuance, missing installation, auth rejection) hard-fail
          // the run: a degraded workspace makes the model narrate an infra outage as if it were a
          // normal result. A repo that is legitimately unavailable (deleted/renamed/404) stays
          // advisory so the model can still proceed and explain the gap.
          if (isInfraCheckoutFailure(error)) {
            throw error;
          }
          return {
            repository,
            dir: null,
            status: "failed",
            error: describeError(error),
          };
        }
      }),
    );
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
    if (eventSource.type !== "schedule" && eventSource.type !== "scheduleEvery") {
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
    const manager = await this.parentManager();
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
      await manager.recordRunFailureWithoutWorkflowOutput({
        runId: run.runId,
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
  // Submission cancellation
  // -------------------------------------------------------------------------

  private resolveSubmissionRunId(submission: ThinkSubmissionInspection): string | null {
    const workflowPrompt = submission.metadata?.__thinkWorkflowPrompt;
    if (workflowPrompt && typeof workflowPrompt === "object" && !Array.isArray(workflowPrompt)) {
      const workflow = (workflowPrompt as { workflow?: unknown }).workflow;
      if (workflow && typeof workflow === "object" && !Array.isArray(workflow)) {
        const workflowId = (workflow as { id?: unknown }).id;
        if (typeof workflowId === "string") {
          return workflowId;
        }
      }
    }

    return null;
  }

  private async cancelRunSubmissions(runId: string, reason: string): Promise<void> {
    const submissions = await this.listSubmissions({ limit: 25 });
    const submissionIds = submissions
      .filter(
        (submission) =>
          (submission.status === "pending" || submission.status === "running") &&
          this.resolveSubmissionRunId(submission) === runId,
      )
      .map((submission) => submission.submissionId);
    await Promise.all(
      submissionIds.map((submissionId) => this.cancelSubmission(submissionId, reason)),
    );
  }

  // -------------------------------------------------------------------------
  // Debug + maintenance
  // -------------------------------------------------------------------------

  async inspectDebug(input: NaniteDebugInspectInput = {}): Promise<NaniteDebugInspectOutput> {
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

  async inspectRunWorkflow(input: { runId: string }): Promise<NaniteRunWorkflowInspection> {
    if (this.getWorkflow(input.runId)) {
      await this.getWorkflowStatus(NANITE_RUN_WORKFLOW_NAME, input.runId);
    }
    const workflow = this.getWorkflow(input.runId);
    return {
      workflow: workflow
        ? {
            workflowId: workflow.workflowId,
            workflowName: workflow.workflowName,
            status: workflow.status,
            metadata: workflow.metadata,
            error: workflow.error,
            createdAt: workflow.createdAt.toISOString(),
            updatedAt: workflow.updatedAt.toISOString(),
            completedAt: workflow.completedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  async terminateRunWorkflowFromManager(input: { runId: string; reason: string }): Promise<void> {
    const workflow = this.getWorkflow(input.runId);
    if (workflow && !terminalWorkflowStatuses.has(workflow.status)) {
      await this.terminateWorkflow(input.runId);
    }
    await this.cancelRunSubmissions(input.runId, input.reason);
    if (this.state.activeRunId === input.runId) {
      this.clearActiveWorkflowRun(input.runId);
    }
  }

  async resetDebugState(): Promise<NaniteDebugResetOutput> {
    await this.clearMessages();
    const deletedSubmissions = await this.deleteSubmissions({ limit: 500 });
    this.setState({
      ...this.state,
      activeRunId: null,
      updatedAt: nowIso(),
    });

    return {
      clearedMessages: true,
      deletedSubmissions,
    };
  }

  async maintainFromManager(input: {
    managerName: string;
    nanite: ManagedNanite;
    completedBeforeIso?: string;
    submissionDeleteLimit?: number;
  }): Promise<NaniteAgentMaintenanceOutput> {
    this.syncIdentityFromManager(input);
    const deletedSubmissions = await this.deleteSubmissions({
      completedBefore: parseOptionalAppIsoDate(input.completedBeforeIso, "completedBeforeIso"),
      limit: Math.min(Math.max(input.submissionDeleteLimit ?? 100, 1), 500),
    });

    return {
      activeRunId: this.state.activeRunId,
      deletedSubmissions,
    };
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

  private acceptWorkflowRun(input: StartNaniteAgentInput): void {
    const acceptedAt = nowIso();
    this.setState({
      version: NANITE_AGENT_STATE_VERSION,
      naniteId: input.nanite.manifest.id,
      managerName: input.managerName,
      manifest: input.nanite.manifest,
      runtimeConfig: input.nanite.runtimeConfig ?? null,
      activeRunId: input.run.runId,
      trigger: input.run.trigger,
      updatedAt: acceptedAt,
    });
    naniteLogger.info(LOG_EVENTS.NANITE_AGENT_RUN_ACCEPTED, {
      ...this.logContext(input.run.runId),
      [OTEL_ATTRS.NANITE_RUN_KEY]: input.run.triggerKey,
      [OTEL_ATTRS.NANITE_RUN_STATUS]: input.run.status,
      versionId: input.run.model.manifestVersionId,
    });
  }

  private async requireWorkflowRunContext(input: {
    managerName: string;
    runId: string;
  }): Promise<{ nanite: ManagedNanite; run: NaniteRunRecord }> {
    this.setState({
      ...this.state,
      managerName: input.managerName,
      updatedAt: nowIso(),
    });
    const manager = await this.parentManager();
    const snapshot = await manager.getSnapshot();
    const run = snapshot.runs[input.runId];
    if (!run) {
      throw new AppError("naniteRunNotFound", {
        details: { runId: input.runId },
        message: `Nanite run ${input.runId} was not found.`,
      });
    }
    const nanite = snapshot.nanites[run.naniteId];
    if (!nanite) {
      throw new AppError("naniteNotFound", {
        details: { naniteId: run.naniteId },
        message: `Nanite ${run.naniteId} was not found for run ${run.runId}.`,
      });
    }
    if (this.state.naniteId && this.state.naniteId !== run.naniteId) {
      throw new AppError("naniteRuntimeActivityMismatch", {
        details: {
          runId: input.runId,
          naniteId: this.state.naniteId,
          actualNaniteId: run.naniteId,
        },
        message: `Nanite run ${input.runId} belongs to ${run.naniteId}, not ${this.state.naniteId}`,
      });
    }

    return { nanite, run };
  }

  private clearActiveWorkflowRun(runId: string): void {
    if (this.state.activeRunId !== runId) {
      return;
    }
    this.setState({
      ...this.state,
      activeRunId: null,
      updatedAt: nowIso(),
    });
  }

  private async projectWorkflowError(runId: string, error: string): Promise<NaniteRunRecord> {
    const manager = await this.parentManager();
    const run = await manager.recordRunFailureWithoutWorkflowOutput({
      runId,
      error,
    });
    this.clearActiveWorkflowRun(runId);
    return run;
  }

  private async parentManager(): Promise<ParentManagerRpc> {
    const managerName = this.state.managerName ?? this.parentPath.at(-1)?.name;
    if (!managerName) {
      throw new AppError("naniteAgentManagerRequired");
    }

    return (await getAgentByName(
      this.env.SigveloNaniteManager,
      managerName,
    )) as unknown as ParentManagerRpc;
  }

  private requireManagerName(): string {
    const managerName = this.state.managerName ?? this.parentPath.at(-1)?.name;
    if (!managerName) {
      throw new AppError("naniteAgentManagerRequired");
    }
    return managerName;
  }

  private async readRun(runId: string | null): Promise<NaniteRunRecord | null> {
    if (!runId) {
      return null;
    }
    const manager = await this.parentManager();
    return (await manager.getSnapshot()).runs[runId] ?? null;
  }

  /**
   * Recover the run's model from the durable Workflow metadata captured at dispatch.
   * Used as a fallback when the manager has evicted the run record but the Workflow
   * (timeout: 7 days) is still running. Returns null if the workflow or fields are absent.
   */
  private readWorkflowRunModel(runId: string): { modelId: string; gatewayId: string } | null {
    const metadata = this.getWorkflow(runId)?.metadata;
    const modelId = metadata?.modelId;
    const gatewayId = metadata?.gatewayId;
    if (typeof modelId !== "string" || typeof gatewayId !== "string") {
      return null;
    }
    return { modelId, gatewayId };
  }

  syncIdentityFromManager(input: { managerName: string; nanite: ManagedNanite }): void {
    this.setState({
      ...this.state,
      naniteId: input.nanite.manifest.id,
      managerName: input.managerName,
      manifest: input.nanite.manifest,
      runtimeConfig: input.nanite.runtimeConfig ?? null,
      updatedAt: nowIso(),
    });
  }

  private async refreshManifestFromManager(): Promise<void> {
    const manager = await this.parentManager();
    const snapshot = await manager.getSnapshot();
    const nanite = snapshot.nanites[this.state.naniteId ?? this.name] ?? null;
    const manifest = nanite?.manifest ?? null;
    const runtimeConfig = nanite?.runtimeConfig ?? null;
    if (
      !manifest ||
      (JSON.stringify(manifest) === JSON.stringify(this.state.manifest) &&
        JSON.stringify(runtimeConfig) === JSON.stringify(this.state.runtimeConfig))
    ) {
      return;
    }

    this.setState({
      ...this.state,
      naniteId: manifest.id,
      managerName: this.requireManagerName(),
      manifest,
      runtimeConfig,
      updatedAt: nowIso(),
    });
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
      const manager = await this.parentManager();
      await manager.recordRuntimeActivity({
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
    // A Workflow can outlive the manager's capped run history (MAX_RUNS_IN_STATE). When the run
    // record has been evicted, recover the model from the durable workflow metadata captured at
    // dispatch instead of throwing and killing the in-flight turn.
    const workflowModel = runId && !run ? this.readWorkflowRunModel(runId) : null;
    if (runId && !run && !workflowModel) {
      throw new AppError("naniteRunNotFound", {
        details: { runId },
        message: `Nanite run ${runId} was not found.`,
      });
    }

    const runModel = run?.model;
    const modelId =
      runModel?.effectiveModelId ?? workflowModel?.modelId ?? this.state.manifest?.model;
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
      gatewayId: runModel?.effectiveGatewayId ?? workflowModel?.gatewayId ?? NANITES_AI_GATEWAY_ID,
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
    const aiGatewayLogId = this.env.AI?.aiGatewayLogId || undefined;
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

  private async prepareRepositoryCheckout(repository: string): Promise<NaniteWorkspaceCheckout> {
    const dir = githubRepositoryCheckoutDir(repository);
    const ownerDir = dir.split("/").slice(0, -1).join("/");
    await this.workspace.mkdir(ownerDir, { recursive: true });

    const git = gitCheckoutTools(this.createGitToolProvider());
    const existingConfig = await this.workspace.readFile(`${dir}/.git/config`);
    if (existingConfig) {
      const existingRepository = gitHubRepositoryFromGitConfig({
        config: existingConfig,
        remote: "origin",
      });
      if (existingRepository?.toLowerCase() !== repository.toLowerCase()) {
        throw new Error(
          `Existing checkout at ${dir} points to ${existingRepository ?? "unknown"}.`,
        );
      }
      await git.pull.execute({ dir });
      return { repository, dir, status: "fetched", error: null };
    }

    await git.clone.execute({
      url: `https://github.com/${repository}.git`,
      dir,
      depth: 1,
      singleBranch: true,
    });
    return { repository, dir, status: "cloned", error: null };
  }

  /**
   * GitHub MCP tools live inside the codemode sandbox as `github.*` —
   * discoverable via codemode.search and gated by Nanite-scoped GitHub grants.
   * Returns null when the manifest grants no GitHub MCP access.
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
          permissions: githubPermissions.appPermissions,
        });
        const headers: Record<string, string> = {
          Authorization: `Bearer ${scopedToken.token}`,
          "X-MCP-Toolsets": capability.toolsets.join(","),
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
      getAllowedRepositories: () =>
        this.state.manifest && hasGitHubContentsPermission(this.state.manifest)
          ? resolveNaniteGitHubPermissionRepositoryFullNames(this.state.manifest)
          : [],
      issueToken: ({ repository }) => this.issueGitToolToken(repository),
    });
  }

  private async issueGitToolToken(repository: string): Promise<string | null> {
    const identity = parseNaniteManagerKey(this.requireManagerName());
    const permissions = this.state.manifest?.permissions.github;
    if (!identity || !permissions) {
      return null;
    }

    const scopedToken = await issueScopedGitHubInstallationToken({
      env: this.env,
      githubAppId: identity.githubAppId,
      installationId: identity.githubInstallationId,
      repositories: [repository],
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
