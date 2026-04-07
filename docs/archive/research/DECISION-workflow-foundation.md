# Workflow Foundation Decisions

> Phase 2 of Workflow Engine — Lifecycle Foundation
> Date: 2026-04-01
> Depends on: workflow-synthesis.md (Phase 1 extraction), DECISION-hooks.md, DECISION-skills-agents.md

---

## Decision 1: Phase Structure

### Final Phase Table

| # | Phase | Skill | What It Does | Output Artifact | Input Gate | Driver |
|---|-------|-------|-------------|-----------------|------------|--------|
| 0 | **init** | `/iago:init` | Bootstrap `.iago/` directory, gather project vision + requirements, produce PROJECT.md + ROADMAP.md + STATE.md + config.json. Interactive discovery: 3-5 questions about scope, stack, client, timeline. | `PROJECT.md`, `ROADMAP.md`, `STATE.md`, `config.json` | None (entry point). Blocks if `.iago/PROJECT.md` already exists. | Human interactive (orchestrator-direct). Optional: dispatch `researcher` for codebase scan on existing projects. |
| 1 | **discuss** | `/iago:discuss` | Clarify gray areas for a specific ROADMAP phase. User = visionary, Claude = builder. Surface 3-5 decisions the user must make. Scope is FIXED from ROADMAP.md — clarifies HOW, never adds capabilities. Loads prior context to avoid re-asking. | `.iago/context/{phase}.md` | `ROADMAP.md` must exist. Phase must be listed in ROADMAP. | Human interactive (orchestrator-direct). |
| 2 | **plan** | `/iago:plan` | Break phase into implementation plans with 2-8 tasks each. Each task: exact file paths, action, verify command, expected output. No placeholders. Self-review for spec coverage + placeholder scan. Plans declare dependencies for wave ordering. | `.iago/plans/{phase}-{nn}.md` (one or more plan files) | `context/{phase}.md` must exist (soft gate — warns if missing, offers to run discuss). | Orchestrator-direct. Researcher subagent dispatched if `--research` flag. |
| 3 | **execute** | `/iago:execute` | Wave analysis on plans. Dispatch fresh-context `implementer` subagent per plan. Atomic commits per task. `code-reviewer` after each plan (or `spec-reviewer` → `code-quality-reviewer` if `review.mode: "full"`). Orchestrator stays lean. | `.iago/summaries/{phase}-{nn}.md` per plan, git commits | At least one `plans/{phase}-*.md` must exist. | `implementer` subagent per plan + `code-reviewer` (or two-stage review). Ad-hoc: `tdd-guide`, `build-error-resolver` dispatched on context. |
| 4 | **verify** | `/iago:verify` | Goal-backward verification against ROADMAP phase goals. Check: truths hold, artifacts exist and work, wiring between components correct, requirements covered. Produce verification report. If passed, create PR (ship). | `.iago/reviews/{phase}.md` with status: `passed` / `gaps_found` / `human_needed` | All plan summaries for the phase must exist. | Orchestrator-direct (reads summaries + runs verification checks). Ships PR if `passed`. |

### Quick/Fast Bypass Modes

| Mode | Skill | Trigger | What It Does | What It Skips |
|------|-------|---------|-------------|---------------|
| **fast** | `/iago:fast` | Trivial task: <= 3 file edits, no new deps, obvious fix | Execute inline. Atomic commit. Log to STATE.md. | Everything: no discuss, no plan, no summary, no verification, no subagent. |
| **quick** | `/iago:quick` | Small focused task: 1-3 tasks, clear scope | Lightweight plan → execute → optional verify. Composable flags: `--discuss`, `--research`, `--verify`. | No ROADMAP manipulation. No wave grouping. Single plan only. No plan-checker loop. |

### Phase Decisions

**init vs discuss — Verdict: Merge scaffolding + initial discovery into init. Keep discuss as per-phase clarification.**

