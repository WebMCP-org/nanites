import { publicProcedure } from "#/backend/orpc/orpc.ts";
import { healthCheckOutputSchema } from "#/backend/orpc/contracts/health.ts";
import { applyNoAuthOpenAPISpec } from "#/backend/orpc/openapi-contract.ts";

export const healthRouter = {
  check: publicProcedure
    .route({
      method: "GET",
      path: "/health",
      summary: "Health check",
      description: "Return a minimal liveness response for load balancers and uptime checks.",
      tags: ["System"],
      operationId: "health_check",
      spec: applyNoAuthOpenAPISpec,
    })
    .output(healthCheckOutputSchema)
    .handler(async () => ({ status: "ok" as const })),
};
