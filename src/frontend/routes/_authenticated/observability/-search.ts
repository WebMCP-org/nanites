import { z } from "zod";

export const OBSERVABILITY_SEARCH_RANGES = ["24h", "7d", "30d"] as const;
export const OBSERVABILITY_SEARCH_TABS = [
  "overview",
  "impact",
  "people",
  "nanites",
  "runs",
  "audit",
] as const;

export const observabilitySearchSchema = z.object({
  range: z.enum(OBSERVABILITY_SEARCH_RANGES).default("7d"),
  tab: z.enum(OBSERVABILITY_SEARCH_TABS).default("overview"),
  environment: z.string().optional(),
  installationId: z.coerce.number().int().positive().optional(),
  repository: z.string().optional(),
  naniteId: z.string().optional(),
  creator: z.string().optional(),
  outcome: z.string().optional(),
  surface: z.string().optional(),
  search: z.string().optional(),
  selectedEvent: z.string().optional(),
  cursor: z.string().optional(),
  live: z.preprocess((value) => {
    if (typeof value === "string") {
      return value === "1" || value === "true";
    }

    return value;
  }, z.boolean().optional()),
});

export type ObservabilitySearch = z.infer<typeof observabilitySearchSchema>;
