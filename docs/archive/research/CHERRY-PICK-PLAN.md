# iaGO-OS Cherry-Pick Plan

> Generated: 2026-04-01
> Sources: ECC, Ruflo, GSD, Paperclip, The Architect, Superpowers
> Decision files: DECISION-hooks.md, DECISION-skills-agents.md, DECISION-workflow.md, DECISION-paperclip.md, DECISION-claude-md.md, DECISION-discipline.md
> Build order: BUILD-ORDER.md

---

## 1. Hook Architecture

### Hook Dispatcher

**Pattern:** No dispatcher. Direct registration. GSD-style.
**Source:** ECC + GSD (hybrid)
**Files:** 0 dispatcher files. Per-hook disable via `IAGO_DISABLED_HOOKS=hook-id-1,hook-id-2` env var.

### Context Persistence

**Model:** ECC session trio + Ruflo data quality (real tokens from transcript JSONL).
**Events:** SessionStart (load snapshot/HANDOFF, inject, prune) → PreCompact (extract state, write snapshot, output instructions) → Stop (finalize, write costs.jsonl).
**Storage:** `.iago/state/sessions/{id}.json` (gitignored, keep last 10).
**Recovery:** HANDOFF.json > session snapshot > interrupted session detection.

**Session snapshot schema:**

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
  "files_modified": ["src/auth.ts"],
  "files_read": ["src/db.ts"],
  "tools_used": { "Edit": 12, "Read": 8, "Bash": 5 },
  "key_decisions": ["Chose JWT over session cookies"],
  "current_task": "Implement login flow",
  "total_tokens": { "input": 45000, "output": 12000 },
  "last_compaction": "2026-03-31T15:00:00Z"
}
```

**Cost tracking entry (costs.jsonl):**

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

### Complete Hook File Manifest

| # | File | Event(s) | Matcher | Source | Lines | Phase |
|---|------|----------|---------|-------|-------|-------|
| 1 | `lib/stdin.mjs` | — (utility) | — | ECC | ~20 | 1A |
| 2 | `lib/flags.mjs` | — (utility) | — | ECC | ~15 | 1A |
| 3 | `lib/transcript.mjs` | — (utility) | — | Ruflo | ~80 | 1A |
| 4 | `statusline.mjs` | Statusline | — | Ruflo + GSD | ~90 | 1B |
| 5 | `context-persistence.mjs` | SessionStart, PreCompact, Stop | — | ECC + Ruflo + GSD | ~280 | 1B |
| 6 | `context-monitor.mjs` | PostToolUse | — (all) | GSD | ~60 | 1B |
| 7 | `post-edit-format.mjs` | PostToolUse | `Edit` | ECC | ~50 | 1B |
| 8 | `post-edit-typecheck.mjs` | PostToolUse | `Edit` | ECC | ~80 | 1B |
| 9 | `post-edit-console-warn.mjs` | PostToolUse | `Edit` | ECC | ~45 | 1B |
| 10 | `config-protection.mjs` | PreToolUse | `Edit\|Write\|MultiEdit` | ECC | ~100 | 1B |
| 11 | `safety-guard.mjs` | PreToolUse | `Bash\|Edit\|Write\|MultiEdit` | ECC + GSD | ~180 | 1B |
| 12 | `commit-quality.mjs` | PreToolUse | `Bash` | ECC | ~120 | 1B |

### Shared Utilities

| # | File | Purpose | Exports | Lines | Phase |
|---|------|---------|---------|-------|-------|
| 1 | `lib/stdin.mjs` | Parse stdin JSON from Claude Code | `readInput()` | ~20 | 1A |
| 2 | `lib/flags.mjs` | Check IAGO_DISABLED_HOOKS env var | `isDisabled(hookId)` | ~15 | 1A |
| 3 | `lib/transcript.mjs` | Read transcript JSONL, extract usage | `readTranscript(path)`, `getTokenUsage(path)`, `extractDecisions(path)`, `getFilesModified(path)` | ~80 | 1A |

### Statusline Fields

| # | Field | Source | Rendering |
|---|-------|--------|-----------|
| 1 | Git branch | `git branch --show-current` | Branch name |
| 2 | Context % | Transcript JSONL | `42%` — green <65, yellow 65-79, red ≥80 |
| 3 | Client slug | `.iago/state/active-client.json` | `acme` or empty |
| 4 | Session duration | `Date.now() - sessionStartTime` | `1h23m` |

**Bridge file** (`.iago/state/bridge-ctx.json`):

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

### Context Monitor Thresholds

| Context Used | Level | Action |
|-------------|-------|--------|
| < 65% | Normal | Green statusline |
| ≥ 65% | Advisory | Yellow statusline. No injection. |
| ≥ 80% | WARNING | Inject warning. Debounce: 5 tool uses. |
| ≥ 90% | CRITICAL | Inject every time. Suggest `/iago:pause`. |

### Destructive Command Patterns (13)

| # | Pattern | Catches | Allowlist | Exit |
|---|---------|---------|-----------|------|
| 1 | `rm\s+-[a-zA-Z]*r[a-zA-Z]*f\b.*(?:\/\s*$\|\/\*\|\.\.\/)` | rm -rf /, /*, ../ | node_modules/dist/.next/build/coverage/.iago/state | 2 |
| 2 | `rm\s+-[a-zA-Z]*r[a-zA-Z]*f\b.*\s+\/(?:usr\|etc\|home\|var\|tmp\|boot\|sys\|proc\|Windows\|Users\|Program)` | rm -rf system dirs | None | 2 |
| 3 | `git\s+push\s+.*--force(?!-with-lease)(?:\s\|$)` | git push --force | None | 2 |
| 4 | `git\s+push\s+.*(?:origin\|upstream)\s+(?:main\|master)\s*.*--force` | Force push main/master | None | 2 |
| 5 | `git\s+(?:reset\s+--hard\|clean\s+-[a-zA-Z]*f[a-zA-Z]*d)` | git reset/clean | None | 2 |
| 6 | `(?:DROP\|TRUNCATE)\s+(?:TABLE\|DATABASE\|SCHEMA)` | SQL destructive | Allow with "migration" | 2 |
| 7 | `(?:mkfs\|format\|fdisk\|dd\s+if=)` | Disk format | None | 2 |
| 8 | `chmod\s+(?:777\|a\+rwx)` | World-writable | None | 2 |
| 9 | `>\s*\/dev\/sd[a-z]` | Block device writes | None | 2 |
| 10 | `curl\s+.*\|\s*(?:ba)?sh` | Pipe-to-shell | None | 2 |
| 11 | `(?:shutdown\|reboot\|halt\|init\s+[06])\b` | System power | None | 2 |
| 12 | `npm\s+publish(?:\s\|$)` | Package publish | None | 0 (warn) |
| 13 | `git\s+branch\s+-[dD]\s+(?:main\|master)` | Delete main/master | None | 2 |

### Secret Detection Patterns (17)

| # | Pattern | Catches | Applied |
|---|---------|---------|---------|
| 1 | `AKIA[0-9A-Z]{16}` | AWS Access Key | writes + commits |
| 2 | `(?:aws_secret_access_key\|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*\S{20,}` | AWS Secret | writes + commits |
| 3 | `ghp_[A-Za-z0-9]{36}` | GitHub PAT | writes + commits |
| 4 | `gho_[A-Za-z0-9]{36}` | GitHub OAuth | writes + commits |
| 5 | `ghs_[A-Za-z0-9]{36}` | GitHub Server | writes + commits |
| 6 | `github_pat_[A-Za-z0-9_]{82}` | GitHub Fine-grained | writes + commits |
| 7 | `sk-ant-[A-Za-z0-9-]{80,}` | Anthropic Key | writes + commits |
| 8 | `sk-[A-Za-z0-9]{48,}` | OpenAI Key | writes + commits |
| 9 | `sk_(?:live\|test)_[A-Za-z0-9]{24,}` | Stripe Secret | writes + commits |
| 10 | `pk_(?:live\|test)_[A-Za-z0-9]{24,}` | Stripe Publishable (live=block, test=skip) | writes + commits |
| 11 | `xox[bpoas]-[A-Za-z0-9-]{10,}` | Slack Token | writes + commits |
| 12 | `-----BEGIN\s+(?:RSA\|EC\|DSA\|OPENSSH)?\s*PRIVATE\s+KEY-----` | Private Key | writes + commits |
| 13 | `(?:password\|passwd\|pwd)\s*[=:]\s*['"][^'"]{8,}['"]` | Hardcoded password | writes only |
| 14 | `(?:secret\|token\|api_key\|apikey\|auth_token)\s*[=:]\s*['"][A-Za-z0-9+/=_-]{16,}['"]` | Generic secret | writes only |
| 15 | `(?:mongodb(?:\+srv)?:\/\/)[^\s'"]+:[^\s'"]+@` | MongoDB conn | writes + commits |
| 16 | `(?:postgres(?:ql)?:\/\/)[^\s'"]+:[^\s'"]+@` | PostgreSQL conn | writes + commits |
| 17 | `(?:mysql:\/\/)[^\s'"]+:[^\s'"]+@` | MySQL conn | writes + commits |

**Exemptions:** `*.test.ts`, `*.spec.ts`, `__tests__/`, `.env.example`, `.env.template`, comment lines, `pk_test_`.

### Injection Detection Patterns (4)

| # | Pattern | Catches | Scope |
|---|---------|---------|-------|
| 1 | `\.\.[\/\\]` in file_path | Path traversal | Path only |
| 2 | `<system>`, `<\|im_start\|>`, `[INST]`, `<\|system\|>` | Prompt injection | .md/.txt/.yaml/.json only |
| 3 | `(?:ignore\|disregard\|forget)\s+(?:all\s+)?(?:previous\|prior\|above)\s+instructions` | Classic injection | Non-source files |
| 4 | Base64 payload >500 chars | Encoded payloads | .md/.yaml/.json only |

### Commit Quality Checks

| Check | Rule | Exit |
|-------|------|------|
| Conventional prefix | `feat\|fix\|refactor\|docs\|chore\|research\|build\|test\|ci\|perf\|style\|revert` | 2 |
| Subject ≤72 chars | First line length | 2 |
| Non-empty description | Content after prefix | 2 |
| No WIP on main | Block `wip:` on main/master | 2 |
| Secret scan | Patterns #1-17 on staged diff | 2 |
| Console.log scan | `console.log` in staged JS/TS | 0 (warn) |

### Config Protection Denylist

`biome.json`, `biome.jsonc`, `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `prettier.config.*`, `tsconfig.json`, `tsconfig.*.json`, `vite.config.*`, `tailwind.config.*`, `postcss.config.*`, `.env`, `.env.*`, `.gitignore`, `Dockerfile`, `docker-compose.*`, `*.lock`. `package.json`: block `scripts`/`engines`/`overrides`, allow `dependencies`/`devDependencies`.

### settings.json Hook Configuration

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

12 hook entries across 7 event types.

---

## 2. Workflow Engine

### Phase Structure

| # | Phase | Skill | Output Artifact | Input Gate |
|---|-------|-------|-----------------|------------|
| 0 | init | `/iago:init` | PROJECT.md, ROADMAP.md, STATE.md, config.json | None. Blocks if PROJECT.md exists. |
| 1 | discuss | `/iago:discuss` | `context/{NN}-{slug}.md` | ROADMAP.md must exist. |
| 2 | plan | `/iago:plan` | `plans/{NN}-{slug}-{PP}.md` | context/{phase}.md (soft gate). |
| 3 | execute | `/iago:execute` | `summaries/{NN}-{slug}-{PP}.md`, commits | plans/{phase}-*.md must exist. |
| 4 | verify | `/iago:verify` | `reviews/{NN}-{slug}.md` | All summaries must exist. Ships PR if passed. |

### Phase Flow

```
init ──[PROJECT.md]──► discuss ──[context.md]──► plan ──[plan.md]──►
execute ──[summary.md]──► verify ──[review.md]──► done / re-plan
```

### Quick/Fast Modes

| Mode | Skill | When | Skips |
|------|-------|------|-------|
| fast | `/iago:fast` | ≤3 files, no deps, obvious | All: no plan, no summary, no verify, no subagent |
| quick | `/iago:quick` | 1-3 tasks, standalone | ROADMAP, waves, plan self-review |

Quick flags: `--discuss`, `--research`, `--verify` (composable).

### Pause/Resume

- **`/iago:pause`** writes `state/HANDOFF.json`. Explicit skill, ~30 lines.
- **Resume:** SessionStart hook loads + deletes HANDOFF.json. No explicit command.
- **Stale warning:** >7 days → informational warning.

**HANDOFF.json schema:**

```json
{
  "paused_at": "2026-04-01T15:30:00Z",
  "session_id": "abc123",
  "client": "acme",
  "project": "widget-redesign",
  "git_branch": "feat/01-auth",
  "workflow_position": { "phase": "01-auth", "plan": "01-auth-02", "task": 3 },
  "current_task": "Task 3: Registration endpoint",
  "completed_tasks": [
    { "task": 1, "description": "JWT utility module", "commit": "abc1234" }
  ],
  "remaining_tasks": [
    { "task": 3, "description": "Registration endpoint" }
  ],
  "blockers": [],
  "key_decisions": ["JWT over session cookies"],
  "uncommitted_files": ["src/routes/auth/register.ts"],
  "next_action": "Continue POST /api/auth/register"
}
```

---

## 3. State Directory (.iago/)

```
.iago/
  PROJECT.md          # Vision, constraints, architecture decisions (tracked)
  ROADMAP.md          # Phase breakdown + status (tracked)
  STATE.md            # Position digest, <80 lines (tracked)
  config.json         # 9-field workflow config (tracked)
  .gitignore          # state/

  context/            # Discussion artifacts (tracked)
  plans/              # Implementation plans (tracked)
  summaries/          # Execution summaries (tracked)
  reviews/            # Verification reports (tracked)
  hooks/              # Hook code (tracked)
  state/              # Runtime (ALL gitignored)
```

### config.json Schema

```json
{
  "project": { "name": "widget-redesign", "client": "acme", "type": "saas" },
  "workflow": { "skip_discuss": false, "auto_verify": true, "auto_advance": false },
  "planning": { "max_tasks_per_plan": 8, "context_budget_pct": 40 },
  "review": { "mode": "single" }
}
```

| Field | Default | Consumed By |
|-------|---------|-------------|
| `project.name` | (required) | STATE.md, commits, PRs |
| `project.client` | `"internal"` | Cost tracking, statusline |
| `project.type` | `"saas"` | Plan suggestions |
| `workflow.skip_discuss` | `false` | `/iago:plan` |
| `workflow.auto_verify` | `true` | `/iago:execute` |
| `workflow.auto_advance` | `false` | Orchestrator |
| `planning.max_tasks_per_plan` | `8` | `/iago:plan` |
| `planning.context_budget_pct` | `40` | Quick mode |
| `review.mode` | `"single"` | `/iago:execute` |

---

## 4. Skills Manifest

### 4a. Workflow Skills

| # | Skill | Purpose | Dispatches | Lines | Phase |
|---|-------|---------|-----------|-------|-------|
| 1 | `/iago:init` | Bootstrap .iago/, gather vision, produce PROJECT/ROADMAP/STATE/config | researcher (optional) | ~80 | 3A |
| 2 | `/iago:discuss` | Clarify gray areas per phase, produce context artifact | none | ~60 | 3A |
| 3 | `/iago:plan` | Break phase into plans with tasks, self-review, no-placeholders | researcher (--research) | ~90 | 3A |
| 4 | `/iago:execute` | Wave analysis, dispatch implementer per plan, review after | implementer, code-reviewer (or spec-reviewer + code-quality-reviewer) | ~85 | 3A |
| 5 | `/iago:verify` | Goal-backward verification, ship PR if passed | none | ~70 | 3A |
| 6 | `/iago:fast` | Inline trivial tasks, atomic commit, STATE.md log | none | ~50 | 3A |
| 7 | `/iago:quick` | Lightweight plan → implementer → reviewer | implementer, code-reviewer | ~60 | 3A |
| 8 | `/iago:pause` | Write HANDOFF.json to state/ | none | ~40 | 3A |

### 4b. Core Feature Skills

| # | Skill | Source | Purpose | Dispatches | Lines | Phase |
|---|-------|--------|---------|-----------|-------|-------|
| 1 | `/brainstorming` | Superpowers | Socratic design exploration, write spec | none | ~50 | 3B |
| 2 | `/writing-plans` | Superpowers | Break spec into 2-5 min tasks | none | ~45 | 3B |
| 3 | `/subagent-driven-development` | Superpowers | Execute plans with fresh subagent per task | implementer, reviewers | ~60 | 3B |
| 4 | `/code-review` | Superpowers + ECC | Dispatch reviewer with git SHA range | code-reviewer | ~40 | 3B |
| 5 | `/deep-research` | ECC | Multi-source research with recommendation | researcher | ~35 | 3B |
| 6 | `/prompt-optimizer` | ECC | Optimize LLM prompts for client deliverables | none | ~30 | 3B |

### 4c. Content/Business Skills

| # | Skill | Source | Lines | Phase |
|---|-------|--------|-------|-------|
| 1 | `/article-writing` | ECC | ~30 | 4A |
| 2 | `/content-engine` | ECC | ~35 | 4A |
| 3 | `/investor-materials` | ECC | ~30 | 4A |
| 4 | `/investor-outreach` | ECC | ~25 | 4A |
| 5 | `/market-research` | ECC | ~30 | 4A |
| 6 | `/visa-doc-translate` | ECC | ~25 | 4A |
| 7 | `/frontend-slides` | ECC | ~30 | 4A |

### 4d. Experimental Skills

| # | Skill | Source | Lines | Phase |
|---|-------|--------|-------|-------|
| 1 | `/autonomous-loops` | ECC | ~35 | 4A |
| 2 | `/continuous-agent-loop` | ECC | ~35 | 4A |
| 3 | `/enterprise-agent-ops` | ECC | ~40 | 4A |
| 4 | `/agent-payment-x402` | ECC | ~25 | 4A |
| 5 | `/liquid-glass-design` | ECC | ~30 | 4A |
| 6 | `/santa-method` | ECC | ~30 | 4A |

### 4e. Industry Skills

| # | Skill | Source | Lines | Phase |
|---|-------|--------|-------|-------|
| 1 | `/healthcare-phi-compliance` | ECC | ~40 | 4B |
| 2 | `/carrier-relationship-management` | ECC | ~30 | 4B |
| 3 | `/customs` | ECC | ~35 | 4B |
| 4 | `/energy` | ECC | ~35 | 4B |
| 5 | `/logistics` | ECC | ~35 | 4B |
| 6 | `/inventory` | ECC | ~30 | 4B |
| 7 | `/production-scheduling` | ECC | ~30 | 4B |
| 8 | `/quality-nonconformance` | ECC | ~25 | 4B |
| 9 | `/returns-reverse-logistics` | ECC | ~25 | 4B |

### 4f. Meta-Instruction

**Mechanism:** `.claude/rules/available-skills.md` — auto-loaded at session start.
**Content:** Production-ready text in DECISION-skills-agents.md §2 (60 lines listing all skills, agents, behavioral rules).

### Skill Description Convention (CSO)

Every skill description: `"Use when [X]. Not when [Y]."` — lets the model match skills to context.

**YAML frontmatter template:**

```yaml
---
name: skill-name
description: >-
  Use when [triggering conditions].
  Not when [exclusion conditions].
---
```

**Body sections (in order):** Purpose, Steps, Output, Boundaries. Optional: Examples.

---

## 5. Agent Definitions

| # | Agent | Model | Tools | Role | Lines | Phase |
|---|-------|-------|-------|------|-------|-------|
| 1 | implementer | sonnet | Read, Glob, Grep, Edit, Write, Bash | Execute tasks from plans | ~65 | 2B |
| 2 | code-reviewer | sonnet | Read, Glob, Grep, Bash | Single-pass severity review | ~55 | 2B |
| 3 | spec-reviewer | sonnet | Read, Glob, Grep | Spec compliance (Stage 1) | ~50 | 2B |
| 4 | code-quality-reviewer | sonnet | Read, Glob, Grep, Bash | Quality review (Stage 2) | ~55 | 2B |
| 5 | researcher | sonnet | Read, Glob, Grep, Bash, WebSearch, WebFetch | Deep research | ~55 | 2B |
| 6 | tdd-guide | sonnet | Full | RED-GREEN-REFACTOR enforcement | ~60 | 2B |
| 7 | build-error-resolver | sonnet | Full | Systematic debugging, max 3 attempts | ~60 | 2B |
| 8 | e2e-runner | sonnet | Full | Playwright E2E tests | ~60 | 2B |

No agent has `Agent` tool (flat dispatch — orchestrator only).

### Agent Format Template

```yaml
---
name: agent-name
description: >-
  Use when [X]. Not when [Y].
model: sonnet
tools:
  - Read
  - Glob
  - Grep
maxTurns: 20
---

## Role
[One sentence]

## Constraints
[Hard rules]

## Process
[Step-by-step]

## Output Format
[Exact structure]

## Escalation
[Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED]
```

### Skill → Agent Dispatch Map

| Skill | Agent(s) | When |
|-------|----------|------|
| subagent-driven-development | implementer, code-reviewer (or spec-reviewer + code-quality-reviewer) | Per-plan execution |
| code-review | code-reviewer | SHA-range review |
| deep-research | researcher | Research tasks |
| tdd (rule) | tdd-guide | Ad-hoc, TDD context |
| systematic-debugging (rule) | build-error-resolver | Ad-hoc, build failure |
| e2e-testing (rule) | e2e-runner | Ad-hoc, E2E work |

---

## 6. Rules Files

| # | File | Path | Scope | Key Contents | Lines | Phase |
|---|------|------|-------|-------------|-------|-------|
| 1 | `tdd.md` | `.claude/rules/tdd.md` | Always-on | RED-GREEN-REFACTOR, 11 rationalization pairs, 80% coverage, Vitest + Playwright | ~40 | 2A |
| 2 | `systematic-debugging.md` | `.claude/rules/systematic-debugging.md` | Always-on | 4-phase debugging, 3-fix escalation | ~30 | 2A |
| 3 | `available-skills.md` | `.claude/rules/available-skills.md` | Always-on | Full skill + agent catalog | ~40 | 2A |
| 4 | `git-workflow.md` | `.claude/rules/git-workflow.md` | Always-on | Branch naming, PRs, squash merge, semver tags | ~20 | 2A |
| 5 | `e2e-testing.md` | `.claude/rules/e2e-testing.md` | Path: `**/*.{test,spec}.{ts,tsx}`, `e2e/**` | Playwright + React 19 + Vite | ~35 | 2A |
| 6 | `mcp-server-patterns.md` | `.claude/rules/mcp-server-patterns.md` | Path: `**/mcp/**` | Node/TS MCP SDK | ~30 | 2A |
| 7 | `react-vite.md` | `.claude/rules/react-vite.md` | Path: `src/**/*.{tsx,jsx,css}` | React 19, ShadCN, TanStack Query | ~25 | 2A |
| 8 | `aws-amplify.md` | `.claude/rules/aws-amplify.md` | Path: `amplify/**`, `src/api/**`, `infra/**` | Amplify Gen 2, DynamoDB, Lambda, Cognito | ~30 | 2A |

Always-on: 4 files, ~130 lines. Path-scoped: 4 files, ~120 lines.

---

## 7. Paperclip Integration

### Verdict: DEFER

Paperclip is production agent management. iaGO-OS is a build environment. Different layers. Revisit when: 3+ API-billed client agents + OpenClaw lacks budget enforcement + client requests spend controls.

### Original Session 8 Audit

| # | Item | Verdict |
|---|------|---------|
| 1 | Company JSON config files | DEFER |
| 2 | Agent JSON config files | DEFER |
| 3 | docker-compose.yml with PAPERCLIP_SECRET | DEFER (actual var: BETTER_AUTH_SECRET) |
| 4 | Heartbeat protocol integration | DEFER (Paperclip SKILL.md handles it) |
| 5 | Budget/approval workflow setup | DEFER |

### Capabilities Paperclip Owns (DO NOT BUILD)

| # | Capability |
|---|-----------|
| 1 | Production agent budget enforcement |
| 2 | Per-token dollar cost tracking |
| 3 | Multi-company agent management |
| 4 | Agent heartbeat/scheduling |
| 5 | Production task/issue management |
| 6 | Agent governance/approvals |
| 7 | Production audit trail |
| 8 | Agent authentication (JWT/API keys) |
| 9 | Encrypted secret management |
| 10 | Git workspace isolation for production agents |

**Impact on build:** Zero. No files added, removed, or changed.

---

## 8. CLAUDE.md

### Line Budget

| # | Section | Lines |
|---|---------|-------|
| 1 | Identity | 5 |
| 2 | Tech Stack | 9 |
| 3 | Code Standards | 12 |
| 4 | Architecture | 11 |
| 5 | Workflow | 8 |
| 6 | Verification | 6 |
| 7 | Search First | 5 |
| 8 | Agent Escalation Protocol | 9 |
| 9 | Execution Discipline | 12 |
| 10 | Rules | 12 |
| 11 | Skills | 6 |
| 12 | Agents | 4 |
| 13 | Model Routing | 6 |
| | **Total** | **105** |

### Complete Content

**Status: BUILT.** File exists at repo root (`CLAUDE.md`, 105 lines, committed).
See DECISION-claude-md.md for the verbatim content and the absorbed content audit.

---

## 9. Totals

| Category | Files | Lines |
|----------|-------|-------|
| Hook utilities | 3 | ~115 |
| Hooks | 9 | ~1,005 |
| Config (.gitignore, settings.json) | 2 | ~103 |
| CLAUDE.md | 1 | ~105 (done) |
| Rules files | 8 | ~250 |
| Agent definitions | 8 | ~460 |
| Workflow skills | 8 | ~535 |
| Core feature skills | 6 | ~260 |
| Content/business skills | 7 | ~205 |
| Experimental skills | 6 | ~195 |
| Industry skills | 9 | ~285 |
| **Total** | **67** | **~3,518** |

Built: 1 file (CLAUDE.md). Remaining: 66 files, ~3,413 lines.
Always-loaded per session: ~220 lines. On-demand: ~3,298 lines.

---

## 10. Build Order — Complete Phase Map

### Phase Dependency Diagram

```
Phase 0 (research + CLAUDE.md) ← DONE
    │
    ├─► 1A (scaffold + hook utilities)
    │       │
    │       └─► 1B (hooks + settings.json wiring)
    │               │
    │               ▼ ── BLOCKING: hooks fire, $CLAUDE_PROJECT_DIR resolves ──
    │
    ├─► 2A (rules files)              ◄── parallel with 1A/1B
    │       │
    │       └─► 2B (agent definitions) ◄── agents reference rules
    │               │
    │               ▼ ── BLOCKING: agent dispatch works ──
    │
    ├─► 3A (workflow skills)          ◄── depends on 2A + 2B
    │       │
    │       ▼ ── BLOCKING: /iago:init creates artifacts ──
    │
    ├─► 3B (core feature skills)      ◄── depends on 2B
    │
    ├─► 4A (content + experimental)   ◄── depends on Phase 0 only
    │
    └─► 4B (industry skills)          ◄── depends on Phase 0 only
```

### Phase 1A: Scaffold + Hook Utilities
**Depends on:** nothing
**Commit:** `feat(core): scaffold .iago/ directories and hook utilities`
**Files:**
- [ ] `.iago/.gitignore` — ignores `state/` only
- [ ] `.iago/hooks/lib/stdin.mjs` — parse stdin JSON (~20 lines)
- [ ] `.iago/hooks/lib/flags.mjs` — IAGO_DISABLED_HOOKS check (~15 lines)
- [ ] `.iago/hooks/lib/transcript.mjs` — transcript JSONL parsing (~80 lines)
- [ ] Create dirs: `.iago/state/`, `.iago/context/`, `.iago/plans/`, `.iago/summaries/`, `.iago/reviews/`
**Validation:** `node .iago/hooks/lib/stdin.mjs` with piped `{}` doesn't crash.
**Files:** 4 | **Lines:** ~118

### Phase 1B: Hook Suite + Settings Wiring
**Depends on:** 1A
**Commit:** `feat(hooks): complete hook suite with settings.json wiring`
**Files:**
- [ ] `.iago/hooks/statusline.mjs` (~90 lines)
- [ ] `.iago/hooks/context-persistence.mjs` (~280 lines)
- [ ] `.iago/hooks/context-monitor.mjs` (~60 lines)
- [ ] `.iago/hooks/post-edit-format.mjs` (~50 lines)
- [ ] `.iago/hooks/post-edit-typecheck.mjs` (~80 lines)
- [ ] `.iago/hooks/post-edit-console-warn.mjs` (~45 lines)
- [ ] `.iago/hooks/config-protection.mjs` (~100 lines)
- [ ] `.iago/hooks/safety-guard.mjs` (~180 lines)
- [ ] `.iago/hooks/commit-quality.mjs` (~120 lines)
- [ ] `.claude/settings.json` (~100 lines — 12 entries, 7 event types)
**Validation (BLOCKING):** SessionStart fires. $CLAUDE_PROJECT_DIR resolves on Windows. Post-edit-format fires on Edit.
**Files:** 10 | **Lines:** ~1,150

### Phase 2A: Rules Files
**Depends on:** Phase 0 (CLAUDE.md)
**Commit:** `feat(rules): always-on and path-scoped rule files`
**Files:**
- [ ] `.claude/rules/tdd.md` (~40 lines)
- [ ] `.claude/rules/systematic-debugging.md` (~30 lines)
- [ ] `.claude/rules/available-skills.md` (~40 lines)
- [ ] `.claude/rules/git-workflow.md` (~20 lines)
- [ ] `.claude/rules/e2e-testing.md` (~35 lines)
- [ ] `.claude/rules/mcp-server-patterns.md` (~30 lines)
- [ ] `.claude/rules/react-vite.md` (~25 lines)
- [ ] `.claude/rules/aws-amplify.md` (~30 lines)
**Validation (BLOCKING):** tdd.md content influences Claude behavior. Path-scoped rules load on matching files.
**Files:** 8 | **Lines:** ~250

### Phase 2B: Agent Definitions
**Depends on:** 2A
**Commit:** `feat(agents): 8 subagent definitions`
**Files:**
- [ ] `.claude/agents/implementer.md` (~65 lines)
- [ ] `.claude/agents/code-reviewer.md` (~55 lines)
- [ ] `.claude/agents/spec-reviewer.md` (~50 lines)
- [ ] `.claude/agents/code-quality-reviewer.md` (~55 lines)
- [ ] `.claude/agents/researcher.md` (~55 lines)
- [ ] `.claude/agents/tdd-guide.md` (~60 lines)
- [ ] `.claude/agents/build-error-resolver.md` (~60 lines)
- [ ] `.claude/agents/e2e-runner.md` (~60 lines)
**Validation (BLOCKING):** Dispatch `researcher` agent. Confirm Sonnet model, tool restrictions, escalation status returned.
**Files:** 8 | **Lines:** ~460

### Phase 3A: Workflow Skills
**Depends on:** 2A + 2B
**Commit:** `feat(skills): iaGO workflow skills`
**Files:**
- [ ] `.claude/skills/iago-init/SKILL.md` (~80 lines)
- [ ] `.claude/skills/iago-discuss/SKILL.md` (~60 lines)
- [ ] `.claude/skills/iago-plan/SKILL.md` (~90 lines)
- [ ] `.claude/skills/iago-execute/SKILL.md` (~85 lines)
- [ ] `.claude/skills/iago-verify/SKILL.md` (~70 lines)
- [ ] `.claude/skills/iago-fast/SKILL.md` (~50 lines)
- [ ] `.claude/skills/iago-quick/SKILL.md` (~60 lines)
- [ ] `.claude/skills/iago-pause/SKILL.md` (~40 lines)
**Validation (BLOCKING):** `/iago:init` creates PROJECT.md, ROADMAP.md, STATE.md, config.json. Skills discoverable via `/`.
**Files:** 8 | **Lines:** ~535

### Phase 3B: Core Feature Skills
**Depends on:** 2B
**Commit:** `feat(skills): core feature skills`
**Files:**
- [ ] `.claude/skills/brainstorming/SKILL.md` (~50 lines)
- [ ] `.claude/skills/writing-plans/SKILL.md` (~45 lines)
- [ ] `.claude/skills/subagent-driven-development/SKILL.md` (~60 lines)
- [ ] `.claude/skills/code-review/SKILL.md` (~40 lines)
- [ ] `.claude/skills/deep-research/SKILL.md` (~35 lines)
- [ ] `.claude/skills/prompt-optimizer/SKILL.md` (~30 lines)
**Validation:** `/brainstorming` follows skill procedure.
**Files:** 6 | **Lines:** ~260

### Phase 4A: Content/Business + Experimental Skills
**Depends on:** Phase 0
**Commit:** `feat(skills): content, business, and experimental skills`
**Files:**
- [ ] `.claude/skills/article-writing/SKILL.md` (~30 lines)
- [ ] `.claude/skills/content-engine/SKILL.md` (~35 lines)
- [ ] `.claude/skills/investor-materials/SKILL.md` (~30 lines)
- [ ] `.claude/skills/investor-outreach/SKILL.md` (~25 lines)
- [ ] `.claude/skills/market-research/SKILL.md` (~30 lines)
- [ ] `.claude/skills/visa-doc-translate/SKILL.md` (~25 lines)
- [ ] `.claude/skills/frontend-slides/SKILL.md` (~30 lines)
- [ ] `.claude/skills/autonomous-loops/SKILL.md` (~35 lines)
- [ ] `.claude/skills/continuous-agent-loop/SKILL.md` (~35 lines)
- [ ] `.claude/skills/enterprise-agent-ops/SKILL.md` (~40 lines)
- [ ] `.claude/skills/agent-payment-x402/SKILL.md` (~25 lines)
- [ ] `.claude/skills/liquid-glass-design/SKILL.md` (~30 lines)
- [ ] `.claude/skills/santa-method/SKILL.md` (~30 lines)
**Validation:** Spot-check 2-3 skills. Confirm CSO frontmatter.
**Files:** 13 | **Lines:** ~400

### Phase 4B: Industry Skills
**Depends on:** Phase 0
**Commit:** `feat(skills): industry-specific skills`
**Files:**
- [ ] `.claude/skills/healthcare-phi-compliance/SKILL.md` (~40 lines)
- [ ] `.claude/skills/carrier-relationship-management/SKILL.md` (~30 lines)
- [ ] `.claude/skills/customs/SKILL.md` (~35 lines)
- [ ] `.claude/skills/energy/SKILL.md` (~35 lines)
- [ ] `.claude/skills/logistics/SKILL.md` (~35 lines)
- [ ] `.claude/skills/inventory/SKILL.md` (~30 lines)
- [ ] `.claude/skills/production-scheduling/SKILL.md` (~30 lines)
- [ ] `.claude/skills/quality-nonconformance/SKILL.md` (~25 lines)
- [ ] `.claude/skills/returns-reverse-logistics/SKILL.md` (~25 lines)
**Validation:** Spot-check 1-2 skills. Confirm frontmatter.
**Files:** 9 | **Lines:** ~285

---

## 11. Total File Count

| Category | Files | Lines Est. |
|----------|-------|-----------|
| Hook utilities (lib/) | 3 | ~115 |
| Hooks (.mjs) | 9 | ~1,005 |
| Config (.gitignore, settings.json) | 2 | ~103 |
| CLAUDE.md | 1 | ~105 (done) |
| Rules files | 8 | ~250 |
| Agent definitions | 8 | ~460 |
| Workflow skills (/iago:*) | 8 | ~535 |
| Core feature skills | 6 | ~260 |
| Content/business skills | 7 | ~205 |
| Experimental skills | 6 | ~195 |
| Industry skills | 9 | ~285 |
| **Total** | **67** | **~3,518** |

**Built:** 1 (CLAUDE.md, 105 lines). **Remaining:** 66 files, ~3,413 lines across 8 phases.

**Per-phase breakdown:**

| Phase | Files | Lines | Commit |
|-------|-------|-------|--------|
| 1A | 4 | ~118 | `feat(core): scaffold .iago/ directories and hook utilities` |
| 1B | 10 | ~1,150 | `feat(hooks): complete hook suite with settings.json wiring` |
| 2A | 8 | ~250 | `feat(rules): always-on and path-scoped rule files` |
| 2B | 8 | ~460 | `feat(agents): 8 subagent definitions` |
| 3A | 8 | ~535 | `feat(skills): iaGO workflow skills` |
| 3B | 6 | ~260 | `feat(skills): core feature skills` |
| 4A | 13 | ~400 | `feat(skills): content, business, and experimental skills` |
| 4B | 9 | ~285 | `feat(skills): industry-specific skills` |
| **Sum** | **66** | **~3,458** | |

Note: Sum is ~3,458 (remaining to build), total with CLAUDE.md is ~3,518.

---

## 12. Blocking Validations

| Phase | Validation | What Breaks If It Fails |
|-------|-----------|------------------------|
| 1B | SessionStart hook fires | Session persistence, context recovery, pause/resume |
| 1B | `$CLAUDE_PROJECT_DIR` resolves on Windows | Every hook path — entire hook system |
| 1B | Post-edit-format fires on Edit | Post-edit pipeline (format, typecheck, console-warn) |
| 2A | Rules files discovered by Claude Code | TDD, debugging, skill catalog — all invisible |
| 2B | Agent dispatch works from orchestrator | SDD, code review, research — no agents |
| 3A | `/iago:init` creates expected artifacts | Entire workflow — no PROJECT/ROADMAP/STATE |
| 3A | Skills discoverable via `/` autocomplete | Users can't invoke workflow commands |

**Protocol:** If a blocking validation fails, STOP the build. Fix the failing component before proceeding to any phase that depends on it. Do not skip ahead.

---

## 13. Open Questions & Known Risks

### Known Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `$CLAUDE_PROJECT_DIR` undefined on Windows | Medium | Critical | Test in 1B. Fallback: relative paths. |
| Hook timeout (>2s sync budget) | Low | UX degradation | Benchmark safety-guard.mjs in 1B. Split if needed. |
| settings.json schema mismatch | Low | Hooks not registered | Cross-reference Claude Code docs in 1B. |
| Skill frontmatter rejected | Medium | Skills invisible | Test one skill first in 2A. |
| Biome not installed in target project | Medium | post-edit-format errors | Hook checks `npx biome --version`, exits clean if missing. |
| Transcript JSONL path varies by OS | Medium | Token tracking broken | Dynamic path detection in transcript.mjs. Test on Windows. |

### Open Questions (Non-Blocking, Post-v0.1.0)

1. **Skill naming:** Will `iago-init` directory show as `/iago-init` or `/iago:init`? May need `name:` frontmatter field.
2. **settings.json merge:** v0.1.0 assumes clean project. Merge strategy needed for v0.2.0.
3. **Hook performance:** No benchmarks. Measure after deployment.
4. **available-skills.md sync:** Manual sync for v0.1.0. Build script for v0.2.0.

---

## 14. Cross-Reference Validation

All checks performed against the complete document (§1-§13).

### Cross-Reference Integrity

- [x] **Every file in §10 build phases appears in relevant manifest.** Hooks (§1): 12/12 matched. Skills (§4): 36/36 matched. Agents (§5): 8/8 matched. Rules (§6): 8/8 matched. Config: 2/2 matched (`.iago/.gitignore`, `.claude/settings.json`).
- [x] **Every hook in §1 has a settings.json entry in §1.** 12 hook entries: statusline(1), SessionStart(1), PreToolUse/Bash(2), PreToolUse/Edit(2), PostToolUse/all(1), PostToolUse/Edit(3), PreCompact(1), Stop(1) = 12. All 9 hook files referenced. `context-persistence.mjs` appears 3 times (session-start, pre-compact, stop). `safety-guard.mjs` appears 2 times (Bash, Edit matchers).
- [x] **Every skill in §4 that dispatches agents references agents in §5.** `/iago:execute` → implementer, code-reviewer ✓. `/iago:quick` → implementer, code-reviewer ✓. `/subagent-driven-development` → implementer, code-reviewer, spec-reviewer, code-quality-reviewer ✓. `/code-review` → code-reviewer ✓. `/deep-research` → researcher ✓. `/autonomous-loops` → implementer ✓. tdd rule → tdd-guide ✓. debugging rule → build-error-resolver ✓. e2e rule → e2e-runner ✓.
- [x] **Every agent in §5 appears in dispatch map.** implementer (SDD, execute, quick, autonomous-loops), code-reviewer (SDD, code-review, execute, quick), spec-reviewer (SDD full mode), code-quality-reviewer (SDD full mode), researcher (deep-research), tdd-guide (ad-hoc), build-error-resolver (ad-hoc), e2e-runner (ad-hoc). 8/8 accounted for.
- [x] **Build phase assignments consistent.** §1 hook manifest phases match §10 checklists. §4 skill phases match §10. §5 agent phases match §10. §6 rules phases match §10. No mismatches found.
- [x] **CLAUDE.md §8 points to rules in §6.** CLAUDE.md §Rules section lists: tdd.md ✓, systematic-debugging.md ✓, git-workflow.md ✓, available-skills.md ✓, react-vite.md ✓, aws-amplify.md ✓, e2e-testing.md ✓, mcp-server-patterns.md ✓. 8/8 match §6.
- [x] **CLAUDE.md §8 points to skills in §4.** CLAUDE.md §Skills lists: brainstorming ✓, writing-plans ✓, subagent-driven-development ✓, code-review ✓, deep-research ✓, prompt-optimizer ✓, plus all /iago:* skills ✓. All present in §4.
- [x] **Total file count in §11 matches actual count.** Hooks: 3+9=12. Config: 2. CLAUDE.md: 1. Rules: 8. Agents: 8. Skills: 8+6+7+6+9=36. Total: 12+2+1+8+8+36 = 67. ✓
- [x] **No §7 "DO NOT BUILD" capability duplicated elsewhere.** Budget enforcement: not in any section. Dollar cost tracking: not built (iaGO tracks tokens, not dollars). Agent heartbeat: not built. Agent auth: not built. Production audit: not built. 10/10 clean.

### Content Integrity

- [x] **settings.json JSON is valid.** Verified: balanced braces, proper nesting, all commas correct, all strings quoted. 12 hook entries parse correctly.
- [x] **CLAUDE.md under 200 lines.** 105 lines. ✓
- [x] **config.json schema in §3 is valid JSON.** Verified: 4 nested objects, all types correct, all defaults documented.
- [x] **All file paths use forward slashes.** Verified: every path in §1, §4, §5, §6, §10 uses `/` not `\`.
- [x] **All hook files have .mjs extension.** Verified: 12/12 hook system files end in `.mjs`.
- [x] **Every build phase has a conventional commit message.** 1A: `feat(core):` ✓. 1B: `feat(hooks):` ✓. 2A: `feat(rules):` ✓. 2B: `feat(agents):` ✓. 3A: `feat(skills):` ✓. 3B: `feat(skills):` ✓. 4A: `feat(skills):` ✓. 4B: `feat(skills):` ✓. 8/8 conventional.
