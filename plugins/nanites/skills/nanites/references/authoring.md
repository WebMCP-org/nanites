# Authoring

Use this reference when drafting Nanite manifests, deciding GitHub permission scope, or writing generated inbound triggers.

## What Makes a Good Nanite

A good Nanite is a durable specialist. It owns one narrow maintenance loop, can explain its scope in one sentence, and has clear done/no-change/fail conditions. It should be easy to pause, inspect, replace, or split without changing the rest of the installation.

Prefer:

- package docs syncer
- release note verifier
- one smoke-path maintainer
- PR quality guard for one repo family

Avoid:

- all-purpose repo maintainer
- generated runtime class
- hidden workflow coordinator
- broad GitHub comment bot
- manifest that tries to choose every tool

## Manifest Shape

Use the live MCP schema as the final authority. The create schema is strict: unexpected fields are rejected.

Future model selection work is tracked in
[`docs/architecture/nanite-model-config-plan.md`](../../../../../docs/architecture/nanite-model-config-plan.md).
Do not include `manifest.model` in live create payloads until that plan is implemented; the current
schema rejects it.

GitHub machine-source Nanite:

```json
{
  "manifest": {
    "id": "docs-syncer-react-webmcp",
    "name": "React WebMCP Docs Syncer",
    "description": "Keeps React WebMCP docs aligned with package changes.",
    "eventSource": {
      "type": "github",
      "events": ["push"],
      "repositories": ["WebMCP-org/npm-packages"],
      "branches": ["main"]
    },
    "permissions": {
      "github": {
        "repositories": ["WebMCP-org/npm-packages", "WebMCP-org/docs"],
        "appPermissions": {
          "contents": "write",
          "pull_requests": "write",
          "actions": "read"
        }
      }
    },
    "triggerSource": "import { defineGitHubTrigger } from '@sigvelo/nanite-trigger'; export default defineGitHubTrigger({ event: 'push', async handle(event, ctx) { if (event.payload.repository.full_name !== 'WebMCP-org/npm-packages') return ctx.noop('Different repository.'); if (event.payload.ref !== 'refs/heads/main') return ctx.noop('Not the main branch.'); return ctx.dispatchSelf({ reason: 'Relevant push', repository: event.payload.repository.full_name, before: event.payload.before, after: event.payload.after }); } });"
  },
  "enabled": true
}
```

Manual Nanite:

```json
{
  "manifest": {
    "id": "repo-health-checker",
    "name": "Repo Health Checker",
    "description": "Answers manual maintenance questions for one repo surface.",
    "eventSource": {
      "type": "manual"
    },
    "permissions": {
      "github": {
        "repositories": ["WebMCP-org/nanites"],
        "appPermissions": {
          "contents": "read",
          "pull_requests": "read",
          "actions": "read"
        }
      }
    }
  },
  "enabled": true
}
```

Schedule source shape:

```json
{
  "eventSource": {
    "type": "scheduleEvery",
    "intervalSeconds": 86400
  },
  "triggerSource": "export default { async handle(event, ctx) { return ctx.dispatchSelf({ reason: 'Daily scheduled check' }); } };"
}
```

For `eventSource.type: "schedule"`, use `when` with a delayed seconds number, a cron string, or an ISO date string. Schedule and GitHub sources require root `triggerSource`.

Authoring checklist:

- identity: stable `id`, `name`, and `description`
- scope: repositories and owned files, packages, docs, workflows, or product surfaces
- intake: `eventSource` as the coarse candidate filter
- behavior: root `triggerSource` for machine-originated sources
- authority: `permissions.github.repositories` and `permissions.github.appPermissions`
- stop conditions: make done, no-change, fail, and ask-human conditions explicit in the description or run prompt

Do not include:

- `trigger`
- `inboundTrigger`
- `capabilities`
- `manager`
- MCP tiers or tool allowlists
- generated runtime classes
- caller-owned ids, timestamps, run records, or lifecycle state

## GitHub Permission Scope

GitHub MCP capability is derived from `permissions.github`. The authoring model should request repository scope and GitHub App permission grants, not individual MCP tools.

Use Workspace git tools for file changes, branches, commits, and pushes. Use derived GitHub MCP tools for PR lookup, PR creation/update, workflow/check reads, and other GitHub API work that fits the granted app permissions.

Typical permission grants:

- `contents: "read"` for inspection-only Nanites.
- `contents: "write"` when the Nanite may branch, commit, or push changes.
- `pull_requests: "read"` for PR review or lookup.
- `pull_requests: "write"` when the Nanite may create or update PRs.
- `actions: "read"` for workflow/check investigation.
- `checks: "write"` only when the Nanite needs manager-owned check projection.
- `issues: "write"` only when PR comments or issue surfaces are part of the Nanite's job.

Keep GitHub data GitHub-shaped. Use Octokit webhook event names, payload field names, and permission names instead of inventing SigVelo DTOs.

## Generated Trigger Runtime

Generated trigger code is for machine-originated events: GitHub webhooks, schedules, and future external events. It routes an event to the owning Nanite or returns no-op. It does not do the maintenance work itself.

For GitHub triggers, prefer the virtual trigger package:

