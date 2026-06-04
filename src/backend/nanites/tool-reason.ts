import type { ToolProvider } from "@cloudflare/codemode";
import { generateTypes } from "@cloudflare/codemode/ai";
import { asSchema, type ToolSet } from "ai";
import { z } from "zod";

const naniteToolCallReasonSchema = z
  .string()
  .trim()
  .min(1)
  .describe("Why the Nanite is calling this tool and what it is doing.");

type ExecutableToolRecord = {
  description?: string;
  inputSchema?: unknown;
  parameters?: unknown;
  execute?: (...args: unknown[]) => Promise<unknown> | unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObjectShape(inputSchema: unknown): Record<string, unknown> | null {
  if (!(inputSchema instanceof z.ZodObject)) {
    return null;
  }

  const shape = inputSchema.def.shape;
  return typeof shape === "object" && shape !== null ? shape : null;
}

function buildReasonedToolInputSchema(toolName: string, inputSchema: unknown): unknown {
  if (!readObjectShape(inputSchema)) {
    throw new Error(
      `Nanite tool "${toolName}" must use a Zod object input schema before call reasons can be enforced.`,
    );
  }

  return z.object({
    args: inputSchema as z.ZodObject,
    reason: naniteToolCallReasonSchema,
  });
}

function unwrapNaniteToolCallInput(input: unknown, toolName: string): unknown {
  const reason = isRecord(input) && typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    throw new Error(`Nanite tool "${toolName}" requires a non-empty reason.`);
  }
  if (!isRecord(input) || !("args" in input)) {
    throw new Error(`Nanite tool "${toolName}" requires args.`);
  }
  return input.args;
}

async function validateSingleSchemaInput(schema: unknown, input: unknown): Promise<unknown> {
  const validator = asSchema(schema);
  const result = await validator.validate?.(input);
  if (!result) {
    return input;
  }
  if (!result.success) {
    throw result.error;
  }
  return result.value;
}

function readFinalReasonArgument(
  args: readonly unknown[],
  toolName: string,
): {
  args: unknown[];
  reason: string;
} {
  const reason = args.at(-1);
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error(`Nanite execute helper "${toolName}" requires a final non-empty reason.`);
  }

  return {
    args: args.slice(0, -1),
    reason: reason.trim(),
  };
}

function addReasonParameterToSignature(parameters: string): string {
  if (/\breason\s*:/.test(parameters)) {
    return `(${parameters})`;
  }

  const trimmed = parameters.trim();
  return trimmed ? `(${parameters}, reason: string)` : "(reason: string)";
}

export function addReasonParametersToToolProviderTypes(types: string): string {
  return types.replace(/\(([^()]*)\)(?=\s*(?::|=>)\s*Promise<)/g, (_match, parameters: string) =>
    addReasonParameterToSignature(parameters),
  );
}

export function wrapToolSetForNaniteCallReasons(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, originalTool]) => {
      const toolRecord = originalTool as Record<string, unknown>;
      const execute = toolRecord.execute;
      const needsApproval = toolRecord.needsApproval;
      const toModelOutput = toolRecord.toModelOutput;

      return [
        toolName,
        {
          ...toolRecord,
          inputSchema: buildReasonedToolInputSchema(toolName, toolRecord.inputSchema),
          execute:
            typeof execute === "function"
              ? async (input: unknown, options: unknown) => {
                  return execute(unwrapNaniteToolCallInput(input, toolName), options);
                }
              : execute,
          needsApproval:
            typeof needsApproval === "function"
              ? async (input: unknown, options: unknown) => {
                  return needsApproval(unwrapNaniteToolCallInput(input, toolName), options);
                }
              : needsApproval,
          toModelOutput:
            typeof toModelOutput === "function"
              ? async (event: Record<string, unknown>) => {
                  return toModelOutput({
                    ...event,
                    input: unwrapNaniteToolCallInput(event.input, toolName),
                  });
                }
              : toModelOutput,
        },
      ];
    }),
  ) as ToolSet;
}

export function wrapToolProviderForNaniteCallReasons(provider: ToolProvider): ToolProvider {
  const providerName = provider.name ?? "codemode";
  const tools = provider.tools as Record<string, ExecutableToolRecord>;
  const originalTypes = provider.types ?? generateTypes(provider.tools as ToolSet, providerName);

  return {
    ...provider,
    tools: Object.fromEntries(
      Object.entries(tools).map(([toolName, toolRecord]) => {
        const execute = toolRecord.execute;
        return [
          toolName,
          {
            description: toolRecord.description,
            execute:
              typeof execute === "function"
                ? async (...rawArgs: unknown[]) => {
                    const { args } = readFinalReasonArgument(
                      rawArgs,
                      `${providerName}.${toolName}`,
                    );
                    const schema = toolRecord.inputSchema ?? toolRecord.parameters;
                    if (schema) {
                      if (args.length !== 1) {
                        throw new Error(
                          `Nanite execute helper "${providerName}.${toolName}" expects one args value before reason.`,
                        );
                      }
                      return execute(await validateSingleSchemaInput(schema, args[0]));
                    }
                    return execute(...args);
                  }
                : execute,
          },
        ];
      }),
    ),
    types: addReasonParametersToToolProviderTypes(originalTypes),
  };
}
