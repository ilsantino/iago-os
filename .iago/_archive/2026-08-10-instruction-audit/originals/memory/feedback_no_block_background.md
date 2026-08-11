---
name: Don't block on background tasks
description: Mining, indexing, and similar background tasks should not block config/setup flow
type: feedback
---

Don't block the setup flow waiting for background tasks like mining, indexing, or model downloads. Finish the config, note the background command, move on.

**Why:** MCP servers restart per session anyway, so mining results aren't usable until next session. Running mining in the foreground wastes session time.

**How to apply:** When setting up tools with both config and data-loading steps, complete all config first, then note the data-loading command as a follow-up the user can run later or in background.
