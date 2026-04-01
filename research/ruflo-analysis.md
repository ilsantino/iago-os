# Ruflo Analysis

## Overview

Ruflo (formerly "Claude Flow") is a large-scale AI agent orchestration framework at v3.5, with 5,900+ commits, 259 MCP tools, 60+ agent types, and 8 AgentDB controllers. It is far more ambitious than ECC -- this is a full enterprise platform with swarm coordination, neural learning, plugin ecosystems (IPFS-distributed), dual-mode Claude+Codex collaboration, and a CLI with 26 commands and 140+ subcommands.

**Maturity**: Production-alpha. Heavy infrastructure, lots of bash-only scripts, many moving parts. The core context persistence hook (`context-persistence-hook.mjs`) is the crown jewel -- a genuinely well-engineered 1,979-line Node.js module with 4-tier backend fallback, importance-ranked retrieval, and a Context Autopilot that monitors token usage in real-time.

**Quality assessment**: Mixed. The context persistence system is excellent. The agent definitions are thorough markdown templates. But much of the infrastructure (daemon manager, swarm monitor, health monitor, metrics) is bash-only, Linux-focused, and would not run on Windows. The project suffers from feature creep -- neural networks, HNSW indexing, Byzantine fault tolerance, quantum optimizers -- most of which are aspirational or stub implementations.

**Key difference from ECC**: ECC had a simpler hook-based approach with a thin session manager. Ruflo has a full context autopilot that reads the actual Claude API usage data from transcript JSONL files, computes real token percentages, and provides proactive archiving on every prompt submission -- not just at compaction time.

## Agent Architecture

| Agent Type | Role | Config Format | Relevant to Us? | Source Path |
|-----------|------|--------------|-----------------|-------------|
| coder | Code implementation specialist | Markdown with YAML frontmatter (`name`, `description`) | Yes - template pattern | `/tmp/ruflo-research/.claude/agents/core/coder.md` |
| planner | Strategic planning, task decomposition | Markdown with YAML frontmatter | Yes - template pattern | `/tmp/ruflo-research/.claude/agents/core/planner.md` |
| researcher | Research and analysis | Markdown with YAML frontmatter | Yes - template pattern | `/tmp/ruflo-research/.claude/agents/core/researcher.md` |
| reviewer | Code review and quality | Markdown with YAML frontmatter | Yes - template pattern | `/tmp/ruflo-research/.claude/agents/core/reviewer.md` |
| tester | Testing specialist | Markdown with YAML frontmatter | Yes - template pattern | `/tmp/ruflo-research/.claude/agents/core/tester.md` |
| architect (YAML) | System design | YAML (`type`, `version`, `capabilities`, `optimizations`) | No - redundant with md agents | `/tmp/ruflo-research/agents/architect.yaml` |
| hierarchical-coordinator | Swarm coordination | Markdown | No - overkill for 3-person team | `/tmp/ruflo-research/.claude/agents/swarm/hierarchical-coordinator.md` |
| queen-coordinator | Hive-mind leader | Markdown | No - enterprise swarm pattern | `/tmp/ruflo-research/.claude/agents/hive-mind/queen-coordinator.md` |
| v3-integration-architect | V3-specific integration | Markdown | No - Ruflo-specific | `/tmp/ruflo-research/.claude/agents/v3/v3-integration-architect.md` |
| codex-coordinator | Dual-mode Claude+Codex | Markdown | No - we don't use Codex | `/tmp/ruflo-research/.claude/agents/dual-mode/codex-coordinator.md` |

**Agent config pattern**: Two formats coexist:
1. **`.claude/agents/` directory**: Markdown files with YAML frontmatter (`---\nname: coder\ndescription: ...\n---`). This is the Claude Code native format. Agent body is prompt instructions.
2. **`agents/` root directory**: YAML files with `type`, `version`, `capabilities[]`, `optimizations[]`, `createdAt`. These are for the Codex CLI integration.

The `.claude/agents/` pattern with markdown frontmatter is the one we should adopt.

## Context Autopilot -- Deep Dive

This is the most valuable piece in the entire repo. Located at `/tmp/ruflo-research/.claude/helpers/context-persistence-hook.mjs` (1,979 lines).

### How It Works

The hook intercepts three Claude Code lifecycle events:

