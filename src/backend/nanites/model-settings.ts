import { z } from "zod";
import { AppError } from "#/backend/errors.ts";

const defaultCatalogPageSize = 200;

const DEFAULT_SIGVELO_AGENT_MODEL_ID = "@cf/moonshotai/kimi-k2.6";
const DEFAULT_NANITES_MODEL_GATEWAY_ID = "default";
const FUNCTION_CALLING_CAPABILITY = "Function calling";

export type NanitesModelSource = "cloudflare-hosted" | "third-party";

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

export type NanitesRuntimeModelSettings = {
  readonly provider: string;
  readonly providerLabel: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly gatewayId: string;
};

type CloudflareAiModelsApi = {
  models?: (params?: { hide_experimental?: boolean; per_page?: number }) => Promise<unknown>;
};

const cloudflareModelSearchPropertySchema = z
  .object({
    property_id: z.string().trim().min(1),
    value: z.union([z.string(), z.number()]),
  })
  .passthrough();

const cloudflareModelSearchResultSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z
      .string()
      .nullable()
      .default("")
      .transform((value) => value ?? ""),
    task: z
      .object({
        name: z.string().trim().min(1),
      })
      .passthrough(),
    tags: z.array(z.string()).default([]),
    properties: z.array(cloudflareModelSearchPropertySchema).default([]),
  })
  .passthrough();

const cloudflareModelSearchResponseSchema = z.array(z.unknown());

const providerNativeModelIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/i);

type CloudflareModelSearchResult = z.output<typeof cloudflareModelSearchResultSchema>;
type CloudflareModelSearchProperty = z.output<typeof cloudflareModelSearchPropertySchema>;

export const DEFAULT_SIGVELO_AGENT_MODEL_SETTINGS = {
  provider: "kimi",
  providerLabel: "Moonshot AI",
  modelId: DEFAULT_SIGVELO_AGENT_MODEL_ID,
  modelName: "Kimi K2.6",
  gatewayId: DEFAULT_NANITES_MODEL_GATEWAY_ID,
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
  "google-ai-studio": "google",
  moonshotai: "kimi",
};

function cleanOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

function modelNameFromId(modelId: string): string {
  const name = modelId
    .split("/")
    .at(-1)!
    .replaceAll("-", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

  return name.replace(/\bDeepseek\b/g, "DeepSeek");
}

function looksLikeModelId(value: string): boolean {
  return (
    value.startsWith("@cf/") ||
    value.startsWith("@hf/") ||
    /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*/i.test(value)
  );
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

function parseContextWindow(properties: readonly CloudflareModelSearchProperty[]): number | null {
  for (const property of properties) {
    const key = property.property_id.toLowerCase();
    if (!key.includes("context")) {
      continue;
    }
    const raw = String(property.value);
    const numeric = Number(raw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric);
    }
  }

  return null;
}

function parseCloudflareModelSearchResults(input: unknown): CloudflareModelSearchResult[] {
  const response = cloudflareModelSearchResponseSchema.safeParse(input);
  if (!response.success) {
    return [];
  }

  return response.data.flatMap((item) => {
    const result = cloudflareModelSearchResultSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

function toCatalogItem(model: CloudflareModelSearchResult): NanitesModelCatalogItem | null {
  const task = model.task.name;
  if (task !== "Text Generation") {
    return null;
  }

  const id = [model.name, model.id]
    .map((value) => value.trim())
    .find((candidate) => looksLikeModelId(candidate));
  if (!id) {
    return null;
  }
  const provider = inferProvider(id);
  const tags = [...new Set(model.tags)];
  const displayName = model.name.trim();
  const name =
    displayName && displayName !== id && !looksLikeModelId(displayName)
      ? displayName
      : modelNameFromId(id);
  const capabilities = tags.filter(
    (tag) => tag !== "Cloudflare-hosted" && tag !== "Third-party" && tag !== "Beta",
  );

  return {
    id,
    name,
    provider,
    providerLabel: providerLabel(provider),
    source: inferSource(id),
    task,
    description: model.description,
    capabilities,
    contextWindowTokens: parseContextWindow(model.properties),
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

  const models = parseCloudflareModelSearchResults(
    await ai.models({
      hide_experimental: true,
      per_page: defaultCatalogPageSize,
    }),
  );

  return {
    fetchedAt,
    models: sortCatalogModels(
      models.map(toCatalogItem).filter((model): model is NanitesModelCatalogItem => Boolean(model)),
    ),
  };
}

export async function validateNanitesModelId(env: Env, modelId: string): Promise<string> {
  const cleanModelId = modelId.trim();
  if (!cleanModelId) {
    throw new AppError("nanitesModelSelectionInvalid", {
      details: { reason: "Nanite model id is required.", modelId },
    });
  }

  const catalog = await fetchNanitesModelCatalog(env);
  const model = catalog.models.find((candidate) => candidate.id === cleanModelId);
  if (model) {
    if (!model.capabilities.includes(FUNCTION_CALLING_CAPABILITY)) {
      throw new AppError("nanitesModelSelectionInvalid", {
        details: {
          reason: "Model must support function calling so Nanites can use runtime tools.",
          modelId,
        },
      });
    }

    return cleanModelId;
  }

  if (providerNativeModelIdSchema.safeParse(cleanModelId).success) {
    return cleanModelId;
  }

  throw new AppError("nanitesModelSelectionInvalid", {
    details: { reason: "Model is not available in the Cloudflare catalog.", modelId },
  });
}

export function resolveDefaultSigveloAgentModelSettings(env: Env): NanitesRuntimeModelSettings {
  return {
    ...DEFAULT_SIGVELO_AGENT_MODEL_SETTINGS,
    gatewayId: deploymentGatewayId(env),
  };
}

export function resolveNanitesModelSettings(
  env: Env,
  modelId: string,
): NanitesRuntimeModelSettings {
  const cleanModelId = modelId.trim();
  const provider = inferProvider(cleanModelId);

  return {
    provider,
    providerLabel: providerLabel(provider),
    modelId: cleanModelId,
    modelName: modelNameFromId(cleanModelId),
    gatewayId: deploymentGatewayId(env),
  };
}
