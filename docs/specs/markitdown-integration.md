---
title: MarkItDown MCP Integration
status: shipped
created: 2026-04-17
shipped: 2026-04-19
owner: santiago
council: modified — kills project-scope, 1-hour timeline, output-quality verified on real files
---

# Spec: MarkItDown MCP Integration (Global Only)

## Problem

Claude Code natively reads PDFs (≤20 pages), images, and text. It cannot read DOCX, PPTX, XLSX, audio, EPub, ZIP, YouTube transcripts, or large/scanned PDFs. Santiago receives client briefs in DOCX/PPTX, RFPs as 100+ page PDFs, financial models as multi-sheet XLSX, and Gemini meeting transcripts as DOCX — every one of these needed manual conversion before Claude could ingest them.

## Solution

Register Microsoft's official `markitdown-mcp` server **globally** (user `.claude.json` mcpServers). Available in every project on Santiago's Windows machine with zero per-project setup. If Sebas later needs it on Mac, 2-minute install with no config coordination.

**What changed from the original spec** (council recommendations applied):
- **Killed the project-scoped `iago-os/.mcp.json`.** Original spec registered in two places for "portability." Peer review unanimous: config files without the binary installed are symbolic. Dual-scope adds maintenance surface without delivering portability. Ship global. Revisit project scope only if a second machine hits real friction.
- **Collapsed 2-phase / 1-week timeline to 1 hour.** Executor advisor was right — this is a 20-minute install + 30-minute docs sitting, not a week-long project.
- **Verified MCP tool surface before writing docs.** Read `markitdown_mcp/__main__.py` source — server name `markitdown`, tool `convert_to_markdown(uri: str) -> str`. Docs now match reality.
- **Tested output quality on real files before shipping** (Reviewer 1–4 blind spot) — see Quality Results section below.
- **Deferred productization pitch entirely.** Revisit after 4 weeks of usage data.

## Scope

### In Scope (shipped 2026-04-19)
- Install `markitdown-mcp` + `markitdown` CLI via `pip install --user` on Windows
- Register in `C:/Users/sanal/.claude.json` under `mcpServers.markitdown` as `python -m markitdown_mcp`
- Update `CLAUDE.md` Memory Architecture table (added 5th row: MarkItDown)
- Update `.claude/rules/available-skills.md` MCP servers table (added markitdown row)
- Smoke-tested on 3 real files (DOCX, XLSX, PDF) across Spanish content

### Out of Scope (deferred)
- Project-scoped `iago-os/.mcp.json` — killed per council
- Custom plugin development (use upstream `markitdown-ocr` if OCR needed)
- HTTP/SSE transport (stdio sufficient; no current cross-process need)
- Azure Document Intelligence integration (paid; skip until a client needs scanned-PDF fidelity)
- LLM-powered image descriptions inside markitdown (Claude reads images natively)
- Audio transcription extras (Whisper adds ~1.5GB; install `pipx inject markitdown-mcp openai-whisper` only when an audio workflow demands it)
- Mac install docs for Sebas — 2-minute run of `brew install pipx && pipx install markitdown-mcp` when he needs it
- `/iago-proposal` and `/iago-plan` skill front-matter updates — discoverability noise per Executor

## Technical Approach

### Tool surface (verified from source)
- **Server name:** `markitdown` (FastMCP)
- **Transport:** stdio (default)
- **Tool:** `convert_to_markdown(uri: str) -> str`
- **URI schemes accepted:** `http:`, `https:`, `file:`, `data:`
- **Implementation:** `MarkItDown().convert_uri(uri).markdown`
- **Package versions:** `markitdown 0.1.5`, `markitdown-mcp 0.0.1a4` (note: MCP wrapper is alpha — monitor for breaking changes)

### Install (Windows, shipped)
```bash
python -m pip install --user markitdown-mcp
```
Installs to `C:/Users/sanal/AppData/Roaming/Python/Python312/site-packages/`. Scripts in `...Python312/Scripts/` (markitdown.exe, markitdown-mcp.exe). We invoke via `python -m markitdown_mcp` to avoid PATH dependency.

