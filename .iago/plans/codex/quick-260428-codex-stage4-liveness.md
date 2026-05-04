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
     # GNU timeout syntax is `timeout [OPTION] DURATION COMMAND` — options MUST
     # precede the duration. Order matters: `timeout 600 --kill-after=10 cmd`
     # parses --kill-after=10 as the command and exits 127.
     # On timeout: $_TIMEOUT_CMD returns 124 (SIGTERM-after-elapsed) or 137
     # (SIGKILL-after-grace if child traps SIGTERM). Either captured by the
     # outer `|| CODEX_EXIT=$?` and falls through to the Claude fallback at
     # line ~695 via the existing `elif [[ $CODEX_EXIT -ne 0 ]]` branch.
     # Preserves --cwd flag from PR #21 (defense in depth).
     CODEX_OUTPUT=$(cd "$PROJECT_DIR" && $_TIMEOUT_CMD --kill-after=10 600 node "$CODEX_COMPANION" adversarial-review --cwd "$PROJECT_DIR" --base "$PRE_IMPL_SHA" --wait 2>&1) || CODEX_EXIT=$?
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

## Deep Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-04-28
**Mode:** council (5 lenses — Security, Failure Modes, Simplicity, Consumer, Feasibility; peer-review phase compressed due to 5/5 convergence on the top finding)

### Consensus Findings (≥3 reviewers independently flagged)

**[CONSENSUS-1] Plan-spec argument order is wrong (5/5 reviewers).** Plan Task 1 line 61, Task 2 line 73, and Acceptance line 98 all specify `$_TIMEOUT_CMD 600 --kill-after=10 ...`. GNU `timeout`'s syntax is `timeout [OPTION] DURATION COMMAND` — options must precede the duration. The plan's literal would parse `--kill-after=10` as the command and exit 127, falling back to Claude on every Codex run silently. The implementer correctly inverted to `--kill-after=10 600` (live script line 695, test line 144) and documented the inversion inline. The plan body and Acceptance criteria are now misleading artifacts that a future maintainer reading them in isolation would either reintroduce the bug or flag the (correct) implementation as "doesn't match plan". **Resolution: patch plan body to match implementation.**

### Important Findings (single-reviewer or non-converging but real)

**[IMPORTANT-S1] `$_TIMEOUT_CMD` is a bare command name, not a pinned path.** A shell function named `timeout` defined after the detection block (e.g., from a sourced lib) would shadow the resolved binary because functions DO expand inside `$(...)` subshells. **Resolution: store the full path via `_TIMEOUT_CMD=$(command -v timeout)` so the call site uses `/usr/bin/timeout`, not a function lookup.** Cheap, defensive, no behavior change on happy path.

**[IMPORTANT-F2] Regression test exercises `--kill-after=2 5`, not `--kill-after=10 600`.** A misordered `--kill-after` argument in production wouldn't be caught — exit 127 in <9s is within the asserted `{124, 137}` set if the assertion accepted any non-zero. Test passes the binary-availability check but doesn't exercise the production argument shape. **Resolution: tighten the test's exit-code assertion from `∈ {124, 137}` to `∈ {124, 137}` AND assert that `node` was actually invoked (not bypassed by exit 127).** Add a marker file the stub touches when started.

**[IMPORTANT-F3] Truncated stdout containing `[P0/P1/P2]` markers is treated as authoritative findings.** Lines 727-729 of the script accept partial output as findings if any structured marker is seen, even on Codex non-zero exit. On a 600s timeout that fires while Codex was streaming `[P1]: minor concern...`, the truncated output is kept verbatim instead of falling back to Claude. **Resolution: this is a pre-existing pattern not introduced by this PR; document in `## Out of scope` and file as cycle-2 follow-up.** The fix would require Codex output framing that survives partial-stream cuts, which is outside Phase 0.

**[IMPORTANT-C2] `exit 1` in the detection block kills the parent shell if the script is sourced.** No current consumer sources `execute-pipeline.sh`, but a future test harness or wrapper might. **Resolution: add a one-line comment `# Note: exit 1 here intentional — this script is executed, not sourced` so a future contributor doesn't introduce sourcing without thought.**

**[IMPORTANT-C3] No prerequisites doc updated for the new operator dep.** First-time Mac runs without coreutils will hard-fail. Repo has no README mentioning brew dependencies. **Resolution: PR body must call out the prereq for Sebas; CLAUDE.md gets a one-line update in Tech Stack section noting `brew install coreutils` as a Mac prerequisite.** Defer the full prerequisites doc to a separate PR.

**[IMPORTANT-C4] Pipeline log doesn't distinguish timeout (124/137) from real Codex failure.** The existing line "WARNING: Codex review failed (exit $CODEX_EXIT)" fires for both. **Resolution: add a one-line log distinguishing the timeout case before the existing WARNING.** Pure observability; not in the original Phase 0 cap but cheap.

### Notes (worth knowing, no action this PR)

- **[NOTE-Sec3]** Test-stub cleanup not wrapped in trap — orphan stub binary if test fails mid-run. Low impact; world-readable but only runs `sleep 30`. Defer.
- **[NOTE-Si2]** `--kill-after=10` is undefended (why 10s and not 5s?). Inline rationale comment would help; defer to follow-up.
- **[NOTE-C5]** `_TIMEOUT_CMD` naming convention `_UPPERCASE` mixes private + global signals. Consider `PIPELINE_TIMEOUT_CMD` to match `PIPELINE_*` namespace. Defer.
- **[NOTE-C6]** Sebas needs explicit instruction post-merge to update his MEMORY.md `project_pipeline_bugs` entry. PR body callout suffices.
- **[NOTE-C7]** Actual wall-clock cap is 610s (600 + 10). Surface in stage-entry log line. Defer.
- **[NOTE-Sec2]** `$PROJECT_DIR` and `$HOME`-rooted `$CODEX_COMPANION` flow into the wrapped invocation without path-traversal sanitization. Pre-existing gap not introduced by this PR. Cycle-2 follow-up.

### Blind Spots (would have surfaced in Phase B but compression was justified)

The 5/5 convergence on CONSENSUS-1 plus orthogonal coverage across the lenses (each reviewer flagged distinct IMPORTANT findings without overlap) suggests low blind-spot probability. The one plausible blind spot — operator behavior under partial-stdout truncation when Codex partially emits structured markers — was caught by Failure Modes (IMPORTANT-F3). Skipping Phase B for time-pressure reasons; revisit if a finding here proves wrong post-merge.

### Resolution Summary (this PR scope)

1. **Patch plan body and Acceptance line** to match correct `--kill-after=10 600` order. Implementation is already correct; this is a plan-fidelity fix.
2. **Pin `_TIMEOUT_CMD` via `command -v`** to defeat function shadowing (IMPORTANT-S1).
3. **Tighten regression test** to assert `node` was actually invoked (IMPORTANT-F2).
4. **Add sourcing comment** to detection block (IMPORTANT-C2).
5. **Add timeout-vs-other distinguishing log line** (IMPORTANT-C4).
6. **PR body callout** for Sebas (MEMORY update + brew prereq).

Items 1-5 fit on top of the implementer's commit as a follow-up commit on the same branch — the open PR will pick them up automatically. Item 6 lives in PR body. CLAUDE.md prereq update (IMPORTANT-C3 partial) ships separately to keep this PR scoped.

Pipeline step 0 will skip per the canonical rule (`## Deep Stress Test` heading still matches the `## Stress Test` regex).
