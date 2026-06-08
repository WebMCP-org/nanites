import { eq } from "drizzle-orm";
import type { DbClient } from "#/backend/db/index.ts";
import { MODEL_TEST_STATUSES, installationModelSettings } from "#/backend/db/schema.ts";
import { AppError, describeError } from "#/backend/errors.ts";

const smokePrompt = "Reply with exactly: ok";
const defaultCatalogPageSize = 200;

export const DEFAULT_NANITES_MODEL_ID = "deepseek/deepseek-v4-pro";
export const DEFAULT_NANITES_MODEL_GATEWAY_ID = "default";

export type NanitesModelSource = "cloudflare-hosted" | "third-party";
export type NanitesModelSettingsSource = "default" | "saved";
export type NanitesModelSmokeTestStatus = (typeof MODEL_TEST_STATUSES)[number];

export type NanitesModelCatalogItem = {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly providerLabel: string;
  readonly source: NanitesModelSource;
  readonly task: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly contextWindowTokens: number | null;
  readonly deprecated: boolean;
};

export type NanitesModelCatalog = {
  readonly fetchedAt: string;
  readonly models: readonly NanitesModelCatalogItem[];
};

export type InstallationModelSettings = {
  readonly githubInstallationId: number;
  readonly provider: string;
  readonly providerLabel: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly gatewayId: string;
  readonly byokAlias: string | null;
  readonly source: NanitesModelSettingsSource;
  readonly lastTestedAt: string | null;
  readonly lastTestStatus: NanitesModelSmokeTestStatus | null;
  readonly lastTestMessage: string | null;
  readonly lastTestLatencyMs: number | null;
  readonly updatedAt: string | null;
};

export type NanitesRuntimeModelSettings = {
  readonly provider: string;
  readonly providerLabel: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly gatewayId: string;
  readonly byokAlias: string | null;
};

export type SaveInstallationModelSettingsInput = {
  readonly githubInstallationId: number;
  readonly accountId: string | null;
  readonly modelId: string;
  readonly gatewayId?: string | null;
  readonly byokAlias?: string | null;
  readonly actorGithubUserId?: number | null;
  readonly actorGithubLogin?: string | null;
};

export type ModelSmokeTestInput = {
  readonly env: Env;
  readonly modelId: string;
  readonly gatewayId?: string | null;
  readonly byokAlias?: string | null;
};

export type ModelSmokeTestResult = {
  readonly status: NanitesModelSmokeTestStatus;
  readonly message: string;
  readonly latencyMs: number;
};

type CloudflareAiModelsApi = {
  models?: (params?: { hide_experimental?: boolean; per_page?: number }) => Promise<unknown[]>;
  run?: (
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
};

type CloudflareModelSearchObject = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  task?: {
    name?: unknown;
  };
  tags?: unknown;
  properties?: unknown;
};

export const DEFAULT_NANITES_MODEL_SETTINGS = {
  provider: "deepseek",
  providerLabel: "DeepSeek",
  modelId: DEFAULT_NANITES_MODEL_ID,
  modelName: "DeepSeek V4 Pro",
  gatewayId: DEFAULT_NANITES_MODEL_GATEWAY_ID,
  byokAlias: null,
} as const;

const providerLabels: Record<string, string> = {
  aisingapore: "AI Singapore",
  anthropic: "Anthropic",
  cloudflare: "Cloudflare",
  deepseek: "DeepSeek",
  google: "Google",
  "google-ai-studio": "Google AI Studio",
  kimi: "Moonshot AI",
  meta: "Meta",
  "ibm-granite": "IBM Granite",
  mistral: "Mistral AI",
  mistralai: "Mistral AI",
  moonshotai: "Moonshot AI",
  openai: "OpenAI",
  qwen: "Qwen",
  xai: "xAI",
};

