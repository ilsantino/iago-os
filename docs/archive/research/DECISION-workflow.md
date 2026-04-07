# Workflow Engine & Discipline — Canonical Reference

> Compiled from: DECISION-workflow-foundation.md (§1-3), DECISION-execution.md (§4-5, §7), DECISION-discipline.md (§6, §8-9), plus new artifact templates.
> Date: 2026-04-01
> Sprint: 4 — Assembly
>
> This is the canonical reference for Sprint 5 implementation. Source documents retain reasoning and alternatives; this document retains only decisions, specs, and templates.

---

## §1. Phase Structure

| # | Phase | Skill | Output Artifact | Input Gate | Driver |
|---|-------|-------|-----------------|------------|--------|
| 0 | **init** | `/iago:init` | `PROJECT.md`, `ROADMAP.md`, `STATE.md`, `config.json` | None. Blocks if `PROJECT.md` exists. | Orchestrator-direct. Optional: `researcher` for codebase scan. |
| 1 | **discuss** | `/iago:discuss` | `context/{NN}-{slug}.md` | `ROADMAP.md` must exist. Phase must be listed. | Orchestrator-direct. |
| 2 | **plan** | `/iago:plan` | `plans/{NN}-{slug}-{PP}.md` (1+) | `context/{phase}.md` must exist (soft gate). | Orchestrator-direct. Optional: `researcher` via `--research`. |
| 3 | **execute** | `/iago:execute` | `summaries/{NN}-{slug}-{PP}.md` per plan, git commits | At least one `plans/{phase}-*.md` must exist. | `implementer` per plan + `code-reviewer`. Ad-hoc: `tdd-guide`, `build-error-resolver`. |
| 4 | **verify** | `/iago:verify` | `reviews/{NN}-{slug}.md` | All plan summaries for the phase must exist. | Orchestrator-direct. Ships PR if `passed`. |

### Bypass Modes

| Mode | Skill | When | What It Does | Phases Skipped |
|------|-------|------|-------------|----------------|
| **fast** | `/iago:fast` | ≤3 files, no deps, obvious fix | Inline execute → atomic commit → STATE.md log | All: no discuss, no plan, no summary, no verify, no subagent |
| **quick** | `/iago:quick` | 1-3 tasks, clear scope, standalone | Lightweight plan → `implementer` → `code-reviewer` | No ROADMAP manipulation, no wave grouping, no plan self-review loop |

Quick composable flags: `--discuss`, `--research`, `--verify`.

### Gate Flow

```
init ──[PROJECT.md]──► discuss ──[context.md]──► plan ──[plan.md]──►
execute ──[summary.md]──► verify ──[review.md]──► done / re-plan

After verify passes: STATE.md updated, PR created, orchestrator suggests next phase.
```

---

## §2. State Directory

### Directory Tree

```
.iago/
  PROJECT.md                 # Vision, constraints, architecture decisions (tracked)
  ROADMAP.md                 # Phase breakdown with goals + status (tracked)
  STATE.md                   # Living position digest, <80 lines (tracked)
  config.json                # Workflow configuration, 9 fields (tracked)
  .gitignore                 # Ignores state/ only

  context/                   # Discussion artifacts (tracked)
  plans/                     # Implementation plans (tracked)
  summaries/                 # Execution summaries (tracked)
  reviews/                   # Verification reports (tracked)

  hooks/                     # Hook files (tracked) — see DECISION-hooks.md
    lib/
      stdin.mjs, flags.mjs, transcript.mjs
    statusline.mjs, context-persistence.mjs, context-monitor.mjs
    post-edit-format.mjs, post-edit-typecheck.mjs, post-edit-console-warn.mjs
    config-protection.mjs, safety-guard.mjs, commit-quality.mjs

  state/                     # Runtime state (ALL gitignored)
    sessions/{id}.json       # Session snapshots (keep last 10)
    bridge-ctx.json          # Context % bridge for monitor
    active-client.json       # Current client slug
    costs.jsonl              # Per-session utilization log (append-only)
    HANDOFF.json             # Pause state (transient — deleted on resume)

  research/                  # Research artifacts (tracked)
```

### File Manifest

