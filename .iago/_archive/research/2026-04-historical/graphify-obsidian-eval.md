# Research: graphify for Obsidian Knowledge Retrieval

**Date:** 2026-04-08
**Question:** Would graphify meaningfully improve the iaGO Obsidian vault — specifically for knowledge retrieval, connection discovery, and reducing the "search Obsidian before asking me" pattern?

---

## Findings

### 1. What it does — exact functionality

graphify is a Python CLI tool (installed as a Claude Code skill) that turns any folder of files into a queryable knowledge graph. Its exact outputs per run:

- `graphify-out/graph.html` — interactive vis.js graph, click nodes, search, filter by community
- `graphify-out/GRAPH_REPORT.md` — plain English summary: god nodes (highest-degree concepts), surprising cross-file connections (ranked by composite score), 4-7 suggested questions the graph is uniquely positioned to answer
- `graphify-out/graph.json` — persistent graph, queryable weeks later without re-reading files
- `graphify-out/cache/` — SHA256 cache so re-runs only re-process changed files
- `graphify-out/obsidian/` (opt-in `--obsidian` flag) — one `.md` file per graph node with `[[wikilinks]]`, YAML frontmatter, community tags, plus `.obsidian/graph.json` for color-by-community in Obsidian

It is NOT a chat interface and does NOT replace your existing Obsidian MCP integration. It is a pre-processing layer that builds structure on top of raw files, which Claude then uses instead of grepping raw content.

---

### 2. How it works — architecture

**Pipeline:** `detect() → extract() → build_graph() → cluster() → analyze() → report() → export()`

Each stage is a pure function in its own module; no shared state.

**Two-pass extraction:**

Pass 1 (deterministic, no LLM): tree-sitter AST over code files. Extracts classes, functions, imports, call graphs, docstrings, rationale comments (`# NOTE:`, `# WHY:`, `# HACK:`). Zero API cost. 20 languages supported.

Pass 2 (LLM-based): Claude subagents run in parallel over `.md`, `.txt`, `.rst`, `.pdf`, and image files. They extract concepts, relationships, and design rationale. Files are chunked by directory so related artifacts land in the same chunk — this matters for your vault structure.

**Clustering:** Leiden community detection (graspologic) on graph topology. No embeddings, no vector DB. The semantic similarity edges Claude extracts during Pass 2 (`semantically_similar_to`, tagged INFERRED) are already in the NetworkX graph, so they influence community detection directly. Clustering is based on edge density, not cosine similarity of note content.

