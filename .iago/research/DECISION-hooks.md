# Hook Architecture Decision — iaGO-OS

> Canonical reference. Compiled from DECISION-foundation.md (Phase 2), DECISION-core.md (Phase 3), DECISION-guards.md (Phase 4).
> Date: 2026-03-31

---

## 1. Dispatcher

**Verdict:** Skip. Direct registration.

No dispatcher file. Each hook is a standalone `.mjs` file registered directly in `.claude/settings.json`. Claude Code spawns `node hook.mjs` as a child process per invocation.

**Profile system:** No. Three people don't need minimal/standard/strict profiles. Per-hook disable via env var: `IAGO_DISABLED_HOOKS=hook-id-1,hook-id-2`. Each hook checks this on startup via shared `lib/flags.mjs`.

**Require() optimization:** No. Without a dispatcher there's nothing to load in-process — each hook IS its own process. The 50-100ms overhead per hook is acceptable given the <2s sync budget. ESM (`.mjs`) would require async `await import()` anyway, complicating the flow.

**Pattern:** GSD-style — each hook self-contained, registered individually. No indirection.

**Files:** 0 dispatcher files. Shared `lib/stdin.mjs` (~20 lines) for stdin JSON parsing. Shared `lib/flags.mjs` (~15 lines) for per-hook disable.

---

## 2. Context Persistence

**Verdict:** ECC's session trio event model + Ruflo's data quality (real token counts from transcript JSONL). No Autopilot.

**File:** `context-persistence.mjs` (~280 lines) — single file, CLI arg dispatch for three events.

**Hook events:**

| Event | What it does | Timeout |
|-------|-------------|---------|
| `SessionStart` | Load most recent session snapshot + HANDOFF.json if present. Inject context via `hookSpecificOutput`. Delete HANDOFF.json after load. Prune sessions older than 10th most recent. | 5s |
| `PreCompact` | Read transcript JSONL, extract key state (files, decisions, task, tools, tokens). Write session snapshot to `.iago/state/sessions/{id}.json`. Output plain-text compact instructions via `hookSpecificOutput`. | 15s |
| `Stop` | Finalize session — write `end_time`, `outcome: "completed"`, total token counts. Append utilization entry to `.iago/state/costs.jsonl` (Decision 5). | 10s |

**Data persisted (session snapshot):**

```json
{
  "session_id": "abc123",
  "start_time": "2026-03-31T14:00:00Z",
  "end_time": "2026-03-31T16:30:00Z",
  "outcome": "completed|paused|interrupted",
  "client": "acme",
  "project": "iago-os",
  "git_branch": "feat/auth",
  "compaction_count": 0,
  "files_modified": ["src/auth.ts", "src/login.tsx"],
  "files_read": ["src/db.ts", "package.json"],
  "tools_used": { "Edit": 12, "Read": 8, "Bash": 5 },
  "key_decisions": [
    "Chose JWT over session cookies for auth",
    "Using bcrypt for password hashing"
  ],
  "current_task": "Implement login flow with email/password",
  "total_tokens": { "input": 45000, "output": 12000 },
  "last_compaction": "2026-03-31T15:00:00Z"
}
```

**Key decisions extraction:** Scan transcript JSONL for assistant messages containing markers: "decided", "choosing", "going with", "approach:", "verdict:", "we'll use", "picked". Extract the containing sentence. Cap at 10 per session.

**Format:** JSON. One file per session. Read-modify-write across events (PreCompact writes, Stop finalizes).

**Storage:** `.iago/state/sessions/{session-id}.json` — gitignored. Keep last 10, prune on SessionStart.

**HANDOFF.json:** Created by future `/iago:pause` slash command (not auto-generated). SessionStart reads and deletes it after loading.

```json
{
  "paused_at": "2026-03-31T15:30:00Z",
  "session_id": "abc123",
  "client": "acme",
  "current_task": "Implement login flow — password validation done, need OAuth next",
  "completed_steps": ["Email/password registration endpoint", "Login endpoint with JWT"],
  "remaining_steps": ["OAuth Google provider", "Refresh token rotation"],
  "blockers": [],
  "key_decisions": ["JWT over session cookies", "bcrypt for hashing"],
  "uncommitted_files": ["src/auth.ts", "src/routes/login.ts"],
  "next_action": "Implement Google OAuth — start with passport-google-oauth20 setup"
}
```

