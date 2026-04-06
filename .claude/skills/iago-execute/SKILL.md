---
name: iago-execute
description: >-
  Use when executing implementation plans for a ROADMAP phase.
  Not when no plans exist for the phase (run /iago:plan first).
---

## Purpose

Execute all plans for a phase by dispatching agents via profiles per plan,
then dispatching review profiles after each plan. Orchestrator stays lean —
agents do the work.

## Preconditions

- `.iago/PROJECT.md` must exist.
- At least one `.iago/plans/{NN}-{slug}-*.md` must exist for the target phase.
  If not, STOP: "No plans found. Run `/iago:plan {slug}` first."
- Base agents (`executor`, `analyst`, `operator`) must exist in `.claude/agents/`.
  Profiles must exist in `.claude/agents/profiles/`.

## Arguments

`/iago:execute {phase-slug}` — execute all plans for the specified phase.

`/iago:execute {phase-slug} --serial` — bypass parallel execution; run all plans sequentially (useful for debugging and CI).

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

### 2b. Select model per plan

Read `.iago/config.json` `routing` section. For each plan, determine the model before dispatch:

1. If the plan specifies `profile:` with a hardcoded model (e.g., `security-audit` → opus), use it.
2. If `routing.default_model` is `"sonnet"` or `"opus"` (not `"auto"`), use that for all plans.
3. Otherwise apply heuristics:
   - Task touches 4+ files → **opus**
   - Task involves `auth`, `payment`, or `data-access` keywords in file paths or action → use `routing.security_critical` model
   - Task is a retry (previous attempt failed) → **opus** if `routing.retry_upgrade` is true
   - Otherwise → **sonnet**
4. For reviews: if `routing.review_matches_impl` is true, use the same model that was used for implementation; otherwise use `routing.default_model`.

Record the resolved model alongside the plan before entering the dispatch loop.

### 3. Execute plans (per-wave, with parallel dispatch)

For each wave:

**Conflict detection (skip if `--serial`):**
1. Collect the file lists from all plans in the wave.
2. Compare file lists across plans — if two or more plans modify the same file, mark them as conflicting and group into a serial subchain.
3. Non-conflicting plans are eligible for parallel dispatch.

**Parallel dispatch (skip if `--serial`):**
4. Batch non-conflicting plans into groups of up to 5.
5. Dispatch each group as concurrent Agent tool calls.
6. Wait for all results in the batch before dispatching the next batch or proceeding to reviews.
7. If any plan in a batch returns BLOCKED, pause remaining undispatched plans in the wave and escalate to the user before continuing.

**Serial fallback:** If `--serial` flag is set, bypass all parallel logic and execute every plan one at a time in plan-number order.

For each plan in the wave (whether dispatched in parallel or serially):

#### 3a. Dispatch agent via profile

Select a profile based on the plan's file paths:
- Files in both `src/` and `amplify/` → `fullstack` profile
- Files only in `src/` → `frontend` profile
- Files only in `amplify/` → `backend` profile
- No clear match → `fullstack` profile (fallback)

If the plan specifies `profile:` explicitly, use that instead.

**PRE-DISPATCH — inject learnings:**
Before composing the final prompt, read:
- `.iago/learnings/patterns.md` — top 10 patterns sorted by occurrence count (cap at 500 tokens)
- `.iago/learnings/project-conventions.md` — project-specific conventions (cap at 300 tokens)

If either file is absent, skip it silently.

Compose the dispatch prompt: read the profile's base agent, read each capability
module listed in the profile, then concatenate in order:
`base agent + capabilities + learnings (patterns then conventions) + plan task + project context`

Use the model resolved in step 2b for this dispatch. Dispatch via the profile's base agent.

Context passed to the agent:
- The plan file
- CLAUDE.md
- rules/tdd.md
- rules/systematic-debugging.md
- .iago/PROJECT.md
- .iago/STATE.md

**Do NOT pass:** other plans, context artifacts, conversation history, config.json.

Wait for the agent to return with a status.

#### 3b. Handle agent response

| Status | Action |
|--------|--------|
| DONE | Proceed to review |
| DONE_WITH_CONCERNS | Log concerns, proceed to review |
| NEEDS_CONTEXT | Provide missing context, re-dispatch |
| BLOCKED | Log to STATE.md blockers, skip plan, continue wave |

#### 3c. Dispatch review

Read `.iago/config.json` for `review.mode`:

**Single mode** (default):
- Dispatch `review-single` profile with: git diff, CLAUDE.md, plan file, PROJECT.md

**Full mode:**
- Dispatch `review-full` profile with: plan file, CLAUDE.md, context artifact, git diff, PROJECT.md
- The `review-full` profile handles gating internally: spec check first, quality check second.
  If the spec check fails, the quality check is skipped and findings are reported.

#### 3d. Handle review response

| Verdict | Action |
|---------|--------|
| approve | Write summary, continue to next plan |
| request-changes | Log findings. If Critical findings: re-dispatch using the same implementation profile with fix instructions. If Important/Minor only: log and continue. |

**POST-REVIEW — extract learnings:**
After handling the review verdict, scan the reviewer's findings for recurring patterns — issues that are not specific to this plan but represent a broader code-quality or convention gap (e.g., "missing error boundaries on feature routes", "inline fetch calls instead of typed API helpers").

For each identified pattern:
1. Open `.iago/learnings/patterns.md` (create if absent).
2. Search for an existing entry matching the pattern.
   - If found: increment its `occurrences` count and update `last_seen` to today's date.
   - If not found: append a new entry with `occurrences: 1`, `first_seen`, and `last_seen` set to today.
3. If any pattern reaches **5+ occurrences**, flag it in the plan summary as a candidate for promotion to `CLAUDE.md`.

#### 3e. Ad-hoc agent dispatch

During execution, dispatch as needed:
- TDD discipline required — re-dispatch using the same profile, ensuring the `tdd` capability is included
- Build/typecheck/lint fails after implementation — dispatch `debug` profile

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
- One agent dispatch per plan — never batch multiple plans into one agent
- Never pass conversation history to agents — fresh context only
- If all plans in a wave are BLOCKED, stop execution and escalate to user
- Critical review findings on the same plan more than twice → STOP, escalate