1. **UserPromptSubmit** (proactive): On EVERY user prompt, archives the current transcript and reports context usage percentage.
2. **PreCompact** (safety net): When compaction triggers, archives any remaining unarchived turns and outputs compact instructions to stdout.
3. **SessionStart** (restore): After compaction or `/clear`, restores archived context via importance-ranked retrieval.

### Backend Cascade (4 tiers)

Resolution order in `resolveBackend()`:

| Tier | Backend | Implementation | Dependencies |
|------|---------|---------------|-------------|
| 1 | `SQLiteBackend` | better-sqlite3 with WAL mode, prepared statements, ACID transactions | `better-sqlite3` (native) |
| 2 | `RuVectorBackend` | PostgreSQL with pgvector, GNN search | `pg` + PostgreSQL server |
| 3 | AgentDB | @claude-flow/memory HNSW search | `@claude-flow/memory` package |
| 4 | `JsonFileBackend` | Plain JSON file, Map-based in-memory | None (always works) |

**For iaGO-OS**: We only need Tier 4 (JSON) as primary, potentially Tier 1 (SQLite) later. Tiers 2-3 are enterprise-scale and irrelevant.

### Data Storage Paths

- Archive DB: `{PROJECT_ROOT}/.claude-flow/data/transcript-archive.db`
- Archive JSON: `{PROJECT_ROOT}/.claude-flow/data/transcript-archive.json`
- Autopilot state: `{PROJECT_ROOT}/.claude-flow/data/autopilot-state.json`

### Transcript Parsing

The `parseTranscript(transcriptPath)` function reads Claude Code's transcript JSONL file (provided via stdin as `transcript_path`). Each line is either:
- `{ type: "user"|"A", message: { role, content } }` -- SDK transcript wrapper
- `{ role: "user"|"assistant", content: [...] }` -- raw API message
- Other entries (progress, file-history-snapshot, queue-operation) are skipped.

### Chunking Strategy

`chunkTranscript(messages)` groups messages into conversation turns:
- A turn starts with a user message
- Synthetic user messages (all `tool_result` blocks) are skipped
- Each chunk has: `userMessage`, `assistantMessage`, `toolCalls[]`, `turnIndex`
- Capped at last 500 messages (`MAX_MESSAGES`)

### Entry Format (MemoryEntry)

Each archived chunk becomes an entry with this structure:

```json
{
  "id": "ctx-{timestamp}-{counter}-{random}",
  "key": "transcript:{sessionId}:{turnIndex}:{isoTimestamp}",
  "content": "User: {text}\n\nAssistant: {text}",
  "type": "episodic",
  "namespace": "transcript-archive",
  "tags": ["transcript", "compaction", "{sessionId}", ...toolNames],
  "metadata": {
    "sessionId": "...",
    "chunkIndex": 0,
    "trigger": "proactive|auto",
    "timestamp": "ISO string",
    "toolNames": ["Read", "Edit", ...],
    "filePaths": ["/path/to/file", ...],
    "summary": "extractive summary (max 300 chars)",
    "contentHash": "sha256 hex"
  },
  "accessLevel": "private",
  "createdAt": timestamp_ms,
  "updatedAt": timestamp_ms,
  "version": 1,
  "accessCount": 0,
  "lastAccessedAt": timestamp_ms
}
```

### Deduplication

Uses SHA-256 content hash. Before storing, `backend.hashExists(contentHash)` checks for duplicates via an indexed lookup (SQLite) or scan (JSON).

### Context Autopilot Engine

The autopilot runs on every `UserPromptSubmit`:

1. **Token estimation** (`estimateContextTokens`): Reads the transcript JSONL and extracts the most recent assistant message's `usage` field (`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`). Falls back to character-based estimate (chars / 3.5).
2. **Percentage calculation**: `tokens / CONTEXT_WINDOW_TOKENS` (default 200K).
3. **Warning zone (70%)**: Issues a "keep responses concise" advisory.
4. **Critical zone (85%)**: Advises starting a new session with `/clear`, notes all turns are archived.
5. **State persistence**: Tracks history (last 50 data points), prune count, growth rate, estimated turns remaining.

### Importance Scoring

`computeImportance(entry, now)` ranks entries for retrieval:

```
importance = recency * frequency * richness
```

