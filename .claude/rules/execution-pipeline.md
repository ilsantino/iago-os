## Execution Pipeline

The review pipeline is enforced by `scripts/execute-pipeline.sh`. Every plan
goes through 7 stages as separate `claude -p` sessions. No shortcuts.

### How It Works

`/iago:execute {slug}` runs the pipeline script for each plan in the phase.
Each step is a fresh Claude session — no context bleed, no token burn in the
orchestrator.

The only way to skip the pipeline is `/iago:fast` (trivial fixes, ≤3 files).

### Rule: Skill Invocation Is Required

When a plan exists that requires code changes:

1. **Invoke `/iago:execute`** — it runs the script. The pipeline is automatic.
2. **Do NOT read the plan and implement it yourself.** That bypasses the pipeline.
3. **`/iago:fast`** is the only path that skips review.

### Detecting the Violation

If you notice yourself doing any of these WITHOUT having invoked `/iago:execute`:
- Reading a plan file and decomposing it into tasks
- Creating TaskCreate items based on a plan
- Calling Edit/Write on files referenced in a plan
- Dispatching agents to implement a plan

**STOP.** Invoke the skill. The script handles everything.

### Pipeline Stages (per plan)

```
scripts/execute-pipeline.sh --plan {path} --project-dir {dir}
  |
  v
1. IMPLEMENT — claude -p reads plan, writes code (sonnet, max 50 turns)
  |
  v
2. BUILD GATE — tsc --noEmit && vite build (max 2 retries with fix sessions)
  |
  v
3. REVIEW — claude -p checks diff against plan (Critical/Important/Minor)
  |  critical → fix session → rebuild → re-review (max 2 rounds)
  v
4. CODEX ADVERSARIAL — codex review or claude -p adversarial check
  |  auth bypass, data loss, race conditions, business logic
  v
5. CREATE PR — claude -p stages, commits, pushes, creates PR via gh
  |
  v
5b. TAG @CLAUDE — post review request on PR (fallback: gh pr view by branch)
  |
  v
6. REVIEW-FIX LOOP — delegates to review-fix-loop.sh:
  |  poll for @claude response → fix all comments → build gate →
  |  push → re-tag → repeat (max 5 rounds, 15 min poll timeout)
  |  exits on: APPROVED, clean review, max rounds, or BLOCKED
  |  also used by /iago:prfix (with --skip-initial-poll --skip-initial-tag)
  v
7. SUMMARY — write pipeline results to .iago/summaries/
```

### Handling Findings

| Severity | Action |
|----------|--------|
| Critical | Fix → rebuild → re-review. Max 2 rounds. Then STOP. |
| Important | Logged in PR. User decides timing. |
| Minor | Logged only. |

### What the Orchestrator Does

The orchestrator (main session) does NOT:
- Write implementation code
- Review implementation code
- Dispatch agents for implementation or review

The orchestrator DOES:
- Invoke `/iago:execute` (which runs the script)
- Report results to the user
- Update STATE.md after completion
- Escalate if the script fails
