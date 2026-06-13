import { Hono } from "hono";
import { getAgentByName } from "agents";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { AppError, requestValidationHook } from "#/backend/errors.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { requireBrowserInstallationScope } from "#/backend/auth/installations.ts";
import { requireDeploymentGitHubApp } from "#/backend/github/apps.ts";
import type { SigveloNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import { parseNaniteManagerKey } from "#/nanites.ts";

const managerNameInput = zValidator(
  "param",
  z.object({
    managerName: z.string().regex(/^app:\d+:installation:\d+$/),
  }),
  requestValidationHook,
);

export const nanitesApiRoutes = new Hono<WorkerHonoEnv>().get(
  "/manager/:managerName",
  managerNameInput,
  async (context) => {
    const { managerName } = context.req.valid("param");
    const managerIdentity = parseNaniteManagerKey(managerName);
    const deploymentGitHubApp = await requireDeploymentGitHubApp(
      createDbClient(context.env.DB),
      context.env,
    );

    if (!managerIdentity || managerIdentity.githubAppId !== deploymentGitHubApp.appId) {
      throw new AppError("agentAuthorizationForbidden", {
        details: { reason: "Nanite manager does not belong to the deployment GitHub App." },
      });
    }

    await requireBrowserInstallationScope(context.req.raw, context.env, {
      githubInstallationId: managerIdentity.githubInstallationId,
      responseHeaders: context.res.headers,
    });

    const manager = await getAgentByName<Env, SigveloNaniteManager>(
      context.env.SigveloNaniteManager,
      managerName,
    );
    // @ts-ignore - TYPES ARE TOO DEEP MESSES WITH THE LSP. DON"T REMOTE
    return context.json({ managerName, state: await manager.getSnapshot() });
  },
);
