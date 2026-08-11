---
name: /lead-hunt skill
description: Global Claude Code skill at ~/.claude/skills/lead-hunt/ — Scrapling-MCP-backed lead discovery, free, iaGO prospecting
type: project
originSessionId: c59cd3aa-37ee-41b9-bab5-a70c7d509ef8
---
`/lead-hunt` is a global Claude Code skill (lives at `~/.claude/skills/lead-hunt/`, not in any repo). Uses the globally-registered Scrapling MCP (`~/.claude.json`) to scrape public sites and emit a canonical Lead CSV with confidence scores + `needs_apollo_validation` flag.

**Files:** `SKILL.md` (112L) + `eval.md` (68L) + `runbook.md` (49L). Self-contained.

**Use:** iaGO prospecting, high-value-target enrichment (5-50 leads, public directories/profiles). Hybrid with Apollo per runbook — Scrapling does discovery (free, volume), Apollo does validation/enrichment (paid, quirurgico).

**Don't use:** authenticated platforms (LinkedIn logueado, Apollo UI) or volume >100 leads where Apollo is more efficient.

**Smoke test pending:** never empirically run. Close by invoking `/lead-hunt --source https://www.amhpac.org/socios/ --target-role "director general OR CEO" --max 5` in a fresh interactive session.

**Scrapling MCP** also globally available — 6 tools: `get`, `bulk_get`, `fetch`, `bulk_fetch`, `stealthy_fetch`, `bulk_stealthy_fetch`. Launches via absolute scrapling.exe path (no `python -m scrapling mcp` — package lacks `__main__.py`).
