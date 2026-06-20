/** Agents SDK class name used by browser clients for the repo-scoped Nanites manager. */
export const NANITE_MANAGER_NAME = "sigvelo-nanite-manager";

/** Agents SDK class name used by browser clients for installation manager chat. */
export const MANAGER_CONVERSATION_AGENT_NAME = "sigvelo-manager-conversation-agent";

/** Agents SDK sub-agent class name used by browser clients for stable Nanite chat. */
export const NANITE_AGENT_NAME = "sigvelo-nanite-agent";

/** Agents SDK class name used by the first-launch setup wizard. */
export const NANITES_SETUP_AGENT_NAME = "nanites-setup-agent";

/** Single deployment-scoped setup wizard instance. */
export const NANITES_SETUP_AGENT_INSTANCE_NAME = "default";

/**
 * Default model for SigVelo agents. Shared (not server-only) so the browser can
 * show it as the manager's effective model when conversation state predates the
 * `model` field — getModel() falls back to this same value.
 */
export const DEFAULT_SIGVELO_AGENT_MODEL_ID = "@cf/zai-org/glm-4.7-flash";

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

const NANITE_MANAGER_KEY_PATTERN = /^app:(\d+):installation:(\d+)$/;

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