**Recovery flows:**

- **After compaction:** PreCompact already ran — snapshot saved, compact instructions injected via `hookSpecificOutput`. Claude's compacted summary includes our context. No post-compaction hook fires.
- **After restart (`/clear` or new terminal):** SessionStart loads most recent snapshot from `.iago/state/sessions/`. If HANDOFF.json exists, loads that instead (more structured). Injects via `hookSpecificOutput`.
- **After crash (kill -9, power loss):** Stop never ran — snapshot has no `end_time`. SessionStart detects `outcome` missing = interrupted session. Loads last PreCompact snapshot. User gets: "Previous session ended unexpectedly. Last known state: ..."

### Data Flow Diagram

```
SESSION START
    │
    ▼
┌─────────────────────────────────────┐
│ context-persistence.mjs session-start│
│  ├─ Read HANDOFF.json? ─── yes ──► inject + delete
│  └─ Read latest session snapshot ──► inject via hookSpecificOutput
└─────────────────────────────────────┘
    │
    ▼
WORK CYCLE (repeats)
    │
    ├──► UserPromptSubmit
    │       │
    │       ▼
    │    statusline.mjs
    │       │
    │       ▼
    │    Read transcript JSONL ──► compute context %
    │       │
    │       ▼
    │    Write .iago/state/bridge-ctx.json
    │       │
    │       ▼
    │    Output statusline: branch | ctx% | client | duration
    │
    ├──► PreToolUse (Bash)
    │       ├─ safety-guard.mjs ──► destructive command check
    │       └─ commit-quality.mjs ──► git commit? ──► prefix + secrets + console.log
    │
    ├──► PreToolUse (Edit/Write/MultiEdit)
    │       ├─ config-protection.mjs ──► protected file check
    │       └─ safety-guard.mjs ──► secret detection + injection detection
    │
    ├──► PostToolUse (all tools)
    │       │
    │       ▼
    │    context-monitor.mjs
    │       │
    │       ▼
    │    Read bridge-ctx.json
    │       │
    │       ├─ < 80% ──► silent
    │       ├─ >= 80% ──► WARNING (debounce: 5 tool uses)
    │       └─ >= 90% ──► CRITICAL (every time, suggest /iago:pause)
    │
    └──► PostToolUse (Edit)
            ├─ post-edit-format.mjs ──► npx biome check --write
            ├─ post-edit-typecheck.mjs ──► tsc --noEmit (filtered to edited file)
            └─ post-edit-console-warn.mjs ──► console.* detection
    │
    ▼
COMPACTION (auto or manual /compact)
    │
    ▼
┌──────────────────────────────────────┐
│ context-persistence.mjs pre-compact   │
│  ├─ Read transcript JSONL             │
│  ├─ Extract: files, decisions, task   │
│  ├─ Write .iago/state/sessions/{id}   │
│  └─ Output compact instructions:      │
│     "## Session Context (iaGO)        │
│      Client: acme                     │
│      Task: Implement login flow       │
│      Branch: feat/auth                │
│      Files modified: ...              │
│      Key decisions: ..."              │
└──────────────────────────────────────┘
    │
    ▼
WORK CYCLE CONTINUES (post-compaction)
    │
    ▼
SESSION END
    │
    ▼
┌──────────────────────────────────────┐
│ context-persistence.mjs stop          │
│  ├─ Read transcript JSONL             │
│  ├─ Update snapshot: end_time,        │
│  │   outcome, total_tokens            │
│  └─ Append to costs.jsonl:            │
│     { session_id, client, tokens,     │
│       duration, operator, model, ... }│
└──────────────────────────────────────┘
```

---

## 3. Post-Edit Pipeline

| # | Hook File | Event | Matcher | Source Repo | Source File | Lines Est. | Sync/Async | New/Adapted/As-Is |
|---|-----------|-------|---------|-------------|-------------|------------|------------|-------------------|
| 1 | `post-edit-format.mjs` | PostToolUse | `Edit` | ECC | `scripts/hooks/post-edit-format.js` | ~50 | sync <2s | Adapted — hardcode Biome, drop Prettier/gofmt/ruff, drop resolve-formatter.js |
| 2 | `post-edit-typecheck.mjs` | PostToolUse | `Edit` | ECC | `scripts/hooks/post-edit-typecheck.js` | ~80 | sync <2s | Adapted — ESM conversion, tsconfig.json walk-up caching |
| 3 | `post-edit-console-warn.mjs` | PostToolUse | `Edit` | ECC | `scripts/hooks/post-edit-console-warn.js` | ~45 | sync <2s | As-is (ESM converted) |
| 4 | `config-protection.mjs` | PreToolUse | `Edit\|Write\|MultiEdit` | ECC | `scripts/hooks/config-protection.js` | ~100 | sync <2s | Adapted — expanded denylist for React 19/Vite/Biome/Tailwind stack |

