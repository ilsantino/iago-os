# Execution Model Decisions

> Phase 3 of Workflow Engine — Plans, Dispatch, Quick/Fast Modes
> Date: 2026-04-01
> Depends on: DECISION-workflow-foundation.md (phases, state dir, config), DECISION-skills-agents.md (agents, escalation)

---

## Decision 4: Plan Format

### File Naming Convention

**Pattern:** `.iago/plans/{NN}-{slug}-{PP}.md`

- `NN` = two-digit phase number from ROADMAP.md (01, 02, 03)
- `slug` = kebab-case phase name (auth, dashboard, api-layer)
- `PP` = two-digit plan number within phase (01, 02)

Examples:
- `.iago/plans/01-auth-01.md` — first plan for phase 1 (auth)
- `.iago/plans/01-auth-02.md` — second plan for phase 1 (auth)
- `.iago/plans/02-dashboard-01.md` — first plan for phase 2 (dashboard)

Matches the naming convention from DECISION-workflow-foundation.md §2.

### Plan File Template

```markdown
---
phase: 01-auth
plan: 01
wave: 1
depends_on: []
context: .iago/context/01-auth.md
created: 2026-04-01
---

# Plan: 01-auth-01 — User registration and login endpoints

## Goal
Implement email/password registration and JWT-based login for the auth module.

## Files
| Action | Path | Purpose |
|--------|------|---------|
| create | src/routes/auth/register.ts | Registration endpoint with bcrypt hashing |
| create | src/routes/auth/login.ts | Login endpoint returning JWT |
| create | src/lib/auth/jwt.ts | JWT sign/verify utilities |
| create | src/lib/auth/password.ts | bcrypt hash/compare wrappers |
| modify | src/routes/index.ts | Mount auth routes |
| create | tests/auth/register.test.ts | Registration tests |
| create | tests/auth/login.test.ts | Login tests |

## Tasks

### Task 1: JWT utility module
- **files:** `src/lib/auth/jwt.ts`
- **action:** Create JWT sign and verify functions using jose library. Sign takes userId + role, returns token with 24h expiry. Verify takes token, returns decoded payload or throws.
- **verify:** `npx vitest run tests/auth/jwt.test.ts`
- **expected:** All tests pass — sign returns string, verify decodes correctly, expired token throws

### Task 2: Password utility module
- **files:** `src/lib/auth/password.ts`
- **action:** Create hashPassword(plain) and comparePassword(plain, hash) wrappers around bcrypt with cost factor 12.
- **verify:** `npx vitest run tests/auth/password.test.ts`
- **expected:** All tests pass — hash produces bcrypt string, compare returns true for match, false for mismatch

### Task 3: Registration endpoint
- **files:** `src/routes/auth/register.ts`, `src/routes/index.ts`
- **action:** POST /api/auth/register. Validate email format + password length (>=8). Check email uniqueness against DB. Hash password via password.ts. Insert user. Return 201 with { id, email }. Return 409 on duplicate, 400 on validation failure.
- **verify:** `npx vitest run tests/auth/register.test.ts`
- **expected:** All tests pass — 201 on valid registration, 409 on duplicate email, 400 on invalid input

### Task 4: Login endpoint
- **files:** `src/routes/auth/login.ts`
- **action:** POST /api/auth/login. Validate email + password present. Look up user by email. Compare password via password.ts. Sign JWT via jwt.ts. Return 200 with { token }. Return 401 on invalid credentials.
- **verify:** `npx vitest run tests/auth/login.test.ts`
- **expected:** All tests pass — 200 with token on valid login, 401 on wrong password, 401 on nonexistent email

## Verification
After all tasks: `npx vitest run tests/auth/` — all auth tests pass, no type errors from `npx tsc --noEmit`.
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phase` | string | Yes | Phase identifier matching ROADMAP (`{NN}-{slug}`) |
| `plan` | string | Yes | Plan number within phase (`01`, `02`) |
| `wave` | integer | Yes | Execution wave (1 = no deps, 2 = depends on wave 1, etc.) |
| `depends_on` | string[] | Yes | Plan IDs this plan depends on (e.g., `["01-auth-01"]`). Empty array if wave 1. |
| `context` | string | No | Path to discussion artifact that informed this plan |
| `created` | string | Yes | ISO date (YYYY-MM-DD) |

