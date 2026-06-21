import type { ToolSet } from "ai";
import { z } from "zod";
import { APP_ERRORS, AppError } from "#/backend/errors.ts";

const naniteToolOutputArtifactTtlSeconds = 7 * 24 * 60 * 60;

export const naniteToolOutputArtifactReadInputSchema = z.preprocess(
  (input) => (input === null ? undefined : input),
  z
    .object({
      artifactId: z.string().startsWith("toolout_").optional(),
      offset: z.number().finite().optional(),
      maxChars: z.number().finite().optional(),
      pattern: z.string().min(1).optional(),
      regex: z.boolean().optional(),
      caseSensitive: z.boolean().optional(),
      contextLines: z.number().finite().optional(),
      matchLimit: z.number().finite().optional(),
      listLimit: z.number().finite().optional(),
    })
    .default({}),
);

type NaniteToolOutputArtifactMetadata = {
  artifactId: string;
  runId: string;
  naniteId: string | null;
  naniteName: string;
  managerName: string | null;
  toolName: string;
  toolCallId: string;
  contentType: "application/json" | "text/plain";
  extension: "json" | "txt";
  size: number;
  createdAt: string;
  expiresAt: string;
};

type PersistNaniteToolOutputArtifactInput = {
  toolName: string;
  toolCallId: string;
  content: string;
  extension: "json" | "txt";
};

type NaniteToolOutputArtifactReadToolInput = z.output<
  typeof naniteToolOutputArtifactReadInputSchema
>;

type NaniteToolOutputArtifactReadCommand =
  | {
      action: "list";
      listLimit: number;
    }
  | {
      action: "read";
      artifactId: string;
      offset: number;
      maxChars: number;
    }
  | {
      action: "grep";
      artifactId: string | null;
      pattern: string;
      regex: boolean;
      caseSensitive: boolean;
      contextLines: number;
      matchLimit: number;
      listLimit: number;
    };

type NaniteToolOutputArtifactGrepCommand = Extract<
  NaniteToolOutputArtifactReadCommand,
  { action: "grep" }
>;

type NaniteToolOutputArtifactReadSliceResult = {
  action: "read";
  artifact: NaniteToolOutputArtifactMetadata;
  offset: number;
  maxChars: number;
  content: string;
  returnedChars: number;
  totalChars: number;
  truncated: boolean;
};

type NaniteToolOutputArtifactGrepResult = {
  action: "grep";
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  matches: Array<{
    artifact: NaniteToolOutputArtifactMetadata;
    line: number;
    text: string;
    before: Array<{ line: number; text: string }>;
    after: Array<{ line: number; text: string }>;
  }>;
  truncated: boolean;
};

type NaniteToolOutputArtifactListResult = {
  action: "list";
  artifacts: NaniteToolOutputArtifactMetadata[];
};

type NaniteToolOutputArtifactReadResult =
  | NaniteToolOutputArtifactReadSliceResult
  | NaniteToolOutputArtifactGrepResult
  | NaniteToolOutputArtifactListResult;

type NaniteToolOutputArtifactStoreOptions = {
  kv: KVNamespace;
  managerName: string | null;
  naniteId: string | null;
  naniteName: string;
  runId: string | null;
  ttlSeconds?: number;
};

type RequiredArtifactScope = {
  managerName: string | null;
  naniteId: string | null;
  naniteName: string;
  runId: string;
};

const artifactKeyPrefix = "nanite-tool-outputs/v1";

function encodeKeySegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

function clampInteger(
  input: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(input), min), max);
}

function normalizeArtifactReadInput(
  input: NaniteToolOutputArtifactReadToolInput,
): NaniteToolOutputArtifactReadCommand {
  if (input.pattern) {
    return {
      action: "grep",
      artifactId: input.artifactId ?? null,
      pattern: input.pattern,
      regex: input.regex ?? false,
      caseSensitive: input.caseSensitive ?? false,
      contextLines: clampInteger(input.contextLines, 0, 0, 10),
      matchLimit: clampInteger(input.matchLimit, 50, 1, 500),
      listLimit: clampInteger(input.listLimit, 25, 1, 100),
    };
  }

  if (input.artifactId) {
    return {
      action: "read",
      artifactId: input.artifactId,
      offset: clampInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER),
      maxChars: clampInteger(input.maxChars, 24_000, 1, 100_000),
    };
  }

  return {
    action: "list",
    listLimit: clampInteger(input.listLimit, 25, 1, 100),
  };
}

