# Hooks Synthesis — Extracted Patterns

Raw material extracted from: `ecc-analysis.md`, `ruflo-analysis.md`, `gsd-analysis.md` (Compaction Strategy + Adaptation Note 8), `superpowers.md` (Verification-before-completion).

---

## 1. Dispatcher Patterns

### ECC: `run-with-flags.js` (182 lines)
- **Source**: `scripts/hooks/run-with-flags.js`
- **Hook events**: All (wraps any hook as a dispatcher)
- **How it works**: Every hook in `hooks.json` is registered as `node run-with-flags.js "hook-id" "relative/path.js" "profile1,profile2"`. The dispatcher:
  1. Reads stdin (JSON, max 1MB, tracks truncation)
  2. Calls `isHookEnabled(hookId, {profiles})` from `hook-flags.js` — checks `ECC_HOOK_PROFILE` env (minimal/standard/strict) and `ECC_DISABLED_HOOKS` env for comma-separated hook IDs
  3. Resolves script path relative to `CLAUDE_PLUGIN_ROOT`, with path traversal guard
  4. **Fast path**: If script exports `run()`, `require()`s it directly (saves ~50-100ms per invocation). Detects by checking `module.exports` + `run` in source text before attempting `require()`
  5. **Legacy path**: Falls back to `spawnSync` child process with 30s timeout
  6. Forwards stdout/stderr/exitCode appropriately

### ECC: Profile Gating via `hook-flags.js` (74 lines)
- **Source**: `scripts/lib/hook-flags.js`
- **Dependency of**: `run-with-flags.js`
- **How it works**: Exports `isHookEnabled(hookId, {profiles})`. Reads two env vars:
  - `ECC_HOOK_PROFILE` — active profile (minimal/standard/strict)
  - `ECC_DISABLED_HOOKS` — comma-separated list of hook IDs to disable (e.g., `pre:bash:tmux-reminder,post:edit:typecheck`)
- Per-hook disable without editing config files; profile switching for quick iterations vs careful code

### ECC: Env-var Disabling
- `ECC_DISABLED_HOOKS=pre:bash:tmux-reminder,post:edit:typecheck` disables specific hooks at runtime
- No config file edits needed; useful for temporary overrides

### ECC: In-process `require()` Optimization
- For hooks exporting `run(rawInput)`, the dispatcher calls them in-process instead of spawning a child
- Saves ~50-100ms per hook invocation
- Detection: reads source text, checks for `module.exports` and `run` function presence

### Ruflo: Single Monolithic Hook Handler
- **Source**: `.claude/helpers/hook-handler.cjs`
- **Hook events**: Routes all events through one file via dispatch table
- **How it works**: stdin JSON parsing with timeout (prevents hanging), safe module loading with silent require, dispatch table routes to handler functions (pre-bash, post-edit, session-restore, session-end, compact)
- No profile gating; no per-hook disable mechanism

### GSD: No Central Dispatcher
- **Source**: `hooks/gsd-context-monitor.js`, `hooks/gsd-statusline-hook.js`, `hooks/gsd-prompt-guard.js`
- Each hook is self-contained and registered directly in `settings.json`
- No dispatcher layer; each hook handles its own stdin parsing
- 5 hooks total (statusline, context monitor, update checker, prompt guard, workflow guard)

---

## 2. Context Persistence Patterns

### ECC: Session Trio

#### `session-start.js` (SessionStart hook)
- **Source**: `scripts/hooks/session-start.js`
- **Hook event**: SessionStart
- **What it does**: Loads previous session summary from `~/.claude/session-data/`, detects package manager, detects project type (languages/frameworks), loads learned skills, lists session aliases. Injects context via `hookSpecificOutput`.
- **Storage location**: `~/.claude/session-data/`
- **File format**: `{date}-{sessionId}-session.tmp` markdown files

