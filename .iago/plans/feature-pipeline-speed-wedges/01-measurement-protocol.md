---
plan: 01-measurement-protocol
phase: feature-pipeline-speed-wedges
status: ready
spec: docs/specs/parallel-execution-wedges.md
wave: 1
---

# Plan 01 — Measurement Protocol

## Goal

Add per-stage telemetry to `scripts/execute-pipeline.sh` so every pipeline run produces a structured NDJSON record on disk, including timeout flags and a closing `pipeline_exit` value. Add `scripts/metrics-aggregate.mjs` to compute per-stage p50/p95/timeout-hit-rate over the last N runs. Telemetry data drives wave-2 wedge priorities.

This is the only wave-1 plan. Wave 2 (plans 02–06) lives under `_deferred/` and ships after a baseline of ≥5 real runs is captured. Plans 02 and 05 carry `VERDICT: BLOCK` from stress testing and need revision before execution; the others are PROCEED_WITH_NOTES.

## Tasks

### Task 1 — Telemetry helper library

Create `scripts/lib/pipeline-telemetry.sh`. Bash file, sourced from `execute-pipeline.sh`.

Exports:

```bash
# Initialize one run. Sets RUN_ID, RUN_FILE, RUN_STARTED_AT.
# Idempotent: callable once per pipeline invocation.
pipeline_init() { ... }

# Mark stage start. Resets LAST_RUN_TIMED_OUT=false.
# Writes NDJSON: {"type":"stage_start","stage":"$1","ts":"<iso>"}
stage_start() { ... }

# Mark stage end. Reads LAST_RUN_TIMED_OUT for the timed_out field.
# Writes NDJSON: {"type":"stage_end","stage":"$1","exit":"$2","duration_ms":N,"timed_out":bool,"ts":"<iso>"}
stage_end() { ... }

# Final record. Called from EXIT trap with pipeline-level exit code.
# Writes NDJSON: {"type":"pipeline_finalize","plan":"<name>","pipeline_exit":N,"duration_ms":N,"ts":"<iso>"}
pipeline_finalize() { ... }
```

NDJSON file path: `$PROJECT_DIR/.iago/state/pipeline-runs/${RUN_ID}.ndjson`. RUN_ID format: `YYYYMMDD-HHMMSS-${PLAN_NAME}-${RANDOM}`.

Use `date -u +%s%3N` for millisecond timestamps where available; fall back to `date -u +%s` * 1000 if `%3N` is unsupported (Git Bash on Windows supports `%3N`; verify with `date +%3N` in environment). Use `date -u -Iseconds` for ISO timestamps.

All writes append (`>>`). Create the parent directory at `pipeline_init` time (`mkdir -p`).

Keep the helper self-contained — no external dependencies beyond bash, date, mkdir.

### Task 2 — Wire helper into `scripts/execute-pipeline.sh`

Source the helper near the top, after the SCRIPT_DIR definition (line 19):

```bash
. "$SCRIPT_DIR/lib/pipeline-telemetry.sh"
```

Add `PIPELINE_STARTED=false` global init **before** any `log` call (i.e., before line 89 where `log()` is defined). Set `PIPELINE_STARTED=true` and call `pipeline_init` immediately after the `--plan` argument validation block (after line 39), so any failure before that point doesn't try to call `stage_*` functions on uninitialized state.

Wrap each labeled stage. Each `log "STAGE_NAME — ..."` call gets a paired `stage_start`/`stage_end`. The full list:

| Stage label | stage_start arg |
|-------------|-----------------|
| STRESS TEST | `stress_test` |
| IMPLEMENT | `implement` |
| BUILD GATE | `build_gate` |
| CONSOLE GATE | `console_gate` |
| REVIEW | `review` |
| CODEX REVIEW | `codex_review` |
| CODEX FIX | `codex_fix` |
| CREATE PR | `create_pr` |
| TAG | `tag_claude` |
| SUMMARY | `summary` |

For stages that loop with retries (BUILD GATE, console gate, review with fix-loop), wrap the *outer* loop with one `stage_start`/`stage_end` pair — record retries inside the stage record as a `retries` field if you want, but keep the stage timing as wall time of the entire stage.

For stages that may be skipped (CONSOLE GATE without Vite, CODEX FIX with no findings), still emit a `stage_start` + `stage_end` with `exit:skipped` so the aggregator can count skip rate. Alternative: omit the records entirely for skipped stages — pick whichever the aggregator handles cleanly. **Decision: emit skip records.** Easier to count skip rate than to infer from absence.

