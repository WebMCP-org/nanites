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

type GitHubAppPermissionName = "actions" | "issues" | "pull_requests";
type GitHubAppPermissionLevel = "read" | "write";

export type NaniteGitHubMcpAccess = {
  tools: string[];
  deniedTools: string[];
  readonly: boolean;
  appPermissions: GitHubAppPermissions;
};

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort();
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

function hasWritableGitHubPermission(appPermissions: GitHubAppPermissions): boolean {
  return Object.values(appPermissions).some((level) => level === "write");
}

export function deriveNaniteGitHubMcpAccess(input: {
  appPermissions?: GitHubAppPermissions;
}): NaniteGitHubMcpAccess | null {
  const appPermissions = input.appPermissions ?? {};
  const tools = new Set(["get_me"]);

  if (grantsAtLeast(appPermissions, "pull_requests", "read")) {
    tools.add("list_pull_requests");
    tools.add("search_pull_requests");
    tools.add("pull_request_read");
  }
  if (grantsAtLeast(appPermissions, "pull_requests", "write")) {
    tools.add("create_pull_request");
    tools.add("update_pull_request");
    tools.add("update_pull_request_branch");
  }

  if (grantsAtLeast(appPermissions, "actions", "read")) {
    tools.add("actions_list");
    tools.add("actions_get");
  }

  if (
    grantsAtLeast(appPermissions, "issues", "write") ||
    grantsAtLeast(appPermissions, "pull_requests", "write")
  ) {
    tools.add("add_issue_comment");
  }

  if (tools.size === 1) {
    return null;
  }

  return {
    tools: uniqueSorted(tools),
    deniedTools: uniqueSorted(defaultDeniedGitHubMcpTools),
    readonly: !hasWritableGitHubPermission(appPermissions),
    appPermissions,
  };
}
