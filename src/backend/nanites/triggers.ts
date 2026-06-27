import { createWorker } from "@cloudflare/worker-bundler";
import { isRecord } from "#/shared/utils/values.ts";
import { APP_ERRORS, AppError } from "#/backend/errors.ts";

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

type TriggerDispatchIntent = Extract<TriggerIntent, { type: "dispatch_self" }>;
type TriggerNoopIntent = Extract<TriggerIntent, { type: "noop" }>;

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
  | "intent";

type GeneratedTriggerValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

type RunGeneratedTriggerInput = {
  loader: WorkerLoader;
  sourceCode: string;
  event: unknown;
  cacheKey: string;
};

const MAX_GENERATED_TRIGGER_SOURCE_BYTES = 64 * 1024;
const GENERATED_TRIGGER_ENTRYPOINT_PATH = "src/index.ts";
const GENERATED_TRIGGER_SOURCE_PATH = "src/trigger.ts";
const SIGVELO_TRIGGER_PACKAGE_NAME = "@sigvelo/nanite-trigger";
const SIGVELO_TRIGGER_PACKAGE_PATH = "node_modules/@sigvelo/nanite-trigger";

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

const sigveloTriggerPackageJson = JSON.stringify({
  name: SIGVELO_TRIGGER_PACKAGE_NAME,
  version: "0.0.0",
  type: "module",
  exports: {
    ".": {
      types: "./index.d.ts",
      import: "./index.js",
    },
  },
});

const sigveloTriggerRuntimeSource = `
export function defineGitHubTrigger(trigger) {
  return trigger;
}
`;

const sigveloTriggerTypesSource = `
import type {
  EmitterWebhookEvent,
  EmitterWebhookEventName,
} from "@octokit/webhooks";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";

export type { EmitterWebhookEvent, EmitterWebhookEventName, RestEndpointMethodTypes };

export type TriggerDispatchInputScalar = string | number | boolean | null;
export type TriggerDispatchInputValue =
  | TriggerDispatchInputScalar
  | readonly TriggerDispatchInputScalar[];
export type TriggerDispatchInput = Record<string, TriggerDispatchInputValue>;

export type TriggerDispatchIntent = {
  type: "dispatch_self";
  input: TriggerDispatchInput;
};

export type TriggerNoopIntent = {
  type: "noop";
  reason: string;
};

export type TriggerIntent = TriggerDispatchIntent | TriggerNoopIntent;
export type TriggerResult =
  | TriggerIntent
  | readonly TriggerIntent[]
  | null
  | undefined
  | void;

export type TriggerContext = {
  dispatchSelf(input?: TriggerDispatchInput): TriggerDispatchIntent;
  noop(reason: string): TriggerNoopIntent;
  record(message: string, data?: unknown): TriggerNoopIntent;
};

export type GitHubTriggerHandler<
  TEventName extends EmitterWebhookEventName = EmitterWebhookEventName,
> = (
  event: EmitterWebhookEvent<TEventName>,
  ctx: TriggerContext,
) => TriggerResult | Promise<TriggerResult>;

export type GitHubTriggerModule<
  TEventName extends EmitterWebhookEventName = EmitterWebhookEventName,
> = {
  handle: GitHubTriggerHandler<TEventName>;
};

export declare function defineGitHubTrigger<
  const TEventNames extends readonly EmitterWebhookEventName[],
>(
  trigger: {
    events: TEventNames;
    handle: GitHubTriggerHandler<TEventNames[number]>;
  },
): GitHubTriggerModule<TEventNames[number]> & { events: TEventNames };

export declare function defineGitHubTrigger<
  const TEventName extends EmitterWebhookEventName,
>(
  trigger: {
    event: TEventName;
    handle: GitHubTriggerHandler<TEventName>;
  },
): GitHubTriggerModule<TEventName> & { event: TEventName };

export declare function defineGitHubTrigger<
  TEventName extends EmitterWebhookEventName = EmitterWebhookEventName,
>(
  trigger: GitHubTriggerModule<TEventName>,
): GitHubTriggerModule<TEventName>;
`;

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
      const dispatchValue = toDispatchInputValue(item);
      return Array.isArray(dispatchValue) ? JSON.stringify(dispatchValue) : dispatchValue;
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

function parseTriggerIntent(value: unknown): TriggerIntent | null {
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

export function getNoopIntents(intents: readonly TriggerIntent[]): TriggerNoopIntent[] {
  return intents.filter((intent): intent is TriggerNoopIntent => intent.type === "noop");
}

async function loadGeneratedTriggerWorker(input: RunGeneratedTriggerInput) {
  return input.loader.get(input.cacheKey, async () => {
    let bundledWorker: Awaited<ReturnType<typeof createWorker>>;
    try {
      bundledWorker = await createWorker({
        files: {
          [GENERATED_TRIGGER_ENTRYPOINT_PATH]: triggerWorkerRuntimeSource,
          [GENERATED_TRIGGER_SOURCE_PATH]: input.sourceCode,
          [`${SIGVELO_TRIGGER_PACKAGE_PATH}/package.json`]: sigveloTriggerPackageJson,
          [`${SIGVELO_TRIGGER_PACKAGE_PATH}/index.d.ts`]: sigveloTriggerTypesSource,
          [`${SIGVELO_TRIGGER_PACKAGE_PATH}/index.js`]: sigveloTriggerRuntimeSource,
        },
        bundle: true,
        minify: false,
        sourcemap: true,
      });
    } catch (error) {
      const reason = formatTriggerError({
        phase: "bundle",
        error,
        cacheKey: input.cacheKey,
        sourceCode: input.sourceCode,
      });
      throw new AppError("generatedTriggerBundleFailed", {
        cause: error,
        details: { reason },
        message: `${APP_ERRORS.generatedTriggerBundleFailed.message}: ${reason}`,
      });
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
  const staticValidation = validateGeneratedTriggerSourceStatically(input);
  if (!staticValidation.ok) {
    return staticValidation;
  }

  // Full Octokit semantic typechecking exceeds Manager DO memory; bundling still catches syntax/import errors.
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

  const rawIntents = isRecord(body) && Array.isArray(body.intents) ? body.intents : [];
  const intents = rawIntents.flatMap((intent) => {
    const parsedIntent = parseTriggerIntent(intent);
    return parsedIntent ? [parsedIntent] : [];
  });

  return { ok: true, intents };
}
