import type { GitHubInstallationId } from "@nanites/contracts/ids";
import { naniteManagerKeySchema, type NaniteManagerKey } from "@nanites/contracts/nanites";

export function buildNaniteManagerKey(
  githubInstallationId: GitHubInstallationId,
): NaniteManagerKey {
  return naniteManagerKeySchema.parse(`installation:${githubInstallationId}`);
}