**LLM used:** Whichever model backs your Claude Code session — for you, that means Claude (claude-sonnet-4-6 for the orchestrator, opus for extraction if you've configured that in pipeline sessions). The subagents use the `Task` tool for parallel extraction. No OpenAI, no separate API key.

**Confidence tagging:** Every edge is labeled:
- `EXTRACTED` (confidence 1.0) — explicitly stated in source (an import, a direct call, a wikilink)
- `INFERRED` (0.0–1.0 confidence score) — reasonable deduction (co-occurrence, semantic similarity)
- `AMBIGUOUS` — uncertain, flagged for review

**MCP server:** `python -m graphify.serve graphify-out/graph.json` starts a stdio MCP server exposing 7 tools: `query_graph` (BFS/DFS traversal), `get_node`, `get_neighbors`, `get_community`, `god_nodes`, `graph_stats`, `shortest_path`. You could register this as a third MCP server alongside your existing `context7` and `obsidian` servers.

---

### 3. Input / Output

**What goes in:**
- `.md`, `.txt`, `.rst` — concepts + relationships via Claude (your vault notes)
- `.pdf` — citation mining + concept extraction (requires `pip install graphifyy[pdf]`)
- `.png`, `.jpg`, `.webp`, `.gif` — Claude vision extraction
- `.docx`, `.xlsx` — converted to markdown, then Claude (requires `[office]`)
- 20 code file types — AST via tree-sitter (not relevant for Obsidian vault)
- URLs via `graphify add <url>` — fetches tweets, arXiv papers, webpages as annotated markdown

**What comes out (for your Obsidian use case):**
- `GRAPH_REPORT.md` — the god nodes (what your vault's most connected concepts are), surprising cross-note connections, 4-7 generated questions
- `graph.json` — the persistent graph for `graphify query` commands
- `graphify-out/obsidian/` (opt-in) — one `.md` per graph node with `[[wikilinks]]`, YAML frontmatter, community tags. This is NOT merged back into your vault — it's a parallel export. You'd open it as a separate vault or merge manually.

**Token efficiency claim:** 71.5x fewer tokens per query vs reading raw files at 52 files. This scales with corpus size — your vault (likely 100s of notes) would see meaningful compression. The graph captures relationships; the raw notes don't get re-read.

---

### 4. Setup requirements

**Hard dependencies (auto-installed with `pip install graphifyy`):**
- Python 3.10+
- networkx
- tree-sitter >= 0.21 (pinned; older versions give silent empty AST)
- tree-sitter language packages for 20 languages

**Optional extras (install as needed):**
- `graphifyy[leiden]` — graspologic for Leiden clustering (falls back to Louvain in NetworkX without this)
- `graphifyy[pdf]` — pypdf + html2text for PDF extraction
- `graphifyy[mcp]` — mcp package for the stdio MCP server
- `graphifyy[watch]` — watchdog for `--watch` auto-sync
- `graphifyy[office]` — python-docx + openpyxl for Word/Excel
- `graphifyy[all]` — everything above

**API keys:** None beyond what Claude Code already uses. Semantic extraction happens through your active Claude Code session — the skill dispatches Claude subagents that call back into the model you're already authenticated with.

**Config:** Optionally add `.graphifyignore` (gitignore syntax) to exclude directories. For your vault, you'd exclude `_templates/`, `.obsidian/`, maybe `daily/` if you don't want day-by-day notes cluttering the graph.

**Claude Code integration (the "always-on" hook):**
Running `graphify claude install` in your vault directory:
1. Writes a `CLAUDE.md` section instructing Claude to read `graphify-out/GRAPH_REPORT.md` before answering architecture questions
2. Installs a PreToolUse hook in `.claude/settings.json` that fires before every Glob and Grep call, injecting: "graphify: Knowledge graph exists. Read `GRAPH_REPORT.md` for god nodes and community structure before searching raw files."

This is the exact mechanism that addresses your "search Obsidian before asking me" pattern.

**PyPI name gotcha:** The PyPI package name is `graphifyy` (double-y), not `graphify`. The CLI and skill command are still `graphify`. This is temporary per the README — they're reclaiming the name.

---

### 5. Limitations and gotchas

**For your Obsidian vault specifically:**

1. **The Obsidian export is a parallel vault, not an in-place update.** `--obsidian` writes to `graphify-out/obsidian/` (or a custom `--obsidian-dir`). It does NOT modify your existing notes, add backlinks to them, or merge into your existing vault. You'd have to open the export directory as a separate Obsidian vault, or manually merge nodes. This is a significant limitation for your use case — your existing cross-links, tags, and folder structure are not enhanced in-place.

2. **Extraction cost on first run.** Every `.md` file in your vault goes through Claude (Pass 2 semantic extraction). For a 100-note vault, this is manageable. For 500+ notes, expect non-trivial API cost and time on first run. Subsequent runs use SHA256 cache and only re-process changed files.

3. **Markdown note extraction quality depends on note structure.** graphify extracts "concepts" and "relationships" from prose. Your structured notes (session digests with frontmatter, meeting notes with clear sections) will extract well. Free-form journal entries may produce vague nodes. The quality of the graph mirrors the quality of the notes.

4. **No bidirectional Obsidian sync.** The graph is built from files — it doesn't write back to them. If you want to use the graph's discovered connections, you'd either query via `graphify query` in Claude Code, or consult the `GRAPH_REPORT.md` manually. There's no automated "add this discovered link as a `[[wikilink]]` in my note" feature.

5. **`INFERRED` edges should be verified.** Claude guesses semantic similarity relationships. On a vault mixing business docs, meeting notes, and project plans, some INFERRED edges will be noise. The `AMBIGUOUS` tag flags the uncertain ones, but you won't know until you read the report.

6. **Leiden requires `graspologic` (separate install).** Without it, falls back to Louvain via NetworkX. Louvain has a known hang issue on large sparse graphs (fixed in 0.3.11 with `max_level=10` and `threshold=1e-4`), but the fix is very recent (2026-04-07). Run with Leiden for stability.

7. **Vault at `C:\Users\sanal\dev\obsidian-brain` — Windows path handling.** The Windows skill file (`skill-windows.md`) exists and `graphify install` auto-detects Windows. PreToolUse hooks are supported on Windows. No reported issues specific to Windows vault paths, but the project is young enough that edge cases could exist.

8. **`--update` flag prunes ghost nodes from deleted files** — this was only fixed in 0.3.14 (2026-04-08). If you add/delete notes frequently, make sure you're on >= 0.3.14.

9. **Project maturity:** Version 0.3.17 as of 2026-04-08. The entire 0.3.x series dropped in the last 2 days (0.3.0 through 0.3.17 in 48 hours). This is extremely rapid iteration — good (active development, bugs being fixed fast) and risky (you are running code that was written yesterday). Open issues include feature requests for Dart/Flutter, Pascal, Gemini CLI, and local embeddings — these are not bugs, but they indicate the project has significant unreleased roadmap.

10. **The MCP server requires `pip install graphifyy[mcp]`** and must be started separately. It's a stdio server, so you'd add it to your Claude Code MCP config like any other server. It exposes `query_graph`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`, `graph_stats`, `shortest_path`. This is the highest-leverage integration point for your use case.

---

### 6. Stars / maturity / issues

- **Stars:** 13,605 (as of 2026-04-08, repo created 2026-04-03) — this is extraordinary velocity for a 5-day-old project
- **Forks:** 1,382
- **Open issues:** 27 (mix of feature requests and bugs)
- **License:** MIT
- **PyPI version:** 0.3.17
- **Default branch:** v3
- **Language:** Python
- **Test suite:** pytest, one test file per module, 367+ tests as of 0.3.9
- **Changelog cadence:** 17 patch releases in 3 days — active but also signals instability risk
- **Notable recent bugs fixed:** semantic cache only saving 4/17 files (0.3.7), Louvain infinite loop on large sparse graphs (0.3.11), ghost nodes not pruned on `--update` (0.3.14), `.graphify_python` deleted breaking pipx (0.3.16)

The star count looks inflated for a 5-day project. Possible explanation: it was promoted heavily (Twitter/X, Hacker News, the Karpathy reference in the README is calculated). Treat it as a signal of interest, not of battle-tested stability.

---

### 7. Fit assessment for iaGO vault

**Your vault structure:**
- `_context/iago-agency/` + `_context/personal/` — business docs (structured)
- `sessions/` — session digests with frontmatter (structured, high-value for graph)
- `meetings/` — transcripts (structured, high-value)
- `daily/` — daily summaries (structured)
- `projects/` — project notes (structured)

**What graphify would give you:**
- A `GRAPH_REPORT.md` showing which concepts are most central across your vault (god nodes might be "iaGO", "MUNET", specific clients, key decisions)
- Cross-session connection discovery — if three sessions mention the same architectural pattern, the graph surfaces that link explicitly
- INFERRED cross-note relationships you didn't explicitly link (e.g., a decision in a meeting note connecting to a session digest 6 weeks later)
- A `graphify query "what did we decide about Stripe?"` CLI command that traverses the graph instead of full-text searching notes

**What it would NOT give you:**
- Better full-text search (your existing `search_notes` MCP tool handles this)
- In-place enrichment of existing notes with new backlinks
- Replacement for your existing Obsidian MCP integration — the two would coexist

**The specific pattern you want to solve:** "search Obsidian before asking me." The PreToolUse hook + `GRAPH_REPORT.md` addresses this: Claude reads the report before Glob/Grep calls and navigates by graph structure instead of keyword matching. But your existing `search_notes` MCP already covers keyword-based lookup. The gap graphify fills is *structural* retrieval — "what's connected to X" rather than "find notes containing X."

---

## Sources

- `gh api repos/safishamsi/graphify/readme` — full README decoded
- `gh api repos/safishamsi/graphify/contents/ARCHITECTURE.md` — module responsibilities and pipeline
- `gh api repos/safishamsi/graphify/contents/graphify/build.py` — graph construction, node deduplication
- `gh api repos/safishamsi/graphify/contents/graphify/extract.py` — tree-sitter AST extraction (preview; full file 112KB)
- `gh api repos/safishamsi/graphify/contents/graphify/analyze.py` — god nodes, surprising connections, suggest_questions
- `gh api repos/safishamsi/graphify/contents/graphify/export.py` — Obsidian vault export, Canvas export
- `gh api repos/safishamsi/graphify/contents/graphify/ingest.py` — URL ingestion (tweets, arXiv, PDFs, webpages)
- `gh api repos/safishamsi/graphify/contents/graphify/serve.py` — MCP stdio server, 7 tools
- `gh api repos/safishamsi/graphify/contents/graphify/skill.md` — Claude Code skill definition
- `gh api repos/safishamsi/graphify/contents/pyproject.toml` — dependencies, optional extras, version
- `gh api repos/safishamsi/graphify/contents/CHANGELOG.md` — version history (0.3.17 → 0.1.8)
- `gh api repos/safishamsi/graphify/issues` — 27 open issues

---

## Recommendation

**Decision:** Install graphify on your Obsidian vault, but use it as an MCP server, not as an Obsidian vault exporter.

**Confidence:** High

**Reasoning:** The `--obsidian` export flag creates a parallel vault that doesn't merge into your existing one — it's the wrong integration point for you. The right integration is: run `graphify /c/Users/sanal/dev/obsidian-brain --no-viz` to build `graph.json`, then start `python -m graphify.serve graphify-out/graph.json` as an MCP server registered in your Claude Code config. This gives Claude `query_graph`, `god_nodes`, and `shortest_path` as structured tools — complementing your existing `search_notes` (keyword) with graph traversal (structural). The `GRAPH_REPORT.md` + `graphify claude install` PreToolUse hook directly addresses the "search Obsidian before asking me" pattern. The token efficiency claim (71.5x at 52 files) compounds favorably at your vault's scale.

The risk is project maturity: 0.3.17 in 5 days means you're running very fresh code. Pin the version (`pip install graphifyy==0.3.17`) and re-evaluate upgrades deliberately.

**Next step:** 
```bash
pip install "graphifyy[mcp,leiden,pdf]==0.3.17"
graphify /c/Users/sanal/dev/obsidian-brain --no-viz
# Review GRAPH_REPORT.md manually first — validate extraction quality before integrating
graphify claude install  # installs PreToolUse hook + CLAUDE.md section
# Then add to Claude Code MCP config:
python -m graphify.serve graphify-out/graph.json
```

**Risk if wrong:** You spend 1–2 hours on setup and discover the graph's INFERRED edges on prose notes are too noisy to be useful. Rollback is `graphify claude uninstall` and `pip uninstall graphifyy` — no vault modification happens, so the downside is time, not data.

**Condition for changing this recommendation:** If the GRAPH_REPORT.md after first run shows mostly noise (INFERRED edges between unrelated notes with confidence < 0.4), the graph topology of prose-only content may not be dense enough to be useful. In that case, skip graphify and invest that time into structured tagging conventions within Obsidian instead.
