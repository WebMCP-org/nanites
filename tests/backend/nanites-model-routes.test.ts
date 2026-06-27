import { env } from "cloudflare:test";
import { nanitesHttpApp } from "#/backend/api/apps.ts";
import {
  buildTestBrowserAuthCookieHeader,
  ensureD1BaselineSchema,
  seedTestDeploymentInstallation,
} from "../helpers/d1-baseline.ts";
import { mockGitHubVisibleInstallations } from "../helpers/github-api-mock.ts";

const TEST_INSTALLATION_ID = 122769206;

beforeEach(async () => {
  await ensureD1BaselineSchema(env.DB);
  await env.DB.exec("DELETE FROM account_repositories;");
  await env.DB.exec("DELETE FROM account_installations;");
  await env.DB.exec("DELETE FROM accounts;");
});

function buildModelEntry(id: string, name: string) {
  return {
    id,
    name,
    description: "",
    source: 1,
    task: { id: "text-generation", name: "Text Generation", description: "" },
    tags: [],
    properties: [],
  };
}

function envWithModelPages(
  pages: Record<number, readonly ReturnType<typeof buildModelEntry>[]>,
  calls: { page?: number; per_page?: number; task?: string }[],
) {
  const testEnv = { ...env } as Env;
  Reflect.set(testEnv, "AI", {
    models: async (params?: {
      readonly page?: number;
      readonly per_page?: number;
      readonly task?: string;
    }) => {
      calls.push({ page: params?.page, per_page: params?.per_page, task: params?.task });
      return pages[params?.page ?? 1] ?? [];
    },
  } as unknown as Env["AI"]);
  return testEnv;
}

test("GET /api/nanites/models paginates and returns the model catalog", async () => {
  await seedTestDeploymentInstallation(env.DB, { githubInstallationId: TEST_INSTALLATION_ID });
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    buildModelEntry(`model-${index}`, `@cf/moonshotai/kimi-${index}`),
  );
  const calls: { page?: number; per_page?: number; task?: string }[] = [];
  const testEnv = envWithModelPages(
    {
      1: firstPage,
      2: [
        buildModelEntry("model-openai", "@cf/openai/gpt-oss-120b"),
        buildModelEntry("model-meta", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      ],
    },
    calls,
  );
  const request = new Request("https://nanites.test/api/nanites/models");
  const restore = mockGitHubVisibleInstallations([{ id: TEST_INSTALLATION_ID }]);

  try {
    const response = await nanitesHttpApp.fetch(
      new Request(request, {
        headers: {
          Cookie: await buildTestBrowserAuthCookieHeader(env, request, {
            githubViewer: { id: 94631653, login: "MiguelsPizza" },
          }),
        },
      }),
      testEnv,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly models: readonly ReturnType<typeof buildModelEntry>[];
      readonly proxiedModels?: unknown;
      readonly groups?: unknown;
      readonly thirdPartyModelsUrl?: unknown;
    };

    expect(body.models).toHaveLength(102);
    expect(body.models.at(-2)).toEqual(buildModelEntry("model-openai", "@cf/openai/gpt-oss-120b"));
    expect(body.models.at(-1)).toEqual(
      buildModelEntry("model-meta", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
    );
    expect(body.thirdPartyModelsUrl).toBe(
      "https://dash.cloudflare.com/test-account/ai/models?providers=third-party",
    );
    expect(body.proxiedModels).toBeUndefined();
    expect(body.groups).toBeUndefined();
    expect(calls).toEqual([
      { page: 1, per_page: 100, task: "Text Generation" },
      { page: 2, per_page: 100, task: "Text Generation" },
    ]);
  } finally {
    restore();
  }
});
