import { Agent, callable, getAgentByName } from "agents";
import type { GitHubRawMessage } from "@chat-adapter/github";
import type { EmitterWebhookEvent, EmitterWebhookEventName } from "@octokit/webhooks";
import type { Author, Message, Thread } from "chat";
import { getLogger } from "@logtape/logtape";
import { APP_ERRORS, AppError } from "#/backend/errors.ts";
import { LOG_EVENTS } from "#/backend/logging.ts";
import { LOGGING } from "#/backend/logging.ts";
import { OTEL_ATTRS } from "#/backend/logging.ts";
import type { GitHubAppPermissions } from "#/backend/github/index.ts";
import { listReposAccessibleToInstallation } from "#/backend/github/index.ts";
import {
  SigveloNaniteAgent,
  type NaniteAgentMaintenanceOutput,
  type NaniteDebugInspectInput,
  type NaniteDebugInspectOutput,
  type NaniteDebugResetOutput,
  type NaniteWorkspaceExploreInput,
  type NaniteWorkspaceExploreOutput,
} from "#/backend/agents/SigveloNaniteAgent.ts";
import {
  getDispatchIntents,
  getNoopIntents,
  runGeneratedTrigger,
  validateGeneratedTriggerSource,
} from "#/backend/nanites/triggers.ts";
import {
  buildDefaultRepositoryHydrationPlans,
  type RepositoryHydrationPlan,
} from "#/backend/nanites/repository-hydration.ts";
import {
  buildGitHubTriggerFixture,
  type GitHubPullRequestFixtureId,
  type GitHubPullRequestFixtureOverrides,
  type GitHubPushFixtureId,
  type GitHubPushFixtureOverrides,
} from "#/backend/nanites/triggers.ts";
import type { TriggerDispatchInput } from "#/backend/nanites/triggers.ts";
import { NANITE_AGENT_NAME, NANITE_MANAGER_NAME, buildNaniteManagerKey } from "#/nanites.ts";
import {
  type GitHubWebhookEventSnapshot,
  getGitHubWebhookAction,
  getGitHubWebhookBranch,
  getGitHubWebhookEventName,
  getGitHubWebhookHeadSha,
  getGitHubWebhookPullRequestNumber,
  getGitHubWebhookRepositoryFullName,
  snapshotGitHubWebhookEvent,
} from "#/github.ts";

export const NANITE_TRIGGER_TEST_TIMEOUT_MS = 60_000;
export const NANITE_MANUAL_RUN_TIMEOUT_MS = 60_000;
export const NANITE_TRIGGER_TEST_INSTRUCTION = [
  "This is a trigger acceptance test.",
  "Do not modify GitHub.",
  "Inspect the trigger payload and runtime context.",
  "If the trigger and context look correct, call complete with a short summary and agentFeedback for the authoring agent.",
].join(" ");

const MAX_RUNS_IN_STATE = 100;
const MAX_TRIGGER_DISPATCHES_PER_EVENT = 25;
const NANITE_MANAGER_MAINTENANCE_CRON = "0 8 * * *";
const NANITE_MANAGER_STALE_RUNNING_AFTER_MS = 24 * 60 * 60 * 1000;
const NANITE_MANAGER_TERMINAL_SUBMISSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const NANITE_MANAGER_MAINTENANCE_SUBMISSION_DELETE_LIMIT = 100;
const naniteManagerLogger = getLogger(LOGGING.NANITES_CATEGORY);

