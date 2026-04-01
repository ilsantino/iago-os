# GSD Analysis

## Overview

**Get Shit Done (GSD)** is a meta-prompting, context engineering, and spec-driven development framework for AI coding agents. Version 1.30.0, MIT licensed, created by TACHES. It supports Claude Code, OpenCode, Gemini CLI, Codex, Copilot, Cursor, Windsurf, and Antigravity.

**Philosophy:** "The complexity is in the system, not in your workflow." GSD targets solo developers and small teams who want Claude Code to reliably produce correct software without enterprise ceremony. The system externalizes all planning state to `.planning/` as human-readable Markdown + JSON, spawns specialized subagents with fresh context windows to avoid context rot, and enforces a discuss-plan-execute-verify pipeline per phase.

**Structure:**
- `commands/gsd/*.md` — 44 user-facing slash commands (YAML frontmatter + prompt body)
- `get-shit-done/workflows/*.md` — 46 orchestration workflows (the real logic)
- `agents/*.md` — 16 specialized agent definitions
- `get-shit-done/references/*.md` — 13+ shared knowledge documents
- `get-shit-done/templates/` — Markdown templates for all planning artifacts
- `get-shit-done/bin/gsd-tools.cjs` + `bin/lib/*.cjs` — 17 Node.js CLI modules for state, config, phase, roadmap, verification
- `hooks/` — 5 runtime hooks (statusline, context monitor, update checker, prompt guard, workflow guard)
- `sdk/` — TypeScript SDK for headless/programmatic use

**Maturity:** Production-grade. Extensive test suite (vitest), i18n (5 languages), multi-runtime support, security scanning (prompt injection, base64, secrets), lockfile-based STATE.md mutual exclusion for parallel agents, and a robust installer (~3,000 lines) with platform handling for Windows, WSL, Docker/CI.

---

## Workflow Phases — Exact Breakdown

| Phase | What Happens | Key Files | Enforcement Mechanism |
|-------|-------------|-----------|----------------------|
| **new-project** | Questions -> 4x parallel researchers -> synthesizer -> requirements -> roadmapper -> user approval -> STATE.md init | `workflows/new-project.md`, `agents/gsd-project-researcher.md`, `agents/gsd-roadmapper.md` | Must run before any phase commands; `project_exists` check blocks re-init |
| **discuss-phase** | Identify gray areas, let user choose which to discuss, deep-dive each, produce CONTEXT.md | `workflows/discuss-phase.md`, `templates/context.md` | Soft gate: `plan-phase` warns if no CONTEXT.md exists, offers to run discuss first |
| **ui-phase** | Design contract for frontend phases, produces UI-SPEC.md | `workflows/ui-phase.md`, `templates/UI-SPEC.md` | Optional; executor reads UI-SPEC.md if present |
| **plan-phase** | Research (optional) -> Planner -> Plan-Checker loop (max 3 iterations) -> PLAN.md files | `workflows/plan-phase.md`, `agents/gsd-phase-researcher.md`, `agents/gsd-planner.md`, `agents/gsd-plan-checker.md` | Plan-checker enforces 8 verification dimensions; blocks proceed if plans fail |
| **execute-phase** | Wave analysis -> parallel/sequential executor spawning -> atomic commits -> SUMMARY.md per plan -> regression gate -> verification | `workflows/execute-phase.md`, `agents/gsd-executor.md`, `workflows/execute-plan.md` | Plans grouped by dependency waves; SUMMARY.md existence gates completion |
| **verify-work** | Goal-backward verification: truths, artifacts (3-level check), wiring, requirements coverage, anti-pattern scan -> VERIFICATION.md | `workflows/verify-phase.md`, `agents/gsd-verifier.md`, `templates/verification-report.md` | Status determines routing: `passed` -> done, `gaps_found` -> gap closure cycle, `human_needed` -> UAT |
| **ship** | Create PR from phase branch | `workflows/ship.md` | Optional; requires branching_strategy to be set |
| **transition** (internal) | Mark phase complete, evolve PROJECT.md, advance STATE.md, route to next phase | `workflows/transition.md` | Internal only — never exposed as `/gsd:transition`; triggered by execute-phase auto-advance or manually |

### Phase Ordering Enforcement

GSD does **not** hard-block phase ordering with code gates. Instead, enforcement is layered:

1. **Soft gates in plan-phase:** If no CONTEXT.md exists (discuss wasn't run), `plan-phase` shows a warning and offers to run discuss-phase first or continue without context. This is an AskUserQuestion prompt, not a code block.
   ```
   Source: get-shit-done/workflows/plan-phase.md, step 4 "Load CONTEXT.md"
   ```

2. **Artifact dependency:** Each phase produces artifacts consumed by the next:
   - `discuss-phase` -> CONTEXT.md -> read by `plan-phase` researcher and planner
   - `plan-phase` -> PLAN.md files -> required by `execute-phase`
   - `execute-phase` -> SUMMARY.md files -> required by verify-phase and transition

3. **Init validation:** Each workflow calls `gsd-tools.cjs init <workflow>` which checks preconditions (e.g., `execute-phase` checks `plan_count > 0`, `plan-phase` checks `planning_exists`).

4. **Auto-advance chain:** With `--auto` flag or `workflow.auto_advance: true`, GSD chains: discuss -> plan -> execute -> verify -> transition automatically. The chain flag `workflow._auto_chain_active` propagates between commands.
   ```
   Source: get-shit-done/workflows/execute-phase.md, step "offer_next"
   ```

### Discuss Phase — Deep Dive

The discuss phase is the most philosophically distinctive part of GSD. Key design choices:

- **User = visionary, Claude = builder.** Claude asks about vision and preferences, never about implementation.
- **Scope guardrail:** Phase boundary from ROADMAP.md is FIXED. Discussion clarifies HOW, never WHETHER to add new capabilities. Scope creep suggestions are captured in a "Deferred Ideas" section.
- **Gray area identification is domain-aware:** Not generic categories but concrete decisions:
  - Something users SEE -> layout, density, interactions
  - Something users CALL -> responses, errors, auth
  - Something users RUN -> output format, flags, modes
- **Prior context loading:** Reads all prior CONTEXT.md files to avoid re-asking decided questions.
- **Codebase scouting:** Lightweight grep scan (~10% context) to inform gray areas.

```
Source: get-shit-done/workflows/discuss-phase.md
```

### Plan-Phase — Verification Loop

The planner-checker loop is capped at 3 iterations. The plan-checker enforces 8 verification dimensions (the 8th being Nyquist validation — automated test mapping). Plans must have:
- `must_haves` frontmatter: `truths`, `artifacts`, `key_links`
- Task-level `files`, `action`, `verify`, `done` fields
- Wave/dependency metadata
- Requirement ID traceability

```
Source: get-shit-done/workflows/plan-phase.md, agents/gsd-plan-checker.md
```

---

## Task Sizing Discipline

GSD addresses context window limits through multiple mechanisms, but does **not** have a single explicit "max task size" threshold. Instead:

### 1. Granularity-Aware Summary Templates

Three summary templates scale with project complexity:
- `summary-minimal.md` — Lean: performance, accomplishments, commits, files (for simple phases)
- `summary-standard.md` — Full template with dependency graph frontmatter, deviation documentation
- `summary-complex.md` — Extended for multi-plan phases

The `granularity` config key (`minimal`, `standard`, `complex`) selects which template agents use.

```
Source: get-shit-done/templates/summary-minimal.md, summary-standard.md, summary-complex.md
```

### 2. Context Budget Targets in Quick Mode

Quick tasks explicitly target context consumption:
- Standard quick: `~30% context usage (simple, focused)`
- Full quick: `~40% context usage (structured for verification)`
- Quick tasks limited to `1-3 focused tasks`

```
Source: get-shit-done/workflows/quick.md, step 5 <constraints>
```

### 3. Orchestrator Leanness

The execute-phase orchestrator is explicitly designed to stay at ~10-15% context for 200K windows:
> "Pass paths only — executors read files themselves with their fresh context window. For 200k models, this keeps orchestrator context lean (~10-15%)."

For 1M+ models (Opus 4.6, Sonnet 4.6), richer context can be passed directly.

```
Source: get-shit-done/workflows/execute-phase.md, <context_efficiency>
```

### 4. STATE.md Size Constraint

STATE.md is explicitly capped at ~100 lines:
> "Keep STATE.md under 100 lines. It's a DIGEST, not an archive. If accumulated context grows too large: keep only 3-5 recent decisions in summary (full log in PROJECT.md), keep only active blockers, remove resolved ones."

```
Source: get-shit-done/templates/state.md, <size_constraint>
```

### 5. Analysis Paralysis Guard

Executors have a built-in stuck detector:
> "During task execution, if you make 5+ consecutive Read/Grep/Glob calls without any Edit/Write/Bash action: STOP."

And a fix attempt limit: after 3 auto-fix attempts on a single task, stop fixing and move on.

```
Source: agents/gsd-executor.md, <analysis_paralysis_guard>
```

---

## Fresh-Context Execution Pattern

This is GSD's core architectural innovation. Every agent gets a clean context window.

### How Subagents Are Spawned

The orchestrator (workflow .md) spawns agents via `Task()`:

```
Task(
  subagent_type="gsd-executor",
  model="{executor_model}",
  isolation="worktree",
  prompt="<objective>...</objective>
    <execution_context>
    @~/.claude/get-shit-done/workflows/execute-plan.md
    @~/.claude/get-shit-done/templates/summary.md
    @~/.claude/get-shit-done/references/checkpoints.md
    </execution_context>
    <files_to_read>
    - {phase_dir}/{plan_file} (Plan)
    - .planning/PROJECT.md
    - .planning/STATE.md
    - .planning/config.json
    - ./CLAUDE.md
    </files_to_read>"
)
```

Key: `isolation="worktree"` gives each executor a separate git worktree for parallel execution without conflicts.

```
Source: get-shit-done/workflows/execute-phase.md, step "execute_waves"
```

### What Context Agents Get

Each agent type receives a tailored context payload:

| Agent | Gets | Does NOT Get |
|-------|------|-------------|
| **Executor** | Specific PLAN.md, PROJECT.md, STATE.md, config.json, CLAUDE.md, workflow reference files | Other plans, conversation history, orchestrator state, RESEARCH.md |
| **Researcher** | CONTEXT.md (user decisions), REQUIREMENTS.md, STATE.md, phase description | Plans, summaries, conversation history |
| **Planner** | RESEARCH.md, CONTEXT.md, REQUIREMENTS.md, STATE.md, ROADMAP.md | Conversation history, other phase plans |
| **Verifier** | Phase goal from ROADMAP.md, PLAN.md files (for must_haves), SUMMARY.md files | Research, context, conversation history |

### What Is Deliberately Excluded

- **Conversation history** — The entire point. Agents get structured artifacts, not accumulated chat.
- **Other phases' plans** — Agents see only their assigned work.
- **Orchestrator internal state** — Agents don't know about wave grouping, other running agents, etc.
- **Intermediate reasoning** — If a researcher discovered something, it's in RESEARCH.md. The raw discovery process is gone.

### How Results Come Back

1. **File-based:** Agents write artifacts to disk (SUMMARY.md, VERIFICATION.md, RESEARCH.md)
2. **Git-based:** Agents make atomic commits; orchestrator verifies via `git log`
3. **Structured return:** Agents return a structured markdown block (e.g., `## PLAN COMPLETE` with task table, commit hashes, duration)
4. **Spot-check fallback:** If a spawned agent doesn't return a completion signal (Copilot, unreliable runtimes), the orchestrator verifies via:
   ```bash
   test -f "{phase_dir}/{plan_number}-SUMMARY.md"
   git log --oneline --all --grep="{phase_number}-{plan_padded}" --since="1 hour ago"
   ```

```
Source: get-shit-done/workflows/execute-phase.md, step 3 "Wait for all agents"
```

### Wave Execution Model

Plans are grouped into dependency waves:
```
Wave 1: Plans with no deps (parallel)
Wave 2: Plans depending on Wave 1 (parallel after Wave 1 completes)
Wave 3: Plans depending on Wave 2 (parallel after Wave 2 completes)
```

Within a wave, agents run in parallel (if `parallelization.enabled: true`). Between waves, execution is sequential. Parallel commit safety uses:
1. `--no-verify` commits (skip pre-commit hooks during parallel execution)
2. Post-wave hook validation (orchestrator runs hooks once after wave completes)
3. STATE.md file locking (`O_EXCL` atomic lock file with 10s stale timeout and spin-wait with jitter)

```
Source: docs/ARCHITECTURE.md, "Wave Execution Model"
```

---

## Compaction Strategy

GSD does not have a single "compaction" command. Instead, it manages context through multiple mechanisms:

### Context Monitor Hook

`gsd-context-monitor.js` (PostToolUse/AfterTool hook) injects warnings into the agent's conversation:

| Remaining Context | Level | Agent Message |
|-------------------|-------|---------------|
| > 35% | Normal | No warning |
| <= 35% | WARNING | "Context is getting limited. Avoid starting new complex work." |
| <= 25% | CRITICAL | "Context nearly exhausted. Inform the user so they can run /gsd:pause-work." |

Debounce: 5 tool uses between warnings. Severity escalation bypasses debounce.

The hook reads metrics from a bridge file written by the statusline hook:
```json
{
  "session_id": "abc123",
  "remaining_percentage": 28.5,
  "used_pct": 71,
  "timestamp": 1708200000
}
```

Bridge file location: `/tmp/claude-ctx-{session_id}.json`

```
Source: hooks/gsd-context-monitor.js, docs/context-monitor.md
```

### Pause-Work / Resume-Work Pattern

When context runs low, `/gsd:pause-work` creates:
1. **`.planning/HANDOFF.json`** — Machine-readable state (phase, plan, task numbers, completed tasks with commit hashes, remaining tasks, blockers, human actions pending, decisions, uncommitted files, next action)
2. **`.planning/phases/XX-name/.continue-here.md`** — Human-readable handoff with XML-tagged sections: `<current_state>`, `<completed_work>`, `<remaining_work>`, `<decisions_made>`, `<blockers>`, `<context>`, `<next_action>`

Both are committed as WIP. `/gsd:resume-work` reads these to restore context.

**The `.continue-here.md` file is deleted after resume** — it's not permanent storage.

```
Source: get-shit-done/workflows/pause-work.md, get-shit-done/templates/continue-here.md
```

### What Is Preserved vs Discarded

**Preserved across context resets (`/clear`):**
- All `.planning/` files (STATE.md, PROJECT.md, ROADMAP.md, REQUIREMENTS.md, config.json)
- Phase artifacts (CONTEXT.md, RESEARCH.md, PLAN.md, SUMMARY.md, VERIFICATION.md)
- Git history (atomic commits per task)
- HANDOFF.json and .continue-here.md (if pause-work was run)

**Discarded on context reset:**
- All conversation history
- Orchestrator internal state (wave tracking, intermediate reasoning)
- Agent internal state (they have fresh contexts anyway)

### Recovery Patterns

1. **Re-run is idempotent:** `execute-phase` discovers completed SUMMARYs -> skips them -> resumes from first incomplete plan.
2. **STATE.md tracks position:** Phase number, plan number, status, last activity — enough to reconstruct "where we are."
3. **`/gsd:progress`** reads STATE.md and ROADMAP.md to present current status.
4. **`/gsd:resume-work`** reads HANDOFF.json for machine-parseable restore.

### The `/clear` Recommendation

GSD frequently suggests `/clear` before starting a new phase:
```
/gsd:plan-phase {next}

<sub>`/clear` first -> fresh context window</sub>
```

This is a manual compaction — discard everything and rely on file-based state. With 1M+ context windows, GSD notes this can be relaxed:
> "Relaxing /clear recommendations — context rot onset is much further out with 5x window"

```
Source: get-shit-done/workflows/execute-phase.md, <context_efficiency>
```

---

## Quick-Task Pattern

GSD has **two** quick-task modes:

### `/gsd:quick` — Lightweight Planned Execution

**How it works:**
1. Parse arguments for `--discuss`, `--research`, `--full` flags
2. Initialize via `gsd-tools.cjs init quick`
3. Create task directory at `.planning/quick/YYMMDD-xxx-slug/`
4. (Optional) Discussion phase: identify 2-4 gray areas, max 2 questions per area
5. (Optional) Research phase: single focused researcher (not 4 parallel like full phases)
6. Spawn planner in quick mode: single plan with 1-3 focused tasks
7. (Optional, `--full`) Plan-checker loop (max 2 iterations)
8. Spawn executor with plan reference
9. (Optional, `--full`) Verification by gsd-verifier
10. Update STATE.md quick tasks table
11. Commit all artifacts

**When it bypasses full planning:**
- Always: No ROADMAP.md phase manipulation, no multi-plan waves, no regression gates
- Default mode: No plan checking, no verification (just plan + execute)
- `--full` mode: Adds plan checking (2 iterations) and verification

**Guardrails:**
- Requires active project (ROADMAP.md must exist)
- Quick ID format: `YYMMDD-xxx` (date + Base36 precision)
- Context budget: ~30% (standard) or ~40% (full)
- Single plan, 1-3 tasks
- Does NOT update ROADMAP.md (separate from planned phases)

**Flags are composable:** `--discuss --research --full` gives discussion + research + plan-checking + verification.

```
Source: get-shit-done/workflows/quick.md
```

### `/gsd:fast` — Inline Trivial Tasks

**How it works:**
1. Parse task description
2. Scope check: trivial = <= 3 file edits, <= 1 minute, no new deps, no research
3. Execute inline (no subagent spawning, no PLAN.md)
4. Atomic commit with conventional format
5. Log to STATE.md quick tasks table (if it exists)

**Guardrails:**
- NEVER spawns a Task/subagent
- NEVER creates PLAN.md or SUMMARY.md
- If task takes more than 3 file edits, redirects to `/gsd:quick`
- If unsure how to implement, redirects to `/gsd:quick`

```
Source: get-shit-done/workflows/fast.md
```

### `/gsd:do` — Intent-Based Dispatcher

Takes freeform text, matches intent to the best GSD command, and dispatches:
- Bug/error -> `/gsd:debug`
- Complex task -> `/gsd:add-phase`
- Small actionable task -> `/gsd:quick`
- Research -> `/gsd:research-phase`
- etc.

Never does work itself — pure routing.

```
Source: get-shit-done/workflows/do.md
```

---

## State Externalization

### Every File GSD Creates

#### Project-Level (`.planning/`)

| File | Format | Purpose | Created By |
|------|--------|---------|------------|
| `PROJECT.md` | Markdown | Vision, constraints, decisions, evolution rules | `new-project` |
| `REQUIREMENTS.md` | Markdown with checkbox lists | Scoped requirements (v1/v2/out-of-scope), traceability table | `new-project` |
| `ROADMAP.md` | Markdown with phase table | Phase breakdown, goals, success criteria, progress tracking | `new-project` via roadmapper |
| `STATE.md` | Markdown (< 100 lines) | Living memory: position, decisions, blockers, metrics, session continuity | `new-project`, updated by every workflow |
| `config.json` | JSON | Workflow config: mode, granularity, gates, parallelization, hooks, agent skills | `new-project` settings step |
| `MILESTONES.md` | Markdown | Archive of completed milestones | `complete-milestone` |
| `HANDOFF.json` | JSON | Machine-readable pause state | `pause-work` |
| `continue-here.md` | Markdown (per phase) | Human-readable pause state (deleted after resume) | `pause-work` |

#### Research (`.planning/research/`)

| File | Created By |
|------|-----------|
| `SUMMARY.md` | `gsd-research-synthesizer` |
| `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` | 4x parallel `gsd-project-researcher` |

#### Codebase Maps (`.planning/codebase/`)

| File | Created By |
|------|-----------|
| `STACK.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, `CONCERNS.md`, `STRUCTURE.md`, `TESTING.md`, `INTEGRATIONS.md` | `map-codebase` via 4x parallel `gsd-codebase-mapper` |

#### Per-Phase (`.planning/phases/XX-phase-name/`)

| File | Format | Created By |
|------|--------|------------|
| `XX-CONTEXT.md` | Markdown with XML sections (`<domain>`, `<decisions>`, `<canonical_refs>`, `<specifics>`, `<deferred>`) | `discuss-phase` |
| `XX-RESEARCH.md` | Markdown | `plan-phase` researcher |
| `XX-YY-PLAN.md` | Markdown with YAML frontmatter (phase, plan, type, wave, depends_on, autonomous, requirements, must_haves) | `plan-phase` planner |
| `XX-YY-SUMMARY.md` | Markdown with YAML frontmatter (dependency graph, tech-stack, key-files, metrics) | executor |
| `XX-VERIFICATION.md` | Markdown with status frontmatter | verifier |
| `XX-VALIDATION.md` | Markdown | Nyquist auditor (test coverage mapping) |
| `XX-UI-SPEC.md` | Markdown | `ui-phase` |
| `XX-UI-REVIEW.md` | Markdown | `ui-review` |
| `XX-UAT.md` | Markdown with YAML frontmatter | `verify-work` / execute-phase human verification |
| `XX-HUMAN-UAT.md` | Markdown with YAML frontmatter | execute-phase (human_needed verification) |
| `.continue-here.md` | Markdown | `pause-work` (transient) |

#### Quick Tasks (`.planning/quick/YYMMDD-xxx-slug/`)

| File | Created By |
|------|-----------|
| `{id}-PLAN.md` | quick planner |
| `{id}-SUMMARY.md` | quick executor |
| `{id}-CONTEXT.md` | quick discuss (optional) |
| `{id}-RESEARCH.md` | quick researcher (optional) |
| `{id}-VERIFICATION.md` | quick verifier (optional, `--full`) |

#### Other State Directories

| Path | Purpose |
|------|---------|
| `.planning/todos/pending/`, `.planning/todos/done/` | Captured ideas and completed todos |
| `.planning/threads/` | Persistent context threads (from `/gsd:thread`) |
| `.planning/seeds/` | Forward-looking ideas (from `/gsd:plant-seed`) |
| `.planning/debug/`, `.planning/debug/resolved/` | Active and resolved debug sessions |
| `.planning/debug/knowledge-base.md` | Persistent debug learnings |
| `.planning/ui-reviews/` | Screenshots (gitignored) |

### How Files Interconnect

```
PROJECT.md ──────────────────────────────────────────► All agents (vision, constraints)
REQUIREMENTS.md ─────────────────────────────────────► Planner, Verifier, Auditor
ROADMAP.md ──────────────────────────────────────────► Orchestrators (phase goals, progress)
STATE.md ────────────────────────────────────────────► All agents (position, decisions, blockers)
config.json ─────────────────────────────────────────► All workflows (feature flags, model profiles)

CONTEXT.md (per phase) ──────────────────────────────► Researcher, Planner, Executor
RESEARCH.md (per phase) ─────────────────────────────► Planner, Plan Checker
PLAN.md (per plan) ──────────────────────────────────► Executor, Plan Checker, Verifier
SUMMARY.md (per plan) ───────────────────────────────► Verifier, Transition, STATE.md updates
VERIFICATION.md ─────────────────────────────────────► Gap closure cycle (plan-phase --gaps)
UI-SPEC.md ──────────────────────────────────────────► Executor, UI Auditor
```

The dependency graph in SUMMARY.md frontmatter (`requires`, `provides`, `affects`) creates explicit links between phases, enabling transitive closure for context selection in future planning.

---

## Patterns to Steal (Ranked)

### 1. Fresh-Context Subagent Architecture
**Source:** `docs/ARCHITECTURE.md`, `get-shit-done/workflows/execute-phase.md`
**Why it matters:** This is the single most valuable pattern. By giving each agent a clean 200K context window with only the artifacts it needs, GSD eliminates context rot entirely. The orchestrator stays lean (~10-15% context) and delegates heavy work. For iaGO-OS, this means we can run complex consulting deliverables without degradation — each phase of an engagement gets a fresh agent.

### 2. File-Based State Externalization
**Source:** `get-shit-done/templates/state.md`, `.planning/` directory structure
**Why it matters:** All state in human-readable Markdown + JSON. No database, no server. State survives `/clear`, is inspectable by humans, and can be committed to git. For iaGO-OS, this means client project state persists across sessions, is auditable, and can be shared with team members via git.

### 3. Context Monitor Hook with Bridge File
**Source:** `hooks/gsd-context-monitor.js`, `docs/context-monitor.md`
**Why it matters:** The statusline writes metrics to a temp file, the PostToolUse hook reads them and injects warnings into the agent conversation. This makes the AI *aware* of its own context limits. Critical for consulting work where context-heavy client projects could silently degrade. The thresholds (35% warning, 25% critical) and debounce logic are directly reusable.

### 4. Discuss-Phase Philosophy (User = Visionary, Claude = Builder)
**Source:** `get-shit-done/workflows/discuss-phase.md`
**Why it matters:** The gray area identification pattern (domain-aware heuristics, scope guardrails, prior decision loading) is excellent for consulting discovery. For iaGO-OS, this maps directly to client requirements gathering — surface the decisions the client cares about, capture them in structured CONTEXT.md, and never ask about implementation details.

### 5. Plan-Checker Verification Loop
**Source:** `get-shit-done/workflows/plan-phase.md`, `agents/gsd-plan-checker.md`
**Why it matters:** Plans are verified before execution with a max-3-iteration correction loop. The 8 verification dimensions (including Nyquist test coverage mapping) catch issues before expensive execution. For consulting, this prevents delivering plans with gaps — critical when client trust is at stake.

### 6. Wave-Based Parallel Execution with Dependency Grouping
**Source:** `get-shit-done/workflows/execute-phase.md`, step "discover_and_group_plans"
**Why it matters:** Plans declare dependencies, get grouped into waves, and waves execute in parallel. STATE.md file locking prevents race conditions. For iaGO-OS with AWS infra, this maps to parallel CDK stack deployments with dependency ordering.

### 7. Goal-Backward Verification (Task Completion != Goal Achievement)
**Source:** `get-shit-done/workflows/verify-phase.md`
**Why it matters:** The three-level verification (truths -> artifacts -> wiring) catches the common failure mode where tasks are "done" but the feature doesn't work. For consulting, this prevents delivering "complete" work that doesn't actually meet the client's goal.

### 8. Quick/Fast Task Tiering
**Source:** `get-shit-done/workflows/quick.md`, `get-shit-done/workflows/fast.md`
**Why it matters:** Two tiers of ad-hoc work: `/gsd:fast` for trivial inline fixes (no subagent), `/gsd:quick` for small planned tasks (with optional discuss/research/verify). Composable flags. For iaGO-OS, this prevents the overhead of full phase ceremony for small client requests.

### 9. Pause-Work / Resume-Work with Structured Handoff
**Source:** `get-shit-done/workflows/pause-work.md`
**Why it matters:** HANDOFF.json (machine-readable) + .continue-here.md (human-readable) capture complete state for session resumption. For consulting, this enables picking up client work across days without context loss.

### 10. Deviation Rules (Auto-fix Hierarchy)
**Source:** `agents/gsd-executor.md`, `<deviation_rules>`
**Why it matters:** Executors have clear rules for when to auto-fix (bugs, missing critical functionality, blocking issues) vs when to ask (architectural changes). 3-attempt limit prevents infinite fix loops. For iaGO-OS, this prevents runaway agents while still allowing autonomous bug fixing.

### 11. Config System with "Absent = Enabled"
**Source:** `get-shit-done/templates/config.json`, `docs/ARCHITECTURE.md`
**Why it matters:** Feature flags default to enabled. Users explicitly disable features. The config covers mode (interactive/yolo/custom), granularity, parallelization, gates, safety, hooks, and agent skills. For iaGO-OS, a similar config system enables per-client workflow customization.

### 12. Model Profile Tiering
**Source:** `get-shit-done/references/model-profiles.md`
**Why it matters:** Quality/balanced/budget/inherit profiles control which model each agent type uses. Opus for planning (architecture decisions), Sonnet for execution (follows instructions), Haiku for read-only work. For iaGO-OS, this maps to cost optimization per engagement type.

---

## Modularity Analysis

**Mixed — core workflow is coupled, utilities are independent:**

1. **Workflow files are tightly coupled.** `discuss-phase.md` → `plan-phase.md` → `execute-phase.md` → `verify-phase.md` form a pipeline where each reads the previous phase's artifacts. You can't take `execute-phase.md` without the plan structure it expects. However, each phase's *philosophy* is independently extractable as a pattern.

2. **Agent definitions are standalone.** Each agent in `agents/*.md` is self-contained with its own prompt, constraints, and output format. `gsd-executor.md` can be studied independently of `gsd-planner.md`.

3. **Templates are independent.** `templates/state.md`, `templates/config.json`, `templates/summary-*.md` are standalone templates. Each can be adapted without taking others.

4. **`gsd-tools.cjs` is coupled.** The 17 CLI modules in `bin/lib/` form an interconnected state management layer. Taking one (e.g., `phase.cjs`) requires understanding others (`state.cjs`, `config.cjs`). Extract patterns, not code.

5. **Hooks are standalone.** `gsd-context-monitor.js`, `gsd-statusline-hook.js`, `gsd-prompt-guard.js` — each is self-contained. The context monitor depends on a bridge file from the statusline hook, but this is a loose file-based coupling.

6. **Quick/Fast task modes are self-contained.** `workflows/quick.md` and `workflows/fast.md` can be understood and adapted independently of the full phase workflow.

**Extractable independently:** Hooks, agent definitions, templates, quick/fast patterns, discuss-phase philosophy, plan-checker verification dimensions, wave execution model
**Extract as patterns (not code):** Phase pipeline philosophy, STATE.md structure, config system, pause/resume handoff
**Tightly coupled:** gsd-tools.cjs modules, workflow phase chain, SDK

---

## Comparison vs ECC / Ruflo / The Architect / Superpowers

| Dimension | GSD | ECC | Ruflo | The Architect | Superpowers |
|-----------|-----|-----|-------|--------------|-------------|
| **Primary purpose** | Spec-driven multi-phase development | Hook-based workflow automation | Context lifecycle, archiving | Design-phase planning | Development methodology via skills |
| **Workflow model** | **Most comprehensive.** discuss → plan → execute → verify with gates, artifacts, and auto-advance | No workflow model (operational hooks only) | No workflow model (context management only) | 4-phase conversational (discovery → deep dive → architecture → generate) | brainstorm → write-plans → subagent-dev → finish-branch |
| **State externalization** | **Best in class.** `.planning/` with 20+ artifact types, STATE.md, PROJECT.md, ROADMAP.md, config.json | Session files only | Context archives only | Blueprint output only | Specs + plans in `docs/superpowers/` |
| **Subagent execution** | Fresh-context with wave-based parallelism, dependency ordering, worktree isolation — **most sophisticated** | No subagent system | No subagent system | No subagents | Fresh subagent per task with two-stage review |
| **Plan verification** | Plan-checker loop (max 3 iterations) with 8 verification dimensions — **unique** | No planning | No planning | No plan verification | Self-review checklist |
| **Task sizing** | Context budget targets (30-40%), orchestrator leanness (10-15%), STATE.md cap (100 lines) | No task sizing | No task sizing | Build order (10-15 numbered steps) | 2-5 minute task granularity |
| **Context management** | Context monitor hook + bridge file + /clear recommendations | suggest-compact + strategic-compact | **Superior** — proactive archiving + importance scoring | Lazy-loading knowledge | Not addressed |
| **Quick tasks** | Fast (inline, 3 files max) + Quick (planned, 1-3 tasks) — **unique two-tier system** | Not present | Not present | Fast-track mode (3 questions) | Not present |
| **Pause/resume** | HANDOFF.json + .continue-here.md — **unique structured handoff** | Session persistence trio | Context archives | Not applicable | Not applicable |

**GSD's unique contributions not found elsewhere:**
1. Full-lifecycle state externalization (`.planning/` with 20+ artifact types) — most comprehensive
2. Wave-based parallel execution with dependency grouping — no other repo does this
3. Plan-checker verification loop with 8 dimensions — no other repo verifies plans before execution
4. Two-tier quick task system (fast + quick) — no other repo tiers ad-hoc work
5. Pause/resume with structured handoff (HANDOFF.json + .continue-here.md) — unique
6. Context monitor with bridge file architecture — Ruflo has better context management but GSD's approach is simpler
7. Discuss-phase philosophy (user = visionary, Claude = builder, scope guardrails) — most structured intake process

---

## Adaptation Notes

### 1. Consulting-Specific Phase Structure
GSD's phases are generic software development (discuss -> plan -> execute -> verify). iaGO-OS needs consulting-specific phases: **discover** (client requirements), **assess** (current state), **design** (solution architecture), **implement** (build), **validate** (client acceptance), **handover** (documentation + training). The discuss-phase philosophy maps well to discover, but we need additional phases for assessment and handover.

### 2. Multi-Client State Isolation
GSD uses a single `.planning/` directory per project. iaGO-OS needs per-client state isolation within a single workspace. GSD's workspace feature (v1.20+, `--ws` flag) is nascent — it allows multiple workstreams within a milestone but isn't designed for multi-client isolation. We need a higher-level abstraction: client -> engagement -> milestone -> phase.

### 3. AWS Stack Integration
GSD is stack-agnostic. iaGO-OS needs deep AWS integration: CDK deployments as execution targets, CloudFormation drift detection as verification, Cost Explorer as metrics. The wave execution model maps well to CDK stack dependency ordering, but we need AWS-specific verification patterns (health checks, canary deployments, rollback triggers).

### 4. Node.js Hooks Only
GSD's hooks are already pure Node.js (`hooks/*.js`), which is perfect. The hook architecture (PostToolUse events, stdin JSON parsing, stdout hookSpecificOutput, bridge files in /tmp) is directly reusable. We should keep this pattern exactly.

### 5. Lean Team Considerations
GSD targets solo developers. iaGO-OS targets a small consulting team (2-5 people). We need:
- **Shared state:** Git-based state is good, but we need merge conflict resolution for STATE.md when multiple team members work on the same client.
- **Role-based access:** Client CONTEXT.md may contain sensitive information. GSD's open Markdown approach needs a layer of access control.
- **Client-facing artifacts:** GSD's SUMMARY.md and VERIFICATION.md are developer-facing. We need client-facing reports derived from the same state.

### 6. Cost Tracking
GSD tracks execution time metrics in STATE.md but not token/API costs. For consulting, we need per-client cost tracking — which models were used, how many tokens consumed, estimated API spend. The model profile system gives us the hooks; we need to add cost aggregation.

### 7. Simpler Configuration
GSD's config.json has 44+ options across mode, granularity, workflow, planning, parallelization, gates, safety, hooks, and agent_skills. For iaGO-OS, we should start with a much simpler config (3-5 options) and add complexity only when needed. The "absent = enabled" default pattern is good.

### 8. No Prompt Injection Scanning (Lower Priority)
GSD includes prompt injection detection in `.planning/` writes (`gsd-prompt-guard.js`) and a security module (`security.cjs`) with path traversal prevention and shell argument validation. For iaGO-OS, this is lower priority since we control the pipeline end-to-end, but the patterns are worth noting for when we expose anything to client input.

### 9. SDK for Programmatic Access
GSD has a TypeScript SDK (`sdk/`) for headless autonomous execution — `cli-transport.ts`, `ws-transport.ts`, `phase-runner.ts`, `session-runner.ts`. For iaGO-OS, we could use this to build a web dashboard or API layer, but it's a later concern. The SDK's `context-engine.ts` (context window management) and `prompt-builder.ts` (structured prompt assembly) are worth studying.
