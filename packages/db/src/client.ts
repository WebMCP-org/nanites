/**
 * Shared Drizzle client factory for the Sigvelo DB package.
 *
 * Rules:
 * - Compose the client from authoritative Drizzle tables only.
 * - Keep persistence behavior out of this file; query and write logic belongs in `mutations/`.
 * - When adding a new table, register it here so typed query access stays in sync.
 */
import { drizzle } from "drizzle-orm/d1";
import { getLogger } from "@logtape/drizzle-orm";
import { LOGGING } from "@nanites/observability/logging";
import {
  accountEntitlements,
  accountInstallations,
  accountInstallationRepositoryMap,
  accountPeople,
  accountRepositories,
  accounts,
  aiPricingSnapshots,
  aiUsageFacts,
  authFunnelFacts,
  naniteRunFacts,
  platformUsageFacts,
} from "./schema/business.ts";
import { installations } from "./schema/installations.ts";

const schema = {
  accountEntitlements,
  accountInstallations,
  accountInstallationRepositoryMap,
  accountPeople,
  accountRepositories,
  accounts,
  aiPricingSnapshots,
  aiUsageFacts,
  authFunnelFacts,
  installations,
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
