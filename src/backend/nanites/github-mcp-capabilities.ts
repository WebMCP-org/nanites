import type { GitHubAppPermissions } from "#/backend/github/index.ts";

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
  "sub_issue_write",
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

type GitHubAppPermissionName = "actions" | "issues" | "pull_requests";
type GitHubAppPermissionLevel = "read" | "write";

type NaniteRepositoryManifest = {
  permissions: {
    github?: {
      repositories?: readonly string[];
    };
  };
  eventSource:
    | {
        type: "github";
        repositories?: readonly string[];
      }
    | {
        type: string;
      };
};

export type NaniteGitHubMcpAccess = {
  toolsets: string[];
  deniedTools: string[];
  readonly: boolean;
};

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort();
}

export function resolveNaniteManifestRepositoryFullNames(
  manifest: NaniteRepositoryManifest,
): string[] {
  const repositories = new Set(manifest.permissions.github?.repositories ?? []);
  if (manifest.eventSource.type === "github") {
    for (const repository of manifest.eventSource.repositories ?? []) {
      repositories.add(repository);
    }
  }

  return uniqueSorted(repositories);
}

function grantsAtLeast(
  appPermissions: GitHubAppPermissions,
  permission: GitHubAppPermissionName,
  minimum: GitHubAppPermissionLevel,
): boolean {
  const granted = appPermissions[permission];
  if (!granted) {
    return false;
  }

  return minimum === "read" || granted === "write";
}

export function deriveNaniteGitHubMcpAccess(input: {
  appPermissions?: GitHubAppPermissions;
}): NaniteGitHubMcpAccess | null {
  const appPermissions = input.appPermissions ?? {};
  const toolsets = new Set(["context"]);
  const deniedTools = new Set<string>(defaultDeniedGitHubMcpTools);

  if (grantsAtLeast(appPermissions, "pull_requests", "read")) {
    toolsets.add("pull_requests");
  }

  if (grantsAtLeast(appPermissions, "actions", "read")) {
    toolsets.add("actions");
  }

  if (
    grantsAtLeast(appPermissions, "issues", "write") ||
    grantsAtLeast(appPermissions, "pull_requests", "write")
  ) {
    toolsets.add("issues");
  }
  if (!grantsAtLeast(appPermissions, "issues", "write")) {
    deniedTools.add("issue_write");
  }

  if (toolsets.size === 1) {
    return null;
  }

  return {
    toolsets: uniqueSorted(toolsets),
    deniedTools: uniqueSorted(deniedTools),
    readonly: !Object.values(appPermissions).some((level) => level === "write"),
  };
}
