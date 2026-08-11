---
name: iago-os v2 memory architecture (5-layer + SQLite 6th)
description: v2 keeps the existing 5-layer memory architecture and formally names SQLite session state as the 6th layer; Postgres + data warehouse + Zep all deferred with explicit triggers
type: project
originSessionId: 0d8cdb7c-0dd5-45b9-921a-d8d57a58ed38
---
**Decision date:** 2026-05-20

**ADR:** `.iago/decisions/2026-05-20-posthog-sentry-split-and-memory.md`

**Six layers:**

| Layer | What | Where |
|---|---|---|
| 1 | MEMORY.md (frozen-snapshot, user prefs, feedback, project context) | `~/.claude/projects/<slug>/memory/MEMORY.md` |
| 2 | Obsidian (session digests, meetings, business docs) | `dev/obsidian-brain/` + MCP |
| 3 | Graphify (knowledge graph + wiki over vault) | `dev/obsidian-brain/graphify-out/` + MCP |
| 4 | MemPalace (ChromaDB vector store + agent diary, 7 wings) | `~/.mempalace/` + MCP |
| 5 | MarkItDown (document conversion DOCX/PPTX/XLSX/PDF → markdown) | global MCP |
| **6** | **SQLite** (per-agent session resumption + cost ledger + event/replay dedupe) | VPS `/var/lib/iago-os/state/ledger.sqlite` (single DB file, multiple tables) |

**Why 6 not Postgres:** SQLite was already planned in the v2 vision spec (§§ 132, 472). This decision just formally names it as the 6th memory layer to make it explicit. Postgres pays off at multi-instance scale or concurrent agent writes; iaGO v2 has neither today. Migration to Postgres is straightforward if triggered (same schema, swap driver).

**How to apply:**
- The 6th layer ships in Phase 3 PR alongside Layer A Sentry SDK init + cost ledger work
- Tables in same DB file: `agent_sessions`, `cost_entries`, `webhook_claims` (schema sketch in ADR)
- When dispatching agents to operational tasks, the daemon checks `agent_sessions` for resumption state — mid-task restart no longer cold-starts
- CLAUDE.md "Memory Architecture" table will grow from 5 to 6 rows in the Phase 3 PR (don't pre-edit)

**Triggers to revisit (escalate to Postgres):**
- Multi-VPS daemon instances sharing agent state
- Obsidian MCP latency over Tailscale from VPS consistently above ~2s for `search_notes` calls (then structured client data — agreements, retainers, deliverable status — should move to VPS-local Postgres)

**Triggers to revisit (add data warehouse):**
- Red Sun Farms PoC ships and an agent needs to query greenhouse IoT + production + ERP data simultaneously in natural language. Use DuckDB local first (zero infra), MotherDuck if cloud scale. CLIENT deliverable architecture, NOT iaGO ops.

**Triggers to revisit (add Zep/Graphiti temporal KG):**
- Measurable recall failure where an agent acts on a stale fact from MemPalace (wrong retainer amount, superseded scope) with non-trivial cost. Until then, Graphify entity tracking + Obsidian git history cover temporal versioning adequately.

**Anti-decisions (rejected):**
- Replace MemPalace with Postgres+pgvector — no, MemPalace works at scale, ChromaDB is zero-ops
- Replace Obsidian with Postgres — no, free-text notes don't want rigid schemas
- Adopt the Sewell-reel "data warehouse for AI" pattern — no, enterprise pattern, iaGO has 5–7 client projects not 50 integrated systems
