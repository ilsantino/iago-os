# Santiago — Global Context

## Who I Am
CEO of a 3-person AI consultancy (iaGO). CTO is Sebas (Mac).
I drive decisions directly — give me opinionated verdicts with reasoning, not menus.

## Obsidian — Second Brain
Vault at `C:\Users\sanal\dev\obsidian-brain`.

- Business docs: `_context/iago-agency/` and `_context/personal/`
- Session history: `sessions/` (auto-captured digests from Claude Code sessions)
- Meeting transcripts: `meetings/` (imported from Google Meet/Gemini)
- Daily summaries: `daily/`
- Project notes: `projects/`

Use the Obsidian MCP tools (`read_note`, `write_note`, `search_notes`, `list_directory`)
for all vault access. Never use raw filesystem reads on the vault.

Search the vault before asking me to explain context I've already documented.

## MemPalace — Conversation Memory
Palace at `~/.mempalace/`. ChromaDB vector store over conversation history.

### Retrieval Routing
| Need | Tool |
|------|------|
| Structured notes, decisions, meetings | Obsidian MCP (`search_notes`, `read_note`) |
| Entity relationships, community structure | Graphify MCP or `graphify-out/wiki/index.md` |
| Past conversation recall, reasoning trails | MemPalace (`mempalace_search`) |
| Cross-session agent continuity | MemPalace diary (`mempalace_diary_read`) |
| Library/framework docs | Context7 (`query-docs`) |
| YouTube transcript | youtube-transcript MCP (`transcribe_video`) |

### When to use MemPalace
- Santiago asks about past reasoning, rejected alternatives, or implicit context
- Looking up conversation content not captured in session digests
- Agent diary reads/writes for cross-session continuity (auto-written by stop hook)

### Mining (background task)
```bash
mempalace mine ~/.claude/projects/{project}/ --mode convos --wing {wing_name}
```

## Graphify — Knowledge Graph

Graph at `C:\Users\sanal\dev\obsidian-brain\graphify-out\` (graph.json, wiki/, graph.html).
Covers the entire Obsidian vault — all clients, meetings, decisions, sessions.

### How to use it
- **Before searching raw vault files**, check graphify MCP tools first (`query_graph`, `get_node`, `get_community`). The graph knows entity relationships and community structure that keyword search misses.
- **Wiki** at `graphify-out/wiki/index.md` — 11 community pages with wikilinks. Read it for navigation before diving into individual notes.
- **Rebuild**: `bash ~/.claude/scripts/rebuild-graph.sh` (runs nightly at 6am via Task Scheduler, or manually after bulk vault changes).
- `/graphify <path>` — full pipeline (extract + cluster + visualize). `/graphify <path> --update --wiki` for incremental rebuild + wiki regen.

When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.
