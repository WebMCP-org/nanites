import { deriveNaniteGitHubMcpAccess } from "#/backend/nanites/github-mcp-capabilities.ts";

test("Nanite GitHub MCP tools are derived from GitHub App permissions", () => {
  const access = deriveNaniteGitHubMcpAccess({
    appPermissions: {
      actions: "read",
      contents: "write",
      pull_requests: "write",
    },
  });

  expect(access).toMatchObject({
    readonly: false,
    appPermissions: {
      actions: "read",
      contents: "write",
      pull_requests: "write",
    },
  });
  expect(access?.tools).toEqual([
    "actions_get",
    "actions_list",
    "create_pull_request",
    "get_me",
    "list_pull_requests",
    "pull_request_read",
    "search_pull_requests",
    "update_pull_request",
    "update_pull_request_branch",
  ]);
});

test("Nanite GitHub MCP is skipped when permissions only support workspace git", () => {
  expect(
    deriveNaniteGitHubMcpAccess({
      appPermissions: {
        contents: "write",
      },
    }),
  ).toBeNull();
});
