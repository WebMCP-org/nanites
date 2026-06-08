<p align="center">
  <img src="public/assets/nanite.gif" alt="Nanites banner" width="520" />
</p>

<h1 align="center">Nanites</h1>

<p align="center">
  Small durable agents that maintain GitHub repositories under one installation.
</p>

<p align="center">
  <a href="docs/agent-setup.md">Agent setup</a> ·
  <a href="docs/architecture/README.md">How it works</a> ·
  <a href="docs/self-hosting.md">Self-hosting</a> ·
  <a href="docs/architecture/roadmap.md">Roadmap</a> ·
  <a href="docs/development.md">Development</a>
</p>

<p align="center">
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/runtime-Cloudflare%20Workers-f38020?style=flat-square&labelColor=0d1520" />
  <img alt="Durable Objects" src="https://img.shields.io/badge/state-Durable%20Objects-0f7b6c?style=flat-square&labelColor=0d1520" />
  <img alt="GitHub App" src="https://img.shields.io/badge/auth-GitHub%20App-2d5a8a?style=flat-square&labelColor=0d1520" />
  <img alt="MCP" src="https://img.shields.io/badge/surface-MCP-7eb8c9?style=flat-square&labelColor=0d1520" />
  <img alt="Vite Plus" src="https://img.shields.io/badge/toolchain-Vite%2B-8ba7b8?style=flat-square&labelColor=0d1520" />
</p>

Nanites are named, durable collaborators for GitHub maintenance. Each Nanite owns one narrow loop:
a docs page family, package area, smoke path, CI guard, release lane, or other recurring workflow
that should stay legible and reviewable.

Install the GitHub App once, then create many small maintainers. SigVelo routes GitHub events,
schedules, chat, and MCP tool calls to the right Nanite. The Nanite investigates, edits, tests,
opens reviewable GitHub work, and records a lifecycle outcome.

## Why Nanites

| Need                   | Nanites answer                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Many small maintainers | One GitHub installation hosts many narrow durable agents.                           |
| Clear ownership        | Each Nanite has a scope, purpose, stop conditions, and visible run outcome.         |
| Programmable intake    | Generated triggers decide which GitHub events or schedules should start work.       |
| Durable execution      | Think sub-agents keep the transcript, memory, workspace, and lifecycle boundary.    |
| Scoped authority       | GitHub App permissions and repository grants determine the runtime tools.           |
| Reviewable output      | GitHub remains the artifact surface for branches, PRs, checks, and reviewer action. |

## Install

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

Nanites skill:

```bash
npx --yes skills add WebMCP-org/nanites --skill nanites --global --copy --agent codex claude-code -y
```

Codex plugin:

```bash
codex plugin marketplace add WebMCP-org/nanites
```

Claude Code plugin:

```bash
claude plugin marketplace add WebMCP-org/nanites
claude plugin install nanites@sigvelo
```

For local checkouts, standalone MCP commands, and Cloudflare operator MCP servers, see
[Agent setup](docs/agent-setup.md).

## What You Can Build

- a docs syncer that wakes on package changes and updates the matching docs PR
- a smoke-path maintainer that investigates failed CI and proposes fixes
- a release guard that checks changelogs, workflow status, and package metadata
- a PR quality reviewer scoped to one repo family or product surface
- a scheduled repo health Nanite that reports drift without opening noisy work

## Docs

| Start here                                                     | Use it for                                      |
| -------------------------------------------------------------- | ----------------------------------------------- |
| [Agent setup](docs/agent-setup.md)                             | Codex, Claude Code, standalone skills, and MCP. |
| [Architecture](docs/architecture/README.md)                    | Product model and runtime planes.               |
| [Execution model](docs/architecture/execution-architecture.md) | Durable Nanite run lifecycle.                   |
| [User stories](docs/architecture/user-stories.md)              | Product workflows and expected outcomes.        |
| [Roadmap](docs/architecture/roadmap.md)                        | Planned product work.                           |
| [Self-hosting](docs/self-hosting.md)                           | Run your own Cloudflare and GitHub App setup.   |
| [Development](docs/development.md)                             | Local app setup and repo commands.              |
| [Contributing](CONTRIBUTING.md)                                | Project contribution workflow.                  |
| [Security](SECURITY.md)                                        | Responsible disclosure.                         |

## Project Shape

The app is a Cloudflare Worker runtime backed by Durable Objects, D1, R2, Workers AI/Think, Worker
Loader, and GitHub App installation auth. The model-facing plugin lives in `plugins/nanites`.

Local development uses Vite+:

```bash
vp install
vp run dev
vp check
vp test
```

See [Development](docs/development.md) for the detailed local setup.

## Open Source

Nanites is Apache-2.0 licensed. Before opening a change, run:

```bash
vp check
vp test
vp build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project workflow and [SECURITY.md](SECURITY.md) for
responsible disclosure.
