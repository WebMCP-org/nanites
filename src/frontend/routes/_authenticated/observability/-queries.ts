import type { ObservabilityDashboardResponse } from "#/backend/observability/queries.ts";
import type { ObservabilitySearch } from "./-search.ts";

// Serialize search into the backend query string: drop UI-only params (tab,
// selectedEvent) and anything empty, and stringify the rest.
export function requestQuery(search: ObservabilitySearch): Record<string, string> {
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