export async function dispatchGitHubWebhookToNaniteManager({
  env,
  githubInstallationId,
  event,
}: {
  env: Env;
  githubInstallationId: number;
  event: EmitterWebhookEvent;
}): Promise<Awaited<ReturnType<SigveloNaniteManager["handleGitHubWebhook"]>>> {
  const manager = await getAgentByName<Env, SigveloNaniteManager>(
    env.SigveloNaniteManager,
    buildNaniteManagerKey(githubInstallationId),
  );
  // @ts-ignore - TYPES ARE TOO DEEP MESSES WITH THE LSP. DON"T REMOTE
  const dispatches = await manager.handleGitHubWebhook({
    githubInstallationId,
    event,
  });

  for (const dispatch of dispatches) {
    if (!dispatch.created) {
      continue;
    }

    await manager.dispatchRun({ runId: dispatch.run.runId });
  }

  return dispatches;
}

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
export type StartNaniteManualRunInput = {
  naniteId: string;
  message: string;
  manualRequestId?: string;
  actorId: string | null;
  waitForTerminalOutcome?: boolean;
  timeoutMs?: number;
};
export type StartNaniteManualRunOutput = {
  ok: boolean;
  managerName: string;
  naniteId: string;
  runs: NaniteRunRecord[];
  error: string | null;
};
export type TestNaniteTriggerInput = {
  naniteId: string;
  event:
    | {
        fixture: GitHubPullRequestFixtureId;
        overrides?: GitHubPullRequestFixtureOverrides;
      }
    | {
        fixture: GitHubPushFixtureId;
        overrides?: GitHubPushFixtureOverrides;
      };
  testInstruction?: string;
  actorId: string | null;
  requestId?: string;
  waitForTerminalOutcome?: boolean;
  timeoutMs?: number;
};
export type TestNaniteTriggerOutput = {
  ok: boolean;
  managerName: string;
  naniteId: string;
  fixture: GitHubPullRequestFixtureId | GitHubPushFixtureId;
  event: GitHubWebhookEventSnapshot;
  acceptance: {
    fixtureBuilt: boolean;
    triggerAcceptedEvent: boolean;
    runCreated: boolean;
    modelDispatched: boolean;
    terminalOutcomeReached: boolean;
    triggerRejectionReason: string | null;
  };
  runs: NaniteRunRecord[];
  agentFeedback: NaniteRunRecord["agentFeedback"] | null;
  error: string | null;
};
export type UnreportedThinkSubmissionStatus = "completed" | "aborted" | "skipped" | "error";
export type TerminalNaniteRunStatus = Extract<
  NaniteRunStatus,
  "complete" | "no_change" | "fail" | "canceled"
>;
export type CompletableNaniteRunStatus = Exclude<TerminalNaniteRunStatus, "canceled">;

export type NaniteScheduleWhen = string | number;

export type NaniteScheduledEventSourceSpec =
  | {
      type: "schedule";
      when: NaniteScheduleWhen;
    }
  | {
      type: "scheduleEvery";
      intervalSeconds: number;
    };

export type NaniteEventSourceSpec =
  | {
      type: "manual";
    }
  | NaniteScheduledEventSourceSpec
  | {
      type: "github";
      events?: EmitterWebhookEventName[];
      repositories?: string[];
      actions?: string[];
      branches?: string[];
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
      eventSource: NaniteScheduledEventSourceSpec;
      scheduledAt: string;
      input?: TriggerDispatchInput;
    }
  | {
      type: "github";
      event: GitHubWebhookEventSnapshot;
      input?: TriggerDispatchInput;
    };

export type NanitePermissionSpec = {
  github?: {
    repositories: string[];
    appPermissions: GitHubAppPermissions;
  };
};

type NaniteManifestBase = {
  id: string;
  name: string;
  description: string;
  permissions: NanitePermissionSpec;
};

export type NaniteManifest =
  | (NaniteManifestBase & {
      eventSource: Extract<NaniteEventSourceSpec, { type: "manual" }>;
      triggerSource?: never;
    })
  | (NaniteManifestBase & {
      eventSource: Exclude<NaniteEventSourceSpec, { type: "manual" }>;
      triggerSource: string;
    });

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

