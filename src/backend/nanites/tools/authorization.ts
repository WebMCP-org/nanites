import { SUPPORTED_MCP_SCOPES } from "#/shared/constants.ts";
import { APP_ERRORS, AppError } from "#/backend/errors.ts";
import type { SigveloMcpAuthProps } from "#/backend/mcp/index.ts";
import type { SigveloMcpVisibleRepository } from "#/backend/mcp/auth-props.ts";
import type { NaniteManagerState } from "#/backend/agents/SigveloNaniteManager.ts";
import { resolveNaniteManifestRepositoryFullNames } from "#/backend/nanites/github-mcp-capabilities.ts";
import type {
  AnySigveloMcpToolDefinition,
  NaniteToolRuntime,
  SigveloNaniteToolSurface,
} from "#/backend/nanites/tools/define-tool.ts";

type SigveloMcpScope = (typeof SUPPORTED_MCP_SCOPES)[number];
type RepositoryAccessLevel = "read" | "write";

type InputRepositoryResolver<TInput> = (input: TInput) => readonly string[];
type RuntimeRepositoryResolver<TInput> = (
  input: TInput,
  runtime: NaniteToolRuntime,
) => readonly string[] | Promise<readonly string[]>;
type ReferencedNaniteRepositorySelection =
  | {
      type: "referenced_nanites";
    }
  | {
      type: "all_nanites_when_unscoped";
    };
export type ReferencedNaniteToolInput = {
  readonly naniteId?: string;
  readonly runId?: string;
  readonly runIds?: readonly string[];
};

type RepositoryPolicy<TInput> =
  | {
      type: "none";
    }
  | {
      type: "input";
      access: RepositoryAccessLevel;
      resolve: InputRepositoryResolver<TInput>;
    }
  | {
      type: "runtime";
      access: RepositoryAccessLevel;
      resolve: RuntimeRepositoryResolver<TInput>;
    };

export type SigveloNaniteToolAuthorization<TInput = unknown> = {
  requiredScope: SigveloMcpScope;
  repositoryPolicy: RepositoryPolicy<TInput>;
};

export function resolveReferencedNaniteRepositoryFullNames(
  selection: ReferencedNaniteRepositorySelection,
): RuntimeRepositoryResolver<ReferencedNaniteToolInput> {
  return async (input, runtime) => {
    const state = await runtime.manager.getSnapshot();
    const naniteIds = resolveInputNaniteIds(input, state);
    if (naniteIds.size === 0 && selection.type === "all_nanites_when_unscoped") {
      for (const naniteId of Object.keys(state.nanites)) {
        naniteIds.add(naniteId);
      }
    }

    const repositories = new Set<string>();
    for (const naniteId of naniteIds) {
      const nanite = state.nanites[naniteId];
      if (!nanite) {
        continue;
      }

      for (const repository of resolveNaniteManifestRepositoryFullNames(nanite.manifest)) {
        repositories.add(repository);
      }
    }

    return [...repositories].sort();
  };
}

export function authorizeSigveloNaniteToolScope(input: {
  definition: AnySigveloMcpToolDefinition;
  auth: SigveloMcpAuthProps;
}): void {
  const requiredScope = input.definition.authorization.requiredScope;
  if (input.auth.scopes.includes(requiredScope)) {
    return;
  }

  throw new AppError("mcpTokenScopeUnavailable", {
    details: {
      toolName: input.definition.name,
      requiredScope,
      grantedScopes: input.auth.scopes,
    },
    message: `${APP_ERRORS.mcpTokenScopeUnavailable.message}: ${requiredScope}`,
  });
}

export function authorizeSigveloNaniteToolRepositories(input: {
  auth: SigveloMcpAuthProps;
  surface: SigveloNaniteToolSurface;
  access: RepositoryAccessLevel;
  repositoryFullNames: readonly string[];
}): void {
  if (input.surface !== "mcp" || input.repositoryFullNames.length === 0) {
    return;
  }

  const visibleRepositories = new Map(
    input.auth.visibleRepositories.map((repository) => [repository.full_name, repository]),
  );
  const forbiddenRepositories = [...new Set(input.repositoryFullNames)]
    .filter((repositoryFullName) => {
      const repository = visibleRepositories.get(repositoryFullName);
      return (
        !repository ||
        !hasVisibleRepositoryPermission({
          repository,
          access: input.access,
        })
      );
    })
    .sort();

  if (forbiddenRepositories.length === 0) {
    return;
  }

  throw new AppError("naniteRepositoryScopeForbidden", {
    details: {
      githubInstallationId: input.auth.githubInstallationId,
      repositories: forbiddenRepositories,
    },
    message: `${APP_ERRORS.naniteRepositoryScopeForbidden.message}: ${forbiddenRepositories.join(", ")}`,
  });
}

function resolveInputNaniteIds(
  input: ReferencedNaniteToolInput,
  state: NaniteManagerState,
): Set<string> {
  const naniteIds = new Set<string>();

  if (input.naniteId) {
    naniteIds.add(input.naniteId);
  }

  if (input.runId) {
    const run = state.runs[input.runId];
    if (run) {
      naniteIds.add(run.naniteId);
    }
  }

  for (const runId of input.runIds ?? []) {
    const run = state.runs[runId];
    if (run) {
      naniteIds.add(run.naniteId);
    }
  }

  return naniteIds;
}

function hasVisibleRepositoryPermission(input: {
  repository: SigveloMcpVisibleRepository;
  access: RepositoryAccessLevel;
}): boolean {
  const permissions = input.repository.permissions;
  if (input.access === "write") {
    return permissions.admin === true || permissions.maintain === true || permissions.push === true;
  }

  return (
    permissions.admin === true ||
    permissions.maintain === true ||
    permissions.push === true ||
    permissions.triage === true ||
    permissions.pull === true
  );
}
