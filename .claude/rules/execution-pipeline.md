## Execution Pipeline

The review pipeline is enforced by `scripts/execute-pipeline.sh`. Every plan
goes through 7 local stages + async GitHub review-fix loop. No shortcuts.

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
1. IMPLEMENT — claude -p reads plan, writes code (opus, max 50 turns)
  |
  v
2. BUILD GATE — tsc --noEmit && vite build (max 2 retries with fix sessions)
  |
  v
3. REVIEW — claude -p opus, two-pass: plan compliance + dynamic adversarial (Critical/Important/Minor)
  |  reads full source files (not just diff) for context
  |  dynamic checklist: compose_review_checks() analyzes diff paths + import patterns,
  |    concatenates baseline.md + domain modules (react, backend, auth, api, infra, i18n)
  |    from scripts/review-checks/. Detection is bash-native (grep), not LLM.
  |  cross-cutting (always checked): auth bypass, data loss, races, rollback safety
  |  any findings → fix session (opus, priority: Critical→Important→Minor) → rebuild → re-review (max 2 rounds)
  v
4. CODEX ADVERSARIAL — codex CLI / GPT-5.4 if available, else claude -p opus
  |  reads plan for context; checks: auth bypass, data loss, race conditions, rollback safety
  v
4b. CODEX FIX — claude -p opus, fixes all Codex findings (P0→P1→P2)
  |  skipped if no findings; rebuild gate after fix
  v
5. CREATE PR — claude -p sonnet, stages, commits, pushes, creates PR via gh (plan embedded in PR body)
  |
  v
5b. TAG @claude — claude -p haiku synthesizes review request, posts on PR
  |
  v
6. SUMMARY — write pipeline results to .iago/summaries/

```

### Control Flags

`--no-tag` on the pipeline script skips step 5b (@claude tagging). The PR is
still created � only the async review-fix loop trigger is suppressed.

Default behavior per skill:
- **`/iago:execute`** � auto-review (tags @claude). Pass `--no-review` to suppress.
- **`/iago:quick`** � no auto-review (passes `--no-tag`). Pass `--review` to enable.

Manual trigger: `/iago:prfix` tags @claude on any existing PR to start the
async loop after the fact.

### Async Review-Fix Loop (GitHub Actions)

Triggered automatically by step 5b. Runs without a session. Both workflows
skip merged/closed PRs (`state == open` guard).

```
@claude tagged on PR (step 5b or /iago:prfix)
  │
  ▼
claude.yml ── Claude Code Action reviews PR
  │
  ▼
Posts [claude-review-complete] signal (via GH_PAT)
  │
  ▼
claude-review-fix.yml ── checks findings + round count
  │
  ├── CLEAN (no findings) ──► post summary ──► human merges
  │
  ├── MAX ROUNDS (>5) ────► post notice ──► manual review
  │
  └── FINDINGS ──► fix agent fixes all findings
                     │
                     ▼
                   git commit + push (fallback push step)
                     │
                     ▼
                   re-tag @claude (via GH_PAT)
                     │
                     └──► back to claude.yml (loops)
```

### Handling Findings

All severities are fixed locally before PR creation. The local fix loop
runs in priority order (Critical → Important → Minor), max 2 rounds.
The async GitHub loop is a safety net, not the primary fix path.

| Severity | Action |
|----------|--------|
| Critical | Fix first. Rebuild, re-review. |
| Important | Fix second. Rebuild, re-review. |
| Minor | Fix last. Rebuild, re-review. |

Reviews must never dismiss findings as "acceptable" or "carry-over" — report
with severity, and the fix loop handles prioritization.

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
