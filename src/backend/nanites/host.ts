import { Agent, callable } from "agents";
import { githubInstallationIdSchema, type GitHubInstallationId } from "@nanites/contracts/ids";
import type { GitHubRawMessage } from "@chat-adapter/github";
import type { Author, Message, Thread } from "chat";
import { getLogger } from "@logtape/logtape";
import { LOG_EVENTS } from "@nanites/observability/log-events";
import { LOGGING } from "@nanites/observability/logging";
import { OTEL_ATTRS } from "@nanites/observability/otel-attrs";
import type { GitHubCheckRunConclusion } from "#/backend/github-checks.ts";
import type {
  GitHubAppPermissions,
  GitHubPullRequestTriggerAction,
  GitHubPullRequestWebhookPayload,
  GitHubPushWebhookPayload,
} from "#/backend/github-types.ts";
import { updateGitHubCheckRun } from "#/backend/github.ts";
import {
  SigveloNaniteAgent,
  type NaniteAgentMaintenanceInput,
  type NaniteAgentMaintenanceOutput,
  type NaniteDebugInspectInput,
  type NaniteDebugInspectOutput,
  type NaniteDebugResetOutput,
  type NaniteWorkspaceExploreInput,
  type NaniteWorkspaceExploreOutput,
  type StartNaniteAgentInput,
} from "#/backend/nanites/agent.ts";
import {
  resolveNaniteGitHubMcpCapability,
  type NaniteCapabilitySpec,
} from "#/backend/nanites/github-mcp-capabilities.ts";
import {
  getDispatchIntents,
  runGeneratedTrigger,
  validateGeneratedTriggerSource,
} from "#/backend/nanites/trigger-runtime.ts";
import {
  buildGitHubPullRequestFixture,
  buildGitHubPushFixture,
} from "#/backend/nanites/github-trigger-fixtures.ts";
import { assertNaniteRepositoriesBelongToInstallation } from "#/backend/nanites/repository-scope.ts";
import type {
  TriggerDispatchInput,
  TriggerGitHubCheckSurfaceRequest,
} from "#/backend/nanites/trigger-runtime.ts";
import {
  NANITE_MANUAL_RUN_TIMEOUT_MS,
  NANITE_TRIGGER_TEST_INSTRUCTION,
  NANITE_TRIGGER_TEST_TIMEOUT_MS,
  type StartNaniteManualRunInput,
  type StartNaniteManualRunOutput,
  type TestNaniteTriggerInput,
  type TestNaniteTriggerOutput,
} from "#/backend/orpc/contracts/nanites.ts";
import { NANITE_AGENT_NAME, NANITE_MANAGER_NAME } from "#/shared/constants/nanites.ts";
export {
  githubAppPermissionNames,
  githubPullRequestTriggerActions,
  type GitHubAppPermissionName,
  type GitHubAppPermissions,
  type GitHubPullRequestTriggerAction,
} from "#/backend/github-types.ts";

const MAX_RUNS_IN_STATE = 100;
const MAX_TRIGGER_DISPATCHES_PER_EVENT = 25;
const NANITE_MANAGER_MAINTENANCE_CRON = "0 8 * * *";
const NANITE_MANAGER_STALE_RUNNING_AFTER_MS = 24 * 60 * 60 * 1000;
const NANITE_MANAGER_TERMINAL_SUBMISSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const NANITE_MANAGER_MAINTENANCE_SUBMISSION_DELETE_LIMIT = 100;
const naniteManagerLogger = getLogger(LOGGING.NANITES_CATEGORY);

/**
 * This manager owns its state and callable inputs. Do not re-add mirrored Zod schemas,
 * defensive state validation, schemaVersion fields, caller-supplied timestamps/ids, or
 * per-MCP-tool permission knobs here. Validate untrusted boundaries in the MCP
 * registration/run-control tool layer, then keep this host focused on domain transitions.
 */

export const naniteRunStatuses = [
  "running",
  "waiting_for_human",
  "complete",
  "no_change",
  "fail",
  "canceled",
] as const;
export const naniteRuntimeActivityStates = [
  "idle",
  "thinking",
  "tool_calling",
  "waiting_for_human",
  "error",
] as const;
export const naniteDebugIncludeSections = [
  "nanites",
  "runs",
  "runtimeActivity",
  "manifest",
  "triggerSource",
  "transcript",
  "submissions",
] as const;
export type NaniteRunStatus = (typeof naniteRunStatuses)[number];
export type NaniteRuntimeActivityState = (typeof naniteRuntimeActivityStates)[number];
export type NaniteDebugIncludeSection = (typeof naniteDebugIncludeSections)[number];
export type NaniteRuntimeActivity = {
  state: NaniteRuntimeActivityState;
  runId: string | null;
  toolName: string | null;
  lastActivityAt: string | null;
  error: string | null;
};
export type UnreportedThinkSubmissionStatus = "completed" | "aborted" | "skipped" | "error";
export type TerminalNaniteRunStatus = Extract<
  NaniteRunStatus,
  "complete" | "no_change" | "fail" | "canceled"
>;
export type CompletableNaniteRunStatus = Exclude<TerminalNaniteRunStatus, "canceled">;

export type NaniteScheduleSpec =
  | {
      type: "scheduled";
      date: string;
    }
  | {
      type: "delayed";
      delayInSeconds: number;
    }
  | {
      type: "cron";
      cron: string;
    }
  | {
      type: "interval";
      intervalSeconds: number;
    };

export type NaniteTriggerSpec =
  | {
      type: "manual";
    }
  | {
      type: "schedule";
      schedule: NaniteScheduleSpec;
    }
  | {
      type: "github";
      event: "pull_request";
      repositories: Array<GitHubPullRequestWebhookPayload["repository"]["full_name"]>;
      actions: GitHubPullRequestTriggerAction[];
    }
  | {
      type: "github";
      event: "push";
      repository: GitHubPushWebhookPayload["repository"]["full_name"];
      branch: string;
    }
  | {
      type: "webhook";
      source: string;
    };

export type NaniteTriggerEvent =
  | {
      type: "manual";
      requestId: string;
      actorId: string | null;
      message?: string;
    }
  | {
      type: "schedule";
      schedule: NaniteScheduleSpec;
      scheduledAt: string;
      input?: TriggerDispatchInput;
    }
  | {
      type: "github";
      event: "pull_request";
      deliveryId: string;
      repository: GitHubPullRequestWebhookPayload["repository"]["full_name"];
      action: GitHubPullRequestTriggerAction;
      pullNumber: GitHubPullRequestWebhookPayload["pull_request"]["number"];
      headSha: GitHubPullRequestWebhookPayload["pull_request"]["head"]["sha"];
      input?: TriggerDispatchInput;
    }
  | {
      type: "github";
      event: "push";
      deliveryId: string;
      repository: GitHubPushWebhookPayload["repository"]["full_name"];
      branch: string;
      afterSha: GitHubPushWebhookPayload["after"];
      input?: TriggerDispatchInput;
    }
  | {
      type: "webhook";
      deliveryId: string;
      source: string;
    };

export type NanitePermissionSpec = {
  github?: {
    repositories: string[];
    appPermissions: GitHubAppPermissions;
  };
};

export type NaniteManifest = {
  id: string;
  name: string;
  description: string;
  trigger: NaniteTriggerSpec;
  inboundTrigger?: {
    sourceCode: string;
  };
  permissions: NanitePermissionSpec;
  capabilities?: NaniteCapabilitySpec;
};

export type NaniteSourceVersion = {
  versionId: string;
  manifestHash: string;
  registeredAt: string;
};

