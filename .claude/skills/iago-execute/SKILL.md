---
name: iago-execute
description: >-
  Use when executing implementation plans for a ROADMAP phase.
  Not when no plans exist for the phase (run /iago:plan first).
---

## Purpose

Execute all plans for a phase by dispatching `implementer` agents per plan,
then dispatching review agents after each plan. Orchestrator stays lean —
agents do the work.

## Preconditions

- `.iago/PROJECT.md` must exist.
- At least one `.iago/plans/{NN}-{slug}-*.md` must exist for the target phase.
  If not, STOP: "No plans found. Run `/iago:plan {slug}` first."
- All agents referenced below must exist in `.claude/agents/`:
  `implementer`, `code-reviewer`, `spec-reviewer`, `code-quality-reviewer`,
  `tdd-guide`, `build-error-resolver`

## Arguments

`/iago:execute {phase-slug}` — execute all plans for the specified phase.

If no phase-slug provided, read STATE.md for the current active phase.

## Steps

### 1. Load plans and analyze waves

Read all `.iago/plans/{NN}-{slug}-*.md` files for the target phase.
Sort by wave number, then by plan number within each wave.

```
Wave 1: plans with no dependencies → execute first
Wave 2: plans depending on wave 1 → execute after wave 1 completes
Wave N: continue sequentially
```

### 2. Update STATE.md

Update via state engine:
- Phase: `{NN}-{slug}` | Status: `executing`
- Task: "Executing wave 1 of {N}"

### 3. Execute plans (per-wave, sequential)

For each wave, for each plan in the wave:

#### 3a. Dispatch implementer

Dispatch the `implementer` agent with this context:
- The plan file
- CLAUDE.md
- rules/tdd.md
- rules/systematic-debugging.md
- .iago/PROJECT.md
- .iago/STATE.md

**Do NOT pass:** other plans, context artifacts, conversation history, config.json.

Wait for the agent to return with a status.

#### 3b. Handle implementer response

| Status | Action |
|--------|--------|
| DONE | Proceed to review |
| DONE_WITH_CONCERNS | Log concerns, proceed to review |
| NEEDS_CONTEXT | Provide missing context, re-dispatch |
| BLOCKED | Log to STATE.md blockers, skip plan, continue wave |

#### 3c. Dispatch review

Read `.iago/config.json` for `review.mode`:

**Single mode** (default):
- Dispatch `code-reviewer` with: git diff, CLAUDE.md, plan file, PROJECT.md

**Full mode:**
- Stage 1: Dispatch `spec-reviewer` with: plan file, CLAUDE.md, context artifact, changed file list
- If Stage 1 passes → Stage 2: Dispatch `code-quality-reviewer` with: git diff, CLAUDE.md, PROJECT.md
- If Stage 1 fails → skip Stage 2, report findings

#### 3d. Handle review response

| Verdict | Action |
|---------|--------|
| approve | Write summary, continue to next plan |
| request-changes | Log findings. If Critical findings: re-dispatch implementer with fix instructions. If Important/Minor only: log and continue. |

#### 3e. Ad-hoc agent dispatch

During execution, dispatch these agents as needed:
- `tdd-guide` — when a task requires strict TDD discipline
- `build-error-resolver` — when build/typecheck/lint fails after implementation

### 4. Write summary per plan

After each plan completes (implemented + reviewed), write `.iago/summaries/{NN}-{slug}-{PP}.md`:

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

{Aggregate verify result from plan.}

## Deviations

{Any divergence from plan, or "None."}

## Review

{Review findings summary. Severity counts. Verdict.}
```

### 5. Update STATE.md after each plan

Log completion:
- Decision: "Plan {PP} complete — {task count} tasks, {finding count} review findings"

### 6. Phase completion

After all plans in all waves complete:
- Update STATE.md: Status → `executed`
- Display summary: plans completed, total tasks, total findings
- Suggest: "Run `/iago:verify {phase-slug}` to verify the phase."

## Boundaries

- Orchestrator does NOT implement code — agents do
- Orchestrator does NOT review code — agents do
- One implementer per plan — never batch multiple plans into one agent
- Never pass conversation history to agents — fresh context only
- If all plans in a wave are BLOCKED, stop execution and escalate to user
- Critical review findings on the same plan more than twice → STOP, escalate
