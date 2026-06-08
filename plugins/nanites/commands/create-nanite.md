---
description: Create or update a SigVelo Nanite through MCP.
---

Use the `nanites` skill. Confirm SigVelo MCP access with `sigvelo_whoami`, inspect existing Nanites with `sigvelo_debug_nanites`, and investigate the target repo plus repo-local instructions when available. Draft one strict manifest for: $ARGUMENTS. Include `model` as `{ "mode": "deployment_default" }` unless a concrete Cloudflare catalog model is required, use `eventSource` for coarse intake, root `triggerSource` for GitHub or schedule behavior, and `permissions.github` for repository/app permission scope. Do not include `trigger`, `inboundTrigger`, `capabilities`, gateway ids, BYOK aliases, provider API keys, MCP tiers, tool allowlists, or a manager name. Register with `sigvelo_create_nanite`, then test with `sigvelo_test_nanite_trigger` for generated triggers or `sigvelo_start_nanite_run` for manual behavior.
