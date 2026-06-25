import { Hono } from "hono";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";

/**
 * Public, unauthenticated runtime configuration for the browser client.
 *
 * The same built asset bundle serves every self-hosted deployment, so
 * instance-specific values the frontend needs are served at runtime instead
 * of baked in at build time. A Sentry DSN is client-public by design (it
 * ships verbatim in any bundle that uses it), so exposing it here leaks
 * nothing.
 */
export const clientConfigRoutes = new Hono<WorkerHonoEnv>().get("/", (context) => {
  context.header("Cache-Control", "public, max-age=300");
  return context.json({
    sentry: {
      dsn: context.env.SENTRY_DSN ?? null,
      environment: context.env.SENTRY_ENVIRONMENT ?? "production",
      tracesSampleRate: context.env.SENTRY_TRACES_SAMPLE_RATE ?? null,
    },
  });
});