const providerAliases: Record<string, string> = {
  "deepseek-ai": "deepseek",
  moonshotai: "kimi",
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function cleanOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanGatewayId(value: string | null | undefined): string {
  return cleanOptionalString(value) ?? DEFAULT_NANITES_MODEL_GATEWAY_ID;
}

function deploymentGatewayId(env: Env): string {
  return cleanOptionalString(env.NANITES_AI_GATEWAY_ID) ?? DEFAULT_NANITES_MODEL_GATEWAY_ID;
}

function providerLabel(provider: string): string {
  return (
    providerLabels[provider] ??
    provider.replaceAll("-", " ").replace(/\b\w/g, (match) => match.toUpperCase())
  );
}

function catalogModelName(id: string, name: string | null): string {
  if (name) {
    return name;
  }

  return id
    .split("/")
    .at(-1)!
    .replaceAll("-", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function looksLikeModelId(value: string): boolean {
  return (
    value.startsWith("@cf/") ||
    value.startsWith("@hf/") ||
    /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*/i.test(value)
  );
}

function readModelId(input: CloudflareModelSearchObject): string | null {
  const candidates = [input.name, input.id]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
  return candidates.find((candidate) => looksLikeModelId(candidate)) ?? null;
}

function readDisplayName(input: CloudflareModelSearchObject, modelId: string): string | null {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name === modelId || looksLikeModelId(name)) {
    return null;
  }
  return name;
}

function inferProvider(modelId: string): string {
  const segments = modelId.split("/");
  if (modelId.startsWith("@cf/")) {
    return providerSlug(segments.at(1));
  }

  return providerSlug(segments.at(0));
}

function providerSlug(value: string | undefined): string {
  const provider = value ?? "cloudflare";
  return providerAliases[provider] ?? provider.replace(/-ai$/, "");
}

function inferSource(modelId: string): NanitesModelSource {
  return modelId.startsWith("@cf/") || modelId.startsWith("@hf/")
    ? "cloudflare-hosted"
    : "third-party";
}

function parseContextWindow(properties: unknown): number | null {
  if (!Array.isArray(properties)) {
    return null;
  }

  for (const property of properties) {
    if (typeof property !== "object" || property === null) {
      continue;
    }
    const record = property as { property_id?: unknown; value?: unknown };
    const key = typeof record.property_id === "string" ? record.property_id.toLowerCase() : "";
    if (!key.includes("context")) {
      continue;
    }
    const raw = typeof record.value === "string" ? record.value : "";
    const numeric = Number(raw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric);
    }
  }

  return null;
}

function readTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [...new Set(tags.filter((tag): tag is string => typeof tag === "string"))];
}

function readCatalogItem(input: CloudflareModelSearchObject): NanitesModelCatalogItem | null {
  const task = typeof input.task?.name === "string" ? input.task.name : "";
  if (task !== "Text Generation") {
    return null;
  }

  const id = readModelId(input);
  if (!id) {
    return null;
  }
  const provider = inferProvider(id);
  const tags = readTags(input.tags);
  const capabilities = tags.filter(
    (tag) => tag !== "Cloudflare-hosted" && tag !== "Third-party" && tag !== "Beta",
  );

  return {
    id,
    name: catalogModelName(id, readDisplayName(input, id)),
    provider,
    providerLabel: providerLabel(provider),
    source: inferSource(id),
    task,
    description: typeof input.description === "string" ? input.description : "",
    capabilities,
    contextWindowTokens: parseContextWindow(input.properties),
    deprecated: tags.includes("Deprecated"),
  };
}

function sortCatalogModels(models: readonly NanitesModelCatalogItem[]): NanitesModelCatalogItem[] {
  const merged = new Map<string, NanitesModelCatalogItem>();
  for (const model of models) {
    if (!model.deprecated) {
      merged.set(model.id, model);
    }
  }

  return [...merged.values()].sort(
    (left, right) =>
      left.providerLabel.localeCompare(right.providerLabel) || left.name.localeCompare(right.name),
  );
}

export async function fetchNanitesModelCatalog(env: Env): Promise<NanitesModelCatalog> {
  const fetchedAt = new Date().toISOString();
  const ai = env.AI as CloudflareAiModelsApi | undefined;
  if (!ai?.models) {
    return {
      fetchedAt,
      models: [],
    };
  }

  const models = await ai.models({
    hide_experimental: true,
    per_page: defaultCatalogPageSize,
  });
  return {
    fetchedAt,
    models: sortCatalogModels(
      models
        .map((model) => readCatalogItem(model as CloudflareModelSearchObject))
        .filter((model): model is NanitesModelCatalogItem => Boolean(model)),
    ),
  };
}

function findCatalogModel(catalog: NanitesModelCatalog, modelId: string): NanitesModelCatalogItem {
  const model = catalog.models.find((candidate) => candidate.id === modelId);
  if (!model) {
    throw new AppError("nanitesModelSelectionInvalid", {
      details: { reason: "Model is not available in the Cloudflare catalog.", modelId },
    });
  }
  return model;
}

export function resolveDeploymentNanitesModelSettings(env: Env): NanitesRuntimeModelSettings {
  return {
    ...DEFAULT_NANITES_MODEL_SETTINGS,
    gatewayId: deploymentGatewayId(env),
  };
}

export async function resolveSelectedNanitesModelSettings(
  env: Env,
  modelId: string,
): Promise<NanitesRuntimeModelSettings> {
  const cleanModelId = modelId.trim();
  if (!cleanModelId) {
    throw new AppError("nanitesModelSelectionInvalid", {
      details: { reason: "Selected model id is required.", modelId },
    });
  }

  const model = findCatalogModel(await fetchNanitesModelCatalog(env), cleanModelId);
  return {
    provider: model.provider,
    providerLabel: model.providerLabel,
    modelId: cleanModelId,
    modelName: model.name,
    gatewayId: deploymentGatewayId(env),
    byokAlias: null,
  };
}