function truncateMatchText(text: string): string {
  const maxChars = 2_000;
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, 1_000)}\n[SigVelo artifact_read truncated ${text.length - maxChars} characters from this matching line.]\n${text.slice(-1_000)}`;
}

function includesPattern(line: string, input: NaniteToolOutputArtifactGrepCommand): boolean {
  if (input.regex) {
    const flags = input.caseSensitive ? "" : "i";
    return new RegExp(input.pattern, flags).test(line);
  }
  if (input.caseSensitive) {
    return line.includes(input.pattern);
  }
  return line.toLowerCase().includes(input.pattern.toLowerCase());
}

function lineContext(lines: string[], start: number, end: number, lineNumberOffset: number) {
  return lines.slice(start, end).map((text, index) => ({
    line: lineNumberOffset + index,
    text: truncateMatchText(text),
  }));
}

export class NaniteToolOutputArtifactStore {
  readonly #kv: KVNamespace;
  readonly #managerName: string | null;
  readonly #naniteId: string | null;
  readonly #naniteName: string;
  readonly #runId: string | null;
  readonly #ttlSeconds: number;

  constructor(options: NaniteToolOutputArtifactStoreOptions) {
    this.#kv = options.kv;
    this.#managerName = options.managerName;
    this.#naniteId = options.naniteId;
    this.#naniteName = options.naniteName;
    this.#runId = options.runId;
    this.#ttlSeconds = options.ttlSeconds ?? naniteToolOutputArtifactTtlSeconds;
  }

  // fallow-ignore-next-line unused-class-member
  async persist(input: PersistNaniteToolOutputArtifactInput): Promise<{ artifactId: string }> {
    const scope = this.#requireScope();
    const artifactId = `toolout_${crypto.randomUUID().replace(/-/g, "")}`;
    const createdAt = new Date();
    const expiresAt = addSeconds(createdAt, this.#ttlSeconds);
    const metadata: NaniteToolOutputArtifactMetadata = {
      artifactId,
      runId: scope.runId,
      naniteId: scope.naniteId,
      naniteName: scope.naniteName,
      managerName: scope.managerName,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      contentType: input.extension === "json" ? "application/json" : "text/plain",
      extension: input.extension,
      size: input.content.length,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.#kv.put(this.#key(scope, artifactId), input.content, {
      expirationTtl: this.#ttlSeconds,
      metadata,
    });

    return { artifactId };
  }

  async info(artifactId: string): Promise<NaniteToolOutputArtifactMetadata> {
    const scope = this.#requireScope();
    const result = await this.#kv.getWithMetadata<NaniteToolOutputArtifactMetadata>(
      this.#key(scope, artifactId),
      "text",
    );
    const metadata = result.metadata;
    if (!metadata) {
      throw new AppError("toolOutputArtifactNotFound", {
        details: { artifactId },
        message: `${APP_ERRORS.toolOutputArtifactNotFound.message}: ${artifactId}`,
      });
    }
    return metadata;
  }

  async #list(limit: number): Promise<NaniteToolOutputArtifactMetadata[]> {
    const scope = this.#requireScope();
    const result = await this.#kv.list<NaniteToolOutputArtifactMetadata>({
      prefix: this.#runPrefix(scope),
      limit,
    });
    const metadata: NaniteToolOutputArtifactMetadata[] = [];
    for (const key of result.keys) {
      if (key.metadata) {
        metadata.push(key.metadata);
      }
    }
    return metadata.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async #read(
    input: NaniteToolOutputArtifactReadCommand,
  ): Promise<NaniteToolOutputArtifactReadResult> {
    switch (input.action) {
      case "list":
        return {
          action: "list",
          artifacts: await this.#list(input.listLimit),
        };
      case "read":
        return this.#readSlice(input);
      case "grep":
        return this.#grep(input);
    }
  }

  async readToolInput(input: unknown): Promise<NaniteToolOutputArtifactReadResult> {
    return this.#read(
      normalizeArtifactReadInput(naniteToolOutputArtifactReadInputSchema.parse(input)),
    );
  }

  // fallow-ignore-next-line unused-class-member
  provider() {
    return {
      name: "artifact",
      tools: {
        read: {
          description:
            "Inspect saved SigVelo tool-output artifacts. With no args, lists current-run artifacts. With artifactId, reads a slice. With pattern, grep-searches one artifact or all current-run artifacts.",
          execute: async (args: unknown) => this.readToolInput(args),
        },
      },
      types: [
        "declare namespace artifact {",
        "  function read(args?: { artifactId?: string; offset?: number; maxChars?: number; pattern?: string; regex?: boolean; caseSensitive?: boolean; contextLines?: number; matchLimit?: number; listLimit?: number }): Promise<unknown>;",
        "}",
      ].join("\n"),
    };
  }

  async #readSlice(
    input: Extract<NaniteToolOutputArtifactReadCommand, { action: "read" }>,
  ): Promise<NaniteToolOutputArtifactReadSliceResult> {
    const artifact = await this.#loadArtifact(input.artifactId);

    const offset = Math.min(input.offset, artifact.value.length);
    const content = artifact.value.slice(offset, offset + input.maxChars);
    return {
      action: "read",
      artifact: artifact.metadata,
      offset,
      maxChars: input.maxChars,
      content,
      returnedChars: content.length,
      totalChars: artifact.value.length,
      truncated: offset + content.length < artifact.value.length,
    };
  }

  async #grep(
    input: NaniteToolOutputArtifactGrepCommand,
  ): Promise<NaniteToolOutputArtifactGrepResult> {
    const artifacts = input.artifactId
      ? [await this.info(input.artifactId)]
      : await this.#list(input.listLimit);
    const matches: NaniteToolOutputArtifactGrepResult["matches"] = [];
    const toResult = (truncated: boolean): NaniteToolOutputArtifactGrepResult => ({
      action: "grep",
      pattern: input.pattern,
      regex: input.regex,
      caseSensitive: input.caseSensitive,
      matches,
      truncated,
    });

    for (const artifact of artifacts) {
      const stored = await this.#loadArtifact(artifact.artifactId);
      const lines = stored.value.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!includesPattern(line, input)) {
          continue;
        }

        const beforeStart = Math.max(index - input.contextLines, 0);
        const afterEnd = Math.min(index + input.contextLines + 1, lines.length);
        matches.push({
          artifact,
          line: index + 1,
          text: truncateMatchText(line),
          before: lineContext(lines, beforeStart, index, beforeStart + 1),
          after: lineContext(lines, index + 1, afterEnd, index + 2),
        });

        if (matches.length >= input.matchLimit) {
          return toResult(true);
        }
      }
    }

    return toResult(false);
  }

  async #loadArtifact(
    artifactId: string,
  ): Promise<{ value: string; metadata: NaniteToolOutputArtifactMetadata }> {
    const scope = this.#requireScope();
    const result = await this.#kv.getWithMetadata<NaniteToolOutputArtifactMetadata>(
      this.#key(scope, artifactId),
      "text",
    );
    if (!result.metadata || result.value === null) {
      throw new AppError("toolOutputArtifactNotFound", {
        details: { artifactId },
        message: `${APP_ERRORS.toolOutputArtifactNotFound.message}: ${artifactId}`,
      });
    }
    return { value: result.value, metadata: result.metadata };
  }

  #requireScope(): RequiredArtifactScope {
    if (!this.#runId) {
      throw new AppError("toolOutputActiveRunRequired");
    }
    return {
      managerName: this.#managerName,
      naniteId: this.#naniteId,
      naniteName: this.#naniteName,
      runId: this.#runId,
    };
  }

  #runPrefix(scope: RequiredArtifactScope): string {
    return [
      artifactKeyPrefix,
      encodeKeySegment(scope.managerName ?? "unknown-manager"),
      encodeKeySegment(scope.naniteName),
      encodeKeySegment(scope.runId),
    ].join("/");
  }

  #key(scope: RequiredArtifactScope, artifactId: string): string {
    return `${this.#runPrefix(scope)}/${encodeKeySegment(artifactId)}`;
  }
}

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

type NaniteToolOutputBudgetOptions = {
  defaultMaxResponseChars?: number;
  minResponseChars?: number;
  hardMaxResponseChars?: number;
  excludedToolNames?: Iterable<string>;
  persistArtifact: (input: PersistToolOutputArtifactInput) => Promise<{ artifactId: string }>;
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
            "Optional SigVelo inline response budget for this tool call. Large outputs are saved as current-run SigVelo artifacts; this controls how many characters are returned inline.",
          ),
      })
      .optional()
      .describe("Reserved SigVelo tool-call controls."),
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

  const separator = `\n\n[SigVelo truncated ${text.length - maxResponseChars} characters from this tool result. Head and tail preserved.]\n\n`;
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
    "SigVelo saved the full tool result as a current-run artifact:",
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

async function applyNaniteToolOutputBudget(
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
