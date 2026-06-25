import { NANITE_MANAGER_KEY_PATTERN } from "#/shared/constants.ts";

/**
 * Manager Durable Objects are keyed by the (GitHub App, installation) pair.
 * GitHub installation ids are only meaningful relative to the app that owns
 * them, so the app id is part of the identity, never ambient context.
 */
export type NaniteManagerKey = `app:${number}:installation:${number}`;

export type NaniteManagerIdentity = {
  readonly githubAppId: number;
  readonly githubInstallationId: number;
};

export type NaniteAgentName = `${NaniteManagerKey}:nanite:${string}`;

export function buildNaniteManagerKey(identity: NaniteManagerIdentity): NaniteManagerKey {
  return `app:${identity.githubAppId}:installation:${identity.githubInstallationId}`;
}

export function parseNaniteManagerKey(managerName: string): NaniteManagerIdentity | null {
  const [, rawAppId, rawInstallationId] = NANITE_MANAGER_KEY_PATTERN.exec(managerName) ?? [];
  if (!rawAppId || !rawInstallationId) {
    return null;
  }

  const githubAppId = Number(rawAppId);
  const githubInstallationId = Number(rawInstallationId);
  if (
    !Number.isInteger(githubAppId) ||
    githubAppId <= 0 ||
    !Number.isInteger(githubInstallationId) ||
    githubInstallationId <= 0
  ) {
    return null;
  }

  return { githubAppId, githubInstallationId };
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