#### `session-end.js` (Stop hook)
- **Source**: `scripts/hooks/session-end.js`
- **Hook event**: Stop
- **What it does**: Reads transcript JSONL, extracts user messages, tools used, files modified. Writes/updates session summary file with idempotent marker-based sections.
- **Idempotent markers**: `<!-- ECC:SUMMARY:START -->` / `<!-- ECC:SUMMARY:END -->` — replaces sections without duplication
- **Merge-on-existing**: If session file already exists, merges new data into existing sections via marker detection
- **Header normalization**: Standardizes markdown headers on write

#### `pre-compact.js` (PreCompact hook, 49 lines)
- **Source**: `scripts/hooks/pre-compact.js`
- **Hook event**: PreCompact
- **What it does**: Logs compaction timestamp, appends note to active session file. Marks when context was compacted so the next `session-start` knows.
- **Simple append**: Timestamp + "compaction occurred" note to session file

### Ruflo: Context Autopilot

#### `context-persistence-hook.mjs` (1,979 lines)
- **Source**: `.claude/helpers/context-persistence-hook.mjs`
- **Hook events**: UserPromptSubmit (proactive), PreCompact (safety net), SessionStart (restore)

**Archiving trigger**: Runs on EVERY `UserPromptSubmit` — proactive archiving, not just at compaction time. PreCompact is the safety net for anything missed.

**Token tracking method**: Reads Claude Code's transcript JSONL file (provided via stdin as `transcript_path`). Extracts the most recent assistant message's `usage` field: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Falls back to character-based estimate (chars / 3.5). Calculates `tokens / CONTEXT_WINDOW_TOKENS` (default 200K).

**Warning/critical thresholds**:
- 70% used: "Keep responses concise" advisory
- 85% used: "Start new session with `/clear`" advisory
- State tracks: last 50 data points, prune count, growth rate, estimated turns remaining

**Importance-ranked retrieval formula**:
```
importance = recency × frequency × richness
```
Where:
- `recency` = exponential decay with 7-day half-life: `exp(-0.693 × ageDays / 7)`
- `frequency` = `log2(accessCount + 1) + 1`
- `richness` = `1.0 + (hasTools ? 0.5 : 0) + (hasFiles ? 0.3 : 0)`

**JsonFileBackend** (Tier 4 — zero-dependency):
- Storage: `{PROJECT_ROOT}/.claude-flow/data/transcript-archive.json`
- Autopilot state: `{PROJECT_ROOT}/.claude-flow/data/autopilot-state.json`
- Map-based in-memory with JSON persistence
- SHA-256 content hash for deduplication (`backend.hashExists(contentHash)`)

**Compact instruction injection format**: On PreCompact, outputs to stdout (exit code 0). Guides Claude on what to preserve:
- Files modified/read (up to 15)
- Tools used
- Key decisions (detected by keywords: "decided", "choosing", "approach", etc.)
- Most recent 5 turns with summaries
- Format: `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }`

**Entry format (MemoryEntry)**:
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
  }
}
```

**Transcript parsing**: Reads JSONL, each line is either `{ type: "user"|"A", message: { role, content } }` (SDK wrapper) or `{ role: "user"|"assistant", content: [...] }` (raw API). Skips progress, file-history-snapshot, queue-operation entries.

**Chunking**: Groups messages into conversation turns. A turn starts with a user message. Synthetic user messages (all `tool_result` blocks) are skipped. Capped at last 500 messages.

**Restoration flow (SessionStart)**: Queries entries by session ID ranked by importance, builds text within `RESTORE_BUDGET` (default 4000 chars), renders as `- [Turn X, score:Y] {summary} Tools: ... Files: ...`, marks restored entries as "accessed".

**Environment variables**:
| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_FLOW_COMPACT_RESTORE_BUDGET` | 4000 | Max chars for restored context |
| `CLAUDE_FLOW_COMPACT_INSTRUCTION_BUDGET` | 2000 | Max chars for compact instructions |
| `CLAUDE_FLOW_RETENTION_DAYS` | 30 | Days before pruning unaccessed entries |
| `CLAUDE_FLOW_CONTEXT_AUTOPILOT` | true | Enable real-time context monitoring |
| `CLAUDE_FLOW_CONTEXT_WINDOW` | 200000 | Context window size in tokens |
| `CLAUDE_FLOW_AUTOPILOT_WARN` | 0.70 | Warning threshold percentage |
| `CLAUDE_FLOW_AUTOPILOT_PRUNE` | 0.85 | Critical threshold percentage |

