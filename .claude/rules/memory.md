---
name: memory
description: Six-layer memory architecture — MEMORY.md, Obsidian, Graphify, MemPalace, MarkItDown, SQLite. Retrieval routing + frozen-snapshot rule for MEMORY.md.
---

# Memory Architecture

Six layers, each with distinct purpose and access pattern:

| Layer | What | Access | Automation |
|-------|------|--------|------------|
| **MEMORY.md** | User prefs, feedback, project context | Always-loaded in context | Manual (Claude writes) |
| **Obsidian** | Session digests, meetings, decisions, business docs | MCP (`search_notes`, `read_note`, `write_note`) | Semi-auto (session digests) |
| **Graphify** | Knowledge graph + wiki over vault (incl. Drive) | MCP (`query_graph`, `get_node`) + `graphify-out/wiki/` | Auto (nightly rebuild via Task Scheduler) |
| **MemPalace** | Conversation history, agent diary | MCP (`mempalace_search`, `mempalace_diary_read`) | Auto (stop hook writes diary every session) |
| **MarkItDown** | Upstream document conversion (DOCX/PPTX/XLSX/EPub/YouTube/large PDFs → markdown) | MCP (`convert_to_markdown`) | Manual (producer, not storage) |
| **SQLite** | Agent session state + cost ledger + event/replay dedupe | Direct DB queries (`/var/lib/iago-os/state/ledger.sqlite`) | Auto (daemon writes; schema ships in Phase 3) |

## Retrieval Routing

| Need | Tool |
|------|------|
| Structured notes, decisions, meetings | Obsidian MCP |
| Entity relationships, community structure | Graphify MCP (`query_graph`, `get_node`) or `graphify-out/wiki/index.md` |
| Past conversation recall, reasoning trails | MemPalace (`mempalace_search`) |
| Cross-session agent continuity | MemPalace diary (`mempalace_diary_read`) |
| Library/framework docs | Context7 (`query-docs`) |
| Document ingestion (DOCX, XLSX, large PDFs) | MarkItDown MCP (`convert_to_markdown`) |

## MemPalace Wings

13.5K drawers across 7 wings: `iago_os`, `munet`, `din`, `sentria`, `installflow`, `santiago`, `business`. Stop hook auto-writes diary entries. Bulk backfill: `mempalace mine ~/.claude/projects/{dir}/ --mode convos --wing {name}`.

## Frozen-snapshot rule

**MEMORY.md is a frozen snapshot.** Loaded into context at session start by Claude Code, including `claude -p` sessions (auto-loaded by default; only `claude --bare` skips it). Mid-session: do not grep, Read, or open the file at `~/.claude/projects/{project-slug}/memory/MEMORY.md` — content is already present in your context. Mutations (Write to add new entries) persist for next session, do not reflect in current context.

**Permitted exceptions:**
- **Read-after-Write to verify persistence** — after writing a new memory entry, you may Read to confirm the write succeeded. The prohibition is on grepping to retrieve already-injected content, not on verifying write side effects.
- **Skills explicitly designed to reference cross-session preferences** (e.g., `/council`, which reads `~/.claude/projects/*/memory/` to ground multi-advisor decisions). Such skills must include an inline comment explaining the exception.

Implementation, fix, and review sessions must follow this rule unconditionally. Preserves prefix-cache and avoids redundant reads.
