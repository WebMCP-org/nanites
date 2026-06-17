import { parseResponse } from "hono/client";
import { httpClient } from "#/frontend/lib/http-client.ts";
import type {
  ObservabilityDashboardResponse,
  ObservabilityEventDetail,
} from "#/backend/observability/queries.ts";
import type { ObservabilitySearch } from "./-search.ts";

// Serialize search into the backend query string: drop UI-only params (tab,
// selectedEvent) and anything empty, and stringify the rest.
function requestQuery(search: ObservabilitySearch): Record<string, string> {
  return Object.fromEntries(
    Object.entries(search)
      .filter(
        ([key, value]) =>
          key !== "tab" &&
          key !== "selectedEvent" &&
          value !== undefined &&
          value !== "" &&
          value !== false,
      )
      .map(([key, value]) => [key, String(value)]),
  );
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
