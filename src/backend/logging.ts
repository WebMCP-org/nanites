import {
  configureSync,
  getLogger,
  getConsoleSink,
  type ConsoleFormatter,
  type LogRecord,
} from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";
import { subscribe, type ChannelEventMap, type ObservabilityEvent } from "agents/observability";

/**
 * Logger categories and runtime values for the agent app and its DB package so
 * the log stream stays queryable by stable dimensions.
 */
export const LOGGING = {
  ROOT_CATEGORY: "agent",
  APP_CATEGORY: ["agent", "app"],
  SERVER_CATEGORY: ["agent", "server"],
  NANITES_CATEGORY: ["agent", "nanites"],
  DB_CATEGORY: ["agent", "db"],
  LOGTAPE_META_CATEGORY: ["logtape", "meta"],
  AGENTS_SDK_CHILD_CATEGORY: "agents_sdk",
  REQUEST_CHILD_CATEGORY: "request",
  BROWSER_RUNTIME: "browser",
  WORKER_RUNTIME: "worker",
} as const;

/**
 * Dotted event names stay stable as the app grows from JSON logs today to more
 * complete tracing and dashboards later.
 */
export const LOG_EVENTS = {
  AGENT_EVENT_ERROR: "agent.event.error",
  AGENT_EVENT_OBSERVED: "agent.event.observed",
  AGENT_SCHEDULE_EXECUTED: "agent.schedule.executed",
  AGENTS_SDK_OBSERVABILITY_EVENT: "agents_sdk.observability.event",
  AGENT_WEBSOCKET_ERROR: "agent.websocket.error",
  AUTH_FUNNEL_EVENT_RECORD_FAILED: "auth.funnel_event.record_failed",
  API_REQUEST_FAILED: "api.request.failed",
  API_REQUEST_COMPLETED: "api.request.completed",
  API_REQUEST_NOT_FOUND: "api.request.not_found",
  API_UNHANDLED_ERROR: "api.request.unhandled",
  GITHUB_API_REQUEST_FAILED: "github.api.request.failed",
  GITHUB_API_REQUEST_SUCCEEDED: "github.api.request.succeeded",
  GITHUB_MANAGER_CONVERSATION_FAILED: "github.manager_conversation.failed",
  GITHUB_MANAGER_CONVERSATION_PUBLISH_FAILED: "github.manager_conversation.publish_failed",
  GITHUB_MANAGER_CONVERSATION_REPLY_TIMEOUT: "github.manager_conversation.reply_timeout",
  GITHUB_MANAGER_CONVERSATION_STATUS_MESSAGE_NOT_FOUND:
    "github.manager_conversation.status_message_not_found",
  GITHUB_MANAGER_CONVERSATION_SUBSCRIBE_FAILED: "github.manager_conversation.subscribe_failed",
  GITHUB_WEBHOOK_RECEIVED: "github.webhook.received",
  MCP_SERVER_ADD_FAILED: "mcp.server.add.failed",
  MCP_SERVER_REMOVE_FAILED: "mcp.server.remove.failed",
  OAUTH_ERROR_RESPONSE: "oauth.error_response",
  NANITE_AGENT_RUN_ACCEPTED: "nanite.agent.run.accepted",
  NANITE_AGENT_RUN_SUBMITTED: "nanite.agent.run.submitted",
  NANITE_CHAT_ERROR: "nanite.chat.error",
  NANITE_CHAT_RESPONSE: "nanite.chat.response",
  NANITE_DEPROVISIONED: "nanite.deprovisioned",
  NANITE_MANAGER_MAINTENANCE_COMPLETED: "nanite.manager.maintenance.completed",
  NANITE_RUN_COMPLETED: "nanite.run.completed",
  NANITE_RUN_CREATED: "nanite.run.created",
  NANITE_RUN_DEDUPED: "nanite.run.deduped",
  NANITE_RUN_DISPATCH_FAILED: "nanite.run.dispatch.failed",
  NANITE_RUN_DISPATCH_STARTED: "nanite.run.dispatch.started",
  NANITE_RUN_DISPATCH_SUCCEEDED: "nanite.run.dispatch.succeeded",
  NANITE_RUNTIME_ACTIVITY_RECORDED: "nanite.runtime_activity.recorded",
  NANITE_SUBMISSION_STATUS: "nanite.submission.status",
  NANITE_TOOL_CALL_FINISHED: "nanite.tool_call.finished",
  NANITE_TOOL_OUTPUT_TRUNCATED: "nanite.tool_output.truncated",
  NANITE_TRIGGER_EVALUATED: "nanite.trigger.evaluated",
  NANITE_TURN_STARTED: "nanite.turn.started",
  NANITE_STEP_FINISHED: "nanite.step.finished",
  NANITE_WORKSPACE_HYDRATION_COMPLETED: "nanite.workspace.hydration.completed",
  NANITE_WORKSPACE_HYDRATION_FAILED: "nanite.workspace.hydration.failed",
  NANITE_WORKSPACE_HYDRATION_REF_FALLBACK: "nanite.workspace.hydration.ref_fallback",
  NANITE_WORKSPACE_HYDRATION_REF_RETRY: "nanite.workspace.hydration.ref_retry",
  NANITE_WORKSPACE_HYDRATION_HEARTBEAT: "nanite.workspace.hydration.heartbeat",
  NANITE_WORKSPACE_HYDRATION_STARTED: "nanite.workspace.hydration.started",
  SIGVELO_TOOL_CALL_FAILED: "sigvelo.tool_call.failed",
  SIGVELO_TOOL_CALL_FINISHED: "sigvelo.tool_call.finished",
  SIGVELO_TOOL_CALL_STARTED: "sigvelo.tool_call.started",
} as const satisfies Record<string, string>;

