/**
 * Shared Drizzle client factory for the Sigvelo DB package.
 *
 * Rules:
 * - Compose the client from authoritative Drizzle tables only.
 * - Keep persistence behavior out of this file; query and write logic belongs in
 *   `business-mutations.ts`.
 * - When adding a new table, register it here so typed query access stays in sync.
 */
import { drizzle } from "drizzle-orm/d1";
import { getLogger } from "@logtape/drizzle-orm";
import { LOGGING } from "#/shared/observability/logging.ts";
import {
  accountEntitlements,
  accountInstallations,
  accountPeople,
  accountRepositories,
  accounts,
  aiPricingSnapshots,
  aiUsageFacts,
  authFunnelFacts,
  naniteRunFacts,
  platformUsageFacts,
} from "./business-schema.ts";

const schema = {
  accountEntitlements,
  accountInstallations,
  accountPeople,
  accountRepositories,
  accounts,
  aiPricingSnapshots,
  aiUsageFacts,
  authFunnelFacts,
  naniteRunFacts,
  platformUsageFacts,
};

export function createDbClient(d1: D1Database) {
  return drizzle(d1, {
    schema,
    logger: getLogger({
      category: LOGGING.DB_CATEGORY,
      level: "debug",
    }),
  });
}

export type DbClient = ReturnType<typeof createDbClient>;
