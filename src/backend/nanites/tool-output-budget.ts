import type { ToolSet } from "ai";
import { z } from "zod";

const naniteToolOutputBudget = {
  defaultMaxResponseChars: 24_000,
  minResponseChars: 1_000,
  hardMaxResponseChars: 100_000,
} as const;

type ToolExecuteOptions = {
  toolCallId?: string;
};

type SigveloToolInputControl = {
  _sigvelo?: {
    maxResponseChars?: number;
  };
};

type PersistToolOutputArtifactInput = {
  toolName: string;
  toolCallId: string;
  content: string;
  extension: "json" | "txt";
};

type PersistedToolOutputArtifact = {
  artifactId: string;
};

type PersistToolOutputArtifact = (
  input: PersistToolOutputArtifactInput,
) => Promise<PersistedToolOutputArtifact>;

type NaniteToolOutputBudgetOptions = {
  defaultMaxResponseChars?: number;
  minResponseChars?: number;
  hardMaxResponseChars?: number;
  excludedToolNames?: Iterable<string>;
  persistArtifact: PersistToolOutputArtifact;
  onTruncated?: (event: {
    toolName: string;
    toolCallId: string;
    artifactId: string;
    originalChars: number;
    returnedChars: number;
  }) => void;
};

type SerializedToolOutput = {
  text: string;
  extension: "json" | "txt";
};

const sigveloToolInputControlSchema = z
  .object({
    _sigvelo: z
      .object({
        maxResponseChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Optional Sigvelo inline response budget for this tool call. Large outputs are saved as temporary Sigvelo artifacts; this controls how many characters are returned inline.",
          ),
      })
      .optional()
      .describe("Reserved Sigvelo tool-call controls."),
  })
  .partial();

function getToolCallId(options: unknown): string {
  const toolCallId =
    typeof options === "object" &&
    options !== null &&
    "toolCallId" in options &&
    typeof (options as ToolExecuteOptions).toolCallId === "string"
      ? (options as ToolExecuteOptions).toolCallId
      : null;

  if (toolCallId) {
    return toolCallId;
  }

  return crypto.randomUUID();
}

function serializeToolOutput(output: unknown): SerializedToolOutput {
  if (typeof output === "string") {
    return { text: output, extension: "txt" };
  }

  const seen = new WeakSet<object>();
  const text = JSON.stringify(
    output,
    (_key, value: unknown) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }
      return value;
    },
    2,
  );

  return {
    text: text ?? String(output),
    extension: "json",
  };
}

function clampMaxResponseChars(input: {
  requestedMaxResponseChars: number | null;
  options: NaniteToolOutputBudgetOptions;
}): number {
  const minResponseChars =
    input.options.minResponseChars ?? naniteToolOutputBudget.minResponseChars;
  const hardMaxResponseChars =
    input.options.hardMaxResponseChars ?? naniteToolOutputBudget.hardMaxResponseChars;
  const defaultMaxResponseChars =
    input.options.defaultMaxResponseChars ?? naniteToolOutputBudget.defaultMaxResponseChars;
  const requestedMaxResponseChars = input.requestedMaxResponseChars ?? defaultMaxResponseChars;
  return Math.min(Math.max(requestedMaxResponseChars, minResponseChars), hardMaxResponseChars);
}

function buildPreview(text: string, maxResponseChars: number): string {
  if (text.length <= maxResponseChars) {
    return text;
  }

  const separator = `\n\n[Sigvelo truncated ${text.length - maxResponseChars} characters from this tool result. Head and tail preserved.]\n\n`;
  const contentBudget = Math.max(maxResponseChars - separator.length, 0);
  const headChars = Math.ceil(contentBudget * 0.7);
  const tailChars = Math.max(contentBudget - headChars, 0);
  return [text.slice(0, headChars), separator, text.slice(-tailChars)].join("");
}

function buildTruncationNotice(input: {
  artifactId: string;
  originalChars: number;
  maxResponseChars: number;
  preview: string;
}): string {
  return [
    "Sigvelo saved the full tool result as a temporary artifact:",
    input.artifactId,
    "",
    `The full result is ${input.originalChars.toLocaleString()} characters. The inline preview below is capped at ${input.maxResponseChars.toLocaleString()} characters.`,
    "Use artifact_read with a pattern to grep the artifact, or with offset and maxChars to read a bounded slice.",
    "",
    "--- inline preview ---",
    input.preview,
  ].join("\n");
}

function parseRequestedMaxResponseChars(input: unknown): number | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const control = (input as SigveloToolInputControl)._sigvelo;
  const maxResponseChars = control?.maxResponseChars;
  return typeof maxResponseChars === "number" && Number.isFinite(maxResponseChars)
    ? maxResponseChars
    : null;
}

function stripSigveloInputControl(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }

  if (!("_sigvelo" in input)) {
    return input;
  }

  const { _sigvelo: _sigveloControl, ...rest } = input as Record<string, unknown>;
  return rest;
}

function augmentInputSchema(inputSchema: unknown): unknown {
  if (!(inputSchema instanceof z.ZodObject)) {
    return inputSchema;
  }

  const shape = inputSchema.def.shape;
  if (typeof shape === "object" && shape !== null && "_sigvelo" in shape) {
    return inputSchema;
  }

  return inputSchema.safeExtend(sigveloToolInputControlSchema.def.shape);
}

export async function applyNaniteToolOutputBudget(
  output: unknown,
  input: {
    toolName: string;
    toolCallId: string;
    requestedMaxResponseChars?: number | null;
    options: NaniteToolOutputBudgetOptions;
  },
): Promise<unknown> {
  const serialized = serializeToolOutput(output);
  const maxResponseChars = clampMaxResponseChars({
    requestedMaxResponseChars: input.requestedMaxResponseChars ?? null,
    options: input.options,
  });

  if (serialized.text.length <= maxResponseChars) {
    return output;
  }

  const artifact = await input.options.persistArtifact({
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    content: serialized.text,
    extension: serialized.extension,
  });

  const preview = buildPreview(serialized.text, maxResponseChars);
  const notice = buildTruncationNotice({
    artifactId: artifact.artifactId,
    originalChars: serialized.text.length,
    maxResponseChars,
    preview,
  });

  input.options.onTruncated?.({
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    artifactId: artifact.artifactId,
    originalChars: serialized.text.length,
    returnedChars: notice.length,
  });

  return { notice };
}

export function wrapToolSetForNaniteOutputBudget(
  tools: ToolSet,
  options: NaniteToolOutputBudgetOptions,
): ToolSet {
  const excludedToolNames = new Set(options.excludedToolNames ?? []);
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, originalTool]) => {
      const toolRecord = originalTool as Record<string, unknown>;
      const execute = toolRecord.execute;
      if (excludedToolNames.has(toolName) || typeof execute !== "function") {
        return [toolName, originalTool];
      }

      return [
        toolName,
        {
          ...toolRecord,
          inputSchema: augmentInputSchema(toolRecord.inputSchema),
          execute: async (rawInput: unknown, executeOptions: unknown) => {
            const requestedMaxResponseChars = parseRequestedMaxResponseChars(rawInput);
            const input = stripSigveloInputControl(rawInput);
            const output = await execute(input, executeOptions);
            return applyNaniteToolOutputBudget(output, {
              toolName,
              toolCallId: getToolCallId(executeOptions),
              requestedMaxResponseChars,
              options,
            });
          },
        },
      ];
    }),
  ) as ToolSet;
}