### GSD: Bridge File Approach

#### Statusline writes to bridge file
- **Source**: `hooks/gsd-statusline-hook.js`
- The statusline hook writes context metrics to a temp JSON file on every invocation
- **Bridge file location**: `/tmp/claude-ctx-{session_id}.json`
- **Bridge file schema**:
```json
{
  "session_id": "abc123",
  "remaining_percentage": 28.5,
  "used_pct": 71,
  "timestamp": 1708200000
}
```

#### Context monitor reads bridge file
- **Source**: `hooks/gsd-context-monitor.js` (PostToolUse/AfterTool hook)
- Reads metrics from bridge file written by statusline
- **Threshold values**:
  - `> 35%` remaining: Normal (no warning)
  - `<= 35%` remaining: WARNING — "Context is getting limited. Avoid starting new complex work."
  - `<= 25%` remaining: CRITICAL — "Context nearly exhausted. Inform the user so they can run /gsd:pause-work."
- **Debounce logic**: 5 tool uses between warnings. Severity escalation bypasses debounce.
- Injects warnings via agent conversation (hookSpecificOutput)

#### Pause/resume with HANDOFF.json
- **Source**: `get-shit-done/workflows/pause-work.md`
- When context runs low, `/gsd:pause-work` creates:
  1. **`.planning/HANDOFF.json`** — Machine-readable state:
     - `phase`, `plan`, `task` numbers
     - `completed_tasks` with commit hashes
     - `remaining_tasks`
     - `blockers`, `human_actions_pending`
     - `decisions`, `uncommitted_files`, `next_action`
  2. **`.planning/phases/XX-name/.continue-here.md`** — Human-readable with XML-tagged sections: `<current_state>`, `<completed_work>`, `<remaining_work>`, `<decisions_made>`, `<blockers>`, `<context>`, `<next_action>`
- Both committed as WIP. `/gsd:resume-work` reads HANDOFF.json. `.continue-here.md` is deleted after resume.
- `/clear` recommendation pattern: discard conversation, rely on file-based state. Relaxed with 1M+ context windows.

---

## 3. Post-Edit Quality Patterns

### ECC: `post-edit-format.js` (110 lines)
- **Source**: `scripts/hooks/post-edit-format.js`
- **Hook event**: PostToolUse (Edit)
- **What it does**: Auto-formats JS/TS with detected formatter after every edit. Biome: `check --write`; Prettier: `--write`.
- **Windows handling**: Handles `.cmd` binaries correctly (Biome/Prettier installed via npm on Windows create `.cmd` wrappers). Shell metachar guards to prevent injection.
- **Dependency**: `scripts/lib/resolve-formatter.js` — Biome/Prettier detection logic. Used by both `post-edit-format.js` and `quality-gate.js`.

### ECC: `post-edit-typecheck.js` (97 lines)
- **Source**: `scripts/hooks/post-edit-typecheck.js`
- **Hook event**: PostToolUse (Edit)
- **What it does**: Runs `tsc --noEmit` after editing `.ts`/`.tsx` files. Walks up directory tree to find `tsconfig.json`. Filters output to only show errors in the edited file (avoids flooding with unrelated errors).

### ECC: `post-edit-console-warn.js` (55 lines)
- **Source**: `scripts/hooks/post-edit-console-warn.js`
- **Hook event**: PostToolUse (Edit)
- **What it does**: Warns about `console.log` in edited JS/TS files. Shows line numbers of offending statements.

