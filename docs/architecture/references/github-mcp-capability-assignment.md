# GitHub MCP tool inventory assignment

Nanites should get GitHub API capability through scoped installation tokens plus an explicit MCP
tool inventory derived for that Nanite. The model that creates a Nanite declares repositories and
GitHub App permission grants; Sigvelo derives the MCP inventory from those grants and runtime
policy.

This keeps the runtime shape simple:

```text
Nanite identity -> scoped GitHub installation token -> constrained GitHub MCP tools -> Think work loop
```

It should not become:

```text
Nanite identity -> broad GitHub token -> full GitHub MCP -> hope the model avoids bad tools
```

## Why not classic PATs

A GitHub App installation cannot mint classic personal access tokens.

The tokens available from the installation boundary are GitHub App installation access tokens. Those
tokens are short-lived, start with `ghs_`, and can be restricted to specific repositories and GitHub
App permissions when they are issued.

That is the right trust shape for Nanites:

- the installation manager already owns the GitHub App installation boundary
- the Nanite manifest already names repository scope and GitHub App permission grants
- the manager can issue a fresh downscoped token for a work attempt
- GitHub remains the final API enforcement layer

Classic PATs are user-created `ghp_` tokens. They are useful to the official GitHub MCP server
because it can inspect their OAuth scopes and hide tools the token cannot use. They are not available
from our installation boundary, and they would be a worse automation primitive for Nanites.

Fine-grained PATs and GitHub App installation tokens do not expose OAuth scopes in the same way.
The official GitHub MCP server will not automatically hide tools for those tokens. GitHub will still
reject unauthorized API calls, but the model may see tools it cannot successfully use unless Sigvelo
filters the MCP inventory first.

## Official GitHub MCP behavior

The official GitHub MCP server supports the controls we need:

- `Authorization: Bearer <token>` for PATs or GitHub App tokens
- `X-MCP-Tools` for an explicit tool allowlist
- `X-MCP-Toolsets` for toolset-level enablement
- `X-MCP-Exclude-Tools` for hard exclusions
- `X-MCP-Readonly` for read-only mode

For Nanites, prefer `X-MCP-Tools` over broad toolsets. Toolsets are convenient for humans, but
Nanites are vertical. A docs-sync Nanite usually needs PR and status tools derived from its token
grants, not every issue, project, notification, gist, and repository mutation surface.

Cloudflare Think can connect to MCP servers through the Agents SDK. Think automatically merges MCP
tools into each turn, and `waitForMcpConnections` can make the inference loop wait for MCP discovery
before the model starts. That means GitHub MCP capability can be attached to the Nanite sub-agent
without adding another Sigvelo-specific tool registry.

## Permission-Derived Inventory

Do not ask the authoring model to choose a named tier or a specific MCP tool list. Derive the
inventory from `permissions.github.appPermissions`.

Default mapping:

| GitHub App permission    | Derived GitHub MCP tools                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `pull_requests: "read"`  | `list_pull_requests`, `search_pull_requests`, `pull_request_read`                          |
| `pull_requests: "write"` | read tools plus `create_pull_request`, `update_pull_request`, `update_pull_request_branch` |
| `actions: "read"`        | `actions_list`, `actions_get`                                                              |
| `issues: "write"`        | `add_issue_comment`                                                                        |

Always include `get_me` when any GitHub MCP inventory is attached. Do not attach GitHub MCP for a
Nanite whose permissions only support workspace git, such as `contents: "write"` with no PR, status,
or comment permissions.

## Tools to avoid by default

Do not expose these unless a Nanite has a specific reason and the operator accepted that capability:

```text
merge_pull_request
pull_request_review_write
add_comment_to_pending_review
add_reply_to_pull_request_comment
actions_run_trigger
issue_write
create_repository
fork_repository
create_or_update_file
push_files
delete_file
projects_write
create_gist
update_gist
```

`create_or_update_file`, `push_files`, and `delete_file` are especially important to keep out of the
default set. Workspace git should remain the normal code-change path because it gives the Nanite a
real working tree, durable workspace UI, diffs, branches, and reviewable commits.