export type NaniteRunRecord = {
  runId: string;
  naniteId: string;
  versionId: string;
  triggerKey: string;
  trigger: NaniteTriggerEvent;
  workspaceHydration?: RepositoryHydrationPlan[];
  status: NaniteRunStatus;
  summary: string | null;
  outputUrl: string | null;
  agentFeedback: NaniteAgentFeedback | null;
  humanRequest: HumanRequest | null;
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

export type HandleGitHubWebhookInput = {
  githubInstallationId: number;
  event: EmitterWebhookEvent;
  dispatchInput?: TriggerDispatchInput;
  onlyNaniteId?: string;
};

export type TestGeneratedTriggerInput = {
  naniteId: string;
  event: EmitterWebhookEvent;
};

export type TestGeneratedTriggerOutput = {
  ok: boolean;
  hasGeneratedTrigger: boolean;
  accepted: boolean;
  noopReasons: string[];
  error: string | null;
};

export type GitHubWebhookRunDispatch = {
  run: NaniteRunRecord;
  created: boolean;
};

export type DispatchNaniteRunInput = {
  runId: string;
};

export type GitHubManagerThreadType =
  | NonNullable<Extract<GitHubRawMessage, { type: "issue_comment" }>["threadType"]>
  | "review_comment";

export type HandleManagerChatMessageInput = {
  installationId: number;
  surface: {
    type: "github";
    threadId: Thread<Record<string, unknown>, GitHubRawMessage>["id"];
    messageId: Message<GitHubRawMessage>["id"];
    raw: GitHubRawMessage;
  };
  author: Author;
  text: string;
};

export type HandleManagerChatMessageOutput = {
  replyMarkdown: string;
};

export function getGitHubManagerChatThreadType(raw: GitHubRawMessage): GitHubManagerThreadType {
  if (raw.type === "review_comment") {
    return "review_comment";
  }

  return raw.threadType ?? "pr";
}

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

export type DeprovisionNaniteInput = {
  naniteId: string;
  reason: string;
};

export type DeprovisionNaniteOutput = {
  deprovisionedNaniteId: string | null;
  removedRunIds: string[];
  skippedNanite: {
    naniteId: string;
    reason: string;
  } | null;
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

function collectManifestRepositories(manifest: NaniteManifest): string[] {
  const repositories = new Set<string>();

  for (const repository of manifest.permissions.github?.repositories ?? []) {
    repositories.add(repository);
  }

  const eventSource = manifest.eventSource;
  if (eventSource.type === "github") {
    for (const repository of eventSource.repositories ?? []) {
      repositories.add(repository);
    }
  }

  return [...repositories].sort();
}

async function assertNaniteRepositoriesBelongToInstallation({
  env,
  githubInstallationId,
  manifest,
}: {
  env: Env;
  githubInstallationId: number;
  manifest: NaniteManifest;
}): Promise<void> {
  const requestedRepositories = collectManifestRepositories(manifest);
  if (requestedRepositories.length === 0) {
    return;
  }

  const accessibleRepositories = new Set(
    (
      await listReposAccessibleToInstallation({
        env,
        githubInstallationId,
      })
    ).map((repository) => repository.full_name),
  );
  const inaccessibleRepositories = requestedRepositories.filter(
    (repository) => !accessibleRepositories.has(repository),
  );

  if (inaccessibleRepositories.length > 0) {
    throw new AppError("naniteRepositoryScopeForbidden", {
      details: {
        githubInstallationId,
        repositories: inaccessibleRepositories,
      },
      message: `${APP_ERRORS.naniteRepositoryScopeForbidden.message}: ${inaccessibleRepositories.join(", ")}`,
    });
  }
}

function createInitialNaniteManagerState(): NaniteManagerState {
  return {
    nanites: {},
    runs: {},
    runOrder: [],
    runtimeActivityByNanite: {},
    updatedAt: null,
  };
}

function assertNaniteRunStatusTransition(
  currentStatus: NaniteRunStatus,
  nextStatus: NaniteRunStatus,
): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!allowedRunStatusTransitions[currentStatus].includes(nextStatus)) {
    throw new AppError("naniteInvalidRunTransition", {
      details: { currentStatus, nextStatus },
      message: `${APP_ERRORS.naniteInvalidRunTransition.message}: ${currentStatus} -> ${nextStatus}`,
    });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function getGitHubInstallationIdFromManagerName(managerName: string): number | null {
  const [, rawInstallationId] = /^installation:(\d+)$/.exec(managerName) ?? [];
  if (!rawInstallationId) {
    return null;
  }

  const githubInstallationId = Number(rawInstallationId);
  return Number.isInteger(githubInstallationId) && githubInstallationId > 0
    ? githubInstallationId
    : null;
}

function parseIsoDate(value: string, fieldName: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError("naniteInvalidTimestamp", {
      details: { fieldName },
      message: `${APP_ERRORS.naniteInvalidTimestamp.message}: ${fieldName}`,
    });
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
    throw new AppError("naniteInvalidNonNegativeNumber", {
      details: { fieldName },
      message: `${APP_ERRORS.naniteInvalidNonNegativeNumber.message}: ${fieldName}`,
    });
  }
  return resolved;
}

function clampMaintenanceSubmissionDeleteLimit(value: number | undefined): number {
  return Math.min(Math.max(value ?? NANITE_MANAGER_MAINTENANCE_SUBMISSION_DELETE_LIMIT, 1), 500);
}

function buildMaintenanceCutoffIso(checkedAt: Date, ageMs: number): string {
  return new Date(checkedAt.getTime() - ageMs).toISOString();
}

function isDateLikeScheduleWhen(when: NaniteScheduleWhen): boolean {
  return typeof when === "string" && !Number.isNaN(new Date(when).getTime());
}

function isRecurringScheduleWhen(when: NaniteScheduleWhen): boolean {
  return typeof when === "string" && !isDateLikeScheduleWhen(when);
}

function shouldResyncNaniteDuringMaintenance(nanite: ManagedNanite): boolean {
  const eventSource = nanite.manifest.eventSource;
  if (eventSource.type !== "schedule" && eventSource.type !== "scheduleEvery") {
    return true;
  }

  if (!nanite.enabled) {
    return true;
  }

  return eventSource.type === "scheduleEvery" || isRecurringScheduleWhen(eventSource.when);
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
    return getGitHubWebhookEventName(trigger.event);
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
      return `${input.naniteId}:schedule:${JSON.stringify(trigger.eventSource)}:${trigger.scheduledAt}`;
    case "github":
      return [
        input.naniteId,
        "github",
        getGitHubWebhookEventName(trigger.event),
        getGitHubWebhookRepositoryFullName(trigger.event) ?? "no-repository",
        getGitHubWebhookBranch(trigger.event) ?? "no-branch",
        getGitHubWebhookPullRequestNumber(trigger.event) ?? "no-pull-request",
        getGitHubWebhookHeadSha(trigger.event) ?? "no-head-sha",
        trigger.event.id,
      ].join(":");
  }
}

