import { NANITE_MANAGER_KEY_PATTERN } from "#/shared/constants.ts";

/**
 * Manager Durable Objects are keyed by deployment installation. The deployment itself selects the
 * single active GitHub App.
 */
export type NaniteManagerKey = `installation:${number}`;

export type NaniteManagerIdentity = {
  readonly githubInstallationId: number;
};

export type NaniteAgentName = `${NaniteManagerKey}:nanite:${string}`;

export function buildNaniteManagerKey(identity: NaniteManagerIdentity): NaniteManagerKey {
  return `installation:${identity.githubInstallationId}`;
}

export function parseNaniteManagerKey(managerName: string): NaniteManagerIdentity | null {
  const [, rawInstallationId] = NANITE_MANAGER_KEY_PATTERN.exec(managerName) ?? [];
  if (!rawInstallationId) {
    return null;
  }

  const githubInstallationId = Number(rawInstallationId);
  if (!Number.isInteger(githubInstallationId) || githubInstallationId <= 0) {
    return null;
  }

  return { githubInstallationId };
}

export function buildNaniteAgentName(input: {
  readonly managerName: NaniteManagerKey;
  readonly naniteId: string;
}): NaniteAgentName {
  return `${input.managerName}:nanite:${input.naniteId}`;
}

export function parseNaniteAgentName(
  agentName: string,
): { readonly managerName: NaniteManagerKey; readonly naniteId: string } | null {
  const separator = ":nanite:";
  const separatorIndex = agentName.indexOf(separator);
  if (separatorIndex <= 0) {
    return null;
  }

  const managerName = agentName.slice(0, separatorIndex);
  const naniteId = agentName.slice(separatorIndex + separator.length);
  if (!naniteId || !parseNaniteManagerKey(managerName)) {
    return null;
  }

  return { managerName: managerName as NaniteManagerKey, naniteId };
}