### ECC: `config-protection.js` (141 lines)
- **Source**: `scripts/hooks/config-protection.js`
- **Hook event**: PreToolUse (Write/Edit/MultiEdit)
- **What it does**: Blocks modifications to linter/formatter config files (`.eslintrc`, `biome.json`, `.prettierrc`, etc.). Forces agent to fix code instead of weakening configs.
- **Exact matchers**: Matches on file path in the tool input. Denylist of config file names/patterns.
- **Exports `run()`**: In-process execution via dispatcher fast path. Handles truncated input gracefully.

### ECC: `quality-gate.js` (PostToolUse Edit/Write/MultiEdit)
- **Source**: `scripts/hooks/quality-gate.js`
- **What it does**: Runs formatter checks after edits. Auto-detects Biome vs Prettier. Handles Go (gofmt) and Python (ruff) too. Skips JS/TS when Biome handles it.
- **Dependency**: `scripts/lib/resolve-formatter.js`

No post-edit quality patterns found in Ruflo, GSD, or Superpowers.

---

## 4. Safety & Guard Patterns

### ECC: `pre-bash-commit-quality.js`
- **Source**: `scripts/hooks/pre-bash-commit-quality.js`
- **Hook event**: PreToolUse (Bash)
- **Trigger**: Before `git commit` commands
- **Secret detection regex patterns** (from `governance-capture.js` — 5 regexes):
  - AWS keys: `AKIA[0-9A-Z]{16}` pattern
  - GitHub PATs: `ghp_[A-Za-z0-9]{36}` pattern
  - OpenAI keys: `sk-[A-Za-z0-9]{48}` pattern
  - Generic secrets/tokens: patterns for `password=`, `secret=`, `token=` in source
  - Private keys: `-----BEGIN.*PRIVATE KEY-----`
- **Blocked commands**: Checks staged files for `console.log`, `debugger` statements, hardcoded secrets
- **Commit validation**: Validates conventional commit message format
- **Lint integration**: Runs ESLint if available
- **Exit behavior**: Blocks on errors (exit code 2), warns on warnings (exit code 0 with stderr)

### GSD: `gsd-prompt-guard.js`
- **Source**: `hooks/gsd-prompt-guard.js`
- **Hook event**: PreToolUse (Write to `.planning/` directory)
- **Injection detection patterns**:
  - Base64 scanning: detects base64-encoded payloads in content being written
  - Path traversal checks: blocks `../` patterns in file paths targeting `.planning/`
  - Prompt injection patterns: scans for common injection markers in content
- **Companion**: `security.cjs` module provides path traversal prevention and shell argument validation

### GSD: `security.cjs`
- **Source**: `bin/lib/security.cjs`
- Path traversal prevention (blocks `../` escaping `.planning/`)
- Shell argument validation (sanitizes args before shell exec)

### Superpowers: Verification-before-completion (not a hook — a skill/discipline)
- **Source**: `skills/verification-before-completion/SKILL.md`
- **Pattern**: "No completion claims without fresh verification evidence." Cross-cutting rule.
- **Common-failures table**: Tests pass requires test output, build succeeds requires exit 0, etc.
- **Not a hook**: Pure markdown instruction. Fires before any task marked complete.

No safety/guard hooks found in Ruflo.

---

## 5. Cost Tracking Patterns

### ECC: `cost-tracker.js` (79 lines)
- **Source**: `scripts/hooks/cost-tracker.js`
- **Hook event**: Stop
- **Model pricing table**: Hardcoded rates per model:
  - Haiku input/output rates
  - Sonnet input/output rates
  - Opus input/output rates
  - (Specific $/1M token values in source code)
- **Token estimation method**: Reads token counts from the Stop hook's input data (last response metadata)
- **JSONL format**: Appends one line per response to `~/.claude/metrics/costs.jsonl`
- **Field list per entry**: timestamp, model, input_tokens, output_tokens, estimated_cost, session_id (inferred from current session)
- **No project attribution**: Does not track which project/client incurred the cost (noted as adaptation point)

No cost tracking found in Ruflo, GSD, or Superpowers.

---

