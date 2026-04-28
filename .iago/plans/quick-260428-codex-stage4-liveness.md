---
phase: quick
plan: quick-260428-codex-stage4-liveness
wave: 1
depends_on: []
created: 2026-04-28
branch: fix/phase-0-codex-liveness
base: main
rca_source: .iago/research/codex-stall-diagnosis-2026-04-28.md
---

# Quick: Codex Stage 4 Liveness Gate (Phase 0 standalone)

## Goal

Add a bounded-time wrapper around the codex-companion invocation in `scripts/execute-pipeline.sh` so a hung Codex stage 4 cannot block the pipeline indefinitely. PR #21 fixed cwd correctness but did not bring the call site up to the same liveness standard as `run_claude` (line 121). Full diagnosis and revised fix design at `.iago/research/codex-stall-diagnosis-2026-04-28.md`. This plan implements that design verbatim — three tasks, two file edits + one read-through.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `scripts/execute-pipeline.sh` | Add `_TIMEOUT_CMD` detection at script header; wrap the `node "$CODEX_COMPANION" adversarial-review ...` call at line 672 with the timeout. |
| edit | `scripts/test-pipeline-helpers.sh` | Add regression test that stubs `node` with a sleep-forever script and asserts the timeout fires within budget + grace. |
| read-through | `scripts/test-pipeline-helpers.sh` | Confirm existing FAIL-regex test cases cover all edge cases. Add only what's missing. |

## Tasks

### Task 1: Bounded-time wrapper for codex-companion invocation

