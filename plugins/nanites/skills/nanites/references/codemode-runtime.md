# Codemode Runtime

Use this reference when debugging or authoring Nanite and manager prompts that run code inside `execute`.

`execute` runs Worker-compatible JavaScript against provider namespaces. It is not a shell. Do not use `git`, `gh`, `pnpm`, `child_process`, `require()`, or subprocess commands inside `execute`.

## Provider Namespaces

- `state.*`: workspace filesystem and durable workspace primitives.
- `git.*`: Cloudflare shell git provider backed by isomorphic-git. Use `dir` for repository roots.
- `github.*`: GitHub API surfaces such as pull requests, issues, checks, workflows, and metadata.
- `cdp.*`: browser automation when the Nanite runtime enables a browser binding.

Use workspace/state plus `git.*` for files, branches, commits, and pushes. Use `github.*` for PRs, issues, checks, workflow state, comments, and repository metadata.

## Type Discovery

Codemode exposes provider schemas as TypeScript-like call shapes. Use the common calls directly; use `codemode.search` and `codemode.describe` when a method name or argument shape is unfamiliar.

```ts
await codemode.search("git status branch commit push pull request");
await codemode.describe("git");
await codemode.describe("github.list_pull_requests");
```

## Common Calls

```ts
await git.status({ dir });
await git.checkout({ dir, branch: "feature-branch" });
await git.add({ dir, filepath: "README.md" });
await git.commit({ dir, message: "Update docs" });
await git.push({ dir, remote: "origin", ref: "feature-branch" });

await state.readFile({ path: `${dir}/AGENTS.md` });
await github.list_pull_requests({ owner, repo, state: "open" });
await github.create_pull_request({ owner, repo, title, head, base, body });
```

## Runtime Rules

- Preflight PR-producing work with a small `github.*` read, such as listing open PRs.
- Do not use `github.*` for repository file contents, branch mutation, commits, or pushes unless the operation is pure metadata; use workspace/state and `git.*`.
- Verify browser clicks before reporting success. Check the URL, hash, title, heading, focused element, scroll position, or DOM state that proves navigation or interaction happened.
- If a provider is missing or unauthorized, report the missing surface. Do not add manager-owned harness code unless it enforces product policy or an authorization boundary.