/**
 * OpenTelemetry-style attribute keys for structured logs.
 *
 * Use standard OTEL semantic keys where they fit. Use `sigvelo.*` when the
 * domain concept is application-specific and has no good standard attribute.
 */
export const OTEL_ATTRS = {
  HTTP_REQUEST_METHOD: "http.request.method",
  HTTP_RESPONSE_STATUS_CODE: "http.response.status_code",
  HTTP_RESPONSE_STATUS_CLASS: "http.response.status_class",
  HTTP_ROUTE: "http.route",
  URL_FULL: "url.full",
  URL_PATH: "url.path",
  ERROR_TYPE: "error.type",
  EXCEPTION_MESSAGE: "exception.message",
  RPC_SYSTEM: "rpc.system",
  RPC_METHOD: "rpc.method",
  OAUTH_ERROR_CODE: "oauth.error.code",
  OAUTH_ERROR_DESCRIPTION: "oauth.error.description",
  OAUTH_INTERNAL_REASON: "oauth.internal.reason",
  GITHUB_INSTALLATION_ID: "github.installation.id",
  GITHUB_OPERATION: "github.operation",
  GITHUB_REPOSITORY_FULL_NAME: "github.repository.full_name",
  GITHUB_WEBHOOK_DELIVERY_ID: "github.webhook.delivery_id",
  GITHUB_WEBHOOK_EVENT_NAME: "github.webhook.event_name",
  GITHUB_WEBHOOK_EVENT_ACTION: "github.webhook.event_action",
  GITHUB_THREAD_ID: "github.thread.id",
  GITHUB_MESSAGE_ID: "github.message.id",
  GIT_BRANCH_NAME: "git.branch.name",
  REQUEST_ID: "sigvelo.request.id",
  REQUEST_DURATION_MS: "sigvelo.request.duration_ms",
  ROUTE_TARGET: "sigvelo.route.target",
  AUTH_FUNNEL_EVENT_TYPE: "sigvelo.auth.funnel.event_type",
  CONVERSATION_NAME: "sigvelo.conversation.name",
  STATUS_MESSAGE_ID: "sigvelo.status_message.id",
  SUBMISSION_ID: "sigvelo.submission.id",
  USER_MESSAGE_ID: "sigvelo.user_message.id",
  AGENT_CLASS: "sigvelo.agent.class",
  AGENT_NAME: "sigvelo.agent.name",
  AGENT_EVENT_TYPE: "sigvelo.agent.event.type",
  AGENT_EVENT_TIMESTAMP: "sigvelo.agent.event.timestamp",
  AGENTS_SDK_CHANNEL: "agents.sdk.channel",
  AGENTS_SDK_EVENT_TYPE: "agents.sdk.event.type",
  MCP_SERVER_ID: "sigvelo.mcp.server.id",
  MCP_SERVER_NAME: "sigvelo.mcp.server.name",
  NANITE_PHASE: "sigvelo.nanite.phase",
  NANITE_ACTIVITY_STATE: "sigvelo.nanite.activity.state",
  NANITE_ID: "sigvelo.nanite.id",
  NANITE_MANAGER_NAME: "sigvelo.nanite.manager.name",
  NANITE_RUN_ID: "sigvelo.nanite.run.id",
  NANITE_RUN_KEY: "sigvelo.nanite.run.key",
  NANITE_RUN_STATUS: "sigvelo.nanite.run.status",
  NANITE_SUBMISSION_ID: "sigvelo.nanite.submission.id",
  NANITE_TOOL_NAME: "sigvelo.nanite.tool.name",
  NANITE_TOOL_OUTPUT_ARTIFACT_ID: "sigvelo.nanite.tool_output.artifact_id",
  NANITE_TOOL_OUTPUT_ORIGINAL_CHARS: "sigvelo.nanite.tool_output.original_chars",
  NANITE_TOOL_OUTPUT_RETURNED_CHARS: "sigvelo.nanite.tool_output.returned_chars",
  NANITE_TRIGGER_ACCEPTED: "sigvelo.nanite.trigger.accepted",
  NANITE_TRIGGER_EVENT: "sigvelo.nanite.trigger.event",
  NANITE_TRIGGER_INTENT_COUNT: "sigvelo.nanite.trigger.intent_count",
  NANITE_TRIGGER_TYPE: "sigvelo.nanite.trigger.type",
  NANITE_WORKSPACE_HYDRATION_ELAPSED_MS: "sigvelo.nanite.workspace.hydration.elapsed_ms",
  NANITE_WORKSPACE_HYDRATION_HEARTBEAT_COUNT: "sigvelo.nanite.workspace.hydration.heartbeat_count",
  PROCESS_RUNTIME_NAME: "process.runtime.name",
  SIGVELO_TOOL_SURFACE: "sigvelo.tool.surface",
} as const satisfies Record<string, string>;

