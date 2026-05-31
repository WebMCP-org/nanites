import { z } from "zod";
import { githubInstallationIdSchema, githubUserIdSchema } from "@nanites/contracts/ids";
import { githubLoginSchema } from "@nanites/contracts/auth";
import { MCP_SCOPES, SUPPORTED_MCP_SCOPES } from "#/shared/constants/mcp.ts";

export type SigveloMcpScope = (typeof SUPPORTED_MCP_SCOPES)[number];

export class UnsupportedMcpScopeError extends Error {
  constructor(readonly scopes: readonly string[]) {
    super(`Unsupported Sigvelo MCP scopes requested: ${scopes.join(", ")}`);
    this.name = "UnsupportedMcpScopeError";
  }
}

export const sigveloMcpAuthPropsSchema = z.object({
  authKind: z.literal("mcp"),
  githubUserId: githubUserIdSchema,
  githubLogin: githubLoginSchema,
  githubInstallationId: githubInstallationIdSchema,
  clientId: z.string().min(1),
  scopes: z.array(z.enum(SUPPORTED_MCP_SCOPES)),
  authorizedAt: z.string().datetime({ offset: true }),
});

export type SigveloMcpAuthProps = z.infer<typeof sigveloMcpAuthPropsSchema>;

export function hasMcpScope(props: SigveloMcpAuthProps, scope: SigveloMcpScope): boolean {
  return props.scopes.includes(scope);
}

export function requireMcpScope(props: SigveloMcpAuthProps, scope: SigveloMcpScope): void {
  if (!hasMcpScope(props, scope)) {
    throw new Error(`MCP token is missing required scope: ${scope}`);
  }
}

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
    ...props,
    scopes: [...new Set(tokenScopes)],
  };
}