## 6. Compaction Patterns

### ECC: `suggest-compact.js` (81 lines)
- **Source**: `scripts/hooks/suggest-compact.js`
- **Hook event**: PreToolUse (Edit/Write)
- **Counter mechanism**: Counts tool calls in current session via a temp file. Increments on every Edit/Write invocation.
- **Threshold**: Suggests `/compact` at 50 tool calls, then every 25 calls after
- **Temp file path**: OS temp directory, filename includes session ID for scoping: `{os.tmpdir()}/claude-compact-{sessionId}.json`
- **Session scoping**: Counter is session-ID-scoped. New session = new counter. Temp file is cleaned up naturally by OS.
- **Output**: Non-blocking suggestion message via stderr

### Ruflo: Token-percentage Tracking
- **Source**: `.claude/helpers/context-persistence-hook.mjs`
- **API usage field location**: Reads transcript JSONL, finds most recent assistant message's `usage` object containing `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
- **Warning threshold**: 70% of context window (configurable via `CLAUDE_FLOW_AUTOPILOT_WARN`)
- **Critical threshold**: 85% of context window (configurable via `CLAUDE_FLOW_AUTOPILOT_PRUNE`)
- **Context window default**: 200,000 tokens (configurable via `CLAUDE_FLOW_CONTEXT_WINDOW`)
- **Runs on**: Every UserPromptSubmit (proactive), not just at compaction
- **State tracking**: Last 50 data points, growth rate, estimated turns remaining in `autopilot-state.json`

### GSD: Bridge File Context Metrics
- **Source**: `hooks/gsd-statusline-hook.js` (writes), `hooks/gsd-context-monitor.js` (reads)
- **Fields written to bridge file**: `session_id`, `remaining_percentage`, `used_pct`, `timestamp`
- **Bridge file path**: `/tmp/claude-ctx-{session_id}.json`
- **Monitor hook read frequency**: Every PostToolUse invocation (with 5-tool-use debounce on warnings)
- **Warning injection format**: hookSpecificOutput message injected into agent conversation. Plain text warning string at WARNING level; CRITICAL level names specific command (`/gsd:pause-work`).
- **Stale detection**: Statusline checks if bridge file timestamp is >5 minutes old

---

## 7. Statusline Patterns

### Ruflo: `statusline.cjs`
- **Source**: `.claude/helpers/statusline.cjs`
- **Fields shown**: Git branch, model name, intelligence %, hooks count, MCP status, session duration
- **Data sources**:
  - Git info: Single-call shell exec gathering branch + status + upstream
  - Model name: Detection from `~/.claude.json`
  - Intelligence %: Read from JSON state files (no exec calls)
  - Hooks count: Read from settings
  - MCP status: Read from state files
  - Session duration: Calculated from session start time
- **ANSI color usage**: ANSI color palette for terminal output (specific escape codes in source)
- **Git info gathering method**: Single shell exec (`git branch --show-current && git status --porcelain && git rev-parse --abbrev-ref @{upstream}` or similar combined call)
- **Stale state detection**: 5-minute threshold on JSON state files
- **Standalone**: No dependencies on other Ruflo components

