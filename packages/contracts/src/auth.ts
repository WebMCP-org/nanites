import { z } from "zod";
import {
  githubAccountIdSchema,
  githubInstallationIdSchema,
  githubRepositoryIdSchema,
  githubUserIdSchema,
} from "./ids.ts";

export const githubLoginSchema = z
  .string()
  .min(1)
  .meta({ title: "GitHubLogin" })
  .describe("GitHub login name.");

export const authenticatedActorSchema = z
  .object({
    id: githubUserIdSchema,
    login: githubLoginSchema,
  })
  .describe("Authenticated human actor from GitHub.");

export const installationAccountSchema = z
  .object({
    id: githubAccountIdSchema.describe("GitHub account identifier."),
    login: githubLoginSchema,
    type: z.string().min(1),
    avatar_url: z
      .string()
      .url()
      .nullable()
      .describe(
        "GitHub account avatar URL served from GitHub's CDN. Null for persisted snapshots that have not been resynced with GitHub since the column was introduced.",
      ),
  })
  .describe("GitHub account that owns an installation.");

export const activeInstallationSchema = z
  .object({
    id: githubInstallationIdSchema,
    account: installationAccountSchema,
  })
  .describe(
    "Active GitHub installation boundary for a browser session, preserving GitHub field names.",
  );

export const installationRepositoryPermissionsSchema = z
  .object({
    admin: z.boolean(),
    push: z.boolean(),
    pull: z.boolean(),
  })
  .describe("Repository permissions for the authenticated user inside the installation.");

export const installationRepositorySchema = z
  .object({
    id: githubRepositoryIdSchema,
    name: z.string().min(1),
    full_name: z.string().min(1),
    owner: z.object({
      login: z.string().min(1),
    }),
    default_branch: z.string().min(1),
    private: z.boolean(),
    permissions: installationRepositoryPermissionsSchema.partial().optional(),
  })
  .describe("Repository selectable within the active installation, preserving GitHub field names.");

export const listInstallationRepositoriesOutputSchema = z
  .object({
    repositories: z.array(installationRepositorySchema),
  })
  .describe("Repositories the current actor can access inside the active installation.");

export const selectActiveInstallationInputSchema = z
  .object({
    githubInstallationId: githubInstallationIdSchema,
  })
  .describe("Select the active GitHub installation for the current browser session.");

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .describe("ISO-8601 UTC timestamp.");

/**
 * Canonical auth error codes returned by the Nanites auth slice.
 */
export const AUTH_ERROR_CODES = {
  authenticationRequired: "authentication_required",
  activeInstallationRequired: "active_installation_required",
  installationAccessRevoked: "installation_access_revoked",
} as const;

/**
 * Canonical auth error messages returned by the Nanites auth slice.
 */
export const AUTH_ERROR_MESSAGES = {
  authenticationRequired: "Authentication required.",
  activeInstallationRequired: "An active installation must be selected.",
  installationAccessRevoked: "The active installation is no longer available.",
} as const;

/**
 * Minimal sealed browser session trusted on normal authenticated requests.
 *
 * This is Nanites-owned browser state and intentionally separate from the GitHub user access token.
 */
export const nanitesSessionSchema = z
  .object({
    githubUserId: githubUserIdSchema,
    githubLogin: githubLoginSchema,
    activeGithubInstallationId: githubInstallationIdSchema.nullable(),
    activeInstallationSnapshot: activeInstallationSchema.nullable().optional(),
    expiresAt: isoDateTimeSchema,
  })
  .describe("Sealed browser session for the Nanites demo.");

export const browserNanitesContextSchema = z
  .object({
    actor: authenticatedActorSchema,
    activeInstallation: activeInstallationSchema.nullable(),
    expiresAt: isoDateTimeSchema,
  })
  .describe(
    "Authenticated browser context composed from the Nanites-owned session plus optional GitHub-derived installation snapshot state.",
  );

export const optionalBrowserNanitesContextSchema = browserNanitesContextSchema
  .nullable()
  .describe(
    "Optional browser context for public entrypoints. Returns null when the browser is not authenticated.",
  );

/**
 * Sealed GitHub App user access token used only for revalidation flows.
 *
 * Normal authenticated requests should trust the Nanites session instead of calling GitHub.
 */
export const githubUserTokenSchema = z
  .object({
    accessToken: z.string().min(1).describe("GitHub App user access token."),
    expiresAt: isoDateTimeSchema.nullable(),
    refreshToken: z.string().min(1).nullable(),
    refreshTokenExpiresAt: isoDateTimeSchema.nullable(),
  })
  .describe("Sealed GitHub-derived user access token stored separately from the app session.");

/**
 * Temporary GitHub OAuth state stored in a sealed cookie during the web application flow.
 *
 * It carries the PKCE verifier and the post-login browser return path.
 */
export const githubOAuthStateSchema = z
  .object({
    state: z.string().min(1),
    codeVerifier: z.string().min(43).max(128),
    returnToPath: z.string().min(1),
    expiresAt: isoDateTimeSchema,
  })
  .describe("Temporary Nanites-owned GitHub OAuth state persisted in a sealed cookie.");

export const visibleInstallationsOutputSchema = z
  .object({
    installations: z.array(activeInstallationSchema),
  })
  .describe("Active installations visible to the current actor.");

export const authenticationRequiredErrorSchema = z
  .object({
    code: z.literal(AUTH_ERROR_CODES.authenticationRequired),
    message: z.literal(AUTH_ERROR_MESSAGES.authenticationRequired),
  })
  .describe("The request requires a valid Nanites browser session.");

export const activeInstallationRequiredErrorSchema = z
  .object({
    code: z.literal(AUTH_ERROR_CODES.activeInstallationRequired),
    message: z.literal(AUTH_ERROR_MESSAGES.activeInstallationRequired),
  })
  .describe("The request requires an active installation in the current browser session.");

export const installationAccessRevokedErrorSchema = z
  .object({
    code: z.literal(AUTH_ERROR_CODES.installationAccessRevoked),
    message: z.literal(AUTH_ERROR_MESSAGES.installationAccessRevoked),
    githubInstallationId: githubInstallationIdSchema,
  })
  .describe("The active installation in the browser session is no longer trusted.");

export const sessionProcedureErrors = {
  UNAUTHORIZED: {
    message: authenticationRequiredErrorSchema.shape.message.value,
    data: authenticationRequiredErrorSchema,
  },
} as const;

export const installationProcedureErrors = {
  BAD_REQUEST: {
    message: activeInstallationRequiredErrorSchema.shape.message.value,
    data: activeInstallationRequiredErrorSchema,
  },
  FORBIDDEN: {
    message: installationAccessRevokedErrorSchema.shape.message.value,
    data: installationAccessRevokedErrorSchema,
  },
} as const;

export type AuthenticatedActor = z.infer<typeof authenticatedActorSchema>;
export type ActiveInstallation = z.infer<typeof activeInstallationSchema>;
export type InstallationRepository = z.infer<typeof installationRepositorySchema>;
export type NanitesSession = z.infer<typeof nanitesSessionSchema>;
export type BrowserNanitesContext = z.infer<typeof browserNanitesContextSchema>;
export type OptionalBrowserNanitesContext = z.infer<typeof optionalBrowserNanitesContextSchema>;
export type GitHubUserToken = z.infer<typeof githubUserTokenSchema>;
export type GitHubOAuthState = z.infer<typeof githubOAuthStateSchema>;
