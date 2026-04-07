## Execution Pipeline (MANDATORY)

This rule is non-negotiable. Violating it ships unreviewed code to clients.

### The Problem This Solves

Claude reads a plan, implements the code, runs `npm run build`, and creates a PR —
skipping all review stages. The build passing does NOT mean the code is correct.
Build gates catch syntax errors. Reviews catch logic errors, security holes, spec
drift, and architectural mistakes. Codex catches blind spots that Claude misses.

### Rule: Skill Invocation Is Required

When a plan, spec, or task exists that requires code changes:

1. **Invoke the skill FIRST** — Use the Skill tool to load `/iago:execute`,
   `/iago:quick`, or `/subagent-driven-development`. The skill file contains
   the orchestration logic for dispatch, build gates, reviews, and PR creation.

2. **Do NOT read the plan and implement it yourself.** Even if you have all the
   context. Even if it seems faster. Even if the user is in a hurry. The skill
   dispatches agents with fresh context, proper profiles, and capability modules.
   You implementing directly means zero review coverage.

3. **The only exception is `/iago:fast`** — for trivial fixes (<=3 files, obvious
   change). Even then, a build gate is mandatory.

### Detecting the Violation

If you notice yourself doing any of these WITHOUT having invoked an execution skill:
- Reading a plan file and mentally decomposing it into tasks
- Creating TaskCreate items based on a plan
- Calling Edit/Write on implementation files referenced in a plan
- Running `npm run build` as your only quality gate

**STOP IMMEDIATELY.** You are bypassing the pipeline. Invoke the skill.

### The 3-Stage Review Pipeline

After implementation and build gate pass, ALL THREE stages must run:

#### Stage 1 + 2: Internal Review (spec + quality)

Dispatch the `review-full` profile (or `review-single` based on config).

- **Spec compliance:** Does the implementation match every task in the plan?
  Missing tasks, partial implementations, wrong behavior — all caught here.
- **Quality:** Performance issues, security vulnerabilities, maintainability
  problems, missing error handling, naming inconsistencies.
- **Gating:** If Stage 1 finds Critical issues, Stage 2 is skipped until fixed.

Context passed to reviewer: git diff, plan file, CLAUDE.md, PROJECT.md.

#### Stage 3: Cross-Model Adversarial Review (Codex / GPT-5.4)

Dispatch `/codex:adversarial-review`. This is MANDATORY on every plan.

A different model architecture catches different classes of bugs:
- Auth bypass and privilege escalation
- Data loss and corruption paths
- Race conditions and state management errors
- Rollback safety (can this deployment be safely rolled back?)
- Business logic errors (wrong calculations, wrong conditions)

#### Handling Findings

| Severity | Action |
|----------|--------|
| Critical | Fix immediately. Re-run build gate + re-review. Max 2 rounds. |
| Important | Log. Proceed. User decides fix timing. |
| Minor | Log only. |

After 2 failed fix rounds on the same Critical finding: **STOP and escalate.**

### Artifacts

Every plan execution MUST produce:

1. **Summary** — `.iago/summaries/{NN}-{slug}-{PP}.md` with tasks, files, commits,
   deviations, review findings, and verdict.
2. **Learnings** — Review patterns logged to `.iago/learnings/patterns.md`.
   Patterns at 5+ occurrences are candidates for promotion to CLAUDE.md.

If these artifacts don't exist after a plan is "complete," the pipeline was skipped.

### Pipeline Order

```
Plan loaded
  |
  v
Agent dispatch (profile-based, fresh context)
  |
  v
Implementation complete (agent returns DONE)
  |
  v
BUILD GATE: tsc --noEmit && vite build
  |  fail -> dispatch debug profile, max 2 retries
  v
STAGE 1+2: review-full profile
  |  critical -> fix -> rebuild -> re-review (max 2 rounds)
  v
STAGE 3: /codex:adversarial-review (GPT-5.4)
  |  critical -> fix -> rebuild -> re-review (max 2 rounds)
  v
Write summary + extract learnings
  |
  v
Create PR (never auto-merge)
```

### What This Means For the Orchestrator

The orchestrator (you, in the main session) does NOT:
- Write implementation code
- Review implementation code
- Decide that reviews are unnecessary

The orchestrator DOES:
- Invoke the execution skill
- Dispatch agents via profiles
- Handle agent responses (DONE / BLOCKED / NEEDS_CONTEXT)
- Coordinate the build gate and review dispatches
- Write summaries and update STATE.md
- Create the PR after all gates pass
