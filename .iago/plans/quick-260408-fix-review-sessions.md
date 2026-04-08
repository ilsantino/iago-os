---
phase: quick
plan: quick-260408-fix-review-sessions
wave: 1
depends_on: []
created: 2026-04-08
branch: fix/quick-review-sessions
base: main
---

# Quick: Fix critical review session bugs in execute-pipeline.sh

## Goal

Fix three critical bugs that cause the pipeline review stage to be ineffective:
the review session can't read the plan, the re-review has the same issue, and
the diff is empty when the implementation session doesn't commit.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/execute-pipeline.sh` | Fix review sessions and diff capture |

## Tasks

### Task 1: Pass plan content to review session and add tool access
- **files:** `scripts/execute-pipeline.sh`
- **action:** At the Step 3 review session (around line 158), change the prompt to pass `$PLAN_CONTENT` inline instead of `$PLAN_PATH`. Add `--allowedTools "Read Glob Grep Bash"` so the session can also read referenced files if needed. The prompt should read: "Review this diff against the plan below. Categorize findings as Critical, Important, or Minor. End with verdict: PASS, PASS_WITH_CONCERNS, or FAIL." followed by the plan content and the diff.
- **verify:** `grep -c 'PLAN_CONTENT' scripts/execute-pipeline.sh` — should show the review session using $PLAN_CONTENT
- **expected:** Count >= 2 (review + re-review both use PLAN_CONTENT)

### Task 2: Fix re-review session with same pattern
- **files:** `scripts/execute-pipeline.sh`
- **action:** At the re-review session (around line 227), apply the same fix: pass `$PLAN_CONTENT` inline and add `--allowedTools "Read Glob Grep Bash"`. The re-review currently doesn't reference the plan at all — it should.
- **verify:** `grep -A5 'Re-review' scripts/execute-pipeline.sh | grep -c 'PLAN_CONTENT'`
- **expected:** Count >= 1

### Task 3: Fix diff capture to include staged changes
- **files:** `scripts/execute-pipeline.sh`
- **action:** At the diff capture for the initial review (around line 146), the current code runs `git diff "$PRE_IMPL_SHA"..HEAD` which is empty if the implementation didn't commit. After the `git add -A` at line 143, add `git diff --cached` to capture staged changes. Combine both: committed changes (PRE_IMPL_SHA..HEAD) AND staged changes (--cached). The variable `STAGED_DIFF` on line 147 already exists but make sure the combined diff is passed to the review. Same pattern for the re-review diff capture around line 225.
- **verify:** `grep -c 'git diff --cached' scripts/execute-pipeline.sh`
- **expected:** Count >= 2 (initial review + re-review)
