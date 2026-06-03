import { createWorker } from "@cloudflare/worker-bundler";

type TriggerDispatchInputScalar = string | number | boolean | null;
type TriggerDispatchInputValue = TriggerDispatchInputScalar | TriggerDispatchInputScalar[];

export type TriggerDispatchInput = Record<string, TriggerDispatchInputValue>;

type TriggerIntent =
  | {
      type: "dispatch_self";
      input: TriggerDispatchInput;
    }
  | {
      type: "noop";
      reason: string;
    };

export type TriggerDispatchIntent = Extract<TriggerIntent, { type: "dispatch_self" }>;

type TriggerExecutionResult =
  | {
      ok: true;
      intents: TriggerIntent[];
    }
  | {
      ok: false;
      error: string;
    };

type TriggerFailurePhase =
  | "static"
  | "bundle"
  | "load"
  | "execute"
  | "response"
  | "parse"
  | "normalize";

type GeneratedTriggerValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

export type RunGeneratedTriggerInput = {
  loader: WorkerLoader;
  sourceCode: string;
  event: unknown;
  cacheKey: string;
};

const MAX_GENERATED_TRIGGER_SOURCE_BYTES = 64 * 1024;

const forbiddenStaticTriggerPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\beval\s*\(/,
    reason: "Generated triggers cannot use eval(); write explicit TypeScript instead.",
  },
  {
    pattern: /\bnew\s+Function\s*\(/,
    reason: "Generated triggers cannot construct functions dynamically.",
  },
  {
    pattern: /\bWebAssembly\.(?:compile|instantiate|compileStreaming|instantiateStreaming)\b/,
    reason: "Generated triggers cannot compile or instantiate WebAssembly at runtime.",
  },
  {
    pattern:
      /(?:from\s+["']node:(?:fs|child_process|cluster|dgram|net|readline|repl|tls|worker_threads)["']|import\s*\(\s*["']node:(?:fs|child_process|cluster|dgram|net|readline|repl|tls|worker_threads)["']\s*\))/,
    reason: "Generated triggers cannot import Node.js process, filesystem, or networking modules.",
  },
];

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function describeErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : typeof error;
}

function formatTriggerError(input: {
  phase: TriggerFailurePhase;
  error: unknown;
  cacheKey: string;
  sourceCode: string;
  responseStatus?: number;
  responseText?: string;
}): string {
  const details = [
    `phase=${input.phase}`,
    `errorType=${describeErrorName(input.error)}`,
    `message=${describeError(input.error)}`,
    `cacheKey=${input.cacheKey}`,
    `sourceBytes=${new TextEncoder().encode(input.sourceCode).byteLength}`,
  ];

  if (input.responseStatus !== undefined) {
    details.push(`responseStatus=${input.responseStatus}`);
  }

  if (input.responseText) {
    details.push(`responseText=${input.responseText.slice(0, 500)}`);
  }

  return details.join("; ");
}

function validateGeneratedTriggerSourceStatically({
  sourceCode,
  cacheKey,
}: RunGeneratedTriggerInput): GeneratedTriggerValidationResult {
  const sourceBytes = new TextEncoder().encode(sourceCode).byteLength;
  if (sourceBytes === 0) {
    return {
      ok: false,
      error: formatTriggerError({
        phase: "static",
        error: "Generated trigger source cannot be empty.",
        cacheKey,
        sourceCode,
      }),
    };
  }

  if (sourceBytes > MAX_GENERATED_TRIGGER_SOURCE_BYTES) {
    return {
      ok: false,
      error: formatTriggerError({
        phase: "static",
        error: `Generated trigger source is ${sourceBytes} bytes; maximum is ${MAX_GENERATED_TRIGGER_SOURCE_BYTES} bytes.`,
        cacheKey,
        sourceCode,
      }),
    };
  }

  const forbiddenPattern = forbiddenStaticTriggerPatterns.find(({ pattern }) =>
    pattern.test(sourceCode),
  );
  if (forbiddenPattern) {
    return {
      ok: false,
      error: formatTriggerError({
        phase: "static",
        error: forbiddenPattern.reason,
        cacheKey,
        sourceCode,
      }),
    };
  }

  return { ok: true };
}

const triggerWorkerRuntimeSource = `
import trigger from "./trigger.ts";

function toIntentList(result) {
  if (result === null || result === undefined) {
    return [{ type: "noop", reason: "Trigger returned no intent." }];
  }
  if (Array.isArray(result)) {
    return result;
  }
  return [result];
}

function createContext() {
  return {
    dispatchSelf(input = {}) {
      return { type: "dispatch_self", input };
    },
    noop(reason) {
      return { type: "noop", reason };
    },
    record(message, data) {
      return {
        type: "noop",
        reason: data === undefined ? message : JSON.stringify({ message, data }),
      };
    },
  };
}

function describeGeneratedTriggerError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function generatedTriggerErrorResponse(error, status = 500) {
  return Response.json({ error: describeGeneratedTriggerError(error) }, { status });
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (!trigger || typeof trigger.handle !== "function") {
      return generatedTriggerErrorResponse(
        "Generated TypeScript trigger must export default { handle(event, ctx) }.",
        400,
      );
    }

    if (request.headers.get("x-sigvelo-trigger-validation") === "1") {
      return Response.json({ ok: true });
    }

    try {
      const event = await request.json();
      const result = await trigger.handle(event, createContext());
      return Response.json({ intents: toIntentList(result) });
    } catch (error) {
      return generatedTriggerErrorResponse(error);
    }
  },
};
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDispatchInputValue(value: unknown): TriggerDispatchInputValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = toDispatchInputValue(item);
      return Array.isArray(normalized) ? JSON.stringify(normalized) : normalized;
    });
  }

  return JSON.stringify(value);
}

function toDispatchInput(value: unknown): TriggerDispatchInput {
  const serialized = JSON.parse(JSON.stringify(value ?? {})) as unknown;
  if (!isRecord(serialized)) {
    return { value: toDispatchInputValue(serialized) };
  }

  return Object.fromEntries(
    Object.entries(serialized).map(([key, nestedValue]) => [
      key,
      toDispatchInputValue(nestedValue),
    ]),
  );
}

function normalizeIntent(value: unknown): TriggerIntent | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "dispatch_self": {
      return {
        type: "dispatch_self",
        input: toDispatchInput(value.input),
      };
    }
    case "noop":
      return {
        type: "noop",
        reason: typeof value.reason === "string" ? value.reason : "No-op.",
      };
    default:
      return null;
  }
}

export function getDispatchIntents(intents: readonly TriggerIntent[]): TriggerDispatchIntent[] {
  return intents.filter(
    (intent): intent is TriggerDispatchIntent => intent.type === "dispatch_self",
  );
}

async function loadGeneratedTriggerWorker(input: RunGeneratedTriggerInput) {
  return input.loader.get(input.cacheKey, async () => {
    let bundledWorker: Awaited<ReturnType<typeof createWorker>>;
    try {
      bundledWorker = await createWorker({
        files: {
          "src/index.ts": triggerWorkerRuntimeSource,
          "src/trigger.ts": input.sourceCode,
        },
        bundle: true,
        minify: false,
      });
    } catch (error) {
      throw new Error(
        formatTriggerError({
          phase: "bundle",
          error,
          cacheKey: input.cacheKey,
          sourceCode: input.sourceCode,
        }),
      );
    }

    const { mainModule, modules, wranglerConfig } = bundledWorker;

    return {
      mainModule,
      modules: modules as Record<string, string>,
      compatibilityDate: wranglerConfig?.compatibilityDate ?? "2026-03-02",
      compatibilityFlags: wranglerConfig?.compatibilityFlags ?? ["nodejs_compat"],
      globalOutbound: null,
    };
  });
}

type GeneratedTriggerWorkerResponse =
  | {
      ok: true;
      response: Response;
    }
  | {
      ok: false;
      error: string;
    };

async function requestGeneratedTriggerWorker(
  input: RunGeneratedTriggerInput,
  request: Request,
): Promise<GeneratedTriggerWorkerResponse> {
  const staticValidation = validateGeneratedTriggerSourceStatically(input);
  if (!staticValidation.ok) {
    return staticValidation;
  }

  let worker: Awaited<ReturnType<WorkerLoader["get"]>>;
  try {
    worker = await loadGeneratedTriggerWorker(input);
  } catch (error) {
    return {
      ok: false,
      error: formatTriggerError({
        phase: "load",
        error,
        cacheKey: input.cacheKey,
        sourceCode: input.sourceCode,
      }),
    };
  }

  try {
    const response = await worker.getEntrypoint().fetch(request);
    if (response.ok) {
      return { ok: true, response };
    }

    const responseText = await response.text();
    return {
      ok: false,
      error: formatTriggerError({
        phase: "response",
        error: responseText || response.statusText,
        cacheKey: input.cacheKey,
        sourceCode: input.sourceCode,
        responseStatus: response.status,
        responseText,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: formatTriggerError({
        phase: "execute",
        error,
        cacheKey: input.cacheKey,
        sourceCode: input.sourceCode,
      }),
    };
  }
}

export async function validateGeneratedTriggerSource(
  input: RunGeneratedTriggerInput,
): Promise<GeneratedTriggerValidationResult> {
  const result = await requestGeneratedTriggerWorker(
    input,
    new Request("https://sigvelo-trigger.local/", {
      method: "POST",
      headers: { "x-sigvelo-trigger-validation": "1" },
    }),
  );

  return result.ok ? { ok: true } : result;
}

export async function runGeneratedTrigger(
  input: RunGeneratedTriggerInput,
): Promise<TriggerExecutionResult> {
  const result = await requestGeneratedTriggerWorker(
    input,
    new Request("https://sigvelo-trigger.local/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.event),
    }),
  );
  if (!result.ok) {
    return result;
  }

  const { response } = result;

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return {
      ok: false,
      error: formatTriggerError({
        phase: "parse",
        error,
        cacheKey: input.cacheKey,
        sourceCode: input.sourceCode,
        responseStatus: response.status,
      }),
    };
  }

  try {
    const rawIntents = isRecord(body) && Array.isArray(body.intents) ? body.intents : [];
    const intents = rawIntents.flatMap((intent) => {
      const normalized = normalizeIntent(intent);
      return normalized ? [normalized] : [];
    });

    return { ok: true, intents };
  } catch (error) {
    return {
      ok: false,
      error: formatTriggerError({
        phase: "normalize",
        error,
        cacheKey: input.cacheKey,
        sourceCode: input.sourceCode,
        responseStatus: response.status,
      }),
    };
  }
}
