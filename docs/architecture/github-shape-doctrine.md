# GitHub Shape Doctrine

## Decision

GitHub-owned data stays GitHub-shaped throughout SigVelo.

SigVelo is pre-production. Apply this doctrine as a hard cutover, not a backwards
compatible migration. Do not preserve old SigVelo-shaped GitHub DTOs, compatibility aliases, fallback
fields, or dual-read/dual-write paths unless a live production deployment explicitly requires them.

When SigVelo reads GitHub data through Octokit, the Octokit endpoint response type is the
canonical type. SigVelo must not invent a parallel DTO, rename GitHub fields, compress GitHub
objects into smaller app-owned shapes, or normalize GitHub vocabulary into SigVelo vocabulary unless
that transformation creates a real SigVelo product fact.

Rules for this refactor:

- Use `RestEndpointMethodTypes[...]` and webhook payload types directly.
- Use GitHub field names such as `full_name`, `default_branch`, `avatar_url`, and `permissions`.
- Pass full Octokit objects through browser/API responses.
- Send full GitHub payloads even when the current UI only uses a few fields.
- Persist full GitHub objects.
- Add relational key columns only for identity, uniqueness, joins, indexes, and SigVelo lifecycle.
- Keep any relational GitHub columns aligned with Octokit names and types.
- Add SigVelo fields beside GitHub data instead of folding GitHub data into SigVelo names.

The goal is fewer files, fewer helper functions, fewer local types, and less shape churn. The target
state is zero normalization functions for GitHub data unless the function owns a real boundary
policy, auth decision, lifecycle transition, or error behavior.
The Nanite runtime is the complex part of the product; GitHub plumbing stays boring and thin.

## Why

GitHub is the first vertical. Its API already gives the product a coherent vocabulary: installations,
repositories, owners, permissions, pull requests, check runs, branches, commits, and webhook payloads.
Octokit already models that vocabulary and keeps it aligned with GitHub.

Every SigVelo-only copy of a GitHub shape adds work:

- the reader has to learn a second name for the same fact
- tests and fixtures have to maintain parallel shapes
- API and database mappers have to translate fields back and forth
- future changes have to decide which representation is authoritative
- agents are more likely to copy the local adapter pattern and grow the codebase

The simpler rule is: if GitHub owns the fact, GitHub owns the shape.

## Default Shape

Use the full Octokit object.

Do not start with `Pick<...>` just because the current screen only displays a few fields. The rest of
the GitHub object is still part of the user's domain, and keeping it available avoids a new adapter
when the product needs another GitHub field later.

Do not redeclare Octokit types locally. If the product needs to add SigVelo data, compose beside the
Octokit type:

```ts
type RepositoryWithRunCount = {
  repository: GitHubInstallationRepository;
  runCount: number;
};
```

Do not replace the source type with a local subset:

```ts
type InstallationRepository = Pick<
  GitHubInstallationRepository,
  "id" | "name" | "full_name" | "default_branch"
>;
```

`Pick`, local DTOs, and local Zod copies of Octokit objects are optimizations of last resort, not
design tools for this cutover.

This applies to backend code, admin views, browser/API responses, tests, and fixtures. Do not
pre-optimize payload size, API documentation readability, or frontend exposure by creating smaller local
GitHub DTOs. Optimize those boundaries later if they become real problems.

Browser and admin APIs send the full GitHub payload. A UI that only reads
`repository.full_name` still receives the whole repository object. Unused GitHub fields are not
a problem to solve during this cutover; local copies and narrowing adapters are.

A smaller shape is allowed only after a concrete boundary constraint has actually appeared:

- a cookie or session payload would become too large
- a public browser/API response would expose data we explicitly do not want to expose
- generated API documentation would become unusably noisy
- a database query/index needs dedicated relational columns
- the data is no longer a GitHub fact and has become a SigVelo product fact

Those exceptions must be local, named after the boundary, and treated as optimizations. They do not
replace the Octokit shape as the canonical GitHub model.

## Persistence

Persistence preserves GitHub objects.

The persistence model is:

1. store the full Octokit/GitHub object exactly as returned
2. store only the scalar columns needed for identity, uniqueness, joins, indexes, and SigVelo-owned
   lifecycle

The raw GitHub object remains the canonical application shape. Relational columns are projections for
SQLite mechanics, not a second data model.

For example, a repository table uses this kind of shape:

