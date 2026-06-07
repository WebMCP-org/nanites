# Agent Setup

Use this guide to connect Codex, Claude Code, or another MCP client to Nanites.

There are two supported paths:

| Path                 | Use when                                                       |
| -------------------- | -------------------------------------------------------------- |
| Packaged plugin      | Your agent supports plugins and should get skills plus MCP.    |
| Standalone skill/MCP | You want explicit config or your client does not load plugins. |

Do not install both for the same client unless you are testing duplicate-load behavior.

## What The Plugin Contains

The plugin payload lives in `plugins/nanites`:

| File or directory                            | Purpose                                  |
| -------------------------------------------- | ---------------------------------------- |
| `plugins/nanites/skills/nanites`             | Canonical Nanites skill and references.  |
| `plugins/nanites/commands`                   | Command prompts for common Nanite tasks. |
| `plugins/nanites/assets/examples`            | Example Nanite manifests and fixtures.   |
| `plugins/nanites/.mcp.json`                  | Production Sigvelo MCP config.           |
| `plugins/nanites/.mcp.example.json`          | Optional operator MCP servers.           |
| `plugins/nanites/.codex-plugin/plugin.json`  | Codex plugin manifest.                   |
| `plugins/nanites/.claude-plugin/plugin.json` | Claude Code plugin manifest.             |

The Codex and Claude Code marketplaces both point at the same `plugins/nanites` directory. Keep
skills, examples, commands, and MCP config there instead of copying them into client-specific trees.

## Codex Plugin

Add the marketplace:

```bash
codex plugin marketplace add WebMCP-org/nanites
```

Then install `nanites` from the `sigvelo` marketplace in the Codex plugin UI.

For local testing from a checkout:

```bash
codex plugin marketplace add ./
```

Codex CLI currently exposes marketplace management for plugins. Direct plugin installation happens
through the Codex plugin UI for this workflow.

## Claude Code Plugin

Add the marketplace and install the plugin:

```bash
claude plugin marketplace add WebMCP-org/nanites
claude plugin install nanites@sigvelo
```

For local testing from a checkout:

```bash
claude plugin marketplace add ./
claude plugin install nanites@sigvelo
```

## Standalone Skill And MCP

Install only the Nanites skill:

```bash
npx --yes skills add WebMCP-org/nanites --skill nanites --global --copy --agent codex claude-code -y
```

Then add the hosted Sigvelo MCP server:

```bash
npx --yes add-mcp https://app.sigvelo.com/mcp --name sigvelo --transport http --global --agent codex --agent claude-code --yes
```

For a local checkout:

```bash
git clone https://github.com/WebMCP-org/nanites.git
cd nanites
npx --yes skills add . --skill nanites --global --copy --agent codex claude-code -y
npx --yes add-mcp https://app.sigvelo.com/mcp --name sigvelo --transport http --global --agent codex --agent claude-code --yes
```

## Direct MCP Setup

Codex:

```bash
codex mcp add sigvelo --url https://app.sigvelo.com/mcp
codex mcp login sigvelo
```

Claude Code:

```bash
claude mcp add --transport http sigvelo https://app.sigvelo.com/mcp
```

Generic MCP JSON:

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

For local development, replace the URL with:

```text
http://localhost:5173/mcp
```

## Optional Operator MCP Servers

Use `plugins/nanites/.mcp.example.json` when the agent also needs Cloudflare operator access for
deployment, logs, or observability. The extra Cloudflare servers are for operating Nanites, not for
ordinary Nanite authoring.

## Verify Access

After connecting, call `sigvelo_whoami`. Confirm the response shows the expected actor,
installation, client, and scopes.

Expected scopes:

- `nanites:read` for inspection
- `nanites:write` for creation, trigger tests, manual runs, cancellation, reset, and deprovisioning

Useful first calls:

| Tool                               | Use it to                                      |
| ---------------------------------- | ---------------------------------------------- |
| `sigvelo_whoami`                   | Verify auth and scopes.                        |
| `sigvelo_debug_nanites`            | Inspect existing Nanites before changing them. |
| `sigvelo_create_nanite`            | Create or update one Nanite.                   |
| `sigvelo_test_nanite_trigger`      | Test generated trigger behavior.               |
| `sigvelo_start_nanite_run`         | Start a manual run.                            |
| `sigvelo_explore_nanite_workspace` | Inspect child-owned workspace files.           |

For authoring rules, trigger examples, and debugging payloads, use the Nanites skill bundled in the
plugin or installed through the standalone skill path.