### GSD: Statusline as Bridge-File Feeder
- **Source**: `hooks/gsd-statusline-hook.js`
- **Fields written to bridge file**: `session_id`, `remaining_percentage`, `used_pct`, `timestamp`
- **Path**: `/tmp/claude-ctx-{session_id}.json`
- **Update frequency**: Every statusline render (tied to Claude Code's statusline refresh cycle)
- **Purpose**: Primary purpose is feeding the context monitor hook, not just display
- **Architecture**: Statusline writes → bridge file → context monitor reads → injects warnings

---

## 8. Settings.json Hook Wiring

### Ruflo's Hook Wiring Pattern

**Source**: `.claude/settings.json`

Ruflo registers hooks across these event types: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `PreCompact`, `SubagentStart`, `TeammateIdle`, `TaskCompleted`.

**Exact JSON structure** (from Ruflo analysis):
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

**Key structural elements**:
- Each event type maps to an array of hook groups
- Each hook group has optional `matcher` (for PreToolUse/PostToolUse: tool name matching) and a `hooks` array
- Each hook entry has: `type` ("command"), `command` (shell string), `timeout` (ms)
- `$CLAUDE_PROJECT_DIR` — Claude Code's built-in variable resolving to the project root. Cross-platform.
- Commands must use `node` (not bash) for cross-platform

**ECC's hook wiring** (from `hooks/hooks.json`):
- Uses Claude Code's `$schema` for validation
- Defines all PreToolUse, PostToolUse, PreCompact, SessionStart, Stop, SessionEnd hooks with matchers, timeouts, and async flags
- Matchers for PreToolUse/PostToolUse specify tool names: e.g., `"matcher": "Edit"` or `"matcher": "Bash"`
- Supports `"async": true` for non-blocking hooks

**Gotchas documented across reports**:
- `$CLAUDE_PROJECT_DIR` is the canonical way to reference project-relative paths; avoids hardcoded absolute paths
- Timeout values matter: context persistence hooks need 10-15s; simple checks need 5s
- `"matcher": "auto"` on PreCompact means "match any compaction trigger"
- All commands should use `node` not `bash` for Windows compatibility
- `.claude/settings.json` must stay in `.claude/` — Claude Code reads it from that exact location

---

## 9. Shared Utilities

### ECC: `scripts/lib/hook-flags.js` (74 lines)
- **Purpose**: Profile-based hook enable/disable
- **Dependencies**: None (reads env vars only)
- **Exports**: `isHookEnabled(hookId, {profiles})`
- **Used by**: `run-with-flags.js`

### ECC: `scripts/lib/resolve-formatter.js`
- **Purpose**: Detects whether project uses Biome or Prettier. Returns formatter binary path and arguments.
- **Dependencies**: Walks `node_modules/.bin/` for formatter binaries. Handles `.cmd` wrappers on Windows.
- **Used by**: `post-edit-format.js`, `quality-gate.js`

### ECC: `scripts/lib/utils.js`
- **Purpose**: Cross-platform utilities
- **Exports**: `getSessionsDir()`, `ensureDir()`, `readFile()`, and other file system helpers
- **Dependencies**: Node.js `fs`, `path`, `os` only
- **Used by**: Session trio, various hooks

### Ruflo: `.claude/helpers/session.cjs` (~100 lines)
- **Purpose**: Session lifecycle management (start/restore/end/metric)
- **Dependencies**: Node.js `fs`, `path` only
- **Cross-platform data directory resolution**:
  - Primary: `{cwd}/.claude-flow/sessions/`
  - Windows fallback: `%APPDATA%/claude-flow/sessions/`
  - macOS fallback: `~/Library/Application Support/claude-flow/sessions/`
  - Linux fallback: `~/.claude-flow/sessions/`
- **Used by**: Hook handler, context persistence

### Ruflo: `.claude/helpers/hook-handler.cjs`
- **Purpose**: Central hook dispatch table, stdin JSON parsing with timeout
- **Dependencies**: session.cjs, context-persistence-hook.mjs
- **Used by**: All hooks route through this

### Ruflo: `.claude/helpers/intelligence.cjs`
- **Purpose**: MEMORY.md bootstrapping, word-overlap matching (Jaccard similarity) for prompt-to-pattern routing
- **Dependencies**: None beyond Node.js builtins
- **Used by**: Session restore flow

### Ruflo: `.claude/helpers/memory.cjs`
- **Purpose**: Simple key-value store backed by `{PROJECT_ROOT}/.claude-flow/data/memory.json`
- **Dependencies**: Node.js `fs` only
- **Used by**: Intelligence layer, session persistence

### GSD: `bin/lib/security.cjs`
- **Purpose**: Path traversal prevention, shell argument validation
- **Dependencies**: Node.js builtins
- **Used by**: `gsd-prompt-guard.js`
