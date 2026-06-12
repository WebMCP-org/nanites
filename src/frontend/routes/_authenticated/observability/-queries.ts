import { parseResponse } from "hono/client";
import { httpClient } from "#/frontend/lib/http-client.ts";
import type {
  ObservabilityDashboardResponse,
  ObservabilityEventDetail,
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

export type ObservabilityDashboardData = ObservabilityDashboardResponse;

export async function fetchObservabilityDashboard(
  search: ObservabilitySearch,
): Promise<ObservabilityDashboardData> {
  return await parseResponse(
    httpClient.api.observability.dashboard.$get({ query: requestQuery(search) }),
  );
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
