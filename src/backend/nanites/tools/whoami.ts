import { MCP_SCOPES } from "#/shared/constants.ts";
import { z } from "zod";
import { createDbClient } from "#/backend/db/index.ts";
import { requireInstallationAccount } from "#/backend/db/facts.ts";
import { GITHUB_ACCOUNT_TYPES } from "#/backend/db/schema.ts";
import { readDeploymentGitHubAppMetadata } from "#/backend/github/apps.ts";
import { listReposAccessibleToInstallation } from "#/backend/github/index.ts";
import {
  defineSigveloMcpTool,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

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
    .describe(
      "The GitHub org or user account this installation targets. This is the working scope: repositories and Nanites belong to this account, not to githubLogin.",
    ),
  installationRepositories: z
    .array(z.string().min(1))
    .describe("Full names of repositories selected for the connected GitHub App installation."),
  githubApp: z
    .object({
      appId: z.number().int().positive(),
      slug: z.string().min(1),
      htmlUrl: z.string().min(1),
    })
    .describe("The deployment GitHub App behind this installation."),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).describe("SigVelo MCP scopes granted to this tool session."),
});

export const whoamiTool = defineSigveloMcpTool({
  name: "sigvelo_whoami",
  title: "Inspect SigVelo authorization",
  description:
    "Returns the signed-in GitHub user plus the full authorization picture of this tool session: the GitHub App installation, the account it targets, installation repositories, the app's GitHub permissions and webhook events, and the granted MCP scopes. installationAccount and installationRepositories are the working scope for Nanites; githubLogin only identifies the human.",
  inputSchema: whoamiToolInputSchema,
  outputSchema: whoamiToolOutputSchema,
  requiredScope: MCP_SCOPES.read,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(_input, { auth, env }) {
    const db = createDbClient(env.DB);
    const [account, appMetadata, repositories] = await Promise.all([
      requireInstallationAccount(db, auth.githubInstallationId),
      readDeploymentGitHubAppMetadata(env),
      listReposAccessibleToInstallation({
        env,
        githubAppId: auth.githubAppId,
        githubInstallationId: auth.githubInstallationId,
      }),
    ]);

    return {
      authKind: auth.authKind,
      githubUserId: auth.githubUserId,
      githubLogin: auth.githubLogin,
      githubInstallationId: auth.githubInstallationId,
      installationAccount: {
        login: account.githubAccountLogin,
        type: account.githubAccountType,
      },
      installationRepositories: repositories
        .map((repository) => repository.full_name)
        .sort((left, right) => left.localeCompare(right)),
      githubApp: {
        appId: appMetadata.appId,
        slug: appMetadata.slug,
        htmlUrl: appMetadata.htmlUrl,
      },
      clientId: auth.clientId,
      scopes: auth.scopes,
    };
  },
} satisfies SigveloMcpToolDefinition<
  typeof whoamiToolInputSchema,
  z.output<typeof whoamiToolOutputSchema>
>);
