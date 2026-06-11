import { AppError } from "#/backend/errors.ts";

const DEFAULT_SIGVELO_AGENT_MODEL_ID = "@cf/moonshotai/kimi-k2.6";
const DEFAULT_NANITES_MODEL_GATEWAY_ID = "default";
const NANITES_MODEL_ID_PATTERN =
  /^(?:@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/i;

export type NanitesRuntimeModelSettings = {
  readonly provider: string;
  readonly providerLabel: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly gatewayId: string;
};

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

export async function validateNanitesModelId(_env: Env, modelId: string): Promise<string> {
  const cleanModelId = modelId.trim();
  if (!cleanModelId) {
    throw new AppError("nanitesModelSelectionInvalid", {
      details: { reason: "Nanite model id is required.", modelId },
    });
  }

  if (NANITES_MODEL_ID_PATTERN.test(cleanModelId)) {
    return cleanModelId;
  }

  throw new AppError("nanitesModelSelectionInvalid", {
    details: {
      reason:
        "Model id must be a Workers AI id like @cf/author/model or provider-native id like author/model.",
      modelId,
    },
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
