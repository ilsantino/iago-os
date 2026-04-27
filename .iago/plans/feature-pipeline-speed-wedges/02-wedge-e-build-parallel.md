---
phase: feature-pipeline-speed-wedges
plan: 02
wave: 2
depends_on: ["01-measurement-protocol"]
context: docs/specs/parallel-execution-wedges.md
created: 2026-04-27
revised: 2026-04-27
source: feature
---

# Plan: feature-pipeline-speed-wedges/02-wedge-e-build-parallel

## Goal

Run `npx tsc --noEmit` and `npx vite build` concurrently inside the build gate. Preserve all failure semantics — both must pass for the gate to pass. **Default `IAGO_BUILD_PARALLEL=false`** until verification on a representative plan confirms no memory regression; flip to `true` in a follow-up commit. Memory profiling is opt-in via a separate flag (one-time measurement, not always-on telemetry).

## Design decisions (post-revision)

- **Default off, flip after verification.** Spec gates the default behind measurement; ship safely.
- **Explicit `wait $pid; ec=$? || true` pattern** to survive `set -euo pipefail`.
- **Memory probe is opt-in via `IAGO_BUILD_PARALLEL_VERIFY=true`.** Eliminates the always-on watcher overhead, the watcher-termination problem, and the Windows PID-mismatch dead-end. The probe fires only when an operator sets the verification flag; verification runs are the only time peak memory matters.
- **`stage_end` extension via third arg.** Pass `extras_json` (per Plan 01 revised signature: `stage_end NAME EXIT_CODE EXTRAS_JSON`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/execute-pipeline.sh` | Refactor `run_build_gate` for concurrent dispatch with explicit wait pattern |
| create | `.iago/metrics/wedge-e-verification.md` | Record memory/timing measurements before flipping default |
| modify | `.claude/rules/execution-pipeline.md` | Document `IAGO_BUILD_PARALLEL` and `IAGO_BUILD_PARALLEL_VERIFY` flags |

## Tasks

### Task 1: Refactor `run_build_gate` with explicit wait/exit-code semantics

- **files:** `scripts/execute-pipeline.sh`
- **action:** Replace the body of `run_build_gate()` (lines ~279-296) with:
  ```bash
  run_build_gate() {
    BUILD_GATE_OUTPUT=""
    local mode="${IAGO_BUILD_PARALLEL:-false}"
    local ok=true tsc_ec=0 vite_ec=0
    local tsc_out_file="$PIPELINE_TMP/build-tsc.out"
    local vite_out_file="$PIPELINE_TMP/build-vite.out"

    if [[ "$mode" == "true" ]]; then
      log "BUILD GATE — mode: parallel"
      local tsc_pid=0 vite_pid=0
      if $HAS_TSCONFIG; then
        ( cd "$PROJECT_DIR" && npx tsc --noEmit > "$tsc_out_file" 2>&1 ) &
        tsc_pid=$!
      fi
      if $HAS_VITE; then
        ( cd "$PROJECT_DIR" && npx vite build > "$vite_out_file" 2>&1 ) &
        vite_pid=$!
      fi
      [[ $tsc_pid -ne 0 ]] && { wait "$tsc_pid"  || tsc_ec=$?; }
      [[ $vite_pid -ne 0 ]] && { wait "$vite_pid" || vite_ec=$?; }
    else
      log "BUILD GATE — mode: sequential"
      if $HAS_TSCONFIG; then
        ( cd "$PROJECT_DIR" && npx tsc --noEmit > "$tsc_out_file" 2>&1 ) || tsc_ec=$?
      fi
      if $HAS_VITE; then
        ( cd "$PROJECT_DIR" && npx vite build > "$vite_out_file" 2>&1 ) || vite_ec=$?
      fi
    fi

    [[ -f "$tsc_out_file"  ]] && BUILD_GATE_OUTPUT="=== tsc ===
$(cat "$tsc_out_file")
"
    [[ -f "$vite_out_file" ]] && BUILD_GATE_OUTPUT="${BUILD_GATE_OUTPUT}=== vite ===
$(cat "$vite_out_file")"

    [[ $tsc_ec -ne 0 || $vite_ec -ne 0 ]] && ok=false
    if ! $HAS_TSCONFIG && ! $HAS_VITE; then
      log "No tsconfig.json or vite config found — build gate skipped"
      ok=true
    fi
    $ok
  }
  ```
  Critical points: each `wait` MUST use `|| ec=$?` so `set -euo pipefail` doesn't abort on first failure; both temp files are unconditionally concatenated when present so dual-failure mode preserves both error sets; the `mode` log line declares which path ran for diagnostics.
- **verify:** `grep -n 'wait "\$tsc_pid"  || tsc_ec\|=== tsc ===' scripts/execute-pipeline.sh | head -5`
- **expected:** Both patterns present

### Task 2: Default `IAGO_BUILD_PARALLEL=false`

- **files:** `scripts/execute-pipeline.sh`
- **action:** No new code beyond what Task 1 already does (`${IAGO_BUILD_PARALLEL:-false}`). Add a comment near the top of the script (after arg parsing) documenting the default and the flip plan: "Default `false` until `wedge-e-verification.md` confirms no Windows memory regression. Flip to `true` in a follow-up commit referencing the verification doc."
- **verify:** `grep -n 'IAGO_BUILD_PARALLEL' scripts/execute-pipeline.sh | head -5`
- **expected:** ≥ 2 matches (default-false comment + read in `run_build_gate`)

### Task 3: Opt-in memory probe via `IAGO_BUILD_PARALLEL_VERIFY=true`

- **files:** `scripts/execute-pipeline.sh`
- **action:** Inside `run_build_gate` only when `IAGO_BUILD_PARALLEL_VERIFY=true` AND parallel mode is active, launch a background memory watcher. Keep the implementation simple — the goal is one-time human-readable verification, not always-on telemetry:
  ```bash
  if [[ "${IAGO_BUILD_PARALLEL_VERIFY:-false}" == "true" && "$mode" == "true" ]]; then
    (
      # NB: no `local` here — `local` only works inside a function, not a plain subshell.
      # Use plain assignments so the subshell doesn't crash silently.
      tsc_peak=0
      vite_peak=0
      WATCH_DEADLINE=$(( $(date +%s) + 1200 ))   # 20 min safety bound
      while :; do
        # Wall-clock guard so a stuck PID never deadlocks the build gate
        [[ $(date +%s) -ge $WATCH_DEADLINE ]] && break
        # Guard against PID=0 (single-tool projects: vite_pid may be 0)
        tsc_alive=false
        vite_alive=false
        [[ "$tsc_pid"  -ne 0 ]] && kill -0 "$tsc_pid"  2>/dev/null && tsc_alive=true
        [[ "$vite_pid" -ne 0 ]] && kill -0 "$vite_pid" 2>/dev/null && vite_alive=true
        $tsc_alive || $vite_alive || break
        if command -v ps >/dev/null 2>&1; then
          if $tsc_alive; then
            rss=$(ps -o rss= -p "$tsc_pid" 2>/dev/null | tr -d ' ')
            [[ -n "$rss" && "$rss" -gt "$tsc_peak" ]] && tsc_peak="$rss"
          fi
          if $vite_alive; then
            rss=$(ps -o rss= -p "$vite_pid" 2>/dev/null | tr -d ' ')
            [[ -n "$rss" && "$rss" -gt "$vite_peak" ]] && vite_peak="$rss"
          fi
        fi
        sleep 1
      done
      echo "tsc_peak_kb=$tsc_peak"  > "$PIPELINE_TMP/build-mem.txt"
      echo "vite_peak_kb=$vite_peak" >> "$PIPELINE_TMP/build-mem.txt"
    ) &
    BUILD_WATCHER_PID=$!
  fi
  ```
  After both `wait`s, `wait "$BUILD_WATCHER_PID" 2>/dev/null || true` to reap the watcher (since the loop exits when both PIDs are gone). Document in a comment: "memory probe is best-effort. Git Bash on Windows may report 0 (POSIX/Windows PID mismatch). For authoritative measurements, use Task Manager or PowerShell `Get-Process` during the verification run."
- **verify:** `grep -n 'IAGO_BUILD_PARALLEL_VERIFY\|build-mem.txt' scripts/execute-pipeline.sh | head -5`
- **expected:** Both patterns present

### Task 4: Capture build exit code and pipe peak-memory to `stage_end` extras

- **files:** `scripts/execute-pipeline.sh`
- **action:** First, capture the build exit code at the build-retry loop boundary. The current `while true; do if run_build_gate; then ...; break; else ...; fi; done` loop (lines 298-329) does NOT preserve a numeric exit code variable for downstream consumers — fix this by setting `build_exit_code=0` on the success path (`break`) and `build_exit_code=1` on the hard-fail path (`exit 1` is replaced by `build_exit_code=$?; PIPELINE_EXIT=1; exit 1` so Plan 01's emission still records the failure correctly via the EXIT trap). Then, in the parent script POST-build-gate (NOT inside `run_build_gate`), construct extras JSON from `$PIPELINE_TMP/build-mem.txt` if present:
  ```bash
  BUILD_EXTRAS='{}'
  if [[ -f "$PIPELINE_TMP/build-mem.txt" ]]; then
    tsc_kb=$(grep '^tsc_peak_kb=' "$PIPELINE_TMP/build-mem.txt"  | cut -d= -f2)
    vite_kb=$(grep '^vite_peak_kb=' "$PIPELINE_TMP/build-mem.txt" | cut -d= -f2)
    BUILD_EXTRAS="{\"tsc_peak_kb\":${tsc_kb:-0},\"vite_peak_kb\":${vite_kb:-0},\"mode\":\"${IAGO_BUILD_PARALLEL:-false}\"}"
  else
    BUILD_EXTRAS="{\"mode\":\"${IAGO_BUILD_PARALLEL:-false}\"}"
  fi
  stage_end BUILD "$build_exit_code" "$BUILD_EXTRAS"
  ```
  Plan 01's `stage_end` accepts `extras_json` as the third arg; pass it directly. When the verification flag isn't set, only `mode` ships in extras (no peak values).
- **verify:** `grep -n 'BUILD_EXTRAS\|tsc_peak_kb\|build_exit_code=' scripts/execute-pipeline.sh | head -5`
- **expected:** All three identifiers present

### Task 5: Verification document for memory contention check

- **files:** `.iago/metrics/wedge-e-verification.md`
- **action:** Markdown stub with sections: `## Sequential baseline`, `## Parallel run`, `## Decision`. Each section has a table: `plan | total_build_s | tsc_peak_mb | vite_peak_mb | oom_observed`. Operator runs the pipeline twice on the same plan: first with `IAGO_BUILD_PARALLEL=false` (sequential baseline), then with `IAGO_BUILD_PARALLEL=true IAGO_BUILD_PARALLEL_VERIFY=true` (parallel + probe). Operator fills the tables. Decision rule (defined here, not left to runtime judgment): flip default to `true` if `parallel_total_build_s ≤ sequential_total_build_s × 1.0` AND `oom_observed == false` AND `peak_total_mb < 4096` (4 GB). Otherwise keep default `false`. The 20% regression threshold from the original plan is replaced with this concrete rule.
- **verify:** `grep -n 'Sequential baseline\|Parallel run\|Decision' .iago/metrics/wedge-e-verification.md`
- **expected:** All three section headers present

### Task 6: Behavioral equivalence test

- **files:** `.iago/metrics/wedge-e-verification.md`
- **action:** Add a `## Behavioral equivalence` section to the verification doc describing the regression check the operator runs as part of verification: introduce a deliberate type error (e.g., `const x: number = "string";` in a temp file); confirm `IAGO_BUILD_PARALLEL=false` exits non-zero; confirm `IAGO_BUILD_PARALLEL=true` ALSO exits non-zero. Both modes must catch the same error class. If they diverge, the parallel implementation is broken.
- **verify:** `grep -n 'Behavioral equivalence' .iago/metrics/wedge-e-verification.md`
- **expected:** ≥ 1 match

### Task 7: Document the env vars in execution-pipeline.md

- **files:** `.claude/rules/execution-pipeline.md`
- **action:** Add rows to the Control Flags table:
  - `IAGO_BUILD_PARALLEL` — default `false`. When `true`, runs `tsc --noEmit` and `vite build` concurrently. Flip to `true` only after `wedge-e-verification.md` Decision section is filled.
  - `IAGO_BUILD_PARALLEL_VERIFY` — default `false`. When `true` AND `IAGO_BUILD_PARALLEL=true`, runs a best-effort peak-memory probe; results land in metrics record `extras` and `wedge-e-verification.md`. Used during the one-time verification run.
  Use Bash shell-redirect (file is hook-protected). Add a one-paragraph note: "parallel build is opt-in until verified. Memory probing is opt-in always — Git Bash on Windows may report 0 due to PID-layer mismatch; treat as best-effort."
- **verify:** `grep -n 'IAGO_BUILD_PARALLEL\|IAGO_BUILD_PARALLEL_VERIFY' .claude/rules/execution-pipeline.md`
- **expected:** Both flags documented

## Stress Test

**Verdict:** PROCEED_WITH_NOTES (revised)
**Date:** 2026-04-27 (re-stress after revision)

The three critical findings from the previous round have been addressed inline:
- **`local` in subshell** → fixed in Task 3 (now uses plain assignments in the watcher subshell).
- **`build_exit_code` undefined** → fixed in Task 4 (variable now captured at the build-retry loop boundary).
- **`kill -0 0` infinite loop** → fixed in Task 3 (PID=0 guards added; 20-min wall-clock deadline as final safety bound).

### Remaining Important

- **Insertion-order coupling with Plan 01.** Task 4's `BUILD_EXTRAS` construction must happen BEFORE `stage_end BUILD ...` is called. Implementer must verify Plan 01's BUILD stage wrap point, then insert the extras logic immediately before it. Verify: search the script for `stage_end BUILD` and confirm `BUILD_EXTRAS=` precedes it on the same code path.
- **Equivalence test must run before flipping default.** `wedge-e-verification.md` Decision section is filled only after the deliberate-type-error check passes in both modes. Operator discipline; no automation.

### Remaining Minor

- Decision threshold `× 1.0` is a no-regression bar, not a speedup criterion. Consider `× 0.85` (15% improvement required) to justify operational complexity. Operator's call.
- Memory probe is best-effort on Windows Git Bash (POSIX/Windows PID layer mismatch). Documented in Task 3 comment; surface in `wedge-e-verification.md` notes.

## Verification

```
grep -q 'wait "\$tsc_pid"  || tsc_ec' scripts/execute-pipeline.sh \
  && grep -q '\${IAGO_BUILD_PARALLEL:-false}' scripts/execute-pipeline.sh \
  && grep -q 'IAGO_BUILD_PARALLEL_VERIFY' scripts/execute-pipeline.sh \
  && grep -q '=== tsc ===' scripts/execute-pipeline.sh \
  && test -f .iago/metrics/wedge-e-verification.md \
  && grep -q 'Behavioral equivalence' .iago/metrics/wedge-e-verification.md \
  && grep -q 'IAGO_BUILD_PARALLEL_VERIFY' .claude/rules/execution-pipeline.md \
  && echo "Plan 02 verified"
```

Expected: `Plan 02 verified`. Field test: run a representative plan twice with `IAGO_BUILD_PARALLEL=false` and `=true IAGO_BUILD_PARALLEL_VERIFY=true`. Fill `wedge-e-verification.md`. Run the deliberate-type-error equivalence check. If Decision rule passes, ship a follow-up commit flipping the default to `true`.
