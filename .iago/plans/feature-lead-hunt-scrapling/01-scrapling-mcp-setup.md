---
phase: feature-lead-hunt-scrapling
plan: 01
wave: 1
depends_on: []
context: inline
created: 2026-05-28
source: feature
---

# Plan: feature-lead-hunt-scrapling/01-scrapling-mcp-setup

## Goal

Install Scrapling with AI extras and register its built-in MCP server as a global stdio server in `~/.claude.json`, exposing the 6 fetch tools (`get`, `bulk_get`, `fetch`, `bulk_fetch`, `stealthy_fetch`, `bulk_stealthy_fetch`) to all Claude Code sessions on this machine.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `C:/Users/sanal/.claude.json` | Register Scrapling MCP under top-level `mcpServers` (sibling to `markitdown`, `youtube-transcript`, `obsidian`) |
| create | `.iago/handoff/scrapling-install-log.md` | Capture install output, Python/Scrapling versions, and any browser-download warnings for future debugging |

## Tasks

### Task 1: Install Scrapling with AI extras and browsers
- **files:** none (global Python install)
- **action:** Run `pip install "scrapling[ai]"` in the global Python environment used by existing MCP servers (same env as `markitdown_mcp` and `mcp_youtube_transcript`). Then run `scrapling install` to download Playwright + Camoufox browsers. Capture both stdout/stderr to a temp file for the next task. Requires Python 3.10+; if the active Python is older, STOP and report.
- **verify:** `python -c "import scrapling; print(scrapling.__version__)"`
- **expected:** Scrapling version prints (e.g., `0.3.6` or newer) and exits 0. Note: the Scrapling CLI has no `--version` flag (exposes subcommands only: `extract`, `install`, `mcp`, `shell`); use the import check only.

### Task 2: Determine MCP launch shape (Windows-safe)
- **files:** none
- **action:** Existing global MCPs (`markitdown`, `youtube-transcript`) use `"command": "python", "args": ["-m", "<module>"]` — Windows-safe because it does not depend on Scripts/ being on the PATH that Claude Code inherits. Test if Scrapling supports the same pattern: run `python -m scrapling mcp --help 2>&1 | head -40`. If exit 0 and help text shows the `mcp` subcommand, the launch shape will be `{"command":"python","args":["-m","scrapling","mcp"]}`. If it fails, fall back to absolute-path form: locate the scrapling binary via `python -c "import shutil; print(shutil.which('scrapling'))"` and use `{"command":"<absolute-path-to-scrapling.exe>","args":["mcp"]}`. Do NOT actually start the server (it blocks on stdio). Record which shape will be used in Task 4's install log.
- **verify:** `python -m scrapling mcp --help 2>&1 | head -10 || (python -c "import shutil; print(shutil.which('scrapling'))" && echo "FALLBACK: use absolute path")`
- **expected:** Either `python -m scrapling mcp --help` prints help (preferred) OR `shutil.which('scrapling')` prints an absolute path (fallback). **Note (from install log):** the preferred shape does NOT work on this machine — `scrapling` has no `__main__.py`. The fallback (absolute path to `scrapling.EXE`) was used. If re-running, expect to hit the fallback path again.

### Task 3: Register Scrapling MCP in `~/.claude.json`
- **files:** `C:/Users/sanal/.claude.json`
- **action:** Add a new entry under the top-level `mcpServers` object (NOT under any project-scoped `mcpServers: {}`), keyed `"scrapling"`. Use the launch shape determined in Task 2 (`python -m scrapling mcp` preferred; absolute-path fallback otherwise). Include `"env": {}` for stylistic consistency with sibling entries. Back up `~/.claude.json` to `~/.claude.json.bak-{YYYY-MM-DD}-HHMMSS-scrapling` (full timestamp prevents same-day collision). After edit, validate JSON with `python -m json.tool` AND do an offline MCP round-trip smoke test: send `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}` to the launch command via stdin with a 5s timeout, expect a JSON response containing `"result"` and `"serverInfo"`. If round-trip fails, restore from backup and STOP.
- **verify:** `python -m json.tool ~/.claude.json > /dev/null && grep -A 5 '"scrapling"' ~/.claude.json`
- **expected:** JSON is valid (exit 0) and the grep shows the registered scrapling entry with the chosen launch shape and `"env": {}`.

### Task 4: Capture install log
- **files:** `.iago/handoff/scrapling-install-log.md`
- **action:** Write a markdown file recording: `pip install` output (last 30 lines), Python version (`python --version`), Scrapling version, `scrapling install` browser-download summary, and any warnings/errors observed. End with one line stating `~/.claude.json` was backed up to `<path>` and the scrapling MCP entry was added.
- **verify:** `wc -l .iago/handoff/scrapling-install-log.md`
- **expected:** File exists and has ≥15 lines documenting the install.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-28

**CONTRADICTION (Critical, fixed inline):** Original launch shape `{"command":"scrapling","args":["mcp"]}` depended on PATH containing Python Scripts/ dir, which Claude Code's non-interactive launch context may not have. Fixed in Task 2/3: prefer `python -m scrapling mcp` (matches existing markitdown/youtube-transcript pattern) with absolute-path fallback.

**EDGE CASE (Important, fixed inline):** Same-day re-run would overwrite the `.bak-{YYYY-MM-DD}` backup. Fixed: timestamp now includes `HHMMSS`.

**MISSING ACCEPTANCE CRITERIA (Important, fixed inline):** No scripted MCP round-trip test before commit. Added: offline `initialize` JSON-RPC stdin probe with 5s timeout in Task 3 before declaring done.

**EDGE CASE (Forwarded to impl):** `scrapling install` may fail or partial-succeed for Camoufox download on Windows (admin prompt, antivirus, partial extract). Implementer should treat any non-zero exit OR any `WARNING`/`ERROR` line containing "Camoufox" or "Firefox" as failure and STOP, not as benign.

**PRECISION (Forwarded to impl):** "Global Python env used by markitdown" — implementer must confirm `python --version` and `pip --version` resolve to the same interpreter that runs `python -m markitdown_mcp` successfully. If they differ, use that exact interpreter for `pip install`.

## Verification

After all tasks, restart any open Claude Code session (close + reopen). Then in a new session run `/mcp` and confirm `scrapling` appears in the connected-servers list with the 6 required tools (`get`, `bulk_get`, `fetch`, `bulk_fetch`, `stealthy_fetch`, `bulk_stealthy_fetch`) — the server actually exposes 10 total (including `open_session`, `close_session`, `list_sessions`, `screenshot`), so seeing 10 is correct. If tools don't surface, check `~/.claude.json.bak-*` for rollback.
