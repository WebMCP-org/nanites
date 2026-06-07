---
description: Write or review generated SigVelo Nanite trigger code.
---

Use the `nanites` skill. Write or review root `manifest.triggerSource` generated trigger code for: $ARGUMENTS. Prefer `import { defineGitHubTrigger } from "@sigvelo/nanite-trigger"` for GitHub triggers. Make `eventSource` the coarse filter and `triggerSource` the precise decision. Return `ctx.noop(...)` with useful reasons or `ctx.dispatchSelf(...)` with a small flat payload. Do not call SigVelo tools, edit repositories, fan out to other Nanites, fetch GitHub, or own lifecycle state in the trigger.
