import { z } from "zod";
import type { GitHubInstallationRepository } from "#/backend/github/index.ts";

const sigveloMcpVisibleRepositoryPermissionsSchema = z
  .object({
    admin: z.boolean().optional(),
    maintain: z.boolean().optional(),
    push: z.boolean().optional(),
    triage: z.boolean().optional(),
    pull: z.boolean().optional(),
  })
  .passthrough();

export const sigveloMcpVisibleRepositorySchema = z.object({
  id: z.number().int().positive(),
  node_id: z.string().min(1),
  full_name: z.string().min(1),
  private: z.boolean(),
  permissions: sigveloMcpVisibleRepositoryPermissionsSchema,
});

export type SigveloMcpVisibleRepository = z.output<typeof sigveloMcpVisibleRepositorySchema>;

export function createSigveloMcpVisibleRepositorySnapshot(
  repository: GitHubInstallationRepository,
): SigveloMcpVisibleRepository {
  return sigveloMcpVisibleRepositorySchema.parse({
    id: repository.id,
    node_id: repository.node_id,
    full_name: repository.full_name,
    private: repository.private,
    permissions: repository.permissions ?? {},
  });
}