### Global registration (shipped)
`C:/Users/sanal/.claude.json` mcpServers block:
```json
"markitdown": {
  "type": "stdio",
  "command": "python",
  "args": ["-m", "markitdown_mcp"],
  "env": {}
}
```
Matches the pattern of `graphify` and `mempalace` entries (both `python -m module`). No symlink/PATH resolution; fires as long as Python 3.12 is on Claude Code's PATH (it is — `where python` resolves).

### Mac install (when Sebas needs it)
```bash
brew install pipx && pipx install markitdown-mcp
```
pipx installs an isolated virtualenv — `python -m markitdown_mcp` won't work. Use the pipx-managed entry point in his `.claude.json` mcpServers:
```json
"markitdown": {
  "type": "stdio",
  "command": "markitdown-mcp",
  "args": [],
  "env": {}
}
```
(`pipx install` places `markitdown-mcp` on PATH via `~/.local/bin/`.)

### Memory layer mapping
| Layer | Role | Interaction with markitdown |
|---|---|---|
| Obsidian | Storage | Markitdown → markdown → `write_note` (markitdown produces, Obsidian stores) |
| Graphify | Analysis | Reads vault. Picks up markitdown-produced notes at next nightly rebuild |
| MemPalace | Conversation history | Captures conversations that include markitdown output |
| MarkItDown | Conversion | NEW. Document → markdown. Upstream producer for the other three |

No conflicts — markitdown sits upstream, not parallel.

## Quality Results (real-file smoke test)

Tested on: `DIN - DEMO 3.docx` (Gemini meeting notes, Spanish), `MUNET_Modelo_Financiero.xlsx` (multi-sheet model, Spanish), `SENTRIA_TECHNICAL_DESIGN_DOCUMENT.pdf`.

| Format | UTF-8 | Structure | Verdict |
|---|---|---|---|
| DOCX | ✅ clean (MCP path: UTF-8 via JSON transport; CLI on Windows: requires `-o` flag, not `>` redirect) | ✅ headings, bullets, anchor links preserved | Production-quality |
| XLSX | ✅ clean | ⚠️ empty cells serialize as `NaN`, first row not auto-promoted to headers (`Unnamed: 1`) | Usable — Claude parses through the noise |
| PDF | ✅ clean | ⚠️ headings duplicated on adjacent lines (pdfminer layout quirk) | Usable — content preserved, noisy but parseable |

**CLI caveat (Windows only):** stdout redirection (`markitdown file.docx > out.md`) breaks encoding to CP1252. MCP calls are unaffected — the server uses the Python API directly over JSON, which is always UTF-8. CLI usage must use `markitdown -o out.md file.docx` (file-output flag, not redirect).

## Open Items

1. **MCP timeout for 500+ page PDFs** — not exercised in smoke test. If a future workflow hits a timeout, set env `MCP_TIMEOUT=60000` in Claude Code or fall back to `markitdown file.pdf -o out.md` in Bash for outliers.
2. **markitdown-mcp is alpha (0.0.1a4).** Monitor for breaking changes between core (`0.1.5`) and wrapper. Pin if upstream churn becomes disruptive.
3. **XLSX header detection.** Current output has `Unnamed: 1` columns and `NaN` cell fills. Claude handles the noise today, but if XLSX-heavy workflows emerge, look at pandas-based preprocessing or a thin plugin.

## Delivery Timeline (actual)

**Shipped in ~1 hour, 2026-04-19:**
- Install `pip install --user markitdown-mcp`: 5 min
- Smoke-test 3 real files (DOCX + XLSX + PDF), identify CP1252 vs UTF-8 issue, retest with `-o` flag: 15 min
- Read `markitdown_mcp/__main__.py` to verify tool surface: 2 min
- Register in `.claude.json`: 2 min
- Update `CLAUDE.md` + `available-skills.md`: 10 min
- Write this spec: 20 min

Total: ~54 minutes. Original spec estimate (1 week / 2 phases) was 10-20× inflated.

## Verification

After this session ends, restart Claude Code. Run `/mcp` — `markitdown` should appear connected. To test end-to-end, ask Claude in any project: "Convert `file:///C:/Users/sanal/dev/obsidian-brain/meetings/_inbox/processed/DIN - DEMO 3.docx` to markdown." Claude should call `mcp__markitdown__convert_to_markdown` and return the Spanish meeting notes with UTF-8 preserved.
