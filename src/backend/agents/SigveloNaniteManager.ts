import { Agent, callable, getAgentByName } from "agents";
import type { EmitterWebhookEvent, EmitterWebhookEventName } from "@octokit/webhooks";
import { getLogger } from "@logtape/logtape";
import { APP_ERRORS, AppError, describeError } from "#/backend/errors.ts";
import { encodeHex } from "#/backend/crypto.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import {
  fetchGitHubPullRequestImpact,
  listReposAccessibleToInstallation,
  type GitHubAppPermissions,
  type GitHubPullRequestImpact,
} from "#/backend/github/index.ts";
import {
  SigveloNaniteAgent,
  type NaniteAgentMaintenanceOutput,
  type NaniteDebugInspectInput,
  type NaniteDebugInspectOutput,
  type NaniteDebugResetOutput,
  type NaniteRunWorkflowInspection,
  type NaniteWorkspaceExploreInput,
  type NaniteWorkspaceExploreOutput,
} from "#/backend/agents/SigveloNaniteAgent.ts";
import type { NaniteRunWorkflowResult } from "#/backend/agents/NaniteRunWorkflow.ts";
import {
  getDispatchIntents,
  getNoopIntents,
  runGeneratedTrigger,
  validateGeneratedTriggerSource,
  type TriggerDispatchInput,
} from "#/backend/nanites/triggers.ts";
import {
  buildNaniteAgentName,
  buildNaniteManagerKey,
  parseNaniteManagerKey,
  type NaniteManagerIdentity,
  type NaniteManagerKey,
} from "#/shared/utils/nanites.ts";
import {
  getGitHubWebhookBranch,
  getGitHubWebhookEventName,
  getGitHubWebhookAction,
  getGitHubWebhookHeadSha,
  getGitHubWebhookPullRequestNumber,
  getGitHubWebhookRepositoryFullName,
  parseGitHubTriggerTestEvent,
  snapshotGitHubWebhookEvent,
  type GitHubWebhookEventSnapshot,
  type GitHubWebhookEventLike,
} from "#/shared/utils/github.ts";
import {
  deleteNaniteCatalogProjection,
  manualActorFromId,
  naniteTriggerActor,
  recordAuditEvent,
  recordNaniteCatalogProjection,
  recordNaniteRunFact,
  systemActor,
  type ObservabilityActor,
} from "#/backend/observability/recorders.ts";
import { NANITES_AI_GATEWAY_ID } from "#/backend/nanites/language-model.ts";
import { resolveNaniteManifestRepositoryFullNames } from "#/backend/nanites/github-mcp-capabilities.ts";

export const NANITE_TRIGGER_TEST_TIMEOUT_MS = 60_000;
export const NANITE_TRIGGER_TEST_INSTRUCTION = [
  "This is a trigger acceptance test.",
  "Do not modify GitHub.",
  "Inspect the trigger payload and runtime context.",
  "If the trigger and context look correct, return a complete structured result with a short summary and agentFeedback for the authoring agent.",
].join(" ");

const MAX_RUNS_IN_STATE = 100;
const NANITE_MANAGER_MAINTENANCE_CRON = "0 8 * * *";
const STALE_RUNNING_AFTER_MS = 24 * 60 * 60 * 1000;
const TERMINAL_SUBMISSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TERMINAL_RUN_POLL_INTERVAL_MS = 500;
const naniteManagerLogger = getLogger(LOGGING.NANITES_CATEGORY);

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

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

type NanitePermissionSpec = {
  github?: {
    repositories: string[];
    appPermissions: GitHubAppPermissions;
  };
};

type NaniteManifestBase = {
  id: string;
  name: string;
  description: string;
  model: string;
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
  runtimeConfig?: NaniteRuntimeConfig;
  createdAt: string;
  updatedAt: string;
};

export type NaniteRuntimeConfig = {
  browser?: {
    enabled: boolean;
    targetUrl: string;
    evidenceRequired: boolean;
  };
  skillUrls?: string[];
};

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export const naniteRunStatuses = [
  "running",
  "waiting_for_manager",
  "complete",
  "no_change",
  "fail",
  "canceled",
] as const;
export type NaniteRunStatus = (typeof naniteRunStatuses)[number];
export type TerminalNaniteRunStatus = Extract<
  NaniteRunStatus,
  "complete" | "no_change" | "fail" | "canceled"
>;

const allowedRunStatusTransitions: Record<NaniteRunStatus, readonly NaniteRunStatus[]> = {
  running: ["waiting_for_manager", "complete", "no_change", "fail", "canceled"],
  waiting_for_manager: ["running", "complete", "no_change", "fail", "canceled"],
  complete: [],
  no_change: [],
  fail: [],
  canceled: [],
};
const terminalRunStatuses = new Set<NaniteRunStatus>(["complete", "no_change", "fail", "canceled"]);

function isTerminalNaniteRunStatus(status: NaniteRunStatus): status is TerminalNaniteRunStatus {
  return terminalRunStatuses.has(status);
}

export type TerminalNaniteRunRecord = Extract<NaniteRunRecord, { status: TerminalNaniteRunStatus }>;

export function isTerminalNaniteRunRecord(run: NaniteRunRecord): run is TerminalNaniteRunRecord {
  return isTerminalNaniteRunStatus(run.status);
}

function isRunOutcomeReached(
  status: NaniteRunStatus,
): status is TerminalNaniteRunStatus | "waiting_for_manager" {
  return status === "waiting_for_manager" || isTerminalNaniteRunStatus(status);
}

export const naniteRuntimeActivityStates = [
  "idle",
  "thinking",
  "tool_calling",
  "waiting_for_manager",
  "error",
] as const;
export type NaniteRuntimeActivityState = (typeof naniteRuntimeActivityStates)[number];

export type NaniteRuntimeActivity = {
  state: NaniteRuntimeActivityState;
  runId: string | null;
  toolName: string | null;
  lastActivityAt: string | null;
  error: string | null;
};

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

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

export type ManagerRequest = {
  id: string;
  request: string;
  createdAt: string;
};

export type NaniteAgentFeedback = {
  severity: "info" | "warning" | "error";
  message: string;
  suggestions?: string[];
};

type NaniteRunModelSnapshot = {
  runtimePath: "workers_ai_gateway";
  effectiveModelId: string;
  effectiveGatewayId: string;
  manifestVersionId: string;
  resolvedAt: string;
};

type NaniteRunRecordBase = {
  runId: string;
  naniteId: string;
  model: NaniteRunModelSnapshot;
  triggerKey: string;
  trigger: NaniteTriggerEvent;
  startedAt: string;
  updatedAt: string;
};

type NaniteTerminalRunRecord = {
  summary: string;
  completedAt: string;
} & (
  | { status: "complete"; outputUrl: string | null; agentFeedback: NaniteAgentFeedback | null }
  | { status: "no_change"; outputUrl: null; agentFeedback: NaniteAgentFeedback | null }
  | {
      status: "fail";
      outputUrl: null;
      agentFeedback: NaniteAgentFeedback | null;
      failure: { type: "workflow" } | { type: "unreported"; dispatchError: string };
    }
  | {
      status: "canceled";
      cancellation:
        | { type: "manager"; reason: string }
        | { type: "unreported"; dispatchError: string };
    }
);

export type NaniteRunRecord = NaniteRunRecordBase &
  (
    | { status: "running" }
    | { status: "waiting_for_manager"; managerRequest: ManagerRequest }
    | NaniteTerminalRunRecord
  );

function replaceRunRecordBase(run: NaniteRunRecord, updatedAt: string): NaniteRunRecordBase {
  return {
    runId: run.runId,
    naniteId: run.naniteId,
    model: run.model,
    triggerKey: run.triggerKey,
    trigger: run.trigger,
    startedAt: run.startedAt,
    updatedAt,
  };
}

export type NaniteManagerState = {
  nanites: Record<string, ManagedNanite>;
  runs: Record<string, NaniteRunRecord>;
  runOrder: string[];
  runtimeActivityByNanite: Record<string, NaniteRuntimeActivity>;
  updatedAt: string | null;
};

// ---------------------------------------------------------------------------
// Method inputs/outputs
// ---------------------------------------------------------------------------

export type RegisterNaniteInput = {
  manifest: NaniteManifest;
  runtimeConfig?: NaniteRuntimeConfig;
  actor?: ObservabilityActor | null;
  requestId?: string;
};