function githubEventSourceMatches(nanite: ManagedNanite, event: EmitterWebhookEvent): boolean {
  const eventSource = nanite.manifest.eventSource;
  if (eventSource.type !== "github") {
    return false;
  }

  const eventName = getGitHubWebhookEventName(event);
  if (
    eventSource.events &&
    !eventSource.events.includes(event.name) &&
    !eventSource.events.includes(eventName)
  ) {
    return false;
  }

  const repository = getGitHubWebhookRepositoryFullName(event);
  const allowedRepositories =
    eventSource.repositories ?? nanite.manifest.permissions.github?.repositories ?? [];
  if (
    allowedRepositories.length > 0 &&
    (!repository || !allowedRepositories.includes(repository))
  ) {
    return false;
  }

  const action = getGitHubWebhookAction(event);
  if (eventSource.actions && (!action || !eventSource.actions.includes(action))) {
    return false;
  }

  const branch = getGitHubWebhookBranch(event);
  if (eventSource.branches && (!branch || !eventSource.branches.includes(branch))) {
    return false;
  }

  return true;
}

function buildGitHubTriggerEvent(input: {
  event: EmitterWebhookEvent;
  dispatchInput?: TriggerDispatchInput;
}): Extract<NaniteTriggerEvent, { type: "github" }> {
  return {
    type: "github",
    event: snapshotGitHubWebhookEvent(input.event),
    ...(input.dispatchInput === undefined ? {} : { input: input.dispatchInput }),
  };
}

function summarizeTriggerNoopReasons(reasons: readonly string[]): string | null {
  if (reasons.length === 0) {
    return null;
  }

  return `Generated trigger returned noop: ${reasons.join("; ")}`;
}

