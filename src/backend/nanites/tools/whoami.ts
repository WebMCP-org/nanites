import { z } from "zod";
import { createDbClient } from "#/backend/db/index.ts";
import { findInstallationAccount } from "#/backend/db/facts.ts";
import { GITHUB_ACCOUNT_TYPES } from "#/backend/db/schema.ts";
import { readGitHubAppMetadata } from "#/backend/github/apps.ts";
import { sigveloMcpVisibleRepositorySchema } from "#/backend/mcp/auth-props.ts";
import {
  defineSigveloMcpTool,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";
import { MCP_SCOPES } from "#/mcp.ts";

const whoamiToolInputSchema = z.object({});
const whoamiToolOutputSchema = z.object({
  authKind: z.literal("mcp"),
  githubUserId: z.number().int().positive(),
  githubLogin: z
    .string()
    .min(1)
    .describe(
      "Personal login of the signed-in human. Identity only — not the repository scope; do not target this user's personal repositories unless explicitly asked.",
    ),
  githubInstallationId: z.number().int().positive(),
  installationAccount: z
    .object({
      login: z.string().min(1),
      type: z.enum(GITHUB_ACCOUNT_TYPES),
    })
    .nullable()
    .describe(
      "The GitHub org or user account this installation targets. This is the working scope: repositories and Nanites belong to this account, not to githubLogin.",
    ),
  installationRepositories: z
    .array(z.string().min(1))
    .describe(
      "Full names of repositories visible to the authorizing GitHub user for this installation. This is the MCP tool session's repository scope.",
    ),
  visibleRepositories: z
    .array(sigveloMcpVisibleRepositorySchema)
    .describe(
      "GitHub repository objects visible to the authorizing GitHub user for this installation, preserving GitHub permission fields such as pull, push, and admin.",
    ),
  githubApp: z
    .object({
      appId: z.number().int().positive(),
      slug: z.string().min(1),
      htmlUrl: z.string().min(1),
      permissions: z
        .record(z.string(), z.string())
        .describe("GitHub App permission name to granted access level (read/write/admin)."),
      events: z.array(z.string()).describe("Webhook events the GitHub App subscribes to."),
    })
    .nullable()
    .describe("The GitHub App behind this installation and the permissions it was granted."),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).describe("SigVelo MCP scopes granted to this tool session."),
});

export const whoamiTool = defineSigveloMcpTool({
  name: "sigvelo_whoami",
  title: "Inspect SigVelo authorization",
  description:
    "Returns the signed-in GitHub user plus the full authorization picture of this tool session: the GitHub App installation, the account it targets, repositories visible to this GitHub user, the app's GitHub permissions and webhook events, and the granted MCP scopes. installationAccount and visibleRepositories are the working scope for repositories and Nanites; githubLogin only identifies the human.",
  inputSchema: whoamiToolInputSchema,
  outputSchema: whoamiToolOutputSchema,
  authorization: {
    requiredScope: MCP_SCOPES.read,
    repositoryPolicy: { type: "none" },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(_input, { auth, env }) {
    const db = createDbClient(env.DB);
    const [account, appMetadata] = await Promise.all([
      findInstallationAccount(db, auth.githubInstallationId),
      readGitHubAppMetadata(db, auth.githubAppId),
    ]);
    const visibleRepositories = [...auth.visibleRepositories].sort((left, right) =>
      left.full_name.localeCompare(right.full_name),
    );

    return {
      authKind: auth.authKind,
      githubUserId: auth.githubUserId,
      githubLogin: auth.githubLogin,
      githubInstallationId: auth.githubInstallationId,
      installationAccount: account
        ? {
            login: account.githubAccountLogin,
            type: account.githubAccountType,
          }
        : null,
      installationRepositories: visibleRepositories.map((repository) => repository.full_name),
      visibleRepositories,
      githubApp: appMetadata
        ? {
            appId: appMetadata.appId,
            slug: appMetadata.slug,
            htmlUrl: appMetadata.htmlUrl,
            permissions: appMetadata.permissions,
            events: [...appMetadata.events],
          }
        : null,
      clientId: auth.clientId,
      scopes: auth.scopes,
    };
  },
} satisfies SigveloMcpToolDefinition<
  typeof whoamiToolInputSchema,
  z.output<typeof whoamiToolOutputSchema>
>);
