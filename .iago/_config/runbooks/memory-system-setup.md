# Memory System — Setup Guide

This is the cross-session memory stack used in iaGO-OS and on every other Claude Code project. It is layered: each piece does one thing and they compose. Setup once, works everywhere Claude Code runs.

Audience: Sebas (Mac). Paths below use macOS conventions. Windows equivalents are noted where they diverge.

---

## 1. The Stack

Five storage layers + three retrieval helpers. Each is a separate install.

| Layer | What it stores | How Claude reads it | Auto/manual |
|---|---|---|---|
| **MEMORY.md** | User prefs, feedback, project context | Auto-loaded into every session prompt | Claude writes during sessions |
| **Obsidian vault** | Session digests, meetings, decisions, business docs | `obsidian` MCP | Hybrid: stop hook + manual |
| **Graphify** | Knowledge graph + wiki over the vault | `graphify` MCP | Auto: nightly rebuild |
| **MemPalace** | Conversation history (vector), KG, agent diary | `mempalace` MCP | Auto: stop hook writes diary |
| **MarkItDown** | Upstream conversion (DOCX/PPTX/XLSX/EPub/YouTube/large PDFs → md) | `markitdown` MCP | Manual (producer, not storage) |
| **Context7** | Library/framework docs | `context7` MCP | On-demand |
| **YouTube Transcript** | YouTube transcripts | `youtube-transcript` MCP | On-demand |

### How they relate

```
                    ┌──────────────────────────────┐
                    │  Claude Code session         │
                    │                              │
    auto-injected ──│→ MEMORY.md (frozen snapshot) │
                    │                              │
                    │  MCP tools (live):           │
                    │  ├─ obsidian  ── vault       │
                    │  ├─ graphify  ── graph       │
                    │  ├─ mempalace ── ChromaDB+KG │
                    │  ├─ markitdown── upstream    │
                    │  ├─ context7  ── lib docs    │
                    │  └─ youtube   ── transcripts │
                    └──────────────────────────────┘
                           │
                Stop hook ─┴─ writes diary entry → MemPalace
                              writes session digest → Obsidian
                Nightly cron ── rebuilds Graphify graph from vault
```

### Retrieval routing

| Need | Tool |
|---|---|
| Structured notes, decisions, meetings | Obsidian MCP |
| Entity relationships, community structure | Graphify MCP (`query_graph`, `get_node`) |
| Past conversation recall, reasoning trails | MemPalace (`mempalace_search`) |
| Cross-session agent continuity | MemPalace diary (`mempalace_diary_read`) |
| Library/framework docs | Context7 (`query-docs`) |
| Document ingestion (DOCX, XLSX, large PDFs, YouTube) | MarkItDown / YouTube MCP |

---

## 2. Prerequisites

```bash
# Verify
node --version    # >= 20
python3 --version # >= 3.11
claude --version  # Claude Code CLI installed
git --version
```

Install Claude Code if not already:

```bash
npm install -g @anthropic-ai/claude-code
```

---

## 3. Install — Step by Step

Run these in order. Each block is idempotent — re-running is safe.

### 3.1 Obsidian vault

You need a vault on disk. If you do not have one, clone Santiago's structure or start fresh.

```bash
mkdir -p ~/dev/obsidian-brain
cd ~/dev/obsidian-brain
mkdir -p _context clients meetings sessions daily projects decisions notes
```

Open the Obsidian app once (download from obsidian.md), point it at `~/dev/obsidian-brain`, and let it index. The MCP server reads files directly — Obsidian app is for human editing, not required by Claude.

### 3.2 Python packages (MemPalace, Graphify, MarkItDown, YouTube)

```bash
pip3 install --user mempalace graphify markitdown-mcp mcp-youtube-transcript

# Verify
mempalace --help     # should print usage
graphify --help
python3 -m markitdown_mcp --help
python3 -m mcp_youtube_transcript --help
```

If `pip3 install --user` puts binaries somewhere not on PATH, add the user-site bin dir:

```bash
echo 'export PATH="$HOME/Library/Python/3.12/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### 3.3 Initialise MemPalace

```bash
mempalace init
```

This creates `~/.mempalace/` with ChromaDB, knowledge graph SQLite, and palace storage.

Configure wings (project namespaces) at `~/.mempalace/wing_config.json`. Copy this baseline and adjust for Sebas's projects:

```json
{
  "default_wing": "wing_general",
  "wings": {
    "wing_iago_os":   { "type": "project", "keywords": ["iago-os", "pipeline", "skills", "agents"] },
    "wing_munet":     { "type": "project", "keywords": ["munet", "fimunet", "ticketing", "stripe"] },
    "wing_din":       { "type": "project", "keywords": ["din", "doda", "digital identity"] },
    "wing_sentria":   { "type": "project", "keywords": ["sentria", "absara", "incident"] },
    "wing_installflow": { "type": "project", "keywords": ["installflow", "supabase", "foreman"] },
    "wing_sebas":     { "type": "person", "keywords": ["sebas", "sebastian", "cto"] },
    "wing_business":  { "type": "project", "keywords": ["proposal", "client", "pricing", "sales"] }
  }
}
```

### 3.4 Build the Graphify knowledge graph

```bash
# First build (full extraction — takes a few minutes on a populated vault)
graphify ~/dev/obsidian-brain --out ~/dev/obsidian-brain/graphify-out --wiki

# Verify
ls ~/dev/obsidian-brain/graphify-out/
# expect: graph.json, graph.html, wiki/, GRAPH_REPORT.md
```

### 3.5 Install Obsidian MCP (npm)

```bash
npm install -g @mauricio.wolff/mcp-obsidian
```

Context7 and the Claude Code CLI install Context7 on demand via `npx`, no global install needed.

### 3.6 Wire the MCP servers into Claude Code

Edit `~/.claude.json`. Find the top-level `mcpServers` object (create it if missing) and merge in:

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "stdio",
      "command": "npx",
      "args": ["@mauricio.wolff/mcp-obsidian", "/Users/sebas/dev/obsidian-brain"]
    },
    "graphify": {
      "type": "stdio",
      "command": "python3",
      "args": ["-m", "graphify.serve", "/Users/sebas/dev/obsidian-brain/graphify-out/graph.json"]
    },
    "mempalace": {
      "type": "stdio",
      "command": "python3",
      "args": ["-m", "mempalace.mcp_server"]
    },
    "markitdown": {
      "type": "stdio",
      "command": "python3",
      "args": ["-m", "markitdown_mcp"]
    },
    "youtube-transcript": {
      "type": "stdio",
      "command": "python3",
      "args": ["-m", "mcp_youtube_transcript"]
    },
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["@upstash/context7-mcp"]
    }
  }
}
```

Replace `/Users/sebas` with your actual home (`echo $HOME`). On Windows, use `cmd` + `/c` + `npx` for the Node-based ones; on macOS, `npx` works directly.

Restart Claude Code. Verify in any session:

```
/mcp
```

You should see all six servers listed with green status.

### 3.7 Stop and pre-tool hooks

These auto-write a session digest to Obsidian and a diary entry to MemPalace at the end of every session, plus inject a "use the graph" nudge before raw search.

Copy the two scripts from Santiago's setup. They are at `~/.claude/scripts/session-diary.py` and `~/.claude/scripts/session-obsidian.py` on his machine — ask him to share, or grab from the iaGO-OS shared infra repo if mirrored.

