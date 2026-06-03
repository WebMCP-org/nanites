export type NaniteManagerKey = `installation:${number}`;

export function buildNaniteManagerKey(githubInstallationId: number): NaniteManagerKey {
  return `installation:${githubInstallationId}`;
}