Where:
- `recency` = exponential decay with 7-day half-life: `exp(-0.693 * ageDays / 7)`
- `frequency` = `log2(accessCount + 1) + 1`
- `richness` = `1.0 + (hasTools ? 0.5 : 0) + (hasFiles ? 0.3 : 0)`

### Restoration Flow

On `SessionStart` (after compaction or `/clear`):
1. Queries entries by session ID, ranked by importance
2. Builds a text block within `RESTORE_BUDGET` chars (default 4000)
3. Each entry is rendered as: `- [Turn X, score:Y] {summary} Tools: ... Files: ...`
4. Marks restored entries as "accessed" (boosts confidence for future)
5. Optionally performs cross-session semantic search for related context from other sessions
6. Returns via stdout as `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }`

### Compact Instructions

On `PreCompact`, the hook outputs custom compact instructions to stdout (exit code 0). These guide Claude on what to preserve:
- Files modified/read (up to 15)
- Tools used
- Key decisions (detected by keywords: "decided", "choosing", "approach", etc.)
- Most recent 5 turns with summaries

### Self-Learning Features (SQLite only)

- **Confidence decay**: -0.5% per hour for unaccessed entries
- **Access boost**: +3% confidence per access
- **Smart pruning**: Removes entries with confidence <= 15% and 0 access count
- **ONNX embeddings**: 384-dim all-MiniLM-L6-v2 vectors (optional, via @xenova/transformers)
- **Semantic search**: Cosine similarity across all entries with embeddings
- **Cross-session search**: Find related context from previous sessions

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_FLOW_COMPACT_RESTORE_BUDGET` | 4000 | Max chars for restored context |
| `CLAUDE_FLOW_COMPACT_INSTRUCTION_BUDGET` | 2000 | Max chars for compact instructions |
| `CLAUDE_FLOW_RETENTION_DAYS` | 30 | Days before pruning unaccessed entries |
| `CLAUDE_FLOW_AUTO_OPTIMIZE` | true | Enable pruning/sync/embedding |
| `CLAUDE_FLOW_CONTEXT_AUTOPILOT` | true | Enable real-time context monitoring |
| `CLAUDE_FLOW_CONTEXT_WINDOW` | 200000 | Context window size in tokens |
| `CLAUDE_FLOW_AUTOPILOT_WARN` | 0.70 | Warning threshold percentage |
| `CLAUDE_FLOW_AUTOPILOT_PRUNE` | 0.85 | Critical threshold percentage |

## Session State Pattern

### Session Manager

Located at `/tmp/ruflo-research/.claude/helpers/session.cjs` (cross-platform Node.js CJS).

**Session file**: `{PROJECT_ROOT}/.claude-flow/sessions/current.json`

Format:
```json
{
  "id": "session-{timestamp}",
  "startedAt": "ISO string",
  "platform": "win32|darwin|linux",
  "cwd": "/path/to/project",
  "context": {},
  "metrics": { "edits": 0, "commands": 0, "tasks": 0, "errors": 0 }
}
```

Operations:
- `start()`: Creates new session, writes to `current.json`
- `restore()`: Reads `current.json`, sets `restoredAt`
- `end()`: Archives to `{session-id}.json`, deletes `current.json`
- `metric(name)`: Increments a metric counter
- `status()`: Reports session info

**Data directory resolution** (cross-platform):
- First tries: `{cwd}/.claude-flow/sessions/`
- Windows fallback: `%APPDATA%/claude-flow/sessions/`
- macOS fallback: `~/Library/Application Support/claude-flow/sessions/`
- Linux fallback: `~/.claude-flow/sessions/`

### Intelligence Layer

Located at `/tmp/ruflo-research/.claude/helpers/intelligence.cjs`.

Stores data in:
- `{PROJECT_ROOT}/.claude-flow/data/auto-memory-store.json` (entries)
- `{PROJECT_ROOT}/.claude-flow/data/ranked-context.json` (PageRank-ordered cache)
- `{PROJECT_ROOT}/.claude-flow/data/pending-insights.jsonl` (edit tracking)

On `session-restore`: Loads entries from store or bootstraps from MEMORY.md files. Computes word-overlap matching (Jaccard similarity) for prompt-to-pattern routing.

On `session-end`: Consolidates pending insights, flushes JSONL.

### Memory Helper

Located at `/tmp/ruflo-research/.claude/helpers/memory.cjs`. Simple key-value store backed by `{PROJECT_ROOT}/.claude-flow/data/memory.json`.

**Compatible with .iago/ approach?** Yes. All paths use `process.cwd()` relative resolution. Changing `.claude-flow/` to `.iago/` is trivial. The session manager already handles cross-platform paths.

## Daemon/Heartbeat Pattern

### How It Works

Located at `/tmp/ruflo-research/.claude/helpers/daemon-manager.sh` (bash-only, Linux-focused).

The daemon starts two background processes:
1. **Swarm Monitor**: Polls swarm state every 30s, writes to `.claude-flow/metrics/swarm-activity.json`
2. **Metrics Daemon**: Runs `metrics-db.mjs` as a Node.js process every 60s, writes SQLite metrics

Both store PIDs in `.claude-flow/pids/` and log to `.claude-flow/logs/`. Uses `nohup`, `ps aux`, `pgrep`, and other Unix-only commands.

Additionally:
- **Health Monitor** (`health-monitor.sh`): Checks disk, memory, processes, CPU, file descriptors every 5 minutes
- **Worker Manager** (`worker-manager.sh`): Manages 12 background workers with priorities

### Why We Do NOT Need This

1. **Paperclip handles orchestration**: Our agent wake-up is handled externally, not by daemons.
2. **Bash-only**: `daemon-manager.sh` uses `nohup`, `pgrep`, `ps aux`, `free -m`, `/proc/loadavg` -- none of which work on Windows.
3. **Overkill**: For a 3-person team, background swarm monitoring and 12 worker processes are unnecessary overhead.
4. **Stale state**: The statusline already handles stale-state detection (5-minute threshold on JSON files).

### Patterns Worth Borrowing

- **Statusline** (`statusline.cjs`): The single-file status generator that reads from JSON state files (no exec calls for metrics) is a good pattern. It shows git branch, model name, intelligence %, hooks count, MCP status in one line.
- **PID file pattern**: Simple `echo $pid > pidfile` / `cat pidfile | kill` -- useful if we ever need a background process.
- **Metrics as JSON files**: Writing small JSON files to a metrics directory that any process can read is a good decoupled pattern.

## Configuration Architecture

### CLAUDE.md

Located at `/tmp/ruflo-research/CLAUDE.md` (1,050 lines). This is the primary configuration surface. Contains:

1. **Behavioral rules**: Standard Claude Code discipline rules
2. **File organization**: No root folder saves, use standard directories
3. **Architecture rules**: DDD, 500-line limit, TDD London School, typed interfaces
4. **Package table**: Maps package names to paths and purposes
5. **Concurrency rules**: "1 MESSAGE = ALL RELATED OPERATIONS" -- batch everything
6. **Swarm configuration**: Topology, strategy, consensus, anti-drift coding swarm
7. **Dual-mode collaboration**: Claude + Codex parallel execution (irrelevant to us)
8. **3-tier model routing**: WASM Agent Booster (<1ms) -> Haiku (~500ms) -> Sonnet/Opus (2-5s)
9. **Hook system docs**: 17 hooks + 12 workers documented inline
10. **CLI command reference**: All 26 commands with subcommands
11. **Publishing workflow**: npm publish across 3 packages with dist-tag management

### settings.json

Located at `/tmp/ruflo-research/.claude/settings.json`. Key sections:

- `model`: `claude-opus-4-6`
- `hooks`: Full hook wiring (PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, SessionEnd, Stop, PreCompact, SubagentStart, TeammateIdle, TaskCompleted)
- `permissions.allow/deny`: Bash command patterns, MCP tool patterns
- `claudeFlow.agentTeams`: Agent Teams experimental feature config
- `claudeFlow.daemon`: Worker list and schedules
- `statusLine`: Points to `statusline.cjs`
- `mcpServers`: MCP server definitions
- `agents.source`: `.claude/agents` directory

### .agents/config.toml

For Codex CLI integration. Contains model selection, approval policy, sandbox mode, security settings, performance limits, neural config, swarm config, hooks config, and worker config. Not relevant to us (Codex-specific).

### CLAUDE.local.md

Minimal local overrides with env var references and quick-reference commands.

## Patterns to Steal

### 1. Context Persistence Hook (PRIMARY TARGET)

**File**: `/tmp/ruflo-research/.claude/helpers/context-persistence-hook.mjs`

What to extract:
- `JsonFileBackend` class (lines 358-432) -- zero-dependency JSON file storage
- `parseTranscript()` function -- reads Claude Code transcript JSONL
- `chunkTranscript()` -- groups messages into conversation turns
- `extractSummary()` -- extractive summarization without LLM calls
- `buildEntry()` -- creates structured memory entries
- `hashContent()` -- SHA-256 dedup
- `buildCompactInstructions()` -- guides compaction on what to preserve
- `computeImportance()` -- recency * frequency * richness scoring
- `retrieveContextSmart()` -- importance-ranked restoration
- `estimateContextTokens()` -- reads actual API usage from transcript JSONL
- `runAutopilot()` -- real-time context monitoring with growth trend prediction

### 2. Session Manager

**File**: `/tmp/ruflo-research/.claude/helpers/session.cjs`

What to extract:
- Cross-platform data directory resolution (Windows/Mac/Linux)
- Simple session lifecycle (start/restore/end/metric)
- Session file format (JSON with metrics)

### 3. Hook Handler Pattern

**File**: `/tmp/ruflo-research/.claude/helpers/hook-handler.cjs`

What to extract:
- stdin JSON parsing with timeout (prevents hanging)
- Safe module loading with silent require
- Dispatch table pattern for hook routing
- Dangerous command blocking (pre-bash)

### 4. Intelligence/Context Retrieval

**File**: `/tmp/ruflo-research/.claude/helpers/intelligence.cjs`

What to extract:
- MEMORY.md bootstrapping (reads all MEMORY.md files from known directories)
- Word-overlap matching (Jaccard similarity) for prompt routing
- Ranked context JSON cache pattern

### 5. Settings.json Hook Wiring

**File**: `/tmp/ruflo-research/.claude/settings.json`

What to extract:
- Hook configuration structure (matchers, timeouts, command paths using `$CLAUDE_PROJECT_DIR`)
- Permission patterns (allow/deny with glob patterns)
- StatusLine configuration

### 6. Agent Definition Format

**File**: `/tmp/ruflo-research/.claude/agents/core/coder.md`

What to extract:
- YAML frontmatter format (`name`, `description`)
- Markdown body as prompt template
- Directory-based organization (`core/`, `templates/`, `custom/`)

### 7. Statusline

**File**: `/tmp/ruflo-research/.claude/helpers/statusline.cjs`

What to extract:
- Single-call git info gathering (branch + status + upstream in one shell exec)
- Model name detection from `~/.claude.json`
- ANSI color palette for terminal output
- JSON state file reading pattern (no exec for metrics)

## Modularity Analysis

**Core context persistence is self-contained but internally coupled:**

1. **`context-persistence-hook.mjs` is a monolith.** 1,979 lines with 4 backend tiers, transcript parsing, chunking, importance scoring, autopilot engine, and compact instructions all in one file. It works as a unit — you can't take just the importance scoring without the transcript parser. However, you CAN strip backends (keep JSON-only) and remove ONNX embeddings to get a ~600-800 line version that still works.

2. **Session manager (`session.cjs`) is standalone.** Cross-platform Node.js, ~100 lines. Can be extracted independently of the context persistence hook. Handles session file CRUD.

3. **Hook handler (`hook-handler.cjs`) is the dispatcher.** Routes events to handlers. Depends on the context persistence hook and session manager. Take as a set.

4. **Daemon infrastructure is tightly coupled and skippable.** `daemon-manager.sh`, `health-monitor.sh`, `worker-manager.sh`, `swarm-monitor.sh` — all bash-only, all interdependent, all Linux-only. Skip as a unit.

5. **Intelligence/routing is loosely coupled.** `intelligence.cjs` (memory bootstrap) and `router.cjs` (keyword routing) can be extracted independently. Neither depends on the context persistence hook.

6. **Statusline is standalone.** `statusline.cjs` reads git info, model detection, session duration. No dependencies on other Ruflo components.

**Extractable independently:** Session manager, statusline, intelligence/routing, importance scoring algorithm (as a pattern, not code)
**Extract as a set:** Context persistence hook + hook handler + settings.json wiring
**Skip as a unit:** All daemon/bash infrastructure, all heavyweight backends (SQLite, PostgreSQL, ONNX)

---

## Comparison vs ECC / GSD / The Architect / Superpowers

| Dimension | Ruflo | ECC | GSD | The Architect | Superpowers |
|-----------|-------|-----|-----|--------------|-------------|
| **Primary purpose** | Context lifecycle, archiving, token awareness | Hook-based workflow automation, session persistence | Spec-driven multi-phase development | Design-phase planning, blueprint generation | Development methodology via skills |
| **Context management** | **Best in class.** Proactive archiving on every prompt, real API token usage, importance scoring | suggest-compact (counter-based) + strategic-compact skill | Context monitor hook with bridge file | Lazy-loading knowledge files | Not addressed |
| **Token tracking** | Reads actual API `usage` field from transcript JSONL — **unique accuracy** | Not present | Approximate via bridge file | Not addressed | Not addressed |
| **Importance scoring** | `recency * frequency * richness` — **unique** | Not present | Not present | Not present | Not present |
| **Session persistence** | Proactive archiving with context restoration — **superior** | File-based trio with idempotent markers | Pause/resume with HANDOFF.json | None (single session) | None |
| **Hook system** | Single monolithic hook handler | Profile-gated dispatcher — **superior for hooks** | 5 specialized hooks | None | Session-start injection only |
| **Workflow enforcement** | Context-threshold triggers | Hook-based (pre/post tool) | Code-gated phases + artifacts | Prompt-based (LLM honor system) | Skill-based (mandatory + red flags) |
| **Cross-platform** | Node.js CJS (cross-platform) | Node.js CJS (cross-platform) | Node.js CJS (cross-platform) | Pure markdown | Pure markdown |

**Ruflo's unique contributions not found elsewhere:**
1. Proactive context archiving on every prompt (not just at compaction) — only Ruflo does this
2. Real API token usage tracking from transcript JSONL — only Ruflo reads actual usage data
3. Importance-ranked context restoration (`recency * frequency * richness`) — no other repo scores context importance
4. JsonFileBackend as a zero-dep persistence tier — simplest working backend across all repos
5. Compact instruction injection (decisions, files, tools, recent turns) — most structured compact guidance

---

## What to Skip

| Component | Reason |
|-----------|--------|
| Daemon manager (`daemon-manager.sh`) | Bash-only, Linux-only (`nohup`, `pgrep`, `free -m`). Paperclip handles orchestration. |
| Health monitor (`health-monitor.sh`) | Uses `/proc/loadavg`, `free -m`, `pgrep` -- all Linux-only. |
| Worker manager (`worker-manager.sh`) | 12 background workers with priorities -- overkill for 3-person team. |
| Swarm monitor (`swarm-monitor.sh`) | Polls swarm state -- no swarms in iaGO-OS. |
| Metrics DB (`metrics-db.mjs`) | SQLite metrics daemon -- unnecessary overhead. |
| Learning service (`learning-service.mjs`) | Requires `better-sqlite3` native module and ONNX runtime. Heavy. |
| Patch aggressive prune (`patch-aggressive-prune.mjs`) | Monkey-patches Claude Code's cli.js internals. Fragile, version-dependent. |
| Aggressive microcompact (`aggressive-microcompact.mjs`) | Documentation-only file for `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. The env var trick itself is interesting but risky. |
| RuVector PostgreSQL backend | TB-scale PostgreSQL with pgvector. Way beyond our needs. |
| AgentDB/HNSW backend | Requires `@claude-flow/memory` package. Heavy dependency. |
| ONNX embeddings | Requires `@xenova/transformers`. 100+ MB download. |
| Plugin system (IPFS/Pinata) | Full plugin marketplace with IPFS distribution. Completely irrelevant. |
| Dual-mode Claude+Codex | We don't use OpenAI Codex. |
| Neural learning (SONA, MoE, EWC++) | Stub implementations. More aspirational than functional. |
| Byzantine/Raft/Gossip consensus | Enterprise distributed systems patterns. 3-person team doesn't need BFT. |
| V3 TypeScript source (`v3/src/`, `v3/@claude-flow/`) | Full framework source. We want patterns, not the framework. |
| `.agents/config.toml` | Codex CLI config format. We use Claude Code. |
| 100+ SKILL.md files | Prompt templates for swarm skills. Most are generic boilerplate. |

