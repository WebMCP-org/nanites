---
description: Create or update a Sigvelo Nanite through MCP.
---

Use the `nanites` skill. Confirm Sigvelo MCP access with `sigvelo_whoami`, inspect existing Nanites with `sigvelo_debug_nanites`, draft a thin manifest for: $ARGUMENTS, use `eventSource` for coarse intake and root `triggerSource` for generated TypeScript, use Cloudflare Agent schedule language directly for time-based intake (`schedule` with `when`, or `scheduleEvery` with `intervalSeconds`), prefer `@sigvelo/nanite-trigger` in trigger source, register with `sigvelo_create_nanite`, and test with `sigvelo_test_nanite_trigger` or `sigvelo_start_nanite_run`.
