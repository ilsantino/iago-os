---
plan: 06-wedge-e-tsc-vite-parallel-build
phase: feature-pipeline-speed-wedges
status: ready
spec: docs/specs/parallel-execution-wedges.md
wave: 2
depends_on: 01-measurement-protocol
---

# Plan 06 — Wedge E — `tsc` || `vite build` Parallel

## Goal

Run `tsc --noEmit` and `vite build` concurrently in the build gate (`run_build_gate`, lines 279–296 in `scripts/execute-pipeline.sh`). Vite already runs its own internal tsc, but the explicit `tsc --noEmit` adds wall time when run sequentially. Concurrency saves the smaller of (tsc time, vite time) per build attempt.

## Approach

Refactor `run_build_gate`:

```bash
run_build_gate() {
  BUILD_GATE_OUTPUT=""
  local tsc_pid="" vite_pid=""
  local tsc_out="$PIPELINE_TMP/tsc.out" vite_out="$PIPELINE_TMP/vite.out"
  local tsc_exit=0 vite_exit=0

  if $HAS_TSCONFIG; then
    ( cd "$PROJECT_DIR" && npx tsc --noEmit > "$tsc_out" 2>&1 ) &
    tsc_pid=$!
  fi
  if $HAS_VITE; then
    ( cd "$PROJECT_DIR" && npx vite build > "$vite_out" 2>&1 ) &
    vite_pid=$!
  fi

  [[ -n "$tsc_pid"  ]] && { wait "$tsc_pid"  || tsc_exit=$?;  }
  [[ -n "$vite_pid" ]] && { wait "$vite_pid" || vite_exit=$?; }

  BUILD_GATE_OUTPUT="$(cat "$tsc_out" 2>/dev/null)
$(cat "$vite_out" 2>/dev/null)"

  [[ $tsc_exit -eq 0 && $vite_exit -eq 0 ]]
}
```

Both must pass. Either failing means the gate fails; the existing retry/fix logic is unchanged.

## Risk: memory contention on Windows

Two concurrent TypeScript processes (explicit tsc + vite's internal tsc) on a 16GB Windows machine may hit OOM. Acceptance must include a memory-pressure verification run. If contention causes OOM, gate behind `IAGO_PARALLEL_BUILD=1` env var (default off, opt-in until verified safe).

## Tasks

1. Refactor `run_build_gate` per the snippet above.
2. Add env-var gate: `${IAGO_PARALLEL_BUILD:-0}` controls parallel vs sequential; default sequential (1 = parallel, 0 = sequential). Document in CLAUDE.md or pipeline doc.
3. Memory-pressure test: run on a 16GB Windows box (or an artificially-constrained Docker container) on a representative React 19 + Vite project. Capture peak RSS of both processes. If peak > 70% of available RAM, document the constraint and keep behind the env-var.
4. Telemetry: record both `tsc_duration_ms` and `vite_duration_ms` separately inside the `build_gate` stage record.

## Acceptance

- With `IAGO_PARALLEL_BUILD=1`: build wall time = `max(tsc_time, vite_time)` ± shell overhead.
- With `IAGO_PARALLEL_BUILD=0` or unset: behavior matches current sequential.
- Memory-pressure test on 16GB box documented (peak RSS, OOM yes/no, recommendation).
- Build error output preserved correctly when one or both processes fail (no truncation, both stderrs reach the fix session).

## Out of Scope

- Parallelizing other build targets (test runners, linters) — those are stages 2b (console) and preflight (plan 04).
- Switching to `tsc --build` mode or incremental builds.

## Stress Test

**VERDICT: PROCEED_WITH_NOTES**

### Important

1. **Orphaned process on failure.** If tsc OOMs and `wait $tsc_pid` returns non-zero, vite keeps running and consumes memory while the fix session starts. Add cleanup: kill the surviving process before returning. Without this, retry loop N+1 starts vite N+2 while vite N+1 is still alive.

2. **Bash version floor unspecified.** `wait $pid1 $pid2` multi-pid behavior differs in bash <5.1. Git Bash on Windows is 5.2 but plan must declare the floor explicitly so future contributors don't downgrade.

3. **`BUILD_GATE_OUTPUT` partial under early-exit.** Function-scope `set -e` interaction with background subshells can leave `BUILD_GATE_OUTPUT` empty if the function exits before assembling. Fix session then receives no error context. Use defensive assembly: always concat available `tsc_out` + `vite_out` files even on partial failure.

4. **`IAGO_PARALLEL_BUILD` flag bitrot risk.** Default-off means parallel path can silently bitrot. CI must test BOTH `IAGO_PARALLEL_BUILD=0` and `=1` on every change to `run_build_gate`. Add this to acceptance.

5. **Telemetry contract with plan 01 unstated.** Task 4 adds new fields (`tsc_duration_ms`, `vite_duration_ms`) to `build_gate` stage record. Plan 01's `stage_end` helper must support arbitrary key-value extras, OR plan 06 must explicitly extend the helper. Either declare a schema-extension contract in Task 4 or accept that an implementer may bypass the library entirely with raw `echo`.

### Minor

6. **Subshell `(...)` style mismatch.** Surrounding code uses `cd "$PROJECT_DIR" && npx ...` (no subshell); plan snippet uses `( cd ... && npx ...) &`. Add comment noting the subshell is intentional (cd isolation) so an implementer doesn't simplify it away.

7. **No labeled separator in `BUILD_GATE_OUTPUT`.** When both fail, fixer can't tell which output is tsc vs vite. Add `# --- tsc ---` / `# --- vite build ---` headers.

8. **Memory threshold "70% → document and keep behind env-var"** is just documentation, not mitigation. Define what happens when threshold is exceeded: hard-block parallel mode, or just warn?

9. **`depends_on: 01` does not block on 01 being merged.** If plan 06 ships before plan 01, telemetry fields have no receiver.
