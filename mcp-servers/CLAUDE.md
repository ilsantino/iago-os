# mcp-servers/ — MCP servers hosted in iaGO-OS

This directory holds standalone MCP servers built by iaGO-OS.
Currently: `youtube-transcript/` (Python).

MCP servers stay at the top level (not under `.claude/`) per audit
§10.5 Q2 decision (2026-05-25, KEEP top-level): they are independent
projects with their own dependencies, tests, and registration
semantics. The youtube-transcript MCP is registered globally via
`~/.claude.json` — do not move it without re-registering.

## Adding a new MCP server

When adding a new MCP server: create `mcp-servers/{name}/` as its own
project (own `package.json` or `pyproject.toml`, own tests). Register
globally; iaGO-OS does not auto-load them.
