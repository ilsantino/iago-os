---
phase: quick
plan: quick-260407-fix-pipeline-scripts
wave: 1
depends_on: []
created: 2026-04-07
---

# Quick: Fix critical bugs in execute-pipeline.sh and trigger-claude.sh

## Goal

Fix 8 critical/important bugs in the execution pipeline script that make it appear functional while silently discarding all implementation output, masking exit codes, reviewing incomplete diffs, and throwing away Codex findings. Also fix the same class of bugs in trigger-claude.sh.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Edit | `scripts/execute-pipeline.sh` | Fix all 8 bugs in the main pipeline script |
| Edit | `n8n/scripts/trigger-claude.sh` | Fix exit code masking and --project-dir |

## Tasks

### Task 1: Rewrite execute-pipeline.sh fixing all critical bugs
- **files:** `scripts/execute-pipeline.sh`
- **action:** Apply these 8 fixes:
  1. **Line 6:** Fix usage comment path from `./n8n/scripts/` to `./scripts/`
  2. **Lines 43-48 (implement step):** Remove `--project-dir "$PROJECT_DIR"` from all `claude -p` calls. Instead prefix each call with `cd "$PROJECT_DIR" &&`. Capture implementation output to `$IMPL_OUTPUT` variable instead of `> /dev/null 2>&1`. After capture, check if output contains "BLOCKED" or "NEEDS_CONTEXT" — if so, log the status and exit 1 with the output printed for diagnosis.
  3. **Lines 43-48 (exit code):** Replace `|| true` pattern with proper exit code capture: `IMPL_OUTPUT=$(...) ; IMPL_EXIT=$?` then handle non-zero exits explicitly.
  4. **Before line 43:** Add `PRE_IMPL_SHA=$(cd "$PROJECT_DIR" && git rev-parse HEAD)` to capture the commit SHA before implementation starts.
  5. **Lines 81, 122:** Replace `git diff HEAD~1` with `git diff "$PRE_IMPL_SHA"..HEAD` to capture ALL commits from implementation, not just the last one.
  6. **Lines 95:** Replace `grep -qi "critical" && grep -qi "FAIL"` with exact pattern matching: `grep -q "^.*Critical" && grep -q "Verdict:.*FAIL"` (case-sensitive, anchored patterns to avoid false positives from "failure" or "fail" in prose).
  7. **Lines 136-145 (Codex step):** Capture Codex output to `$CODEX_OUTPUT`. For `codex review`, add `--uncommitted` flag. For the fallback `claude -p` adversarial review, capture output instead of discarding. Re-generate `$DIFF` fresh at this point (in case fix loops changed it).
  8. **All `claude -p` calls (lines 70-75, 104-109, 115-118):** Apply same fix — replace `--project-dir` with `cd`, capture output instead of discarding, handle exit codes.
- **verify:** `bash -n scripts/execute-pipeline.sh` (syntax check)
- **expected:** Exit 0, no syntax errors

### Task 2: Fix trigger-claude.sh exit code masking and --project-dir
- **files:** `n8n/scripts/trigger-claude.sh`
- **action:** Apply 2 fixes:
  1. **Lines 31-37:** The `|| true` on line 35 makes `$?` on line 37 always 0. Fix by removing `|| true` and instead wrapping in a pattern that captures the real exit code: `OUTPUT=$(cd "$PROJECT_DIR" && timeout "$TIMEOUT" claude -p "$PROMPT" --model "$MODEL" --max-turns "$MAX_TURNS" --output-format text 2>&1) || EXIT_CODE=$?` with `EXIT_CODE=0` initialized before.
  2. **Lines 31-32:** Replace `--project-dir "$PROJECT_DIR"` with `cd "$PROJECT_DIR" &&` before the `claude` call (inside the command substitution).
- **verify:** `bash -n n8n/scripts/trigger-claude.sh` (syntax check)
- **expected:** Exit 0, no syntax errors

### Task 3: Verify both scripts pass shellcheck (if available)
- **files:** `scripts/execute-pipeline.sh`, `n8n/scripts/trigger-claude.sh`
- **action:** Run shellcheck on both files. Fix any warnings at error/warning level. Ignore style-only suggestions (SC2086 on intentionally unquoted variables, etc.).
- **verify:** `shellcheck scripts/execute-pipeline.sh n8n/scripts/trigger-claude.sh || true`
- **expected:** No errors at warning level or above
