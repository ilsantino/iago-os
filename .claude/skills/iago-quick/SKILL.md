---
name: iago-quick
description: >-
  Use when executing a small focused task (1-3 tasks, clear scope) outside the
  full multi-phase workflow. Not when the task is part of a ROADMAP phase
  (use the full init → discuss → plan → execute → verify cycle instead).
---

## Purpose

Lightweight one-shot execution path for standalone tasks that don't warrant the
full workflow. Produces a plan (with stress test), then runs it through
`scripts/execute-pipeline.sh` for the full 8-stage pipeline (stress test →
implement → build → review → codex → codex fix → PR → summary).

## When to Use

| Criteria | Quick | Full Workflow |
|----------|-------|---------------|
| 1-3 tasks, clear scope | Yes | No |
| Part of a ROADMAP phase | No | Yes |
| Needs wave grouping | No | Yes |
| Needs multi-plan coordination | No | Yes |
| Ad-hoc fix or small feature | Yes | No |

If >3 tasks or unclear scope, redirect to the full workflow.
If ≤3 file edits and trivially obvious, use `/iago-fast` instead.

## Arguments

`/iago-quick {description}` — describe what needs to be done.

Optional flags (composable):
- `--discuss` — run a brief discuss step before planning
- `--research` — dispatch `research` profile before planning
- `--verify` — run verification after execution
- `--no-tag` — skip @claude tagging on PR (PR created but async review-fix loop not triggered). Default: auto-tag (same as `/iago-execute`)

## Preconditions

- `.iago/PROJECT.md` should exist (for project context). If not, proceed with
  CLAUDE.md as the only context source — quick doesn't require init.

## Steps

### 1. Optional discuss (`--discuss` flag)

If `--discuss` is set:
- Surface 1-3 quick decisions the user needs to make
- Do NOT write a context artifact — keep it conversational
- Capture any decisions inline for the plan

### 2. Optional research (`--research` flag)

If `--research` is set:
- Dispatch `research` profile with: the task description, CLAUDE.md, PROJECT.md
- Use findings to inform the plan

### 3. Create lightweight plan

Write `.iago/plans/quick-{YYMMDD}-{slug}.md`:

```markdown
---
phase: quick
plan: quick-{YYMMDD}-{slug}
wave: 1
depends_on: []
created: {YYYY-MM-DD}
branch: fix/quick-{slug}
base: main
---

# Quick: {short description}

## Goal

{1-2 sentences}

## Files

| Action | Path | Purpose |
|--------|------|---------|

## Tasks

### Task 1: {name}
- **files:** `{path}`
- **action:** {instruction}
- **verify:** `{command}`
- **expected:** {output}
```

**Max 3 tasks** — if you need more, redirect to full workflow.

### 4. Run the execution pipeline

Determine the project directory (repo root or client project dir).

Run:
```bash
# Default (auto-tag, same as /iago-execute):
bash scripts/execute-pipeline.sh --plan {path} --project-dir {dir}
# With --no-tag:
bash scripts/execute-pipeline.sh --plan {path} --project-dir {dir} --no-tag
```

By default, quick tasks auto-tag @claude (same behavior as `/iago-execute`).
If `--no-tag` is passed, the PR is created but the async review-fix loop is
not triggered.

This runs the full 8-stage pipeline as separate `claude -p` sessions:
0. **Stress test** — adversarial plan review (skipped if plan has `## Stress Test` section)
1. **Implement** — writes code from the plan
2. **Build gate** — `tsc --noEmit && vite build` (max 2 retries)
3. **Review** — two-pass: plan compliance + adversarial (auth, data loss, races, rollback)
4. **Codex adversarial** — auth bypass, data loss, race conditions
4b. **Codex fix** — opus fixes all Codex findings, then rebuild (skipped if no findings)
5. **Create PR** — stages, commits, pushes, creates PR via `gh`
5b. **Tag @claude** — posts review request on PR
6. **Summary** — writes results to `.iago/summaries/`

Review-fix loop runs async via GitHub Action (`claude-review-fix.yml`).

Critical findings trigger automatic fix → rebuild → re-review (max 2 local rounds).
Async loop fixes ALL severities in priority order (Critical → Important → Minor,
max 5 rounds). Posts bullet-point summary when clean — human reviews and merges.
If the pipeline fails, report the error to the user. Do not retry manually.

### 5. Optional verify (`--verify` flag)

If `--verify` is set (the pipeline already runs a build gate, so this is for
additional checks beyond build):
- `npx vitest run` — test suite
- `npx biome check` — lint
- Report pass/fail for each

### 6. Update STATE.md

Log to the Quick Tasks table in STATE.md:

| Date | Mode | Description | PR |
|------|------|-------------|-----|
| {today} | quick | {description} | #{number} |

## Output

Display:
1. Pipeline result (pass/fail, PR URL)
2. Review findings (from pipeline output)
3. Verification results (if `--verify`)

## Boundaries

- No ROADMAP manipulation — quick tasks are standalone
- No wave grouping — single plan only
- No plan-checker self-review loop
- Max 3 tasks — redirect to full workflow if more needed
- If pipeline reports BLOCKED, escalate to user immediately (no retry logic)
- The pipeline handles all review — do NOT dispatch agents for implementation or review