GSD separates `new-project` (scaffolding + research + roadmapping) from `discuss-phase` (per-phase gray areas). The Architect merges discovery + deep-dive into its first two phases. For a 3-person consultancy doing 4-week PoC cycles, the split makes sense but differently: `init` does the one-time project setup (scaffolding + vision + roadmap), which includes enough discovery to produce a useful ROADMAP. `discuss` then runs per-phase to clarify specifics before planning. You never re-run init; you run discuss once per phase.

**UI phase — Verdict: Skip. Fold into discuss + execute.**

Our stack is fixed: React 19 + TailwindCSS 4 + ShadCN. UI design decisions (layout, components, interactions) surface naturally during discuss ("What does the dashboard show?") and get implemented during execute with ShadCN patterns. A dedicated UI-SPEC adds ceremony without value when the component library is already chosen. If a project needs UI exploration, `/brainstorming` skill handles it within discuss.

**ship phase — Verdict: Fold into verify.**

Creating a PR is a 30-second action, not a phase. When verify passes, the orchestrator creates the PR as the final step. Separating "verify it works" from "ship it" creates an unnecessary pause. GSD separates them because it has branching strategy config; we just create a PR.

**transition — Verdict: Skip as explicit phase. Automatic STATE.md update.**

GSD's transition marks phase complete, evolves PROJECT.md, advances STATE.md. For us, this is 3 lines of state update that happens automatically when verify passes. Not worth a named phase or command. The orchestrator updates STATE.md inline: mark phase done, note completion time, suggest next phase.

**architecture phase — Verdict: Skip as separate phase. Subsume into init + plan.**

The Architect's dedicated architecture phase makes sense when designing greenfield projects with unfamiliar stacks. Our stack is fixed (React 19 + Vite + TS + AWS). Architecture decisions that matter (data model, API design, auth flow) happen during init (PROJECT.md captures high-level architecture) and plan (plans specify exact file structure and patterns). For projects genuinely needing architectural exploration, `/brainstorming` + `/deep-research` skills can be invoked during discuss or plan. No phase ceremony needed.

### Phase Flow Diagram

```
                                    ┌─────────────────────────────────────────────┐
                                    │              QUICK MODE                     │
                                    │  /iago:quick [--discuss] [--research]       │
                                    │     [--verify]                              │
                                    │                                             │
                                    │  plan(lite) ──► execute ──► verify(opt)     │
                                    └─────────────────────────────────────────────┘

                                    ┌─────────────────────────────────────────────┐
                                    │              FAST MODE                      │
                                    │  /iago:fast "fix the typo in header"       │
                                    │                                             │
                                    │  inline execute ──► commit ──► done         │
                                    └─────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════════

                              FULL WORKFLOW (per-phase cycle)

  /iago:init                 /iago:discuss              /iago:plan
  ┌────────────┐             ┌────────────┐             ┌────────────────┐
  │   INIT     │             │  DISCUSS   │             │     PLAN       │
  │            │             │            │             │                │
  │ 3-5 Qs    │  PROJECT.md │ Gray areas │ CONTEXT.md  │ Research(opt)  │
  │ Vision    ├────────────►│ Decisions  ├────────────►│ Tasks + verify │
  │ Roadmap   │  ROADMAP.md │ Scope lock │             │ Wave deps      │
  │ Config    │  STATE.md   │            │             │ Self-review    │
  │           │  config.json│            │             │                │
  └────────────┘             └────────────┘             └───────┬────────┘
                                                                │
       Agents: researcher                                 PLAN.md files
       (optional, codebase                                (1+ per phase)
        scan on existing                                        │
        projects)                                               │
                                                                ▼
  /iago:verify               /iago:execute
  ┌────────────────┐         ┌──────────────────────────────────┐
  │    VERIFY      │         │           EXECUTE                │
  │                │         │                                  │
  │ Goal-backward  │ SUMMARY │ Wave 1: independent plans (||)  │
  │ Truths check  ◄─────────┤ Wave 2: dependent plans (||)     │
  │ Artifact check │  .md    │ Wave 3: ...                      │
  │ Wiring check   │ files   │                                  │
  │                │         │ Per plan:                         │
  │ Status:        │         │   implementer ──► code-reviewer  │
  │  passed ──► PR │         │   (or spec-reviewer ──►          │
  │  gaps ──► plan │         │    code-quality-reviewer)        │
  │  human ──► UAT │         │                                  │
  └────────────────┘         │ Ad-hoc: tdd-guide,               │
                             │   build-error-resolver            │
                             └──────────────────────────────────┘

  ════════════════════════════════════════════════════════════════
  Gate flow:
  init ──[PROJECT.md]──► discuss ──[CONTEXT.md]──► plan ──[PLAN.md]──►
  execute ──[SUMMARY.md]──► verify ──[VERIFICATION.md]──► done / re-plan

  After verify passes:
    STATE.md updated (phase marked done)
    PR created
    Orchestrator suggests next ROADMAP phase
```

