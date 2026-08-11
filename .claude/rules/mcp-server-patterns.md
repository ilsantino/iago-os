---
description: >-
  MCP server layout conventions.
globs:
  - "**/mcp/**"
---

## MCP Servers

- Layout: `mcp/{server-name}/` — `index.ts` entry, `tools/` (one tool per file), `resources/`, `prompts/`.
- Tool names: `snake_case`, verb-first (`get_user`, `create_report`).