export type ManagedNanite = {
  manifest: NaniteManifest;
  latestVersion: NaniteSourceVersion;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HumanRequest = {
  id: string;
  summary: string;
  requestedScopes: string[];
  createdAt: string;
  resolvedAt: string | null;
};

export type NaniteAgentFeedback = {
  severity: "info" | "warning" | "error";
  message: string;
  suggestions?: string[];
};

export type NaniteGitHubCheckStatus =
  | "creating"
  | "in_progress"
  | "completed"
  | "create_failed"
  | "update_failed";

export type NaniteGitHubCheckSurface = {
  installationId: GitHubInstallationId;
  repository: GitHubPullRequestWebhookPayload["repository"]["full_name"];
  owner: string;
  repo: string;
  name: string;
  headSha: string;
  checkRunId: number | null;
  status: NaniteGitHubCheckStatus;
  conclusion: GitHubCheckRunConclusion | null;
  detailsUrl: string | null;
  outputTitle: string | null;
  outputSummary: string | null;
  outputText: string | null;
  startedAt: string;
  updatedAt: string;
};

export type NaniteRunRecord = {
  runId: string;
  naniteId: string;
  versionId: string;
  triggerKey: string;
  trigger: NaniteTriggerEvent;
  status: NaniteRunStatus;
  summary: string | null;
  outputUrl: string | null;
  agentFeedback: NaniteAgentFeedback | null;
  humanRequest: HumanRequest | null;
  githubCheck: NaniteGitHubCheckSurface | null;
  chatUrl: string;
  startedAt: string;
  dispatchError: string | null;
  updatedAt: string;
  completedAt: string | null;
};

export type NaniteManagerState = {
  nanites: Record<string, ManagedNanite>;
  runs: Record<string, NaniteRunRecord>;
  runOrder: string[];
  runtimeActivityByNanite: Record<string, NaniteRuntimeActivity>;
  updatedAt: string | null;
};

export type RegisterNaniteInput = {
  manifest: NaniteManifest;
  enabled?: boolean;
};

export type StartNaniteRunInput = {
  naniteId: string;
  trigger: NaniteTriggerEvent;
};

export type HandleGitHubPullRequestWebhookInput = {
  githubInstallationId: GitHubInstallationId;
  deliveryId: string | null;
  payload: GitHubPullRequestWebhookPayload;
  dispatchInput?: TriggerDispatchInput;
  onlyNaniteId?: string;
};

export type HandleGitHubPushWebhookInput = {
  githubInstallationId: GitHubInstallationId;
  deliveryId: string | null;
  payload: GitHubPushWebhookPayload;
  dispatchInput?: TriggerDispatchInput;
  onlyNaniteId?: string;
};

export type TestGeneratedTriggerInput =
  | {
      naniteId: string;
      event: {
        type: "github.pull_request";
        deliveryId: string | null;
        payload: GitHubPullRequestWebhookPayload;
      };
    }
  | {
      naniteId: string;
      event: {
        type: "github.push";
        deliveryId: string | null;
        payload: GitHubPushWebhookPayload;
      };
    };

export type TestGeneratedTriggerOutput = {
  ok: boolean;
  hasGeneratedTrigger: boolean;
  accepted: boolean;
  error: string | null;
};

export type GitHubPullRequestWebhookRunDispatch = {
  run: NaniteRunRecord;
  created: boolean;
  githubCheckSurface: TriggerGitHubCheckSurfaceRequest | null;
};

export type DispatchNaniteRunInput = {
  runId: string;
};

export type GitHubManagerChatThread = Thread<Record<string, unknown>, GitHubRawMessage>;
export type GitHubManagerChatMessage = Message<GitHubRawMessage>;
export type GitHubManagerChatAuthor = Pick<Author, "isBot" | "userId" | "userName">;
export type GitHubManagerThreadType =
  | NonNullable<Extract<GitHubRawMessage, { type: "issue_comment" }>["threadType"]>
  | "review_comment";

export type HandleManagerChatMessageInput = {
  installationId: GitHubInstallationId;
  surface: {
    type: "github";
    threadId: GitHubManagerChatThread["id"];
    messageId: GitHubManagerChatMessage["id"];
    repository: GitHubRawMessage["repository"]["full_name"];
    prNumber: GitHubRawMessage["prNumber"];
    threadType: GitHubManagerThreadType;
  };
  author: GitHubManagerChatAuthor;
  text: string;
};

export type HandleManagerChatMessageOutput = {
  replyMarkdown: string;
};

type NaniteAgentDispatchClient = {
  enqueueFromManager(input: StartNaniteAgentInput): Promise<void>;
  cancelRunFromManager(input: { runId: string; reason: string }): Promise<void>;
  syncScheduleFromManager(input: { managerName: string; nanite: ManagedNanite }): Promise<void>;
  maintainFromManager(input: NaniteAgentMaintenanceInput): Promise<NaniteAgentMaintenanceOutput>;
};

type NaniteAgentDebugClient = {
  inspectDebug(input?: NaniteDebugInspectInput): Promise<NaniteDebugInspectOutput>;
  exploreWorkspace(input: NaniteWorkspaceExploreInput): Promise<NaniteWorkspaceExploreOutput>;
  resetDebugState(): Promise<NaniteDebugResetOutput>;
};

export type InspectNaniteDebugInput = {
  naniteId?: string;
  runId?: string;
  status?: NaniteRunStatus | NaniteRunStatus[];
  activity?: NaniteRuntimeActivityState | NaniteRuntimeActivityState[];
  limit?: number;
  include?: NaniteDebugIncludeSection[];
  transcript?: NaniteDebugInspectInput["transcript"];
  submissions?: NaniteDebugInspectInput["submissions"];
};

export type ResetNaniteDebugInput = {
  naniteId: string;
};

export type ResetNaniteDebugOutput = {
  managerName: string;
  naniteId: string;
  reset: NaniteDebugResetOutput;
};

export type InspectNaniteDebugOutput = {
  managerName: string;
  nanites?: ManagedNanite[];
  runs?: NaniteRunRecord[];
  runtimeActivity?: Record<string, NaniteRuntimeActivity>;
  manifest?: NaniteManifest | null;
  triggerSource?: string | null;
  think?: NaniteDebugInspectOutput | null;
};

export type ExploreNaniteWorkspaceInput = {
  naniteId: string;
} & NaniteWorkspaceExploreInput;

export type CancelNaniteRunsInput = {
  runIds?: string[];
  naniteId?: string;
  olderThanIso?: string;
  limit?: number;
  reason: string;
};

export type CancelNaniteRunsOutput = {
  canceledRuns: NaniteRunRecord[];
  skippedRuns: Array<{
    runId: string;
    reason: string;
  }>;
};

export type NaniteManagerMaintenanceInput = {
  nowIso?: string;
  staleRunningAfterMs?: number;
  terminalSubmissionRetentionMs?: number;
  runCancelLimit?: number;
  submissionDeleteLimitPerNanite?: number;
};

export type NaniteManagerMaintenanceOutput = {
  checkedAt: string;
  staleRunningCutoffIso: string;
  terminalSubmissionCutoffIso: string;
  registeredNaniteIds: string[];
  waitingForHumanRunIds: string[];
  canceledRuns: NaniteRunRecord[];
  skippedRuns: CancelNaniteRunsOutput["skippedRuns"];
  deletedOrphanedSubAgentNames: string[];
  maintainedNaniteAgents: Array<
    NaniteAgentMaintenanceOutput & {
      naniteId: string;
    }
  >;
  resyncedNaniteIds: string[];
  failedNaniteAgentMaintenance: Array<{
    naniteId: string;
    error: string;
  }>;
  failedNaniteSyncs: Array<{
    naniteId: string;
    error: string;
  }>;
};

export type DeprovisionNanitesInput = {
  naniteIds: string[];
  reason: string;
};

export type DeprovisionNanitesOutput = {
  deprovisionedNaniteIds: string[];
  removedRunIds: string[];
  skippedNaniteIds: Array<{
    naniteId: string;
    reason: string;
  }>;
};

export type ClaimGitHubCheckCreationInput = {
  runId: string;
  installationId: GitHubInstallationId;
  repository: GitHubPullRequestWebhookPayload["repository"]["full_name"];
  owner: string;
  repo: string;
  name: string;
  headSha: string;
  detailsUrl: string | null;
};

export type AttachGitHubCheckInput = {
  runId: string;
  checkRunId: number;
  detailsUrl: string | null;
  outputTitle: string;
  outputSummary: string;
  outputText: string;
};

export type RecordGitHubCheckFailureInput = {
  runId: string;
  status: Extract<NaniteGitHubCheckStatus, "create_failed" | "update_failed">;
  summary: string;
};

export type CompleteNaniteRunInput = {
  runId: string;
  status: CompletableNaniteRunStatus;
  summary: string;
  outputUrl?: string | null;
  agentFeedback?: NaniteAgentFeedback | null;
};

export type FailNaniteRunInput = {
  runId: string;
  summary: string;
};

export type AskHumanInput = {
  runId: string;
  summary: string;
  requestedScopes?: string[];
};

export type ResumeNaniteRunInput = {
  runId: string;
};

export type RecordUnreportedRunCompletionInput = {
  runId: string;
  status: UnreportedThinkSubmissionStatus;
  error?: string;
};

export type RecordNaniteRuntimeActivityInput = {
  naniteId: string;
  runId: string | null;
  state: NaniteRuntimeActivityState;
  toolName?: string | null;
  error?: string | null;
};

const allowedRunStatusTransitions: Record<NaniteRunStatus, readonly NaniteRunStatus[]> = {
  running: ["waiting_for_human", "complete", "no_change", "fail", "canceled"],
  waiting_for_human: ["running", "complete", "no_change", "fail", "canceled"],
  complete: [],
  no_change: [],
  fail: [],
  canceled: [],
};
const terminalRunStatuses = new Set<NaniteRunStatus>(["complete", "no_change", "fail", "canceled"]);

function isTerminalNaniteRunStatus(status: NaniteRunStatus): status is TerminalNaniteRunStatus {
  return terminalRunStatuses.has(status);
}

export function createInitialNaniteManagerState(): NaniteManagerState {
  return {
    nanites: {},
    runs: {},
    runOrder: [],
    runtimeActivityByNanite: {},
    updatedAt: null,
  };
}

export function assertNaniteRunStatusTransition(
  currentStatus: NaniteRunStatus,
  nextStatus: NaniteRunStatus,
): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!allowedRunStatusTransitions[currentStatus].includes(nextStatus)) {
    throw new Error(`Invalid Nanite run transition: ${currentStatus} -> ${nextStatus}`);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function getGitHubInstallationIdFromManagerName(managerName: string): GitHubInstallationId | null {
  const [, rawInstallationId] = /^installation:(\d+)$/.exec(managerName) ?? [];
  if (!rawInstallationId) {
    return null;
  }

  return githubInstallationIdSchema.parse(Number(rawInstallationId));
}

function parseIsoDate(value: string, fieldName: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO date.`);
  }
  return date;
}

function requireNonNegativeMs(
  value: number | undefined,
  fallback: number,
  fieldName: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error(`${fieldName} must be a non-negative number.`);
  }
  return resolved;
}

function clampMaintenanceSubmissionDeleteLimit(value: number | undefined): number {
  return Math.min(Math.max(value ?? NANITE_MANAGER_MAINTENANCE_SUBMISSION_DELETE_LIMIT, 1), 500);
}

function buildMaintenanceCutoffIso(checkedAt: Date, ageMs: number): string {
  return new Date(checkedAt.getTime() - ageMs).toISOString();
}

function shouldResyncNaniteDuringMaintenance(nanite: ManagedNanite): boolean {
  const trigger = nanite.manifest.trigger;
  if (trigger.type !== "schedule") {
    return true;
  }

  if (!nanite.enabled) {
    return true;
  }

  return trigger.schedule.type === "cron" || trigger.schedule.type === "interval";
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    );
  }

  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function createNaniteSourceVersion(
  manifest: NaniteManifest,
  registeredAt: string,
): Promise<NaniteSourceVersion> {
  const manifestHash = await sha256(stableJson(manifest));
  return {
    versionId: `manifest-${manifestHash.slice(0, 12)}`,
    manifestHash,
    registeredAt,
  };
}

function trimRecordByOrder<T>(
  records: Record<string, T>,
  order: readonly string[],
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const id of order) {
    const record = records[id];
    if (record !== undefined) {
      next[id] = record;
    }
  }
  return next;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function formatError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function formatCompactError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getTriggerEventName(trigger: NaniteTriggerEvent): string {
  if (trigger.type === "github") {
    return trigger.event;
  }

  return trigger.type;
}

function createManagerLogContext(
  managerName: string,
  values: {
    naniteId?: string | null;
    run?: NaniteRunRecord | null;
    runId?: string | null;
    trigger?: NaniteTriggerEvent | null;
  } = {},
) {
  const trigger = values.trigger ?? values.run?.trigger ?? null;
  return {
    [OTEL_ATTRS.AGENT_CLASS]: "SigveloNaniteManager",
    [OTEL_ATTRS.AGENT_NAME]: managerName,
    [OTEL_ATTRS.NANITE_MANAGER_NAME]: managerName,
    [OTEL_ATTRS.NANITE_ID]: values.naniteId ?? values.run?.naniteId ?? undefined,
    [OTEL_ATTRS.NANITE_RUN_ID]: values.runId ?? values.run?.runId ?? undefined,
    [OTEL_ATTRS.NANITE_RUN_KEY]: values.run?.triggerKey,
    [OTEL_ATTRS.NANITE_RUN_STATUS]: values.run?.status,
    [OTEL_ATTRS.NANITE_TRIGGER_TYPE]: trigger?.type,
    [OTEL_ATTRS.NANITE_TRIGGER_EVENT]: trigger ? getTriggerEventName(trigger) : undefined,
  };
}

function buildTriggerKey(input: StartNaniteRunInput): string {
  const trigger = input.trigger;
  switch (trigger.type) {
    case "manual":
      return `${input.naniteId}:manual:${trigger.requestId}`;
    case "schedule":
      return `${input.naniteId}:schedule:${JSON.stringify(trigger.schedule)}:${trigger.scheduledAt}`;
    case "github":
      switch (trigger.event) {
        case "pull_request":
          return [
            input.naniteId,
            "github",
            trigger.event,
            trigger.repository,
            trigger.pullNumber,
            trigger.action,
            trigger.headSha,
          ].join(":");
        case "push":
          return [
            input.naniteId,
            "github",
            trigger.event,
            trigger.repository,
            trigger.branch,
            trigger.afterSha,
          ].join(":");
      }
    case "webhook":
      return `${input.naniteId}:webhook:${trigger.source}:${trigger.deliveryId}`;
  }
}

function githubPullRequestTriggerMatches(
  trigger: NaniteTriggerSpec,
  payload: GitHubPullRequestWebhookPayload,
): boolean {
  return (
    trigger.type === "github" &&
    trigger.event === "pull_request" &&
    trigger.repositories.includes(payload.repository.full_name) &&
    trigger.actions.includes(payload.action)
  );
}

function githubPushBranch(payload: GitHubPushWebhookPayload): string {
  return payload.ref.replace(/^refs\/heads\//, "");
}

function githubPushTriggerMatches(
  trigger: NaniteTriggerSpec,
  payload: GitHubPushWebhookPayload,
): boolean {
  return (
    trigger.type === "github" &&
    trigger.event === "push" &&
    trigger.repository === payload.repository.full_name &&
    trigger.branch === githubPushBranch(payload)
  );
}

function buildGitHubPullRequestTriggerEvent(input: {
  deliveryId: string | null;
  payload: GitHubPullRequestWebhookPayload;
  dispatchInput?: TriggerDispatchInput;
}): Extract<NaniteTriggerEvent, { type: "github"; event: "pull_request" }> {
  return {
    type: "github",
    event: "pull_request",
    deliveryId: input.deliveryId ?? crypto.randomUUID(),
    repository: input.payload.repository.full_name,
    action: input.payload.action,
    pullNumber: input.payload.pull_request.number,
    headSha: input.payload.pull_request.head.sha,
    ...(input.dispatchInput === undefined ? {} : { input: input.dispatchInput }),
  };
}

function buildGitHubPushTriggerEvent(input: {
  deliveryId: string | null;
  payload: GitHubPushWebhookPayload;
  dispatchInput?: TriggerDispatchInput;
}): Extract<NaniteTriggerEvent, { type: "github"; event: "push" }> {
  return {
    type: "github",
    event: "push",
    deliveryId: input.deliveryId ?? crypto.randomUUID(),
    repository: input.payload.repository.full_name,
    branch: githubPushBranch(input.payload),
    afterSha: input.payload.after,
    ...(input.dispatchInput === undefined ? {} : { input: input.dispatchInput }),
  };
}

function getExistingRunByTriggerKey(
  state: NaniteManagerState,
  triggerKey: string,
): NaniteRunRecord | null {
  for (const runId of state.runOrder) {
    const run = state.runs[runId];
    if (run?.triggerKey === triggerKey) {
      return run;
    }
  }

  return null;
}

function naniteShouldCreateGitHubCheck(nanite: ManagedNanite): boolean {
  return nanite.manifest.permissions.github?.appPermissions?.checks === "write";
}

function buildDefaultGitHubCheckName(nanite: ManagedNanite): string {
  return nanite.manifest.name.trim() || nanite.manifest.id;
}

function buildGitHubCheckName(input: { surfaceName?: string; nanite: ManagedNanite }): string {
  const requestedName = input.surfaceName?.trim();
  return (requestedName || buildDefaultGitHubCheckName(input.nanite)).slice(0, 100);
}

function resolveRequestedGitHubCheckSurface(input: {
  nanite: ManagedNanite;
  requestedSurfaces?: readonly TriggerGitHubCheckSurfaceRequest[];
  repository: string;
  headSha: string;
}): TriggerGitHubCheckSurfaceRequest | null {
  if (input.requestedSurfaces === undefined) {
    return naniteShouldCreateGitHubCheck(input.nanite)
      ? {
          type: "github_check",
          repository: input.repository,
          headSha: input.headSha,
          name: buildDefaultGitHubCheckName(input.nanite),
        }
      : null;
  }

  const requestedCheck = input.requestedSurfaces.find((surface) => surface.type === "github_check");
  if (!requestedCheck || !naniteShouldCreateGitHubCheck(input.nanite)) {
    return null;
  }

  const allowedRepositories = input.nanite.manifest.permissions.github?.repositories ?? [];
  if (
    requestedCheck.repository !== input.repository ||
    requestedCheck.headSha !== input.headSha ||
    !allowedRepositories.includes(requestedCheck.repository)
  ) {
    return null;
  }

  return {
    type: "github_check",
    repository: requestedCheck.repository,
    headSha: requestedCheck.headSha,
    name: buildGitHubCheckName({
      surfaceName: requestedCheck.name,
      nanite: input.nanite,
    }),
  };
}

function countActiveRunsForNanite(state: NaniteManagerState, naniteId: string): number {
  return state.runOrder.reduce((count, runId) => {
    const run = state.runs[runId];
    return run?.naniteId === naniteId && !isTerminalNaniteRunStatus(run.status) ? count + 1 : count;
  }, 0);
}

function getRunOrThrow(state: NaniteManagerState, runId: string): NaniteRunRecord {
  const run = state.runs[runId];
  if (!run) {
    throw new Error(`Unknown Nanite run: ${runId}`);
  }

  return run;
}

function asSet<T extends string>(value: T | T[] | undefined): Set<T> | null {
  if (!value) {
    return null;
  }
  return new Set(Array.isArray(value) ? value : [value]);
}

function getIncludedDebugSections(input: InspectNaniteDebugInput): Set<string> {
  return new Set(input.include ?? ["nanites", "runs", "runtimeActivity"]);
}

function filterDebugRuns(
  state: NaniteManagerState,
  input: InspectNaniteDebugInput,
): NaniteRunRecord[] {
  const statuses = asSet(input.status);
  const limit = Math.min(Math.max(input.limit ?? 25, 1), MAX_RUNS_IN_STATE);
  return state.runOrder
    .flatMap((runId) => {
      const run = state.runs[runId];
      return run ? [run] : [];
    })
    .filter((run) => !input.naniteId || run.naniteId === input.naniteId)
    .filter((run) => !input.runId || run.runId === input.runId)
    .filter((run) => !statuses || statuses.has(run.status))
    .slice(0, limit);
}

function filterRuntimeActivity(
  state: NaniteManagerState,
  input: InspectNaniteDebugInput,
): Record<string, NaniteRuntimeActivity> {
  const activities = asSet(input.activity);
  return Object.fromEntries(
    Object.entries(state.runtimeActivityByNanite)
      .filter(([naniteId]) => !input.naniteId || input.naniteId === naniteId)
      .filter(([, activity]) => !input.runId || activity.runId === input.runId)
      .filter(([, activity]) => !activities || activities.has(activity.state)),
  );
}

function buildNaniteChatUrl(input: { managerName: string; naniteId: string }): string {
  return `/agents/${NANITE_MANAGER_NAME}/${encodeURIComponent(input.managerName)}/sub/${encodeURIComponent(NANITE_AGENT_NAME)}/${encodeURIComponent(input.naniteId)}`;
}

function buildTerminalGitHubCheckConclusion(
  status: TerminalNaniteRunStatus,
): GitHubCheckRunConclusion {
  switch (status) {
    case "complete":
      return "success";
    case "no_change":
      return "neutral";
    case "fail":
      return "failure";
    case "canceled":
      return "cancelled";
  }
}

function buildTerminalGitHubCheckOutput(run: NaniteRunRecord) {
  const summary = run.summary ?? "Nanite run finished.";
  const detailsLine = run.githubCheck?.detailsUrl
    ? `Live Sigvelo run: ${run.githubCheck.detailsUrl}`
    : `Live Sigvelo Nanite chat: ${run.chatUrl}`;

  return {
    title: `${run.naniteId}: ${run.status}`,
    summary,
    text: [summary, "", detailsLine].join("\n"),
  };
}

function updateRun(
  state: NaniteManagerState,
  runId: string,
  updater: (run: NaniteRunRecord) => NaniteRunRecord,
): NaniteManagerState {
  const nextRun = updater(getRunOrThrow(state, runId));

  return {
    ...state,
    runs: {
      ...state.runs,
      [runId]: nextRun,
    },
    updatedAt: nextRun.updatedAt,
  };
}

function updateRuntimeActivity(
  state: NaniteManagerState,
  naniteId: string,
  activity: NaniteRuntimeActivity,
  observedAt: string,
): NaniteManagerState {
  return {
    ...state,
    runtimeActivityByNanite: {
      ...state.runtimeActivityByNanite,
      [naniteId]: activity,
    },
    updatedAt: observedAt,
  };
}

function renderManagerChatReply(input: {
  message: HandleManagerChatMessageInput;
  state: NaniteManagerState;
}): string {
  const nanites = Object.values(input.state.nanites);
  const repositoryNanites = nanites.filter((nanite) =>
    nanite.manifest.permissions.github?.repositories.includes(input.message.surface.repository),
  );
  const activeRuns = input.state.runOrder
    .map((runId) => input.state.runs[runId])
    .filter((run) => run && !isTerminalNaniteRunStatus(run.status))
    .slice(0, 5);
  const lines = [`Sigvelo manager received this in \`${input.message.surface.repository}\`.`, ""];

  if (repositoryNanites.length === 0) {
    lines.push("No Nanites are currently scoped to this repository.");
  } else {
    lines.push(
      `Nanites scoped here: ${repositoryNanites
        .slice(0, 8)
        .map((nanite) => `\`${nanite.manifest.id}\``)
        .join(", ")}.`,
    );
  }

  if (activeRuns.length === 0) {
    lines.push("No active Nanite runs are currently tracked for this installation.");
  } else {
    lines.push(
      "Active runs:",
      ...activeRuns.map(
        (run) => `- \`${run.naniteId}\` is \`${run.status}\` (${run.summary ?? "working"})`,
      ),
    );
  }

  return lines.join("\n");
}