Extend the existing EXIT trap (line 48) — do not replace it. The new trap body must call `pipeline_finalize` with the captured exit code BEFORE the existing cleanup of `PIPELINE_TMP` and `LOCK_DIR`:

```bash
trap '__exit=$?; [[ "$PIPELINE_STARTED" == "true" ]] && pipeline_finalize "$__exit"; rm -rf "$PIPELINE_TMP"; [[ -n "${LOCK_DIR:-}" && -f "${LOCK_DIR}/pid" && "$(cat "${LOCK_DIR}/pid" 2>/dev/null)" == "$$" ]] && rm -rf "$LOCK_DIR"' EXIT
```

The `PIPELINE_STARTED` guard prevents calling `pipeline_finalize` if the script exits early during argument parsing.

### Task 3 — Timeout signaling in `run_claude`

In `scripts/execute-pipeline.sh`, modify `run_claude` (lines 91–120):

- At function entry, set `LAST_RUN_TIMED_OUT=false` (global).
- At line 105 (when timeout fires), set `LAST_RUN_TIMED_OUT=true` before returning 1.

`stage_end` reads `$LAST_RUN_TIMED_OUT` and includes it in the NDJSON record. `stage_start` resets it to `false`.

This works because `run_claude` is called synchronously via `$(run_claude ...)` from IMPLEMENT, REVIEW, CODEX, CODEX FIX, etc. — each call is in the same shell, so the global persists across the call. Multiple `run_claude` calls inside one stage (e.g., review fix-loop) will overwrite `LAST_RUN_TIMED_OUT` — that's fine, the stage records the last `run_claude` outcome at its `stage_end` point.

### Task 4 — `scripts/metrics-aggregate.mjs`

Node ESM script. CLI: `node scripts/metrics-aggregate.mjs --last N` (default N=10).

Logic:

1. Read all `*.ndjson` files in `.iago/state/pipeline-runs/`.
2. **Filter** — keep only files containing exactly one `pipeline_finalize` record (incomplete runs excluded; this is the filter step).
3. **Sort** — by the `ts` field of `pipeline_finalize` ascending.
4. **Take** — last N.
5. For each retained run, parse all `stage_start` / `stage_end` records into `{stage, duration_ms, timed_out, exit, skipped}` rows.
6. Aggregate per stage: count, mean, p50, p95, max, timeout count, skip count.
7. Print a fixed-width table to stdout. Columns: stage, n, p50_ms, p95_ms, max_ms, timeouts, skips.

**Order matters.** The user's stress note explicitly calls out filter-then-sort-then-take. Sorting first then filtering would produce wrong results when incomplete runs are interleaved chronologically; taking first then filtering would over-include. The implementation must follow filter → sort → take exactly.

Use built-in `node:fs` and `node:path`. No new deps. Compatible with Node 20 (project standard).

Exit 0 on success. Exit 1 with message if no complete runs found.

### Task 5 — Acceptance test

Add `scripts/lib/pipeline-telemetry.test.sh` — bash test script (manually runnable, not Vitest). Tests:

1. **Happy path** — source the helper, call `pipeline_init`, `stage_start foo`, `stage_end foo 0`, `pipeline_finalize 0`. Assert NDJSON file has 3 records: stage_start, stage_end, pipeline_finalize.
2. **Timeout flag** — call `pipeline_init`, `stage_start foo`, set `LAST_RUN_TIMED_OUT=true`, `stage_end foo 1`, `pipeline_finalize 0`. Assert `stage_end` record has `"timed_out":true`.
3. **Pipeline exit ≠ 0 path** — simulate the trap firing on an artificial failure. Easiest reproduction: write a small wrapper script that sources the helper, calls `pipeline_init`, then `false` (which exits 1 under `set -e`); the trap calls `pipeline_finalize 1`. Assert the NDJSON file contains a `pipeline_finalize` record with `pipeline_exit:1`.

Tests output `OK` / `FAIL` per case and exit non-zero on any failure. Document running them in the plan output: `bash scripts/lib/pipeline-telemetry.test.sh`.

A real end-to-end pipeline-failure run is out of scope for this plan (would require a fixture project and a real `claude -p` invocation). The artificial-failure shell test covers the trap behavior, which is the load-bearing concern.

### Task 6 — `.gitignore` update

Add `.iago/state/pipeline-runs/` to `.gitignore`. Telemetry files are local-only — they accumulate per-machine and would dirty the repo otherwise.

## Files Touched

- `scripts/lib/pipeline-telemetry.sh` (new)
- `scripts/lib/pipeline-telemetry.test.sh` (new)
- `scripts/metrics-aggregate.mjs` (new)
- `scripts/execute-pipeline.sh` (modified: source helper, add `PIPELINE_STARTED`, wire `stage_start`/`stage_end` at each labeled stage, extend EXIT trap, modify `run_claude` for `LAST_RUN_TIMED_OUT`)
- `.gitignore` (modified: ignore `.iago/state/pipeline-runs/`)

