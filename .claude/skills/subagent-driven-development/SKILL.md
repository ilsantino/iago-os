---
name: subagent-driven-development
description: >-
  Use when executing a multi-task implementation plan. Supports --pipeline for
  full 8-stage review isolation. Not when task is trivial (single file, <5 min
  — use /iago-fast instead) or when executing a ROADMAP phase (use /iago-execute
  instead).
---

## Purpose

Execute an implementation plan by dispatching a fresh agent per task using
profile-based dispatch, then reviewing results via the appropriate review profile.
Each agent gets minimal, focused context — no cross-task state leakage.

## Arguments

`/subagent-driven-development {plan-path}` — path to the plan file.

Optional flags:
- `--pipeline` — run each task through `scripts/execute-pipeline.sh` instead of
  in-session agents. Gives full 8-stage review isolation (stress test → implement → build gate
  → review → codex → codex fix → PR → summary) at the cost of more API calls and slower execution.
  Recommended for production code changes; skip for config-only repos.
- `--full-review` — two-stage review via `review-full` profile instead of
  single-pass `review-single` (ignored when `--pipeline` is set, since the
  pipeline handles its own review)
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

**If `--pipeline` is set:** For each task, write a single-task plan to
`.iago/plans/sdd-{slug}-{N}.md`, then run:
```bash
bash scripts/execute-pipeline.sh --plan .iago/plans/sdd-{slug}-{N}.md --project-dir {dir}
```
The pipeline handles implement → build gate → review → codex → codex fix → PR for each task.
Skip "3. Review", "4. Handle review findings", and "4b. Codex adversarial review gate (mandatory)" since the pipeline handles all three. Proceed directly to "5. Write summary" after all tasks complete.

**Default (no `--pipeline`):** For each task (respecting wave order):

**a. Dispatch agent via profile**

Match the task to a profile based on file paths:
- Files in both `src/` and `amplify/` → `fullstack`
- Files only in `src/` → `frontend`
- Files only in `amplify/` → `backend`
- Fallback → `fullstack`

If the task specifies `profile:` explicitly, use that.

**Smart model routing** — select model before dispatch:
1. If the matched profile has a hardcoded model (e.g., `security-audit → opus`), use it.
2. Read `.iago/config.json` `routing` section.
3. If `routing.default_model` is `"sonnet"` or `"opus"` (not `"auto"`), use that.
4. Otherwise apply heuristics:
   - Task touches 4+ files → `opus`
   - Task involves auth / payment / data-access → use `routing.security_critical` model
   - Task is a retry → `opus` if `routing.retry_upgrade` is `true`
   - Otherwise → `sonnet`
5. For reviews: if `routing.review_matches_impl` is `true`, match the model used for the implementation task being reviewed.

**Learnings injection** — before composing the agent prompt:
1. Read `.iago/learnings/patterns.md` — inject the top 10 patterns sorted by occurrence count (max 500 tokens).
2. Read `.iago/learnings/project-conventions.md` — inject in full (max 300 tokens).
3. Insert both blocks between the profile's capability modules and the task description in the composed prompt. Skip gracefully if either file is absent.

Compose the dispatch prompt from the profile's base agent + capability modules +
learnings + task. Dispatch via the profile's base agent with the routed model.

Provide each dispatch with:
- The single task (not the full plan)
- CLAUDE.md
- rules/tdd.md
- rules/systematic-debugging.md

The dispatched agent must end with an escalation status:
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
Dispatch `review-single` profile with:
- Git diff covering all task commits
- CLAUDE.md
- The plan file

Severity categories:
- **Critical** — must fix before merge (security, data loss, broken functionality)
- **Important** — should fix, but won't block (performance, maintainability)
- **Minor** — nice to have (style, naming, documentation)

**Two-stage (`--full-review` flag):**
Dispatch `review-full` profile — handles both spec compliance and code quality
checks internally (React/DynamoDB/Lambda patterns).

### 4. Handle review findings

| Severity | Action |
|----------|--------|
| Critical | Fix immediately — dispatch agent (same profile as original task) with the finding |
| Important | Log, ask user: fix now or defer? |
| Minor | Log only — do not fix unless user requests |

Anti-performative-agreement: do not dismiss Critical findings. Do not auto-approve
your own work. YAGNI check: flag any code that isn't required by the plan.

### 4b. Codex adversarial review gate (mandatory)

After internal review, dispatch `/codex:adversarial-review` (GPT-5.5 cross-model
review) on the full diff. A different model catches different blind spots.

**If Codex CLI is unavailable** (`command -v codex` fails or returns non-zero):
fall back to a Claude adversarial review session — dispatch `review-single`
profile with the diff and an adversarial prompt targeting auth bypass, data loss,
race conditions, and business logic errors. Log that Codex was unavailable so
the user knows cross-model review did not occur.

The review targets: auth bypass, data loss, race conditions, rollback safety,
business logic errors, and state management issues.

| Codex Verdict | Action |
|---------------|--------|
| Pass | Proceed to learnings extraction |
| Findings | Critical → dispatch fix agent (same profile) → re-review. Non-critical → log and proceed. |
| Unavailable | Fall back to Claude adversarial review (see above). Log the fallback. |

**Learnings extraction** — after processing all review findings:
1. Identify recurring patterns from the review that apply beyond the current task (e.g., "Always validate DynamoDB pk/sk before write", "Use `useTransition` for mutation feedback").
2. Append each new pattern to `.iago/learnings/patterns.md` using the format:
   ```
   - {pattern description} | Occurrences: 1 | Last Seen: {date} | Source: {plan-slug}
   ```
3. If a pattern already exists (fuzzy match on description), increment its `Occurrences` count and update `Last Seen` — do not create a duplicate entry.
4. If any pattern reaches 5+ occurrences, surface a recommendation to promote it to `CLAUDE.md` or the relevant rule file in `.claude/rules/`.

### 5. Write summary

After execution + review, write summary to `.iago/summaries/{slug}-summary.md`:

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

- One fresh agent per task — no shared state between dispatched instances
- Only the orchestrator (this session) dispatches agents — agents never spawn agents
- Plan is the contract — implement what it says, nothing more
- New ideas discovered during execution go to a "deferred" section in the summary
- Max 3 retry attempts per task (systematic-debugging.md escalation rule)
- If >50% of tasks are BLOCKED, abort and escalate the entire plan
