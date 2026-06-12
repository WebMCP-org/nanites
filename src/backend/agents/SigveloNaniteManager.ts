import { Agent, callable, getAgentByName } from "agents";
import type { EmitterWebhookEvent, EmitterWebhookEventName } from "@octokit/webhooks";
import { getLogger } from "@logtape/logtape";
import { APP_ERRORS, AppError, describeError, parseAppIsoDate } from "#/backend/errors.ts";
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
  type NaniteWorkspaceExploreInput,
  type NaniteWorkspaceExploreOutput,
} from "#/backend/agents/SigveloNaniteAgent.ts";
import {
  buildGitHubTriggerFixture,
  getDispatchIntents,
  getNoopIntents,
  runGeneratedTrigger,
  validateGeneratedTriggerSource,
  type GitHubPullRequestFixtureId,
  type GitHubPullRequestFixtureOverrides,
  type GitHubPushFixtureId,
  type GitHubPushFixtureOverrides,
  type TriggerDispatchInput,
} from "#/backend/nanites/triggers.ts";
import {
  NANITE_AGENT_NAME,
  buildNaniteManagerKey,
  parseNaniteManagerKey,
  type NaniteManagerIdentity,
} from "#/nanites.ts";
import {
  getGitHubWebhookBranch,
  getGitHubWebhookEventName,
  getGitHubWebhookAction,
  getGitHubWebhookHeadSha,
  getGitHubWebhookPullRequestNumber,
  getGitHubWebhookRepositoryFullName,
  snapshotGitHubWebhookEvent,
  type GitHubWebhookEventSnapshot,
} from "#/github.ts";
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
import { resolveNanitesAiGatewayId } from "#/backend/nanites/language-model.ts";

export const NANITE_TRIGGER_TEST_TIMEOUT_MS = 60_000;
export const NANITE_MANUAL_RUN_TIMEOUT_MS = 60_000;
export const NANITE_TRIGGER_TEST_INSTRUCTION = [
  "This is a trigger acceptance test.",
  "Do not modify GitHub.",
  "Inspect the trigger payload and runtime context.",
  "If the trigger and context look correct, call complete with a short summary and agentFeedback for the authoring agent.",
].join(" ");

