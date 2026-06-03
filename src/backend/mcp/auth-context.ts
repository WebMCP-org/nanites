import { z } from "zod";
import { MCP_SCOPES, SUPPORTED_MCP_SCOPES } from "#/shared/constants/mcp.ts";

type SigveloMcpScope = (typeof SUPPORTED_MCP_SCOPES)[number];

export class UnsupportedMcpScopeError extends Error {
  constructor(readonly scopes: readonly string[]) {
    super(`Unsupported Sigvelo MCP scopes requested: ${scopes.join(", ")}`);
    this.name = "UnsupportedMcpScopeError";
  }
}

export const sigveloMcpAuthPropsSchema = z.object({
  authKind: z.literal("mcp"),
  githubUserId: z.number().int().positive(),
  githubLogin: z.string().min(1),
  githubInstallationId: z.number().int().positive(),
  clientId: z.string().min(1),
  scopes: z.array(z.enum(SUPPORTED_MCP_SCOPES)),
  authorizedAt: z.string().datetime({ offset: true }),
});

export type SigveloMcpAuthProps = z.infer<typeof sigveloMcpAuthPropsSchema>;

export function resolveGrantedMcpScopes(requestedScopes: readonly string[]): SigveloMcpScope[] {
  const unsupportedScopes = requestedScopes.filter(
    (scope) => !SUPPORTED_MCP_SCOPES.includes(scope as SigveloMcpScope),
  );
  if (unsupportedScopes.length > 0) {
    throw new UnsupportedMcpScopeError([...new Set(unsupportedScopes)]);
  }

  if (requestedScopes.length === 0) {
    return [MCP_SCOPES.read];
  }

  const grantedScopes = requestedScopes as SigveloMcpScope[];
  if (grantedScopes.length === 0) {
    throw new Error("No supported Sigvelo MCP scopes were requested.");
  }

  return [...new Set(grantedScopes)];
}

export function downscopeMcpAuthPropsForToken({
  props,
  requestedScopes,
}: {
  props: SigveloMcpAuthProps;
  requestedScopes: readonly string[];
}): SigveloMcpAuthProps {
  const tokenScopes = requestedScopes.filter(
    (scope): scope is SigveloMcpScope =>
      SUPPORTED_MCP_SCOPES.includes(scope as SigveloMcpScope) &&
      props.scopes.includes(scope as SigveloMcpScope),
  );

  return {
    authKind: props.authKind,
    githubUserId: props.githubUserId,
    githubLogin: props.githubLogin,
    githubInstallationId: props.githubInstallationId,
    clientId: props.clientId,
    authorizedAt: props.authorizedAt,
    scopes: [...new Set(tokenScopes)],
  };
}
