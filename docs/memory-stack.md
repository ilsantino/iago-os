# Memory Stack

Optional addon for iaGO-OS that gives Claude Code persistent memory across sessions. Three layers, each with distinct purpose.

## Layers

### 1. MEMORY.md (built-in)

Claude Code's native auto-memory. Always loaded in context. Stores user preferences, feedback, and project context as markdown files in `~/.claude/projects/{dir}/memory/`.

- **Access:** Always available, no setup needed
- **Best for:** User prefs, correction patterns, project meta
- **Limit:** ~200 lines in index before truncation

### 2. MemPalace (requires setup)

ChromaDB vector store over conversation history. Semantic search across all past sessions.

- **Access:** MCP tools (`mempalace_search`, `mempalace_diary_read`, `mempalace_diary_write`)
- **Best for:** Recalling past reasoning, rejected alternatives, implicit context
- **Storage:** `~/.mempalace/palace/` (ChromaDB persistent directory)
- **Automation:** Stop hook writes diary entry after every session

#### Wings

MemPalace organizes drawers into wings — one per client project, team member, or topic. Configured in `~/.mempalace/wing_config.json`. The setup script installs a template; edit it with your actual client names and keywords.

#### Diary

The stop hook (`~/.claude/scripts/session-diary.py`) runs at the end of every Claude Code session. It reads the latest transcript, extracts a compact summary (project, files changed, tools used), and writes it to the `wing_claude` / `diary` room. This gives Claude cross-session continuity without manual effort.

#### Bulk Backfill

Mine existing conversation history into MemPalace:

```bash
mempalace mine ~/.claude/projects/{project-dir}/ --mode convos --wing {wing_name}
```

### 3. Graphify (requires setup)

Knowledge graph + wiki over any document corpus (Obsidian vault, Google Drive export, project docs). Extracts entities and relationships, clusters them into communities, generates navigable wiki pages.

- **Access:** MCP tools (`query_graph`, `get_node`, `get_community`, `god_nodes`) or static wiki at `graphify-out/wiki/index.md`
- **Best for:** Entity relationships, community structure, cross-document connections
- **Storage:** Graph JSON + wiki output in a `graphify-out/` directory alongside the corpus

#### Processing a Corpus

```bash
# Full pipeline: extract + cluster + wiki
python -m graphifyy extract --input ~/path/to/docs --output ~/path/to/graphify-out
python -m graphifyy cluster --graph ~/path/to/graphify-out/graph.json
python -m graphifyy wiki --graph ~/path/to/graphify-out/graph.json --output ~/path/to/graphify-out/wiki

# Or use the iaGO skill for the full pipeline:
# /graphify ~/path/to/docs
```

#### Scheduled Rebuilds

The graph should be rebuilt periodically to stay current with new documents.

**macOS/Linux (cron):**
```bash
0 6 * * * python3 -m graphifyy rebuild --input ~/docs --output ~/graphify-out
```

**Windows (Task Scheduler):**
- Action: `python -m graphifyy rebuild --input C:\path\to\docs --output C:\path\to\graphify-out`
- Trigger: Daily at 6:00 AM

#### .graphifyignore

Place a `.graphifyignore` file in the corpus root to exclude paths from extraction. The setup ships a starter template at `templates/memory/graphifyignore`. Common exclusions: `.git/`, `node_modules/`, binary attachments, build output.

## Retrieval Routing

When Claude needs information, it should check the right layer:

| Need | Tool |
|------|------|
| Structured notes, decisions, meetings | Obsidian MCP (`search_notes`, `read_note`) |
| Entity relationships, community structure | Graphify MCP (`query_graph`, `get_node`) or wiki |
| Past conversation recall, reasoning trails | MemPalace (`mempalace_search`) |
| Cross-session agent continuity | MemPalace diary (`mempalace_diary_read`) |
| Library/framework docs | Context7 (`query-docs`) |

## Setup

### Quick Start

```bash
# macOS / Linux / Git Bash on Windows
bash scripts/setup-memory.sh

# Windows (PowerShell)
.\scripts\setup-memory.ps1

# Preview without changes
bash scripts/setup-memory.sh --dry-run
```

### What the Script Does

1. **Checks Python 3.10+** — required for ChromaDB (hnswlib wheels)
2. **Installs packages** — `mempalace`, `graphifyy`, `python-docx`, `openpyxl`
3. **Creates `~/.mempalace/`** — copies template configs, sets palace path
4. **Installs diary script** — copies `session-diary.py` to `~/.claude/scripts/`
5. **Registers MCP servers** — adds `mempalace` and `graphify` to `~/.claude/settings.json`
6. **Installs hooks** — PreToolUse (graphify nudge) and Stop (session diary)

### Post-Setup

1. Edit `~/.mempalace/wing_config.json` — replace template placeholders with actual client names and keywords
2. Mine existing conversations: `mempalace mine ~/.claude/projects/{dir}/ --mode convos --wing {name}`
3. Run graphify on your document corpus: `python -m graphifyy extract --input ~/docs --output ~/graphify-out`

## Cross-Platform Notes

| Concern | Windows | macOS/Linux |
|---------|---------|-------------|
| Python command | `python` (usually) | `python3` |
| hnswlib wheel | May need Visual C++ Build Tools | Usually works with pip |
| Encoding | cp1252 default — mempalace uses `utf-8` explicitly | UTF-8 default |
| Scheduled rebuilds | Task Scheduler | cron |
| Path separators | Backslash in configs, forward slash in bash | Forward slash |
| MCP server paths | Use `python` not `python3` in settings.json | Use `python3` |

## Troubleshooting

### ChromaDB fails to install

ChromaDB depends on `hnswlib` which needs a C++ compiler. On Windows, install Visual C++ Build Tools. On macOS, install Xcode Command Line Tools (`xcode-select --install`).

### MCP server not connecting

Check `~/.claude/settings.json` → `mcpServers`. The `command` should point to the Python executable that has `mempalace`/`graphifyy` installed. If using a virtual environment, use the full path to that Python.

### Diary hook not writing

1. Check the stop hook exists in `~/.claude/settings.json` → `hooks.Stop`
2. Verify the script exists: `ls ~/.claude/scripts/session-diary.py`
3. Test manually: `python ~/.claude/scripts/session-diary.py`
4. Check `~/.mempalace/palace/` exists and is writable

### Graphify graph empty

1. Ensure corpus path is correct and contains readable files
2. Check `.graphifyignore` isn't excluding everything
3. Run with verbose: `python -m graphifyy extract --input ~/docs --output ~/out --verbose`