let configured = false;
let agentsSdkObservabilityBridgeConfigured = false;
const agentsSdkObservabilityUnsubscribers: Array<() => void> = [];
const REDACTED_LOG_VALUE = "[REDACTED]";
const SENSITIVE_LOG_FIELD_PATTERNS = [
  /pass(?:code|phrase|word)/i,
  /api[-_]?key/i,
  /secret/i,
  /token/i,
  /cookie/i,
  /credential/i,
  /authorization/i,
  /bearer/i,
  /csrf/i,
  /jwt/i,
  /signature/i,
  /private/i,
  /dsn/i,
];
const AGENTS_SDK_OBSERVABILITY_CHANNELS = [
  "state",
  "rpc",
  "message",
  "chat",
  "transcript",
  "fiber",
  "agentTool",
  "schedule",
  "lifecycle",
  "workflow",
  "mcp",
  "email",
] as const satisfies ReadonlyArray<keyof ChannelEventMap>;
const AGENTS_SDK_SAFE_PAYLOAD_KEYS = [
  "agentType",
  "attempt",
  "attempts",
  "approved",
  "budgetMs",
  "callback",
  "capability",
  "code",
  "connectionId",
  "count",
  "elapsedMs",
  "fiberId",
  "fiberName",
  "id",
  "incidentId",
  "managed",
  "maxAttempts",
  "messagesPersisted",
  "method",
  "normalizedInputs",
  "phase",
  "recoveryKind",
  "recoveryReason",
  "removedToolCalls",
  "requestId",
  "runCount",
  "runId",
  "serverId",
  "stage",
  "status",
  "streaming",
  "timeoutMs",
  "toolCallId",
  "toolName",
  "totalTimeoutMs",
  "transport",
  "type",
  "workflowId",
  "workflowName",
] as const;
const AGENTS_SDK_PAYLOAD_ATTRIBUTE_PREFIX = "agents.sdk.payload.";
const agentsSdkObservabilityLogger = getLogger([
  ...LOGGING.SERVER_CATEGORY,
  LOGGING.AGENTS_SDK_CHILD_CATEGORY,
]);

type AgentsSdkObservabilityChannel = (typeof AGENTS_SDK_OBSERVABILITY_CHANNELS)[number];
type LogPropertyValue = string | number | boolean;
type StructuredLogProperties = Record<string, LogPropertyValue>;

export function createWorkerRequestId(request: Request): string {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}

export function getHttpStatusClass(status: number): string {
  return `${Math.trunc(status / 100)}xx`;
}