### Task Fields

| Field | Required | Description |
|-------|----------|-------------|
| `files` | Yes | Exact file paths this task creates or modifies |
| `action` | Yes | What to implement. Specific enough that a fresh-context agent can execute without clarification. |
| `verify` | Yes | Exact shell command to run after implementation |
| `expected` | Yes | What the verify command should produce when the task is correct |

### Task Sizing

**Primary heuristic: file-count-based.** Each task touches 1-3 files. A task that needs 4+ files should be split.

**Secondary check: action clarity.** If the `action` field needs more than 3 sentences to describe, the task is too big. Split it.

**Why not time-based or context-based:**
- Time-based (Superpowers' 2-5 min) is subjective and unmeasurable by agents.
- Context-based (GSD's 30-40%) depends on model context window which varies.
- File count is concrete, observable, and correlates well with both time and context usage. A 1-3 file task naturally fits within 30-40% context and takes 2-10 minutes.

**Plan-level cap:** Max 8 tasks per plan (from `config.planning.max_tasks_per_plan`). Plans with more tasks are split into multiple plan files with `depends_on` metadata.

### No-Placeholders Rule

**Verdict:** Adopt with one exception.

**Rule text (for inclusion in `/iago:plan` skill):**

> Every task `action` field must be specific enough for a fresh-context agent to execute without asking questions. The following are plan failures:
>
> - "TBD", "TODO", "implement later"
> - "Add appropriate error handling" (specify which errors and how to handle them)
> - "Similar to Task N" (repeat the specifics — the implementing agent doesn't see other tasks)
> - Steps describing WHAT to do without specifying HOW
> - Vague verbs: "handle", "manage", "process" without concrete behavior
>
> Each task is executed by a fresh subagent that has never seen your conversation. If the action field wouldn't make sense to someone reading only this plan file, it's not specific enough.

**Exception:** When `config.project.type` is `"mvp"` or `"automation"`, the planner MAY use "follow the established pattern in {file}" as a shorthand for repetitive CRUD endpoints or similar boilerplate — but only when the referenced file already exists and the pattern is unambiguous. This exception exists because 4-week PoCs need velocity, and repeating 15 lines of identical CRUD instructions across 8 endpoints is noise.

### Plan Self-Review

**Mechanism:** Self-check absorbed into `/iago:plan` skill. No separate plan-checker agent.

**Why no plan-checker agent:** GSD's plan-checker is a separate agent that reviews plans in a 3-iteration loop. For a 3-person consultancy, this adds a 2-3 minute overhead per plan for marginal benefit. The planner (orchestrator on Opus) is already the most capable model — having Sonnet review Opus's plan is backwards. Instead, the `/iago:plan` skill includes a mandatory self-review step before writing the plan file.

**Self-review checklist (run by orchestrator before finalizing plan):**

1. **Context coverage:** Does every decision from `context/{phase}.md` have at least one task addressing it?
2. **Placeholder scan:** Search plan text for "TBD", "TODO", "implement later", "similar to", "appropriate", "as needed". Any match = rewrite that task.
3. **File consistency:** Do task `files` fields cover all files listed in the Files table? Are there files in the table not touched by any task?
4. **Verify commands:** Does every task have a runnable `verify` command with `expected` output?
5. **Wave sanity:** Do `depends_on` references point to plans that exist? Are there circular dependencies?
6. **Task count:** Is the plan within `config.planning.max_tasks_per_plan`? If over, split.

---

## Decision 5: Subagent Execution Model

### Dispatch Granularity

**Verdict: Per-plan.** One `implementer` subagent per plan file. The implementer executes all tasks in the plan sequentially.

**Reasoning:**
- Per-task (Superpowers) spawns too many agents. A 4-task plan = 4 context switches + 4 agent spinup costs. Each agent re-reads the same project context. Wasteful.
- Per-plan (GSD) gives the implementer enough context to see how tasks relate within the plan. Task 3 can reference Task 2's output naturally. One spinup, one context load, sequential execution within the plan.
- Wave-based parallelism still works: wave 1 plans execute in parallel (one implementer per plan), wave 2 plans execute after wave 1 completes.

**Review dispatch:** After each plan's implementer completes, the orchestrator dispatches review:
- `review.mode: "single"` → one `code-reviewer` per plan
- `review.mode: "full"` → `spec-reviewer` then `code-quality-reviewer` per plan (Stage 2 only if Stage 1 passes)

### Context Payload

| Agent | Gets | Excluded | Why Excluded |
|-------|------|----------|-------------|
| **implementer** | The specific plan file, `CLAUDE.md`, `.claude/rules/tdd.md`, `.claude/rules/systematic-debugging.md`, `.iago/PROJECT.md`, `.iago/STATE.md` | Other plans, context/ artifacts, conversation history, config.json, ROADMAP.md, prior summaries | Fresh context = only what's needed to build. Context artifacts are pre-digested into the plan. Config is consumed by orchestrator, not implementer. |
| **code-reviewer** | Git diff (`git diff {base_sha}..{head_sha}`), `CLAUDE.md`, the plan file (for intent), `.iago/PROJECT.md` | Source files (reads diff only), conversation history, STATE.md, other plans | Reviewer works from diff, not full codebase. Plan provides intent for judging implementation. |
| **spec-reviewer** | The plan file, `CLAUDE.md`, `.iago/context/{phase}.md`, list of changed files | Git diff, conversation history, STATE.md, other plans | Spec reviewer checks code against spec (context + plan), not against itself. No Bash access — reads files only, can't run tests. |
| **code-quality-reviewer** | Git diff (`git diff {base_sha}..{head_sha}`), `CLAUDE.md`, `.iago/PROJECT.md` | Plan file, context artifacts, conversation history | Quality reviewer judges code quality independent of spec. Doesn't need to know what was planned — just whether the code is well-built. |
| **researcher** | Research question/scope, `CLAUDE.md`, `.iago/PROJECT.md`, `.iago/STATE.md`, codebase access, web access | Plans, summaries, conversation history | Researcher explores broadly. Gets project context but not workflow state. |
| **tdd-guide** (ad-hoc) | Task description, target files, `CLAUDE.md`, `.claude/rules/tdd.md` | Plans, summaries, conversation history, STATE.md | Focused agent — gets just the task and TDD rules. |
| **build-error-resolver** (ad-hoc) | Error output, failing file path, `CLAUDE.md`, `.claude/rules/systematic-debugging.md` | Plans, summaries, conversation history, STATE.md | Focused agent — gets the error and debugging rules. |
| **e2e-runner** (ad-hoc) | Test scope/user flow description, `CLAUDE.md`, `.claude/rules/e2e-testing.md` | Plans, summaries, conversation history, STATE.md | Focused agent — gets scope and E2E conventions. |

**Design principle:** Every agent gets `CLAUDE.md` (project-level guidance) + the minimum artifacts needed for its role. Conversation history is NEVER passed — agents get structured artifacts, not accumulated chat. The orchestrator (Opus, main session) holds the full picture; agents hold focused slices.

### Result Format

**Path:** `.iago/summaries/{NN}-{slug}-{PP}.md` — one summary per plan, written by the orchestrator after collecting the implementer's return.

**Why orchestrator writes, not implementer:** The implementer returns a structured block. The orchestrator writes it to disk, verifying the path matches the plan naming convention. This prevents implementers from writing to wrong paths or malforming the summary.

**Implementer return format** (what the implementer outputs at end of execution):

```markdown
## Status: DONE

### Tasks Completed
| # | Task | Files Changed | Commits |
|---|------|--------------|---------|
| 1 | JWT utility module | src/lib/auth/jwt.ts | abc1234 |
| 2 | Password utility module | src/lib/auth/password.ts | def5678 |
| 3 | Registration endpoint | src/routes/auth/register.ts, src/routes/index.ts | ghi9012 |
| 4 | Login endpoint | src/routes/auth/login.ts | jkl3456 |

### Verification
All verify commands passed. `npx vitest run tests/auth/` — 12 tests, 0 failures.
`npx tsc --noEmit` — clean.

### Deviations
None.

### Concerns
None.
```

**Summary file format** (what the orchestrator writes to `.iago/summaries/`):

```markdown
---
phase: 01-auth
plan: 01
status: done
key_files:
  - src/lib/auth/jwt.ts
  - src/lib/auth/password.ts
  - src/routes/auth/register.ts
  - src/routes/auth/login.ts
commits:
  - abc1234
  - def5678
  - ghi9012
  - jkl3456
---

# Summary: 01-auth-01 — User registration and login endpoints

## Tasks Completed
| # | Task | Files Changed | Commits |
|---|------|--------------|---------|
| 1 | JWT utility module | src/lib/auth/jwt.ts | abc1234 |
| 2 | Password utility module | src/lib/auth/password.ts | def5678 |
| 3 | Registration endpoint | src/routes/auth/register.ts, src/routes/index.ts | ghi9012 |
| 4 | Login endpoint | src/routes/auth/login.ts | jkl3456 |

## Verification
All verify commands passed. `npx vitest run tests/auth/` — 12 tests, 0 failures.

## Deviations
None.

## Review
[Populated by orchestrator after code-reviewer runs]
```

**Escalation protocol statuses** (from DECISION-skills-agents.md):
- `DONE` — all tasks completed, verification passed → orchestrator writes summary, dispatches review
- `DONE_WITH_CONCERNS` — completed but with flagged issues → orchestrator writes summary with concerns section, dispatches review with attention flag
- `NEEDS_CONTEXT` — implementer couldn't proceed → orchestrator provides more context or breaks task smaller, re-dispatches
- `BLOCKED` — implementer cannot proceed at all → orchestrator escalates to human, logs blocker in STATE.md

### Wave Execution

**Verdict: Sequential with wave metadata in plans. Defer parallel execution.**

**What this means:**
- Plans declare `wave` and `depends_on` in frontmatter (the metadata exists from day one).
- `/iago:execute` processes plans sequentially: all wave 1 plans first (one at a time), then wave 2, then wave 3.
- Each plan's implementer runs as a subagent with fresh context.

**Why defer parallel:**
- Parallel execution (multiple implementers on different plans simultaneously) requires git worktree isolation per agent, STATE.md file locking, and post-wave hook validation. This is real engineering effort for a feature we rarely need — most phases have 1-3 plans, and 4-week PoC cycles don't bottleneck on sequential plan execution.
- The wave metadata in plans costs nothing to include now and enables parallel execution later without changing the plan format.
- When we do need parallelism (e.g., a 6-plan phase with 3 independent plans), we can add `isolation: "worktree"` to the agent dispatch and implement STATE.md locking. The plan format already supports it.

**Execution order within a wave:** Plans within the same wave execute in the order they appear (by plan number: `-01`, `-02`, `-03`). No special ordering logic.

---

## Decision 7: Quick/Fast Modes

### Mode Structure

**Verdict: Two tiers (fast + quick).** Different complexity levels need different levels of ceremony.

A developer fixing a typo should not go through plan → execute → verify. A developer adding a small feature with 2-3 tasks should have lightweight planning but not the full roadmap-driven workflow. Two tiers map cleanly to these two situations.

### `/iago:fast` — Inline Trivial Tasks

**Trigger criteria (ALL must be true):**
- <= 3 file edits
- No new dependencies (no package installs)
- Obvious fix (typo, missing import, small bug, style fix)
- You can describe the change in one sentence

**What it does:**
1. Execute the change inline — no subagent, orchestrator does it directly
2. Atomic git commit with conventional prefix
3. Append one-line log entry to STATE.md quick task table

**What it skips:** Everything. No discuss, no plan file, no summary, no verification, no review, no subagent dispatch. The overhead of spawning an agent exceeds the work itself.

**Artifacts created:**
- Git commit (conventional format: `fix(auth): correct typo in login error message`)
- STATE.md quick task log entry: `| 2026-04-01 | fast | fix: typo in login error | abc1234 |`

**Guardrails:**
- If the change requires > 3 file edits → redirect to `/iago:quick`
- If the change requires research or the implementer is unsure → redirect to `/iago:quick`
- No plan file, no summary file — there is no artifact in `.iago/plans/` or `.iago/summaries/`

### `/iago:quick` — Lightweight Planned Tasks

**Trigger criteria:**
- Small focused task with clear scope
- 1-3 tasks (not trivial enough for fast, not complex enough for full workflow)
- No ROADMAP phase — standalone work

**What it does:**
1. *(Optional, `--discuss`)* Brief discussion: 1-2 questions to clarify scope
2. Create a lightweight plan in `.iago/plans/quick-{YYMMDD}-{slug}.md`
3. Dispatch `implementer` subagent with the plan
4. Dispatch `code-reviewer` after implementer completes
5. *(Optional, `--verify`)* Run verification checks
6. Update STATE.md quick task log

**What it skips:**
- No ROADMAP manipulation (quick tasks are standalone, not part of a phase)
- No wave grouping (single plan, sequential tasks)
- No plan self-review loop (the plan is small enough to get right in one pass)
- No context artifact in `.iago/context/` (discussion is ephemeral, captured in plan if `--discuss`)

**Composable flags:**
- `--discuss` — add brief discussion before planning (1-2 targeted questions)
- `--research` — dispatch `researcher` subagent before planning
- `--verify` — run verification after execution

**Artifacts created:**
- `.iago/plans/quick-{YYMMDD}-{slug}.md` — lightweight plan (same format as full plans but simpler)
- `.iago/summaries/quick-{YYMMDD}-{slug}.md` — execution summary
- STATE.md quick task log entry: `| 2026-04-01 | quick | feat: add user avatar upload | def5678 |`
- Git commits from implementer

**Quick plan naming:** `quick-{YYMMDD}-{slug}.md` (e.g., `quick-260401-avatar-upload.md`). No phase prefix — quick tasks aren't phase-bound.

**Subagents used:** `implementer` (always) + `code-reviewer` (always) + `researcher` (if `--research`). Same agents, same escalation protocol, same tool restrictions as full workflow. The only difference is the plan is lighter.

### Mode Selection Guide

```
User request arrives
  │
  ├─ Trivial? (typo, missing import, <=3 files, obvious)
  │   └─► /iago:fast — inline, no plan, no agent
  │
  ├─ Small scope? (1-3 tasks, clear, standalone)
  │   └─► /iago:quick — lightweight plan, implementer agent, review
  │
  └─ Phase-level work? (part of ROADMAP, multiple plans, needs discussion)
      └─► Full workflow: /iago:discuss → /iago:plan → /iago:execute → /iago:verify
```

---

## Dependency Map

```
DECISION-workflow-foundation.md (Phase 2)
  ├── Phase structure ──────────► Plan format respects phase naming ({NN}-{slug})
  ├── State directory ──────────► Plans in .iago/plans/, summaries in .iago/summaries/
  └── config.json ──────────────► max_tasks_per_plan, context_budget_pct, review.mode

DECISION-skills-agents.md (Sprint 3)
  ├── implementer agent ────────► Per-plan dispatch, escalation statuses
  ├── code-reviewer agent ──────► Post-plan review (single mode)
  ├── spec-reviewer agent ──────► Post-plan review (full mode, Stage 1)
  ├── code-quality-reviewer ────► Post-plan review (full mode, Stage 2)
  ├── researcher agent ─────────► Optional research in plan + quick mode
  └── ad-hoc agents ────────────► tdd-guide, build-error-resolver, e2e-runner on context

This document (DECISION-execution)
  ├── Plan format ──────────────► Next: /iago:plan skill implementation
  ├── Dispatch model ───────────► Next: /iago:execute skill implementation
  ├── Result format ────────────► Next: /iago:verify skill reads summaries
  └── Quick/fast modes ─────────► Next: /iago:quick and /iago:fast skill implementations
```
