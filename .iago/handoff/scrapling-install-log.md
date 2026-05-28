# Scrapling MCP — Install Log

**Date:** 2026-05-28
**Plan:** `feature-lead-hunt-scrapling/01-scrapling-mcp-setup`
**Machine:** Windows 11 (Santiago)

## Environment

- **Python:** 3.12.10 (`C:\Users\sanal\AppData\Local\Programs\Python\Python312\python.exe`) — meets the 3.10+ requirement.
- **pip:** 26.0.1
- Confirmed this is the same interpreter that runs the existing global MCP servers (`python -m markitdown_mcp` and `python -m mcp_youtube_transcript` both import/run from this env).

## Task 1 — `pip install "scrapling[ai]"`

**Result:** Success. `scrapling-0.4.8` installed.

Last lines of the pip output:

```
Successfully installed anyio-4.13.0 apify-fingerprint-datapoints-0.13.0 browserforge-1.2.4 \
  click-8.4.1 cssselect-1.4.0 curl_cffi-0.15.0 lxml-6.1.1 mcp-1.26.0 msgspec-0.21.1 \
  orjson-3.11.9 patchright-1.59.1 playwright-1.59.0 protego-0.6.0 scrapling-0.4.8 \
  tld-0.13.2 w3lib-2.4.1
```

**Version checks:**
- `python -c "import scrapling; print(scrapling.__version__)"` → `0.4.8` (exit 0)
- NOTE: the plan's `scrapling --version` verify step is **not valid** for this version — the
  Scrapling CLI has no `--version` flag (exit 2: "No such option '--version'"). The CLI exposes
  subcommands only (`extract`, `install`, `mcp`, `shell`). Version confirmed via the import check
  above instead. Not a failure.

### Dependency conflicts (pip resolver warnings — investigated, BENIGN)

pip emitted two conflict warnings. Both were investigated and confirmed harmless at runtime:

```
markitdown-mcp 0.0.1a4 requires mcp~=1.8.0, but you have mcp 1.26.0 which is incompatible.
chromadb 0.6.3 requires chroma-hnswlib==0.7.6, but you have chroma-hnswlib 0.7.5 which is incompatible.
```

- **mcp bump (1.8.1 → 1.26.0):** Caused by `scrapling[ai]` pulling a newer `mcp`. `markitdown-mcp`
  pins `mcp~=1.8.0`, so pip flags it. **Verified the markitdown MCP server still works** via a live
  JSON-RPC `initialize` round-trip after the bump — it responds normally (`serverInfo.name =
  "markitdown"`). The pin is conservative; markitdown does not use any removed 1.x API. No action
  needed. (The conflict text once showed a transient "mcp 1.27.1"; the actually-installed and
  running version is **1.26.0**.)
- **chroma-hnswlib:** PRE-EXISTING, unrelated to this install. `chroma-hnswlib` is NOT in the
  "Successfully installed" list — it belongs to mempalace's `chromadb` and was already mismatched
  before this work. Out of scope; left untouched.

## Task 1 (cont.) — `scrapling install` (Fetcher dependencies / browsers)

**Result:** exit 0. Output:

```
Installing Playwright browsers...
Installing Playwright dependencies...
```

- No `Camoufox`/`Firefox` warnings or errors (the stress-test STOP condition did not trigger).
- This version of Scrapling's stealth path uses **patchright** (`patchright-1.59.1`, a stealth
  Playwright fork — installed by the `[ai]` extra), **not** the standalone `camoufox` package.
  `camoufox` is intentionally absent; `scrapling install` reports it installs "all Scrapling's
  Fetchers dependencies" and exited clean.
- Chromium browsers present in `C:\Users\sanal\AppData\Local\ms-playwright`
  (`chromium-1217`, `chromium_headless_shell-1217`).

## Task 2 — MCP launch shape (Windows-safe)

The plan's preferred shape `python -m scrapling mcp` **does NOT work** — `scrapling` is a package
with no `__main__.py` ("'scrapling' is a package and cannot be directly executed"). `python -m
scrapling.cli` runs but the click group does not dispatch cleanly (exit 0, no output).

**Fallback used (per plan):** absolute path to the installed launcher.

- `shutil.which('scrapling')` → `C:\Users\sanal\AppData\Local\Programs\Python\Python312\Scripts\scrapling.EXE`
- console_scripts entry point: `scrapling -> scrapling.cli:main`
- `scrapling.EXE mcp --help` confirms the `mcp` subcommand, default transport **stdio**
  (matches the other global stdio MCP servers).

**Chosen launch shape:**

```json
{ "command": "C:\\Users\\sanal\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\scrapling.EXE", "args": ["mcp"] }
```

## Task 3 — Register in `~/.claude.json`

- Added under the **top-level** `mcpServers` object (sibling to `markitdown`, `youtube-transcript`,
  `obsidian`, `workspace-mcp`, etc.) — NOT under any project-scoped `mcpServers`.
- Entry includes `"type": "stdio"` and `"env": {}` for consistency with siblings.
- Edit done via a Python json load→dump (verified byte-identical round-trip beforehand, written with
  `newline=''` to avoid CRLF injection on Windows) so the only diff is the additive scrapling block.
- `python -m json.tool ~/.claude.json` → valid (exit 0).

**Verification round-trips (offline JSON-RPC `initialize`, 4–5s timeout):**
- Against the launch command directly → `serverInfo = {"name": "Scrapling", "version": "1.26.0"}`, PASS.
- Against the command **read from the registered config** → PASS.
- `tools/list` returned **10 tools** — all 6 required (`get`, `bulk_get`, `fetch`, `bulk_fetch`,
  `stealthy_fetch`, `bulk_stealthy_fetch`) plus 4 bonus session/screenshot tools
  (`open_session`, `close_session`, `list_sessions`, `screenshot`). Superset of the plan's expected 6.

## Backup

`~/.claude.json` was backed up to:

```
C:/Users/sanal/.claude.json.bak-2026-05-28-151639-scrapling
```

The `scrapling` MCP entry was then added to the top-level `mcpServers` object. If the tools fail to
surface in a new session, restore from the backup above and re-investigate the launch shape.

## Next step (manual)

Restart Claude Code (close + reopen), run `/mcp`, and confirm `scrapling` appears connected with its
fetch tools. Registration and offline round-trip already confirm the server boots and responds.