export function getApiRequestLogEvent(status: number): string {
  if (status === 404) {
    return LOG_EVENTS.API_REQUEST_NOT_FOUND;
  }
  if (status >= 500) {
    return LOG_EVENTS.API_REQUEST_FAILED;
  }
  return LOG_EVENTS.API_REQUEST_COMPLETED;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLogPropertyValue(value: unknown): value is LogPropertyValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function addLogProperty(
  properties: StructuredLogProperties,
  attribute: string,
  value: unknown,
): void {
  if (isLogPropertyValue(value)) {
    properties[attribute] = value;
  }
}

function getAgentsSdkObservabilityLogLevel(event: ObservabilityEvent): "error" | "info" | "warn" {
  if (
    event.type.endsWith(":error") ||
    event.type.endsWith(":failed") ||
    event.type.endsWith(":exhausted") ||
    event.type === "chat:request:failed" ||
    event.type === "message:error" ||
    event.type === "rpc:error"
  ) {
    return "error";
  }

  if (
    event.type.endsWith(":retry") ||
    event.type.endsWith(":skipped") ||
    event.type.endsWith(":interrupted") ||
    event.type.includes("warning")
  ) {
    return "warn";
  }

  return "info";
}

function createAgentsSdkObservabilityLogProperties(
  channel: AgentsSdkObservabilityChannel,
  event: ObservabilityEvent,
): StructuredLogProperties {
  const properties: StructuredLogProperties = {
    message: LOG_EVENTS.AGENTS_SDK_OBSERVABILITY_EVENT,
    [OTEL_ATTRS.AGENTS_SDK_CHANNEL]: channel,
    [OTEL_ATTRS.AGENTS_SDK_EVENT_TYPE]: event.type,
    [OTEL_ATTRS.AGENT_EVENT_TIMESTAMP]: event.timestamp,
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  };

  addLogProperty(properties, OTEL_ATTRS.AGENT_CLASS, event.agent);
  addLogProperty(properties, OTEL_ATTRS.AGENT_NAME, event.name);

  const payload: unknown = event.payload;
  if (!isRecord(payload)) {
    return properties;
  }

  addLogProperty(properties, OTEL_ATTRS.REQUEST_ID, payload.requestId);
  addLogProperty(properties, OTEL_ATTRS.SUBMISSION_ID, payload.submissionId);
  addLogProperty(properties, OTEL_ATTRS.REQUEST_DURATION_MS, payload.elapsedMs);
  addLogProperty(properties, OTEL_ATTRS.MCP_SERVER_ID, payload.serverId);

  if (isLogPropertyValue(payload.method)) {
    properties[OTEL_ATTRS.RPC_SYSTEM] = "agents.sdk";
    properties[OTEL_ATTRS.RPC_METHOD] = payload.method;
  }

  if (isLogPropertyValue(payload.error)) {
    properties[OTEL_ATTRS.EXCEPTION_MESSAGE] = payload.error;
  }

  for (const key of AGENTS_SDK_SAFE_PAYLOAD_KEYS) {
    addLogProperty(properties, `${AGENTS_SDK_PAYLOAD_ATTRIBUTE_PREFIX}${key}`, payload[key]);
  }

  return properties;
}

function logAgentsSdkObservabilityEvent(
  channel: AgentsSdkObservabilityChannel,
  event: ObservabilityEvent,
): void {
  const properties = createAgentsSdkObservabilityLogProperties(channel, event);

  switch (getAgentsSdkObservabilityLogLevel(event)) {
    case "error":
      agentsSdkObservabilityLogger.error(LOG_EVENTS.AGENTS_SDK_OBSERVABILITY_EVENT, properties);
      break;
    case "warn":
      agentsSdkObservabilityLogger.warn(LOG_EVENTS.AGENTS_SDK_OBSERVABILITY_EVENT, properties);
      break;
    default:
      agentsSdkObservabilityLogger.info(LOG_EVENTS.AGENTS_SDK_OBSERVABILITY_EVENT, properties);
      break;
  }
}

function subscribeAgentsSdkObservabilityChannel<K extends AgentsSdkObservabilityChannel>(
  channel: K,
): () => void {
  return subscribe(channel, (event) => {
    logAgentsSdkObservabilityEvent(channel, event);
  });
}

function configureAgentsSdkObservabilityBridge(): void {
  if (agentsSdkObservabilityBridgeConfigured) {
    return;
  }

  agentsSdkObservabilityBridgeConfigured = true;

  for (const channel of AGENTS_SDK_OBSERVABILITY_CHANNELS) {
    agentsSdkObservabilityUnsubscribers.push(subscribeAgentsSdkObservabilityChannel(channel));
  }
}

const structuredConsoleFormatter: ConsoleFormatter = (record: LogRecord) => [
  {
    timestamp: new Date(record.timestamp).toISOString(),
    level: record.level,
    category: record.category.join("."),
    message: record.message,
    ...record.properties,
  },
];

export function configureAgentLogging(lowestLevel: "debug" | "info" = "info"): void {
  if (configured) {
    return;
  }

  configured = true;

  configureSync({
    sinks: {
      console: redactByField(
        getConsoleSink({
          formatter: structuredConsoleFormatter,
        }),
        {
          fieldPatterns: SENSITIVE_LOG_FIELD_PATTERNS,
          action: () => REDACTED_LOG_VALUE,
        },
      ),
    },
    loggers: [
      {
        category: LOGGING.ROOT_CATEGORY,
        sinks: ["console"],
        lowestLevel,
      },
      {
        category: [...LOGGING.LOGTAPE_META_CATEGORY],
        sinks: ["console"],
        lowestLevel: "warning",
      },
    ],
    reset: true,
  });

  configureAgentsSdkObservabilityBridge();
}
