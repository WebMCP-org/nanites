import { Hono } from "hono";
import { getAgentByName } from "agents";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { AppError, requestValidationHook } from "#/backend/errors.ts";
import { activeGithubInstallationRequired } from "#/backend/api/routes/auth.ts";
import type { SigveloNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import { buildNaniteManagerKey } from "#/nanites.ts";

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
  activeGithubInstallationRequired,
  async (context) => {
    const { managerName } = context.req.valid("param");
    const activeGithubInstallation = context.get("activeGithubInstallation");
    const expectedManagerName = buildNaniteManagerKey(activeGithubInstallation);

    if (managerName !== expectedManagerName) {
      throw new AppError("activeInstallationRequired", {
        details: { githubInstallationId: activeGithubInstallation.githubInstallationId },
      });
    }

    const manager = await getAgentByName<Env, SigveloNaniteManager>(
      context.env.SigveloNaniteManager,
      managerName,
    );
    // @ts-ignore - TYPES ARE TOO DEEP MESSES WITH THE LSP. DON"T REMOTE
    return context.json({ managerName, state: await manager.getSnapshot() });
  },
);
