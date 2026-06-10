# Operations

Use this reference when connecting an agent to SigVelo, preparing a deployment, testing a Nanite through MCP, or debugging a stuck/broken run.

## Setup Checklist

1. Confirm target environment: local, staging, or production.
2. Check GitHub CLI is installed and authenticated:

```bash
gh --version
gh auth status
gh api user --jq '{login,id}'
```

3. Check Cloudflare/Wrangler access when deployment or provisioning is involved:

```bash
vp exec wrangler whoami
```

4. Connect the SigVelo MCP server and authenticate through OAuth.
5. Call `sigvelo_whoami`.
6. Confirm:
   - `githubInstallationId` is the intended installation
   - `githubLogin` is the expected actor
   - scopes include `nanites:read`
   - write workflows also include `nanites:write`

## Runtime Surfaces

SigVelo MCP is for Nanite creation, trigger tests, manual starts, runtime debugging, and workspace exploration.

Cloudflare MCP is for operator setup, provisioning, deploy troubleshooting, logs, and observability.

GitHub CLI (`gh`) is for verifying the operator identity and GitHub App setup. Do not assume Nanite runtime shell sessions have authenticated `gh` unless the runtime explicitly injects `GH_TOKEN`.

MCP clients may display tools under a connector namespace, but the callable tool names exposed by the SigVelo server start with `sigvelo_`.

## MCP Connection

Production MCP endpoint:

```json
{
  "mcpServers": {
    "sigvelo": {
      "type": "http",
      "url": "https://app.sigvelo.com/mcp"
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http sigvelo https://app.sigvelo.com/mcp
```

Generic MCP clients can use the plugin root `.mcp.json` as the production config and `.mcp.example.json` for optional Cloudflare support servers. Replace the SigVelo URL for local or staging environments.

Expected scopes:

- Read: `nanites:read`
- Write: `nanites:write`

Local MCP smoke tests can use the GitHub CLI token already stored in the user's keychain. Do not print or commit the token. Start the local app with:

```bash
ALLOW_TEST_AUTH=true GITHUB_TEST_USER_TOKEN="$(gh auth token)" vp run dev
```

Run that from the repository root, then point MCPJam at the local server:

```bash
mcpjam oauth login \
  --url http://localhost:5173/mcp \
  --scopes "nanites:read nanites:write" \
  --verify-tools
```

## MCP Acceptance Loop

1. Call `sigvelo_whoami`.
2. Call `sigvelo_debug_nanites` before changing an existing Nanite.
3. Register or update one Nanite with `sigvelo_create_nanite`.
4. For generated triggers, call `sigvelo_test_nanite_trigger` with fixture overrides that should pass the trigger filters.
5. If the test dispatches a model, inspect terminal run status and `agentFeedback`.
6. If it fails or times out, inspect transcript/submissions and workspace.
7. Update the manifest or trigger and repeat until the Nanite reaches a useful terminal outcome.

Trigger test:

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

Direct manual run:

```json
{
  "naniteId": "docs-syncer-react-webmcp",
  "message": "Inspect your workspace and explain what you own. Do not modify GitHub. Call no_change when done.",
  "waitForTerminalOutcome": true,
  "timeoutMs": 120000
}
```

Debug summary:

```json
{
  "naniteId": "docs-syncer-react-webmcp",
  "include": ["nanites", "runs", "runtimeActivity"],
  "limit": 10
}
```

Debug transcript and submissions:

```json
{
  "naniteId": "docs-syncer-react-webmcp",
  "include": ["nanites", "runs", "manifest", "triggerSource", "transcript", "submissions"],
  "transcript": {
    "limit": 25,
    "includeParts": true,
    "maxTextLength": 4000
  },
  "submissions": {
    "limit": 25
  }
}
```

Workspace search:

```json
{
  "naniteId": "docs-syncer-react-webmcp",
  "action": "search",
  "path": "/",
  "query": "packages/react-webmcp",
  "limit": 50
}
```

Cleanup:

```json
{
  "naniteId": "docs-syncer-react-webmcp",
  "limit": 25,
  "reason": "Cancel stale acceptance-test runs before retesting"
}
```

```json
{
  "naniteId": "docs-syncer-react-webmcp",
  "reason": "Reset transcript after replacing invalid trigger instructions"
}
```

```json
{
  "naniteId": "docs-syncer-react-webmcp",
  "reason": "Remove obsolete experimental Nanite"
}
```

Use those payloads with `sigvelo_cancel_nanite_runs`, `sigvelo_reset_nanite_debug`, and `sigvelo_deprovision_nanite`, respectively.