export class SigveloNaniteManager extends Agent<Env, NaniteManagerState> {
  initialState: NaniteManagerState = createInitialNaniteManagerState();

  override async onStart(): Promise<void> {
    await this.schedule(NANITE_MANAGER_MAINTENANCE_CRON, "maintainNanites", {});
  }

  async onRequest(): Promise<Response> {
    return Response.json(await this.getSnapshot());
  }

  @callable()
  async getSnapshot(): Promise<NaniteManagerState> {
    return this.state;
  }

  @callable()
  async handleChatMessage(
    input: HandleManagerChatMessageInput,
  ): Promise<HandleManagerChatMessageOutput> {
    return {
      replyMarkdown: renderManagerChatReply({
        message: input,
        state: await this.getSnapshot(),
      }),
    };
  }

  @callable()
  async maintainNanites(
    input: NaniteManagerMaintenanceInput | null = {},
  ): Promise<NaniteManagerMaintenanceOutput> {
    const options = input ?? {};
    const checkedAtDate = options.nowIso ? parseIsoDate(options.nowIso, "nowIso") : new Date();
    const checkedAt = checkedAtDate.toISOString();
    const staleRunningAfterMs = requireNonNegativeMs(
      options.staleRunningAfterMs,
      NANITE_MANAGER_STALE_RUNNING_AFTER_MS,
      "staleRunningAfterMs",
    );
    const terminalSubmissionRetentionMs = requireNonNegativeMs(
      options.terminalSubmissionRetentionMs,
      NANITE_MANAGER_TERMINAL_SUBMISSION_RETENTION_MS,
      "terminalSubmissionRetentionMs",
    );
    const staleRunningCutoffIso = buildMaintenanceCutoffIso(checkedAtDate, staleRunningAfterMs);
    const terminalSubmissionCutoffIso = buildMaintenanceCutoffIso(
      checkedAtDate,
      terminalSubmissionRetentionMs,
    );
    const snapshot = await this.getSnapshot();
    const registeredNanites = Object.values(snapshot.nanites);
    const registeredNaniteIds = registeredNanites.map((nanite) => nanite.manifest.id);
    const waitingForHumanRunIds = snapshot.runOrder.filter((runId) => {
      const run = snapshot.runs[runId];
      return run?.status === "waiting_for_human" && run.updatedAt < staleRunningCutoffIso;
    });
    const deletedOrphanedSubAgentNames: string[] = [];

    for (const child of this.listSubAgents(SigveloNaniteAgent)) {
      if (snapshot.nanites[child.name]) {
        continue;
      }

      await this.deleteSubAgent(SigveloNaniteAgent, child.name);
      deletedOrphanedSubAgentNames.push(child.name);
    }

    const { canceledRuns, skippedRuns } = await this.cancelRuns({
      olderThanIso: staleRunningCutoffIso,
      limit: options.runCancelLimit,
      reason: `Nanite manager maintenance canceled a stale running run older than ${staleRunningCutoffIso}.`,
    });
    const submissionDeleteLimit = clampMaintenanceSubmissionDeleteLimit(
      options.submissionDeleteLimitPerNanite,
    );
    const maintainedNaniteAgents: NaniteManagerMaintenanceOutput["maintainedNaniteAgents"] = [];
    const failedNaniteAgentMaintenance: NaniteManagerMaintenanceOutput["failedNaniteAgentMaintenance"] =
      [];
    const resyncedNaniteIds: string[] = [];
    const failedNaniteSyncs: NaniteManagerMaintenanceOutput["failedNaniteSyncs"] = [];

    for (const nanite of registeredNanites) {
      const naniteId = nanite.manifest.id;
      let agent: NaniteAgentDispatchClient;

      try {
        agent = await this.subAgent(SigveloNaniteAgent, naniteId);
      } catch (error) {
        failedNaniteAgentMaintenance.push({
          naniteId,
          error: `subAgent failed: ${formatCompactError(error)}`,
        });
        continue;
      }

      try {
        const maintenance = await agent.maintainFromManager({
          managerName: this.name,
          nanite,
          completedBeforeIso: terminalSubmissionCutoffIso,
          submissionDeleteLimit,
        });
        maintainedNaniteAgents.push({ naniteId, ...maintenance });
      } catch (error) {
        failedNaniteAgentMaintenance.push({
          naniteId,
          error: formatCompactError(error),
        });
      }

      if (!shouldResyncNaniteDuringMaintenance(nanite)) {
        continue;
      }

      try {
        await agent.syncScheduleFromManager({
          managerName: this.name,
          nanite,
        });
        resyncedNaniteIds.push(naniteId);
      } catch (error) {
        failedNaniteSyncs.push({
          naniteId,
          error: formatCompactError(error),
        });
      }
    }

    const output: NaniteManagerMaintenanceOutput = {
      checkedAt,
      staleRunningCutoffIso,
      terminalSubmissionCutoffIso,
      registeredNaniteIds,
      waitingForHumanRunIds,
      canceledRuns,
      skippedRuns,
      deletedOrphanedSubAgentNames,
      maintainedNaniteAgents,
      resyncedNaniteIds,
      failedNaniteAgentMaintenance,
      failedNaniteSyncs,
    };

    naniteManagerLogger.info(LOG_EVENTS.NANITE_MANAGER_MAINTENANCE_COMPLETED, {
      ...createManagerLogContext(this.name),
      checkedAt,
      staleRunningCutoffIso,
      terminalSubmissionCutoffIso,
      registeredNaniteCount: registeredNaniteIds.length,
      canceledRunCount: canceledRuns.length,
      waitingForHumanRunCount: waitingForHumanRunIds.length,
      deletedOrphanedSubAgentCount: deletedOrphanedSubAgentNames.length,
      maintainedNaniteAgentCount: maintainedNaniteAgents.length,
      resyncedNaniteCount: resyncedNaniteIds.length,
      failedNaniteAgentMaintenanceCount: failedNaniteAgentMaintenance.length,
      failedNaniteSyncCount: failedNaniteSyncs.length,
    });

    return output;
  }

