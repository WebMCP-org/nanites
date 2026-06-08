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

function query(search: ObservabilitySearch) {
  const requestQuery = cleanObservabilitySearch(search);
  delete requestQuery.tab;
  return requestQuery;
}

export const observabilityDashboardQueryKey = (search: ObservabilitySearch) =>
  ["observability", "dashboard", query(search)] as const;

export type ObservabilityDashboardData = {
  overview: ObservabilityOverviewResponse;
  nanites: NaniteCatalogRow[];
  runs: RunFeedRow[];
  audit: AuditFeedRow[];
  selectedEvent: ObservabilityEventDetail | null;
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
  const requestQuery = query(search);
  const [
    overview,
    nanites,
    runs,
    audit,
    selectedEvent,
    repositories,
    naniteOptions,
    creators,
    outcomes,
    surfaces,
  ] = await Promise.all([
    parseResponse(httpClient.api.observability.overview.$get({ query: requestQuery })),
    parseResponse(httpClient.api.observability.nanites.$get({ query: requestQuery })),
    parseResponse(httpClient.api.observability.runs.$get({ query: requestQuery })),
    parseResponse(httpClient.api.observability.audit.$get({ query: requestQuery })),
    search.selectedEvent
      ? parseResponse(
          httpClient.api.observability.events[":eventId"].$get({
            param: { eventId: search.selectedEvent },
            query: requestQuery,
          }),
        )
      : Promise.resolve(null),
    fetchObservabilityFilterOptions(requestQuery, "repository"),
    fetchObservabilityFilterOptions(requestQuery, "naniteId"),
    fetchObservabilityFilterOptions(requestQuery, "creator"),
    fetchObservabilityFilterOptions(requestQuery, "outcome"),
    fetchObservabilityFilterOptions(requestQuery, "surface"),
  ]);

  return {
    overview,
    nanites,
    runs,
    audit,
    selectedEvent,
    filterOptions: {
      repositories,
      nanites: naniteOptions,
      creators,
      outcomes,
      surfaces,
    },
  };
}

async function fetchObservabilityFilterOptions(
  requestQuery: Record<string, string>,
  filter: ObservabilityFilterName,
): Promise<string[]> {
  const response: ObservabilityFilterOptionsResponse = await parseResponse(
    httpClient.api.observability["filter-options"][":filter"].$get({
      param: { filter },
      query: requestQuery,
    }),
  );
  return response.options;
}
