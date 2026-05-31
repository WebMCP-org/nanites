import { NaniteToolOutputArtifactStore } from "#/backend/nanites/tool-output-artifacts.ts";

type StoredValue = {
  value: string;
  metadata: unknown;
};

function createFakeKvNamespace(): KVNamespace {
  const values = new Map<string, StoredValue>();
  return {
    put: async (key: string, value: string, options?: KVNamespacePutOptions) => {
      values.set(key, {
        value,
        metadata: options?.metadata,
      });
    },
    getWithMetadata: async (key: string) => {
      const stored = values.get(key);
      return {
        value: stored?.value ?? null,
        metadata: stored?.metadata ?? null,
        cacheStatus: null,
      };
    },
    list: async ({ prefix, limit }: KVNamespaceListOptions = {}) => {
      const keys = Array.from(values.entries())
        .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
        .slice(0, limit ?? 1_000)
        .map(([name, stored]) => ({
          name,
          metadata: stored.metadata,
        }));

      return {
        list_complete: true,
        keys,
        cacheStatus: null,
      };
    },
  } as unknown as KVNamespace;
}

test("Nanite tool output artifact store writes opaque TTL-backed artifacts", async () => {
  const store = new NaniteToolOutputArtifactStore({
    kv: createFakeKvNamespace(),
    managerName: "installation:1",
    naniteId: "docs-syncer",
    naniteName: "docs-syncer",
    runId: "run-1",
    ttlSeconds: 60,
  });

  const persisted = await store.persist({
    toolName: "execute",
    toolCallId: "call-1",
    content: "alpha\nneedle\nomega",
    extension: "txt",
  });

  expect(persisted.artifactId).toMatch(/^toolout_[a-f0-9]{32}$/);

  await expect(store.info(persisted.artifactId)).resolves.toMatchObject({
    artifactId: persisted.artifactId,
    runId: "run-1",
    toolName: "execute",
    toolCallId: "call-1",
    size: 18,
    contentType: "text/plain",
    expired: false,
  });

  await expect(
    store.read({ artifactId: persisted.artifactId, offset: 6, maxChars: 6 }),
  ).resolves.toMatchObject({
    action: "read",
    content: "needle",
    offset: 6,
    returnedChars: 6,
    totalChars: 18,
    truncated: true,
  });

  await expect(
    store.read({ artifactId: persisted.artifactId, pattern: "needle" }),
  ).resolves.toMatchObject({
    action: "grep",
    matches: [{ line: 2, text: "needle" }],
  });

  await expect(store.read()).resolves.toMatchObject({
    action: "list",
    artifacts: [
      {
        artifactId: persisted.artifactId,
        runId: "run-1",
      },
    ],
  });
});