Place them at `~/.claude/scripts/`. Then add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Glob|Grep|mcp__obsidian__search_notes",
        "hooks": [{
          "type": "command",
          "command": "[ -f \"$HOME/dev/obsidian-brain/graphify-out/graph.json\" ] && echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"additionalContext\":\"graphify: Knowledge graph available. Before raw file search, check graphify MCP tools (query_graph, get_node, get_community) or read graphify-out/wiki/index.md.\"}}' || true"
        }]
      }
    ],
    "PreCompact": [
      {
        "hooks": [{
          "type": "command",
          "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PreCompact\",\"additionalContext\":\"SESSION DIGEST REQUIRED: Context is about to be compressed. Write an Obsidian session digest to sessions/YYYY-MM-DD-{project}.md via mcp__obsidian__write_note before proceeding.\"}}'"
        }]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "python3 \"$HOME/.claude/scripts/session-diary.py\"",   "timeout": 10000, "async": true },
          { "type": "command", "command": "python3 \"$HOME/.claude/scripts/session-obsidian.py\"", "timeout": 15000, "async": true }
        ]
      }
    ]
  }
}
```

Adjust `python3` to whatever your PATH binds (`which python3`). On Windows, the equivalent is `python` and the Stop hook uses backslashed `C:/...` paths.

### 3.8 Nightly graph rebuild (launchd on Mac)

On Windows, Santiago uses Task Scheduler. On Mac, use launchd. Create `~/Library/LaunchAgents/com.iago.rebuild-graph.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>                 <string>com.iago.rebuild-graph</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>graphify $HOME/dev/obsidian-brain --out $HOME/dev/obsidian-brain/graphify-out --update --wiki</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>    <integer>6</integer>
        <key>Minute</key>  <integer>0</integer>
    </dict>
    <key>StandardOutPath</key> <string>/tmp/rebuild-graph.log</string>
    <key>StandardErrorPath</key> <string>/tmp/rebuild-graph.err</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.iago.rebuild-graph.plist
launchctl start com.iago.rebuild-graph   # test it
tail /tmp/rebuild-graph.log
```

### 3.9 Optional — Bulk-mine prior conversations into MemPalace

If you have existing Claude Code transcripts, backfill them so MemPalace can recall past reasoning:

```bash
mempalace mine ~/.claude/projects/{project-slug}/ --mode convos --wing wing_iago_os
```

Repeat per project, picking the matching wing.

---

## 4. How to Use It

### 4.1 MEMORY.md — the always-loaded layer

Path: `~/.claude/projects/{project-slug}/memory/MEMORY.md`

Claude Code creates this automatically the first time it writes a memory in that project. Each entry is a separate `.md` file with frontmatter (`name`, `description`, `type` ∈ `user|feedback|project|reference`); `MEMORY.md` is the index.

What goes here:
- **user** — your role, expertise, preferences (Sebas: CTO, Mac, Go background, etc.)
- **feedback** — corrections and confirmations ("don't mock the DB", "yes that approach was right")
- **project** — current state, deadlines, motivations (not derivable from code)
- **reference** — pointers to external systems (Linear, Grafana, etc.)

How to use: just talk to Claude. When you correct it or share preferences, it writes a memory. Don't manually edit unless cleaning up.

**Critical rule:** MEMORY.md is a frozen snapshot — auto-injected at session start. Do not re-read it mid-session. Mutations apply on the next session.

### 4.2 Obsidian — structured notes

Use the Obsidian app for human writing. Use Claude's `obsidian` MCP for everything else:

- `search_notes` — keyword search across the vault
- `read_note` — read one file
- `write_note` — create/update a note
- `list_directory` — see what's in a folder
- `patch_note` — surgical edits

Examples:
- "Search Obsidian for the MUNET billing decision"
- "Read the latest session digest for iago-os"
- "Write a meeting note from this transcript at meetings/2026-04-28-sebas-onboarding.md"

The stop hook automatically writes a session digest to `sessions/YYYY-MM-DD-{project}.md` after every meaningful session. Reads are quick because there is structure.

### 4.3 Graphify — relationships and communities

When a question is "who/what relates to X?", reach for Graphify before raw search:

- `query_graph` — graph queries
- `get_node` — entity details + neighbors
- `get_community` — clustered topics
- `god_nodes` — high-centrality entities (the "main characters")
- Also browse the human-readable wiki: `~/dev/obsidian-brain/graphify-out/wiki/index.md`

The graph rebuilds nightly. Manually: `bash ~/.claude/scripts/rebuild-graph.sh` (Windows) or rerun the launchd job.

### 4.4 MemPalace — past conversations

Use when you need to recall reasoning, rejected alternatives, or implicit context that never made it to a doc:

- `mempalace_search` — semantic search across all conversations
- `mempalace_diary_read` — read agent diary for cross-session continuity
- `mempalace_kg_query` — entity-relationship queries
- `mempalace_traverse` — walk relationships from a starting node

Example: "What did Santiago decide about Stripe test mode for MUNET?" → `mempalace_search "stripe test mode munet"`.

The stop hook writes diary entries automatically. You only act on it when reading.

### 4.5 MarkItDown — ingest documents

When a client sends a DOCX, PDF, XLSX, PPTX, EPub, or YouTube link:

```
mcp tool: convert_to_markdown
args: { uri: "file:///Users/sebas/Downloads/brief.docx" }
       (or "https://youtu.be/abc123")