```ts
import { defineGitHubTrigger } from "@sigvelo/nanite-trigger";
```

The facade exposes Octokit-backed webhook payload types and the small manager intent API:

```ts
type TriggerContext = {
  dispatchSelf(input?: Record<string, unknown>): TriggerIntent;
  noop(reason: string): TriggerIntent;
  record(message: string, data?: unknown): TriggerIntent;
};
```

Runtime rules:

- The generated Worker must export default `{ handle(event, ctx) }`; `defineGitHubTrigger(...)` returns that shape.
- Static validation rejects empty source, oversized source, `eval`, `new Function`, runtime WebAssembly compilation, and Node process/filesystem/network imports.
- Current trigger validation may skip deep Octokit semantic diagnostics, so fixture tests and `agentFeedback` are the real acceptance loop.
- `ctx.dispatchSelf(...)` input is normalized into JSON-safe scalar or array fields. Nested objects are JSON-stringified; prefer flat fields such as `repository`, `pullNumber`, `headSha`, `after`, `files`, and `reason`.
- `ctx.record(...)` is a no-op intent with a recorded reason. Use it only when the event should not dispatch.

## Good Trigger Checklist

- Let `eventSource` cheaply narrow candidates by event family, repository, action, and branch.
- In `triggerSource`, re-check the facts that matter: repository, action, branch, path, label, author, or changed-file set.
- Return `ctx.noop(...)` for every irrelevant branch with a reason another agent can debug.
- Dispatch only the owning Nanite. Do not fan out, call other Nanites, or call SigVelo MCP tools from trigger code.
- Keep dispatch payloads small and bounded. Slice file lists and include enough commit or PR identity for the Think Nanite to investigate.
- Do not write to GitHub, mutate workspace files, start shell work, own lifecycle state, or push branches from a trigger.
- Do not fetch GitHub in trigger code unless the runtime explicitly adds a scoped read helper. The current contract is payload plus manager intents.

## Trigger Examples

Push path filter:

```ts
import { defineGitHubTrigger } from "@sigvelo/nanite-trigger";

export default defineGitHubTrigger({
  event: "push",
  async handle(event, ctx) {
    if (event.payload.repository.full_name !== "WebMCP-org/npm-packages") {
      return ctx.noop("Different repository.");
    }

    if (event.payload.ref !== "refs/heads/main") {
      return ctx.noop("Not the main branch.");
    }

    const changed = event.payload.commits.flatMap((commit) => [
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? []),
    ]);
    const files = changed.filter((file) => file.startsWith("packages/react-webmcp/"));

    if (files.length === 0) {
      return ctx.noop("No React WebMCP package files changed.");
    }

    return ctx.dispatchSelf({
      reason: "React WebMCP package changed",
      repository: event.payload.repository.full_name,
      before: event.payload.before,
      after: event.payload.after,
      files: files.slice(0, 50),
    });
  },
});
```

Pull request review dispatch:

```ts
import { defineGitHubTrigger } from "@sigvelo/nanite-trigger";

export default defineGitHubTrigger({
  events: ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"],
  async handle(event, ctx) {
    const action = event.payload.action;
    if (!["opened", "synchronize", "reopened"].includes(action)) {
      return ctx.noop(`Ignored pull request action: ${action}`);
    }

    return ctx.dispatchSelf({
      reason: "Pull request needs quality review",
      repository: event.payload.repository.full_name,
      pullNumber: event.payload.pull_request.number,
      headSha: event.payload.pull_request.head.sha,
    });
  },
});
```

Schedule tick:

```ts
export default {
  async handle(_event, ctx) {
    return ctx.dispatchSelf({
      reason: "Scheduled maintenance check",
    });
  },
};
```

## MCP Acceptance

After `sigvelo_create_nanite`, test the real path:

```json
{
  "naniteId": "docs-syncer-react-webmcp",
  "event": {
    "fixture": "push",
    "overrides": {
      "repository": {
        "full_name": "WebMCP-org/npm-packages",
        "name": "npm-packages",
        "owner": {
          "login": "WebMCP-org"
        }
      },
      "ref": "refs/heads/main",
      "commits": [
        {
          "id": "test000000000001",
          "added": [],
          "modified": ["packages/react-webmcp/README.md"],
          "removed": []
        }
      ]
    }
  },
  "testInstruction": "This is a trigger acceptance test. Verify you received the payload and call no_change with useful agentFeedback.",
  "waitForTerminalOutcome": true,
  "timeoutMs": 120000
}
```

If the test returns `triggerAcceptedEvent: false`, read `acceptance.triggerRejectionReason` before changing code. If the trigger dispatches a Nanite run, use terminal run status and `agentFeedback` as the acceptance result.

## Bundle Examples

Example files live in `plugins/nanites/assets/examples/`.

Start with:

- `docs-syncer.push.nanite.json`: push-triggered docs syncer.
- `pr-review.pull-request.nanite.json`: PR-triggered reviewer/guard.

The examples are enabled so `sigvelo_create_nanite` can register them and `sigvelo_test_nanite_trigger` can exercise the real trigger path. Disable a Nanite only when you want it registered but intentionally skipped by trigger dispatch.
