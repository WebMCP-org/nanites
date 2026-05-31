import { healthRouter } from "#/backend/orpc/routers/health.ts";
import { authRouter } from "#/backend/orpc/routers/auth.ts";
import { nanitesRouter } from "#/backend/orpc/routers/nanites.ts";

export const appRouter = {
  auth: authRouter,
  health: healthRouter,
  nanites: nanitesRouter,
};

export type AppRouter = typeof appRouter;
