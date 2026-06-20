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
