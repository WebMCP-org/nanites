---
description: Create or update a Sigvelo Nanite through MCP.
---

Use the `nanites` skill. Confirm Sigvelo MCP access with `sigvelo_whoami`, inspect existing Nanites with `sigvelo_debug_nanites`, and investigate the target repo plus repo-local instructions when available. Draft one strict manifest for: $ARGUMENTS. Use `eventSource` for coarse intake, root `triggerSource` for GitHub or schedule behavior, and `permissions.github` for repository/app permission scope. Do not include `trigger`, `inboundTrigger`, `capabilities`, MCP tiers, tool allowlists, or a manager name. Register with `sigvelo_create_nanite`, then test with `sigvelo_test_nanite_trigger` for generated triggers or `sigvelo_start_nanite_run` for manual behavior.
