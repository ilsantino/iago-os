---
name: Obsidian second brain
description: Personal vault at dev/obsidian-brain — MWP-reorganized 2026-05-20, git-versioned, MCP integration, hybrid auto-capture
type: project
originSessionId: 4bb41a0a-65fb-4c1e-a4f5-23913700b12c
---
Personal Obsidian vault at `C:\Users\sanal\dev\obsidian-brain`. MCP integration via `@mauricio.wolff/mcp-obsidian` in `~/.claude.json`. Hybrid auto-capture via Claude Code stop hook writes session digests + diary entries.

**MWP reorganization completed 2026-05-20** (session digest: `sessions/2026-05-20-obsidian-brain-reorg-mwp.md`).

## Structure (post-reorg)

```
Home.md                    L0 — vault entry MOC
CRITICAL_FACTS.md          L0 — ~150-token always-load anchor
CLAUDE.md                  L0 — vault Claude Code config
_system/                   L3 — taxonomy + 7 templates + archive script
_context/                  L3 — business reference (iago-agency + personal)
brain/                     NEW — cross-cutting knowledge
  decisions/ (9)
  evaluations/ (4)
  concepts/ (4)            MWP, ICM, layer-triage, context-hygiene
  patterns/ (8)            skeleton-first, dual-aggressive-review, fix-dont-paste, worktree, stack-prs, pr-split, diagnose-before-fix, design-pass
  people/ (6)
clients/ (9 hubs)          munet, sentria, din, fulldata, installflow, allende, drb, tenet, rsf
projects/ (8 hubs)         iago-os, iago-os-v2, iago-workspaces, obsidian-brain, graphify, mempalace, markitdown, remotion-animation
sessions/                  current month flat + 2026-04/ archive (57 files)
meetings/                  flat recent + _inbox/ + 2025/ (7) + 2026-Q1/ (13)
daily/                     stub hub
graphify-out/              auto-generated, untouched
```

Deleted folders: `obsidian-brain/` (nested mistake), `notes/` (.gitkeep only), `iago-bizops/` (merged into `_context/iago-agency/business-plan/`), `decisions/` (moved to `brain/decisions/`).

## Frontmatter taxonomy (canonical: `_system/taxonomy.md`)

- `type:` session | meeting | daily | decision | pattern | concept | client | project | person | reference | eval | hub | anchor | config
- `status:` active | archived | deprecated | stale | superseded
- `confidence:` high | medium | low (decisions + concepts only)
- `relations:` `[[note1]], [[note2]]` (high-value notes only)

## Git

Vault is git-versioned as of 2026-05-20 (initial commit `4c53fa6`). `.gitignore` excludes `.obsidian/workspace*`, `.obsidian/cache`, `graphify-out/cache/`, `graphify-out/converted/`, OS noise, and the `_drive` symlink. Recommend a commit per significant reorg or weekly digest, not per session digest (those auto-write).

## Backup

Pre-reorg snapshot at `C:\Users\sanal\dev\obsidian-brain-backups\pre-reorg-20260520-125351.tar.gz` (17 MB). Excludes graphify cache + Obsidian workspace cruft. Rollback path if reorg patterns prove wrong.

## Maintenance

`_system/scripts/archive-old-sessions.sh` — idempotent monthly archive script. Moves `YYYY-MM-*.md` files older than 30 days into `YYYY-MM/` subdirs in both `sessions/` and `meetings/`. GNU+BSD date fallback. Run from vault root.

## Wikilinks

Hubs use path-form wikilinks (`[[clients/munet/CONTEXT|MUNET]]`, `[[brain/decisions/...]]`) — stable location.
Leaf session + meeting wikilinks use filename-form (`[[2026-05-20-foo|...]]`) — Obsidian filename resolver survives folder moves.

## Graphify state

After reorg: 169 nodes / 204 edges / 11 communities (pre-reorg snapshot). Incremental rebuild succeeded — wiki regenerated to 11 community pages. The 49+ new hub + concept + pattern files are NOT yet extracted into graph nodes (incremental detection treated all 361 files as new, stale manifest). Full re-extraction is a deferred enhancement (~$2 + ~10 min cost) — Obsidian's native graph view already shows the new connectivity via the 60+ wikilinks added.

## Memory architecture context

This vault is one of six memory layers (per `iago-os/CLAUDE.md` Memory Architecture table): MEMORY.md (frozen-snapshot), Obsidian (this vault), Graphify (graph), MemPalace (conversations), MarkItDown (ingestion), SQLite (Phase 3 agent state).

## Repo verdicts (researched 2026-05-20)

- **eugeniughelbur/obsidian-second-brain** — CHERRY-PICKED: `CRITICAL_FACTS.md`, `confidence:` frontmatter, `#stale`/`#contradiction` tags, `relations:` array
- **breferrari/obsidian-mind** — CHERRY-PICKED: `brain/` cross-cutting layer, 7-category `type:` field, `Home.md` MOC entry
- **kepano/obsidian-skills** — SKIPPED (already imported `references/` pattern in `.claude/rules/skill-authoring.md`)

## How to apply

When working in any project, Claude searches this vault for cross-project context via Obsidian MCP tools (`search_notes`, `read_note`). Start at `Home.md` or the relevant hub (`clients/{slug}/CONTEXT`, `projects/{slug}/CONTEXT`, `brain/CONTEXT`). After significant sessions, the stop hook writes a digest to `sessions/`. Manual writes for context docs, project notes, decisions go to the appropriate hub-folder.
