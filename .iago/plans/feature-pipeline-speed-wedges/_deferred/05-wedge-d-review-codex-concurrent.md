---
plan: 05-wedge-d-review-codex-concurrent
phase: feature-pipeline-speed-wedges
status: ready
spec: docs/specs/parallel-execution-wedges.md
wave: 2
depends_on: 01-measurement-protocol
---

# Plan 05 — Wedge D — Review || Codex Concurrent

## Goal

Run stage 3 REVIEW and stage 4 CODEX REVIEW concurrently. Both are read-only on the same post-implementation diff; there is no shared mutable state and no coordination required. Saves the larger of (review wall time, codex wall time) per pipeline run.

## Approach

Shell-level parallelism. No agent-teams needed.

Currently:
```
... (impl, build) ...
REVIEW         (≤900s)
CODEX REVIEW   (≤600s)
```

After this plan:
```
... (impl, build) ...
[REVIEW & CODEX REVIEW run concurrently with `&` + `wait`]
```

In `scripts/execute-pipeline.sh`:

1. After the build gate (line ~329), capture the diff once and write to `$DIFF_FILE` and `$REVIEW_CHECKS_FILE` (already done at lines 399–414).
2. Refactor stage 3 review block (lines 396–542) and stage 4 codex block (lines 544–622) so each is callable as a function: `run_review` and `run_codex`.
3. Replace the sequential calls with:
   ```bash
   ( run_review > "$PIPELINE_TMP/review.out" 2>&1 ) &
   REVIEW_PID=$!
   ( run_codex  > "$PIPELINE_TMP/codex.out"  2>&1 ) &
   CODEX_PID=$!
   wait "$REVIEW_PID" || REVIEW_EXIT=$?
   wait "$CODEX_PID"  || CODEX_EXIT=$?
   ```
4. After both complete, run their respective fix loops sequentially: review-fix loop first (existing logic), then codex-fix (existing logic). Codex-fix already runs after review-fix in the current sequential flow; this preserves that order.
5. Telemetry: emit two separate stages (`review`, `codex_review`) with overlapping start/end timestamps. Aggregator must handle overlapping stages gracefully.

## Acceptance

- Pipeline wall time decreases by `min(review_time, codex_time)` versus baseline on the same plan.
- Review and codex findings still arrive at their respective fix loops in the same format as today.
- No new race conditions: each session has its own subshell, its own output file, its own exit code.
- A failure in one (e.g., codex CLI not installed) does not abort the other.
- Telemetry shows overlapping `review` and `codex_review` stages in the NDJSON.

## Out of Scope

- Parallelizing the fix loops (review-fix and codex-fix remain sequential — they may modify the same files).
- Combining review and codex into one session.

## Stress Test

**VERDICT: BLOCK** — must resolve before implementation begins.

### Critical

1. **Stale codex findings against post-review-fix code.** Codex captures findings against the pre-fix diff. Review-fix then modifies dozens of lines. Codex-fix reads `$CODEX_FILE` and applies fixes against stale line numbers / deleted functions. Currently the sequential code regenerates diffs between review-fix iterations (lines 509-513) but `$CODEX_FILE` is never refreshed. Two acceptable resolutions: (a) re-run codex against the post-review-fix diff before codex-fix, OR (b) explicitly document codex findings as advisory-only when review-fix ran. Plan must pick one.

2. **`run_claude` temp file PID collision.** `claude-$$-$RANDOM.out` uses `$$` (parent PID, identical in both subshells). Two concurrent `run_claude` calls collide on `$RANDOM` ~50% over the value space. One session's output overwrites the other. Fix: use `$BASHPID` (subshell-unique) or a monotonic counter.

3. **`$DIFF_FILE` shared mutable variable race.** Plan says "capture the diff once and write" but the existing `run_codex` block also rewrites `$DIFF_FILE` at line 546-547. Refactor must specify: `run_codex` reads only the pre-written snapshot, never overwrites.

### Important

4. **Conflicts with plan 02 on the same 150-line block.** Plan 02 also refactors stage 3. Both have only `depends_on: 01`. Add `conflicts_with: 02` and define merge order.

5. **Codex `--wait` polling in background subshell.** If codex-companion exits non-zero mid-poll (network blip), fallback runs claude-adversarial — now there are two concurrent opus sessions (review still running + adversarial fallback). Resource contention unquantified.

6. **Acceptance criteria do not test stale-findings scenario.** Format preservation is asserted; content accuracy after review-fix is not.

7. **Post-plan-03 system load.** Plan 03 (multi-plan parallel) means N pipelines × 2 concurrent opus sessions = 2N concurrent sessions. Plan must note this future load consideration.

### Minor

8. **Telemetry "handle overlapping stages gracefully"** is a non-issue — per-stage duration math is independent of wall-clock overlap. Implementer may add unnecessary complexity. Drop the line.

9. **`REVIEW_EXIT` initialization missing in pseudocode.** Existing code initializes `REVIEW_EXIT=0`; pseudocode does not. Add explicit init.

10. **Out-of-scope reasoning incomplete.** Real reason fix loops can't parallelize: codex findings are relative to the implementation snapshot, not the review-fixed snapshot.