  @callable()
  async inspectNaniteDebug(input: InspectNaniteDebugInput = {}): Promise<InspectNaniteDebugOutput> {
    const snapshot = await this.getSnapshot();
    const include = getIncludedDebugSections(input);
    const output: InspectNaniteDebugOutput = {
      managerName: this.name,
    };
    const runs = filterDebugRuns(snapshot, input);
    const selectedNaniteId = input.naniteId ?? runs[0]?.naniteId ?? null;
    const selectedNanite = selectedNaniteId ? (snapshot.nanites[selectedNaniteId] ?? null) : null;

    if (include.has("nanites")) {
      output.nanites = Object.values(snapshot.nanites).filter(
        (nanite) => !input.naniteId || nanite.manifest.id === input.naniteId,
      );
    }
    if (include.has("runs")) {
      output.runs = runs;
    }
    if (include.has("runtimeActivity")) {
      output.runtimeActivity = filterRuntimeActivity(snapshot, input);
    }
    if (include.has("manifest")) {
      output.manifest = selectedNanite?.manifest ?? null;
    }
    if (include.has("triggerSource")) {
      output.triggerSource = selectedNanite?.manifest.inboundTrigger?.sourceCode ?? null;
    }
    if (include.has("transcript") || include.has("submissions")) {
      if (!selectedNaniteId || !selectedNanite) {
        output.think = null;
      } else {
        const agent = await this.subAgent(SigveloNaniteAgent, selectedNaniteId);
        output.think = await (agent as NaniteAgentDebugClient).inspectDebug({
          transcript: include.has("transcript") ? input.transcript : false,
          submissions: include.has("submissions") ? input.submissions : false,
        });
      }
    }

    return output;
  }

  @callable()
  async exploreNaniteWorkspace(
    input: ExploreNaniteWorkspaceInput,
  ): Promise<NaniteWorkspaceExploreOutput> {
    const snapshot = await this.getSnapshot();
    if (!snapshot.nanites[input.naniteId]) {
      throw new Error(`Unknown Nanite: ${input.naniteId}`);
    }

    const agent = await this.subAgent(SigveloNaniteAgent, input.naniteId);
    const { naniteId: _naniteId, ...workspaceInput } = input;
    return (agent as NaniteAgentDebugClient).exploreWorkspace(workspaceInput);
  }

  @callable()
  async resetNaniteDebug(input: ResetNaniteDebugInput): Promise<ResetNaniteDebugOutput> {
    const snapshot = await this.getSnapshot();
    if (!snapshot.nanites[input.naniteId]) {
      throw new Error(`Unknown Nanite: ${input.naniteId}`);
    }

    const agent = await this.subAgent(SigveloNaniteAgent, input.naniteId);
    return {
      managerName: this.name,
      naniteId: input.naniteId,
      reset: await (agent as NaniteAgentDebugClient).resetDebugState(),
    };
  }

