import { z } from "zod";

export const naniteToolOutputArtifactTtlSeconds = 7 * 24 * 60 * 60;

const artifactReadInputSchema = z.preprocess(
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

export type NaniteToolOutputArtifactMetadata = {
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

export type PersistNaniteToolOutputArtifactInput = {
  toolName: string;
  toolCallId: string;
  content: string;
  extension: "json" | "txt";
};

export type NaniteToolOutputArtifactInfo = NaniteToolOutputArtifactMetadata & {
  expired: boolean;
};

export type NaniteToolOutputArtifactReadInput = z.infer<typeof artifactReadInputSchema>;

export type NaniteToolOutputArtifactReadSliceResult = {
  action: "read";
  artifact: NaniteToolOutputArtifactInfo;
  offset: number;
  maxChars: number;
  content: string;
  returnedChars: number;
  totalChars: number;
  truncated: boolean;
};

export type NaniteToolOutputArtifactGrepResult = {
  action: "grep";
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  matches: Array<{
    artifact: NaniteToolOutputArtifactInfo;
    line: number;
    text: string;
    before: Array<{ line: number; text: string }>;
    after: Array<{ line: number; text: string }>;
  }>;
  truncated: boolean;
};

export type NaniteToolOutputArtifactListResult = {
  action: "list";
  artifacts: NaniteToolOutputArtifactInfo[];
};

export type NaniteToolOutputArtifactReadResult =
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

function contentTypeForExtension(
  extension: PersistNaniteToolOutputArtifactInput["extension"],
): NaniteToolOutputArtifactMetadata["contentType"] {
  return extension === "json" ? "application/json" : "text/plain";
}

function createArtifactId(): string {
  return `toolout_${crypto.randomUUID().replace(/-/g, "")}`;
}

function toInfo(metadata: NaniteToolOutputArtifactMetadata): NaniteToolOutputArtifactInfo {
  return {
    ...metadata,
    expired: Date.parse(metadata.expiresAt) <= Date.now(),
  };
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

function truncateMatchText(text: string): string {
  const maxChars = 2_000;
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, 1_000)}\n[Sigvelo artifact_read truncated ${text.length - maxChars} characters from this matching line.]\n${text.slice(-1_000)}`;
}

function includesPattern(
  line: string,
  pattern: string,
  input: NaniteToolOutputArtifactReadInput,
): boolean {
  if (input.regex) {
    const flags = input.caseSensitive ? "" : "i";
    return new RegExp(pattern, flags).test(line);
  }
  if (input.caseSensitive) {
    return line.includes(pattern);
  }
  return line.toLowerCase().includes(pattern.toLowerCase());
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

  async persist(input: PersistNaniteToolOutputArtifactInput): Promise<{ artifactId: string }> {
    const scope = this.#requireScope();
    const artifactId = createArtifactId();
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
      contentType: contentTypeForExtension(input.extension),
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

  async info(artifactId: string): Promise<NaniteToolOutputArtifactInfo> {
    const scope = this.#requireScope();
    const result = await this.#kv.getWithMetadata<NaniteToolOutputArtifactMetadata>(
      this.#key(scope, artifactId),
      "text",
    );
    const metadata = result.metadata;
    if (!metadata) {
      throw new Error(`Tool output artifact ${artifactId} was not found or has expired.`);
    }
    return toInfo(metadata);
  }

  async list(limit: number): Promise<NaniteToolOutputArtifactInfo[]> {
    const scope = this.#requireScope();
    const result = await this.#kv.list<NaniteToolOutputArtifactMetadata>({
      prefix: this.#runPrefix(scope),
      limit: Math.min(Math.max(limit, 1), 100),
    });
    return result.keys
      .flatMap((key) => (key.metadata ? [toInfo(key.metadata)] : []))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async read(
    input: NaniteToolOutputArtifactReadInput = {},
  ): Promise<NaniteToolOutputArtifactReadResult> {
    if (input.pattern) {
      return this.#grep(input);
    }

    if (!input.artifactId) {
      return {
        action: "list",
        artifacts: await this.list(input.listLimit ?? 25),
      };
    }

    return this.#readSlice(input.artifactId, input);
  }

  provider(): {
    name: "artifact";
    tools: {
      read: { description: string; execute: (args: unknown) => Promise<unknown> };
    };
    types: string;
  } {
    return {
      name: "artifact",
      tools: {
        read: {
          description:
            "Inspect temporary Sigvelo tool-output artifacts. With no args, lists current-run artifacts. With artifactId, reads a slice. With pattern, grep-searches one artifact or all current-run artifacts.",
          execute: async (args) => this.read(parseReadArgs(args)),
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
    artifactId: string,
    options: NaniteToolOutputArtifactReadInput = {},
  ): Promise<NaniteToolOutputArtifactReadSliceResult> {
    const artifact = await this.#loadArtifact(artifactId);

    const offset = Math.min(Math.max(options.offset ?? 0, 0), artifact.value.length);
    const maxChars = clampInteger(options.maxChars, 24_000, 1, 100_000);
    const content = artifact.value.slice(offset, offset + maxChars);
    return {
      action: "read",
      artifact: toInfo(artifact.metadata),
      offset,
      maxChars,
      content,
      returnedChars: content.length,
      totalChars: artifact.value.length,
      truncated: offset + content.length < artifact.value.length,
    };
  }

  async #grep(
    input: NaniteToolOutputArtifactReadInput,
  ): Promise<NaniteToolOutputArtifactGrepResult> {
    const pattern = input.pattern;
    if (!pattern) {
      throw new Error("artifact_read pattern must be a non-empty string when grep-searching.");
    }

    const artifacts = input.artifactId
      ? [await this.info(input.artifactId)]
      : await this.list(input.listLimit ?? 25);
    const matchLimit = clampInteger(input.matchLimit, 50, 1, 500);
    const contextLines = clampInteger(input.contextLines, 0, 0, 10);
    const matches: NaniteToolOutputArtifactGrepResult["matches"] = [];
    const toResult = (truncated: boolean): NaniteToolOutputArtifactGrepResult => ({
      action: "grep",
      pattern,
      regex: input.regex ?? false,
      caseSensitive: input.caseSensitive ?? false,
      matches,
      truncated,
    });

    for (const artifact of artifacts) {
      const stored = await this.#loadArtifact(artifact.artifactId);
      const lines = stored.value.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!includesPattern(line, pattern, input)) {
          continue;
        }

        const beforeStart = Math.max(index - contextLines, 0);
        const afterEnd = Math.min(index + contextLines + 1, lines.length);
        matches.push({
          artifact,
          line: index + 1,
          text: truncateMatchText(line),
          before: lineContext(lines, beforeStart, index, beforeStart + 1),
          after: lineContext(lines, index + 1, afterEnd, index + 2),
        });

        if (matches.length >= matchLimit) {
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
      throw new Error(`Tool output artifact ${artifactId} was not found or has expired.`);
    }
    return { value: result.value, metadata: result.metadata };
  }

  #requireScope(): RequiredArtifactScope {
    if (!this.#runId) {
      throw new Error("Tool output artifacts require an active Nanite run.");
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

function parseReadArgs(input: unknown): NaniteToolOutputArtifactReadInput {
  return artifactReadInputSchema.parse(input);
}