const MAX_RUNS_IN_STATE = 100;
const NANITE_MANAGER_MAINTENANCE_CRON = "0 8 * * *";
const STALE_RUNNING_AFTER_MS = 24 * 60 * 60 * 1000;
const TERMINAL_SUBMISSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TERMINAL_RUN_POLL_INTERVAL_MS = 500;
const naniteManagerLogger = getLogger(LOGGING.NANITES_CATEGORY);

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export const naniteRunStatuses = [
  "running",
  "waiting_for_human",
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
export type CompletableNaniteRunStatus = Exclude<TerminalNaniteRunStatus, "canceled">;
export type UnreportedThinkSubmissionStatus = "completed" | "aborted" | "skipped" | "error";

const allowedRunStatusTransitions: Record<NaniteRunStatus, readonly NaniteRunStatus[]> = {
  running: ["waiting_for_human", "complete", "no_change", "fail", "canceled"],
  waiting_for_human: ["running", "complete", "no_change", "fail", "canceled"],
  complete: [],
  no_change: [],
  fail: [],
  canceled: [],
};
const terminalRunStatuses = new Set<NaniteRunStatus>(["complete", "no_change", "fail", "canceled"]);

export function isTerminalNaniteRunStatus(
  status: NaniteRunStatus,
): status is TerminalNaniteRunStatus {
  return terminalRunStatuses.has(status);
}

export const naniteRuntimeActivityStates = [
  "idle",
  "thinking",
  "tool_calling",
  "waiting_for_human",
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
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
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

export type NaniteRunModelSnapshot = {
  runtimePath: "workers_ai_gateway";
  effectiveModelId: string;
  effectiveGatewayId: string;
  manifestVersionId: string;
  resolvedAt: string;
};

export type NaniteRunRecord = {
  runId: string;
  naniteId: string;
  model: NaniteRunModelSnapshot;
  triggerKey: string;
  trigger: NaniteTriggerEvent;
  status: NaniteRunStatus;
  summary: string | null;
  outputUrl: string | null;
  agentFeedback: NaniteAgentFeedback | null;
  humanRequest: HumanRequest | null;
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

// ---------------------------------------------------------------------------
// Method inputs/outputs
// ---------------------------------------------------------------------------

export type RegisterNaniteInput = {
  manifest: NaniteManifest;
  enabled?: boolean;
  actor?: ObservabilityActor | null;
  requestId?: string;
};

export type StartNaniteRunInput = {
  naniteId: string;
  trigger: NaniteTriggerEvent;
  actor?: ObservabilityActor | null;
};

export type HandleGitHubWebhookInput = {
  event: EmitterWebhookEvent;
  dispatchInput?: TriggerDispatchInput;
  onlyNaniteId?: string;
};

export type GitHubWebhookRunDispatch = {
  run: NaniteRunRecord;
  created: boolean;
};

/** Per-nanite report of one webhook (or fixture) evaluation. */
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
  actor?: ObservabilityActor | null;
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
  agentFeedback: NaniteAgentFeedback | null;
  error: string | null;
};

export const naniteDebugIncludeSections = [
  "nanites",
  "runs",
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

export type InspectNaniteDebugOutput = {
  managerName: string;
  nanites?: ManagedNanite[];
  runs?: NaniteRunRecord[];
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
  canceledRuns: NaniteRunRecord[];
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
  canceledRuns: NaniteRunRecord[];
  skippedRuns: CancelNaniteRunsOutput["skippedRuns"];
  deletedOrphanedSubAgentNames: string[];
  maintainedNaniteAgents: Array<NaniteAgentMaintenanceOutput & { naniteId: string }>;
  resyncedNaniteIds: string[];
  failedNaniteAgentMaintenance: Array<{ naniteId: string; error: string }>;
  failedNaniteSyncs: Array<{ naniteId: string; error: string }>;
};

export type CompleteNaniteRunInput = {
  runId: string;
  status: CompletableNaniteRunStatus;
  summary: string;
  outputUrl?: string | null;
  agentFeedback?: NaniteAgentFeedback | null;
};

export type AskHumanInput = {
  runId: string;
  summary: string;
  requestedScopes?: string[];
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
  const managerRpc = manager as unknown as {
    handleGitHubWebhook: SigveloNaniteManager["handleGitHubWebhook"];
  };
  return managerRpc.handleGitHubWebhook({ event });
}

export function matchesNaniteSubAgentClassName(className: string): boolean {
  return className === SigveloNaniteAgent.name || className === NANITE_AGENT_NAME;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
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

function collectManifestRepositories(manifest: NaniteManifest): string[] {
  const repositories = new Set(manifest.permissions.github?.repositories ?? []);
  if (manifest.eventSource.type === "github") {
    for (const repository of manifest.eventSource.repositories ?? []) {
      repositories.add(repository);
    }
  }

  return [...repositories].sort();
}

function isScheduledEventSource(
  eventSource: NaniteEventSourceSpec,
): eventSource is NaniteScheduledEventSourceSpec {
  return eventSource.type === "schedule" || eventSource.type === "scheduleEvery";
}

/**
 * One-shot date/delay schedules must not be re-armed by maintenance — a
 * re-armed past date fires immediately. Everything else (cron strings,
 * intervals, disabled or non-schedule nanites needing stray rows cleared)
 * is safe to resync.
 */
function isSafeToResyncSchedule(nanite: ManagedNanite): boolean {
  const eventSource = nanite.manifest.eventSource;
  if (!isScheduledEventSource(eventSource) || !nanite.enabled) {
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

function getTriggerEventName(trigger: NaniteTriggerEvent): string {
  return trigger.type === "github" ? getGitHubWebhookEventName(trigger.event) : trigger.type;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(value ?? fallback, 1), max);
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

function asSet<T extends string>(value: T | T[] | undefined): Set<T> | null {
  return value ? new Set(Array.isArray(value) ? value : [value]) : null;
}

function summarizeTriggerRejection(evaluation: NaniteWebhookEvaluation | null): string | null {
  if (!evaluation) {
    return "The Nanite event source filter did not match the fixture event. Check the manifest events, repositories, actions, branches, and enabled state.";
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

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SigveloNaniteManager extends Agent<Env, NaniteManagerState> {
  initialState: NaniteManagerState = createInitialNaniteManagerState();

  override async onStart(): Promise<void> {
    await this.schedule(NANITE_MANAGER_MAINTENANCE_CRON, "maintainNanites", undefined, {
      idempotent: true,
    });
  }

  override async onBeforeSubAgent(
    _request: Request,
    child: { className: string; name: string },
  ): Promise<Response | void> {
    if (!matchesNaniteSubAgentClassName(child.className)) {
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

  async getSnapshot(): Promise<NaniteManagerState> {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------------

  async registerNanite(input: RegisterNaniteInput): Promise<ManagedNanite> {
    const manifest = normalizeNaniteManifest(input.manifest);

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
      enabled: input.enabled ?? true,
      createdAt: existing?.createdAt ?? registeredAt,
      updatedAt: registeredAt,
    };

    this.setState({
      ...this.state,
      nanites: { ...this.state.nanites, [manifest.id]: nanite },
      updatedAt: registeredAt,
    });

    if (
      isScheduledEventSource(nanite.manifest.eventSource) ||
      (existing && isScheduledEventSource(existing.manifest.eventSource))
    ) {
      const agent = await this.subAgent(SigveloNaniteAgent, manifest.id);
      await agent.syncScheduleFromManager({ managerName: this.name, nanite });
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
            enabled: nanite.enabled,
            eventSourceType: manifest.eventSource.type,
            latestVersionId: nanite.latestVersion.versionId,
          },
        });
      },
    );

    return nanite;
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

    const agent = await this.subAgent(SigveloNaniteAgent, input.naniteId);
    await agent.resetDebugState();
    await this.deleteSubAgent(SigveloNaniteAgent, input.naniteId);

    const nextNanites = { ...current.nanites };
    const nextActivity = { ...current.runtimeActivityByNanite };
    delete nextNanites[input.naniteId];
    delete nextActivity[input.naniteId];

    const removedRunIds: string[] = [];
    const nextRuns = { ...current.runs };
    const nextRunOrder = current.runOrder.filter((runId) => {
      if (current.runs[runId]?.naniteId === input.naniteId) {
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
    if (!nanite.enabled) {
      throw new AppError("naniteDisabled", {
        details: { naniteId: input.naniteId },
        message: `${APP_ERRORS.naniteDisabled.message}: ${input.naniteId}`,
      });
    }

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
        effectiveGatewayId: resolveNanitesAiGatewayId(this.env),
        manifestVersionId: nanite.latestVersion.versionId,
        resolvedAt: startedAt,
      },
      triggerKey,
      trigger: input.trigger,
      status: "running",
      summary: null,
      outputUrl: null,
      agentFeedback: null,
      humanRequest: null,
      startedAt,
      dispatchError: null,
      updatedAt: startedAt,
      completedAt: null,
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
    if (isTerminalNaniteRunStatus(run.status)) {
      return run;
    }

    const nanite = this.requireNanite(run.naniteId);
    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_DISPATCH_STARTED, {
      ...this.logContext({ run }),
    });

    try {
      const agent = await this.subAgent(SigveloNaniteAgent, run.naniteId);
      await agent.enqueueFromManager({ managerName: this.name, nanite, run });
    } catch (error) {
      naniteManagerLogger.error(LOG_EVENTS.NANITE_RUN_DISPATCH_FAILED, {
        ...this.logContext({ run }),
        error: describeError(error),
      });
      return this.recordUnreportedRunCompletion({
        runId: input.runId,
        status: "error",
        error: `Dispatch to the Nanite agent failed: ${describeError(error)}`,
      });
    }

    naniteManagerLogger.info(LOG_EVENTS.NANITE_RUN_DISPATCH_SUCCEEDED, {
      ...this.logContext({ run }),
    });
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
    const outcome = await this.resolveRunOutcomes({
      runs: [dispatched],
      waitForTerminalOutcome: input.waitForTerminalOutcome,
      timeoutMs: input.timeoutMs ?? NANITE_MANUAL_RUN_TIMEOUT_MS,
    });

    return {
      ok: outcome.ok,
      managerName: this.name,
      naniteId: input.naniteId,
      runs: outcome.runs,
      error: outcome.error,
    };
  }

  async completeRun(input: CompleteNaniteRunInput): Promise<NaniteRunRecord> {
    const current = this.requireRun(input.runId);
    if (isTerminalNaniteRunStatus(current.status)) {
      assertNaniteRunStatusTransition(current.status, input.status);
      return current;
    }

    assertNaniteRunStatusTransition(current.status, input.status);
    const completedAt = nowIso();
    const run = this.setRun(input.runId, (previous) => ({
      ...previous,
      status: input.status,
      summary: input.summary,
      outputUrl: input.outputUrl ?? previous.outputUrl,
      agentFeedback: input.agentFeedback ?? previous.agentFeedback,
      updatedAt: completedAt,
      completedAt,
    }));
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
      source: "lifecycle_tool",
      hasOutputUrl: run.outputUrl !== null,
      hasAgentFeedback: run.agentFeedback !== null,
    });

    await this.recordRunFact({ run, actor: naniteTriggerActor(run.trigger) });
    if (run.status === "fail") {
      await this.recordRunFailureAudit({ run, reasonCode: "lifecycle_fail_tool" });
    }
    return run;
  }

  async askHuman(input: AskHumanInput): Promise<NaniteRunRecord> {
    const current = this.requireRun(input.runId);
    if (current.status === "waiting_for_human" && current.humanRequest?.resolvedAt === null) {
      return current;
    }

    assertNaniteRunStatusTransition(current.status, "waiting_for_human");
    const createdAt = nowIso();
    const run = this.setRun(input.runId, (previous) => ({
      ...previous,
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
    }));
    this.setActivity(run.naniteId, {
      state: "waiting_for_human",
      runId: run.runId,
      toolName: null,
      lastActivityAt: createdAt,
      error: null,
    });

    await this.recordRunFact({ run, actor: naniteTriggerActor(run.trigger) });
    return run;
  }

  /**
   * Terminalize a run whose Think submission ended without a lifecycle tool
   * call (the model stopped, errored, or was aborted before reporting).
   */
  async recordUnreportedRunCompletion(
    input: RecordUnreportedRunCompletionInput,
  ): Promise<NaniteRunRecord> {
    const current = this.requireRun(input.runId);
    if (isTerminalNaniteRunStatus(current.status) || current.status === "waiting_for_human") {
      return current;
    }

    const observedAt = nowIso();
    const status: TerminalNaniteRunStatus = input.status === "aborted" ? "canceled" : "fail";
    const run = this.setRun(input.runId, (previous) => ({
      ...previous,
      status,
      summary:
        input.error ??
        `The Think submission ended with status ${input.status} before the Nanite reported a lifecycle outcome.`,
      dispatchError: input.error ?? null,
      updatedAt: observedAt,
      completedAt: observedAt,
    }));
    this.setActivity(run.naniteId, {
      state: input.status === "error" ? "error" : "idle",
      runId: run.runId,
      toolName: null,
      lastActivityAt: observedAt,
      error: input.error ?? null,
    });

    naniteManagerLogger.warn(LOG_EVENTS.NANITE_RUN_COMPLETED, {
      ...this.logContext({ run }),
      status: run.status,
      source: "unreported_submission",
      error: input.error ?? undefined,
    });

    await this.recordRunFact({ run, actor: naniteTriggerActor(run.trigger) });
    if (run.status === "fail") {
      await this.recordRunFailureAudit({ run, reasonCode: `unreported_${input.status}` });
    }
    return run;
  }

  async recordRuntimeActivity(
    input: RecordNaniteRuntimeActivityInput,
  ): Promise<NaniteRuntimeActivity> {
    if (input.runId) {
      const run = this.requireRun(input.runId);
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
    const explicitRunIds = new Set(input.runIds ?? []);
    const candidateRunIds = input.runIds?.length
      ? input.runIds
      : this.state.runOrder.filter((runId) => {
          const run = this.state.runs[runId];
          return (
            run?.status === "running" &&
            (!input.naniteId || run.naniteId === input.naniteId) &&
            (!input.olderThanIso || run.updatedAt < input.olderThanIso)
          );
        });
    const limit = clampLimit(input.limit, 25, MAX_RUNS_IN_STATE);
    const canceledRuns: NaniteRunRecord[] = [];
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
      if (run.status === "waiting_for_human" && !explicitRunIds.has(runId)) {
        skippedRuns.push({ runId, reason: "waiting_for_human" });
        continue;
      }

      const agent = await this.subAgent(SigveloNaniteAgent, run.naniteId);
      await agent.cancelRunFromManager({ runId, reason: input.reason });

      const canceledAt = nowIso();
      const canceled = this.setRun(runId, (previous) => ({
        ...previous,
        status: "canceled",
        summary: input.reason,
        updatedAt: canceledAt,
        completedAt: canceledAt,
      }));
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
        !nanite.enabled ||
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

    const event = buildGitHubTriggerFixture({
      fixture: input.event.fixture,
      deliveryId: `sigvelo-trigger-test-${input.requestId ?? crypto.randomUUID()}`,
      installationId: githubInstallationId,
      overrides: input.event.overrides,
    });
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
    const dispatchedRuns = createdRuns.filter((run) => run.dispatchError === null);

    const outcome = await this.resolveRunOutcomes({
      runs: createdRuns,
      waitForTerminalOutcome: input.waitForTerminalOutcome,
      timeoutMs: input.timeoutMs ?? NANITE_TRIGGER_TEST_TIMEOUT_MS,
    });
    const runs = outcome.runs;

    return {
      ok: createdRuns.length > 0 && outcome.ok,
      managerName: this.name,
      naniteId: input.naniteId,
      fixture: input.event.fixture,
      event: eventSnapshot,
      acceptance: {
        fixtureBuilt: true,
        triggerAcceptedEvent: (evaluation?.dispatchIntentCount ?? 0) > 0,
        runCreated: createdRuns.length > 0,
        modelDispatched: dispatchedRuns.length > 0,
        terminalOutcomeReached: outcome.terminalOutcomeReached,
        triggerRejectionReason,
      },
      runs,
      agentFeedback: runs.find((run) => run.agentFeedback)?.agentFeedback ?? null,
      error:
        createdRuns.length === 0
          ? (triggerRejectionReason ??
            "The trigger did not create a new Nanite run. Check the manifest trigger filter, generated trigger code, fixture payload, or trigger idempotency key.")
          : outcome.error,
    };
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
    const limit = clampLimit(input.limit, 25, MAX_RUNS_IN_STATE);
    const runs = this.state.runOrder
      .flatMap((runId) => {
        const run = this.state.runs[runId];
        return run ? [run] : [];
      })
      .filter((run) => !input.naniteId || run.naniteId === input.naniteId)
      .filter((run) => !input.runId || run.runId === input.runId)
      .filter((run) => !statuses || statuses.has(run.status))
      .slice(0, limit);
    const selectedNaniteId = input.naniteId ?? runs[0]?.naniteId ?? null;
    const selectedNanite = selectedNaniteId ? (this.state.nanites[selectedNaniteId] ?? null) : null;

    const output: InspectNaniteDebugOutput = {
      managerName: this.name,
      ...(include.has("nanites")
        ? {
            nanites: Object.values(this.state.nanites).filter(
              (nanite) => !input.naniteId || nanite.manifest.id === input.naniteId,
            ),
          }
        : {}),
      ...(include.has("runs") ? { runs } : {}),
      ...(include.has("runtimeActivity")
        ? {
            runtimeActivity: Object.fromEntries(
              Object.entries(this.state.runtimeActivityByNanite)
                .filter(([naniteId]) => !input.naniteId || input.naniteId === naniteId)
                .filter(([, activity]) => !input.runId || activity.runId === input.runId)
                .filter(([, activity]) => !activities || activities.has(activity.state)),
            ),
          }
        : {}),
      ...(include.has("manifest") ? { manifest: selectedNanite?.manifest ?? null } : {}),
      ...(include.has("triggerSource")
        ? { triggerSource: selectedNanite?.manifest.triggerSource ?? null }
        : {}),
    };

    if (include.has("transcript") || include.has("submissions")) {
      const agent = selectedNaniteId
        ? await this.subAgent(SigveloNaniteAgent, selectedNaniteId)
        : null;
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
    const agent = await this.subAgent(SigveloNaniteAgent, input.naniteId);
    return agent.exploreWorkspace(input);
  }

  async resetNaniteDebug(input: ResetNaniteDebugInput): Promise<ResetNaniteDebugOutput> {
    this.requireNanite(input.naniteId);
    const agent = await this.subAgent(SigveloNaniteAgent, input.naniteId);
    return {
      managerName: this.name,
      naniteId: input.naniteId,
      reset: await agent.resetDebugState(),
    };
  }

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------

  async maintainNanites(
    input: NaniteManagerMaintenanceInput | null = {},
  ): Promise<NaniteManagerMaintenanceOutput> {
    const options = input ?? {};
    const checkedAtDate = options.nowIso ? parseAppIsoDate(options.nowIso, "nowIso") : new Date();
    const checkedAt = checkedAtDate.toISOString();
    const staleRunningCutoffIso = new Date(
      checkedAtDate.getTime() -
        requireNonNegativeMs(
          options.staleRunningAfterMs,
          STALE_RUNNING_AFTER_MS,
          "staleRunningAfterMs",
        ),
    ).toISOString();
    const terminalSubmissionCutoffIso = new Date(
      checkedAtDate.getTime() -
        requireNonNegativeMs(
          options.terminalSubmissionRetentionMs,
          TERMINAL_SUBMISSION_RETENTION_MS,
          "terminalSubmissionRetentionMs",
        ),
    ).toISOString();

    const deletedOrphanedSubAgentNames: string[] = [];
    for (const child of this.listSubAgents(SigveloNaniteAgent)) {
      if (!this.state.nanites[child.name]) {
        await this.deleteSubAgent(SigveloNaniteAgent, child.name);
        deletedOrphanedSubAgentNames.push(child.name);
      }
    }

    const { canceledRuns, skippedRuns } = await this.cancelRuns({
      olderThanIso: staleRunningCutoffIso,
      limit: options.runCancelLimit,
      reason: `Nanite manager maintenance canceled a stale running run older than ${staleRunningCutoffIso}.`,
    });

    const submissionDeleteLimit = clampLimit(options.submissionDeleteLimitPerNanite, 100, 500);
    const maintainedNaniteAgents: NaniteManagerMaintenanceOutput["maintainedNaniteAgents"] = [];
    const failedNaniteAgentMaintenance: NaniteManagerMaintenanceOutput["failedNaniteAgentMaintenance"] =
      [];
    const resyncedNaniteIds: string[] = [];
    const failedNaniteSyncs: NaniteManagerMaintenanceOutput["failedNaniteSyncs"] = [];

    for (const nanite of Object.values(this.state.nanites)) {
      const naniteId = nanite.manifest.id;
      const resolveAgent = async () => this.subAgent(SigveloNaniteAgent, naniteId);
      let agent: Awaited<ReturnType<typeof resolveAgent>>;
      try {
        agent = await resolveAgent();
      } catch (error) {
        failedNaniteAgentMaintenance.push({
          naniteId,
          error: `subAgent failed: ${describeError(error)}`,
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
      deletedOrphanedSubAgentNames,
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
      deletedOrphanedSubAgentCount: deletedOrphanedSubAgentNames.length,
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

  private setRun(
    runId: string,
    update: (run: NaniteRunRecord) => NaniteRunRecord,
  ): NaniteRunRecord {
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
      const run = this.state.runs[runId];
      if (run?.triggerKey === triggerKey) {
        return run;
      }
    }
    return null;
  }

  private hasActiveRun(naniteId: string): boolean {
    return this.state.runOrder.some((runId) => {
      const run = this.state.runs[runId];
      return run?.naniteId === naniteId && !isTerminalNaniteRunStatus(run.status);
    });
  }

  private async recordRejectedTriggerRun(input: {
    naniteId: string;
    event: EmitterWebhookEvent;
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
      run: await this.recordUnreportedRunCompletion({
        runId: run.runId,
        status: "error",
        error: `Trigger failed before model dispatch: ${input.triggerError}`,
      }),
      created,
    };
  }

  private async resolveRunOutcomes(input: {
    runs: NaniteRunRecord[];
    waitForTerminalOutcome: boolean | undefined;
    timeoutMs: number;
  }): Promise<{
    ok: boolean;
    error: string | null;
    runs: NaniteRunRecord[];
    terminalOutcomeReached: boolean;
  }> {
    if (!input.waitForTerminalOutcome) {
      const ok = input.runs.length > 0 && input.runs.every((run) => run.dispatchError === null);
      return { ok, error: null, runs: input.runs, terminalOutcomeReached: false };
    }

    const runs = await this.waitForTerminalRuns({
      runIds: input.runs.map((run) => run.runId),
      timeoutMs: input.timeoutMs,
    });
    const terminalOutcomeReached =
      runs.length > 0 && runs.every((run) => isTerminalNaniteRunStatus(run.status));
    if (!terminalOutcomeReached) {
      return {
        ok: false,
        error: "Timed out waiting for the Nanite to reach a terminal lifecycle outcome.",
        runs,
        terminalOutcomeReached,
      };
    }

    const successful = runs.every(
      (run) =>
        (run.status === "complete" || run.status === "no_change") && run.dispatchError === null,
    );
    return {
      ok: successful,
      error: successful
        ? null
        : "The Nanite reached a terminal outcome, but it did not complete successfully.",
      runs,
      terminalOutcomeReached,
    };
  }

  private async waitForTerminalRuns(input: {
    runIds: readonly string[];
    timeoutMs: number;
  }): Promise<NaniteRunRecord[]> {
    const readRuns = () =>
      input.runIds.flatMap((runId) => {
        const run = this.state.runs[runId];
        return run ? [run] : [];
      });

    const startedAt = Date.now();
    while (Date.now() - startedAt < input.timeoutMs) {
      const runs = readRuns();
      if (
        runs.length === input.runIds.length &&
        runs.every((run) => isTerminalNaniteRunStatus(run.status))
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
    const requested = collectManifestRepositories(manifest);
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
    run: NaniteRunRecord;
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
          dispatchError: input.run.dispatchError,
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
      if (input.run.outputUrl) {
        try {
          outputPullRequest = await fetchGitHubPullRequestImpact({
            env: this.env,
            githubAppId: identity.githubAppId,
            installationId: identity.githubInstallationId,
            outputUrl: input.run.outputUrl,
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
      [OTEL_ATTRS.NANITE_TRIGGER_EVENT]: trigger ? getTriggerEventName(trigger) : undefined,
    };
  }
}