  @callable()
  async testGeneratedTrigger(
    input: TestGeneratedTriggerInput,
  ): Promise<TestGeneratedTriggerOutput> {
    const snapshot = await this.getSnapshot();
    const nanite = snapshot.nanites[input.naniteId];
    if (!nanite) {
      throw new Error(`Unknown Nanite: ${input.naniteId}`);
    }

    const triggerSource = nanite.manifest.inboundTrigger?.sourceCode;
    if (!triggerSource) {
      naniteManagerLogger.info(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
        ...createManagerLogContext(this.name, { naniteId: input.naniteId }),
        [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: true,
        [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 1,
        hasGeneratedTrigger: false,
        test: true,
        eventType: input.event.type,
      });
      return { ok: true, hasGeneratedTrigger: false, accepted: true, error: null };
    }

    const triggerResult = await runGeneratedTrigger({
      loader: this.env.LOADER,
      sourceCode: triggerSource,
      cacheKey: `${this.name}:${nanite.manifest.id}:${nanite.latestVersion.manifestHash}:${input.event.type}:test`,
      event: input.event,
    });

    if (!triggerResult.ok) {
      naniteManagerLogger.error(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
        ...createManagerLogContext(this.name, { naniteId: input.naniteId }),
        [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: false,
        [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 0,
        hasGeneratedTrigger: true,
        test: true,
        eventType: input.event.type,
        error: triggerResult.error,
      });
      return {
        ok: false,
        hasGeneratedTrigger: true,
        accepted: false,
        error: triggerResult.error,
      };
    }

    const dispatchIntentCount = getDispatchIntents(triggerResult.intents).length;
    naniteManagerLogger.info(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
      ...createManagerLogContext(this.name, { naniteId: input.naniteId }),
      [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: dispatchIntentCount > 0,
      [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: triggerResult.intents.length,
      dispatchIntentCount,
      hasGeneratedTrigger: true,
      test: true,
      eventType: input.event.type,
    });

    return {
      ok: true,
      hasGeneratedTrigger: true,
      accepted: dispatchIntentCount > 0,
      error: null,
    };
  }

  @callable()
  async testNaniteTrigger(input: TestNaniteTriggerInput): Promise<TestNaniteTriggerOutput> {
    const githubInstallationId = getGitHubInstallationIdFromManagerName(this.name);
    if (!githubInstallationId) {
      throw new Error("Nanite trigger testing requires an installation-scoped manager.");
    }

    const deliveryId = `sigvelo-trigger-test-${input.requestId ?? crypto.randomUUID()}`;
    const commonDispatchInput = {
      sigveloTriggerTest: true,
      sigveloTestInstruction: input.testInstruction ?? NANITE_TRIGGER_TEST_INSTRUCTION,
      sigveloTestActor: input.actorId ?? "unknown",
    };

    let event: TestNaniteTriggerOutput["event"];
    let generatedTrigger: TestGeneratedTriggerOutput;
    let dispatches: GitHubPullRequestWebhookRunDispatch[];

    if (input.event.fixture === "github.push") {
      const payload = buildGitHubPushFixture({
        installationId: githubInstallationId,
        overrides: input.event.overrides,
      });
      event = {
        fixture: input.event.fixture,
        deliveryId,
        repository: payload.repository.full_name,
        pullNumber: null,
        action: null,
        headSha: null,
        branch: payload.ref.replace(/^refs\/heads\//, ""),
        afterSha: payload.after,
      };
      generatedTrigger = await this.testGeneratedTrigger({
        naniteId: input.naniteId,
        event: {
          type: "github.push",
          deliveryId,
          payload,
        },
      });
      dispatches = generatedTrigger.ok
        ? await this.handleGitHubPushWebhook({
            githubInstallationId,
            deliveryId,
            payload,
            onlyNaniteId: input.naniteId,
            dispatchInput: commonDispatchInput,
          })
        : [];
    } else {
      const payload = buildGitHubPullRequestFixture({
        fixture: input.event.fixture,
        installationId: githubInstallationId,
        overrides: input.event.overrides,
      });
      event = {
        fixture: input.event.fixture,
        deliveryId,
        repository: payload.repository.full_name,
        pullNumber: payload.pull_request.number,
        action: payload.action,
        headSha: payload.pull_request.head.sha,
        branch: null,
        afterSha: null,
      };
      generatedTrigger = await this.testGeneratedTrigger({
        naniteId: input.naniteId,
        event: {
          type: "github.pull_request",
          deliveryId,
          payload,
        },
      });
      dispatches = generatedTrigger.ok
        ? await this.handleGitHubPullRequestWebhook({
            githubInstallationId,
            deliveryId,
            payload,
            onlyNaniteId: input.naniteId,
            dispatchInput: commonDispatchInput,
          })
        : [];
    }

    if (!generatedTrigger.ok) {
      return {
        ok: false,
        managerName: this.name,
        naniteId: input.naniteId,
        event,
        acceptance: {
          fixtureBuilt: true,
          triggerAcceptedEvent: false,
          runCreated: false,
          modelDispatched: false,
          terminalOutcomeReached: false,
        },
        runs: [],
        agentFeedback: null,
        error: `Generated TypeScript trigger failed before dispatching the Nanite: ${generatedTrigger.error}`,
      };
    }

    const createdDispatches = dispatches.filter((dispatch) => dispatch.created);
    const dispatchedRuns = await Promise.all(
      createdDispatches.map((dispatch) => this.dispatchRun({ runId: dispatch.run.runId })),
    );
    const runs = input.waitForTerminalOutcome
      ? await this.waitForTerminalRuns({
          runIds: dispatchedRuns.map((run) => run.runId),
          timeoutMs: input.timeoutMs ?? NANITE_TRIGGER_TEST_TIMEOUT_MS,
        })
      : dispatchedRuns;
    const terminalOutcomeReached =
      runs.length > 0 && runs.every((run) => isTerminalNaniteRunStatus(run.status));
    const successfulTerminalOutcome =
      terminalOutcomeReached &&
      runs.every(
        (run) =>
          (run.status === "complete" || run.status === "no_change") && run.dispatchError === null,
      );
    const successfulDispatch =
      dispatchedRuns.length > 0 && dispatchedRuns.every((run) => run.dispatchError === null);
    const agentFeedback = runs.find((run) => run.agentFeedback)?.agentFeedback ?? null;

    return {
      ok:
        createdDispatches.length > 0 &&
        (input.waitForTerminalOutcome ? successfulTerminalOutcome : successfulDispatch),
      managerName: this.name,
      naniteId: input.naniteId,
      event,
      acceptance: {
        fixtureBuilt: true,
        triggerAcceptedEvent: dispatches.length > 0,
        runCreated: createdDispatches.length > 0,
        modelDispatched: dispatchedRuns.length > 0,
        terminalOutcomeReached,
      },
      runs,
      agentFeedback,
      error:
        createdDispatches.length === 0
          ? "The trigger did not create a new Nanite run. Check the manifest trigger filter, generated trigger code, fixture payload, or trigger idempotency key."
          : !input.waitForTerminalOutcome
            ? null
            : !terminalOutcomeReached
              ? "Timed out waiting for the Nanite to reach a terminal lifecycle outcome."
              : successfulTerminalOutcome
                ? null
                : "The Nanite reached a terminal outcome, but it did not complete successfully.",
    };
  }

  @callable()
  async cancelRuns(input: CancelNaniteRunsInput): Promise<CancelNaniteRunsOutput> {
    const current = await this.getSnapshot();
    const now = nowIso();
    const explicitRunIds = new Set(input.runIds ?? []);
    const candidateRunIds = input.runIds?.length
      ? input.runIds
      : current.runOrder.filter((runId) => {
          const run = current.runs[runId];
          return (
            run?.status === "running" &&
            (!input.naniteId || run.naniteId === input.naniteId) &&
            (!input.olderThanIso || run.updatedAt < input.olderThanIso)
          );
        });
    const limit = Math.min(Math.max(input.limit ?? 25, 1), MAX_RUNS_IN_STATE);
    const canceledRuns: NaniteRunRecord[] = [];
    const skippedRuns: CancelNaniteRunsOutput["skippedRuns"] = [];
    let nextState = current;

    for (const runId of candidateRunIds.slice(0, limit)) {
      const run = nextState.runs[runId];
      if (!run) {
        skippedRuns.push({ runId, reason: "unknown_run" });
        continue;
      }
      if (input.naniteId && run.naniteId !== input.naniteId) {
        skippedRuns.push({ runId, reason: "nanite_mismatch" });
        continue;
      }
      if (isTerminalNaniteRunStatus(run.status)) {
        skippedRuns.push({ runId, reason: "already_terminal" });
        continue;
      }
      if (run.status === "waiting_for_human" && !explicitRunIds.has(runId)) {
        skippedRuns.push({ runId, reason: "waiting_for_human" });
        continue;
      }

      const agent = await this.subAgent(SigveloNaniteAgent, run.naniteId);
      await (agent as NaniteAgentDispatchClient).cancelRunFromManager({
        runId,
        reason: input.reason,
      });

      nextState = updateRun(nextState, runId, (currentRun) => ({
        ...currentRun,
        status: "canceled",
        summary: input.reason,
        dispatchError: currentRun.dispatchError,
        updatedAt: now,
        completedAt: now,
      }));
      canceledRuns.push(nextState.runs[runId]);

      const activity = nextState.runtimeActivityByNanite[run.naniteId];
      if (activity?.runId === runId) {
        nextState = updateRuntimeActivity(
          nextState,
          run.naniteId,
          {
            state: "idle",
            runId,
            toolName: null,
            lastActivityAt: now,
            error: input.reason,
          },
          now,
        );
      }
    }

    if (canceledRuns.length > 0) {
      this.setState(nextState);
    }

    return { canceledRuns, skippedRuns };
  }

  @callable()
  async deprovisionNanites(input: DeprovisionNanitesInput): Promise<DeprovisionNanitesOutput> {
    const current = await this.getSnapshot();
    const naniteIds = new Set(input.naniteIds);
    const deprovisionedNaniteIds: string[] = [];
    const skippedNaniteIds: DeprovisionNanitesOutput["skippedNaniteIds"] = [];
    const nextNanites = { ...current.nanites };
    const nextRuntimeActivityByNanite = { ...current.runtimeActivityByNanite };

    for (const naniteId of naniteIds) {
      if (!current.nanites[naniteId]) {
        skippedNaniteIds.push({ naniteId, reason: "unknown_nanite" });
        continue;
      }

      const agent = await this.subAgent(SigveloNaniteAgent, naniteId);
      await (agent as NaniteAgentDebugClient).resetDebugState();
      await this.deleteSubAgent(SigveloNaniteAgent, naniteId);
      delete nextNanites[naniteId];
      delete nextRuntimeActivityByNanite[naniteId];
      deprovisionedNaniteIds.push(naniteId);
    }

    const removedRunIds: string[] = [];
    const nextRuns = { ...current.runs };
    const nextRunOrder = current.runOrder.filter((runId) => {
      const run = current.runs[runId];
      if (run && naniteIds.has(run.naniteId)) {
        delete nextRuns[runId];
        removedRunIds.push(runId);
        return false;
      }

      return true;
    });

    if (deprovisionedNaniteIds.length > 0) {
      this.setState({
        ...current,
        nanites: nextNanites,
        runs: nextRuns,
        runOrder: nextRunOrder,
        runtimeActivityByNanite: nextRuntimeActivityByNanite,
        updatedAt: nowIso(),
      });
    }

    naniteManagerLogger.info(LOG_EVENTS.NANITE_DEPROVISIONED, {
      ...createManagerLogContext(this.name),
      reason: input.reason,
      deprovisionedNaniteIds,
      removedRunIds,
      skippedNaniteIds,
    });

    return { deprovisionedNaniteIds, removedRunIds, skippedNaniteIds };
  }

  override async onBeforeSubAgent(
    _request: Request,
    child: { className: string; name: string },
  ): Promise<Response | void> {
    if (child.className !== SigveloNaniteAgent.name) {
      return new Response("Nanite sub-agent not found.", { status: 404 });
    }

    if (!this.state.nanites[child.name]) {
      return new Response("Nanite not found.", { status: 404 });
    }
  }

  @callable()
  async registerNanite(input: RegisterNaniteInput): Promise<ManagedNanite> {
    const current = await this.getSnapshot();
    const requestedGitHubPermissions = input.manifest.permissions.github;
    if (
      input.manifest.capabilities?.githubMcp &&
      !requestedGitHubPermissions?.repositories.length
    ) {
      throw new Error("GitHub MCP capability requires GitHub repository permissions.");
    }

    const githubMcpCapability = resolveNaniteGitHubMcpCapability({
      capability: input.manifest.capabilities?.githubMcp,
      appPermissions: requestedGitHubPermissions?.appPermissions,
    });
    const githubPermissions = requestedGitHubPermissions
      ? {
          repositories: requestedGitHubPermissions.repositories,
          appPermissions:
            githubMcpCapability?.appPermissions ?? requestedGitHubPermissions.appPermissions,
        }
      : undefined;
    const manifest: NaniteManifest = githubPermissions
      ? {
          id: input.manifest.id,
          name: input.manifest.name,
          description: input.manifest.description,
          trigger: input.manifest.trigger,
          inboundTrigger: input.manifest.inboundTrigger,
          permissions: { github: githubPermissions },
          capabilities: input.manifest.capabilities,
        }
      : input.manifest;

    const githubInstallationId = getGitHubInstallationIdFromManagerName(this.name);
    if (githubInstallationId) {
      await assertNaniteRepositoriesBelongToInstallation({
        env: this.env,
        githubInstallationId,
        manifest,
      });
    }

    const triggerSource = manifest.inboundTrigger?.sourceCode;
    if (triggerSource) {
      const validationResult = await validateGeneratedTriggerSource({
        loader: this.env.LOADER,
        sourceCode: triggerSource,
        cacheKey: `${this.name}:${manifest.id}:registration-validation`,
      });
      if (!validationResult.ok) {
        throw new Error(`Generated trigger validation failed: ${validationResult.error}`);
      }
    }

    const registeredAt = nowIso();
    const existing = current.nanites[manifest.id];
    const nanite: ManagedNanite = {
      manifest,
      latestVersion: await createNaniteSourceVersion(manifest, registeredAt),
      enabled: input.enabled ?? true,
      createdAt: existing?.createdAt ?? registeredAt,
      updatedAt: registeredAt,
    };

    this.setState({
      ...current,
      nanites: {
        ...current.nanites,
        [nanite.manifest.id]: nanite,
      },
      updatedAt: registeredAt,
    });

    if (
      nanite.manifest.trigger.type === "schedule" ||
      existing?.manifest.trigger.type === "schedule"
    ) {
      const agent = await this.subAgent(SigveloNaniteAgent, nanite.manifest.id);
      await (agent as NaniteAgentDispatchClient).syncScheduleFromManager({
        managerName: this.name,
        nanite,
      });
    }

    return nanite;
  }

  @callable()
  async startRun(input: StartNaniteRunInput): Promise<NaniteRunRecord> {
    const current = await this.getSnapshot();
    const nanite = current.nanites[input.naniteId];
    if (!nanite) {
      throw new Error(`Unknown Nanite: ${input.naniteId}`);
    }

    if (!nanite.enabled) {
      throw new Error(`Nanite is disabled: ${input.naniteId}`);
    }

    const triggerKey = buildTriggerKey(input);
    const existingRun = getExistingRunByTriggerKey(current, triggerKey);
    if (existingRun) {
      naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_DEDUPED, {
        ...createManagerLogContext(this.name, {
          naniteId: input.naniteId,
          run: existingRun,
          trigger: input.trigger,
        }),
      });
      return existingRun;
    }

    const startedAt = nowIso();
    const runId = crypto.randomUUID();
    const run: NaniteRunRecord = {
      runId,
      naniteId: input.naniteId,
      versionId: nanite.latestVersion.versionId,
      triggerKey,
      trigger: input.trigger,
      status: "running",
      summary: null,
      outputUrl: null,
      agentFeedback: null,
      humanRequest: null,
      githubCheck: null,
      chatUrl: buildNaniteChatUrl({
        managerName: this.name,
        naniteId: input.naniteId,
      }),
      startedAt,
      dispatchError: null,
      updatedAt: startedAt,
      completedAt: null,
    };
    const runOrder = [runId, ...current.runOrder].slice(0, MAX_RUNS_IN_STATE);
    const runtimeActivity: NaniteRuntimeActivity = {
      state: "idle",
      runId,
      toolName: null,
      lastActivityAt: startedAt,
      error: null,
    };

    this.setState({
      ...current,
      runs: trimRecordByOrder(
        {
          ...current.runs,
          [runId]: run,
        },
        runOrder,
      ),
      runOrder,
      runtimeActivityByNanite: {
        ...current.runtimeActivityByNanite,
        [input.naniteId]: runtimeActivity,
      },
      updatedAt: startedAt,
    });

    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_CREATED, {
      ...createManagerLogContext(this.name, { run }),
      versionId: run.versionId,
      chatUrl: run.chatUrl,
    });

    return run;
  }

  @callable()
  async dispatchRun(input: DispatchNaniteRunInput): Promise<NaniteRunRecord> {
    const current = await this.getSnapshot();
    const run = getRunOrThrow(current, input.runId);
    if (isTerminalNaniteRunStatus(run.status)) {
      return run;
    }

    const nanite = current.nanites[run.naniteId];
    if (!nanite) {
      throw new Error(`Unknown Nanite for run: ${run.naniteId}`);
    }

    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_DISPATCH_STARTED, {
      ...createManagerLogContext(this.name, { run }),
    });

    let agent: NaniteAgentDispatchClient;
    try {
      agent = await this.subAgent(SigveloNaniteAgent, run.naniteId);
    } catch (error) {
      naniteManagerLogger.error(LOG_EVENTS.NANITE_RUN_DISPATCH_FAILED, {
        ...createManagerLogContext(this.name, { run }),
        phase: "sub_agent_resolution",
        error: formatCompactError(error),
      });
      return this.recordUnreportedRunCompletion({
        runId: input.runId,
        status: "error",
        error: `subAgent failed: ${formatError(error)}`,
      });
    }

    try {
      await agent.enqueueFromManager(
        cloneJson({
          managerName: this.name,
          nanite,
          run,
        }),
      );
    } catch (error) {
      naniteManagerLogger.error(LOG_EVENTS.NANITE_RUN_DISPATCH_FAILED, {
        ...createManagerLogContext(this.name, { run }),
        phase: "enqueue",
        error: formatCompactError(error),
      });
      return this.recordUnreportedRunCompletion({
        runId: input.runId,
        status: "error",
        error: `enqueueFromManager failed: ${formatError(error)}`,
      });
    }

    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_DISPATCH_SUCCEEDED, {
      ...createManagerLogContext(this.name, { run }),
    });

    return run;
  }

