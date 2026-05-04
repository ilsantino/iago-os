---
phase: audit
plan: 04
wave: 2
depends_on: [audit-02]
created: 2026-04-12
---

# Plan: audit-04 — Archive stale docs and clean dead state

## Goal

Remove or archive stale documentation that describes superseded architecture
(n8n pipeline), clean up dead state files, and archive completed plans.

## Findings Addressed

I2, I3, I9, m1, m2, m3, m4

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `docs/automations/cross-session-pipeline.md` | Add SUPERSEDED header or move to archive |
| modify | `n8n/README.md` | Add note that execute-pipeline.sh is the canonical path |
| delete | `docs/memory-stack.md` | Redundant with CLAUDE.md memory section |
| modify | `.iago/hooks/context-persistence.mjs` | Investigate and fix zero-token cost tracking |
| modify | `.iago/hooks/usage-tracker.mjs` | Investigate agent name normalization |
| delete | `.iago/plans/quick-260407-*.md` | Archive completed plan (has matching summary) |
| delete | `.iago/plans/quick-260408-*.md` | Archive 2 completed plans |
| delete | `.iago/plans/quick-260410-*.md` | Archive completed plan |

## Tasks

### Task 1: Mark n8n docs as superseded
- **files:** `docs/automations/cross-session-pipeline.md`, `n8n/README.md`
- **action:** In cross-session-pipeline.md, add a header block:
  ```
  > **Status:** SUPERSEDED by `scripts/execute-pipeline.sh`
  > The bash pipeline handles all stages without n8n. This doc is retained
  > as reference for the n8n approach if needed in future.
  ```
  In n8n/README.md, add the same status note at the top. Do NOT delete the n8n/ directory — it's a valid optional path, just not the default.
- **verify:** `grep -c "SUPERSEDED" docs/automations/cross-session-pipeline.md n8n/README.md`
- **expected:** Both return 1

### Task 2: Delete redundant memory-stack.md
- **files:** `docs/memory-stack.md`, `README.md`, `docs/SETUP.md`, `scripts/setup-memory.sh`, `scripts/setup-memory.ps1`
- **action:** This file duplicates the Memory Architecture section in CLAUDE.md. Delete the docs/ version. **Stress test note:** 5 live references exist:
  - `README.md:55` (link text), `README.md:386` (direct link), `README.md:460` (dir tree), `README.md:520` (doc index)
  - `docs/SETUP.md:148` (direct link)
  - `scripts/setup-memory.sh:359` and `scripts/setup-memory.ps1:47` (printed path)
  Update all references — either remove them or point to CLAUDE.md's Memory Architecture section.
- **verify:** `test ! -f docs/memory-stack.md && echo "PASS" || echo "FAIL"` AND `grep -rn "memory-stack" docs/ README.md scripts/ CLAUDE.md`
- **expected:** File deleted, zero remaining references

### Task 3: Fix or remove dead cost tracking
- **files:** `.iago/hooks/usage-tracker.mjs`, `.iago/hooks/context-persistence.mjs`
- **action:** **Stress test finding:** usage-tracker.mjs has zero token/cost tracking code — the feature was never built, not broken. The costs.jsonl entries with all-zero tokens come from context-persistence.mjs writing stub records. Decision: either (a) implement real token extraction from the Claude Code hook payload (if the payload includes token data — check Claude Code docs), or (b) remove the dead costs.jsonl writing code from context-persistence.mjs so it stops producing misleading zeros. Option (b) is simpler and honest. Don't leave silently-broken instrumentation.
- **verify:** If removing: `grep -c "costs" .iago/hooks/context-persistence.mjs` should be 0. If implementing: costs.jsonl should get non-zero values.
- **expected:** Either working cost tracking or no cost tracking — not fake zeros

### Task 4: Fix agent name normalization in usage log
- **files:** `.iago/hooks/usage-tracker.mjs`
- **action:** Read the hook. Find where it extracts the agent name. The log shows "Explore" which is a Claude Code subagent type, not an iaGO profile name. Either:
  - Map known Claude Code agent types to iaGO profiles where possible
  - Log the raw agent type as-is but add a `profile` field that normalizes
  - Or just accept raw agent types as valid data (they represent actual dispatches)
  Pick the simplest option that makes the log useful for auditing.
- **verify:** Read the agent name extraction code — confirm it handles both profile names and raw agent types
- **expected:** Clear, documented behavior

### Task 5: Archive completed quick plans
- **files:** `.iago/plans/quick-260407-fix-pipeline-scripts.md`, `.iago/plans/quick-260408-fix-review-fix-prompt.md`, `.iago/plans/quick-260408-fix-review-sessions.md`, `.iago/plans/quick-260410-memory-stack.md`
- **action:** All 4 have matching summaries in `.iago/summaries/`. They are completed work. Delete them from plans/ (summaries serve as the permanent record).
- **verify:** `ls .iago/plans/*.md 2>/dev/null | grep -v audit | wc -l`
- **expected:** 0 (only audit plans remain)

### Task 6: Fix session eviction (12 vs MAX=10)
- **files:** `.iago/hooks/context-persistence.mjs`
- **action:** Read the eviction logic. MAX_SESSIONS is set to 10 but 12 files exist. Find why eviction isn't firing — likely the eviction runs on session-start but the count check is off-by-one or the sort/delete logic has a bug. Fix the eviction to enforce the cap.
- **verify:** `ls .iago/state/sessions/ | wc -l`
- **expected:** ≤10 after next session cycle

## Verification

After all tasks:
```bash
grep "SUPERSEDED" docs/automations/cross-session-pipeline.md n8n/README.md
test ! -f docs/memory-stack.md && echo "PASS: memory-stack deleted"
ls .iago/plans/*.md | grep -v audit | wc -l  # should be 0
```

Expected: SUPERSEDED markers present, memory-stack gone, only audit plans remain

## Stress Test

Reviewed by opus adversarial analyst on 2026-04-12. Verdict: **PROCEED_WITH_NOTES**.
- Task 2: File list was incomplete — 5 live references to memory-stack.md in README.md, SETUP.md, and setup scripts. Added to file list and action.
- Task 3: Reframed — usage-tracker.mjs never had token tracking code (not broken, never built). Decision simplified to build-or-remove.
- Task 4: Agent names like "Explore" are valid Claude Code subagent types, not bugs. Accept raw types as valid data — simplest correct approach.
