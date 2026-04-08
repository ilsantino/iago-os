---
phase: quick
plan: quick-260408-pipeline-logic-fixes
wave: 1
depends_on: []
created: 2026-04-08
branch: fix/quick-pipeline-logic
base: main
---

# Quick: Fix pipeline logic bugs in execute-pipeline.sh

## Goal

Fix three Important bugs: the critical-fix loop condition uses AND when it should
use OR, the Codex fallback uses sonnet instead of opus, and the build gate runs
commands twice on failure (once to check, once to capture errors).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/execute-pipeline.sh` | Fix loop condition, Codex fallback model, build error capture |

## Tasks

### Task 1: Fix critical-fix loop condition (AND → OR)
- **files:** `scripts/execute-pipeline.sh`
- **action:** Around line 177, the while loop condition requires BOTH `grep -q "Critical"` AND `grep -qiE "Verdict:.*FAIL"` to trigger a fix. This means a review with Critical findings but verdict PASS_WITH_CONCERNS silently passes through. Change the `&&` to `||` so that EITHER Critical findings OR a FAIL verdict triggers the fix loop. The logic should be: if there are Critical findings, fix them regardless of verdict. If verdict is FAIL, fix regardless of whether the word "Critical" appears.
- **verify:** `grep -A1 'while echo.*REVIEW_OUTPUT' scripts/execute-pipeline.sh`
- **expected:** Should show `||` between the two grep conditions, not `&&`

### Task 2: Upgrade Codex fallback to opus
- **files:** `scripts/execute-pipeline.sh`
- **action:** Around line 255, the Codex CLI fallback uses `--model sonnet`. This is the adversarial review — the step most likely to find security bugs — and it deserves opus when standing in for GPT-5.4. Change `--model sonnet` to `--model opus` on the fallback `claude -p` adversarial call only. Do NOT change the model on the `codex review` call (that uses GPT-5.4 natively).
- **verify:** `grep -B5 -A1 'model.*sonnet' scripts/execute-pipeline.sh | grep -c sonnet`
- **expected:** Count should be 1 (only the PR creation step remains as sonnet)

### Task 3: Eliminate double build runs on failure
- **files:** `scripts/execute-pipeline.sh`
- **action:** The `run_build_gate` function (around line 85) runs `tsc` and `vite build` but discards their output. When the build fails, lines 109-113 re-run the SAME commands just to capture `$BUILD_ERRORS`. This means the build runs twice on every failure. Fix by making `run_build_gate` capture and return its output. Store output in a variable during the initial run, and reuse it for `$BUILD_ERRORS` instead of re-running. One approach: run tsc/vite inside the function, capture output to a temp file or variable, return exit code. The caller reads the output if it failed.
- **verify:** `grep -c 'npx tsc --noEmit' scripts/execute-pipeline.sh`
- **expected:** Count should be 2 or less (was 4 — two in run_build_gate, two in error capture). After fix, tsc runs once per attempt in the function, errors captured from that same run.
