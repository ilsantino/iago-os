---
name: iago-fast
description: >-
  Use when executing a trivial inline task (≤3 file edits, no new deps, obvious fix).
  Do NOT use when scope is unclear, >3 files are affected, the change touches auth/payment/data-access,
  or the task is part of a ROADMAP phase. For 1-3-task scope use /iago-quick; for ROADMAP phases use the full
  /iago-plan → /iago-execute workflow.
---

## Purpose

Execute trivially obvious changes inline without planning, agents, or review.
Produces an atomic commit and a STATE.md log entry — nothing else.

## When to Use

ALL of these must be true:
- ≤3 file edits
- No new dependencies
- Obvious fix or change (one-sentence description)
- Not part of a ROADMAP phase
- Does not touch auth, payment, or data-access code

If ANY condition fails, redirect:
- Unclear scope or >3 files → `/iago-quick`
- Touches auth/payment/data-access → `/iago-quick` (pipeline review required)
- Part of a ROADMAP phase → full workflow (`/iago-plan` → `/iago-execute`)

## Arguments

`/iago-fast {description}` — one-sentence description of the change.

## Preconditions

- Working tree must be clean (`git status` shows no uncommitted changes).
  If dirty, ask user to commit or stash first.

## Steps

### 1. Validate scope

Read the user's description. Confirm ≤3 files will be touched and the change is obvious.
If not, redirect to `/iago-quick` with explanation.

### 2. Execute inline

Make the changes directly — no plan file, no agent dispatch, no discuss step.
Apply the same code standards as any other change (TypeScript strict, Biome-clean,
TDD if adding logic).

### 3. Verify

Run the minimal verification appropriate to the change:
- TypeScript change → `npx tsc --noEmit`
- Logic change → `npx vitest run` (affected tests)
- Style/config change → `npx biome check`

Do not claim done without running at least one verify command.

### 4. Commit

Create an atomic commit following conventional commit format:
```
type(scope): description
```

### 5. Update STATE.md

Append to the Quick Tasks table in `.iago/STATE.md`:

| Date | Mode | Description | Commit |
|------|------|-------------|--------|
| {today} | fast | {description} | {short-hash} |

## Output

Display:
1. Files changed (list)
2. Verification result (command + output)
3. Commit hash

## Boundaries

- No plan files, no summaries, no context artifacts
- No agent dispatch — orchestrator executes everything inline
- No review step — the change is trivially obvious by definition
- No ROADMAP or STATE.md phase/status manipulation
- If verification fails, fix inline (up to 3 attempts per systematic-debugging.md)
- Never skip verification to save time
