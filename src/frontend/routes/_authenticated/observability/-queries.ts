import { parseResponse } from "hono/client";
import { httpClient } from "#/frontend/lib/http-client.ts";
import type {
  AuditFeedRow,
  NaniteCatalogRow,
  ObservabilityEventDetail,
  ObservabilityOverviewResponse,
  RunFeedRow,
} from "#/backend/observability/queries.ts";
import { cleanObservabilitySearch, type ObservabilitySearch } from "./-search.ts";

function requestQuery(search: ObservabilitySearch) {
  const requestQuery = cleanObservabilitySearch(search);
  delete requestQuery.tab;
  delete requestQuery.selectedEvent;
  return requestQuery;
}

export const observabilityDashboardQueryKey = (search: ObservabilitySearch) =>
  ["observability", "dashboard", requestQuery(search)] as const;

export const observabilityEventDetailQueryKey = (
  search: ObservabilitySearch,
  eventId: string | undefined,
) => ["observability", "event", requestQuery(search), eventId ?? null] as const;

export type ObservabilityDashboardData = {
  overview: ObservabilityOverviewResponse;
  nanites: NaniteCatalogRow[];
  runs: RunFeedRow[];
  audit: AuditFeedRow[];
  filterOptions: ObservabilityDashboardFilterOptions;
};

type ObservabilityFilterName = "repository" | "naniteId" | "creator" | "outcome" | "surface";

type ObservabilityFilterOptionsResponse = {
  options: string[];
};

export type ObservabilityDashboardFilterOptions = {
  repositories: string[];
  nanites: string[];
  creators: string[];
  outcomes: string[];
  surfaces: string[];
};

export async function fetchObservabilityDashboard(
  search: ObservabilitySearch,
): Promise<ObservabilityDashboardData> {
  const requestQueryForSearch = requestQuery(search);
  const [
    overview,
    nanites,
    runs,
    audit,
    repositories,
    naniteOptions,
    creators,
    outcomes,
    surfaces,
  ] = await Promise.all([
    parseResponse(httpClient.api.observability.overview.$get({ query: requestQueryForSearch })),
    parseResponse(httpClient.api.observability.nanites.$get({ query: requestQueryForSearch })),
    parseResponse(httpClient.api.observability.runs.$get({ query: requestQueryForSearch })),
    parseResponse(httpClient.api.observability.audit.$get({ query: requestQueryForSearch })),
    fetchObservabilityFilterOptionsOrEmpty(requestQueryForSearch, "repository"),
    fetchObservabilityFilterOptionsOrEmpty(requestQueryForSearch, "naniteId"),
    fetchObservabilityFilterOptionsOrEmpty(requestQueryForSearch, "creator"),
    fetchObservabilityFilterOptionsOrEmpty(requestQueryForSearch, "outcome"),
    fetchObservabilityFilterOptionsOrEmpty(requestQueryForSearch, "surface"),
  ]);

  return {
    overview,
    nanites,
    runs,
    audit,
    filterOptions: {
      repositories,
      nanites: naniteOptions,
      creators,
      outcomes,
      surfaces,
    },
  };
}

export async function fetchObservabilityEventDetail(
  search: ObservabilitySearch,
  eventId: string,
): Promise<ObservabilityEventDetail> {
  return await parseResponse(
    httpClient.api.observability.events[":eventId"].$get({
      param: { eventId },
      query: requestQuery(search),
    }),
  );
}

/**
 * Filter dropdown options are decoration on top of the dashboard data: one
 * failed options request must not take the whole analytics page down with it
 * (the four dataset requests above stay load-bearing). The warning keeps the
 * failure visible in the console and as a Sentry breadcrumb.
 */
async function fetchObservabilityFilterOptionsOrEmpty(
  requestQuery: Record<string, string>,
  filter: ObservabilityFilterName,
): Promise<string[]> {
  try {
    const response: ObservabilityFilterOptionsResponse = await parseResponse(
      httpClient.api.observability["filter-options"][":filter"].$get({
        param: { filter },
        query: requestQuery,
      }),
    );
    return response.options;
  } catch (error) {
    console.warn(`Observability ${filter} filter options failed to load; showing none.`, error);
    return [];
  }
}