---

## Decision 2: State Directory (.iago/)

### Complete File Manifest

| File/Dir | Purpose | Format | Created By | Read By | Size Constraint | Git Status |
|----------|---------|--------|-----------|---------|----------------|------------|
| `PROJECT.md` | Project vision, constraints, stack, key architectural decisions. Evolves over project lifetime. | Markdown | `/iago:init` | All phases, all agents | None | Tracked |
| `ROADMAP.md` | Phase breakdown with goals, success criteria, progress status. Each row = one phase with status (pending/active/done). | Markdown table | `/iago:init` | Orchestrator, discuss, verify | None | Tracked |
| `STATE.md` | Living position digest: current phase, active plan, recent decisions (3-5), active blockers, quick task log. | Markdown | `/iago:init`, updated by every phase | All agents (position context) | **< 80 lines.** Digest, not archive. Decisions overflow to PROJECT.md. | Tracked |
| `config.json` | Workflow configuration (see Decision 3) | JSON | `/iago:init` | All phases | 9 fields | Tracked |
| **`context/`** | | | | | | |
| `context/{NN}-{slug}.md` | Discussion artifacts per phase. Gray areas, decisions, domain context, deferred ideas. | Markdown with sections: Domain, Decisions, References, Specifics, Deferred | `/iago:discuss` | Plan (planner reads context), execute (executor reads if needed) | None | Tracked |
| **`plans/`** | | | | | | |
| `plans/{NN}-{slug}-{PP}.md` | Implementation plan. YAML frontmatter (wave, depends_on, requirements) + task list with files/action/verify/done. | Markdown + YAML frontmatter | `/iago:plan` | Execute (implementer reads assigned plan), verify (reads must_haves) | Max 8 tasks per plan | Tracked |
| **`summaries/`** | | | | | | |
| `summaries/{NN}-{slug}-{PP}.md` | Execution summary per plan. What was done, files changed, commits, deviations, metrics. | Markdown + YAML frontmatter (key_files, commits, metrics) | Execute phase (`implementer` subagent) | Verify (reads all summaries for phase), STATE.md updates | None | Tracked |
| **`reviews/`** | | | | | | |
| `reviews/{NN}-{slug}.md` | Verification report per phase. Status (passed/gaps_found/human_needed), truths checked, artifacts verified, wiring confirmed, gaps list. | Markdown + status in frontmatter | `/iago:verify` | Orchestrator (routing: pass/gaps/human), gap closure re-planning | None | Tracked |
| **`hooks/`** | (Already decided — DECISION-hooks.md) | | | | | |
| `hooks/lib/stdin.mjs` | Parse stdin JSON from Claude Code | ESM | Build phase | All hooks | ~20 lines | Tracked |
| `hooks/lib/flags.mjs` | Per-hook disable via env var | ESM | Build phase | All hooks | ~15 lines | Tracked |
| `hooks/lib/transcript.mjs` | Read transcript JSONL, extract usage | ESM | Build phase | statusline, context-persistence | ~80 lines | Tracked |
| `hooks/statusline.mjs` | Statusline: branch, ctx%, client, duration | ESM | Build phase | Statusline event | ~90 lines | Tracked |
| `hooks/context-persistence.mjs` | Session start/compact/stop lifecycle | ESM | Build phase | SessionStart, PreCompact, Stop | ~280 lines | Tracked |
| `hooks/context-monitor.mjs` | Context usage warnings | ESM | Build phase | PostToolUse (all) | ~60 lines | Tracked |
| `hooks/post-edit-format.mjs` | Biome format on edit | ESM | Build phase | PostToolUse (Edit) | ~50 lines | Tracked |
| `hooks/post-edit-typecheck.mjs` | tsc --noEmit on edit | ESM | Build phase | PostToolUse (Edit) | ~80 lines | Tracked |
| `hooks/post-edit-console-warn.mjs` | console.log detection | ESM | Build phase | PostToolUse (Edit) | ~45 lines | Tracked |
| `hooks/config-protection.mjs` | Block edits to config files | ESM | Build phase | PreToolUse (Edit/Write) | ~100 lines | Tracked |
| `hooks/safety-guard.mjs` | Destructive cmds, secrets, injection | ESM | Build phase | PreToolUse (Bash/Edit/Write) | ~180 lines | Tracked |
| `hooks/commit-quality.mjs` | Conventional commits, staged secrets | ESM | Build phase | PreToolUse (Bash on git commit) | ~120 lines | Tracked |
| **`state/`** | (Already decided — DECISION-hooks.md. ALL gitignored.) | | | | | |
| `state/sessions/{id}.json` | Session snapshots | JSON | context-persistence.mjs | SessionStart (loads latest) | Keep last 10 | Gitignored |
| `state/bridge-ctx.json` | Context % bridge for monitor | JSON | statusline.mjs | context-monitor.mjs | 1 file, overwritten | Gitignored |
| `state/active-client.json` | Current client/project slug | JSON | `/iago:init` or manual | statusline, cost tracking | 1 file | Gitignored |
| `state/costs.jsonl` | Per-session utilization log | JSONL (append-only) | context-persistence.mjs stop | Reporting | Append-only | Gitignored |
| `state/HANDOFF.json` | Pause state for resume | JSON | `/iago:pause` | SessionStart hook (loads + deletes) | 1 file, transient | Gitignored |
| **`research/`** | Research artifacts (current sprint docs) | Markdown | Research phases | Planning, reference | None | Tracked |