## Prompt contract

The Nanite system prompt should make the division explicit:

```text
Use Workspace git tools for repository changes and branch pushes.
Use GitHub MCP for GitHub API tasks: finding existing PRs, creating PRs, updating PR metadata,
reading PR details, and reading check or workflow status.
Do not use GitHub MCP file-write tools.
Do not merge pull requests unless this Nanite was explicitly granted merge authority.
For stacked PRs:
- push branches with git
- create the bottom PR against the default branch
- create each higher PR against the branch below it
- include stack ordering in every PR description
Finish with the top PR URL, primary PR URL, or another useful output URL.
```

This is a prompt-level contract, not a manager-owned PR harness.

## Recommended implementation shape

The best production shape is a thin Sigvelo GitHub MCP proxy rather than storing short-lived GitHub
installation tokens inside durable MCP connection options.

```text
Think Nanite
  -> addMcpServer("github", "https://app.sigvelo.com/internal/nanites/{naniteId}/github-mcp")
  -> Sigvelo validates Nanite identity and permission-derived inventory
  -> Sigvelo issues a fresh installation token for the Nanite's repo and permission scope
  -> Sigvelo forwards to official GitHub MCP with locked MCP headers
```

Reasons:

- GitHub App installation tokens expire.
- The official GitHub MCP server does not scope-filter `ghs_` tokens.
- Sigvelo already knows the Nanite id, installation id, repositories, and GitHub App permissions.
- A proxy can enforce a hard upper bound even if the model tries to request additional tools.
- The Nanite still gets first-party GitHub MCP tool semantics.

For a pre-production shortcut, the Nanite agent can connect directly to the remote GitHub MCP server
with fresh headers when it starts a run. If that path stores a token across hibernation, it should be
treated as temporary.

## Nanite Definition Impact

The generated Nanite authoring model should not parameterize GitHub MCP separately. It declares
repository scope and GitHub App permission grants. Sigvelo derives the MCP tool inventory.

Example:

```ts
{
  permissions: {
    github: {
      repositories: ["WebMCP-org/docs", "WebMCP-org/npm-packages"],
      appPermissions: {
        contents: "write",
        pull_requests: "write",
        actions: "read",
      },
    },
  },
}
```

The manager should resolve this into an effective MCP attachment:

```ts
{
  repositories: ["WebMCP-org/docs", "WebMCP-org/npm-packages"],
  appPermissions: {
    contents: "write",
    pull_requests: "write",
    actions: "read",
  },
  mcpTools: [
    "get_me",
    "list_pull_requests",
    "search_pull_requests",
    "pull_request_read",
    "create_pull_request",
    "update_pull_request",
    "update_pull_request_branch",
    "actions_list",
    "actions_get",
  ],
  deniedTools: ["merge_pull_request", "create_or_update_file", "push_files", "..."],
}
```

The model can request permission grants. The manager owns validation and tool derivation.

## First slice

Start with permission-derived PR authoring: `contents: "write"` for workspace git pushes,
`pull_requests: "write"` for PR search/create/update, and `actions: "read"` when status or workflow
inspection is part of the Nanite's job.

This gives Nanites the missing GitHub API surface for stacked PRs without reintroducing support-lane
state or a one-PR manager harness.

## Source notes

- Official GitHub MCP source: `/Users/alexmnahas/.opensrc/repos/github.com/github/github-mcp-server/main`
- GitHub MCP remote server docs: `docs/remote-server.md`
- GitHub MCP scope filtering docs: `docs/scope-filtering.md`
- GitHub MCP HTTP inventory filtering source: `pkg/http/handler.go`
- GitHub MCP token parsing source: `pkg/utils/token.go`
- Cloudflare Think MCP merge point: `opensrc/repos/github.com/cloudflare/agents/packages/think/src/think.ts`
- Cloudflare Agents MCP client docs: `opensrc/repos/github.com/cloudflare/agents/docs/mcp-client.md`