function getTriggerTestRejectionReason(input: {
  generatedTrigger: TestGeneratedTriggerOutput;
  dispatches: readonly GitHubWebhookRunDispatch[];
  createdDispatches: readonly GitHubWebhookRunDispatch[];
}): string | null {
  if (!input.generatedTrigger.ok) {
    return `Generated TypeScript trigger failed before dispatch: ${input.generatedTrigger.error}`;
  }

  if (!input.generatedTrigger.accepted) {
    return (
      summarizeTriggerNoopReasons(input.generatedTrigger.noopReasons) ??
      "Generated trigger did not return a dispatch_self intent."
    );
  }

  if (input.dispatches.length === 0) {
    return "Generated trigger accepted the event, but the manager did not dispatch it. Check the manifest trigger filter, enabled state, active run limit, or generated trigger consistency.";
  }

  if (input.createdDispatches.length === 0) {
    return "The manager matched the trigger, but no new run was created. A run may already exist for this idempotency key, or the Nanite may already have an active run.";
  }

  return null;
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

function countActiveRunsForNanite(state: NaniteManagerState, naniteId: string): number {
  return state.runOrder.reduce((count, runId) => {
    const run = state.runs[runId];
    return run?.naniteId === naniteId && !isTerminalNaniteRunStatus(run.status) ? count + 1 : count;
  }, 0);
}

function getRunOrThrow(state: NaniteManagerState, runId: string): NaniteRunRecord {
  const run = state.runs[runId];
  if (!run) {
    throw new AppError("naniteRunNotFound", {
      details: { runId },
      message: `${APP_ERRORS.naniteRunNotFound.message}: ${runId}`,
    });
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
  const repository = input.message.surface.raw.repository.full_name;
  const repositoryNanites = nanites.filter((nanite) =>
    nanite.manifest.permissions.github?.repositories.includes(repository),
  );
  const activeRuns = input.state.runOrder
    .map((runId) => input.state.runs[runId])
    .filter((run) => run && !isTerminalNaniteRunStatus(run.status))
    .slice(0, 5);
  const lines = [`Sigvelo manager received this in \`${repository}\`.`, ""];

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
      const resolveAgent = async () => this.subAgent(SigveloNaniteAgent, naniteId);
      let agent: Awaited<ReturnType<typeof resolveAgent>>;

      try {
        agent = await resolveAgent();
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
      output.triggerSource = selectedNanite?.manifest.triggerSource ?? null;
    }
    if (include.has("transcript") || include.has("submissions")) {
      if (!selectedNaniteId || !selectedNanite) {
        output.think = null;
      } else {
        const agent = await this.subAgent(SigveloNaniteAgent, selectedNaniteId);
        output.think = await agent.inspectDebug({
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
      throw new AppError("naniteNotFound", {
        details: { naniteId: input.naniteId },
        message: `${APP_ERRORS.naniteNotFound.message}: ${input.naniteId}`,
      });
    }

    const agent = await this.subAgent(SigveloNaniteAgent, input.naniteId);
    return agent.exploreWorkspace(input);
  }

  @callable()
  async resetNaniteDebug(input: ResetNaniteDebugInput): Promise<ResetNaniteDebugOutput> {
    const snapshot = await this.getSnapshot();
    if (!snapshot.nanites[input.naniteId]) {
      throw new AppError("naniteNotFound", {
        details: { naniteId: input.naniteId },
        message: `${APP_ERRORS.naniteNotFound.message}: ${input.naniteId}`,
      });
    }

    const agent = await this.subAgent(SigveloNaniteAgent, input.naniteId);
    return {
      managerName: this.name,
      naniteId: input.naniteId,
      reset: await agent.resetDebugState(),
    };
  }

  @callable()
  async testGeneratedTrigger(
    input: TestGeneratedTriggerInput,
  ): Promise<TestGeneratedTriggerOutput> {
    const snapshot = await this.getSnapshot();
    const nanite = snapshot.nanites[input.naniteId];
    if (!nanite) {
      throw new AppError("naniteNotFound", {
        details: { naniteId: input.naniteId },
        message: `${APP_ERRORS.naniteNotFound.message}: ${input.naniteId}`,
      });
    }

    const triggerSource = nanite.manifest.triggerSource;
    const eventType = getGitHubWebhookEventName(input.event);
    if (!triggerSource) {
      const error = "Nanite has no triggerSource for generated trigger testing.";
      naniteManagerLogger.error(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
        ...createManagerLogContext(this.name, { naniteId: input.naniteId }),
        [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: false,
        [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 0,
        test: true,
        eventType,
        error,
      });
      return {
        ok: false,
        hasGeneratedTrigger: false,
        accepted: false,
        noopReasons: [],
        error,
      };
    }

    const triggerResult = await runGeneratedTrigger({
      loader: this.env.LOADER,
      sourceCode: triggerSource,
      cacheKey: `${this.name}:${nanite.manifest.id}:${nanite.latestVersion.manifestHash}:${eventType}:test`,
      event: input.event,
    });

    if (!triggerResult.ok) {
      naniteManagerLogger.error(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
        ...createManagerLogContext(this.name, { naniteId: input.naniteId }),
        [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: false,
        [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 0,
        hasGeneratedTrigger: true,
        test: true,
        eventType,
        error: triggerResult.error,
      });
      return {
        ok: false,
        hasGeneratedTrigger: true,
        accepted: false,
        noopReasons: [],
        error: triggerResult.error,
      };
    }

    const dispatchIntentCount = getDispatchIntents(triggerResult.intents).length;
    const noopReasons = getNoopIntents(triggerResult.intents).map((intent) => intent.reason);
    naniteManagerLogger.info(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
      ...createManagerLogContext(this.name, { naniteId: input.naniteId }),
      [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: dispatchIntentCount > 0,
      [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: triggerResult.intents.length,
      dispatchIntentCount,
      hasGeneratedTrigger: true,
      test: true,
      eventType,
    });

    return {
      ok: true,
      hasGeneratedTrigger: true,
      accepted: dispatchIntentCount > 0,
      noopReasons,
      error: null,
    };
  }

  @callable()
  async testNaniteTrigger(input: TestNaniteTriggerInput): Promise<TestNaniteTriggerOutput> {
    const githubInstallationId = getGitHubInstallationIdFromManagerName(this.name);
    if (!githubInstallationId) {
      throw new AppError("naniteManagerInstallationRequired");
    }

    const deliveryId = `sigvelo-trigger-test-${input.requestId ?? crypto.randomUUID()}`;
    const commonDispatchInput = {
      sigveloTriggerTest: true,
      sigveloTestInstruction: input.testInstruction ?? NANITE_TRIGGER_TEST_INSTRUCTION,
      sigveloTestActor: input.actorId ?? "unknown",
    };
    const event = buildGitHubTriggerFixture({
      fixture: input.event.fixture,
      deliveryId,
      installationId: githubInstallationId,
      overrides: input.event.overrides,
    });
    const eventSnapshot = snapshotGitHubWebhookEvent(event);
    let generatedTrigger: TestGeneratedTriggerOutput;
    let dispatches: GitHubWebhookRunDispatch[];

    generatedTrigger = await this.testGeneratedTrigger({
      naniteId: input.naniteId,
      event,
    });
    dispatches = generatedTrigger.ok
      ? await this.handleGitHubWebhook({
          githubInstallationId,
          event,
          onlyNaniteId: input.naniteId,
          dispatchInput: commonDispatchInput,
        })
      : [];

    if (!generatedTrigger.ok) {
      return {
        ok: false,
        managerName: this.name,
        naniteId: input.naniteId,
        fixture: input.event.fixture,
        event: eventSnapshot,
        acceptance: {
          fixtureBuilt: true,
          triggerAcceptedEvent: false,
          runCreated: false,
          modelDispatched: false,
          terminalOutcomeReached: false,
          triggerRejectionReason: getTriggerTestRejectionReason({
            generatedTrigger,
            dispatches,
            createdDispatches: [],
          }),
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
    const triggerRejectionReason = getTriggerTestRejectionReason({
      generatedTrigger,
      dispatches,
      createdDispatches,
    });
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
      fixture: input.event.fixture,
      event: eventSnapshot,
      acceptance: {
        fixtureBuilt: true,
        triggerAcceptedEvent: dispatches.length > 0,
        runCreated: createdDispatches.length > 0,
        modelDispatched: dispatchedRuns.length > 0,
        terminalOutcomeReached,
        triggerRejectionReason,
      },
      runs,
      agentFeedback,
      error:
        createdDispatches.length === 0
          ? (triggerRejectionReason ??
            "The trigger did not create a new Nanite run. Check the manifest trigger filter, generated trigger code, fixture payload, or trigger idempotency key.")
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
      await agent.cancelRunFromManager({
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
  async deprovisionNanite(input: DeprovisionNaniteInput): Promise<DeprovisionNaniteOutput> {
    const current = await this.getSnapshot();
    const skippedNanite: DeprovisionNaniteOutput["skippedNanite"] = current.nanites[input.naniteId]
      ? null
      : { naniteId: input.naniteId, reason: "unknown_nanite" };

    if (skippedNanite) {
      naniteManagerLogger.info(LOG_EVENTS.NANITE_DEPROVISIONED, {
        ...createManagerLogContext(this.name),
        reason: input.reason,
        deprovisionedNaniteId: null,
        removedRunIds: [],
        skippedNanite,
      });
      return { deprovisionedNaniteId: null, removedRunIds: [], skippedNanite };
    }

    const nextNanites = { ...current.nanites };
    const nextRuntimeActivityByNanite = { ...current.runtimeActivityByNanite };

    const agent = await this.subAgent(SigveloNaniteAgent, input.naniteId);
    await agent.resetDebugState();
    await this.deleteSubAgent(SigveloNaniteAgent, input.naniteId);
    delete nextNanites[input.naniteId];
    delete nextRuntimeActivityByNanite[input.naniteId];

    const removedRunIds: string[] = [];
    const nextRuns = { ...current.runs };
    const nextRunOrder = current.runOrder.filter((runId) => {
      const run = current.runs[runId];
      if (run?.naniteId === input.naniteId) {
        delete nextRuns[runId];
        removedRunIds.push(runId);
        return false;
      }

      return true;
    });

    this.setState({
      ...current,
      nanites: nextNanites,
      runs: nextRuns,
      runOrder: nextRunOrder,
      runtimeActivityByNanite: nextRuntimeActivityByNanite,
      updatedAt: nowIso(),
    });

    naniteManagerLogger.info(LOG_EVENTS.NANITE_DEPROVISIONED, {
      ...createManagerLogContext(this.name),
      reason: input.reason,
      deprovisionedNaniteId: input.naniteId,
      removedRunIds,
      skippedNanite: null,
    });

    return { deprovisionedNaniteId: input.naniteId, removedRunIds, skippedNanite: null };
  }

  override async onBeforeSubAgent(
    _request: Request,
    child: { className: string; name: string },
  ): Promise<Response | void> {
    if (child.className !== SigveloNaniteAgent.name) {
      return new Response(APP_ERRORS.naniteSubAgentNotFound.message, {
        status: APP_ERRORS.naniteSubAgentNotFound.status,
      });
    }

    if (!this.state.nanites[child.name]) {
      return new Response(APP_ERRORS.naniteNotFound.message, {
        status: APP_ERRORS.naniteNotFound.status,
      });
    }
  }

  @callable()
  async registerNanite(input: RegisterNaniteInput): Promise<ManagedNanite> {
    const current = await this.getSnapshot();
    const manifest = input.manifest;

    const githubInstallationId = getGitHubInstallationIdFromManagerName(this.name);
    if (githubInstallationId) {
      await assertNaniteRepositoriesBelongToInstallation({
        env: this.env,
        githubInstallationId,
        manifest,
      });
    }

    const triggerSource = manifest.triggerSource;
    if (manifest.eventSource.type !== "manual" && !triggerSource) {
      throw new AppError("naniteTriggerValidationFailed", {
        details: { reason: "Machine event sources require manifest.triggerSource." },
        message: `${APP_ERRORS.naniteTriggerValidationFailed.message}: Machine event sources require manifest.triggerSource.`,
      });
    }

    if (triggerSource) {
      const validationResult = await validateGeneratedTriggerSource({
        loader: this.env.LOADER,
        sourceCode: triggerSource,
        event: null,
        cacheKey: `${this.name}:${manifest.id}:registration-validation`,
      });
      if (!validationResult.ok) {
        throw new AppError("naniteTriggerValidationFailed", {
          details: { reason: validationResult.error },
          message: `${APP_ERRORS.naniteTriggerValidationFailed.message}: ${validationResult.error}`,
        });
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
      nanite.manifest.eventSource.type === "schedule" ||
      nanite.manifest.eventSource.type === "scheduleEvery" ||
      existing?.manifest.eventSource.type === "schedule" ||
      existing?.manifest.eventSource.type === "scheduleEvery"
    ) {
      const agent = await this.subAgent(SigveloNaniteAgent, nanite.manifest.id);
      await agent.syncScheduleFromManager({
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
      throw new AppError("naniteNotFound", {
        details: { naniteId: input.naniteId },
        message: `${APP_ERRORS.naniteNotFound.message}: ${input.naniteId}`,
      });
    }

    if (!nanite.enabled) {
      throw new AppError("naniteDisabled", {
        details: { naniteId: input.naniteId },
        message: `${APP_ERRORS.naniteDisabled.message}: ${input.naniteId}`,
      });
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
    const workspaceHydration = buildDefaultRepositoryHydrationPlans({
      manifest: nanite.manifest,
      trigger: input.trigger,
    });
    const run: NaniteRunRecord = {
      runId,
      naniteId: input.naniteId,
      versionId: nanite.latestVersion.versionId,
      triggerKey,
      trigger: input.trigger,
      workspaceHydration,
      status: "running",
      summary: null,
      outputUrl: null,
      agentFeedback: null,
      humanRequest: null,
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
      throw new AppError("naniteNotFound", {
        details: { naniteId: run.naniteId },
        message: `${APP_ERRORS.naniteNotFound.message}: ${run.naniteId}`,
      });
    }

    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_DISPATCH_STARTED, {
      ...createManagerLogContext(this.name, { run }),
    });

    const resolveAgent = async () => this.subAgent(SigveloNaniteAgent, run.naniteId);
    let agent: Awaited<ReturnType<typeof resolveAgent>>;
    try {
      agent = await resolveAgent();
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
    const error = !input.waitForTerminalOutcome
      ? null
      : !terminalOutcomeReached
        ? "Timed out waiting for the Nanite to reach a terminal lifecycle outcome."
        : successfulOutcome
          ? null
          : "The Nanite reached a terminal outcome, but it did not complete successfully.";

    return {
      ok: input.waitForTerminalOutcome ? successfulOutcome : runs.length === 1,
      managerName: this.name,
      naniteId: input.naniteId,
      runs,
      error,
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
        throw new AppError("naniteRuntimeActivityMismatch", {
          details: {
            runId: input.runId,
            naniteId: input.naniteId,
            actualNaniteId: run.naniteId,
          },
          message: `${APP_ERRORS.naniteRuntimeActivityMismatch.message}: run ${input.runId} belongs to ${run.naniteId}, not ${input.naniteId}`,
        });
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
  async handleGitHubWebhook(input: HandleGitHubWebhookInput): Promise<GitHubWebhookRunDispatch[]> {
    const snapshot = await this.getSnapshot();
    const startedRuns: GitHubWebhookRunDispatch[] = [];
    const eventType = getGitHubWebhookEventName(input.event);

    for (const nanite of Object.values(snapshot.nanites)) {
      if (
        !nanite.enabled ||
        (input.onlyNaniteId && nanite.manifest.id !== input.onlyNaniteId) ||
        !githubEventSourceMatches(nanite, input.event)
      ) {
        continue;
      }

      const triggerSource = nanite.manifest.triggerSource;
      const dispatches: Array<{ input: TriggerDispatchInput | undefined }> = [];

      if (!triggerSource) {
        const error = "GitHub event source matched, but Nanite has no triggerSource.";
        naniteManagerLogger.error(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
          ...createManagerLogContext(this.name, { naniteId: nanite.manifest.id }),
          [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: false,
          [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 0,
          eventType,
          error,
        });

        const run = await this.startRun({
          naniteId: nanite.manifest.id,
          trigger: buildGitHubTriggerEvent({
            event: input.event,
            dispatchInput: {
              triggerError: error,
            },
          }),
        });
        startedRuns.push({
          run: await this.recordUnreportedRunCompletion({
            runId: run.runId,
            status: "error",
            error,
          }),
          created: true,
        });
        continue;
      }

      const triggerResult = await runGeneratedTrigger({
        loader: this.env.LOADER,
        sourceCode: triggerSource,
        cacheKey: `${this.name}:${nanite.manifest.id}:${nanite.latestVersion.manifestHash}:${eventType}`,
        event: input.event,
      });

      if (!triggerResult.ok) {
        naniteManagerLogger.error(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
          ...createManagerLogContext(this.name, { naniteId: nanite.manifest.id }),
          [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: false,
          [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 0,
          eventType,
          error: triggerResult.error,
        });

        const run = await this.startRun({
          naniteId: nanite.manifest.id,
          trigger: buildGitHubTriggerEvent({
            event: input.event,
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
        });
        continue;
      }

      const dispatchIntents = getDispatchIntents(triggerResult.intents);
      naniteManagerLogger.info(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
        ...createManagerLogContext(this.name, { naniteId: nanite.manifest.id }),
        [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: dispatchIntents.length > 0,
        [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: triggerResult.intents.length,
        dispatchIntentCount: dispatchIntents.length,
        eventType,
      });

      for (const intent of dispatchIntents) {
        dispatches.push({
          input: {
            ...intent.input,
            ...input.dispatchInput,
          },
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
          trigger: buildGitHubTriggerEvent({
            event: input.event,
            dispatchInput: dispatch.input,
          }),
        };
        const created =
          getExistingRunByTriggerKey(await this.getSnapshot(), buildTriggerKey(startInput)) ===
          null;
        const run = await this.startRun(startInput);
        startedRuns.push({
          run,
          created,
        });
      }
    }

    return startedRuns;
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
}
