---
name: iago-quick
description: >-
  Use when executing a small focused task (1-3 tasks, clear scope) outside the
  full multi-phase workflow. Not when the task is part of a ROADMAP phase
  (use the full init → discuss → plan → execute → verify cycle instead).
---

## Purpose

Lightweight one-shot execution path for standalone tasks that don't warrant the
full workflow. Produces a plan, dispatches a matching profile (fullstack/frontend/backend)
and `review-single`, and optionally verifies — all in one pass.

## When to Use

| Criteria | Quick | Full Workflow |
|----------|-------|---------------|
| 1-3 tasks, clear scope | Yes | No |
| Part of a ROADMAP phase | No | Yes |
| Needs wave grouping | No | Yes |
| Needs multi-plan coordination | No | Yes |
| Ad-hoc fix or small feature | Yes | No |

If >3 tasks or unclear scope, redirect to the full workflow.
If ≤3 file edits and trivially obvious, use `/iago:fast` instead.

## Arguments

`/iago:quick {description}` — describe what needs to be done.

Optional flags (composable):
- `--discuss` — run a brief discuss step before planning
- `--research` — dispatch `research` profile before planning
- `--verify` — run verification after execution

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

**No self-review loop** — quick plans are simple enough to get right in one pass.
**Max 3 tasks** — if you need more, redirect to full workflow.

### 4. Dispatch matching profile

Select profile based on file paths in the plan (fullstack/frontend/backend) and dispatch with:
- The quick plan file
- CLAUDE.md
- rules/tdd.md
- rules/systematic-debugging.md
- .iago/PROJECT.md (if exists)
- .iago/learnings/ (patterns + conventions)

Wait for response.

### 5. Dispatch review-single

Dispatch `review-single` profile with:
- Git diff from implementation
- CLAUDE.md
- The quick plan file

If review finds Critical issues: inform user, ask whether to fix or accept.
If Important/Minor only: log and continue.

### 6. Write summary

Write `.iago/summaries/quick-{YYMMDD}-{slug}.md`:

```markdown
---
phase: quick
plan: quick-{YYMMDD}-{slug}
status: done
key_files:
  - {path}
commits:
  - {hash}
---

# Summary: quick-{YYMMDD}-{slug}

## Tasks Completed

| # | Task | Files Changed | Commit |
|---|------|--------------|--------|

## Verification

{Verify command output}

## Review

{Review findings summary}
```

### 7. Optional verify (`--verify` flag)

If `--verify` is set:
- Run the same verification checks as `/iago:verify` but lighter:
  - `npx tsc --noEmit` — type check
  - `npx vitest run` — test suite
  - `npx biome check` — lint
- Report pass/fail for each

### 8. Update STATE.md

Log to the Quick Tasks table in STATE.md:

| Date | Mode | Description | Commit |
|------|------|-------------|--------|
| {today} | quick | {description} | {hash} |

## Output

Display:
1. What was built (task list with file changes)
2. Review findings (if any)
3. Verification results (if `--verify`)
4. Commit hashes

## Boundaries

- No ROADMAP manipulation — quick tasks are standalone
- No wave grouping — single plan only
- No plan-checker self-review loop
- Max 3 tasks — redirect to full workflow if more needed
- If profile returns BLOCKED, escalate to user immediately (no retry logic)