```

Output is markdown that Claude can reason over directly.

CLI fallback (Windows encoding gotcha worth knowing): `markitdown -o out.md in.pdf`. Never pipe stdout on Windows — UTF-8 → CP1252 corruption. macOS does not have this issue.

### 4.6 Context7 — current library docs

Use whenever you ask about a library, framework, SDK, or CLI tool — even well-known ones. Training data lags. Context7 has current docs.

In Claude: just ask. The system prompt tells it to prefer Context7 over web search for library docs.

### 4.7 YouTube transcripts

```
mcp tool: transcribe_video
args: { url: "https://youtube.com/watch?v=..." }
```

Returns a clean transcript. Replaces MarkItDown's broken YouTube handler.

---

## 5. Verifying Setup

After install, run this checklist in a fresh Claude Code session:

```
1. /mcp                              → all 6 servers green
2. "list directory _context"         → obsidian MCP returns files
3. "query graph for node iago-os"    → graphify returns a node
4. "search mempalace for 'pipeline'" → mempalace returns drawers
5. End the session and check ~/dev/obsidian-brain/sessions/  → new digest written
6. Check ~/.mempalace/palace/ for new diary entries
```

If any step fails, check `/mcp` for that server's error log.

---

## 6. Common Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| `/mcp` shows server "failed" | Python or npx not on PATH | Add to PATH in `~/.zshrc`, restart Claude Code |
| Stop hook never fires | `python3` not resolving | Hardcode full path in `settings.json` (`which python3`) |
| Graphify queries return empty | Graph never built | Run `graphify ~/dev/obsidian-brain --out ... --wiki` once manually |
| MEMORY.md grows past 200 lines | Index bloat | Move full content into per-topic files; keep MEMORY.md as one-line pointers |
| Obsidian MCP can't find vault | Wrong path in args | Edit `~/.claude.json` → `obsidian` → `args[2]` |
| Nightly rebuild not running | launchd job not loaded | `launchctl list | grep iago` and reload |

---

## 7. Mental Model

The point of all this is: **Claude does not have to ask Santiago (or you) to explain things twice.**

- A *fact about you* → MEMORY.md
- A *decision or meeting* → Obsidian
- A *conversation thread* → MemPalace
- A *relationship between entities* → Graphify
- A *third-party document* → MarkItDown (one-shot conversion, then it lives in Obsidian)
- A *library API question* → Context7

When in doubt: structured (Obsidian) before semantic (MemPalace) before relational (Graphify) before raw search. The pre-tool hook nudges Claude in this order automatically.

---

## 8. Where to Go Next

- Per-project `CLAUDE.md` — project rules that override global
- Skills in `~/.claude/skills/` — reusable workflows (`/iago-plan`, `/iago-execute`, etc.)
- Sub-agents in `~/.claude/agents/` — specialised dispatchers

The memory system is the substrate; skills and agents are how you act on it.
