import { and, eq, inArray } from "drizzle-orm";
import type { DbClient } from "#/backend/db/index.ts";
import {
  installationAiProviderKeys,
  KEYED_AI_PROVIDERS,
  type KeyedAiProvider,
} from "#/backend/db/schema.ts";

export type { KeyedAiProvider };

const keyEncryptionPurpose = "sigvelo:nanites:installation-ai-provider-key";
const keyEncryptionSalt = "sigvelo:nanites:provider-keys";

export const KEYED_AI_PROVIDER_OPTIONS = [
  { provider: "deepseek", label: "DeepSeek" },
  { provider: "openai", label: "OpenAI" },
  { provider: "anthropic", label: "Anthropic" },
  { provider: "google", label: "Google" },
] as const satisfies readonly { provider: KeyedAiProvider; label: string }[];

const keyedAiProviderSet = new Set<string>(KEYED_AI_PROVIDERS);
const textEncoder = new TextEncoder();

export type InstallationAiProviderKeySummary = {
  provider: KeyedAiProvider;
  keyLast4: string;
  updatedAt: Date;
};

export function isKeyedAiProvider(value: string): value is KeyedAiProvider {
  return keyedAiProviderSet.has(value);
}

export function keyLast4(apiKey: string): string {
  return apiKey.trim().slice(-4);
}

async function deriveProviderKeyEncryptionKey(env: Env): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(env.AUTH_COOKIE_SECRET),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: textEncoder.encode(keyEncryptionSalt),
      info: textEncoder.encode(keyEncryptionPurpose),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function sealProviderApiKey(env: Env, apiKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await deriveProviderKeyEncryptionKey(env),
      textEncoder.encode(apiKey),
    ),
  );
  const packed = new Uint8Array(iv.length + encrypted.length);
  packed.set(iv);
  packed.set(encrypted, iv.length);

  return Buffer.from(packed).toString("base64url");
}

export async function saveInstallationAiProviderKey({
  db,
  env,
  githubInstallationId,
  provider,
  apiKey,
}: {
  db: DbClient;
  env: Env;
  githubInstallationId: number;
  provider: KeyedAiProvider;
  apiKey: string;
}): Promise<InstallationAiProviderKeySummary> {
  const cleanApiKey = apiKey.trim();
  const now = new Date();
  const values = {
    githubInstallationId,
    provider,
    encryptedApiKey: await sealProviderApiKey(env, cleanApiKey),
    keyLast4: keyLast4(cleanApiKey),
    createdAt: now,
    updatedAt: now,
  };

  await db
    .insert(installationAiProviderKeys)
    .values(values)
    .onConflictDoUpdate({
      target: [
        installationAiProviderKeys.githubInstallationId,
        installationAiProviderKeys.provider,
      ],
      set: {
        encryptedApiKey: values.encryptedApiKey,
        keyLast4: values.keyLast4,
        updatedAt: values.updatedAt,
      },
    })
    .run();

  return {
    provider,
    keyLast4: values.keyLast4,
    updatedAt: values.updatedAt,
  };
}

export async function hasInstallationAiProviderKey(
  db: DbClient,
  githubInstallationId: number,
  provider: KeyedAiProvider,
): Promise<boolean> {
  const row = await db.query.installationAiProviderKeys.findFirst({
    columns: { provider: true },
    where: and(
      eq(installationAiProviderKeys.githubInstallationId, githubInstallationId),
      eq(installationAiProviderKeys.provider, provider),
    ),
  });

  return Boolean(row);
}

export async function listInstallationAiProviderKeySummaries(
  db: DbClient,
  githubInstallationIds: readonly number[],
): Promise<Map<number, InstallationAiProviderKeySummary[]>> {
  const uniqueIds = [...new Set(githubInstallationIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      githubInstallationId: installationAiProviderKeys.githubInstallationId,
      provider: installationAiProviderKeys.provider,
      keyLast4: installationAiProviderKeys.keyLast4,
      updatedAt: installationAiProviderKeys.updatedAt,
    })
    .from(installationAiProviderKeys)
    .where(inArray(installationAiProviderKeys.githubInstallationId, uniqueIds));

  const byInstallation = new Map<number, InstallationAiProviderKeySummary[]>();
  for (const row of rows) {
    const summaries = byInstallation.get(row.githubInstallationId) ?? [];
    summaries.push({
      provider: row.provider,
      keyLast4: row.keyLast4,
      updatedAt: row.updatedAt,
    });
    byInstallation.set(row.githubInstallationId, summaries);
  }

  return byInstallation;
}
