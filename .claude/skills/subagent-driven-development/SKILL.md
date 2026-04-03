---
name: subagent-driven-development
description: >-
  Use when executing a multi-task implementation plan. Not when task is trivial
  (single file, <5 min — use /iago:fast instead) or when executing a ROADMAP
  phase (use /iago:execute instead).
---

<!-- Source: Superpowers subagent-driven-development + executing-plans + dispatching-parallel-agents -->

## Purpose

Execute an implementation plan by dispatching a fresh `implementer` agent per task,
then reviewing results with `code-reviewer`. Each agent gets minimal, focused
context — no cross-task state leakage.

## Arguments

`/subagent-driven-development {plan-path}` — path to the plan file.

Optional flags:
- `--full-review` — two-stage review (spec-reviewer + code-quality-reviewer)
  instead of single-pass code-reviewer
- `--parallel` — dispatch all wave-1 tasks simultaneously (default: sequential)
- `--dry-run` — validate plan without executing

## Preconditions

- Plan file must exist with concrete tasks (no placeholders).
- Working tree should be clean. If dirty, ask user to commit or stash.

## Steps

### 1. Parse plan

Read the plan file. Extract:
- Task list with files, actions, verify commands
- Wave grouping (if present)
- Aggregate verification command

If `--dry-run`: validate plan structure, report issues, stop.

### 2. Execute tasks

For each task (respecting wave order):

**a. Dispatch implementer**

Dispatch `implementer` agent (Sonnet) with:
- The single task (not the full plan)
- CLAUDE.md
- rules/tdd.md
- rules/systematic-debugging.md

The implementer must end with an escalation status:
- **DONE** — task complete, verify command passed
- **DONE_WITH_CONCERNS** — task complete, minor issues noted
- **NEEDS_CONTEXT** — missing information, cannot proceed
- **BLOCKED** — external blocker, cannot resolve

**b. Handle response**

| Status | Action |
|--------|--------|
| DONE | Accept, proceed to next task |
| DONE_WITH_CONCERNS | Log concerns, proceed (fix in refactor pass) |
| NEEDS_CONTEXT | Provide context, re-dispatch once |
| BLOCKED | Escalate to user immediately — do not retry |

**c. Parallel dispatch (`--parallel` flag)**

If `--parallel` and tasks are in the same wave: dispatch all simultaneously.
Collect results. If any BLOCKED, pause remaining and escalate.

### 3. Review

After all tasks complete:

**Single-pass (default):**
Dispatch `code-reviewer` agent with:
- Git diff covering all task commits
- CLAUDE.md
- The plan file

Severity categories:
- **Critical** — must fix before merge (security, data loss, broken functionality)
- **Important** — should fix, but won't block (performance, maintainability)
- **Minor** — nice to have (style, naming, documentation)

**Two-stage (`--full-review` flag):**
1. Dispatch `spec-reviewer` — validates implementation matches spec/plan
2. Dispatch `code-quality-reviewer` — checks React/DynamoDB/Lambda patterns

### 4. Handle review findings

| Severity | Action |
|----------|--------|
| Critical | Fix immediately — dispatch implementer with the finding |
| Important | Log, ask user: fix now or defer? |
| Minor | Log only — do not fix unless user requests |

Anti-performative-agreement: do not dismiss Critical findings. Do not auto-approve
your own work. YAGNI check: flag any code that isn't required by the plan.

### 5. Write summary

After execution + review, write summary to `docs/plans/{slug}-summary.md`:

```markdown
# Summary: {plan-name}

## Tasks Completed

| # | Task | Files | Commit | Status |
|---|------|-------|--------|--------|
| 1 | {name} | {paths} | {hash} | DONE |

## Review Findings

| Severity | Finding | Resolution |
|----------|---------|------------|
| {level} | {issue} | {fixed/deferred/accepted} |

## Verification
{Aggregate verify result}
```

## Output

Display:
1. Tasks completed (count and list)
2. Review findings by severity
3. Aggregate verification result
4. Commit hashes

## Examples

**Sequential execution with single review:**
```
/subagent-driven-development docs/plans/auth-flow-plan.md
```

**Parallel execution with full review:**
```
/subagent-driven-development docs/plans/auth-flow-plan.md --parallel --full-review
```

## Boundaries

- One fresh agent per task — no shared state between implementer instances
- Only the orchestrator (this session) dispatches agents — agents never spawn agents
- Plan is the contract — implement what it says, nothing more
- New ideas discovered during execution go to a "deferred" section in the summary
- Max 3 retry attempts per task (systematic-debugging.md escalation rule)
- If >50% of tasks are BLOCKED, abort and escalate the entire plan
