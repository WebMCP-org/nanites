import {
  adminMeSchema,
  adminRefreshSchema,
  adminAccountDetailSchema,
  adminAccountInputSchema,
  adminAccountsListSchema,
  adminOverviewSnapshotSchema,
  adminPeopleListSchema,
  adminUsageSnapshotSchema,
} from "@nanites/contracts/admin";
import { createDbClient } from "@nanites/db/client";
import { adminBaseProcedure } from "#/backend/orpc/orpc.ts";
import { baseErrors, buildNotFoundErrorData } from "#/backend/orpc/errors.ts";
import {
  accountIdParameterDescriptions,
  withParameterDescriptions,
} from "#/backend/orpc/openapi-contract.ts";
import {
  getAdminAccountDetail,
  getAdminOverviewSnapshot,
  getAdminUsageSnapshot,
  listAdminAccounts,
  listAdminPeople,
  syncGitHubInstallationsToBusinessData,
} from "#/backend/business-data.ts";

export const adminRouter = {
  me: {
    get: adminBaseProcedure
      .route({
        method: "GET",
        path: "/admin/me",
        summary: "Get the resolved admin actor for the current request",
        description:
          "Return the Cloudflare Access identity resolved for the current admin request.",
        tags: ["Admin"],
        operationId: "admin_me_get",
      })
      .output(adminMeSchema)
      .handler(async ({ context }) => {
        return {
          email: context.adminActor.email,
        };
      }),
  },
  refresh: adminBaseProcedure
    .route({
      method: "POST",
      path: "/admin/refresh",
      summary: "Explicitly refresh persisted admin business data from GitHub",
      description:
        "Synchronize GitHub installation, account, repository, and person data into the internal business tables.",
      tags: ["Admin"],
      operationId: "admin_refresh",
    })
    .output(adminRefreshSchema)
    .handler(async ({ context }) => {
      return syncGitHubInstallationsToBusinessData({
        db: createDbClient(context.env.DB),
        env: context.env,
      });
    }),
  overview: {
    get: adminBaseProcedure
      .route({
        method: "GET",
        path: "/admin/overview",
        summary: "Get top-line internal business, activation, and quality metrics",
        description:
          "Return aggregate installation, account activity, cost, and quality metrics for the admin overview.",
        tags: ["Admin"],
        operationId: "admin_overview_get",
      })
      .output(adminOverviewSnapshotSchema)
      .handler(async ({ context }) => {
        return getAdminOverviewSnapshot(context.db);
      }),
  },
  accounts: {
    list: adminBaseProcedure
      .route({
        method: "GET",
        path: "/admin/accounts",
        summary: "List commercial accounts with usage, value, and risk aggregates",
        description:
          "Return commercial account rows with repository, usage, value, and risk summaries.",
        tags: ["Admin"],
        operationId: "admin_accounts_list",
      })
      .output(adminAccountsListSchema)
      .handler(async ({ context }) => {
        return listAdminAccounts(context.db);
      }),
    get: adminBaseProcedure
      .errors(baseErrors)
      .route({
        method: "GET",
        path: "/admin/accounts/{accountId}",
        summary: "Get one commercial account with installations, repos, people, runs, and usage",
        description:
          "Return a detailed internal account snapshot including installations, repositories, people, recent runs, and usage.",
        tags: ["Admin"],
        operationId: "admin_accounts_get",
        spec: withParameterDescriptions(accountIdParameterDescriptions),
      })
      .input(adminAccountInputSchema)
      .output(adminAccountDetailSchema)
      .handler(async ({ context, input, errors }) => {
        const detail = await getAdminAccountDetail(context.db, input.accountId);
        if (!detail) {
          throw errors.NOT_FOUND({
            data: buildNotFoundErrorData("account", input.accountId),
          });
        }

        return detail;
      }),
  },
  people: {
    list: adminBaseProcedure
      .route({
        method: "GET",
        path: "/admin/people",
        summary: "List people observed across Sigvelo accounts",
        description:
          "Return observed GitHub people and their account relationships across SigVelo installations.",
        tags: ["Admin"],
        operationId: "admin_people_list",
      })
      .output(adminPeopleListSchema)
      .handler(async ({ context }) => {
        return listAdminPeople(context.db);
      }),
  },
  usage: {
    get: adminBaseProcedure
      .route({
        method: "GET",
        path: "/admin/usage",
        summary: "Get AI, platform, and delivered-value usage aggregates",
        description:
          "Return internal AI cost, platform operation, and delivered-value usage aggregates.",
        tags: ["Admin"],
        operationId: "admin_usage_get",
      })
      .output(adminUsageSnapshotSchema)
      .handler(async ({ context }) => {
        return getAdminUsageSnapshot(context.db);
      }),
  },
};

export type AdminRouter = typeof adminRouter;
