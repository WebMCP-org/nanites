import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createDbClient } from "#/backend/db/index.ts";
import { requireDeploymentGitHubInstallation } from "#/backend/auth/installations.ts";
import { AppError, requestValidationHook } from "#/backend/errors.ts";
import { readCloudflareAiGatewayLog } from "#/backend/observability/ai-gateway.ts";
import type { WorkerContext, WorkerHonoEnv } from "#/backend/api/apps.ts";
import {
  OBSERVABILITY_RANGES,
  getAuditFeed,
  getNaniteCatalogRows,
  getNaniteAiRequestBreakdown,
  getObservabilityDashboard,
  getObservabilityEventDetail,
  getObservabilityFilterOptions,
  getObservabilityOverview,
  getRunFeed,
  type ObservabilityFilters,
  type ObservabilityVisibilityScope,
} from "#/backend/observability/queries.ts";

const observabilityQueryInput = zValidator(
  "query",
  z.object({
    range: z.enum(OBSERVABILITY_RANGES).default("7d"),
    environment: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    naniteId: z.string().min(1).optional(),
    creator: z.string().min(1).optional(),
    outcome: z.string().min(1).optional(),
    surface: z.string().min(1).optional(),
    search: z.string().min(1).optional(),
    selectedEvent: z.string().min(1).optional(),
    cursor: z.string().min(1).optional(),
    live: z.preprocess((value) => {
      if (typeof value !== "string") {
        return undefined;
      }

      return value === "1" || value === "true";
    }, z.boolean().optional()),
  }),
  requestValidationHook,
);

const eventDetailInput = zValidator(
  "param",
  z.object({
    eventId: z.string().min(1),
  }),
  requestValidationHook,
);

const filterOptionsInput = zValidator(
  "param",
  z.object({
    filter: z.enum(["repository", "naniteId", "creator", "outcome", "surface"]),
  }),
  requestValidationHook,
);

async function resolveObservabilityScope(
  context: WorkerContext,
  filters: ObservabilityFilters,
): Promise<ObservabilityVisibilityScope> {
  const installationScope = await requireDeploymentGitHubInstallation(context.env);
  const visibleRepositoryFullNames = installationScope.repositories.map(
    (repository) => repository.full_name,
  );
  const visibleRepositoryIds = installationScope.repositories.map((repository) => repository.id);

  if (filters.repository && !visibleRepositoryFullNames.includes(filters.repository)) {
    throw new AppError("naniteRepositoryScopeForbidden", {
      details: {
        githubInstallationId: installationScope.githubInstallationId,
        repositories: [filters.repository],
      },
      message: `GitHub installation cannot access one or more Nanite repositories: ${filters.repository}`,
    });
  }

  return {
    githubInstallationId: installationScope.githubInstallationId,
    visibleRepositoryFullNames,
    visibleRepositoryIds,
    filters,
  };
}

async function withObservabilityScope<TResponse>(
  context: WorkerContext,
  filters: ObservabilityFilters,
  handler: (
    db: ReturnType<typeof createDbClient>,
    scope: ObservabilityVisibilityScope,
  ) => Promise<TResponse>,
) {
  const db = createDbClient(context.env.DB);
  const scope = await resolveObservabilityScope(context, filters);
  return context.json(await handler(db, scope));
}

export const observabilityApiRoutes = new Hono<WorkerHonoEnv>()
  .get("/dashboard", observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), getObservabilityDashboard),
  )
  .get("/overview", observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), getObservabilityOverview),
  )
  .get("/ai-requests", observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), getNaniteAiRequestBreakdown),
  )
  .get("/nanites", observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), getNaniteCatalogRows),
  )
  .get("/runs", observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), getRunFeed),
  )
  .get("/audit", observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), getAuditFeed),
  )
  .get("/events/:eventId", eventDetailInput, observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), async (db, scope) => {
      const detail = await getObservabilityEventDetail(
        db,
        scope,
        context.req.valid("param").eventId,
      );
      if (!detail) {
        throw new AppError("naniteRunNotFound", {
          details: { runId: context.req.valid("param").eventId },
        });
      }

      if (detail.kind === "ai_usage") {
        return {
          ...detail,
          row: {
            ...detail.row,
            aiGatewayLog: await readCloudflareAiGatewayLog({
              env: context.env,
              gatewayId: detail.row.aiGatewayId,
              logId: detail.row.aiGatewayLogId,
            }),
          },
        };
      }

      return detail;
    }),
  )
  .get("/filter-options/:filter", filterOptionsInput, observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), (db, scope) =>
      getObservabilityFilterOptions(db, scope, context.req.valid("param").filter),
    ),
  );
