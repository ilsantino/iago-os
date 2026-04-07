---
name: autonomous-loops
description: >-
  Use when running long autonomous tasks that don't need human approval at each
  step (bulk refactors, migration scripts, batch processing). Not when task
  requires human judgment at checkpoints (use /subagent-driven-development).
---


## Purpose

Execute a bounded loop of autonomous work — iterate, check, adjust — without
per-step human approval. Hard safety rails prevent runaway execution.

## Arguments

`/autonomous-loops {task-description}` — what the loop should accomplish.

Optional flags:
- `--max-iterations {N}` — iteration limit (default: 10, max: 25)
- `--cost-ceiling {dollars}` — abort if estimated cost exceeds this
- `--verify-every {N}` — run verification every N iterations (default: 5)

## Preconditions

- Task must be well-defined with a clear completion condition.
- If the task is ambiguous, redirect to `/brainstorming` or `/subagent-driven-development`.

## Steps

### 1. Define loop contract

Before starting, establish:
- **Goal:** What "done" looks like (measurable condition)
- **Iteration action:** What each loop pass does
- **Exit conditions:** Success (goal met), failure (max iterations), abort (cost ceiling)
- **Verification:** Command to check progress

### 2. Execute loop

```
for each iteration (1..max_iterations):
  1. Assess current state
  2. Execute one unit of work
  3. Check exit conditions:
     - Goal met? → EXIT SUCCESS
     - Cost ceiling hit? → EXIT ABORT
     - Max iterations? → EXIT TIMEOUT
  4. If verify-every interval: run verification command
  5. Log iteration result
```

### 3. Safety rails (non-negotiable)

| Rail | Default | Max |
|------|---------|-----|
| Max iterations | 10 | 25 |
| Cost ceiling | $1.00 | $5.00 |
| Verify interval | every 5 | every 1 |
| Context usage | auto-pause at 80% | hard stop at 90% |

If any rail triggers, the loop STOPS. No override without explicit user approval.

### 4. Verification at exit

Regardless of exit reason, run:
- `npx tsc --noEmit` (if TypeScript was modified)
- `npx vitest run` (if test-covered code was modified)
- `npx biome check` (always)

### 5. Report

```markdown
## Loop Report: {task}

- **Iterations:** {completed} / {max}
- **Exit reason:** {success | timeout | abort | error}
- **Files modified:** {count}
- **Verification:** {pass | fail}

### Iteration Log
| # | Action | Result | Cost |
|---|--------|--------|------|
```

## Output

1. Exit reason and iteration count
2. Files modified
3. Verification result
4. Total estimated cost

## Examples

**Bulk rename across codebase:**
```
/autonomous-loops Rename all instances of UserService to UserRepository --max-iterations 15
```

**Migration script:**
```
/autonomous-loops Migrate all useState+useEffect data fetching to use() + Suspense --verify-every 3
```

## Boundaries

- Safety rails are hard limits — cannot be bypassed within the skill
- Does not dispatch external agents — executes inline
- Each iteration must be independently verifiable
- If the loop modifies >20 files without verification passing, abort
- Not for tasks requiring design decisions — use `/subagent-driven-development`