## Adaptation Notes

### Directory Mapping

| Ruflo Path | iaGO-OS Path | Notes |
|-----------|-------------|-------|
| `.claude-flow/data/` | `.iago/data/` | Context archive, memory store, autopilot state |
| `.claude-flow/sessions/` | `.iago/sessions/` | Session state files |
| `.claude/helpers/` | `.iago/hooks/` | Hook scripts (.mjs files) |
| `.claude/agents/` | `.iago/agents/` | Agent definitions (keep this path since Claude Code reads it) |
| `.claude/settings.json` | `.claude/settings.json` | Must stay in `.claude/` for Claude Code to read it |

### Node.js Conversion Requirements

1. **`session.cjs` -> `session.mjs`**: Already Node.js. Change from CJS to ESM. Update paths from `.claude-flow/` to `.iago/`.

2. **`context-persistence-hook.mjs`**: Already ESM. Key changes needed:
   - Remove SQLiteBackend, RuVectorBackend, AgentDB backend classes (keep only JsonFileBackend)
   - Remove ONNX embedding code (removes @xenova/transformers dependency)
   - Remove `createHashEmbedding()` and semantic search (use simple text matching if needed)
   - Update all paths from `.claude-flow/` to `.iago/`
   - Keep: transcript parsing, chunking, importance scoring, autopilot engine, compact instructions
   - Estimated stripped-down size: ~600-800 lines (from 1,979)