| File | Created By | Read By | Constraint |
|------|-----------|---------|------------|
| `PROJECT.md` | `/iago:init` | All phases, all agents | None |
| `ROADMAP.md` | `/iago:init` | Orchestrator, discuss, verify | None |
| `STATE.md` | `/iago:init`, updated every phase | All agents | **< 80 lines** |
| `config.json` | `/iago:init` | All phases | 9 fields |
| `context/{NN}-{slug}.md` | `/iago:discuss` | Plan, execute | None |
| `plans/{NN}-{slug}-{PP}.md` | `/iago:plan` | Execute, verify | Max 8 tasks/plan |
| `summaries/{NN}-{slug}-{PP}.md` | Execute phase | Verify, STATE.md updates | None |
| `reviews/{NN}-{slug}.md` | `/iago:verify` | Orchestrator | None |
| `state/HANDOFF.json` | `/iago:pause` | SessionStart hook (loads + deletes) | 1 file, transient |
| `state/sessions/{id}.json` | `context-persistence.mjs` | SessionStart | Keep last 10 |
| `state/bridge-ctx.json` | `statusline.mjs` | `context-monitor.mjs` | Overwritten |
| `state/active-client.json` | `/iago:init` or manual | Statusline, cost tracking | 1 file |
| `state/costs.jsonl` | `context-persistence.mjs` stop | Reporting | Append-only |

### Naming Convention

`{NN}-{slug}` prefix where NN = two-digit phase number, slug = kebab-case name.
Plans add `-{PP}` for plan number within phase.
Quick tasks: `quick-{YYMMDD}-{slug}`.

---

## §3. config.json

```json
{
  "project": {
    "name": "widget-redesign",
    "client": "acme",
    "type": "saas"
  },
  "workflow": {
    "skip_discuss": false,
    "auto_verify": true,
    "auto_advance": false
  },
  "planning": {
    "max_tasks_per_plan": 8,
    "context_budget_pct": 40
  },
  "review": {
    "mode": "single"
  }
}
```

| Field | Type | Default | Consumed By |
|-------|------|---------|-------------|
| `project.name` | string | (required) | STATE.md, commits, PRs |
| `project.client` | string | `"internal"` | Cost tracking, statusline |
| `project.type` | enum | `"saas"` | Plan suggestions |
| `workflow.skip_discuss` | boolean | `false` | `/iago:plan` (suppress context warning) |
| `workflow.auto_verify` | boolean | `true` | `/iago:execute` (auto-run verify) |
| `workflow.auto_advance` | boolean | `false` | Orchestrator (chain phases) |
| `planning.max_tasks_per_plan` | integer | `8` | `/iago:plan` (split threshold) |
| `planning.context_budget_pct` | integer | `40` | Quick mode context target |
| `review.mode` | enum | `"single"` | `/iago:execute` (reviewer dispatch) |

---

## §4. Plan Format

**Path:** `.iago/plans/{NN}-{slug}-{PP}.md`

