import { getLogger } from "@logtape/logtape";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getAgentByName } from "agents";
import { tool, type FlexibleSchema, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import { AppError, describeError } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import type { SigveloMcpAuthProps } from "#/backend/mcp/index.ts";
import type { SigveloNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import type { ObservabilityActor } from "#/backend/observability/recorders.ts";
import { buildNaniteManagerKey } from "#/nanites.ts";

export type SigveloNaniteToolSurface = "mcp" | "manager_chat";

export type NaniteToolContext = {
  surface: SigveloNaniteToolSurface;
  actor: ObservabilityActor;
  githubInstallationId: SigveloMcpAuthProps["githubInstallationId"];
  managerName: string;
  requestId: string;
};

export type NaniteToolRuntime = {
  context: NaniteToolContext;
  auth: SigveloMcpAuthProps;
  manager: DurableObjectStub<SigveloNaniteManager>;
};

export type SigveloMcpToolDefinition<TInputSchema extends z.ZodType, TOutput extends object> = {
  name: string;
  title: string;
  description: string;
  inputSchema: TInputSchema;
  outputSchema: z.ZodType;
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

export type CreateSigveloThinkToolsInput = {
  env: Env;
  getProps(): SigveloMcpAuthProps | null | Promise<SigveloMcpAuthProps | null>;
};

async function resolveAuthorizedNaniteToolRuntime(input: {
  env: Env;
  props: SigveloMcpAuthProps;
  surface: SigveloNaniteToolSurface;
  requestId?: string;
}): Promise<NaniteToolRuntime> {
  const managerName = buildNaniteManagerKey(input.props.githubInstallationId);

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
      githubInstallationId: input.props.githubInstallationId,
      managerName,
      requestId: input.requestId ?? crypto.randomUUID(),
    },
    auth: input.props,
    manager: await getAgentByName<Env, SigveloNaniteManager>(
      input.env.SigveloNaniteManager,
      managerName,
    ),
  };
}

const naniteToolLogger = getLogger(LOGGING.NANITES_CATEGORY);

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function redactInternalToolOutput(output: object): object {
  if (!("managerName" in output)) {
    return output;
  }

  const publicOutput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (key !== "managerName") {
      publicOutput[key] = value;
    }
  }
  return publicOutput;
}

function readOptionalToolCallId(input: unknown): string | undefined {
  return typeof input === "object" &&
    input !== null &&
    "toolCallId" in input &&
    typeof input.toolCallId === "string"
    ? input.toolCallId
    : undefined;
}

function createToolTelemetryContext(input: {
  definition: AnySigveloMcpToolDefinition;
  invocation: SigveloNaniteToolInvocation;
  runtime?: NaniteToolRuntime;
}) {
  return {
    [OTEL_ATTRS.RPC_SYSTEM]: "sigvelo.tool",
    [OTEL_ATTRS.RPC_METHOD]: input.definition.name,
    [OTEL_ATTRS.REQUEST_ID]: input.runtime?.context.requestId ?? input.invocation.requestId,
    [OTEL_ATTRS.GITHUB_INSTALLATION_ID]: input.invocation.props.githubInstallationId,
    [OTEL_ATTRS.NANITE_MANAGER_NAME]:
      input.runtime?.context.managerName ??
      buildNaniteManagerKey(input.invocation.props.githubInstallationId),
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
  let runtime: NaniteToolRuntime | undefined;

  try {
    naniteToolLogger.info(
      LOG_EVENTS.SIGVELO_TOOL_CALL_STARTED,
      createToolTelemetryContext({
        definition: input.definition,
        invocation,
      }),
    );

    runtime = await resolveAuthorizedNaniteToolRuntime({
      env: invocation.env,
      props: invocation.props,
      surface: invocation.surface,
      requestId: invocation.requestId,
    });
    const telemetry = createToolTelemetryContext({
      definition: input.definition,
      invocation,
      runtime,
    });

    const output = await input.definition.execute(input.toolInput, runtime);
    naniteToolLogger.info(LOG_EVENTS.SIGVELO_TOOL_CALL_FINISHED, {
      ...telemetry,
      [OTEL_ATTRS.REQUEST_DURATION_MS]: Math.round(performance.now() - startedAt),
    });
    return redactInternalToolOutput(output);
  } catch (error) {
    naniteToolLogger.error(LOG_EVENTS.SIGVELO_TOOL_CALL_FAILED, {
      ...createToolTelemetryContext({
        definition: input.definition,
        invocation,
        runtime,
      }),
      [OTEL_ATTRS.ERROR_TYPE]: getErrorType(error),
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
      const props = await input.getProps();
      if (!props) {
        throw new AppError("naniteToolInstallationRequired");
      }

      return executeSigveloNaniteTool({
        definition,
        toolInput,
        invocation: {
          env: input.env,
          props,
          surface: "manager_chat",
          requestId: readOptionalToolCallId(executeOptions),
        },
      });
    },
  });
}