function defaultInstallationModelSettings(githubInstallationId: number): InstallationModelSettings {
  return {
    githubInstallationId,
    ...DEFAULT_NANITES_MODEL_SETTINGS,
    source: "default",
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestMessage: null,
    lastTestLatencyMs: null,
    updatedAt: null,
  };
}

export async function readInstallationModelSettings(
  db: DbClient,
  githubInstallationId: number,
): Promise<InstallationModelSettings> {
  const row = await db.query.installationModelSettings.findFirst({
    where: eq(installationModelSettings.githubInstallationId, githubInstallationId),
  });

  if (!row) {
    return defaultInstallationModelSettings(githubInstallationId);
  }

  return {
    githubInstallationId,
    provider: row.provider,
    providerLabel: row.providerLabel,
    modelId: row.modelId,
    modelName: row.modelName,
    gatewayId: row.gatewayId,
    byokAlias: row.byokAlias,
    source: "saved",
    lastTestedAt: toIso(row.lastTestedAt),
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    lastTestLatencyMs: row.lastTestLatencyMs,
    updatedAt: toIso(row.updatedAt),
  };
}

export async function saveInstallationModelSettings(
  db: DbClient,
  env: Env,
  input: SaveInstallationModelSettingsInput,
): Promise<InstallationModelSettings> {
  const modelId = input.modelId.trim();
  const gatewayId = cleanGatewayId(input.gatewayId);
  const byokAlias = cleanOptionalString(input.byokAlias);
  const model = findCatalogModel(await fetchNanitesModelCatalog(env), modelId);
  const now = new Date();

  await db
    .insert(installationModelSettings)
    .values({
      githubInstallationId: input.githubInstallationId,
      accountId: input.accountId,
      provider: model.provider,
      providerLabel: model.providerLabel,
      modelId,
      modelName: model.name,
      gatewayId,
      byokAlias,
      updatedByGithubUserId: input.actorGithubUserId ?? null,
      updatedByGithubLogin: input.actorGithubLogin ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: installationModelSettings.githubInstallationId,
      set: {
        accountId: input.accountId,
        provider: model.provider,
        providerLabel: model.providerLabel,
        modelId,
        modelName: model.name,
        gatewayId,
        byokAlias,
        updatedByGithubUserId: input.actorGithubUserId ?? null,
        updatedByGithubLogin: input.actorGithubLogin ?? null,
        updatedAt: now,
      },
    })
    .run();

  return readInstallationModelSettings(db, input.githubInstallationId);
}

export async function recordInstallationModelSmokeTest(
  db: DbClient,
  input: {
    readonly githubInstallationId: number;
    readonly modelId: string;
    readonly gatewayId?: string | null;
    readonly byokAlias?: string | null;
    readonly result: ModelSmokeTestResult;
  },
): Promise<void> {
  const gatewayId = cleanGatewayId(input.gatewayId);
  const byokAlias = cleanOptionalString(input.byokAlias);
  const current = await db.query.installationModelSettings.findFirst({
    where: eq(installationModelSettings.githubInstallationId, input.githubInstallationId),
  });
  if (
    !current ||
    current.modelId !== input.modelId ||
    current.gatewayId !== gatewayId ||
    current.byokAlias !== byokAlias
  ) {
    return;
  }
  const now = new Date();

  await db
    .update(installationModelSettings)
    .set({
      lastTestedAt: now,
      lastTestStatus: input.result.status,
      lastTestMessage: input.result.message,
      lastTestLatencyMs: input.result.latencyMs,
      updatedAt: now,
    })
    .where(eq(installationModelSettings.githubInstallationId, input.githubInstallationId))
    .run();
}

export async function smokeTestNanitesModel(
  input: ModelSmokeTestInput,
): Promise<ModelSmokeTestResult> {
  const modelId = input.modelId.trim();
  const gatewayId = cleanGatewayId(input.gatewayId);
  const byokAlias = cleanOptionalString(input.byokAlias);
  const ai = input.env.AI as CloudflareAiModelsApi | undefined;
  const startedAt = performance.now();

  if (!ai?.run) {
    return {
      status: "failure",
      message: "Cloudflare Workers AI binding is not available in this environment.",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  try {
    await ai.run(
      modelId,
      {
        messages: [{ role: "user", content: smokePrompt }],
        max_tokens: 8,
      },
      {
        gateway: {
          id: gatewayId,
          skipCache: true,
          metadata: {
            sigvelo_surface: "settings",
            sigvelo_action: "model_smoke_test",
          },
        },
        ...(byokAlias ? { extraHeaders: { "cf-aig-byok-alias": byokAlias } } : {}),
      },
    );

    return {
      status: "success",
      message: "Model responded through Cloudflare AI Gateway.",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      status: "failure",
      message: describeError(error),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