- **files:** `scripts/execute-pipeline.sh`
- **action:**
  1. After the self-freeze block (around line 100, before the function definitions starting near `log()` / `run_claude()`), add a portable timeout-utility detection:
     ```bash
     # Portable timeout utility detection (Phase 0 — Codex stage 4 liveness gate).
     # macOS lacks GNU `timeout` by default; brew coreutils ships `gtimeout`.
     # HARD-fail if neither is available — silent fallback would re-expose the
     # exact bug being fixed (no liveness gate on long-running Codex calls).
     _TIMEOUT_CMD=""
     if command -v timeout >/dev/null 2>&1; then
       _TIMEOUT_CMD="timeout"
     elif command -v gtimeout >/dev/null 2>&1; then
       _TIMEOUT_CMD="gtimeout"
     else
       echo "ERROR: neither 'timeout' nor 'gtimeout' available. Install GNU coreutils (macOS: brew install coreutils)." >&2
       exit 1
     fi
     ```
     Place this AFTER the self-freeze re-exec block and BEFORE function definitions, so the check fails fast on macOS without coreutils before any pipeline work begins.
  2. At line 672, replace:
     ```bash
     CODEX_OUTPUT=$(cd "$PROJECT_DIR" && node "$CODEX_COMPANION" adversarial-review --cwd "$PROJECT_DIR" --base "$PRE_IMPL_SHA" --wait 2>&1) || CODEX_EXIT=$?
     ```
     with:
     ```bash
     # Bounded liveness gate: 600s budget, 10s SIGTERM→SIGKILL grace.
     # On timeout: $_TIMEOUT_CMD returns 124 (SIGTERM-after-elapsed) or 137
     # (SIGKILL-after-grace if child traps SIGTERM). Either captured by the
     # outer `|| CODEX_EXIT=$?` and falls through to the Claude fallback at
     # line ~695 via the existing `elif [[ $CODEX_EXIT -ne 0 ]]` branch.
     # Preserves --cwd flag from PR #21 (defense in depth).
     CODEX_OUTPUT=$(cd "$PROJECT_DIR" && $_TIMEOUT_CMD 600 --kill-after=10 node "$CODEX_COMPANION" adversarial-review --cwd "$PROJECT_DIR" --base "$PRE_IMPL_SHA" --wait 2>&1) || CODEX_EXIT=$?
     ```
  3. Do NOT touch the post-call sanity check (lines 680-692 from PR #21) — it stays as defense-in-depth for the cwd-misfire failure mode.
- **verify:** `bash -n scripts/execute-pipeline.sh && grep -n '_TIMEOUT_CMD' scripts/execute-pipeline.sh`
- **expected:** Syntax clean. `_TIMEOUT_CMD` referenced at the detection block AND at the wrapped invocation (≥3 hits total).

### Task 2: Regression test for the liveness gate

- **files:** `scripts/test-pipeline-helpers.sh`
- **action:** Add a new test case at the end of the existing test suite:
  - Create a tmp dir, write a fake `node` script that runs `sleep 30` and `chmod +x` it.
  - PATH-prepend the tmp dir.
  - Capture start time. Run `$_TIMEOUT_CMD 5 --kill-after=2 node anything` (where `node` resolves to the stub) under `bash -c`. Capture exit code and elapsed seconds.
  - Assert: `exit ∈ {124, 137}` AND `elapsed_seconds <= 9` (5s budget + 2s kill-after grace + 2s slack).
  - Print PASS/FAIL with the captured exit code and elapsed time.
  - Clean up the tmp dir + stub.
  - Match the style of existing tests in the file (numbered, single-purpose, exit-non-zero on failure).
- **verify:** `bash scripts/test-pipeline-helpers.sh`
- **expected:** All existing tests pass + the new liveness-gate test PASS. Suite ends with `Result: N passed, 0 failed` where N includes the new test.

### Task 3: FAIL-regex test coverage confirmation

- **files:** `scripts/test-pipeline-helpers.sh` (read-through; only edit if a case is missing)
- **action:** Read the existing tests and confirm coverage of these five FAIL-regex edge cases that were the council's stated worry:
  1. Lowercase: input contains `verdict: fail` (no caps) — must trigger loop.
  2. Prose-surrounded: input contains "the verdict is FAIL because..." — must trigger loop.
  3. Multi-mention with `tail -1`: input contains both `Verdict: PASS` (in a quoted earlier line) and `Verdict: FAIL` (the actual final verdict) — extractor must pick FAIL, not PASS.
  4. Plain PASS negative: input contains `Verdict: PASS` and no FAIL/PASS_WITH_CONCERNS — must NOT trigger loop.
  5. PASS_WITH_CONCERNS positive: input contains `Verdict: PASS_WITH_CONCERNS` — must trigger loop.
  Add only the cases that are absent. Do NOT refactor existing tests.
- **verify:** `bash scripts/test-pipeline-helpers.sh && grep -ciE 'lowercase|prose|tail|PASS_WITH_CONCERNS' scripts/test-pipeline-helpers.sh`
- **expected:** Suite still green. The grep should match ≥5 times across test descriptions/labels (one per edge case). If you added any tests, the result count grows accordingly.

## Acceptance

- `bash -n scripts/execute-pipeline.sh` clean.
- `bash scripts/test-pipeline-helpers.sh` reports all tests pass (existing + new liveness gate test + any added FAIL-regex cases).
- The codex-companion invocation at line 672 is wrapped with `$_TIMEOUT_CMD 600 --kill-after=10`.
- The `_TIMEOUT_CMD` detection block has a HARD `exit 1` path (no warn-and-skip).
- `--cwd "$PROJECT_DIR"` flag and the post-call sanity check (lines 680-692) from PR #21 are preserved verbatim.
- Manual smoke check (post-implementation, optional): with a sleep-forever stubbed `node`, the pipeline exits stage 4 within ~16s and `CODEX_EXIT` is non-zero, triggering the Claude adversarial fallback.

## Out of scope

- Externalizing `run_claude` to `scripts/lib/run-claude.sh` (rejected in stress-tested fix design — single-site wrap suffices).
- Authoring a `run_codex_companion` helper (rejected — `timeout` is one line).
- Touching any wedge work (J, K, B, C, H, D) — Phase 0 is foundation, wedges are blocked until this PR merges.
- MEMORY.md update for `project_pipeline_bugs` — outside repo, handled post-merge.

## Stress Test

**Verdict:** PROCEED (already stress-tested via /iago-stress on the source RCA at `.iago/research/codex-stall-diagnosis-2026-04-28.md`)
**Date:** 2026-04-28
**Mode:** standard

This plan is a mechanical translation of the revised fix design in the RCA. The RCA's `## Stress Test` section consolidates 2 BLOCK + 3 IMPORTANT + 2 NOTE findings — all resolved in the revised design adopted here verbatim. Specifically:
- Return-code ambiguity → resolved by relying on `timeout`'s native 124/137 captured by outer `||` (no internal helper state).
- `taskkill //T` grandchild reach → sidestepped by using `timeout`'s SIGTERM→SIGKILL discipline instead of background-poll-and-tree-kill.
- Phase 0 cap creep (lib extraction) → rejected; single-site wrap.
- macOS warn-and-skip → replaced with HARD `exit 1` and operator instructions.
- `--wait` precondition → verified via source-read of `handleReviewCommand` (parsed but not branched on; call is unconditionally synchronous).

Pipeline step 0 will skip per the canonical rule.