```text
account_id
github_installation_id
github_repository_id
github_repository_json
first_seen_at
last_seen_at
```

over a table that expands every displayed GitHub field into SigVelo-owned columns.

When a GitHub field is promoted to a relational column, the column must still match the Octokit
field's vocabulary and type as closely as SQLite allows:

```text
github_repository_id
full_name
default_branch
private
permissions_admin
permissions_push
permissions_pull
```

Those columns are indexes or query projections over the canonical GitHub object. They must not
force the rest of the codebase to use a DB-shaped repository type.

The relational model must not introduce lossy app vocabulary such as `permission_tier` unless the
product truly has a first-class concept called a permission tier.

## SigVelo-Owned Data

SigVelo-owned facts stay SigVelo-shaped.

Examples:

- selected installation in a browser session
- session expiration
- Nanite identity, scope, soul, and stop conditions
- Run lifecycle, status, phase, conclusion, and outcome
- computed counts such as `runCount`
- risk flags and admin business metrics
- AI usage and platform usage facts
- entitlement and billing data

These facts are not GitHub API facts. They must not be forced into GitHub vocabulary.

The required composition is:

```ts
type RepositoryAdminRow = {
  repository: GitHubInstallationRepository;
  runCount: number;
};
```

not:

```ts
type RepositoryAdminRow = {
  githubRepositoryId: number;
  fullName: string;
  defaultBranch: string;
  permissionTier: "admin" | "push" | "read" | null;
  runCount: number;
};
```

## Anti-Patterns

Do not introduce or preserve these unless there is a documented boundary reason:

- `full_name` -> `fullName`
- `default_branch` -> `defaultBranch`
- `avatar_url` -> `avatarUrl`
- `owner.login` -> `ownerLogin`
- `permissions` -> `permissionTier`
- `GitHubInstallationRepository` -> `InstallationRepository`
- `GitHubVisibleInstallation` -> locally invented installation DTOs
- `Pick<GitHubInstallationRepository, ...>` as the app's repository model
- mappers whose only job is to rename GitHub fields
- schemas that recreate an Octokit shape with minor omissions
- fixtures that use SigVelo-shaped GitHub data instead of GitHub-shaped data

## Validation Boundaries

Runtime validation still matters at untrusted boundaries.

For browser APIs, cookies, MCP tool inputs, and webhook ingestion, use Zod only when the boundary needs
runtime checks. The response shape remains the full GitHub object. If validation is
needed, validate GitHub-shaped data instead of inventing SigVelo field names for GitHub facts.

If a schema intentionally narrows a GitHub object, name it after the boundary:

```ts
browserInstallationRepositorySchema;
sessionInstallationSnapshotSchema;
```

Do not name it as if it replaced the Octokit source type. Add a short comment in the same file
stating which boundary requires the narrower shape.

## Refactor Rule

When touching GitHub-shaped code, ask:

1. Does Octokit already provide this shape?
2. Are we only renaming fields?
3. Are we only dropping fields because the current caller does not need them?
4. Are we compressing GitHub facts into a lossy SigVelo concept?
5. Could the caller accept the Octokit object plus a small SigVelo-owned wrapper?

If the answer is yes, delete the adapter and use the Octokit shape.

Because this is a pre-production hard cutover, use direct replacement instead of compatibility
shims. Rename callers, update tests, and delete the old shape in the same slice.

## Initial Cleanup Targets

The current high-value cleanup areas are:

- repository list and repository snapshot shapes
- installation/account session shapes
- admin account and repository read models
- duplicate GitHub account normalizers
- mapper functions that convert Octokit repositories into local repository DTOs
- tests and fixtures that encode SigVelo-shaped GitHub objects

The target is not a new abstraction. The target is to remove local abstractions that duplicate
Octokit.

## Agent Goal Prompt

Read `docs/architecture/github-shape-doctrine.md`, then refactor the codebase in small verified
steps so GitHub-owned data uses full Octokit/GitHub objects directly. Delete local GitHub DTOs,
normalizers, mappers, renamed fields, and `Pick`-based copies unless they enforce a documented
SigVelo policy or lifecycle boundary. This repo is pre-production: make a hard cutover with no
compatibility shims, dual shapes, or fallback aliases. Browser/admin APIs must send full GitHub
payloads even when the UI only uses a few fields. Preserve functionality and run `vp check` and
`vp test` after each slice.