  @callable()
  async startNaniteManualRun(
    input: StartNaniteManualRunInput,
  ): Promise<StartNaniteManualRunOutput> {
    const run = await this.startRun({
      naniteId: input.naniteId,
      trigger: {
        type: "manual",
        requestId: input.manualRequestId ?? crypto.randomUUID(),
        actorId: input.actorId,
        message: input.message,
      },
    });
    const dispatchedRun = await this.dispatchRun({ runId: run.runId });
    const runs = input.waitForTerminalOutcome
      ? await this.waitForTerminalRuns({
          runIds: [dispatchedRun.runId],
          timeoutMs: input.timeoutMs ?? NANITE_MANUAL_RUN_TIMEOUT_MS,
        })
      : [dispatchedRun];
    const terminalOutcomeReached = runs.length === 1 && isTerminalNaniteRunStatus(runs[0].status);
    const successfulOutcome =
      terminalOutcomeReached &&
      (runs[0].status === "complete" || runs[0].status === "no_change") &&
      runs[0].dispatchError === null;

    return {
      ok: input.waitForTerminalOutcome ? successfulOutcome : runs.length === 1,
      managerName: this.name,
      naniteId: input.naniteId,
      runs,
    };
  }

  @callable()
  async recordUnreportedRunCompletion(
    input: RecordUnreportedRunCompletionInput,
  ): Promise<NaniteRunRecord> {
    const current = await this.getSnapshot();
    const currentRun = getRunOrThrow(current, input.runId);
    if (isTerminalNaniteRunStatus(currentRun.status) || currentRun.status === "waiting_for_human") {
      return currentRun;
    }

    const observedAt = nowIso();
    const nextStateWithRun = updateRun(current, input.runId, (run) => {
      const base: NaniteRunRecord = {
        ...run,
        dispatchError: input.error ?? null,
        updatedAt: observedAt,
      };

      if (input.status === "completed") {
        return {
          ...base,
          status: "fail",
          summary:
            input.error ??
            "The Think turn completed before the Nanite reported a lifecycle outcome.",
          completedAt: observedAt,
        };
      }

      return {
        ...base,
        status: input.status === "aborted" ? "canceled" : "fail",
        summary:
          input.error ??
          `The Think submission ended with status ${input.status} before the Nanite reported a lifecycle outcome.`,
        completedAt: observedAt,
      };
    });
    const nextRun = getRunOrThrow(nextStateWithRun, input.runId);
    const nextActivityState =
      nextRun.status === "waiting_for_human"
        ? "waiting_for_human"
        : input.status === "error"
          ? "error"
          : "idle";
    const nextState = updateRuntimeActivity(
      nextStateWithRun,
      nextRun.naniteId,
      {
        state: nextActivityState,
        runId: input.runId,
        toolName: null,
        lastActivityAt: observedAt,
        error: input.error ?? null,
      },
      observedAt,
    );

    this.setState(nextState);
    const run = getRunOrThrow(nextState, input.runId);
    naniteManagerLogger.warn(LOG_EVENTS.NANITE_RUN_COMPLETED, {
      ...createManagerLogContext(this.name, { run }),
      status: run.status,
      source: "unreported_submission",
      error: input.error ?? undefined,
    });

    if (run.githubCheck?.checkRunId && isTerminalNaniteRunStatus(run.status)) {
      this.ctx.waitUntil(this.updateGitHubCheckForTerminalRun(run));
    }
    return run;
  }