## MCP Tool Summary

- `sigvelo_whoami`: returns MCP auth context, actor, installation, client, and scopes.
- `sigvelo_create_nanite`: creates or updates a strict Nanite manifest. It registers the durable Think Nanite but does not have to start a run.
- `sigvelo_debug_nanites`: inspects manager state and, when requested, child-owned Think transcript/submissions.
- `sigvelo_deprovision_nanite`: removes one obsolete Nanite and its debug/run state.
- `sigvelo_start_nanite_run`: starts a manual Nanite run.
- `sigvelo_cancel_nanite_runs`: cancels pending or running Nanite runs.
- `sigvelo_test_nanite_trigger`: builds a GitHub fixture, evaluates generated trigger code, dispatches accepted runs, and optionally waits for terminal outcome.
- `sigvelo_explore_nanite_workspace`: explores workspace info, list, read, and search actions.
- `sigvelo_reset_nanite_debug`: clears child-owned Think messages and durable submissions for one Nanite.

## Troubleshooting

Trigger accepted no event:

- Read `acceptance.triggerRejectionReason` first. It should include generated-trigger no-op reasons or manager dispatch/idempotency details when available.
- Check `eventSource` candidate filters.
- Check whether the Nanite is enabled.
- Check fixture type and overrides.
- Check generated trigger repository, branch, action, label, and path assumptions.
- Watch for repeated idempotency keys in repeated tests.

Generated trigger validation failed:

- Read the error phase first: `static`, `bundle`, `load`, `execute`, `response`, `parse`, or `intent`.
- Fix forbidden dynamic code, missing default `handle`, invalid returned intents, or runtime exceptions before changing Nanite prompt instructions.
- Use `defineGitHubTrigger` for GitHub payload shape and event-name guidance, but remember deep Octokit semantic diagnostics may be skipped.

Run created but model not dispatched:

- Check `dispatchError` in `sigvelo_debug_nanites`.
- Inspect submissions.

Timed out waiting for terminal outcome:

- Inspect `runtimeActivity`, Think submissions, transcript tail, and workspace state.
- Cancel stale runs with `sigvelo_cancel_nanite_runs` before retesting.

Nanite failed:

- Read terminal run summary, transcript, and `agentFeedback`.
- Prefer fixing prompt, permission, workspace, or trigger shape before adding manager harness code.

Missing GitHub tools:

- Check `permissions.github.repositories` and `permissions.github.appPermissions`.
- Do not add a manifest `capabilities` block; the create schema rejects model-authored runtime capability blocks.
- GitHub MCP inventory is intentionally derived and scoped.

Empty or stale GitHub outcome links:

- Check the lifecycle tool call and `outputUrl`.
- Current review links should point at the best PR, change proposal, run, or human checkpoint entrypoint.

## Cloudflare Resources

Required resources for deployment and self-hosting:

- Worker with static assets
- Durable Objects: `SigveloNaniteManager`, `SigveloNaniteAgent`
- Worker Loader binding: `LOADER`
- D1 database: `DB`
- R2 bucket: `WORKSPACE_FILES`
- KV namespaces: `OAUTH_KV`, `TOOL_OUTPUTS`
- Workers AI binding: `AI`
- Browser binding: `BROWSER`

Useful commands:

```bash
vp install
vp exec wrangler whoami
vp exec wrangler d1 create nanites-db
vp exec wrangler r2 bucket create nanites-workspace-files
vp exec wrangler kv namespace create OAUTH_KV
vp exec wrangler kv namespace create TOOL_OUTPUTS
vp exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

Manual/local fallback Worker secrets:

```bash
vp exec wrangler secret put AUTH_COOKIE_SECRET --config wrangler.jsonc
vp exec wrangler secret put GITHUB_APP_PRIVATE_KEY --config wrangler.jsonc
vp exec wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.jsonc
vp exec wrangler secret put GITHUB_WEBHOOK_SECRET --config wrangler.jsonc
```

## GitHub App

Use the deployed SigVelo origin for URLs:

- Callback URL: `https://<origin>/auth/github/callback`
- Webhook URL: `https://<origin>/api/github/webhook`
- Webhook events: `push`, `pull_request`

Typical app permissions:

- `contents`: read/write for file branches and commits
- `pull_requests`: read/write for PR work
- `checks`: read/write for Nanite check projection
- `actions`: read for workflow/check investigation
- `issues`: read/write when PR comments or issue surfaces are needed
