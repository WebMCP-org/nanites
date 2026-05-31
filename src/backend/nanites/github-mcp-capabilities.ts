import type { GitHubAppPermissions } from "#/backend/github-types.ts";
import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);

const naniteGitHubMcpCapabilityTiers = [
  "github_pr_read",
  "github_pr_author",
  "github_ci_reader",
] as const;

export type NaniteGitHubMcpCapabilityTier = (typeof naniteGitHubMcpCapabilityTiers)[number];

export const naniteCapabilitySpecSchema = z
  .object({
    githubMcp: z
      .union([
        z.object({
          tier: z
            .enum(naniteGitHubMcpCapabilityTiers)
            .describe(
              "Named GitHub MCP tool tier granted to the Nanite. The manager infers the GitHub App permissions required by the tier.",
            ),
          extraTools: z
            .array(nonEmptyStringSchema)
            .optional()
            .describe("Additional GitHub MCP tools requested for this Nanite."),
          deniedTools: z
            .array(nonEmptyStringSchema)
            .optional()
            .describe("GitHub MCP tools explicitly denied even if a tier would include them."),
          readonly: z.boolean().optional().describe("Force GitHub MCP read-only mode."),
        }),
        z.object({
          tools: z
            .array(nonEmptyStringSchema)
            .min(1)
            .describe(
              "Explicit GitHub MCP tool allowlist for this Nanite. The manager infers the GitHub App permissions required by the tools.",
            ),
          deniedTools: z
            .array(nonEmptyStringSchema)
            .optional()
            .describe("GitHub MCP tools explicitly denied."),
          readonly: z.boolean().optional().describe("Force GitHub MCP read-only mode."),
        }),
      ])
      .optional()
      .describe("Constrained GitHub MCP capability attached to the Think Nanite."),
  })
  .default({})
  .describe("External tool capabilities granted to a Nanite.");

export type NaniteCapabilitySpec = z.infer<typeof naniteCapabilitySpecSchema>;
export type NaniteGitHubMcpCapability = NonNullable<NaniteCapabilitySpec["githubMcp"]>;

export type EffectiveNaniteGitHubMcpCapability = {
  tools: string[];
  deniedTools: string[];
  readonly: boolean;
  appPermissions: GitHubAppPermissions;
};

const githubMcpTierTools = {
  github_pr_read: ["get_me", "list_pull_requests", "search_pull_requests", "pull_request_read"],
  github_pr_author: [
    "get_me",
    "list_pull_requests",
    "search_pull_requests",
    "pull_request_read",
    "create_pull_request",
    "update_pull_request",
    "update_pull_request_branch",
  ],
  github_ci_reader: ["pull_request_read", "actions_list", "actions_get"],
} as const satisfies Record<NaniteGitHubMcpCapabilityTier, readonly string[]>;

const defaultDeniedGitHubMcpTools = [
  "merge_pull_request",
  "create_pull_request_review",
  "pull_request_review_write",
  "add_comment_to_pending_review",
  "add_pull_request_review_comment",
  "add_reply_to_pull_request_comment",
  "delete_pending_pull_request_review",
  "request_pull_request_reviewers",
  "resolve_review_thread",
  "submit_pending_pull_request_review",
  "unresolve_review_thread",
  "update_pull_request_draft_state",
  "actions_run_trigger",
  "create_issue",
  "issue_write",
  "create_repository",
  "fork_repository",
  "create_or_update_file",
  "push_files",
  "delete_file",
  "projects_write",
  "create_gist",
  "update_gist",
  "discussion_comment_write",
  "request_copilot_review",
  "assign_copilot_to_issue",
  "star_repository",
  "unstar_repository",
] as const;

type RequiredGitHubMcpToolPermission = {
  permission: keyof GitHubAppPermissions;
  level: "read" | "write";
};

const requiredGitHubAppPermissionsByTool: Record<string, RequiredGitHubMcpToolPermission> = {
  get_file_contents: { permission: "contents", level: "read" },
  list_commits: { permission: "contents", level: "read" },
  list_branches: { permission: "contents", level: "read" },
  create_branch: { permission: "contents", level: "write" },
  pull_request_read: { permission: "pull_requests", level: "read" },
  list_pull_requests: { permission: "pull_requests", level: "read" },
  search_pull_requests: { permission: "pull_requests", level: "read" },
  create_pull_request: { permission: "pull_requests", level: "write" },
  update_pull_request: { permission: "pull_requests", level: "write" },
  update_pull_request_branch: { permission: "pull_requests", level: "write" },
  add_issue_comment: { permission: "issues", level: "write" },
  actions_list: { permission: "actions", level: "read" },
  actions_get: { permission: "actions", level: "read" },
};

const githubMcpToolsWithoutAppPermissions = new Set(["get_me"]);

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort();
}

function mergeGitHubAppPermissionLevel(
  current: GitHubAppPermissions[keyof GitHubAppPermissions] | undefined,
  required: "read" | "write",
): "read" | "write" {
  return current === "write" || required === "write" ? "write" : "read";
}

function mergeGitHubAppPermissions(
  base: GitHubAppPermissions,
  inferred: GitHubAppPermissions,
): GitHubAppPermissions {
  const merged: GitHubAppPermissions = { ...base };
  for (const [permission, level] of Object.entries(inferred) as [
    keyof GitHubAppPermissions,
    "read" | "write",
  ][]) {
    merged[permission] = mergeGitHubAppPermissionLevel(merged[permission], level);
  }
  return merged;
}

function inferGitHubAppPermissionsForMcpTools(tools: string[]): GitHubAppPermissions {
  const permissions: GitHubAppPermissions = {};
  for (const tool of tools) {
    const required = requiredGitHubAppPermissionsByTool[tool];
    if (!required) {
      if (githubMcpToolsWithoutAppPermissions.has(tool)) {
        continue;
      }
      throw new Error(
        `GitHub MCP tool ${tool} is not mapped to GitHub App permissions. Add its permission mapping before allowing it on a Nanite.`,
      );
    }
    permissions[required.permission] = mergeGitHubAppPermissionLevel(
      permissions[required.permission],
      required.level,
    );
  }

  return permissions;
}

export function resolveNaniteGitHubMcpCapability(input: {
  capability: NaniteGitHubMcpCapability | undefined;
  appPermissions?: GitHubAppPermissions;
}): EffectiveNaniteGitHubMcpCapability | null {
  if (!input.capability) {
    return null;
  }

  const requestedTools =
    "tools" in input.capability
      ? input.capability.tools
      : [...githubMcpTierTools[input.capability.tier], ...(input.capability.extraTools ?? [])];
  const deniedTools = uniqueSorted([
    ...defaultDeniedGitHubMcpTools,
    ...(input.capability.deniedTools ?? []),
  ]);
  const deniedToolSet = new Set(deniedTools);
  const capability = {
    tools: uniqueSorted(requestedTools).filter((toolName) => !deniedToolSet.has(toolName)),
    deniedTools,
    readonly: input.capability.readonly ?? false,
  };

  if (capability.tools.length === 0) {
    throw new Error("GitHub MCP capability must expose at least one allowed tool.");
  }

  return {
    ...capability,
    appPermissions: mergeGitHubAppPermissions(
      input.appPermissions ?? {},
      inferGitHubAppPermissionsForMcpTools(capability.tools),
    ),
  };
}