  async recordRuntimeActivity(
    input: RecordNaniteRuntimeActivityInput,
  ): Promise<NaniteRuntimeActivity> {
    const current = await this.getSnapshot();
    const observedAt = nowIso();

    if (input.runId) {
      const run = getRunOrThrow(current, input.runId);
      if (run.naniteId !== input.naniteId) {
        throw new Error(
          `Nanite runtime activity mismatch: run ${input.runId} belongs to ${run.naniteId}, not ${input.naniteId}`,
        );
      }
    }

    const activity: NaniteRuntimeActivity = {
      state: input.state,
      runId: input.runId,
      toolName: input.toolName ?? null,
      lastActivityAt: observedAt,
      error: input.error ?? null,
    };

    this.setState(updateRuntimeActivity(current, input.naniteId, activity, observedAt));
    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUNTIME_ACTIVITY_RECORDED, {
      ...createManagerLogContext(this.name, { naniteId: input.naniteId, runId: input.runId }),
      [OTEL_ATTRS.NANITE_ACTIVITY_STATE]: input.state,
      [OTEL_ATTRS.NANITE_TOOL_NAME]: input.toolName ?? undefined,
      error: input.error ?? undefined,
    });
    return activity;
  }

  @callable()
  async handleGitHubPullRequestWebhook(
    input: HandleGitHubPullRequestWebhookInput,
  ): Promise<GitHubPullRequestWebhookRunDispatch[]> {
    const snapshot = await this.getSnapshot();
    const startedRuns: GitHubPullRequestWebhookRunDispatch[] = [];

    for (const nanite of Object.values(snapshot.nanites)) {
      if (
        !nanite.enabled ||
        (input.onlyNaniteId && nanite.manifest.id !== input.onlyNaniteId) ||
        !githubPullRequestTriggerMatches(nanite.manifest.trigger, input.payload)
      ) {
        continue;
      }

      const triggerSource = nanite.manifest.inboundTrigger?.sourceCode;
      const dispatches: Array<{
        input: TriggerDispatchInput | undefined;
        githubCheckSurface: TriggerGitHubCheckSurfaceRequest | null;
      }> = [];

      if (triggerSource) {
        const triggerResult = await runGeneratedTrigger({
          loader: this.env.LOADER,
          sourceCode: triggerSource,
          cacheKey: `${this.name}:${nanite.manifest.id}:${nanite.latestVersion.manifestHash}:github-pull-request`,
          event: {
            type: "github.pull_request",
            deliveryId: input.deliveryId,
            payload: input.payload,
          },
        });

        if (!triggerResult.ok) {
          naniteManagerLogger.error(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
            ...createManagerLogContext(this.name, { naniteId: nanite.manifest.id }),
            [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: false,
            [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 0,
            eventType: "github.pull_request",
            error: triggerResult.error,
          });

          const run = await this.startRun({
            naniteId: nanite.manifest.id,
            trigger: buildGitHubPullRequestTriggerEvent({
              deliveryId: input.deliveryId,
              payload: input.payload,
              dispatchInput: {
                triggerError: triggerResult.error,
              },
            }),
          });
          startedRuns.push({
            run: await this.recordUnreportedRunCompletion({
              runId: run.runId,
              status: "error",
              error: `Trigger failed before model dispatch: ${triggerResult.error}`,
            }),
            created: true,
            githubCheckSurface: null,
          });
          continue;
        }

        const dispatchIntents = getDispatchIntents(triggerResult.intents);
        naniteManagerLogger.info(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
          ...createManagerLogContext(this.name, { naniteId: nanite.manifest.id }),
          [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: dispatchIntents.length > 0,
          [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: triggerResult.intents.length,
          dispatchIntentCount: dispatchIntents.length,
          eventType: "github.pull_request",
        });

        for (const intent of dispatchIntents) {
          dispatches.push({
            input: {
              ...intent.input,
              ...input.dispatchInput,
            },
            githubCheckSurface: resolveRequestedGitHubCheckSurface({
              nanite,
              requestedSurfaces: intent.surfaces,
              repository: input.payload.repository.full_name,
              headSha: input.payload.pull_request.head.sha,
            }),
          });
        }
      } else {
        naniteManagerLogger.info(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
          ...createManagerLogContext(this.name, { naniteId: nanite.manifest.id }),
          [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: true,
          [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 1,
          dispatchIntentCount: 1,
          eventType: "github.pull_request",
          hasGeneratedTrigger: false,
        });
        dispatches.push({
          input: input.dispatchInput,
          githubCheckSurface: resolveRequestedGitHubCheckSurface({
            nanite,
            repository: input.payload.repository.full_name,
            headSha: input.payload.pull_request.head.sha,
          }),
        });
      }

      if (startedRuns.length >= MAX_TRIGGER_DISPATCHES_PER_EVENT) {
        break;
      }

      for (const dispatch of dispatches) {
        if (startedRuns.length >= MAX_TRIGGER_DISPATCHES_PER_EVENT) {
          break;
        }

        if (countActiveRunsForNanite(await this.getSnapshot(), nanite.manifest.id) > 0) {
          continue;
        }

        const startInput: StartNaniteRunInput = {
          naniteId: nanite.manifest.id,
          trigger: buildGitHubPullRequestTriggerEvent({
            deliveryId: input.deliveryId,
            payload: input.payload,
            dispatchInput: dispatch.input,
          }),
        };
        const created = getExistingRunByTriggerKey(snapshot, buildTriggerKey(startInput)) === null;
        const run = await this.startRun(startInput);
        startedRuns.push({
          run,
          created,
          githubCheckSurface: dispatch.githubCheckSurface,
        });
      }
    }

    return startedRuns;
  }

  @callable()
  async handleGitHubPushWebhook(
    input: HandleGitHubPushWebhookInput,
  ): Promise<GitHubPullRequestWebhookRunDispatch[]> {
    const snapshot = await this.getSnapshot();
    const startedRuns: GitHubPullRequestWebhookRunDispatch[] = [];

    for (const nanite of Object.values(snapshot.nanites)) {
      if (
        !nanite.enabled ||
        (input.onlyNaniteId && nanite.manifest.id !== input.onlyNaniteId) ||
        !githubPushTriggerMatches(nanite.manifest.trigger, input.payload)
      ) {
        continue;
      }

      const triggerSource = nanite.manifest.inboundTrigger?.sourceCode;
      const dispatches: Array<{
        input: TriggerDispatchInput | undefined;
        githubCheckSurface: TriggerGitHubCheckSurfaceRequest | null;
      }> = [];

      if (triggerSource) {
        const triggerResult = await runGeneratedTrigger({
          loader: this.env.LOADER,
          sourceCode: triggerSource,
          cacheKey: `${this.name}:${nanite.manifest.id}:${nanite.latestVersion.manifestHash}:github-push`,
          event: {
            type: "github.push",
            deliveryId: input.deliveryId,
            payload: input.payload,
          },
        });

        if (!triggerResult.ok) {
          naniteManagerLogger.error(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
            ...createManagerLogContext(this.name, { naniteId: nanite.manifest.id }),
            [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: false,
            [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 0,
            eventType: "github.push",
            error: triggerResult.error,
          });

          const run = await this.startRun({
            naniteId: nanite.manifest.id,
            trigger: buildGitHubPushTriggerEvent({
              deliveryId: input.deliveryId,
              payload: input.payload,
              dispatchInput: {
                triggerError: triggerResult.error,
              },
            }),
          });
          startedRuns.push({
            run: await this.recordUnreportedRunCompletion({
              runId: run.runId,
              status: "error",
              error: `Trigger failed before model dispatch: ${triggerResult.error}`,
            }),
            created: true,
            githubCheckSurface: null,
          });
          continue;
        }

        const dispatchIntents = getDispatchIntents(triggerResult.intents);
        naniteManagerLogger.info(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
          ...createManagerLogContext(this.name, { naniteId: nanite.manifest.id }),
          [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: dispatchIntents.length > 0,
          [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: triggerResult.intents.length,
          dispatchIntentCount: dispatchIntents.length,
          eventType: "github.push",
        });

        for (const intent of dispatchIntents) {
          dispatches.push({
            input: {
              ...intent.input,
              ...input.dispatchInput,
            },
            githubCheckSurface: resolveRequestedGitHubCheckSurface({
              nanite,
              requestedSurfaces: intent.surfaces ?? [],
              repository: input.payload.repository.full_name,
              headSha: input.payload.after,
            }),
          });
        }
      } else {
        naniteManagerLogger.info(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
          ...createManagerLogContext(this.name, { naniteId: nanite.manifest.id }),
          [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: true,
          [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 1,
          dispatchIntentCount: 1,
          eventType: "github.push",
          hasGeneratedTrigger: false,
        });
        dispatches.push({
          input: input.dispatchInput,
          githubCheckSurface: null,
        });
      }

      if (startedRuns.length >= MAX_TRIGGER_DISPATCHES_PER_EVENT) {
        break;
      }

      for (const dispatch of dispatches) {
        if (startedRuns.length >= MAX_TRIGGER_DISPATCHES_PER_EVENT) {
          break;
        }

        if (countActiveRunsForNanite(await this.getSnapshot(), nanite.manifest.id) > 0) {
          continue;
        }

        const startInput: StartNaniteRunInput = {
          naniteId: nanite.manifest.id,
          trigger: buildGitHubPushTriggerEvent({
            deliveryId: input.deliveryId,
            payload: input.payload,
            dispatchInput: dispatch.input,
          }),
        };
        const created = getExistingRunByTriggerKey(snapshot, buildTriggerKey(startInput)) === null;
        const run = await this.startRun(startInput);
        startedRuns.push({
          run,
          created,
          githubCheckSurface: dispatch.githubCheckSurface,
        });
      }
    }

    return startedRuns;
  }

  @callable()
  async claimGitHubCheckCreation(input: ClaimGitHubCheckCreationInput): Promise<{
    run: NaniteRunRecord;
    shouldCreate: boolean;
  }> {
    const current = await this.getSnapshot();
    const run = getRunOrThrow(current, input.runId);
    if (
      run.githubCheck &&
      (run.githubCheck.status === "creating" ||
        run.githubCheck.status === "in_progress" ||
        run.githubCheck.status === "completed")
    ) {
      return { run, shouldCreate: false };
    }

    const startedAt = nowIso();
    const nextState = updateRun(current, input.runId, (currentRun) => ({
      ...currentRun,
      githubCheck: {
        installationId: input.installationId,
        repository: input.repository,
        owner: input.owner,
        repo: input.repo,
        name: input.name,
        headSha: input.headSha,
        checkRunId: null,
        status: "creating",
        conclusion: null,
        detailsUrl: input.detailsUrl,
        outputTitle: "Nanite run started",
        outputSummary: "Sigvelo accepted the GitHub trigger and is starting the Nanite.",
        outputText: input.detailsUrl
          ? `Live Sigvelo run: ${input.detailsUrl}`
          : "Sigvelo accepted the GitHub trigger.",
        startedAt,
        updatedAt: startedAt,
      },
      updatedAt: startedAt,
    }));

    this.setState(nextState);
    return { run: getRunOrThrow(nextState, input.runId), shouldCreate: true };
  }

  @callable()
  async attachGitHubCheck(input: AttachGitHubCheckInput): Promise<NaniteRunRecord> {
    const current = await this.getSnapshot();
    const attachedAt = nowIso();
    const nextState = updateRun(current, input.runId, (run) => {
      if (!run.githubCheck) {
        throw new Error(`Cannot attach GitHub check before creation is claimed: ${input.runId}`);
      }

      if (run.githubCheck?.checkRunId === input.checkRunId) {
        return run;
      }

      return {
        ...run,
        githubCheck: {
          ...run.githubCheck,
          checkRunId: input.checkRunId,
          status: "in_progress",
          conclusion: null,
          detailsUrl: input.detailsUrl,
          outputTitle: input.outputTitle,
          outputSummary: input.outputSummary,
          outputText: input.outputText,
          updatedAt: attachedAt,
        },
        updatedAt: attachedAt,
      };
    });

    this.setState(nextState);
    return getRunOrThrow(nextState, input.runId);
  }

  @callable()
  async recordGitHubCheckFailure(input: RecordGitHubCheckFailureInput): Promise<NaniteRunRecord> {
    const current = await this.getSnapshot();
    const failedAt = nowIso();
    const nextState = updateRun(current, input.runId, (run) => ({
      ...run,
      githubCheck: run.githubCheck
        ? {
            ...run.githubCheck,
            status: input.status,
            outputSummary: input.summary,
            updatedAt: failedAt,
          }
        : null,
      updatedAt: failedAt,
    }));

    this.setState(nextState);
    return getRunOrThrow(nextState, input.runId);
  }

  @callable()
  async askHuman(input: AskHumanInput): Promise<NaniteRunRecord> {
    const current = await this.getSnapshot();
    const currentRun = getRunOrThrow(current, input.runId);
    if (currentRun.status === "waiting_for_human" && currentRun.humanRequest?.resolvedAt === null) {
      return currentRun;
    }

    const createdAt = nowIso();
    const nextStateWithRun = updateRun(current, input.runId, (run) => {
      assertNaniteRunStatusTransition(run.status, "waiting_for_human");
      return {
        ...run,
        status: "waiting_for_human",
        summary: input.summary,
        humanRequest: {
          id: crypto.randomUUID(),
          summary: input.summary,
          requestedScopes: input.requestedScopes ?? [],
          createdAt,
          resolvedAt: null,
        },
        updatedAt: createdAt,
      };
    });
    const nextState = updateRuntimeActivity(
      nextStateWithRun,
      currentRun.naniteId,
      {
        state: "waiting_for_human",
        runId: input.runId,
        toolName: null,
        lastActivityAt: createdAt,
        error: null,
      },
      createdAt,
    );

    this.setState(nextState);
    return getRunOrThrow(nextState, input.runId);
  }

  @callable()
  async resumeRun(input: ResumeNaniteRunInput): Promise<NaniteRunRecord> {
    const current = await this.getSnapshot();
    const currentRun = getRunOrThrow(current, input.runId);
    const resolvedAt = nowIso();
    const nextStateWithRun = updateRun(current, input.runId, (run) => {
      assertNaniteRunStatusTransition(run.status, "running");
      return {
        ...run,
        status: "running",
        humanRequest: run.humanRequest
          ? {
              ...run.humanRequest,
              resolvedAt,
            }
          : null,
        updatedAt: resolvedAt,
      };
    });
    const nextState = updateRuntimeActivity(
      nextStateWithRun,
      currentRun.naniteId,
      {
        state: "idle",
        runId: input.runId,
        toolName: null,
        lastActivityAt: resolvedAt,
        error: null,
      },
      resolvedAt,
    );

    this.setState(nextState);
    return getRunOrThrow(nextState, input.runId);
  }

  @callable()
  async completeRun(input: CompleteNaniteRunInput): Promise<NaniteRunRecord> {
    const current = await this.getSnapshot();
    const currentRun = getRunOrThrow(current, input.runId);
    if (isTerminalNaniteRunStatus(currentRun.status)) {
      assertNaniteRunStatusTransition(currentRun.status, input.status);
      return currentRun;
    }

    const completedAt = nowIso();
    const nextStateWithRun = updateRun(current, input.runId, (run) => {
      assertNaniteRunStatusTransition(run.status, input.status);
      return {
        ...run,
        status: input.status,
        summary: input.summary,
        outputUrl: input.outputUrl ?? run.outputUrl,
        agentFeedback: input.agentFeedback ?? run.agentFeedback,
        updatedAt: completedAt,
        completedAt,
      };
    });
    const nextState = updateRuntimeActivity(
      nextStateWithRun,
      currentRun.naniteId,
      {
        state: "idle",
        runId: input.runId,
        toolName: null,
        lastActivityAt: completedAt,
        error: null,
      },
      completedAt,
    );

    this.setState(nextState);
    const completedRun = getRunOrThrow(nextState, input.runId);
    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_COMPLETED, {
      ...createManagerLogContext(this.name, { run: completedRun }),
      status: completedRun.status,
      source: "lifecycle_tool",
      hasOutputUrl: completedRun.outputUrl !== null,
      hasAgentFeedback: completedRun.agentFeedback !== null,
    });

    if (completedRun.githubCheck?.checkRunId) {
      this.ctx.waitUntil(this.updateGitHubCheckForTerminalRun(completedRun));
    }
    return completedRun;
  }

  @callable()
  async failRun(input: FailNaniteRunInput): Promise<NaniteRunRecord> {
    return this.completeRun({
      runId: input.runId,
      status: "fail",
      summary: input.summary,
    });
  }

  private async waitForTerminalRuns(input: {
    runIds: readonly string[];
    timeoutMs: number;
  }): Promise<NaniteRunRecord[]> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < input.timeoutMs) {
      const snapshot = await this.getSnapshot();
      const runs = input.runIds.flatMap((runId) => {
        const run = snapshot.runs[runId];
        return run ? [run] : [];
      });
      if (
        runs.length === input.runIds.length &&
        runs.every((run) => isTerminalNaniteRunStatus(run.status))
      ) {
        return runs;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const snapshot = await this.getSnapshot();
    return input.runIds.flatMap((runId) => {
      const run = snapshot.runs[runId];
      return run ? [run] : [];
    });
  }

  private async updateGitHubCheckForTerminalRun(run: NaniteRunRecord): Promise<void> {
    const githubCheck = run.githubCheck;
    if (!githubCheck?.checkRunId || !isTerminalNaniteRunStatus(run.status)) {
      return;
    }

    const conclusion = buildTerminalGitHubCheckConclusion(run.status);
    const output = buildTerminalGitHubCheckOutput(run);
    try {
      await updateGitHubCheckRun({
        env: this.env,
        githubInstallationId: githubCheck.installationId,
        owner: githubCheck.owner,
        repo: githubCheck.repo,
        checkRunId: githubCheck.checkRunId,
        output,
        status: "completed",
        conclusion,
        detailsUrl: githubCheck.detailsUrl,
        completedAt: run.completedAt,
      });

      const current = await this.getSnapshot();
      const updatedAt = nowIso();
      const nextState = updateRun(current, run.runId, (currentRun) => ({
        ...currentRun,
        githubCheck: currentRun.githubCheck
          ? {
              ...currentRun.githubCheck,
              status: "completed",
              conclusion,
              outputTitle: output.title,
              outputSummary: output.summary,
              outputText: output.text,
              updatedAt,
            }
          : null,
        updatedAt,
      }));
      this.setState(nextState);
      naniteManagerLogger.info(LOG_EVENTS.NANITE_GITHUB_CHECK_UPDATED, {
        ...createManagerLogContext(this.name, { run: getRunOrThrow(nextState, run.runId) }),
        conclusion,
        checkRunId: githubCheck.checkRunId,
      });
    } catch (error) {
      naniteManagerLogger.error(LOG_EVENTS.NANITE_GITHUB_CHECK_UPDATE_FAILED, {
        ...createManagerLogContext(this.name, { run }),
        checkRunId: githubCheck.checkRunId,
        error: formatCompactError(error),
      });
      await this.recordGitHubCheckFailure({
        runId: run.runId,
        status: "update_failed",
        summary: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export type NaniteManager = SigveloNaniteManager;
