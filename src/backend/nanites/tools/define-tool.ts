import { getLogger } from "@logtape/logtape";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getAgentByName } from "agents";
import { tool, type FlexibleSchema, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import { SUPPORTED_MCP_SCOPES } from "#/shared/constants.ts";
import { APP_ERRORS, AppError, describeError } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import type { SigveloMcpAuthProps } from "#/backend/mcp/index.ts";
import type { SigveloNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import type { ObservabilityActor } from "#/backend/observability/recorders.ts";
import { buildNaniteManagerKey } from "#/shared/utils/nanites.ts";

type SigveloNaniteToolSurface = "mcp" | "manager_chat";
type SigveloMcpScope = (typeof SUPPORTED_MCP_SCOPES)[number];

type NaniteToolContext = {
  surface: SigveloNaniteToolSurface;
  actor: ObservabilityActor;
  githubAppId: SigveloMcpAuthProps["githubAppId"];
  githubInstallationId: SigveloMcpAuthProps["githubInstallationId"];
  managerName: string;
  requestId: string;
};

type NaniteToolManager = Pick<
  SigveloNaniteManager,
  | "cancelRuns"
  | "deprovisionNanite"
  | "exploreNaniteWorkspace"
  | "inspectNaniteDebug"
  | "registerNanite"
  | "resetNaniteDebug"
  | "startNaniteManualRun"
  | "testNaniteTrigger"
>;

export type NaniteToolRuntime = {
  context: NaniteToolContext;
  auth: SigveloMcpAuthProps;
  env: Env;
  manager: NaniteToolManager;
};

export type SigveloMcpToolDefinition<TInputSchema extends z.ZodType, TOutput extends object> = {
  name: string;
  title: string;
  description: string;
  inputSchema: TInputSchema;
  outputSchema: z.ZodType;
  requiredScope: SigveloMcpScope;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
  execute(input: z.output<TInputSchema>, runtime: NaniteToolRuntime): Promise<TOutput>;
};

export type AnySigveloMcpToolDefinition = Omit<
  SigveloMcpToolDefinition<z.ZodType, object>,
  "execute"
> & {
  execute(input: unknown, runtime: NaniteToolRuntime): Promise<object>;
};

export function defineSigveloMcpTool<TInputSchema extends z.ZodType, TOutput extends object>(
  definition: SigveloMcpToolDefinition<TInputSchema, TOutput>,
): AnySigveloMcpToolDefinition {
  return {
    ...definition,
    execute: (input, runtime) => definition.execute(input as z.output<TInputSchema>, runtime),
  };
}

export function createObjectOutputSchema(description: string): z.ZodType {
  return z.object({}).passthrough().describe(description);
}

export const nonEmptyStringSchema = z.string().min(1);

type SigveloNaniteToolInvocation = {
  env: Env;
  props: SigveloMcpAuthProps;
  surface: SigveloNaniteToolSurface;
  requestId?: string;
};
type PreparedSigveloNaniteToolInvocation = SigveloNaniteToolInvocation & {
  requestId: string;
};
type SigveloNaniteToolTelemetryInput = {
  definition: AnySigveloMcpToolDefinition;
  invocation: PreparedSigveloNaniteToolInvocation;
  runtime?: NaniteToolRuntime;
};

export type CreateSigveloThinkToolsInput = {
  env: Env;
  auth: SigveloMcpAuthProps;
};

async function resolveAuthorizedNaniteToolRuntime(
  input: PreparedSigveloNaniteToolInvocation,
): Promise<NaniteToolRuntime> {
  const managerName = buildNaniteManagerKey({
    githubInstallationId: input.props.githubInstallationId,
  });

  return {
    context: {
      surface: input.surface,
      actor: {
        kind: "github_user",
        source: input.surface,
        githubUserId: input.props.githubUserId,
        githubLogin: input.props.githubLogin,
        actorId: `github:${input.props.githubUserId}`,
        actorLogin: input.props.githubLogin,
      },
      githubAppId: input.props.githubAppId,
      githubInstallationId: input.props.githubInstallationId,
      managerName,
      requestId: input.requestId,
    },
    auth: input.props,
    env: input.env,
    manager: (await getAgentByName<Env, SigveloNaniteManager>(
      input.env.SigveloNaniteManager,
      managerName,
    )) as unknown as NaniteToolManager,
  };
}

const naniteToolLogger = getLogger(LOGGING.NANITES_CATEGORY);

function redactInternalToolOutput(output: object): object {
  if (!("managerName" in output)) {
    return output;
  }

  const publicOutput = { ...(output as Record<string, unknown>) };
  delete publicOutput.managerName;
  return publicOutput;
}

function authorizeSigveloNaniteToolScope(input: {
  definition: AnySigveloMcpToolDefinition;
  auth: SigveloMcpAuthProps;
}): void {
  if (input.auth.scopes.includes(input.definition.requiredScope)) {
    return;
  }

  throw new AppError("mcpTokenScopeUnavailable", {
    details: {
      toolName: input.definition.name,
      requiredScope: input.definition.requiredScope,
      grantedScopes: input.auth.scopes,
    },
    message: `${APP_ERRORS.mcpTokenScopeUnavailable.message}: ${input.definition.requiredScope}`,
  });
}

function createToolTelemetryContext(input: SigveloNaniteToolTelemetryInput) {
  const runtimeContext = input.runtime?.context;

  return {
    [OTEL_ATTRS.RPC_SYSTEM]: "sigvelo.tool",
    [OTEL_ATTRS.RPC_METHOD]: input.definition.name,
    [OTEL_ATTRS.REQUEST_ID]: runtimeContext?.requestId ?? input.invocation.requestId,
    [OTEL_ATTRS.GITHUB_INSTALLATION_ID]: input.invocation.props.githubInstallationId,
    [OTEL_ATTRS.NANITE_MANAGER_NAME]:
      runtimeContext?.managerName ??
      buildNaniteManagerKey({
        githubInstallationId: input.invocation.props.githubInstallationId,
      }),
    [OTEL_ATTRS.NANITE_TOOL_NAME]: input.definition.name,
    [OTEL_ATTRS.SIGVELO_TOOL_SURFACE]: input.invocation.surface,
  };
}

export async function executeSigveloNaniteTool(input: {
  definition: AnySigveloMcpToolDefinition;
  toolInput: unknown;
  invocation: SigveloNaniteToolInvocation;
}): Promise<object> {
  const invocation = {
    ...input.invocation,
    requestId: input.invocation.requestId ?? crypto.randomUUID(),
  };
  const startedAt = performance.now();
  let telemetryInput: SigveloNaniteToolTelemetryInput = {
    definition: input.definition,
    invocation,
  };

  try {
    const toolInput = input.definition.inputSchema.parse(input.toolInput);
    authorizeSigveloNaniteToolScope({
      definition: input.definition,
      auth: invocation.props,
    });

    naniteToolLogger.info(
      LOG_EVENTS.SIGVELO_TOOL_CALL_STARTED,
      createToolTelemetryContext(telemetryInput),
    );

    const runtime = await resolveAuthorizedNaniteToolRuntime(invocation);
    telemetryInput = {
      definition: input.definition,
      invocation,
      runtime,
    };
    const telemetry = createToolTelemetryContext(telemetryInput);

    const output = await input.definition.execute(toolInput, runtime);
    naniteToolLogger.info(LOG_EVENTS.SIGVELO_TOOL_CALL_FINISHED, {
      ...telemetry,
      [OTEL_ATTRS.REQUEST_DURATION_MS]: Math.round(performance.now() - startedAt),
    });
    return redactInternalToolOutput(output);
  } catch (error) {
    naniteToolLogger.error(LOG_EVENTS.SIGVELO_TOOL_CALL_FAILED, {
      ...createToolTelemetryContext(telemetryInput),
      [OTEL_ATTRS.ERROR_TYPE]: error instanceof Error ? error.name : typeof error,
      [OTEL_ATTRS.EXCEPTION_MESSAGE]: describeError(error),
      [OTEL_ATTRS.REQUEST_DURATION_MS]: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}

export function createSigveloThinkTool(
  definition: AnySigveloMcpToolDefinition,
  input: CreateSigveloThinkToolsInput,
) {
  return tool<unknown, unknown>({
    type: "dynamic",
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema as FlexibleSchema<unknown>,
    outputSchema: definition.outputSchema as FlexibleSchema<unknown>,
    execute: async (toolInput: unknown, executeOptions: ToolExecutionOptions) => {
      return executeSigveloNaniteTool({
        definition,
        toolInput,
        invocation: {
          env: input.env,
          props: input.auth,
          surface: "manager_chat",
          requestId: executeOptions.toolCallId,
        },
      });
    },
  });
}
