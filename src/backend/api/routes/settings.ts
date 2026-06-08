import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { activeGithubInstallationRequired } from "#/backend/api/routes/auth.ts";
import { createDbClient } from "#/backend/db/index.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import {
  fetchNanitesModelCatalog,
  recordInstallationModelSmokeTest,
  readInstallationModelSettings,
  saveInstallationModelSettings,
  smokeTestNanitesModel,
} from "#/backend/nanites/model-settings.ts";

const modelSettingsInput = zValidator(
  "json",
  z.object({
    modelId: z.string().min(1).max(200),
    gatewayId: z.string().min(1).max(80).optional().nullable(),
    byokAlias: z.string().max(120).optional().nullable(),
  }),
);

export const settingsApiRoutes = new Hono<WorkerHonoEnv>()
  .get("/model", activeGithubInstallationRequired, async (context) => {
    const db = createDbClient(context.env.DB);
    const githubInstallationId = context.get("activeGithubInstallationId");
    const [catalog, settings] = await Promise.all([
      fetchNanitesModelCatalog(context.env),
      readInstallationModelSettings(db, githubInstallationId),
    ]);

    return context.json({
      catalog,
      settings,
    });
  })
  .put("/model", modelSettingsInput, activeGithubInstallationRequired, async (context) => {
    const db = createDbClient(context.env.DB);
    const githubInstallationId = context.get("activeGithubInstallationId");
    const session = context.get("browserSession");
    const activeInstallation = session.sessionInstallationSnapshot;
    const input = context.req.valid("json");

    const settings = await saveInstallationModelSettings(db, context.env, {
      githubInstallationId,
      accountId: activeInstallation?.account.id
        ? `github-account:${activeInstallation.account.id}`
        : null,
      modelId: input.modelId,
      gatewayId: input.gatewayId,
      byokAlias: input.byokAlias,
      actorGithubUserId: session.githubViewer.id,
      actorGithubLogin: session.githubViewer.login,
    });

    return context.json({ settings });
  })
  .post("/model/test", modelSettingsInput, activeGithubInstallationRequired, async (context) => {
    const db = createDbClient(context.env.DB);
    const githubInstallationId = context.get("activeGithubInstallationId");
    const input = context.req.valid("json");
    const result = await smokeTestNanitesModel({
      env: context.env,
      modelId: input.modelId,
      gatewayId: input.gatewayId,
      byokAlias: input.byokAlias,
    });

    await recordInstallationModelSmokeTest(db, {
      githubInstallationId,
      modelId: input.modelId,
      gatewayId: input.gatewayId,
      byokAlias: input.byokAlias,
      result,
    });

    return context.json({ result });
  });