## Acceptance Criteria

- `bash scripts/lib/pipeline-telemetry.test.sh` exits 0 with all three test cases passing.
- A real pipeline run on any small plan produces a single NDJSON file under `.iago/state/pipeline-runs/`. The file contains: one `pipeline_init`-implicit start (or first record is a stage_start), matched `stage_start`/`stage_end` for every labeled stage that ran, and exactly one closing `pipeline_finalize` with `pipeline_exit:0`.
- `node scripts/metrics-aggregate.mjs --last 1` over that one run prints a stage table with 1 sample per stage and `p50_ms` populated.
- A test run with an artificial failure (e.g., `IAGO_TEST_FAIL_AFTER_INIT=1` env-gated `exit 1` injected into the script for manual verification, or just running on a known-failing fixture plan) produces a closing `pipeline_finalize` record with `pipeline_exit:1`.
- Existing pipeline behavior unchanged: same exit codes, same `.iago/summaries/` output, same PR creation flow. No regressions.
- The `.gitignore` entry is in place — running `git status` after a pipeline run shows no telemetry files.

## Stress Test

**Verdict: PROCEED_WITH_NOTES** — implementation can proceed; the notes below are pre-validated concerns from the planner and must be honored by the impl session.

### Notes for the implementation session

1. **`timed_out` wiring needs caller-visible signal.** `run_claude` is invoked synchronously via `$(run_claude ...)` from IMPLEMENT, REVIEW, CODEX, and CODEX FIX. The parent shell sees only the subshell's exit code, not internal state. Use a global `LAST_RUN_TIMED_OUT=true|false`, set inside `run_claude` (false at entry, true if the timeout branch at line 105 fires), reset inside `stage_start`. Read it inside `stage_end`. This is the reason a global is acceptable here — function-local state would not survive the subshell.

2. **`PIPELINE_STARTED` ordering.** Set it BEFORE any `stage_start` call, BEFORE the EXIT trap can fire on early failure. Concrete order:
   - Line 19: SCRIPT_DIR set.
   - **New:** Source `pipeline-telemetry.sh`. Define `PIPELINE_STARTED=false`.
   - Line 21–34: parse args.
   - Line 36–39: validate plan path.
   - **New:** Set `PIPELINE_STARTED=true` and call `pipeline_init` here.
   - Line 48: install (extended) EXIT trap.

   If we install the trap before `PIPELINE_STARTED=true`, the trap may fire on a parsing error and try to finalize an uninitialized run. The guard `[[ "$PIPELINE_STARTED" == "true" ]]` in the trap protects against that, but the cleaner ordering is: init globals → init pipeline state → install trap. Verify the order in the diff during review.

3. **Aggregator `--last N` order: filter-then-sort-then-take.** If you sort first, incomplete runs (no `pipeline_finalize`) at the top of the sorted list push valid ones out. If you take first, you might pick up partial runs and discard valid older ones. Filter (drop incomplete) → sort by `pipeline_finalize.ts` ascending → take last N. Implement in this exact order in the .mjs script.

4. **Acceptance test for `pipeline_exit != 0` path.** Add a shell test that sources the helper, registers the EXIT trap inline, calls `pipeline_init`, then forces `exit 1`. Assert the trap-emitted closing record exists with `pipeline_exit:1`. This is critical because the *whole point* of the trap-based finalize is failure observability — if the trap silently fails to write on exit≠0, we lose data on exactly the runs we care most about. The test must run in a separate subshell so the parent test runner doesn't actually exit.

### Cross-cutting checks (from CLAUDE.md review pipeline)

- **Auth/data-loss/race/rollback:** N/A — local telemetry only, no auth, no shared state, no concurrent writers (one pipeline holds the lock; one run-id per pipeline). Race-on-NDJSON-append is theoretical only — `>>` from a single process is atomic on Linux/Windows-Git-Bash for small writes.
- **No `any`/`as`/`@ts-ignore`:** N/A — the .mjs is plain Node, not TypeScript.
- **Backwards compat:** Existing pipeline must not change behavior. Verify by running the pipeline on a small plan before and after this change and diffing the `.iago/summaries/` output (should be identical).

## Out of Scope

- No dashboard or visualization beyond stdout table.
- No alerting / threshold checks.
- No retention policy — telemetry files accumulate; manual cleanup is fine for now.
- No upload to external metrics store.
- No multi-machine aggregation.