### Frontmatter

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phase` | string | Yes | `{NN}-{slug}` |
| `plan` | string | Yes | Plan number (`01`, `02`) |
| `wave` | integer | Yes | Execution wave (1 = no deps) |
| `depends_on` | string[] | Yes | Plan IDs this depends on (empty if wave 1) |
| `context` | string | No | Path to context artifact |
| `created` | string | Yes | ISO date |

### Task Fields

| Field | Required | Description |
|-------|----------|-------------|
| `files` | Yes | Exact file paths (1-3 per task) |
| `action` | Yes | Specific enough for a fresh-context agent. ≤3 sentences. |
| `verify` | Yes | Exact shell command |
| `expected` | Yes | What verify should produce |

### Constraints

- Max 8 tasks per plan (from `config.planning.max_tasks_per_plan`). Over → split.
- No placeholders: "TBD", "TODO", "implement later", "similar to Task N", "add appropriate handling" = plan failure.
- Self-review before finalizing: context coverage, placeholder scan, file consistency, verify commands, wave sanity, task count.

---

## §5. Execution Model

### Dispatch: Per-Plan

One `implementer` subagent per plan. Sequential within waves. All agents on Sonnet.

### Context Payload

| Agent | Gets | Excludes |
|-------|------|----------|
| **implementer** | Plan file, CLAUDE.md, rules/tdd.md, rules/systematic-debugging.md, PROJECT.md, STATE.md | Other plans, context/, history, config.json |
| **code-reviewer** | Git diff, CLAUDE.md, plan file, PROJECT.md | Source files, history, STATE.md |
| **spec-reviewer** | Plan file, CLAUDE.md, context/{phase}.md, changed file list | Git diff, history |
| **code-quality-reviewer** | Git diff, CLAUDE.md, PROJECT.md | Plan, context, history |
| **researcher** | Research question, CLAUDE.md, PROJECT.md, STATE.md, web access | Plans, summaries, history |
| **tdd-guide** | Task description, target files, CLAUDE.md, rules/tdd.md | Plans, summaries, history |
| **build-error-resolver** | Error output, failing file, CLAUDE.md, rules/systematic-debugging.md | Plans, summaries, history |
| **e2e-runner** | Test scope, CLAUDE.md, rules/e2e-testing.md | Plans, summaries, history |

**Design principle:** Every agent gets CLAUDE.md + minimum artifacts for its role. Conversation history is NEVER passed.

### Escalation Protocol

Every agent ends with exactly one status:

| Status | Meaning | Orchestrator Action |
|--------|---------|---------------------|
| `DONE` | Verified with evidence | Write summary, dispatch review |
| `DONE_WITH_CONCERNS` | Done, minor issues flagged | Write summary with concerns, review with attention |
| `NEEDS_CONTEXT` | Can't proceed — missing info | Provide context or break smaller, re-dispatch |
| `BLOCKED` | External blocker | Escalate to human, log in STATE.md |

### Review Dispatch

- `review.mode: "single"` → `code-reviewer` (default)
- `review.mode: "full"` → `spec-reviewer` then `code-quality-reviewer` (Stage 2 only if Stage 1 passes)

### Wave Execution

Sequential with wave metadata. Plans declare `wave` and `depends_on`. Execute wave 1 plans first (one at a time), then wave 2, etc. Parallel execution deferred — metadata exists for future enablement.

---

## §6. CLAUDE.md Budget

**Total: ~90 lines (under 200 limit, ~110 lines headroom)**

| # | Section | Lines | Contents |
|---|---------|-------|----------|
| 1 | Identity | 5 | Team, project purpose, "stack is fixed" |
| 2 | Tech Stack | 7 | Frontend, backend, agents, tooling, infra |
| 3 | Code Standards | 11 | Biome, TS strict, named exports, functional components, colocation |
| 4 | Architecture Rules | 10 | DynamoDB, Lambda, Cognito, Amplify, TanStack Query, feature folders |
| 5 | Workflow | 6 | Phase summary, quick modes, STATE.md <80 lines, artifact paths |
| 6 | Verification | 4 | Never claim done without evidence |
| 7 | Search First | 2 | Search before creating |
| 8 | Agent Escalation Protocol | 7 | DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED |
| 9 | Execution Discipline | 13 | 7-read guard, 3-fix escalation, no scope creep, deviation rules |
| 10 | Pointers | 8 | Rules, skills, agents references |
| 11 | Model Routing | 4 | Opus=orchestrator, Sonnet=agents, Haiku=reserved |
| — | Headers + spacing | ~13 | |

### Config Hierarchy (precedence order)

| # | Layer | Override Model |
|---|-------|----------------|
| 5 | **Hooks** | Mechanical. Cannot be overridden by prompt. Bypass only via `IAGO_DISABLED_HOOKS` env var. |
| 4 | **Agent prompts** | Role-scoped. Can tighten but never loosen rules. |
| 3 | **Skills** | Task-scoped. Must align with rules + CLAUDE.md. |
| 2 | **.claude/rules/** | Hard constraints within scope. Override CLAUDE.md guidance. |
| 1 | **CLAUDE.md** | Soft guidance. Loaded every session. |

---

## §7. Quick/Fast Modes

### `/iago:fast`

**Criteria (ALL true):** ≤3 file edits, no new deps, obvious fix, one-sentence description.

**Flow:** Execute inline → atomic commit → STATE.md log.

**Skips:** Everything. No discuss, plan, summary, verify, subagent, review.

**Artifacts:** Git commit + STATE.md log entry only.

**Redirect:** >3 files → `/iago:quick`. Unsure → `/iago:quick`.

### `/iago:quick`

**Criteria:** 1-3 tasks, clear scope, standalone (not part of ROADMAP phase).

**Flow:** [optional discuss] → lightweight plan → `implementer` → `code-reviewer` → [optional verify] → STATE.md log.

**Skips:** ROADMAP manipulation, wave grouping, plan self-review loop.

**Flags:** `--discuss`, `--research`, `--verify` (composable).

**Plan naming:** `quick-{YYMMDD}-{slug}.md`

**Artifacts:** Plan + summary in `.iago/plans/` and `.iago/summaries/` + git commits + STATE.md log.

---

## §8. Pause/Resume

**Verdict:** Explicit pause skill, automatic resume via SessionStart hook.

**`/iago:pause`** — Skill (~30 lines). Writes `.iago/state/HANDOFF.json`.

**Resume** — No explicit command. SessionStart hook (DECISION-hooks.md §2) loads HANDOFF.json, injects via `hookSpecificOutput`, deletes after load.

**`.continue-here.md`** — Skipped. HANDOFF.json field names are self-documenting.

### HANDOFF.json Schema

```json
{
  "paused_at": "2026-04-01T15:30:00Z",
  "session_id": "abc123",
  "client": "acme",
  "project": "widget-redesign",
  "git_branch": "feat/01-auth",
  "workflow_position": {
    "phase": "01-auth",
    "plan": "01-auth-02",
    "task": 3
  },
  "current_task": "Task 3: Registration endpoint",
  "completed_tasks": [
    { "task": 1, "description": "JWT utility module", "commit": "abc1234" },
    { "task": 2, "description": "Password utility module", "commit": "def5678" }
  ],
  "remaining_tasks": [
    { "task": 3, "description": "Registration endpoint" },
    { "task": 4, "description": "Login endpoint" }
  ],
  "blockers": [],
  "key_decisions": ["JWT over session cookies", "bcrypt for hashing"],
  "uncommitted_files": ["src/routes/auth/register.ts"],
  "next_action": "Continue POST /api/auth/register — validation done, need DB insert"
}
```

`workflow_position` is nullable (for ad-hoc / quick work outside full workflow).

Stale warning: >7 days old → SessionStart logs informational warning.

### Relationship to Session Hooks

| Layer | Trigger | Precision | Lifecycle |
|-------|---------|-----------|-----------|
| Session snapshot | Automatic (PreCompact + Stop) | Low — "what was I doing?" | Always available. Kept last 10. |
| HANDOFF.json | Manual (`/iago:pause`) | High — "continue exactly here" | Written on pause. Deleted on resume. |

Recovery hierarchy: HANDOFF.json > session snapshot > interrupted session detection.

---

## §9. Discipline Placement

Every pattern has exactly ONE canonical home. No duplication.

| # | Pattern | Location | Enforcement |
|---|---------|----------|-------------|
| 1 | Analysis paralysis guard (7 reads) | CLAUDE.md §Execution Discipline | Universal rule |
| 2 | Fix-attempt escalation (3 fails) | CLAUDE.md §Execution Discipline | Universal rule |
| 3 | Verification-before-completion | CLAUDE.md §Verification | Universal rule |
| 4 | Search before creating | CLAUDE.md §Search First | Universal rule |
| 5 | Agent escalation protocol | CLAUDE.md §Agent Escalation Protocol | Inherited by all agents |
| 6 | No scope creep | CLAUDE.md §Execution Discipline | Universal rule |
| 7 | Deviation rules (auto-fix vs ASK) | CLAUDE.md §Execution Discipline | Universal rule |
| 8 | STATE.md digest (<80 lines) | CLAUDE.md §Workflow | Structural constraint |
| 9 | Skill-check meta-rule | `.claude/rules/available-skills.md` | Auto-loaded |
| 10 | TDD + rationalization prevention | `.claude/rules/tdd.md` | Always-on rule |
| 11 | Systematic debugging 4-phase | `.claude/rules/systematic-debugging.md` | Always-on rule |
| 12 | No-placeholders rule | `/iago:plan` SKILL.md | Plan self-review |
| 13 | Self-review before plan done | `/iago:plan` SKILL.md | 6-point checklist |
| 14 | Fresh context per dispatch | `/subagent-driven-development` SKILL.md | Dispatch architecture |
| 15 | Two-stage review | `/subagent-driven-development` SKILL.md | Opt-in flow |
| 16 | Commit conventions | `commit-quality.mjs` hook | Mechanical |
| 17 | Config protection | `config-protection.mjs` hook | Mechanical |
| 18 | Destructive commands (13 patterns) | `safety-guard.mjs` hook | Mechanical |
| 19 | Secret detection (17 patterns) | `safety-guard.mjs` hook | Mechanical |
| 20 | Injection detection (4 patterns) | `safety-guard.mjs` hook | Mechanical |
| 21 | Context monitoring (80%/90%) | `context-monitor.mjs` hook | Mechanical |
| 22 | Post-edit format/typecheck | `post-edit-*.mjs` hooks | Mechanical |

---

## §10. Rules Files

| # | File | Scope | Lines | Status |
|---|------|-------|-------|--------|
| 1 | `tdd.md` | Always-on | ~40 | Decided (Sprint 3) |
| 2 | `systematic-debugging.md` | Always-on | ~30 | Decided (Sprint 3) |
| 3 | `e2e-testing.md` | Path: `**/*.{test,spec}.{ts,tsx}`, `e2e/**` | ~35 | Decided (Sprint 3) |
| 4 | `mcp-server-patterns.md` | Path: `**/mcp/**` | ~30 | Decided (Sprint 3) |
| 5 | `available-skills.md` | Always-on | ~40 | Decided (Sprint 3) |
| 6 | `git-workflow.md` | Always-on | ~20 | Decided (Sprint 4) |
| 7 | `react-vite.md` | Path: `src/**/*.{tsx,jsx,css}` | ~25 | Decided (Sprint 4) |
| 8 | `aws-amplify.md` | Path: `amplify/**`, `src/api/**`, `infra/**` | ~30 | Decided (Sprint 4) |

**Always-loaded:** 4 files, ~130 lines (tdd, systematic-debugging, available-skills, git-workflow).
**Path-scoped:** 4 files, ~120 lines (e2e-testing, mcp-server-patterns, react-vite, aws-amplify).

---

## §11. Artifact Templates

### PROJECT.md

```markdown
# {project-name}

## Vision

{1-2 sentences: what this project does and why it exists.}

## Client

{client name} — {engagement type: PoC, MVP, production, internal}

## Constraints

- **Timeline:** {deadline or "no fixed deadline"}
- **Budget:** {budget constraint or "Claude Max flat-rate"}
- **Compliance:** {HIPAA, SOC2, GDPR, or "none"}
- **Team:** {who is working on this, availability}

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript strict + TailwindCSS 4 + ShadCN/UI |
| Backend | AWS Amplify Gen 2 + Lambda + API Gateway + DynamoDB + Cognito |
| Testing | Vitest (unit/integration) + Playwright (E2E) |
| Tooling | Biome (format + lint) |

{Override rows only if project deviates from the standard stack.}

## Architecture Decisions

| # | Decision | Verdict | Date |
|---|----------|---------|------|

{Add rows as decisions are made during discuss and plan phases.
When STATE.md overflows its 5-decision limit, archive older decisions here.}
```

### ROADMAP.md

```markdown
# Roadmap — {project-name}

| # | Phase | Goal | Success Criteria | Status | Started | Completed |
|---|-------|------|-----------------|--------|---------|-----------|
| 01 | {slug} | {1-sentence goal} | {measurable criteria} | pending | — | — |
| 02 | {slug} | {goal} | {criteria} | pending | — | — |

## Phase Dependencies

{Note any phase ordering constraints beyond sequential.
If all phases are sequential, write: "Phases execute sequentially. No cross-phase dependencies."}
```

Status values: `pending` → `active` → `done`. Only one phase `active` at a time.

### STATE.md

```markdown
# State — {project-name}

> **Phase:** {NN}-{slug} | **Status:** {discussing|planning|executing|verifying|idle}
> **Plan:** {NN}-{slug}-{PP} or "—" | **Updated:** {YYYY-MM-DD}

## Recent Decisions

| Date | Decision | Phase |
|------|----------|-------|

{Keep 3-5 most recent. When a 6th is added, move the oldest to PROJECT.md §Architecture Decisions.}

## Blockers

| Blocker | Since | Owner |
|---------|-------|-------|

{Remove resolved blockers immediately. Empty table = no blockers.}

## Quick Tasks

| Date | Mode | Description | Commit |
|------|------|-------------|--------|
```

**Hard constraint: < 80 lines.** This is a digest. If it's growing, you're archiving too slowly.

### context/{NN}-{slug}.md

```markdown
---
phase: {NN}-{slug}
discussed: {YYYY-MM-DD}
---

# Context: {NN}-{slug} — {phase name}

## Domain

{Domain-specific background. What does this phase deal with? What does the user care about?}

## Decisions

| # | Question | Decision | Reasoning |
|---|----------|----------|-----------|

## References

{Key files, APIs, docs, or external resources referenced during discussion.}

## Specifics

{Implementation details clarified during discussion. Concrete answers to gray areas.}

## Deferred

{Ideas and scope items explicitly NOT in scope for this phase.
These may become future ROADMAP phases or get dropped entirely.}
```

### plans/{NN}-{slug}-{PP}.md

```markdown
---
phase: {NN}-{slug}
plan: {PP}
wave: 1
depends_on: []
context: .iago/context/{NN}-{slug}.md
created: {YYYY-MM-DD}
---

# Plan: {NN}-{slug}-{PP} — {short description}

## Goal

{1-2 sentences: what this plan achieves within the phase.}

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | {path} | {why} |
| modify | {path} | {why} |

## Tasks

### Task 1: {name}
- **files:** `{path}`
- **action:** {Specific implementation instruction. ≤3 sentences. No placeholders.}
- **verify:** `{exact shell command}`
- **expected:** {What the verify command produces when correct}

### Task 2: {name}
...

## Verification

{After all tasks: aggregate verify command + expected result. E.g., "npx vitest run tests/auth/ — all pass, npx tsc --noEmit — clean."}
```

### summaries/{NN}-{slug}-{PP}.md

Written by orchestrator after collecting implementer return.

```markdown
---
phase: {NN}-{slug}
plan: {PP}
status: done
key_files:
  - {path}
commits:
  - {hash}
---

# Summary: {NN}-{slug}-{PP} — {short description}

## Tasks Completed

| # | Task | Files Changed | Commit |
|---|------|--------------|--------|
| 1 | {name} | {paths} | {hash} |

## Verification

{Aggregate verify result. E.g., "npx vitest run tests/auth/ — 12 tests, 0 failures."}

## Deviations

{Any divergence from plan. "None." if clean.}

## Review

{Populated by orchestrator after code-reviewer runs. Severity findings if any.}
```

### reviews/{NN}-{slug}.md

```markdown
---
phase: {NN}-{slug}
status: passed | gaps_found | human_needed
verified: {YYYY-MM-DD}
---

# Verification: {NN}-{slug} — {phase name}

## Phase Goal

> {Goal from ROADMAP.md for this phase.}

## Checks

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | {goal criterion from ROADMAP} | pass/fail | {test output, file exists, etc.} |

## Artifact Verification

| # | Artifact | Exists | Works | Notes |
|---|----------|--------|-------|-------|
| 1 | {expected output file or endpoint} | yes/no | yes/no | {details} |

## Wiring

| # | Connection | Status | Notes |
|---|-----------|--------|-------|
| 1 | {component A → component B} | pass/fail | {evidence} |

## Gaps

| # | Gap | Severity | Action |
|---|-----|----------|--------|

## Verdict

{One of:}
- **passed** — All checks pass. PR created.
- **gaps_found** — Gaps listed above. Re-plan scope: {specific gaps to address}.
- **human_needed** — Cannot verify automatically. UAT required: {what to test manually}.
```

### quick plans/summaries

Same templates as above but with `quick-{YYMMDD}-{slug}` naming. No phase prefix.

---

## §12. Cross-Reference Validation

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every phase output artifact listed in §2 state directory | **PASS** | init→PROJECT/ROADMAP/STATE/config (§2 manifest rows 1-4). discuss→context/ (row 5). plan→plans/ (row 6). execute→summaries/ (row 7). verify→reviews/ (row 8). |
| 2 | Every state file has creator + reader — no orphans | **PASS** | All 13 files in §2 manifest have both Created By and Read By columns populated. |
| 3 | config.json fields referenced by skill, hook, or agent | **PASS** | project.name→STATE.md/commits/PRs. project.client→cost tracking/statusline. project.type→plan suggestions. workflow.skip_discuss→`/iago:plan`. workflow.auto_verify→`/iago:execute`. workflow.auto_advance→orchestrator. planning.max_tasks_per_plan→`/iago:plan`. planning.context_budget_pct→quick mode. review.mode→`/iago:execute` review dispatch. |
| 4 | Plan template produces files in §2 paths | **PASS** | Template writes to `plans/{NN}-{slug}-{PP}.md` matching §2 row 6. |
| 5 | Agent names in §5 match DECISION-skills-agents.md | **PASS** | 8 agents: implementer, code-reviewer, spec-reviewer, code-quality-reviewer, researcher, tdd-guide, build-error-resolver, e2e-runner — all present in DECISION-skills-agents.md §3 and DECISION-agents.md. |
| 6 | Result format includes escalation status | **PASS** | §5 escalation table: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED — matches DECISION-conventions.md §C. Summary template §11 `status` field captures this. |
| 7 | CLAUDE.md budget under 200 lines | **PASS** | §6 total: ~90 lines. 110 lines headroom. |
| 8 | Quick/fast modes show skipped phases | **PASS** | §1 bypass table: fast skips "All: no discuss, no plan, no summary, no verify, no subagent". Quick skips "No ROADMAP manipulation, no wave grouping, no plan self-review loop." §7 provides full detail. |
| 9 | Pause/resume doesn't duplicate hooks | **PASS** | §8: `/iago:pause` writes HANDOFF.json (skill). SessionStart hook reads + deletes (hook). No overlap — pause creates, hook consumes. Session snapshot (Stop hook) and HANDOFF.json capture different data at different fidelity. |
| 10 | Every discipline pattern has exactly one home | **PASS** | §9: 22 patterns, each with single location. 8 in CLAUDE.md, 3 in rules/, 4 in skills, 7 in hooks. No duplicates. |
| 11 | Rules files don't overlap with hooks | **PASS** | §10: tdd, debugging, e2e, mcp, skills-catalog, git-workflow, react-vite, aws-amplify. None duplicate hook enforcement (commit conventions→hook, config protection→hook, safety→hook, context monitoring→hook, post-edit→hook). |

---

## §13. Sprint 5 Build Order

| Phase | Items | Depends On |
|-------|-------|------------|
| **1** | `.iago/` directory scaffold + `.gitignore` | — |
| **2** | Hook utilities: `lib/stdin.mjs`, `lib/flags.mjs`, `lib/transcript.mjs` | Phase 1 |
| **3** | Standalone hooks (8): statusline, context-monitor, post-edit-format, post-edit-typecheck, post-edit-console-warn, config-protection, safety-guard, commit-quality | Phase 2 |
| **4** | Complex hook: `context-persistence.mjs` (SessionStart/PreCompact/Stop) | Phases 2-3 |
| **5** | `settings.json` hook wiring (12 entries) | Phases 3-4 |
| **6** | `CLAUDE.md` (~90 lines, 11 sections) | — |
| **7** | Always-on rules: `tdd.md`, `systematic-debugging.md`, `available-skills.md`, `git-workflow.md` | Phase 6 |
| **8** | Path-scoped rules: `e2e-testing.md`, `mcp-server-patterns.md`, `react-vite.md`, `aws-amplify.md` | Phase 6 |
| **9** | Agent definitions (8): implementer, code-reviewer, spec-reviewer, code-quality-reviewer, researcher, tdd-guide, build-error-resolver, e2e-runner | Phases 6-7 |
| **10** | Core workflow skills: `/iago:init`, `/iago:discuss`, `/iago:plan`, `/iago:execute`, `/iago:verify`, `/iago:fast`, `/iago:quick`, `/iago:pause` | Phases 6-9 |
| **11** | Core feature skills: brainstorming, writing-plans, subagent-driven-development, code-review, deep-research, prompt-optimizer | Phase 9 |
| **12** | Supplementary skills (22): content/business + experimental + industry | Phase 6 |

Phases 1-5 (hooks) and 6-8 (CLAUDE.md + rules) can run in parallel.

---

## §14. Estimated Totals

| Category | Files | Lines |
|----------|-------|-------|
| Hooks (Sprint 2) | 12 | ~1,120 |
| CLAUDE.md | 1 | ~90 |
| Rules files | 8 | ~250 |
| Agent definitions | 8 | ~460 |
| Core skills | 6 + 8 workflow | ~500 |
| Supplementary skills | 22 | ~660 |
| **Total** | **~65** | **~3,080** |

Always-loaded context per session: ~220 lines (CLAUDE.md + always-on rules).
On-demand context: ~2,860 lines (path-scoped rules + agents + skills, loaded when needed).
