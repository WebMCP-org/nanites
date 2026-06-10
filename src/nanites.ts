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

export type NaniteManagerKey = `installation:${number}`;

export function buildNaniteManagerKey(githubInstallationId: number): NaniteManagerKey {
  return `installation:${githubInstallationId}`;
}