export type StartNaniteRunInput = {
  naniteId: string;
  trigger: NaniteTriggerEvent;
  actor?: ObservabilityActor | null;
};

export type HandleGitHubWebhookInput = {
  event: GitHubWebhookEventLike;
  dispatchInput?: TriggerDispatchInput;
  onlyNaniteId?: string;
};

export type GitHubWebhookRunDispatch = {
  run: NaniteRunRecord;
  created: boolean;
};

/** Per-nanite report of one webhook evaluation. */
export type NaniteWebhookEvaluation = {
  naniteId: string;
  /** Generated trigger failure (static validation, bundling, or execution). */
  triggerError: string | null;
  dispatchIntentCount: number;
  noopReasons: string[];
  /** Set when a dispatch intent was dropped instead of creating a run. */
  skippedReason: "active_run_exists" | null;
  dispatches: GitHubWebhookRunDispatch[];
};

export type StartNaniteManualRunInput = {
  naniteId: string;
  message: string;
  manualRequestId?: string;
  actorId: string | null;
  actor?: ObservabilityActor | null;
};

export type StartNaniteManualRunOutput = {
  managerName: string;
  naniteId: string;
  runs: NaniteRunRecord[];
} & ({ ok: true; error: null } | { ok: false; error: string });

export type TestNaniteTriggerInput = {
  naniteId: string;
  event: unknown;
  testInstruction?: string;
  actorId: string | null;
  actor?: ObservabilityActor | null;
  waitForTerminalOutcome?: boolean;
  timeoutMs?: number;
};

type TestNaniteTriggerOutputBase = {
  managerName: string;
  naniteId: string;
  acceptance: {
    triggerAcceptedEvent: boolean;
    runCreated: boolean;
    modelDispatched: boolean;
    terminalOutcomeReached: boolean;
    triggerRejectionReason: string | null;
  };
  runs: NaniteRunRecord[];
  agentFeedback: NaniteAgentFeedback | null;
};

export type TestNaniteTriggerOutput =
  | (TestNaniteTriggerOutputBase & {
      ok: true;
      error: null;
      event: GitHubWebhookEventSnapshot;
    })
  | (TestNaniteTriggerOutputBase & {
      ok: false;
      error: string;
      event: GitHubWebhookEventSnapshot | null;
    });

export const naniteDebugIncludeSections = [
  "nanites",
  "runs",
  "workflows",
  "runtimeActivity",
  "manifest",
  "triggerSource",
  "transcript",
  "submissions",
] as const;
export type NaniteDebugIncludeSection = (typeof naniteDebugIncludeSections)[number];

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

export type RunWorkflowDebugRecord = { runId: string } & NaniteRunWorkflowInspection;

export type InspectNaniteDebugOutput = {
  managerName: string;
  nanites?: ManagedNanite[];
  runs?: NaniteRunRecord[];
  workflows?: RunWorkflowDebugRecord[];
  runtimeActivity?: Record<string, NaniteRuntimeActivity>;
  manifest?: NaniteManifest | null;
  triggerSource?: string | null;
  think?: NaniteDebugInspectOutput | null;
};

export type ResetNaniteDebugInput = {
  naniteId: string;
};

export type ResetNaniteDebugOutput = {
  managerName: string;
  naniteId: string;
  reset: NaniteDebugResetOutput;
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
  actor?: ObservabilityActor | null;
  requestId?: string;
};

export type CancelNaniteRunsOutput = {
  canceledRuns: Array<Extract<NaniteRunRecord, { status: "canceled" }>>;
  skippedRuns: Array<{
    runId: string;
    reason: string;
  }>;
};

export type DeprovisionNaniteInput = {
  naniteId: string;
  reason: string;
  actor?: ObservabilityActor | null;
  requestId?: string;
};

export type DeprovisionNaniteOutput = {
  deprovisionedNaniteId: string | null;
  removedRunIds: string[];
  skippedNanite: {
    naniteId: string;
    reason: string;
  } | null;
};

export type NaniteManagerMaintenanceOutput = {
  checkedAt: string;
  staleRunningCutoffIso: string;
  terminalSubmissionCutoffIso: string;
  canceledRuns: Array<Extract<NaniteRunRecord, { status: "canceled" }>>;
  skippedRuns: CancelNaniteRunsOutput["skippedRuns"];
  maintainedNaniteAgents: Array<NaniteAgentMaintenanceOutput & { naniteId: string }>;
  resyncedNaniteIds: string[];
  failedNaniteAgentMaintenance: Array<{ naniteId: string; error: string }>;
  failedNaniteSyncs: Array<{ naniteId: string; error: string }>;
};

export type ResolveManagerRequestInput =
  | {
      kind: "resume";
      runId: string;
      requestId: string;
      message: string;
    }
  | {
      kind: "reject";
      runId: string;
      requestId: string;
      summary: string;
    };

export type RecordNaniteRuntimeActivityInput = {
  naniteId: string;
  runId: string | null;
  state: NaniteRuntimeActivityState;
  toolName?: string | null;
  error?: string | null;
};

// ---------------------------------------------------------------------------
// Worker-side entry point
// ---------------------------------------------------------------------------

export async function dispatchGitHubWebhookToNaniteManager({
  env,
  githubAppId,
  githubInstallationId,
  event,
}: {
  env: Env;
  githubAppId: number;
  githubInstallationId: number;
  event: EmitterWebhookEvent;
}): Promise<NaniteWebhookEvaluation[]> {
  const manager = await getAgentByName<Env, SigveloNaniteManager>(
    env.SigveloNaniteManager,
    buildNaniteManagerKey({ githubAppId, githubInstallationId }),
  );
  // The concrete DO stub expands the manager's full RPC graph and trips TS2589.
  return (
    manager as unknown as {
      handleGitHubWebhook: SigveloNaniteManager["handleGitHubWebhook"];
    }
  ).handleGitHubWebhook({ event });
}

type NaniteAgentRpc = Pick<
  SigveloNaniteAgent,
  | "startRunWorkflowFromManager"
  | "syncScheduleFromManager"
  | "syncIdentityFromManager"
  | "terminateRunWorkflowFromManager"
  | "resetDebugState"
  | "inspectDebug"
  | "inspectRunWorkflow"
  | "exploreWorkspace"
  | "maintainFromManager"
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
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

async function createNaniteSourceVersion(
  manifest: NaniteManifest,
  registeredAt: string,
): Promise<NaniteSourceVersion> {
  const manifestHash = encodeHex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(sortJsonValue(manifest))),
    ),
  );
  return {
    versionId: `manifest-${manifestHash.slice(0, 12)}`,
    manifestHash,
    registeredAt,
  };
}

function normalizeNaniteManifest(manifest: NaniteManifest): NaniteManifest {
  const modelId = typeof manifest.model === "string" ? manifest.model.trim() : "";
  if (!modelId) {
    throw new AppError("nanitesModelSelectionInvalid", {
      details: { reason: "Nanite manifests must include a model id.", modelId: null },
    });
  }

  return { ...manifest, model: modelId };
}

function normalizeNaniteRuntimeConfig(
  runtimeConfig: NaniteRuntimeConfig | undefined,
): NaniteRuntimeConfig | undefined {
  const browser = runtimeConfig?.browser;
  const skillUrls = [
    ...new Set(runtimeConfig?.skillUrls?.map((url) => url.trim()).filter(Boolean)),
  ];
  if (!browser && skillUrls.length === 0) {
    return undefined;
  }

  return {
    ...(browser ? { browser } : {}),
    ...(skillUrls.length > 0 ? { skillUrls } : {}),
  };
}

function isScheduledEventSource(
  eventSource: NaniteEventSourceSpec,
): eventSource is NaniteScheduledEventSourceSpec {
  return eventSource.type === "schedule" || eventSource.type === "scheduleEvery";
}

/**
 * One-shot date/delay schedules must not be re-armed by maintenance — a
 * re-armed past date fires immediately. Everything else (cron strings,
 * intervals, or non-schedule nanites needing stray rows cleared) is safe to resync.
 */
function isSafeToResyncSchedule(nanite: ManagedNanite): boolean {
  const eventSource = nanite.manifest.eventSource;
  if (!isScheduledEventSource(eventSource)) {
    return true;
  }

  if (eventSource.type === "scheduleEvery") {
    return true;
  }

  const when = eventSource.when;
  const isOneShot =
    typeof when === "number" ||
    (typeof when === "string" && !Number.isNaN(new Date(when).getTime()));
  return !isOneShot;
}

