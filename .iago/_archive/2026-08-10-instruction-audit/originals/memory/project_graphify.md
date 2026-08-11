---
name: graphify-knowledge-graph
description: Graphify on Obsidian vault — rebuild pipeline REPAIRED 2026-07-01 (was frozen Apr9–Jul1); nightly now runs real /graphify --update headless
metadata: 
  node_type: memory
  type: project
  originSessionId: 45e80966-1e35-4c13-b650-de513186f13e
---

Graphify running on Obsidian vault (C:/Users/sanal/dev/obsidian-brain).

**Current state (rebuilt 2026-07-01):**
- **1,163 nodes, 1,892 edges, 44 communities** (was 169/204/11, frozen since 2026-04-09)
- graph outputs in `obsidian-brain/graphify-out/`: graph.json (1.3MB), graph.html, GRAPH_REPORT.md, wiki/ (29 pages), manifest.json, cache/ (350 files)
- MCP server (stdio, `~/.claude.json`) loads graph.json AT SESSION START and does NOT hot-reload — after a rebuild you must **restart the session/MCP** for query_graph/get_node/graph_stats to see the new graph. HTML/wiki/report on disk are current immediately.

**The bug that froze it (fixed 2026-07-01):** the old `rebuild-graph.sh` was "incremental" in name only — it loaded the frozen graph.json, re-clustered the SAME nodes, regenerated only the wiki, and NEVER wrote graph.json/graph.html back or ingested new notes. On top of that it crashed every nightly run with `PermissionError [WinError 5]` on `shutil.rmtree(graphify-out/wiki)` (Obsidian/OneDrive/Defender file lock). So the graph could not evolve while the vault grew 113→379 files. Diagnosed + fixed in one session.

**Automation (now working):**
- Nightly Task Scheduler "GraphifyRebuild" 6am → `rebuild-graph.bat` → `call C:\nvm4w\nodejs\claude.cmd -p "/graphify . --update --wiki" --dangerously-skip-permissions` (cd vault first, logs exit code). `--update` diffs vault vs manifest.json, re-extracts ONLY changed notes (content-hash cache → unchanged = free), writes graph back.
- Manual: `bash ~/.claude/scripts/rebuild-graph.sh` (same claude.cmd call). Full from-scratch: `claude -p "/graphify . --wiki"` (clear cache/ first to bust hash cache).
- SKILL.md Step 6b wiki write is now **lock-safe**: build into `wiki.new`, atomic rename-swap, retry-with-backoff rmtree of `wiki.old` (no more WinError 5). Applied in both SKILL.md and the rebuild scripts.

**Full-rebuild mechanics (how the 2026-07-01 run was done):** detect → filter out self-referential `graphify-out/*` paths → chunk 358 real docs into 15 → Workflow with 15 parallel Sonnet extraction agents (each writes out-NN.json) → 1 build agent merges/clusters/labels/exports via the skill python. ~2.5M Sonnet tokens one-time. Corpus is only ~695K words (the old 6.9M-word detect count included graphify-out/converted transcripts, now skipped).

**Content flow into vault (feeds the graph):** sessions/ (auto digests), meetings/ (manual Gemini import), _context/ (manual). Google Drive NOT connected.

**Known first-pass quality issues (2026-07-01 rebuild):**
- ~410 weakly-connected nodes — chunked extraction (blind agents) made per-note duplicate entities instead of merging; major hubs (Santiago=82 edges) merged fine, long tail noisy. A future tuned re-extraction with a merge/canonicalization pass would clean this.
- 16 of 44 communities are size 1-2 (single meeting notes) = noise.
- 660 nodes tagged file_type='anchor' (invalid value, harmless — graphify accepted them).

**Why:** unified knowledge graph over the vault; wiki = navigable community map; nightly keeps it fresh. Value is retrieval + surprising cross-note connections + GRAPH_REPORT Suggested Questions (synthesis backlog) — NOT node-count growth. See [[user_profile]].

**How to apply:** open graphify-out/graph.html to view; read GRAPH_REPORT.md monthly for communities + surprising connections + suggested questions. Restart session after any rebuild to query via MCP. `/graphify --update --wiki` after big vault changes.
