import { z } from "zod";
import {
  defineSigveloMcpTool,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

const whoamiToolInputSchema = z.object({});
const whoamiToolOutputSchema = z.object({
  authKind: z.literal("mcp"),
  githubUserId: z.number().int().positive(),
  githubLogin: z.string().min(1),
  githubInstallationId: z.number().int().positive(),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)),
});

export const whoamiTool = defineSigveloMcpTool({
  name: "sigvelo_whoami",
  title: "Inspect Sigvelo authorization",
  description: "Returns the GitHub actor and installation bound to this tool session.",
  inputSchema: whoamiToolInputSchema,
  outputSchema: whoamiToolOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(_input, { auth }) {
    return {
      authKind: auth.authKind,
      githubUserId: auth.githubUserId,
      githubLogin: auth.githubLogin,
      githubInstallationId: auth.githubInstallationId,
      clientId: auth.clientId,
      scopes: auth.scopes,
    };
  },
} satisfies SigveloMcpToolDefinition<
  typeof whoamiToolInputSchema,
  z.output<typeof whoamiToolOutputSchema>
>);