### Directory Tree

```
.iago/
  PROJECT.md
  ROADMAP.md
  STATE.md
  config.json
  .gitignore                 # Ignores state/ only

  context/                   # Discussion artifacts (git tracked)
    01-auth.md
    02-dashboard.md

  plans/                     # Implementation plans (git tracked)
    01-auth-01.md
    01-auth-02.md
    02-dashboard-01.md

  summaries/                 # Execution summaries (git tracked)
    01-auth-01.md
    01-auth-02.md
    02-dashboard-01.md

  reviews/                   # Verification reports (git tracked)
    01-auth.md
    02-dashboard.md

  hooks/                     # Hook files (git tracked)
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

  state/                     # Runtime state (gitignored)
    sessions/
    bridge-ctx.json
    active-client.json
    costs.jsonl
    HANDOFF.json

  research/                  # Research artifacts (git tracked)
```

### Naming Convention

Phase artifacts use a `{NN}-{slug}` prefix where:
- `NN` = two-digit phase number from ROADMAP.md (01, 02, 03...)
- `slug` = kebab-case short name (auth, dashboard, api-layer)
- Plans add `-{PP}` suffix for plan number within phase (01, 02)

Examples:
- `context/01-auth.md` — discussion for phase 1 (auth)
- `plans/01-auth-01.md` — first plan for phase 1
- `plans/01-auth-02.md` — second plan for phase 1
- `summaries/01-auth-01.md` — execution summary for plan 01 of phase 1
- `reviews/01-auth.md` — verification report for phase 1

### .gitignore for .iago/

```gitignore
# Runtime state — session-specific, machine-specific
state/
```

Everything else is tracked. Plans, context, summaries, reviews, hooks, config, research — all versioned and shareable via git.

---

## Decision 3: config.json Schema

### Convention: Explicit Defaults

**Verdict:** Explicit defaults, not "absent = enabled."

GSD's "absent = enabled" convention is clever for power users who know the system. For a 3-person team, explicit defaults are clearer — you open config.json and see exactly what's configured. No mental inversion ("this field is missing, which means it's on"). Every field has a value.

