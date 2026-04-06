---
name: iago-plan
description: >-
  Use when breaking a ROADMAP phase into implementation plans with tasks.
  Not when .iago/ROADMAP.md doesn't exist or the phase hasn't been discussed yet.
---

## Purpose

Break a ROADMAP phase into one or more implementation plans, each with 2-8 concrete
tasks. Every task has exact file paths, a specific action, a verify command, and
expected output. No placeholders.

## Preconditions

- `.iago/PROJECT.md` must exist. If not, STOP: "Run `/iago:init` first."
- `.iago/ROADMAP.md` must exist and contain the target phase.
- `.iago/context/{NN}-{slug}.md` should exist (soft gate). If missing, warn:
  "No context artifact for this phase. Run `/iago:discuss {slug}` first, or continue without it."

## Arguments

`/iago:plan {phase-slug}` — plan the specified phase.

Optional flags:
- `--research` — dispatch `researcher` agent to investigate codebase before planning

If no phase-slug provided, read ROADMAP.md and suggest the next `pending` or `active` phase.

## Steps

### 1. Load context

Read:
- `.iago/PROJECT.md` — vision, constraints, stack, architecture decisions
- `.iago/ROADMAP.md` — phase goal and success criteria
- `.iago/context/{NN}-{slug}.md` — decisions from discuss phase (if exists)
- `.iago/STATE.md` — current position, blockers
- `.iago/config.json` — `planning.max_tasks_per_plan` (default: 8)

### 2. Optional research

If `--research` flag is set, dispatch the `researcher` agent:
- Question: "Scan the codebase for existing implementations related to {phase goal}.
  Report: relevant files, patterns in use, dependencies, potential conflicts."
- Use findings to inform plan structure.

### 3. Decompose into plans

Break the phase into plans. Each plan is a coherent unit of work:
- 2-8 tasks per plan (from `config.planning.max_tasks_per_plan`)
- If more than 8 tasks needed, split into multiple plans
- Assign wave numbers: wave 1 = no dependencies, wave 2+ = depends on earlier plans
- Declare `depends_on` for cross-plan dependencies

### 4. Write each task

For every task in every plan:

- **files:** Exact file paths (1-3 per task)
- **action:** Specific instruction a fresh-context agent can execute. Max 3 sentences. No placeholders.
- **verify:** Exact shell command to confirm the task is done
- **expected:** What the verify command produces when correct

### 5. Self-review (mandatory)

Before writing plan files, check:

| Check | Action if Failed |
|-------|-----------------|
| Context coverage — every discuss decision is addressed | Add missing tasks |
| Placeholder scan — no "TBD", "TODO", "implement later", "similar to Task N" | Replace with specifics |
| File consistency — files in tasks match files in plan header | Fix mismatches |
| Verify commands — every task has a runnable verify command | Add missing commands |
| Wave sanity — wave 1 plans have no `depends_on` | Fix wave assignments |
| Task count — no plan exceeds `max_tasks_per_plan` | Split the plan |

### 6. Write plan files

Write each plan to `.iago/plans/{NN}-{slug}-{PP}.md` using this format:

```markdown
---
phase: {NN}-{slug}
plan: {PP}
wave: {N}
depends_on: [{plan IDs or empty}]
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
- **action:** {Specific implementation instruction. ≤3 sentences.}
- **verify:** `{exact shell command}`
- **expected:** {What the verify command produces when correct}

## Verification

{After all tasks: aggregate verify command + expected result.}
```

### 7. Update STATE.md

Update via state engine:
- Phase: `{NN}-{slug}` | Status: `planning`
- Log: "{N} plans created for phase {NN}-{slug}"

## Output

After completion, display:
1. Plan count and wave structure
2. Task count per plan
3. Any concerns from self-review
4. Suggest: "Run `/iago:execute {phase-slug}` to begin implementation."

## Boundaries

- Never implement code — plans only
- Never modify ROADMAP.md scope
- If the phase is too large to plan (>4 plans, >24 tasks), recommend splitting in ROADMAP.md
- Plans must be executable by a fresh-context agent (via executor profile) with no additional context
