---
phase: quick
plan: quick-260410-memory-stack
wave: 1
depends_on: []
created: 2026-04-10
branch: feat/memory-stack
base: main
---

# Quick: Memory stack addon layer

## Goal

Ship reusable, cross-platform memory infrastructure (MemPalace + Graphify) as an opt-in addon for iaGO-OS. Setup script installs everything, template configs provide sensible defaults, architecture doc explains the system. Must not break existing iago-os — zero new hard dependencies.

## Context

The memory stack was built manually for Santiago (Windows). Sebas (Mac) and future team members have no way to replicate it. The stack includes:
- **MemPalace:** ChromaDB vector store over conversation history (13.5K drawers, 7 wings, auto-diary via stop hook)
- **Graphify:** Knowledge graph + wiki over any document corpus (MCP server, PreToolUse hook)
- Both are Python packages with platform-specific gotchas (hnswlib wheels, cp1252 encoding, Task Scheduler vs launchd)

## Design Decisions

1. **Opt-in, not core:** iaGO-OS works without memory. The setup script is run explicitly. No Python in the default dependency chain.
2. **Templates in repo, data stays personal:** Configs ship in `templates/memory/`. Actual ChromaDB data, Obsidian vaults, and graphify graphs live in `~/` — never in the repo.
3. **Cross-platform:** Script detects OS and handles differences (scheduled rebuilds, encoding, MCP registration).
4. **Idempotent:** Safe to re-run. Skips already-installed components. Reports what it did.
5. **CLAUDE.md memory section becomes conditional:** References tools only if they're installed, so Claude doesn't hallucinate about unavailable MCP tools.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `docs/memory-stack.md` | Architecture doc — what each layer does, retrieval routing, setup differences |
| Create | `scripts/setup-memory.sh` | Cross-platform setup (bash, works in Git Bash on Windows) |
| Create | `scripts/setup-memory.ps1` | PowerShell wrapper for Windows |
| Create | `templates/memory/wing_config.json` | MemPalace wing routing config |
| Create | `templates/memory/config.json` | MemPalace palace config |
| Create | `templates/memory/session-diary.py` | Stop hook diary writer |
| Create | `templates/memory/graphifyignore` | Starter .graphifyignore for document corpora |
| Modify | `docs/SETUP.md` | Add "Memory Stack (Optional)" section pointing to setup-memory.sh |
| Modify | `CLAUDE.md` | Make memory section conditional on installation |

## Tasks

### Task 1: Create template configs and session-diary script
- **files:** `templates/memory/wing_config.json`, `templates/memory/config.json`, `templates/memory/session-diary.py`, `templates/memory/graphifyignore`
- **action:** Extract the configs we built today into reusable templates. wing_config uses iaGO-standard wings (one per client + team members + business). config.json has consultancy-oriented topic wings. session-diary.py is the stop hook script with platform-agnostic paths. graphifyignore covers common exclusions for document corpora (not code repos).
- **verify:** `ls templates/memory/ | wc -l`
- **expected:** 4 files

### Task 2: Create setup script and docs
- **files:** `scripts/setup-memory.sh`, `scripts/setup-memory.ps1`, `docs/memory-stack.md`
- **action:** Setup script: detect platform, check Python 3.10+, install mempalace + graphifyy + python-docx + openpyxl, create ~/.mempalace/ from templates, register MCP servers in ~/.claude.json, install global hooks (PreToolUse for graphify, Stop for diary), report results. Architecture doc: explain 3 layers (MEMORY.md, MemPalace, Graphify), retrieval routing table, what's automated vs manual, cross-platform differences, troubleshooting. Match style of existing docs/SETUP.md.
- **verify:** `bash scripts/setup-memory.sh --dry-run 2>&1 | head -5`
- **expected:** Output showing dry-run mode header

### Task 3: Update SETUP.md and CLAUDE.md
- **files:** `docs/SETUP.md`, `CLAUDE.md`
- **action:** Add "Memory Stack (Optional)" section to SETUP.md after "Start Working" — brief description + pointer to setup-memory.sh + pointer to docs/memory-stack.md. Update CLAUDE.md memory section to note that MemPalace and Graphify layers require setup (`scripts/setup-memory.sh`) and are not available by default.
- **verify:** `grep -c "setup-memory" docs/SETUP.md CLAUDE.md`
- **expected:** At least 1 match per file