3. **`hook-handler.cjs` -> `hook-handler.mjs`**: Convert to ESM. Simplify dispatch table. Remove swarm/neural/intelligence references. Keep: route, pre-bash, post-edit, session-restore, session-end, compact handlers.

4. **`intelligence.cjs` -> `intelligence.mjs`**: Simplify. Keep MEMORY.md bootstrapping and word-overlap matching. Remove PageRank, graph, and neural references.

5. **`memory.cjs` -> `memory.mjs`**: Already simple. Convert to ESM, update paths.

6. **`router.cjs` -> `router.mjs`**: Already simple keyword-based routing. Convert to ESM. Trim agent types to just our needs.

7. **`statusline.cjs` -> `statusline.mjs`**: Already pure Node.js. Convert to ESM. Remove V3/DDD/ADR/AgentDB/swarm sections. Keep: git info, model detection, session duration, hooks count.

### Hook Wiring (settings.json)

Adapt the settings.json hook structure, but all commands must use `node` (not bash):

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" user-prompt-submit",
        "timeout": 10000
      }]
    }],
    "PreCompact": [{
      "matcher": "auto",
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" pre-compact",
        "timeout": 15000
      }]
    }],
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" session-start",
        "timeout": 15000
      }]
    }]
  }
}
```

### Critical Differences from ECC

| Aspect | ECC | Ruflo | iaGO-OS Should |
|--------|-----|-------|---------------|
| Context persistence | Pre-compact snapshot only | Proactive archiving on every prompt + pre-compact safety net | Use Ruflo's proactive approach |
| Token estimation | Not present | Reads actual API `usage` field from transcript JSONL | Use Ruflo's API-usage method |
| Importance scoring | Not present | recency * frequency * richness | Adopt as-is |
| Compact instructions | Basic | Extracts decisions, files, tools, recent turns | Adopt as-is |
| Session manager | Bash-only | Cross-platform Node.js CJS | Adopt and convert to ESM |
| Backend | Single file | 4-tier cascade | Use JSON-only (Tier 4) |
| Cross-session search | Not present | Semantic similarity across sessions | Skip (needs embeddings) |
| Self-learning | Not present | Confidence decay, access boost, pruning | Adopt simplified version |

### Implementation Priority

1. **Context persistence hook** (stripped to JSON-only backend, ~600 lines)
2. **Session manager** (convert to ESM, ~100 lines)
3. **Hook handler/dispatcher** (simplified, ~100 lines)
4. **Settings.json hook wiring**
5. **Statusline** (stripped down, ~150 lines)
6. **Intelligence/routing** (simplified word matching, ~100 lines)
