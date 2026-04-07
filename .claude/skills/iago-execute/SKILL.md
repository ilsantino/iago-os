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

`/iago:execute {phase-slug} --n8n` — dispatch plans to the n8n cross-session pipeline instead of in-session agents. Each plan runs in a fresh Claude Code session with clean context. Requires n8n setup (see `n8n/README.md`).

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

### 1b. Check for --n8n dispatch

If `--n8n` flag is set:

1. Read `.iago/config.json` for `automation.n8n_webhook_url`. If not set, STOP:
   "n8n webhook URL not configured. Add `automation.n8n_webhook_url` to `.iago/config.json` or see `n8n/README.md` for setup."
2. For each plan, construct webhook payload:
   `{ "phase": "{slug}", "plan_path": "{plan_file}", "project_dir": "{cwd}" }`
3. POST each payload to the webhook URL (use WebFetch or curl).
4. Report: "Dispatched {N} plans to n8n pipeline. Monitor progress in the n8n dashboard."
5. Update STATE.md: Status → `executing (n8n)`
6. STOP — do not proceed to in-session dispatch. n8n handles everything from here.

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
5. Dispatch each group as concurrent Agent tool calls with `isolation: "worktree"`. Each agent gets its own git worktree — an isolated copy of the repo. This prevents file conflicts and merge races between parallel agents.
6. Wait for all results in the batch before dispatching the next batch or proceeding to reviews.
7. If any plan in a batch returns BLOCKED, pause remaining undispatched plans in the wave and escalate to the user before continuing.
8. After all agents in a batch return, merge worktree changes back to the main branch. If merge conflicts occur (shouldn't with proper conflict detection), escalate to the user.

**Serial fallback:** If `--serial` flag is set, bypass all parallel logic and execute every plan one at a time in plan-number order.

For each plan in the wave (whether dispatched in parallel or serially):

#### 3a. Sync with remote before branching

Before creating a branch or starting work on any plan:

```bash
git checkout main && git pull origin main
```

Then create the plan branch from the appropriate base:
- If the plan depends on a previous plan's branch, rebase that branch onto the updated main first.
- If the plan has no dependencies, branch directly from main.

This prevents drift from remote changes made by other collaborators.

#### 3b. Dispatch agent via profile

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

#### 3c. Handle agent response

| Status | Action |
|--------|--------|
| DONE | Proceed to review |
| DONE_WITH_CONCERNS | Log concerns, proceed to review |
| NEEDS_CONTEXT | Provide missing context, re-dispatch |
| BLOCKED | Log to STATE.md blockers, skip plan, continue wave |

#### 3d. Build gate

Run verification commands immediately after implementation — before dispatching
any review agents. This catches trivial errors in seconds instead of wasting an
agent dispatch.

```bash
npm run type-check && npm run build   # tsc --noEmit + vite build
```

| Result | Action |
|--------|--------|
| Pass | Proceed to review (3e) |
| Fail | Dispatch `debug` profile with build output. After fix, re-run build gate. Max 2 retries — after that, STOP and escalate. |

The build gate is non-negotiable. No code enters review until it compiles.

#### 3e. Parallel review dispatch

Dispatch **both** review stages simultaneously. They are independent checks —
spec compliance and code quality do not depend on each other.

Read `.iago/config.json` for `review.mode`:

**Single mode** (default):
- Dispatch `review-single` profile with: git diff, CLAUDE.md, plan file, PROJECT.md

**Full mode** (recommended for client projects):
- Dispatch the `review-full` profile, which handles spec compliance (Stage 1) and quality review (Stage 2) with internal gating — if Stage 1 finds Critical issues, Stage 2 is skipped.
- Context: plan file, CLAUDE.md, context artifact, git diff, PROJECT.md

#### 3f. Handle review findings (merged)

Merge findings from both reviewers into a single list. Deduplicate overlapping
findings. Categorize by severity: Critical > Important > Minor.

| Verdict | Action |
|---------|--------|
| Both approve | Proceed to Codex gate (3g) |
| Important/Minor only | Log findings, proceed to Codex gate (3g) |
| Any Critical findings | Re-dispatch implementation profile with ALL critical fix instructions (from both reviewers). After fix → back to build gate (3d). Max 2 fix rounds — after that, STOP and escalate. |

**POST-REVIEW — extract learnings:**
After handling the merged review verdict, scan findings for recurring patterns —
issues not specific to this plan but representing a broader convention gap
(e.g., "missing error boundaries", "inline fetch calls instead of typed API helpers").

For each identified pattern:
1. Open `.iago/learnings/patterns.md` (create if absent).
2. Search for an existing entry matching the pattern.
   - If found: increment its `occurrences` count and update `last_seen` to today.
   - If not found: append a new entry with `occurrences: 1`, `first_seen`, and `last_seen` set to today.
3. If any pattern reaches **5+ occurrences**, flag it in the plan summary as a candidate for promotion to `CLAUDE.md`.

#### 3g. Codex adversarial review gate (mandatory)

Dispatch `/codex:adversarial-review` (GPT-5.4 cross-model review) on every plan.
A different model catches different blind spots — this is non-negotiable.

The review targets: auth bypass, data loss, race conditions, rollback safety,
business logic errors, and state management issues.

| Codex Verdict | Action |
|---------------|--------|
| Pass | Proceed to PR (3g) |
| Findings | Log findings. Critical → re-dispatch implementation profile with fix instructions → back to build gate (3d). Non-critical → log and proceed. |

#### 3h. Push branch and create PR

After all reviews pass:

1. Stage and commit changes with conventional commit message:
   `feat({phase}): {plan description}`
2. Push branch to remote with `-u` flag.
3. Create PR via `gh pr create` with:
   - Title: conventional commit format
   - Body: summary of tasks completed, files changed, review findings resolved
4. Log PR URL in the plan summary.
5. **Do NOT merge.** The user reviews on GitHub and merges manually.

Branch naming: `feat/{phase-slug}/{plan-number}-{plan-name}`
Example: `feat/stripe-connect-ticketing/01-dynamo-schema`

#### 3i. Ad-hoc agent dispatch

During execution, dispatch as needed:
- TDD discipline required — re-dispatch using the same profile, ensuring the `tdd` capability is included
- Unexpected runtime errors — dispatch `debug` profile with error output

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
- Display summary: plans completed, total tasks, total findings, PRs created
- List all open PRs with URLs for user review
- Suggest: "Review the PRs on GitHub, then run `/iago:verify {phase-slug}` to verify the phase."

## Boundaries

- Orchestrator does NOT implement code — agents do
- Orchestrator does NOT review code — agents do
- One agent dispatch per plan — never batch multiple plans into one agent
- Never pass conversation history to agents — fresh context only
- If all plans in a wave are BLOCKED, stop execution and escalate to user
- Critical review findings on the same plan more than twice → STOP, escalate
- Build gate is mandatory — no code enters review without passing tsc + build
- PRs are never auto-merged — user reviews on GitHub and merges manually