**Execution order (PostToolUse Edit):** format → typecheck → console-warn. Format runs first so typecheck validates the formatted result. Console-warn is lightweight, runs last.

**Format adaptations:** Hardcoded Biome via `npx biome check --write`. File extensions: `.js`, `.jsx`, `.ts`, `.tsx`, `.json`. Windows `.cmd` binary handling preserved. Shell metachar guard on file paths preserved.

**Typecheck adaptations:** `tsc --noEmit` filtered to edited file only. Matcher `Edit` only (not `Write` — new files don't compile yet). tsconfig.json location cached per session in temp file.

**Config protection denylist:** `biome.json`, `biome.jsonc`, `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `prettier.config.*`, `tsconfig.json`, `tsconfig.*.json`, `vite.config.*`, `tailwind.config.*`, `postcss.config.*`, `.env`, `.env.*`, `.gitignore`, `Dockerfile`, `docker-compose.*`, `*.lock`. package.json: partial protection (block `scripts`/`engines`/`overrides`, allow `dependencies`/`devDependencies`).

---

## 4. Safety Guard

### Destructive Commands

**Hook:** `safety-guard.mjs` — PreToolUse, matcher: `Bash`

| # | Pattern (regex) | Catches | Allowlist | Exit |
|---|----------------|---------|-----------|------|
| 1 | `rm\s+-[a-zA-Z]*r[a-zA-Z]*f\b.*(?:\/\s*$\|\/\*\|\.\.\/)` | rm -rf /, /*, ../ | rm -rf node_modules/dist/.next/build/coverage/.iago/state | 2 |
| 2 | `rm\s+-[a-zA-Z]*r[a-zA-Z]*f\b.*\s+\/(?:usr\|etc\|home\|var\|tmp\|boot\|sys\|proc\|Windows\|Users\|Program)` | rm -rf system dirs | None | 2 |
| 3 | `git\s+push\s+.*--force(?!-with-lease)(?:\s\|$)` | git push --force (not --force-with-lease) | None | 2 |
| 4 | `git\s+push\s+.*(?:origin\|upstream)\s+(?:main\|master)\s*.*--force` | Force push to main/master | None (even with --force-with-lease) | 2 |
| 5 | `git\s+(?:reset\s+--hard\|clean\s+-[a-zA-Z]*f[a-zA-Z]*d)` | git reset --hard, git clean -fd | None | 2 |
| 6 | `(?:DROP\|TRUNCATE)\s+(?:TABLE\|DATABASE\|SCHEMA)` (case-insensitive) | SQL destructive ops | Allow when command contains "migration"/"migrate" | 2 |
| 7 | `(?:mkfs\|format\|fdisk\|dd\s+if=)` | Disk format/write | None | 2 |
| 8 | `chmod\s+(?:777\|a\+rwx)` | World-writable permissions | None | 2 |
| 9 | `>\s*\/dev\/sd[a-z]` | Direct block device writes | None | 2 |
| 10 | `curl\s+.*\|\s*(?:ba)?sh` | Pipe-to-shell | None | 2 |
| 11 | `(?:shutdown\|reboot\|halt\|init\s+[06])\b` | System power commands | None | 2 |
| 12 | `npm\s+publish(?:\s\|$)` | Package publishing | None | 0 (warn) |
| 13 | `git\s+branch\s+-[dD]\s+(?:main\|master)` | Delete main/master branch | None | 2 |

### Secret Detection

**Hook:** `safety-guard.mjs` (on Edit/Write/MultiEdit) + `commit-quality.mjs` (on git commit staged diff)

| # | Pattern (regex) | Catches | Applied Where |
|---|----------------|---------|---------------|
| 1 | `AKIA[0-9A-Z]{16}` | AWS Access Key IDs | writes + commits |
| 2 | `(?:aws_secret_access_key\|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*\S{20,}` | AWS Secret Keys | writes + commits |
| 3 | `ghp_[A-Za-z0-9]{36}` | GitHub PATs | writes + commits |
| 4 | `gho_[A-Za-z0-9]{36}` | GitHub OAuth Tokens | writes + commits |
| 5 | `ghs_[A-Za-z0-9]{36}` | GitHub Server Tokens | writes + commits |
| 6 | `github_pat_[A-Za-z0-9_]{82}` | GitHub Fine-grained PATs | writes + commits |
| 7 | `sk-ant-[A-Za-z0-9-]{80,}` | Anthropic API Keys | writes + commits |
| 8 | `sk-[A-Za-z0-9]{48,}` | OpenAI API Keys | writes + commits |
| 9 | `sk_(?:live\|test)_[A-Za-z0-9]{24,}` | Stripe Secret Keys | writes + commits |
| 10 | `pk_(?:live\|test)_[A-Za-z0-9]{24,}` | Stripe Publishable Keys (live=block, test=skip) | writes + commits |
| 11 | `xox[bpoas]-[A-Za-z0-9-]{10,}` | Slack Tokens | writes + commits |
| 12 | `-----BEGIN\s+(?:RSA\|EC\|DSA\|OPENSSH)?\s*PRIVATE\s+KEY-----` | Private Keys | writes + commits |
| 13 | `(?:password\|passwd\|pwd)\s*[=:]\s*['"][^'"]{8,}['"]` | Hardcoded passwords | writes only |
| 14 | `(?:secret\|token\|api_key\|apikey\|auth_token)\s*[=:]\s*['"][A-Za-z0-9+/=_-]{16,}['"]` | Generic secrets | writes only |
| 15 | `(?:mongodb(?:\+srv)?:\/\/)[^\s'"]+:[^\s'"]+@` | MongoDB conn strings | writes + commits |
| 16 | `(?:postgres(?:ql)?:\/\/)[^\s'"]+:[^\s'"]+@` | PostgreSQL conn strings | writes + commits |
| 17 | `(?:mysql:\/\/)[^\s'"]+:[^\s'"]+@` | MySQL conn strings | writes + commits |

**Exemptions:** Test files (`*.test.ts`, `*.spec.ts`, `__tests__/`), `.env.example`/`.env.template`, comment lines (`//`, `#`, `*`), `pk_test_` Stripe keys.

### Injection Detection

**Hook:** `safety-guard.mjs` — PreToolUse, matcher: `Edit|Write|MultiEdit`

| # | Pattern (regex) | Catches | False Positive Mitigation |
|---|----------------|---------|--------------------------|
| 1 | `\.\.[\/\\]` in `tool_input.file_path` | Path traversal in target path | Only checked on path, not content |
| 2 | `<system>`, `<\|im_start\|>`, `[INST]`, `<\|system\|>` in `.md`/`.txt`/`.yaml`/`.yml`/`.json` content | Prompt injection markers | Only config/doc files, not source code |
| 3 | `(?:ignore\|disregard\|forget)\s+(?:all\s+)?(?:previous\|prior\|above)\s+instructions` (case-insensitive) | Classic injection phrasing | Only non-source files |
| 4 | Base64 payload >500 chars in `.md`/`.yaml`/`.json` | Encoded payloads in config | Only config/doc files. 500-char minimum. |

### Commit Quality

**Hook:** `commit-quality.mjs` — PreToolUse, matcher: `Bash` (activates only on `git commit` commands)

| Check | Rule | Message |
|-------|------|---------|
| Conventional prefix | `/^(feat\|fix\|refactor\|docs\|chore\|research\|build\|test\|ci\|perf\|style\|revert)(\(.+\))?!?:\s/` | "iaGO: Commit message must start with a conventional prefix (feat, fix, refactor, docs, chore, research, build, test, ci, perf, style, revert)" |
| Subject length | Max 72 characters (first line) | "iaGO: Commit subject exceeds 72 characters ({actual} chars)" |
| Non-empty description | Content must exist after prefix | "iaGO: Commit message has no description after the prefix" |
| No WIP on main | Block `wip:`/`WIP:` on main/master | "iaGO: WIP commits not allowed on main/master" |
| Secret scan | Patterns #1-#17 against `git diff --cached` | "iaGO: Possible secret in staged changes — {pattern} on line {n}" |
| Console.log scan | `console.log` in staged JS/TS diff | "iaGO: console.log found in staged changes" — WARNING only (exit 0) |

**Commit message extraction:** Parse `-m "message"`, `-m 'message'`, and heredoc `$(cat <<'EOF'...)` patterns. Skip validation if no `-m` flag (interactive commit).

---

## 5. Cost Tracking

**Verdict:** Per-session utilization logging. Not per-token dollar costs (Claude Max is flat-rate).

**Storage:** `.iago/state/costs.jsonl` — per-project, gitignored. Append-only JSONL.

**Hook:** Integrated into the Stop code path of `context-persistence.mjs`. No separate hook file. ~15 lines.

**Fields:**

```json
{
  "timestamp": "2026-03-31T16:30:00Z",
  "session_id": "abc123",
  "client": "acme",
  "project": "iago-os",
  "model": "claude-sonnet-4-6",
  "input_tokens": 45000,
  "output_tokens": 12000,
  "cache_read_tokens": 8000,
  "cache_creation_tokens": 3000,
  "session_duration_ms": 9000000,
  "compaction_count": 1,
  "git_branch": "feat/auth",
  "tools_used": { "Edit": 12, "Read": 8, "Bash": 5 },
  "files_modified_count": 4,
  "operator": "santiago"
}
```

**Client tagging:** Read from `.iago/state/active-client.json` (`{ "client": "acme", "project": "widget-redesign" }`). Set manually or via future `/iago:client` command. Defaults to `"internal"` if missing.

**Operator:** Read from `$USER` (Unix) / `$USERNAME` (Windows) env var.

**Token source:** Transcript JSONL `usage` field via `lib/transcript.mjs`.

---

## 6. Compaction Strategy

**Verdict:** Token-percentage only. No tool-call counter.

**Mechanism:** Statusline computes context % from transcript JSONL → writes `bridge-ctx.json` → context monitor reads bridge file on PostToolUse → injects warnings. PreCompact hook saves session state when compaction fires.

**Thresholds:**

| Context used | Level | Action |
|-------------|-------|--------|
| < 65% | Normal | Green statusline indicator |
| >= 65% | Advisory | Yellow statusline indicator. No injection. |
| >= 80% | WARNING | Inject: "Context limited — finish current task, then compact or pause." Debounce: 5 tool uses. |
| >= 90% | CRITICAL | Inject: "Context nearly exhausted. Run /compact now." No debounce. Suggest `/iago:pause`. |

**Preserved on compaction:** Session snapshot (files, decisions, task, tools, tokens, branch, client) + compact instructions injected via `hookSpecificOutput` as plain text.

**Discarded on compaction:** Full conversation turns (Claude summarizes), intermediate file reads (re-readable), tool output details, earlier session snapshots.

**Debounce state:** Tracked in `bridge-ctx.json` via `last_warning_tool_count` field.

---

## 7. Hook File Location

**Verdict:** `.iago/hooks/`

All hook `.mjs` files live in `.iago/hooks/`. Shared utilities in `.iago/hooks/lib/`. Claude Code's `.claude/settings.json` references them via `$CLAUDE_PROJECT_DIR/.iago/hooks/`.

**Git status:** Tracked. Hooks are code — reviewed, versioned, shared.

**settings.json path pattern:**
```json
"command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" pre-compact"
```

**Runtime state:** `.iago/state/` — ALL gitignored. Sessions, bridge file, costs, active client, HANDOFF.json.

**Directory structure:**
```
.iago/
  hooks/                  # git tracked
    lib/
      stdin.mjs
      flags.mjs
      transcript.mjs
    statusline.mjs
    context-persistence.mjs
    context-monitor.mjs
    post-edit-format.mjs
    post-edit-typecheck.mjs
    post-edit-console-warn.mjs
    config-protection.mjs
    safety-guard.mjs
    commit-quality.mjs
  state/                  # gitignored
    sessions/
    bridge-ctx.json
    active-client.json
    costs.jsonl
    HANDOFF.json
  research/               # git tracked
```

---

## 8. Statusline

**Verdict:** Adopt. Hybrid of Ruflo display + GSD bridge-file architecture.

**Fields (4):**

| # | Field | Source | Rendering |
|---|-------|--------|-----------|
| 1 | Git branch | `git branch --show-current` | Branch name |
| 2 | Context % | Transcript JSONL token usage | `42%` — green <65, yellow 65-79, red >=80 |
| 3 | Client slug | `.iago/state/active-client.json` | `acme` or empty |
| 4 | Session duration | `Date.now() - sessionStartTime` | `1h23m` |

**Bridge file:** `.iago/state/bridge-ctx.json` — written every statusline render, read by context-monitor.mjs.

```json
{
  "session_id": "abc123",
  "context_pct": 42,
  "client": "acme",
  "git_branch": "feat/auth",
  "timestamp": 1711843200,
  "estimated_turns_remaining": 28,
  "last_warning_tool_count": 0
}
```

**File:** `statusline.mjs` (~80-100 lines)

---

## 9. Complete Hook File Manifest

Ordered by build dependency — utilities first, then hooks that depend on them.

| # | File | Event(s) | Matcher | Source Repo | Source File | Lines Est. | Sync/Async | New/Adapted/As-Is |
|---|------|----------|---------|-------------|-------------|------------|------------|-------------------|
| 1 | `lib/stdin.mjs` | — (utility) | — | ECC | `scripts/lib/utils.js` (partial) | ~20 | — | New (inspired by ECC utils) |
| 2 | `lib/flags.mjs` | — (utility) | — | ECC | `scripts/lib/hook-flags.js` | ~15 | — | Adapted — strip profiles, keep env-var disable |
| 3 | `lib/transcript.mjs` | — (utility) | — | Ruflo | `.claude/helpers/context-persistence-hook.mjs` (partial) | ~80 | — | New (extracted from Ruflo's transcript parsing) |
| 4 | `statusline.mjs` | Statusline | — | Ruflo + GSD | `.claude/helpers/statusline.cjs` + `hooks/gsd-statusline-hook.js` | ~90 | sync <2s | Adapted — 4 fields, bridge file output |
| 5 | `context-persistence.mjs` | SessionStart, PreCompact, Stop | — | ECC + Ruflo + GSD | `scripts/hooks/session-{start,end}.js` + `pre-compact.js` + Ruflo transcript parsing + GSD HANDOFF | ~280 | async 5-15s | Adapted — hybrid of three approaches |
| 6 | `context-monitor.mjs` | PostToolUse | — (all tools) | GSD | `hooks/gsd-context-monitor.js` | ~60 | sync <2s | Adapted — reads bridge file, threshold warnings |
| 7 | `post-edit-format.mjs` | PostToolUse | `Edit` | ECC | `scripts/hooks/post-edit-format.js` | ~50 | sync <2s | Adapted — hardcode Biome |
| 8 | `post-edit-typecheck.mjs` | PostToolUse | `Edit` | ECC | `scripts/hooks/post-edit-typecheck.js` | ~80 | sync <2s | Adapted — ESM, tsconfig caching |
| 9 | `post-edit-console-warn.mjs` | PostToolUse | `Edit` | ECC | `scripts/hooks/post-edit-console-warn.js` | ~45 | sync <2s | As-is (ESM converted) |
| 10 | `config-protection.mjs` | PreToolUse | `Edit\|Write\|MultiEdit` | ECC | `scripts/hooks/config-protection.js` | ~100 | sync <2s | Adapted — expanded denylist |
| 11 | `safety-guard.mjs` | PreToolUse | `Bash\|Edit\|Write\|MultiEdit` | ECC + GSD | `scripts/hooks/pre-bash-commit-quality.js` + `hooks/gsd-prompt-guard.js` | ~180 | sync <2s | New — hybrid: ECC secrets + GSD injection + new destructive blocklist |
| 12 | `commit-quality.mjs` | PreToolUse | `Bash` | ECC | `scripts/hooks/pre-bash-commit-quality.js` | ~120 | sync <2s | Adapted — conventional commit validation + staged secret scan |

---

## 10. settings.json Hook Configuration

Copy-pasteable. All paths use `$CLAUDE_PROJECT_DIR` and forward slashes.

```json
{
  "hooks": {
    "Statusline": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/statusline.mjs\"",
            "timeout": 2000
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" session-start",
            "timeout": 5000
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/safety-guard.mjs\"",
            "timeout": 2000
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/commit-quality.mjs\"",
            "timeout": 5000
          }
        ]
      },
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/config-protection.mjs\"",
            "timeout": 2000
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/safety-guard.mjs\"",
            "timeout": 2000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-monitor.mjs\"",
            "timeout": 2000
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/post-edit-format.mjs\"",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/post-edit-typecheck.mjs\"",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/post-edit-console-warn.mjs\"",
            "timeout": 2000
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" pre-compact",
            "timeout": 15000
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" stop",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

**Hook entry count by event:**
- Statusline: 1 entry
- SessionStart: 1 entry
- PreToolUse (Bash): 2 entries (safety-guard, commit-quality)
- PreToolUse (Edit/Write/MultiEdit): 2 entries (config-protection, safety-guard)
- PostToolUse (all): 1 entry (context-monitor)
- PostToolUse (Edit): 3 entries (format, typecheck, console-warn)
- PreCompact: 1 entry
- Stop: 1 entry
- **Total: 12 hook entries across 7 event types**

---

## 11. Build Order & Dependencies

```
Phase 1 — Shared utilities (no dependencies)
  1. lib/stdin.mjs
  2. lib/flags.mjs
  3. lib/transcript.mjs

Phase 2 — Standalone hooks (depend on lib/ only)
  4. statusline.mjs          ← lib/stdin.mjs, lib/transcript.mjs
  5. context-monitor.mjs     ← lib/stdin.mjs, lib/flags.mjs
  6. post-edit-format.mjs    ← lib/stdin.mjs, lib/flags.mjs
  7. post-edit-typecheck.mjs ← lib/stdin.mjs, lib/flags.mjs
  8. post-edit-console-warn.mjs ← lib/stdin.mjs, lib/flags.mjs
  9. config-protection.mjs   ← lib/stdin.mjs, lib/flags.mjs
  10. safety-guard.mjs       ← lib/stdin.mjs, lib/flags.mjs
  11. commit-quality.mjs     ← lib/stdin.mjs, lib/flags.mjs

Phase 3 — Complex hooks (depend on lib/ + read/write state)
  12. context-persistence.mjs ← lib/stdin.mjs, lib/flags.mjs, lib/transcript.mjs
                                 reads: .iago/state/sessions/, HANDOFF.json, active-client.json
                                 writes: .iago/state/sessions/, costs.jsonl
```

**Critical path:** `lib/transcript.mjs` must be rock-solid — it's depended on by `statusline.mjs` (fires every render cycle) and `context-persistence.mjs` (fires at session boundaries). A bug here cascades.

**Parallel build groups:**
- Group A (Phase 1): All three lib files can be built simultaneously
- Group B (Phase 2): All 8 standalone hooks can be built simultaneously after Phase 1
- Group C (Phase 3): context-persistence.mjs after all lib files

---

## 12. Shared Utilities

| # | File | Purpose | Depended On By | Source | Lines Est. |
|---|------|---------|---------------|--------|------------|
| 1 | `lib/stdin.mjs` | Parse stdin JSON from Claude Code hook input. Read up to 1MB. Handle truncation. Export `readInput()`. | All 9 hooks | ECC `scripts/lib/utils.js` (partial) | ~20 |
| 2 | `lib/flags.mjs` | Check `IAGO_DISABLED_HOOKS` env var. Export `isDisabled(hookId)`. | All 9 hooks | ECC `scripts/lib/hook-flags.js` (stripped) | ~15 |
| 3 | `lib/transcript.mjs` | Read Claude Code transcript JSONL. Extract token usage from `usage` field. Parse conversation turns. Export `readTranscript(path)`, `getTokenUsage(path)`, `extractDecisions(path)`, `getFilesModified(path)`. | statusline.mjs, context-persistence.mjs | Ruflo `.claude/helpers/context-persistence-hook.mjs` (extracted) | ~80 |

---

## 13. Estimated Totals

- **Total hook files:** 9
- **Total utility files:** 3
- **Total files:** 12
- **Total estimated lines:** ~1,120
  - Utilities: ~115 (stdin 20 + flags 15 + transcript 80)
  - Hooks: ~1,005 (statusline 90 + persistence 280 + monitor 60 + format 50 + typecheck 80 + console-warn 45 + config-protection 100 + safety-guard 180 + commit-quality 120)
- **Total settings.json hook entries:** 12 entries across 7 event types
- **Runtime state files:** 5 (sessions dir, bridge-ctx.json, active-client.json, costs.jsonl, HANDOFF.json)
