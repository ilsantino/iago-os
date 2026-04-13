---
phase: audit
plan: 05
wave: 1
depends_on: []
created: 2026-04-12
---

# Plan: audit-05 — Enforce stress test findings + add pattern consistency check

## Goal

Fix two pipeline gaps that let bugs through on munet-web PR #31:
1. Stress test findings are advisory ("be aware of") — implementer ignored them
2. No pattern consistency check — reviewer missed that new API functions don't follow
   the same validation pattern as existing functions in the same file

## Findings Addressed

munet-web PR #31 findings 1, 2, 4, 6 — all traceable to these two gaps.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/execute-pipeline.sh` | Strengthen stress notes handoff (lines 158-163) |
| create | `scripts/review-checks/patterns.md` | New review module for pattern consistency |

## Tasks

### Task 1: Extract structured findings from stress test output
- **files:** `scripts/execute-pipeline.sh`
- **action:** Two changes: (a) Modify the stress test prompt (lines 94-125) to require a structured output block with delimiters: `---FINDINGS START---` / `---FINDINGS END---`. Each finding should be a numbered line. This makes extraction reliable. (b) After writing `$STRESS_OUTPUT` to `$STRESS_FILE` (lines 138-146), extract content between the delimiters into `$STRESS_FINDINGS` (`$PIPELINE_TMP/stress-findings.txt`). If delimiter extraction finds nothing (LLM didn't follow format), fall back to the full file with a WARNING log.
- **verify:** `grep -c "STRESS_FINDINGS" scripts/execute-pipeline.sh`
- **expected:** At least 3 references (definition, extraction, use in prompt)

### Task 2: Change stress notes language from advisory to imperative
- **files:** `scripts/execute-pipeline.sh`
- **action:** Replace lines 158-163. Current language:
  ```
  These are concerns identified before implementation. Be aware of edge cases and precision issues noted there.
  ```
  New language:
  ```
  MANDATORY: Read the stress-test findings at: $STRESS_FINDINGS
  These are REQUIREMENTS, not suggestions. For each finding you MUST either:
  1. Implement a fix that addresses the concern, OR
  2. Add a code comment explaining why the concern does not apply to this implementation
  Do not silently ignore any finding. The reviewer will check each one.
  ```
  Also update the implement prompt to reference `$STRESS_FINDINGS` (the extracted file) instead of `$STRESS_FILE` (the raw transcript).
- **verify:** `grep -c "MANDATORY\|REQUIREMENTS\|must either" scripts/execute-pipeline.sh`
- **expected:** At least 2 matches

### Task 3: Add review enforcement of stress test findings
- **files:** `scripts/execute-pipeline.sh`
- **action:** In the step 3 review prompt (around line 275), add an instruction to the reviewer:
  ```
  STRESS TEST ENFORCEMENT: If a stress-test findings file exists, read it. For each finding, verify the implementation either:
  (a) addresses the concern in code, or
  (b) has a code comment justifying why it doesn't apply.
  Flag any unaddressed stress-test finding as Important.
  ```
  Check if `$STRESS_FINDINGS` or `$STRESS_FILE` exists and conditionally add this to the review prompt (same pattern as the impl prompt).
- **verify:** `grep -c "STRESS TEST ENFORCEMENT" scripts/execute-pipeline.sh`
- **expected:** 1

### Task 4: Create pattern consistency review module
- **files:** `scripts/review-checks/patterns.md`
- **action:** Create a new review check module. The module should instruct the reviewer to:
  1. For each modified file, identify existing patterns (validation, error handling, type casting, response parsing, logging, naming)
  2. Check if new/modified code follows the same patterns
  3. Flag deviations as Important with the instruction: "Existing code in this file uses pattern X. New code does not. Either follow the pattern or document why the deviation is intentional."
  Specific patterns to check:
  - Response validation: if existing functions validate API responses, new functions must too
  - Type casting: if existing code uses type guards, new code must not use bare `as` casts
  - Error handling: if existing functions have try/catch, new functions in the same file must too
  - Naming: if existing functions follow a naming convention, new functions must match
  Mark "response validation inconsistency" as ALWAYS Important (severity floor).
  **Stress test note:** The module heading MUST include "(always included)" matching baseline.md's convention (e.g., `## Pattern Consistency Checks (always included)`). Without this, the domain-routing reviewer may skip it thinking it's domain-specific.
- **verify:** `test -f scripts/review-checks/patterns.md && grep -c "ALWAYS Important" scripts/review-checks/patterns.md`
- **expected:** File exists, at least 1 severity floor

## Verification

After all tasks:
```bash
grep "MANDATORY" scripts/execute-pipeline.sh && echo "PASS: stress notes imperative"
grep "STRESS TEST ENFORCEMENT" scripts/execute-pipeline.sh && echo "PASS: review checks stress"
test -f scripts/review-checks/patterns.md && echo "PASS: pattern module exists"
ls scripts/review-checks/*.md | wc -l  # should be 8 (was 7)
```

Expected: All PASS, 8 review modules

## Stress Test

Reviewed by opus adversarial analyst on 2026-04-12. Verdict: **PROCEED_WITH_NOTES**.
- Task 1: Stress test prompt must be modified to emit structured delimiters — regex on free-form LLM output is unreliable. Fixed: plan now requires delimiter-based extraction.
- Task 2: "The reviewer will check each one" depends on Task 3. Implement Task 3 before or alongside Task 2.
- Task 3: `$STRESS_FINDINGS` must be defined before the review section. Use `[[ -f "$STRESS_FINDINGS" ]]` guard same as impl prompt pattern at line 159.
- Task 4: patterns.md heading must say "(always included)" — fixed in plan.
- Prompt length: Consider embedding stress enforcement in the checklist file rather than the review prompt to reduce instruction density.
