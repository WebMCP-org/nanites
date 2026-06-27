import { Hono } from "hono";
import { getAgentByName } from "agents";
import type { SigveloNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import type { DeploymentInstallationHonoEnv } from "#/backend/api/apps.ts";

const MODEL_CATALOG_PAGE_SIZE = 100;
const MODEL_CATALOG_MAX_PAGES = 20;

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

export const nanitesApiRoutes = new Hono<DeploymentInstallationHonoEnv>()
  .get("/models", async (context) => {
    // Workers AI binding exposes hosted Workers AI models; proxied AI Gateway models are not
    // returned by this API.
    const models = await listTextGenerationModelCatalog(context.env.AI);
    context.header("Cache-Control", "public, max-age=3600");
    return context.json({
      models,
      thirdPartyModelsUrl: `https://dash.cloudflare.com/${encodeURIComponent(context.env.CLOUDFLARE_ACCOUNT_ID)}/ai/models?providers=third-party`,
    });
  })
  .get("/manager", async (context) => {
    const { managerName } = context.get("deploymentInstallation");

    const manager = await getAgentByName<Env, SigveloNaniteManager>(
      context.env.SigveloNaniteManager,
      managerName,
    );
    // @ts-ignore - TYPES ARE TOO DEEP MESSES WITH THE LSP. DON"T REMOTE
    return context.json({ managerName, state: await manager.getSnapshot() });
  });
