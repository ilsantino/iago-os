---
name: MemPalace conversation memory
description: 13.5K drawers across 7 wings, diary automated via stop hook, KG dropped (empty)
type: project
---

MemPalace running at `~/.mempalace/`. ChromaDB vector store over Claude Code conversation history.

**Current state:**
- 13,562 drawers in `mempalace_drawers` collection
- 7 wings populated: iago_os (9472), santiago (1488), munet (1476), business (927), din (198), sentria (11), installflow (6)
- 6 rooms: technical, architecture, planning, problems, general, decisions
- Diary working: stop hook auto-writes via `~/.claude/scripts/session-diary.py`
- MCP server registered in `~/.claude.json`

**Dropped:**
- Knowledge Graph (SQLite) — 0 entities, 0 triples. Never populated. Temporal queries served by Obsidian notes + Graphify instead.
- `sebas` wing — conversations about Sebas spread across iago_os. Not worth separate wing.

**Automation:**
- Global Stop hook in `~/.claude/settings.json` calls `session-diary.py` → writes diary entry to `wing_claude/diary` room
- Diary entries visible via `mempalace_diary_read agent_name=claude`

**Known issues:**
- hnswlib 0.7.5 pinned (0.7.6 has no Windows binary wheel). If chromadb upgrades, may need to re-pin.
- Mining dedup blocks re-mining files into different wings. Use ChromaDB metadata update to retag.

**Why:** Semantic search over past conversations gives Claude recall of reasoning, rejected alternatives, and implicit context not in session digests or Obsidian notes.

**How to apply:** Use `mempalace_search` for past work/decisions. Use `mempalace_diary_read` for recent session history. Filter by wing for client-specific recall.
