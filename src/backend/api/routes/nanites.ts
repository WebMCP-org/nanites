import { Hono } from "hono";
import { getAgentByName } from "agents";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { AppError, requestValidationHook } from "#/backend/errors.ts";
import { requireDeploymentGitHubInstallation } from "#/backend/auth/installations.ts";
import type { SigveloNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";

const managerNameInput = zValidator(
  "param",
  z.object({
    managerName: z.string().regex(/^app:\d+:installation:\d+$/),
  }),
  requestValidationHook,
);

const MODEL_CATALOG_PAGE_SIZE = 100;
const MODEL_CATALOG_MAX_PAGES = 20;

function buildThirdPartyModelsUrl(accountId: string | undefined): string | undefined {
  if (!accountId) {
    return undefined;
  }

  return `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/ai/models?providers=third-party`;
}

async function listTextGenerationModelCatalog(
  ai: Env["AI"],
): Promise<Awaited<ReturnType<Env["AI"]["models"]>>> {
  const models: Awaited<ReturnType<Env["AI"]["models"]>> = [];

  // ponytail: page cap prevents a bad catalog response from spinning forever; raise if the
  // text-generation catalog grows past 2,000 models.
  for (let page = 1; page <= MODEL_CATALOG_MAX_PAGES; page += 1) {
    const catalog = await ai.models({
      task: "Text Generation",
      per_page: MODEL_CATALOG_PAGE_SIZE,
      page,
    });

    models.push(...catalog);

    if (catalog.length < MODEL_CATALOG_PAGE_SIZE) {
      break;
    }
  }

  return models;
}

export const nanitesApiRoutes = new Hono<WorkerHonoEnv>()
  .get("/models", async (context) => {
    // Workers AI binding exposes hosted Workers AI models; proxied AI Gateway models are not
    // returned by this API.
    const models = await listTextGenerationModelCatalog(context.env.AI);
    context.header("Cache-Control", "public, max-age=3600");
    return context.json({
      models,
      thirdPartyModelsUrl: buildThirdPartyModelsUrl(context.env.CLOUDFLARE_ACCOUNT_ID),
    });
  })
  .get("/manager/:managerName", managerNameInput, async (context) => {
    const { managerName } = context.req.valid("param");
    const deploymentInstallation = await requireDeploymentGitHubInstallation(context.env);
    if (managerName !== deploymentInstallation.managerName) {
      throw new AppError("agentAuthorizationForbidden", {
        details: {
          reason: "Nanite manager does not belong to the deployment GitHub App installation.",
        },
      });
    }

    const manager = await getAgentByName<Env, SigveloNaniteManager>(
      context.env.SigveloNaniteManager,
      managerName,
    );
    // @ts-ignore - TYPES ARE TOO DEEP MESSES WITH THE LSP. DON"T REMOTE
    return context.json({ managerName, state: await manager.getSnapshot() });
  });