function buildTriggerKey(naniteId: string, trigger: NaniteTriggerEvent): string {
  switch (trigger.type) {
    case "manual":
      return `${naniteId}:manual:${trigger.requestId}`;
    case "schedule":
      return `${naniteId}:schedule:${JSON.stringify(trigger.eventSource)}:${trigger.scheduledAt}`;
    case "github":
      return [
        naniteId,
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

function githubEventSourceMatches(nanite: ManagedNanite, event: GitHubWebhookEventLike): boolean {
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
  if (allowedRepositories.length > 0 && !(repository && allowedRepositories.includes(repository))) {
    return false;
  }

  const action = getGitHubWebhookAction(event);
  if (eventSource.actions && !(action && eventSource.actions.includes(action))) {
    return false;
  }

  const branch = getGitHubWebhookBranch(event);
  if (eventSource.branches && !(branch && eventSource.branches.includes(branch))) {
    return false;
  }

  return true;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(value ?? fallback, 1), max);
}

function asSet<T extends string>(value: T | T[] | undefined): Set<T> | null {
  return value ? new Set(Array.isArray(value) ? value : [value]) : null;
}

function summarizeTriggerRejection(evaluation: NaniteWebhookEvaluation | null): string | null {
  if (!evaluation) {
    return "The Nanite event source filter did not match the test event. Check the manifest events, repositories, actions, and branches.";
  }

  if (evaluation.triggerError) {
    return `Generated TypeScript trigger failed before dispatch: ${evaluation.triggerError}`;
  }

  if (evaluation.dispatchIntentCount === 0) {
    return evaluation.noopReasons.length > 0
      ? `Generated trigger returned noop: ${evaluation.noopReasons.join("; ")}`
      : "Generated trigger did not return a dispatch_self intent.";
  }

  if (evaluation.skippedReason === "active_run_exists") {
    return "The trigger accepted the event, but this Nanite already has an active run. Wait for it to finish or cancel it.";
  }

  if (evaluation.dispatches.every((dispatch) => !dispatch.created)) {
    return "The trigger accepted the event, but a run already exists for this idempotency key.";
  }

  return null;
}

function selectDebugRuns(
  state: NaniteManagerState,
  input: InspectNaniteDebugInput,
  statuses: Set<NaniteRunStatus> | null,
  limit: number,
): NaniteRunRecord[] {
  const runs: NaniteRunRecord[] = [];
  for (const runId of state.runOrder) {
    const run = state.runs[runId];
    if (!run) {
      throw new AppError("naniteRunNotFound", {
        details: { runId },
        message: `${APP_ERRORS.naniteRunNotFound.message}: ${runId}`,
      });
    }
    if (
      (!input.naniteId || run.naniteId === input.naniteId) &&
      (!input.runId || run.runId === input.runId) &&
      (!statuses || statuses.has(run.status))
    ) {
      runs.push(run);
      if (runs.length === limit) {
        break;
      }
    }
  }
  return runs;
}

function buildDebugSnapshotSections({
  state,
  input,
  include,
  runs,
  workflows,
  selectedNanite,
  activities,
}: {
  state: NaniteManagerState;
  input: InspectNaniteDebugInput;
  include: Set<NaniteDebugIncludeSection>;
  runs: NaniteRunRecord[];
  workflows: RunWorkflowDebugRecord[] | undefined;
  selectedNanite: ManagedNanite | null;
  activities: Set<NaniteRuntimeActivityState> | null;
}): Omit<InspectNaniteDebugOutput, "managerName" | "think"> {
  const output: Omit<InspectNaniteDebugOutput, "managerName" | "think"> = {};

  if (include.has("nanites")) {
    output.nanites = Object.values(state.nanites).filter(
      (nanite) => !input.naniteId || nanite.manifest.id === input.naniteId,
    );
  }
  if (include.has("runs")) {
    output.runs = runs;
  }
  if (workflows) {
    output.workflows = workflows;
  }
  if (include.has("runtimeActivity")) {
    output.runtimeActivity = Object.fromEntries(
      Object.entries(state.runtimeActivityByNanite).filter(
        ([naniteId, activity]) =>
          (!input.naniteId || input.naniteId === naniteId) &&
          (!input.runId || activity.runId === input.runId) &&
          (!activities || activities.has(activity.state)),
      ),
    );
  }
  if (include.has("manifest")) {
    output.manifest = selectedNanite?.manifest ?? null;
  }
  if (include.has("triggerSource")) {
    output.triggerSource = selectedNanite?.manifest.triggerSource ?? null;
  }

  return output;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SigveloNaniteManager extends Agent<Env, NaniteManagerState> {
  initialState: NaniteManagerState = {
    nanites: {},
    runs: {},
    runOrder: [],
    runtimeActivityByNanite: {},
    updatedAt: null,
  };

  override async onStart(): Promise<void> {
    await this.schedule(NANITE_MANAGER_MAINTENANCE_CRON, "maintainNanites", undefined, {
      idempotent: true,
    });
  }

  private managerKey(): NaniteManagerKey {
    const managerName = parseNaniteManagerKey(this.name) ? (this.name as NaniteManagerKey) : null;
    if (!managerName) {
      throw new AppError("agentAuthorizationForbidden", {
        details: { reason: "Nanite manager is not installation-scoped." },
      });
    }

    return managerName;
  }

  private async naniteAgent(naniteId: string): Promise<NaniteAgentRpc> {
    const managerName = this.managerKey();
    return (await getAgentByName<Env, SigveloNaniteAgent>(
      this.env.SigveloNaniteAgent,
      buildNaniteAgentName({ managerName, naniteId }),
    )) as unknown as NaniteAgentRpc;
  }

  async getSnapshot(): Promise<NaniteManagerState> {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------------

  async registerNanite(input: RegisterNaniteInput): Promise<ManagedNanite> {
    const manifest = normalizeNaniteManifest(input.manifest);
    const runtimeConfig = normalizeNaniteRuntimeConfig(input.runtimeConfig);

    const identity = this.identity();
    if (identity) {
      await this.assertRepositoriesBelongToInstallation(identity, manifest);
    }

    if (manifest.eventSource.type !== "manual") {
      if (!manifest.triggerSource) {
        throw new AppError("naniteTriggerValidationFailed", {
          details: { reason: "Machine event sources require manifest.triggerSource." },
          message: `${APP_ERRORS.naniteTriggerValidationFailed.message}: Machine event sources require manifest.triggerSource.`,
        });
      }

      const validation = await validateGeneratedTriggerSource({
        loader: this.env.LOADER,
        sourceCode: manifest.triggerSource,
        event: null,
        cacheKey: `${this.name}:${manifest.id}:registration-validation`,
      });
      if (!validation.ok) {
        throw new AppError("naniteTriggerValidationFailed", {
          details: { reason: validation.error },
          message: `${APP_ERRORS.naniteTriggerValidationFailed.message}: ${validation.error}`,
        });
      }
    }

    const registeredAt = nowIso();
    const existing = this.state.nanites[manifest.id];
    const nanite: ManagedNanite = {
      manifest,
      latestVersion: await createNaniteSourceVersion(manifest, registeredAt),
      runtimeConfig: runtimeConfig ?? existing?.runtimeConfig,
      createdAt: existing?.createdAt ?? registeredAt,
      updatedAt: registeredAt,
    };

    this.setState({
      ...this.state,
      nanites: { ...this.state.nanites, [manifest.id]: nanite },
      updatedAt: registeredAt,
    });

    const shouldSyncSchedule =
      isScheduledEventSource(nanite.manifest.eventSource) ||
      (existing && isScheduledEventSource(existing.manifest.eventSource));
    if (shouldSyncSchedule || runtimeConfig !== undefined) {
      const agent = await this.naniteAgent(manifest.id);
      if (shouldSyncSchedule) {
        await agent.syncScheduleFromManager({ managerName: this.name, nanite });
      } else {
        await agent.syncIdentityFromManager({ managerName: this.name, nanite });
      }
    }

    await this.recordObservabilityFact(
      existing ? "nanite.updated" : "nanite.created",
      async (db, identity) => {
        const actor = input.actor ?? systemActor("maintenance");
        await recordNaniteCatalogProjection(db, {
          githubAppId: identity.githubAppId,
          githubInstallationId: identity.githubInstallationId,
          nanite,
          actor,
        });
        await recordAuditEvent(db, {
          eventName: existing ? "audit.nanite.updated" : "audit.nanite.created",
          githubAppId: identity.githubAppId,
          githubInstallationId: identity.githubInstallationId,
          naniteId: manifest.id,
          actor,
          targetType: "nanite",
          targetId: manifest.id,
          outcome: "success",
          requestId: input.requestId,
          metadata: {
            eventSourceType: manifest.eventSource.type,
            latestVersionId: nanite.latestVersion.versionId,
          },
        });
      },
    );

    return nanite;
  }

  // Model is part of the manifest, so a switch from the Nanite card re-registers
  // the manifest through the normal path (new version + audit). beforeTurn on the
  // Nanite agent refreshes the manifest, so chat and runs both pick up the model.
  @callable()
  async setNaniteModel(input: {
    naniteId: string;
    modelId: string;
    actor?: ObservabilityActor | null;
  }): Promise<ManagedNanite> {
    const model = input.modelId.trim();
    if (!model) {
      throw new AppError("requestValidationFailed", {
        details: { reason: "Model id must not be empty." },
      });
    }
    const existing = this.state.nanites[input.naniteId];
    if (!existing) {
      throw new AppError("naniteNotFound", { details: { naniteId: input.naniteId } });
    }
    if (existing.manifest.model === model) {
      return existing;
    }
    return this.registerNanite({
      manifest: { ...existing.manifest, model },
      actor: input.actor,
    });
  }

  @callable()
  async deprovisionNanite(input: DeprovisionNaniteInput): Promise<DeprovisionNaniteOutput> {
    const current = this.state;
    const nanite = current.nanites[input.naniteId];
    if (!nanite) {
      const skippedNanite = { naniteId: input.naniteId, reason: "unknown_nanite" };
      naniteManagerLogger.info(LOG_EVENTS.NANITE_DEPROVISIONED, {
        ...this.logContext({ naniteId: input.naniteId }),
        reason: input.reason,
        deprovisionedNaniteId: null,
        skippedNanite,
      });
      return { deprovisionedNaniteId: null, removedRunIds: [], skippedNanite };
    }

    const agent = await this.naniteAgent(input.naniteId);
    await agent.resetDebugState();

    const nextNanites = { ...current.nanites };
    const nextActivity = { ...current.runtimeActivityByNanite };
    delete nextNanites[input.naniteId];
    delete nextActivity[input.naniteId];

    const removedRunIds: string[] = [];
    const nextRuns = { ...current.runs };
    const nextRunOrder = current.runOrder.filter((runId) => {
      const run = current.runs[runId];
      if (!run) {
        throw new AppError("naniteRunNotFound", {
          details: { runId },
          message: `${APP_ERRORS.naniteRunNotFound.message}: ${runId}`,
        });
      }
      if (run.naniteId === input.naniteId) {
        delete nextRuns[runId];
        removedRunIds.push(runId);
        return false;
      }
      return true;
    });

    this.setState({
      nanites: nextNanites,
      runs: nextRuns,
      runOrder: nextRunOrder,
      runtimeActivityByNanite: nextActivity,
      updatedAt: nowIso(),
    });

    naniteManagerLogger.info(LOG_EVENTS.NANITE_DEPROVISIONED, {
      ...this.logContext({ naniteId: input.naniteId }),
      reason: input.reason,
      deprovisionedNaniteId: input.naniteId,
      removedRunIds,
    });

    await this.recordObservabilityFact("nanite.deprovisioned", async (db, identity) => {
      const actor = input.actor ?? systemActor("maintenance");
      await deleteNaniteCatalogProjection(db, {
        githubInstallationId: identity.githubInstallationId,
        naniteId: input.naniteId,
      });
      await recordAuditEvent(db, {
        eventName: "audit.nanite.deprovisioned",
        githubAppId: identity.githubAppId,
        githubInstallationId: identity.githubInstallationId,
        naniteId: input.naniteId,
        actor,
        targetType: "nanite",
        targetId: input.naniteId,
        outcome: "success",
        reasonCode: input.reason,
        requestId: input.requestId,
        metadata: {
          removedRunCount: removedRunIds.length,
          latestVersionId: nanite.latestVersion.versionId,
        },
      });
    });

    return { deprovisionedNaniteId: input.naniteId, removedRunIds, skippedNanite: null };
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  async startRun(input: StartNaniteRunInput): Promise<NaniteRunRecord> {
    const nanite = this.requireNanite(input.naniteId);
    const triggerKey = buildTriggerKey(input.naniteId, input.trigger);
    const existingRun = this.findRunByTriggerKey(triggerKey);
    if (existingRun) {
      naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_DEDUPED, {
        ...this.logContext({ run: existingRun }),
      });
      return existingRun;
    }

    const startedAt = nowIso();
    const runId = crypto.randomUUID();
    const run: NaniteRunRecord = {
      runId,
      naniteId: input.naniteId,
      model: {
        runtimePath: "workers_ai_gateway",
        effectiveModelId: nanite.manifest.model,
        effectiveGatewayId: NANITES_AI_GATEWAY_ID,
        manifestVersionId: nanite.latestVersion.versionId,
        resolvedAt: startedAt,
      },
      triggerKey,
      trigger: input.trigger,
      status: "running",
      startedAt,
      updatedAt: startedAt,
    };

    const runOrder = [runId, ...this.state.runOrder].slice(0, MAX_RUNS_IN_STATE);
    const runs: Record<string, NaniteRunRecord> = { [runId]: run };
    for (const id of runOrder) {
      const existing = this.state.runs[id];
      if (existing) {
        runs[id] = existing;
      }
    }

    this.setState({
      ...this.state,
      runs,
      runOrder,
      runtimeActivityByNanite: {
        ...this.state.runtimeActivityByNanite,
        [input.naniteId]: {
          state: "idle",
          runId,
          toolName: null,
          lastActivityAt: startedAt,
          error: null,
        },
      },
      updatedAt: startedAt,
    });

    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_CREATED, {
      ...this.logContext({ run }),
      versionId: run.model.manifestVersionId,
    });

    const actor = input.actor ?? naniteTriggerActor(run.trigger);
    await this.recordRunFact({ run, actor });
    await this.recordObservabilityFact("run.started.audit", async (db, identity) => {
      await recordAuditEvent(db, {
        eventName: "audit.run.started",
        githubAppId: identity.githubAppId,
        githubInstallationId: identity.githubInstallationId,
        naniteId: run.naniteId,
        runKey: run.runId,
        actor,
        targetType: "run",
        targetId: run.runId,
        outcome: "success",
        requestId: run.trigger.type === "manual" ? run.trigger.requestId : undefined,
        metadata: { triggerType: run.trigger.type },
      });
    });

    return run;
  }

  async dispatchRun(input: { runId: string }): Promise<NaniteRunRecord> {
    const run = this.requireRun(input.runId);
    if (run.status !== "running") {
      return run;
    }

    const nanite = this.requireNanite(run.naniteId);
    try {
      const agent = await this.naniteAgent(run.naniteId);
      await agent.startRunWorkflowFromManager({ managerName: this.name, nanite, run });
    } catch (error) {
      if (
        describeError(error).includes(`Workflow with ID "${run.runId}" is already being tracked`)
      ) {
        // Idempotent re-dispatch: the Agents SDK already tracks this run's Workflow. The match is on
        // an SDK-internal message (no typed duplicate-id error exists); log so it isn't silent.
        naniteManagerLogger.debug(LOG_EVENTS.NANITE_RUN_DISPATCH_SUCCEEDED, {
          ...this.logContext({ run }),
          error: describeError(error),
        });
        return run;
      }

      naniteManagerLogger.error(LOG_EVENTS.NANITE_RUN_DISPATCH_FAILED, {
        ...this.logContext({ run }),
        error: describeError(error),
      });
      return this.recordRunFailureWithoutWorkflowOutput({
        runId: input.runId,
        error: `Nanite run Workflow failed to start: ${describeError(error)}`,
      });
    }

    return run;
  }

  async startNaniteManualRun(
    input: StartNaniteManualRunInput,
  ): Promise<StartNaniteManualRunOutput> {
    const run = await this.startRun({
      naniteId: input.naniteId,
      actor: input.actor ?? manualActorFromId(input.actorId),
      trigger: {
        type: "manual",
        requestId: input.manualRequestId ?? crypto.randomUUID(),
        actorId: input.actorId,
        message: input.message,
      },
    });
    const dispatched = await this.dispatchRun({ runId: run.runId });

    const output = {
      managerName: this.name,
      naniteId: input.naniteId,
      runs: [dispatched],
    };
    const ok = dispatched.status !== "fail" && dispatched.status !== "canceled";
    return ok
      ? { ...output, ok: true, error: null }
      : { ...output, ok: false, error: "The Nanite run did not dispatch successfully." };
  }

  async recordWorkflowResult(input: {
    runId: string;
    naniteId: string;
    result: NaniteRunWorkflowResult;
  }): Promise<NaniteRunRecord> {
    const current = this.requireRun(input.runId);
    this.requireRunNaniteMatch(current, input.naniteId);
    const result = input.result;
    if (result.kind === "ask_manager") {
      if (current.status === "waiting_for_manager") {
        return current;
      }
      // A run can be canceled (terminal) in the window before a late ask_manager
      // callback lands; the SDK delivers onWorkflowComplete regardless of run state.
      // Treat the late callback as a no-op rather than throwing on the transition.
      if (isTerminalNaniteRunRecord(current)) {
        return current;
      }

      assertNaniteRunStatusTransition(current.status, "waiting_for_manager");
      const createdAt = nowIso();
      const run = this.setRun(input.runId, (previous) => {
        return {
          ...replaceRunRecordBase(previous, createdAt),
          status: "waiting_for_manager",
          managerRequest: {
            id: crypto.randomUUID(),
            request: result.request,
            createdAt,
          },
        };
      });
      this.setActivity(run.naniteId, {
        state: "waiting_for_manager",
        runId: run.runId,
        toolName: null,
        lastActivityAt: createdAt,
        error: null,
      });

      await this.recordRunFact({ run, actor: naniteTriggerActor(run.trigger) });
      return run;
    }

    const status = result.kind;
    if (isTerminalNaniteRunRecord(current)) {
      return current;
    }

    assertNaniteRunStatusTransition(current.status, status);
    const completedAt = nowIso();
    const run = this.setRun(input.runId, (previous) => {
      const base = replaceRunRecordBase(previous, completedAt);
      if (result.kind === "complete") {
        return {
          ...base,
          status: "complete",
          summary: result.summary,
          outputUrl: result.outputUrl,
          agentFeedback: result.agentFeedback,
          completedAt,
        };
      }
      if (result.kind === "no_change") {
        return {
          ...base,
          status: "no_change",
          summary: result.summary,
          outputUrl: null,
          agentFeedback: result.agentFeedback,
          completedAt,
        };
      }

      return {
        ...base,
        status: "fail",
        summary: result.summary,
        outputUrl: null,
        agentFeedback: result.agentFeedback,
        failure: { type: "workflow" },
        completedAt,
      };
    });
    this.setActivity(run.naniteId, {
      state: "idle",
      runId: run.runId,
      toolName: null,
      lastActivityAt: completedAt,
      error: null,
    });

    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_COMPLETED, {
      ...this.logContext({ run }),
      status: run.status,
      source: "think_workflow_output",
      hasOutputUrl: run.outputUrl !== null,
      hasAgentFeedback: "agentFeedback" in run && run.agentFeedback !== null,
    });

    await this.recordRunFact({ run, actor: naniteTriggerActor(run.trigger) });
    if (run.status === "fail") {
      await this.recordRunFailureAudit({ run, reasonCode: "workflow_fail_result" });
    }
    return run;
  }

  async resolveManagerRequest(input: ResolveManagerRequestInput): Promise<NaniteRunRecord> {
    const current = this.requireWaitingManagerRequest(input);

    if (input.kind === "reject") {
      return this.recordWorkflowResult({
        runId: input.runId,
        naniteId: current.naniteId,
        result: {
          kind: "fail",
          summary: input.summary,
          agentFeedback: null,
        },
      });
    }

    await this.recordWorkflowResult({
      runId: input.runId,
      naniteId: current.naniteId,
      result: {
        kind: "no_change",
        summary: "Manager answered this request by starting a follow-up run.",
        agentFeedback: null,
      },
    });

    const run = await this.startRun({
      naniteId: current.naniteId,
      actor: naniteTriggerActor(current.trigger),
      trigger: {
        type: "manual",
        requestId: crypto.randomUUID(),
        actorId: current.trigger.type === "manual" ? current.trigger.actorId : null,
        message: [
          `Manager response to Nanite run ${current.runId}.`,
          "",
          "Original Nanite request:",
          current.managerRequest.request,
          "",
          "Manager response:",
          input.message,
        ].join("\n"),
      },
    });
    return this.dispatchRun({ runId: run.runId });
  }

  /**
   * Fails a run before the Workflow can project a structured result.
   * Normal Think prompt completion is handled by `NaniteRunWorkflow`.
   */
  async recordRunFailureWithoutWorkflowOutput(input: {
    runId: string;
    error: string;
  }): Promise<NaniteRunRecord> {
    const current = this.requireRun(input.runId);
    if (isTerminalNaniteRunRecord(current) || current.status === "waiting_for_manager") {
      return current;
    }

    const observedAt = nowIso();
    const run = this.setRun(input.runId, (previous) => {
      const base = replaceRunRecordBase(previous, observedAt);
      return {
        ...base,
        status: "fail",
        summary: input.error,
        outputUrl: null,
        agentFeedback: null,
        failure: { type: "unreported", dispatchError: input.error },
        completedAt: observedAt,
      };
    });
    this.setActivity(run.naniteId, {
      state: "error",
      runId: run.runId,
      toolName: null,
      lastActivityAt: observedAt,
      error: input.error,
    });

    naniteManagerLogger.warn(LOG_EVENTS.NANITE_RUN_COMPLETED, {
      ...this.logContext({ run }),
      status: run.status,
      source: "workflow_output_missing",
      error: input.error,
    });

    await this.recordRunFact({ run, actor: naniteTriggerActor(run.trigger) });
    await this.recordRunFailureAudit({ run, reasonCode: "workflow_output_missing" });
    return run;
  }

  async recordRuntimeActivity(
    input: RecordNaniteRuntimeActivityInput,
  ): Promise<NaniteRuntimeActivity> {
    if (input.runId) {
      const run = this.requireRun(input.runId);
      this.requireRunNaniteMatch(run, input.naniteId);

      if (isTerminalNaniteRunRecord(run)) {
        const activity = {
          state: "idle" as const,
          runId: run.runId,
          toolName: null,
          lastActivityAt: run.completedAt,
          error: null,
        };
        this.setActivity(run.naniteId, activity);
        return activity;
      }
    }

    const observedAt = nowIso();
    const activity: NaniteRuntimeActivity = {
      state: input.state,
      runId: input.runId,
      toolName: input.toolName ?? null,
      lastActivityAt: observedAt,
      error: input.error ?? null,
    };
    this.setActivity(input.naniteId, activity);

    const logProperties = {
      ...this.logContext({ naniteId: input.naniteId, runId: input.runId }),
      [OTEL_ATTRS.NANITE_ACTIVITY_STATE]: input.state,
      [OTEL_ATTRS.NANITE_TOOL_NAME]: input.toolName ?? undefined,
      error: input.error ?? undefined,
    };
    if (input.error) {
      naniteManagerLogger.warn(LOG_EVENTS.NANITE_RUNTIME_ACTIVITY_RECORDED, logProperties);
    } else {
      naniteManagerLogger.debug(LOG_EVENTS.NANITE_RUNTIME_ACTIVITY_RECORDED, logProperties);
    }
    return activity;
  }

  async cancelRuns(input: CancelNaniteRunsInput): Promise<CancelNaniteRunsOutput> {
    const candidateRunIds = input.runIds?.length
      ? input.runIds
      : this.state.runOrder.filter((runId) => {
          const run = this.requireRun(runId);
          return (
            run.status === "running" &&
            (!input.naniteId || run.naniteId === input.naniteId) &&
            (!input.olderThanIso || run.updatedAt < input.olderThanIso)
          );
        });
    const limit = clampLimit(input.limit, 25, MAX_RUNS_IN_STATE);
    const canceledRuns: Array<Extract<NaniteRunRecord, { status: "canceled" }>> = [];
    const skippedRuns: CancelNaniteRunsOutput["skippedRuns"] = [];

    for (const runId of candidateRunIds.slice(0, limit)) {
      const run = this.state.runs[runId];
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
      if (run.status === "waiting_for_manager" && !input.runIds?.includes(runId)) {
        skippedRuns.push({ runId, reason: "waiting_for_manager" });
        continue;
      }

      const canceledAt = nowIso();
      const canceled = this.setRun(runId, (previous) => {
        return {
          ...replaceRunRecordBase(previous, canceledAt),
          status: "canceled",
          summary: input.reason,
          cancellation: { type: "manager", reason: input.reason },
          completedAt: canceledAt,
        };
      });
      canceledRuns.push(canceled);

      if (this.state.runtimeActivityByNanite[run.naniteId]?.runId === runId) {
        this.setActivity(run.naniteId, {
          state: "idle",
          runId,
          toolName: null,
          lastActivityAt: canceledAt,
          error: input.reason,
        });
      }
    }

    const actor = input.actor ?? systemActor("maintenance");
    for (const run of canceledRuns) {
      await this.recordRunFact({ run, actor });
      await this.recordObservabilityFact("run.canceled.audit", async (db, identity) => {
        await recordAuditEvent(db, {
          eventName: "audit.run.canceled",
          githubAppId: identity.githubAppId,
          githubInstallationId: identity.githubInstallationId,
          naniteId: run.naniteId,
          runKey: run.runId,
          actor,
          targetType: "run",
          targetId: run.runId,
          outcome: "success",
          reasonCode: input.reason,
          requestId: input.requestId,
        });
      });
      const agent = await this.naniteAgent(run.naniteId);
      await agent.terminateRunWorkflowFromManager({ runId: run.runId, reason: input.reason });
    }

    return { canceledRuns, skippedRuns };
  }

  // -------------------------------------------------------------------------
  // GitHub webhooks + trigger tests
  // -------------------------------------------------------------------------

  async handleGitHubWebhook(input: HandleGitHubWebhookInput): Promise<NaniteWebhookEvaluation[]> {
    const eventType = getGitHubWebhookEventName(input.event);
    const evaluations: NaniteWebhookEvaluation[] = [];

    for (const nanite of Object.values(this.state.nanites)) {
      const naniteId = nanite.manifest.id;
      if (
        (input.onlyNaniteId && naniteId !== input.onlyNaniteId) ||
        !githubEventSourceMatches(nanite, input.event)
      ) {
        continue;
      }

      const evaluation: NaniteWebhookEvaluation = {
        naniteId,
        triggerError: null,
        dispatchIntentCount: 0,
        noopReasons: [],
        skippedReason: null,
        dispatches: [],
      };
      evaluations.push(evaluation);

      const triggerSource = nanite.manifest.triggerSource;
      const triggerResult = triggerSource
        ? await runGeneratedTrigger({
            loader: this.env.LOADER,
            sourceCode: triggerSource,
            cacheKey: `${this.name}:${naniteId}:${nanite.latestVersion.manifestHash}:${eventType}`,
            event: input.event,
          })
        : ({
            ok: false,
            error: "GitHub event source matched, but the Nanite has no triggerSource.",
          } as const);

      if (!triggerResult.ok) {
        evaluation.triggerError = triggerResult.error;
        naniteManagerLogger.error(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
          ...this.logContext({ naniteId }),
          [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: false,
          [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: 0,
          eventType,
          error: triggerResult.error,
        });
        evaluation.dispatches.push(
          await this.recordRejectedTriggerRun({
            naniteId,
            event: input.event,
            triggerError: triggerResult.error,
          }),
        );
        continue;
      }

      const dispatchIntents = getDispatchIntents(triggerResult.intents);
      evaluation.dispatchIntentCount = dispatchIntents.length;
      evaluation.noopReasons = getNoopIntents(triggerResult.intents).map((intent) => intent.reason);
      naniteManagerLogger.info(LOG_EVENTS.NANITE_TRIGGER_EVALUATED, {
        ...this.logContext({ naniteId }),
        [OTEL_ATTRS.NANITE_TRIGGER_ACCEPTED]: dispatchIntents.length > 0,
        [OTEL_ATTRS.NANITE_TRIGGER_INTENT_COUNT]: triggerResult.intents.length,
        eventType,
      });

      const dispatchIntent = dispatchIntents[0];
      if (!dispatchIntent) {
        continue;
      }

      if (this.hasActiveRun(naniteId)) {
        evaluation.skippedReason = "active_run_exists";
        continue;
      }

      const trigger: NaniteTriggerEvent = {
        type: "github",
        event: snapshotGitHubWebhookEvent(input.event),
        input: { ...dispatchIntent.input, ...input.dispatchInput },
      };
      const triggerKey = buildTriggerKey(naniteId, trigger);
      const created = this.findRunByTriggerKey(triggerKey) === null;
      let run = await this.startRun({ naniteId, trigger });
      if (created) {
        run = await this.dispatchRun({ runId: run.runId });
      }
      evaluation.dispatches.push({ run, created });
    }

    return evaluations;
  }

  @callable()
  async testNaniteTrigger(input: TestNaniteTriggerInput): Promise<TestNaniteTriggerOutput> {
    const githubInstallationId = this.installationId();
    if (!githubInstallationId) {
      throw new AppError("naniteManagerInstallationRequired");
    }
    this.requireNanite(input.naniteId);

    const parsedEvent = parseGitHubTriggerTestEvent(input.event, githubInstallationId);
    if (!parsedEvent.ok) {
      return {
        managerName: this.name,
        naniteId: input.naniteId,
        event: null,
        acceptance: {
          triggerAcceptedEvent: false,
          runCreated: false,
          modelDispatched: false,
          terminalOutcomeReached: false,
          triggerRejectionReason: parsedEvent.reason,
        },
        runs: [],
        agentFeedback: null,
        ok: false,
        error: `${APP_ERRORS.invalidNaniteTriggerTestEvent.message}: ${parsedEvent.reason}`,
      };
    }
    const { event } = parsedEvent;
    const eventSnapshot = snapshotGitHubWebhookEvent(event);

    const evaluations = await this.handleGitHubWebhook({
      event,
      onlyNaniteId: input.naniteId,
      dispatchInput: {
        sigveloTriggerTest: true,
        sigveloTestInstruction: input.testInstruction ?? NANITE_TRIGGER_TEST_INSTRUCTION,
        sigveloTestActor: input.actorId ?? "unknown",
      },
    });
    const evaluation = evaluations[0] ?? null;
    const triggerRejectionReason = summarizeTriggerRejection(evaluation);
    const createdRuns =
      evaluation?.dispatches
        .filter((dispatch) => dispatch.created)
        .map((dispatch) => dispatch.run) ?? [];

    const outcome = await this.resolveRunOutcomes({
      runs: createdRuns,
      waitForTerminalOutcome: input.waitForTerminalOutcome,
      timeoutMs: input.timeoutMs ?? NANITE_TRIGGER_TEST_TIMEOUT_MS,
    });
    const runs = outcome.runs;
    let agentFeedback: NaniteAgentFeedback | null = null;
    for (const run of runs) {
      if ("agentFeedback" in run && run.agentFeedback) {
        agentFeedback = run.agentFeedback;
        break;
      }
    }

    const output = {
      managerName: this.name,
      naniteId: input.naniteId,
      event: eventSnapshot,
      acceptance: {
        triggerAcceptedEvent: (evaluation?.dispatchIntentCount ?? 0) > 0,
        runCreated: createdRuns.length > 0,
        modelDispatched: createdRuns.some(
          (run) => run.status !== "fail" && run.status !== "canceled",
        ),
        terminalOutcomeReached: outcome.terminalOutcomeReached,
        triggerRejectionReason,
      },
      runs,
      agentFeedback,
    };
    if (createdRuns.length === 0) {
      return {
        ...output,
        ok: false,
        error:
          triggerRejectionReason ??
          "The trigger did not create a new Nanite run. Check the manifest trigger filter, generated trigger code, test event payload, or trigger idempotency key.",
      };
    }
    return outcome.ok
      ? { ...output, ok: true, error: null }
      : { ...output, ok: false, error: outcome.error };
  }

  // -------------------------------------------------------------------------
  // Debug + workspace
  // -------------------------------------------------------------------------

  async inspectNaniteDebug(input: InspectNaniteDebugInput = {}): Promise<InspectNaniteDebugOutput> {
    const include = new Set<NaniteDebugIncludeSection>(
      input.include ?? ["nanites", "runs", "runtimeActivity"],
    );
    const statuses = asSet(input.status);
    const activities = asSet(input.activity);
    const runs = selectDebugRuns(
      this.state,
      input,
      statuses,
      clampLimit(input.limit, 25, MAX_RUNS_IN_STATE),
    );
    const selectedNaniteId = input.naniteId ?? runs[0]?.naniteId ?? null;
    const selectedNanite = selectedNaniteId ? (this.state.nanites[selectedNaniteId] ?? null) : null;
    const workflows = include.has("workflows")
      ? await Promise.all(runs.map((run) => this.toRunWorkflowDebugRecord(run)))
      : undefined;

    const output: InspectNaniteDebugOutput = {
      managerName: this.name,
      ...buildDebugSnapshotSections({
        state: this.state,
        input,
        include,
        runs,
        workflows,
        selectedNanite,
        activities,
      }),
    };

    if (include.has("transcript") || include.has("submissions")) {
      const agent = selectedNaniteId ? await this.naniteAgent(selectedNaniteId) : null;
      output.think = agent
        ? await agent.inspectDebug({
            transcript: include.has("transcript") ? input.transcript : false,
            submissions: include.has("submissions") ? input.submissions : false,
          })
        : null;
    }

    return output;
  }

  async exploreNaniteWorkspace(
    input: ExploreNaniteWorkspaceInput,
  ): Promise<NaniteWorkspaceExploreOutput> {
    this.requireNanite(input.naniteId);
    const agent = await this.naniteAgent(input.naniteId);
    return agent.exploreWorkspace(input);
  }

  async resetNaniteDebug(input: ResetNaniteDebugInput): Promise<ResetNaniteDebugOutput> {
    this.requireNanite(input.naniteId);
    const agent = await this.naniteAgent(input.naniteId);
    return {
      managerName: this.name,
      naniteId: input.naniteId,
      reset: await agent.resetDebugState(),
    };
  }

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------

  async maintainNanites(): Promise<NaniteManagerMaintenanceOutput> {
    const checkedAtDate = new Date();
    const checkedAt = checkedAtDate.toISOString();
    const staleRunningCutoffIso = new Date(
      checkedAtDate.getTime() - STALE_RUNNING_AFTER_MS,
    ).toISOString();
    const terminalSubmissionCutoffIso = new Date(
      checkedAtDate.getTime() - TERMINAL_SUBMISSION_RETENTION_MS,
    ).toISOString();

    const { canceledRuns, skippedRuns } = await this.cancelRuns({
      olderThanIso: staleRunningCutoffIso,
      reason: `Nanite manager maintenance canceled a stale running run older than ${staleRunningCutoffIso}.`,
    });

    const submissionDeleteLimit = 100;
    const maintainedNaniteAgents: NaniteManagerMaintenanceOutput["maintainedNaniteAgents"] = [];
    const failedNaniteAgentMaintenance: NaniteManagerMaintenanceOutput["failedNaniteAgentMaintenance"] =
      [];
    const resyncedNaniteIds: string[] = [];
    const failedNaniteSyncs: NaniteManagerMaintenanceOutput["failedNaniteSyncs"] = [];

    for (const nanite of Object.values(this.state.nanites)) {
      const naniteId = nanite.manifest.id;
      const resolveAgent = async () => this.naniteAgent(naniteId);
      let agent: Awaited<ReturnType<typeof resolveAgent>>;
      try {
        agent = await resolveAgent();
      } catch (error) {
        failedNaniteAgentMaintenance.push({
          naniteId,
          error: `naniteAgent failed: ${describeError(error)}`,
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
        failedNaniteAgentMaintenance.push({ naniteId, error: describeError(error) });
      }

      if (!isSafeToResyncSchedule(nanite)) {
        continue;
      }

      try {
        await agent.syncScheduleFromManager({ managerName: this.name, nanite });
        resyncedNaniteIds.push(naniteId);
      } catch (error) {
        failedNaniteSyncs.push({ naniteId, error: describeError(error) });
      }
    }

    const output: NaniteManagerMaintenanceOutput = {
      checkedAt,
      staleRunningCutoffIso,
      terminalSubmissionCutoffIso,
      canceledRuns,
      skippedRuns,
      maintainedNaniteAgents,
      resyncedNaniteIds,
      failedNaniteAgentMaintenance,
      failedNaniteSyncs,
    };

    naniteManagerLogger.info(LOG_EVENTS.NANITE_MANAGER_MAINTENANCE_COMPLETED, {
      ...this.logContext({}),
      checkedAt,
      staleRunningCutoffIso,
      terminalSubmissionCutoffIso,
      canceledRunCount: canceledRuns.length,
      maintainedNaniteAgentCount: maintainedNaniteAgents.length,
      resyncedNaniteCount: resyncedNaniteIds.length,
      failedNaniteAgentMaintenanceCount: failedNaniteAgentMaintenance.length,
      failedNaniteSyncCount: failedNaniteSyncs.length,
    });

    return output;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private identity(): NaniteManagerIdentity | null {
    return parseNaniteManagerKey(this.name);
  }

  private installationId(): number | null {
    return this.identity()?.githubInstallationId ?? null;
  }

  private requireNanite(naniteId: string): ManagedNanite {
    const nanite = this.state.nanites[naniteId];
    if (!nanite) {
      throw new AppError("naniteNotFound", {
        details: { naniteId },
        message: `${APP_ERRORS.naniteNotFound.message}: ${naniteId}`,
      });
    }
    return nanite;
  }

  private requireRun(runId: string): NaniteRunRecord {
    const run = this.state.runs[runId];
    if (!run) {
      throw new AppError("naniteRunNotFound", {
        details: { runId },
        message: `${APP_ERRORS.naniteRunNotFound.message}: ${runId}`,
      });
    }
    return run;
  }

  private requireRunNaniteMatch(run: NaniteRunRecord, naniteId: string): void {
    if (run.naniteId === naniteId) {
      return;
    }

    throw new AppError("naniteRuntimeActivityMismatch", {
      details: {
        runId: run.runId,
        naniteId,
        actualNaniteId: run.naniteId,
      },
      message: `${APP_ERRORS.naniteRuntimeActivityMismatch.message}: run ${run.runId} belongs to ${run.naniteId}, not ${naniteId}`,
    });
  }

  private requireWaitingManagerRequest(input: {
    runId: string;
    requestId: string;
  }): Extract<NaniteRunRecord, { status: "waiting_for_manager" }> {
    const run = this.requireRun(input.runId);
    if (run.status !== "waiting_for_manager" || run.managerRequest.id !== input.requestId) {
      throw new AppError("naniteInvalidRunTransition", {
        details: {
          runId: input.runId,
          requestId: input.requestId,
          currentStatus: run.status,
          currentRequestId: run.status === "waiting_for_manager" ? run.managerRequest.id : null,
        },
        message: `${APP_ERRORS.naniteInvalidRunTransition.message}: manager_request(${input.requestId})`,
      });
    }
    return run;
  }

  private setRun<T extends NaniteRunRecord>(runId: string, update: (run: NaniteRunRecord) => T): T {
    const run = update(this.requireRun(runId));
    this.setState({
      ...this.state,
      runs: { ...this.state.runs, [runId]: run },
      updatedAt: run.updatedAt,
    });
    return run;
  }

  private setActivity(naniteId: string, activity: NaniteRuntimeActivity): void {
    this.setState({
      ...this.state,
      runtimeActivityByNanite: {
        ...this.state.runtimeActivityByNanite,
        [naniteId]: activity,
      },
      updatedAt: activity.lastActivityAt ?? this.state.updatedAt,
    });
  }

  /**
   * Dedup window is bounded by MAX_RUNS_IN_STATE: a trigger key evicted from
   * run history can dispatch again on redelivery.
   */
  private findRunByTriggerKey(triggerKey: string): NaniteRunRecord | null {
    for (const runId of this.state.runOrder) {
      const run = this.requireRun(runId);
      if (run.triggerKey === triggerKey) {
        return run;
      }
    }
    return null;
  }

  private hasActiveRun(naniteId: string): boolean {
    return this.state.runOrder.some((runId) => {
      const run = this.requireRun(runId);
      return run.naniteId === naniteId && !isTerminalNaniteRunStatus(run.status);
    });
  }

  private async recordRejectedTriggerRun(input: {
    naniteId: string;
    event: GitHubWebhookEventLike;
    triggerError: string;
  }): Promise<GitHubWebhookRunDispatch> {
    const trigger: NaniteTriggerEvent = {
      type: "github",
      event: snapshotGitHubWebhookEvent(input.event),
      input: { triggerError: input.triggerError },
    };
    const created = this.findRunByTriggerKey(buildTriggerKey(input.naniteId, trigger)) === null;
    const run = await this.startRun({ naniteId: input.naniteId, trigger });
    return {
      run: await this.recordRunFailureWithoutWorkflowOutput({
        runId: run.runId,
        error: `Trigger failed before model dispatch: ${input.triggerError}`,
      }),
      created,
    };
  }

  private async resolveRunOutcomes(input: {
    runs: NaniteRunRecord[];
    waitForTerminalOutcome: boolean | undefined;
    timeoutMs: number;
  }): Promise<
    {
      runs: NaniteRunRecord[];
      terminalOutcomeReached: boolean;
    } & ({ ok: true; error: null } | { ok: false; error: string })
  > {
    if (!input.waitForTerminalOutcome) {
      const ok =
        input.runs.length > 0 &&
        input.runs.every((run) => run.status !== "fail" && run.status !== "canceled");
      return ok
        ? { ok: true, error: null, runs: input.runs, terminalOutcomeReached: false }
        : {
            ok: false,
            error: "The Nanite run did not dispatch successfully.",
            runs: input.runs,
            terminalOutcomeReached: false,
          };
    }

    const runs = await this.waitForRunOutcomes({
      runIds: input.runs.map((run) => run.runId),
      timeoutMs: input.timeoutMs,
    });
    const terminalOutcomeReached =
      runs.length > 0 && runs.every((run) => isRunOutcomeReached(run.status));
    if (!terminalOutcomeReached) {
      return {
        ok: false,
        error: "Timed out waiting for the Nanite Run Workflow to reach an outcome.",
        runs,
        terminalOutcomeReached,
      };
    }

    const successful = runs.every((run) => run.status === "complete" || run.status === "no_change");
    return successful
      ? { ok: true, error: null, runs, terminalOutcomeReached }
      : {
          ok: false,
          error: "The Nanite reached an outcome, but it did not complete successfully.",
          runs,
          terminalOutcomeReached,
        };
  }

  private async waitForRunOutcomes(input: {
    runIds: readonly string[];
    timeoutMs: number;
  }): Promise<NaniteRunRecord[]> {
    const readRuns = () => input.runIds.map((runId) => this.requireRun(runId));

    const startedAt = Date.now();
    while (Date.now() - startedAt < input.timeoutMs) {
      const runs = readRuns();
      if (
        runs.length === input.runIds.length &&
        runs.every((run) => isRunOutcomeReached(run.status))
      ) {
        return runs;
      }

      await new Promise((resolve) => setTimeout(resolve, TERMINAL_RUN_POLL_INTERVAL_MS));
    }

    return readRuns();
  }

  private async assertRepositoriesBelongToInstallation(
    identity: NaniteManagerIdentity,
    manifest: NaniteManifest,
  ): Promise<void> {
    const requested = resolveNaniteManifestRepositoryFullNames(manifest);
    if (requested.length === 0) {
      return;
    }

    const accessible = new Set(
      (
        await listReposAccessibleToInstallation({
          env: this.env,
          githubAppId: identity.githubAppId,
          githubInstallationId: identity.githubInstallationId,
        })
      ).map((repository) => repository.full_name),
    );
    const inaccessible = requested.filter((repository) => !accessible.has(repository));
    if (inaccessible.length > 0) {
      throw new AppError("naniteRepositoryScopeForbidden", {
        details: {
          githubInstallationId: identity.githubInstallationId,
          repositories: inaccessible,
        },
        message: `${APP_ERRORS.naniteRepositoryScopeForbidden.message}: ${inaccessible.join(", ")}`,
      });
    }
  }

  private async recordObservabilityFact(
    operation: string,
    record: (
      db: ReturnType<typeof createDbClient>,
      identity: NaniteManagerIdentity,
    ) => Promise<void>,
  ): Promise<void> {
    const identity = this.identity();
    if (!identity) {
      return;
    }

    try {
      await record(createDbClient(this.env.DB), identity);
    } catch (error) {
      naniteManagerLogger.warn(LOG_EVENTS.OBSERVABILITY_FACT_RECORD_FAILED, {
        ...this.logContext({}),
        operation,
        error: describeError(error),
      });
    }
  }

  private async recordRunFailureAudit(input: {
    run: Extract<NaniteRunRecord, { status: "fail" }>;
    reasonCode: string;
  }): Promise<void> {
    await this.recordObservabilityFact("run.failed.audit", async (db, identity) => {
      await recordAuditEvent(db, {
        eventName: "audit.run.failed",
        githubAppId: identity.githubAppId,
        githubInstallationId: identity.githubInstallationId,
        naniteId: input.run.naniteId,
        runKey: input.run.runId,
        actor: naniteTriggerActor(input.run.trigger),
        targetType: "run",
        targetId: input.run.runId,
        outcome: "failure",
        reasonCode: input.reasonCode,
        metadata: {
          summary: input.run.summary,
          dispatchError:
            input.run.failure.type === "unreported" ? input.run.failure.dispatchError : null,
          triggerType: input.run.trigger.type,
        },
      });
    });
  }

  private async recordRunFact(input: {
    run: NaniteRunRecord;
    actor?: ObservabilityActor | null;
  }): Promise<void> {
    await this.recordObservabilityFact("nanite.run_fact", async (db, identity) => {
      let outputPullRequest: GitHubPullRequestImpact | null = null;
      const outputUrl = input.run.status === "complete" ? input.run.outputUrl : null;
      if (outputUrl) {
        try {
          outputPullRequest = await fetchGitHubPullRequestImpact({
            env: this.env,
            githubAppId: identity.githubAppId,
            installationId: identity.githubInstallationId,
            outputUrl,
          });
        } catch (error) {
          naniteManagerLogger.warn(LOG_EVENTS.OBSERVABILITY_FACT_RECORD_FAILED, {
            ...this.logContext({ run: input.run }),
            operation: "nanite.run_output_pull_request",
            error: describeError(error),
          });
        }
      }

      await recordNaniteRunFact(db, {
        githubAppId: identity.githubAppId,
        githubInstallationId: identity.githubInstallationId,
        run: input.run,
        nanite: this.state.nanites[input.run.naniteId],
        actor: input.actor ?? naniteTriggerActor(input.run.trigger),
        outputPullRequest,
      });
    });
  }

  private async toRunWorkflowDebugRecord(run: NaniteRunRecord): Promise<RunWorkflowDebugRecord> {
    const agent = await this.naniteAgent(run.naniteId);
    const { workflow } = await agent.inspectRunWorkflow({ runId: run.runId });
    return {
      runId: run.runId,
      workflow,
    };
  }

  private logContext(values: {
    naniteId?: string | null;
    run?: NaniteRunRecord | null;
    runId?: string | null;
  }) {
    const trigger = values.run?.trigger ?? null;
    return {
      [OTEL_ATTRS.AGENT_CLASS]: "SigveloNaniteManager",
      [OTEL_ATTRS.AGENT_NAME]: this.name,
      [OTEL_ATTRS.NANITE_MANAGER_NAME]: this.name,
      [OTEL_ATTRS.NANITE_ID]: values.naniteId ?? values.run?.naniteId ?? undefined,
      [OTEL_ATTRS.NANITE_RUN_ID]: values.runId ?? values.run?.runId ?? undefined,
      [OTEL_ATTRS.NANITE_RUN_KEY]: values.run?.triggerKey,
      [OTEL_ATTRS.NANITE_RUN_STATUS]: values.run?.status,
      [OTEL_ATTRS.NANITE_TRIGGER_TYPE]: trigger?.type,
      [OTEL_ATTRS.NANITE_TRIGGER_EVENT]: trigger
        ? trigger.type === "github"
          ? getGitHubWebhookEventName(trigger.event)
          : trigger.type
        : undefined,
    };
  }
}
