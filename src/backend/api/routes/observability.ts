import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createDbClient } from "#/backend/db/index.ts";
import { requireBrowserInstallationScope } from "#/backend/auth/installations.ts";
import { AppError, requestValidationHook } from "#/backend/errors.ts";
import { listInstallationRepositories } from "#/backend/github/index.ts";
import type { WorkerContext, WorkerHonoEnv } from "#/backend/api/apps.ts";
import {
  OBSERVABILITY_RANGES,
  getAuditFeed,
  getNaniteCatalogRows,
  getNaniteCostBreakdown,
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
    installationId: z.coerce.number().int().positive().optional(),
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
  _db: ReturnType<typeof createDbClient>,
  filters: ObservabilityFilters,
): Promise<ObservabilityVisibilityScope> {
  const installationScope = await requireBrowserInstallationScope(context.req.raw, context.env, {
    githubInstallationId: filters.installationId ?? null,
    responseHeaders: context.res.headers,
  });

  const repositories = await listInstallationRepositories(
    installationScope.githubUserToken.accessToken,
    installationScope.githubInstallationId,
    { env: context.env, githubAppId: installationScope.githubAppId },
  );
  const visibleRepositoryFullNames = repositories.map((repository) => repository.full_name);
  const visibleRepositoryIds = repositories.map((repository) => repository.id);

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
  const scope = await resolveObservabilityScope(context, db, filters);
  return context.json(await handler(db, scope));
}

export const observabilityApiRoutes = new Hono<WorkerHonoEnv>()
  .get("/dashboard", observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), getObservabilityDashboard),
  )
  .get("/overview", observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), getObservabilityOverview),
  )
  .get("/costs", observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), getNaniteCostBreakdown),
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

      return detail;
    }),
  )
  .get("/filter-options/:filter", filterOptionsInput, observabilityQueryInput, async (context) =>
    withObservabilityScope(context, context.req.valid("query"), (db, scope) =>
      getObservabilityFilterOptions(db, scope, context.req.valid("param").filter),
    ),
  );
