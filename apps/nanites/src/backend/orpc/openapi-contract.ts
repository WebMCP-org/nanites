import type { OpenAPI, OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";
import {
  activeInstallationRequiredErrorSchema,
  activeInstallationSchema,
  authenticatedActorSchema,
  authenticationRequiredErrorSchema,
  browserNanitesContextSchema,
  installationAccessRevokedErrorSchema,
  installationAccountSchema,
  installationRepositorySchema,
  listInstallationRepositoriesOutputSchema,
  optionalBrowserNanitesContextSchema,
  selectActiveInstallationInputSchema,
  visibleInstallationsOutputSchema,
} from "@nanites/contracts/auth";
import {
  adminAccountAiUsageByPersonSchema,
  adminAccountDetailSchema,
  adminAccountInstallationSchema,
  adminAccountListItemSchema,
  adminAccountPersonSchema,
  adminAccountRepositorySchema,
  adminAccountsListSchema,
  adminAiUsageByAccountSchema,
  adminAiUsageByModelSchema,
  adminAiUsageByPersonSchema,
  adminAiUsageByRunSchema,
  adminMeSchema,
  adminMonthlyAiUsagePointSchema,
  adminOverviewSnapshotSchema,
  adminPeopleListItemSchema,
  adminPeopleListSchema,
  adminPlatformUsageByAccountSchema,
  adminPlatformUsagePointSchema,
  adminRecentRunSchema,
  adminRefreshSchema,
  adminUsageSnapshotSchema,
  adminValueByAccountSchema,
  cloudflareAccessRequiredErrorSchema,
} from "@nanites/contracts/admin";
import { ACCOUNT_ID_DESCRIPTION } from "@nanites/contracts/ids";
import {
  createNaniteInputSchema,
  createNaniteOutputSchema,
  humanRequestOutputSchema,
  managerStateOutputSchema,
  NANITE_MANAGER_NAME_DESCRIPTION,
  nanitePermissionSpecSchema,
  naniteRunOutputSchema,
  naniteTriggerSpecSchema,
} from "#/backend/orpc/contracts/nanites.ts";
import { healthCheckOutputSchema } from "#/backend/orpc/contracts/health.ts";
import { internalErrorDataSchema, notFoundErrorDataSchema } from "#/backend/orpc/errors.ts";
import { BROWSER_AUTH_COOKIE_NAMES } from "#/backend/browser-auth/policy.ts";
import {
  ADMIN_API_PREFIX,
  API_PREFIX,
  PUBLIC_APP_ORIGIN,
} from "#/shared/constants/openapi-document.ts";
import {
  MCP_AUTHORIZE_ROUTE,
  MCP_OAUTH_SECURITY_SCHEME,
  MCP_SCOPE_DESCRIPTIONS,
  MCP_SCOPES,
  MCP_TOKEN_ROUTE,
} from "#/shared/constants/mcp.ts";

type CommonSchemas = NonNullable<OpenAPIGeneratorGenerateOptions["commonSchemas"]>;

const OPENAPI_CONTACT = {
  name: "SigVelo",
  url: "https://sigvelo.com/#early-access",
  email: "hello@sigvelo.com",
} as const;

const OPENAPI_LICENSE = {
  name: "MIT",
  url: "https://opensource.org/license/mit",
} as const;

const undefinedErrorCommonSchema = {
  UndefinedError: {
    error: "UndefinedError",
  },
} as const satisfies CommonSchemas;

const baseCommonSchemas = {
  ...undefinedErrorCommonSchema,
  NotFoundErrorData: { schema: notFoundErrorDataSchema },
  InternalErrorData: { schema: internalErrorDataSchema },
} as const satisfies CommonSchemas;

const authCommonSchemas = {
  AuthenticatedActor: { schema: authenticatedActorSchema },
  InstallationAccount: { schema: installationAccountSchema },
  ActiveInstallation: { schema: activeInstallationSchema },
  InstallationRepository: { schema: installationRepositorySchema },
  BrowserNanitesContext: { schema: browserNanitesContextSchema },
  OptionalBrowserNanitesContext: {
    schema: optionalBrowserNanitesContextSchema,
  },
  VisibleInstallationsOutput: { schema: visibleInstallationsOutputSchema },
  SelectActiveInstallationInput: {
    schema: selectActiveInstallationInputSchema,
  },
  ListInstallationRepositoriesOutput: {
    schema: listInstallationRepositoriesOutputSchema,
  },
  AuthenticationRequiredError: { schema: authenticationRequiredErrorSchema },
  ActiveInstallationRequiredError: {
    schema: activeInstallationRequiredErrorSchema,
  },
  InstallationAccessRevokedError: {
    schema: installationAccessRevokedErrorSchema,
  },
} as const satisfies CommonSchemas;

const nanitesCommonSchemas = {
  NaniteTriggerSpec: { schema: naniteTriggerSpecSchema },
  NanitePermissionSpec: { schema: nanitePermissionSpecSchema },
  CreateNaniteInput: { schema: createNaniteInputSchema },
  HumanRequestOutput: { schema: humanRequestOutputSchema },
  NaniteRunOutput: { schema: naniteRunOutputSchema },
  CreateNaniteOutput: { schema: createNaniteOutputSchema },
  ManagerStateOutput: { schema: managerStateOutputSchema },
} as const satisfies CommonSchemas;

const adminCommonSchemas = {
  AdminMe: { schema: adminMeSchema },
  AdminRefresh: { schema: adminRefreshSchema },
  CloudflareAccessRequiredError: {
    schema: cloudflareAccessRequiredErrorSchema,
  },
  AdminOverviewSnapshot: { schema: adminOverviewSnapshotSchema },
  AdminAccountListItem: { schema: adminAccountListItemSchema },
  AdminAccountsList: { schema: adminAccountsListSchema },
  AdminAccountInstallation: { schema: adminAccountInstallationSchema },
  AdminAccountRepository: { schema: adminAccountRepositorySchema },
  AdminAccountPerson: { schema: adminAccountPersonSchema },
  AdminRecentRun: { schema: adminRecentRunSchema },
  AdminMonthlyAiUsagePoint: { schema: adminMonthlyAiUsagePointSchema },
  AdminPlatformUsagePoint: { schema: adminPlatformUsagePointSchema },
  AdminAccountAiUsageByPerson: {
    schema: adminAccountAiUsageByPersonSchema,
  },
  AdminAccountDetail: { schema: adminAccountDetailSchema },
  AdminPeopleListItem: { schema: adminPeopleListItemSchema },
  AdminPeopleList: { schema: adminPeopleListSchema },
  AdminAiUsageByModel: { schema: adminAiUsageByModelSchema },
  AdminAiUsageByAccount: { schema: adminAiUsageByAccountSchema },
  AdminAiUsageByPerson: { schema: adminAiUsageByPersonSchema },
  AdminAiUsageByRun: { schema: adminAiUsageByRunSchema },
  AdminPlatformUsageByAccount: {
    schema: adminPlatformUsageByAccountSchema,
  },
  AdminValueByAccount: { schema: adminValueByAccountSchema },
  AdminUsageSnapshot: { schema: adminUsageSnapshotSchema },
} as const satisfies CommonSchemas;

export const publicOpenAPICommonSchemas = {
  ...baseCommonSchemas,
  ...authCommonSchemas,
  ...nanitesCommonSchemas,
  HealthCheckOutput: { schema: healthCheckOutputSchema },
} as const satisfies CommonSchemas;

export const adminOpenAPICommonSchemas = {
  ...baseCommonSchemas,
  ...adminCommonSchemas,
} as const satisfies CommonSchemas;

export const publicOpenAPITags = [
  {
    name: "Auth",
    description: "Browser GitHub authentication and installation selection.",
  },
  {
    name: "Nanites",
    description: "Nanite manager registration, run control, and state inspection.",
  },
  {
    name: "System",
    description: "Operational endpoints for SigVelo infrastructure.",
  },
] as const satisfies OpenAPI.TagObject[];

export const adminOpenAPITags = [
  {
    name: "Admin",
    description: "Internal SigVelo business, usage, and account telemetry.",
  },
] as const satisfies OpenAPI.TagObject[];

export const sigveloMcpOAuthSecurityScheme = {
  type: "oauth2",
  description: "SigVelo MCP OAuth grant bound to a GitHub user and installation.",
  flows: {
    authorizationCode: {
      authorizationUrl: MCP_AUTHORIZE_ROUTE,
      tokenUrl: MCP_TOKEN_ROUTE,
      scopes: MCP_SCOPE_DESCRIPTIONS,
    },
  },
} as const satisfies OpenAPI.SecuritySchemeObject;

export const publicOpenAPISecuritySchemes = {
  nanitesSession: {
    type: "apiKey",
    in: "cookie",
    name: BROWSER_AUTH_COOKIE_NAMES.session,
    description: "Sealed SigVelo browser session cookie.",
  },
  githubUserToken: {
    type: "apiKey",
    in: "cookie",
    name: BROWSER_AUTH_COOKIE_NAMES.githubUserToken,
    description: "Sealed GitHub user token cookie used for live revalidation.",
  },
  [MCP_OAUTH_SECURITY_SCHEME]: sigveloMcpOAuthSecurityScheme,
} as const satisfies NonNullable<OpenAPI.ComponentsObject["securitySchemes"]>;

export function mcpOAuthSecurity(
  scope: (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES],
): OpenAPI.SecurityRequirementObject {
  return {
    [MCP_OAUTH_SECURITY_SCHEME]: [scope],
  };
}

export const adminOpenAPISecuritySchemes = {
  cloudflareAccessJwt: {
    type: "apiKey",
    in: "header",
    name: "cf-access-jwt-assertion",
    description: "Cloudflare Access JWT assertion for the SigVelo admin app.",
  },
} as const satisfies NonNullable<OpenAPI.ComponentsObject["securitySchemes"]>;

export const noAuthOpenAPISpec = {
  security: [],
} as const satisfies Partial<OpenAPI.OperationObject>;

export function applyNoAuthOpenAPISpec(
  operation: OpenAPI.OperationObject,
): OpenAPI.OperationObject {
  return {
    ...operation,
    ...noAuthOpenAPISpec,
  };
}

export const browserSessionSecurity = [
  {
    nanitesSession: [],
  },
] as const satisfies OpenAPI.SecurityRequirementObject[];

export const browserRevalidationSecurity = [
  {
    nanitesSession: [],
    githubUserToken: [],
  },
] as const satisfies OpenAPI.SecurityRequirementObject[];

export function buildNanitesAccessSecurity(
  requiredScope: (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES],
): OpenAPI.SecurityRequirementObject[] {
  return [...browserSessionSecurity, mcpOAuthSecurity(requiredScope)];
}

export const adminAccessSecurity = [
  {
    cloudflareAccessJwt: [],
  },
] as const satisfies OpenAPI.SecurityRequirementObject[];

export function withParameterDescriptions(
  descriptions: Record<string, string>,
): (operation: OpenAPI.OperationObject) => OpenAPI.OperationObject {
  return (operation) => ({
    ...operation,
    parameters: operation.parameters?.map((parameter) => {
      if ("$ref" in parameter) {
        return parameter;
      }

      const description = descriptions[parameter.name];
      return description ? { ...parameter, description } : parameter;
    }),
  });
}

export const accountIdParameterDescriptions = {
  accountId: ACCOUNT_ID_DESCRIPTION,
} as const;

export const managerNameParameterDescriptions = {
  managerName: NANITE_MANAGER_NAME_DESCRIPTION,
} as const;

export function buildPublicOpenAPIGenerateOptions(
  info: OpenAPI.InfoObject,
): OpenAPIGeneratorGenerateOptions {
  return {
    info: {
      ...info,
      contact: OPENAPI_CONTACT,
      license: OPENAPI_LICENSE,
    },
    servers: [
      { url: `${PUBLIC_APP_ORIGIN}${API_PREFIX}`, description: "SigVelo production public API." },
    ],
    tags: publicOpenAPITags,
    security: browserRevalidationSecurity,
    components: {
      securitySchemes: publicOpenAPISecuritySchemes,
    },
    commonSchemas: publicOpenAPICommonSchemas,
  };
}

export function buildAdminOpenAPIGenerateOptions(
  info: OpenAPI.InfoObject,
): OpenAPIGeneratorGenerateOptions {
  return {
    info: {
      ...info,
      contact: OPENAPI_CONTACT,
      license: OPENAPI_LICENSE,
    },
    servers: [
      {
        url: `${PUBLIC_APP_ORIGIN}${ADMIN_API_PREFIX}`,
        description: "SigVelo production admin API.",
      },
    ],
    tags: adminOpenAPITags,
    security: adminAccessSecurity,
    components: {
      securitySchemes: adminOpenAPISecuritySchemes,
    },
    commonSchemas: adminOpenAPICommonSchemas,
  };
}
