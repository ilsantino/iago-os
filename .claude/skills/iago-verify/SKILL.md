---
name: iago-verify
description: >-
  Use when verifying a completed ROADMAP phase against its goals and success criteria.
  Not when plan summaries don't exist for the phase (run /iago:execute first).
---

## Purpose

Goal-backward verification: check that the phase achieved what ROADMAP.md promised.
Produce a verification report. If passed, create a PR and advance to the next phase.

## Preconditions

- `.iago/PROJECT.md` must exist.
- `.iago/ROADMAP.md` must exist with the target phase.
- All plan summaries for the phase must exist in `.iago/summaries/`.
  If missing, STOP: "Not all plans have been executed. Run `/iago:execute {slug}` first."

## Arguments

`/iago:verify {phase-slug}`

If no phase-slug provided, read STATE.md for the current phase (should be status `executed`).

## Steps

### 1. Load phase context

Read:
- `.iago/ROADMAP.md` — phase goal and success criteria
- `.iago/summaries/{NN}-{slug}-*.md` — all plan summaries for this phase
- `.iago/PROJECT.md` — constraints, architecture decisions
- `.iago/context/{NN}-{slug}.md` — decisions from discuss phase (if exists)

### 2. Goal-backward checks

For each success criterion in ROADMAP.md, verify it was met:

| Check Type | How to Verify |
|-----------|---------------|
| Tests pass | Run `npx vitest run` — read output |
| Build succeeds | Run `npx tsc --noEmit` — read output |
| Lint clean | Run `npx biome check` — read output |
| File/component exists | `ls` or `Glob` for the expected path |
| Endpoint works | `curl` or describe the expected behavior |
| Feature behavior | Trace through code, confirm logic matches requirement |

**Do not assert outcomes — demonstrate them.** Run the command, read the output, report what you see.

### 3. Artifact verification

For each expected output (files, endpoints, components):
- Does it exist?
- Does it work (tests pass, builds clean, renders correctly)?

### 4. Wiring verification

Check connections between components:
- API routes → Lambda handlers → DynamoDB operations
- React components → TanStack Query hooks → API calls
- Auth flow → Cognito → API Gateway authorizer
- Forms → Zod validation → mutation → optimistic update

### 5. Gap analysis

Identify anything that:
- Was in the plan but not in the summaries
- Was in the context decisions but not implemented
- Passes locally but has obvious deployment concerns

### 6. Write verification report

Write `.iago/reviews/{NN}-{slug}.md`:

```markdown
---
phase: {NN}-{slug}
status: passed | gaps_found | human_needed
verified: {YYYY-MM-DD}
---

# Verification: {NN}-{slug} — {phase name}

## Phase Goal

> {Goal from ROADMAP.md}

## Checks

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | {success criterion} | pass/fail | {command output or observation} |

## Artifact Verification

| # | Artifact | Exists | Works | Notes |
|---|----------|--------|-------|-------|
| 1 | {file or endpoint} | yes/no | yes/no | {details} |

## Wiring

| # | Connection | Status | Notes |
|---|-----------|--------|-------|
| 1 | {A → B} | pass/fail | {evidence} |

## Gaps

| # | Gap | Severity | Action |
|---|-----|----------|--------|

## Verdict

{One of:}
- **passed** — All checks pass. PR created.
- **gaps_found** — Gaps listed. Re-plan scope: {specific gaps}.
- **human_needed** — UAT required: {what to test manually}.
```

### 7. Act on verdict

| Verdict | Action |
|---------|--------|
| **passed** | Create PR via `gh pr create`, update ROADMAP.md (phase → `done`), update STATE.md (advance to next phase), suggest next phase |
| **gaps_found** | Update STATE.md with blockers, suggest re-plan for specific gaps |
| **human_needed** | Update STATE.md, list what needs manual testing, do NOT create PR |

### 8. Update STATE.md

- Phase status → `verified` (if passed) or `verifying` (if gaps/human needed)
- Log verdict as a decision entry
- If passed: suggest "Next phase: `{next-pending-slug}`. Run `/iago:discuss {slug}` to begin."

## Output

Display:
1. Verification summary — checks passed/failed
2. Verdict with reasoning
3. PR URL (if passed) or gap list (if not)
4. Next step suggestion

## Boundaries

- No agent dispatch — verify is orchestrator-direct analysis
- Never modify source code during verification — read and run only
- Never create a PR unless ALL checks pass
- If unsure about a check, mark it `human_needed` — don't guess
- Consider recommending `/codex:review` or `/codex:adversarial-review` before shipping high-risk changes