### Exact Schema

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

### Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `project.name` | string | (required) | Project name. Used in STATE.md headers, commit scope, PR titles. Kebab-case. |
| `project.client` | string | `"internal"` | Client slug. Used in cost tracking (`costs.jsonl`), statusline display, session snapshots. Set to `"internal"` for non-client work. |
| `project.type` | enum | `"saas"` | Project type: `"saas"`, `"automation"`, `"pipeline"`, `"mvp"`, `"agent"`, `"api"`. Informs skill suggestions and default patterns during planning. Not a hard constraint — just context. |
| `workflow.skip_discuss` | boolean | `false` | When `true`, `/iago:plan` skips the "no CONTEXT.md" warning and proceeds without discussion artifacts. For repeat patterns or tiny phases where requirements are already obvious. |
| `workflow.auto_verify` | boolean | `true` | When `true`, verification runs automatically after execute completes (no manual `/iago:verify` needed). When `false`, user must explicitly invoke verify. Default `true` because skipping verification is the #1 agent failure mode. |
| `workflow.auto_advance` | boolean | `false` | When `true`, phases chain automatically: discuss → plan → execute → verify without pausing for user input between phases. For autonomous execution of well-understood work. Default `false` because consultancy work typically needs human checkpoints. |
| `planning.max_tasks_per_plan` | integer | `8` | Maximum tasks per plan file. Plans exceeding this are split into multiple plan files with dependency metadata. Keeps subagent context focused. Range: 3-15. |
| `planning.context_budget_pct` | integer | `40` | Target context budget percentage per subagent task. Quick tasks target this percentage to avoid context exhaustion. Range: 20-60. |
| `review.mode` | enum | `"single"` | Review mode after execution. `"single"`: dispatch `code-reviewer` for one-pass severity review (Critical/Important/Minor). `"full"`: dispatch `spec-reviewer` (Stage 1: spec compliance) then `code-quality-reviewer` (Stage 2: quality, only if Stage 1 passes). Default `"single"` for speed; use `"full"` for production-critical code. |

### Schema Validation Rules

1. `project.name` is the only required field. All others have defaults.
2. `project.type` values are advisory, not exhaustive. Unknown types are accepted (just won't trigger type-specific suggestions).
3. `planning.max_tasks_per_plan` clamped to 3-15. Below 3 = too fragmented. Above 15 = context risk.
4. `planning.context_budget_pct` clamped to 20-60. Below 20 = too tight for useful work. Above 60 = risk of context exhaustion.
5. `review.mode` invalid values fall back to `"single"`.

### config.json in Context

- **Created by:** `/iago:init` (interactive — asks project name, client, type; uses defaults for workflow/planning/review)
- **Read by:** All workflow phases (plan reads `planning.*`, execute reads `review.mode`, discuss checks `workflow.skip_discuss`)
- **Modified by:** User directly (it's a simple JSON file) or via future `/iago:config` command
- **Protected by:** `config-protection.mjs` hook (DECISION-hooks.md §3) — blocks unauthorized agent edits

---

## Dependency Map

```
DECISION-hooks.md (Phase 2-3)
  ├── hooks/ directory structure ────────► .iago/hooks/ (this document references, doesn't redefine)
  ├── state/ directory structure ─────────► .iago/state/ (this document references, doesn't redefine)
  └── session persistence model ─────────► Pause/resume via HANDOFF.json in state/

DECISION-skills-agents.md (Sprint 3)
  ├── 8 agent definitions ───────────────► Execute phase dispatches implementer, code-reviewer, etc.
  ├── Escalation protocol ───────────────► DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED
  ├── Tool restrictions per agent ────────► Execute phase respects tool matrix
  └── Dispatch model ────────────────────► subagent-driven-development skill orchestrates

This document (DECISION-workflow-foundation)
  ├── Phase structure ───────────────────► Next: DECISION-workflow-skills.md (skill definitions for each phase)
  ├── State directory ───────────────────► Next: DECISION-workflow-skills.md (skills read/write these files)
  └── config.json ───────────────────────► Next: DECISION-workflow-skills.md (skills check config)
```
