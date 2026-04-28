#!/usr/bin/env bash
# Tests for scripts/lib/build-gate.sh — both sequential (IAGO_PARALLEL_BUILD=0)
# and parallel (=1) paths. Stubs `npx tsc` and `npx vite` via
# IAGO_BUILD_GATE_*_CMD overrides so the tests don't need a real project.
#
# Stress-test concern #4 (bitrot): the parallel path is default-off and would
# silently rot without a CI gate. This test file IS that gate — every change
# to lib/build-gate.sh must keep both modes passing.
#
# Run: bash scripts/test-build-gate.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib/build-gate.sh"

PASS=0
FAIL=0
FAIL_DETAILS=()

assert() {
  local label="$1" cond="$2"
  if [[ "$cond" == "true" ]]; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label"
    FAIL=$((FAIL + 1))
    FAIL_DETAILS+=("$label")
  fi
}

# Per-test scratch dir replaces both PROJECT_DIR and PIPELINE_TMP. The
# stubbed commands write marker files there so we can verify what ran and
# in what order.
mk_scratch() {
  local d
  d=$(mktemp -d -t build-gate-test.XXXXXX)
  echo "$d"
}

echo "Sequential mode (IAGO_PARALLEL_BUILD=0):"

# ── Case 1: both pass ──────────────────────────────────────────────
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=true; HAS_VITE=true
IAGO_PARALLEL_BUILD=0
IAGO_BUILD_GATE_TSC_CMD="echo tsc-ok"
IAGO_BUILD_GATE_VITE_CMD="echo vite-ok"
EXIT=0; run_build_gate || EXIT=$?
[[ $EXIT -eq 0 ]] && C=true || C=false
assert "seq: both pass returns 0" "$C"
[[ "$BUILD_GATE_MODE" == "sequential" ]] && C=true || C=false
assert "seq: BUILD_GATE_MODE=sequential" "$C"
[[ "$BUILD_GATE_OUTPUT" == *"# --- tsc --noEmit ---"* && "$BUILD_GATE_OUTPUT" == *"tsc-ok"* ]] && C=true || C=false
assert "seq: output has tsc label and stdout" "$C"
[[ "$BUILD_GATE_OUTPUT" == *"# --- vite build ---"* && "$BUILD_GATE_OUTPUT" == *"vite-ok"* ]] && C=true || C=false
assert "seq: output has vite label and stdout" "$C"
[[ "$BUILD_GATE_TSC_MS" =~ ^[0-9]+$ && "$BUILD_GATE_VITE_MS" =~ ^[0-9]+$ ]] && C=true || C=false
assert "seq: durations are numeric" "$C"
rm -rf "$S"

# ── Case 2: tsc fails, vite passes (sequential) ────────────────────
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=true; HAS_VITE=true
IAGO_PARALLEL_BUILD=0
IAGO_BUILD_GATE_TSC_CMD="echo TS2304: missing && exit 1"
IAGO_BUILD_GATE_VITE_CMD="echo vite-ok"
EXIT=0; run_build_gate || EXIT=$?
[[ $EXIT -ne 0 ]] && C=true || C=false
assert "seq: tsc-fail returns non-zero" "$C"
[[ "$BUILD_GATE_OUTPUT" == *"TS2304"* && "$BUILD_GATE_OUTPUT" == *"vite-ok"* ]] && C=true || C=false
assert "seq: tsc-fail output preserves both stderrs (defensive assembly)" "$C"
rm -rf "$S"

# ── Case 3: vite fails (sequential) ────────────────────────────────
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=true; HAS_VITE=true
IAGO_PARALLEL_BUILD=0
IAGO_BUILD_GATE_TSC_CMD="echo tsc-ok"
IAGO_BUILD_GATE_VITE_CMD="echo VITE_BUILD_ERROR && exit 1"
EXIT=0; run_build_gate || EXIT=$?
[[ $EXIT -ne 0 ]] && C=true || C=false
assert "seq: vite-fail returns non-zero" "$C"
[[ "$BUILD_GATE_OUTPUT" == *"tsc-ok"* && "$BUILD_GATE_OUTPUT" == *"VITE_BUILD_ERROR"* ]] && C=true || C=false
assert "seq: vite-fail output preserves both labeled streams" "$C"
rm -rf "$S"

# ── Case 4: neither config present (sequential) ────────────────────
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=false; HAS_VITE=false
IAGO_PARALLEL_BUILD=0
EXIT=0; run_build_gate || EXIT=$?
[[ $EXIT -eq 0 ]] && C=true || C=false
assert "seq: no configs returns 0 (skipped)" "$C"
[[ -z "$BUILD_GATE_OUTPUT" ]] && C=true || C=false
assert "seq: no configs leaves output empty" "$C"
rm -rf "$S"

echo
echo "Parallel mode (IAGO_PARALLEL_BUILD=1):"

# ── Case 5: both pass (parallel) ───────────────────────────────────
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=true; HAS_VITE=true
IAGO_PARALLEL_BUILD=1
IAGO_BUILD_GATE_TSC_CMD="echo tsc-ok-par"
IAGO_BUILD_GATE_VITE_CMD="echo vite-ok-par"
EXIT=0; run_build_gate || EXIT=$?
[[ $EXIT -eq 0 ]] && C=true || C=false
assert "par: both pass returns 0" "$C"
[[ "$BUILD_GATE_MODE" == "parallel" ]] && C=true || C=false
assert "par: BUILD_GATE_MODE=parallel" "$C"
[[ "$BUILD_GATE_OUTPUT" == *"# --- tsc --noEmit ---"* && "$BUILD_GATE_OUTPUT" == *"tsc-ok-par"* ]] && C=true || C=false
assert "par: output has tsc label" "$C"
[[ "$BUILD_GATE_OUTPUT" == *"# --- vite build ---"* && "$BUILD_GATE_OUTPUT" == *"vite-ok-par"* ]] && C=true || C=false
assert "par: output has vite label" "$C"
rm -rf "$S"

# ── Case 6: parallel wall time ≈ max(tsc, vite), not sum ───────────
# Each leg sleeps 2s. Sequential would be ~4s+; parallel should be ~2s plus
# subshell overhead. Generous 3500ms cap absorbs Windows fork latency while
# still failing if the parallel path silently regresses to sequential.
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=true; HAS_VITE=true
IAGO_PARALLEL_BUILD=1
IAGO_BUILD_GATE_TSC_CMD="sleep 2 && echo tsc-slow"
IAGO_BUILD_GATE_VITE_CMD="sleep 2 && echo vite-slow"
T0=$(__build_gate_now_ms)
EXIT=0; run_build_gate || EXIT=$?
T1=$(__build_gate_now_ms)
WALL=$(( T1 - T0 ))
[[ $EXIT -eq 0 ]] && C=true || C=false
assert "par: slow-both returns 0" "$C"
# Sequential would land near 4000ms+. Parallel should stay under 3500ms.
if (( WALL < 3500 )); then C=true; else C=false; fi
assert "par: wall=${WALL}ms is concurrent (max), not sequential (sum)" "$C"
# Verify timing globals captured non-zero values (guards against tsc_start never recorded)
[[ "$BUILD_GATE_TSC_MS" -gt 0 && "$BUILD_GATE_VITE_MS" -gt 0 ]] && C=true || C=false
assert "par: slow-both TSC_MS and VITE_MS both non-zero (timing recorded)" "$C"
rm -rf "$S"

# ── Case 7: tsc fails fast, vite long-running — survivor MUST be killed ─
# Without survivor cleanup, a 5-second vite would stretch wall time to ~5s
# even though tsc fails immediately. With cleanup, wall time stays small.
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=true; HAS_VITE=true
IAGO_PARALLEL_BUILD=1
IAGO_BUILD_GATE_TSC_CMD="exit 1"
IAGO_BUILD_GATE_VITE_CMD="sleep 5 && echo vite-late"
T0=$(__build_gate_now_ms)
EXIT=0; run_build_gate || EXIT=$?
T1=$(__build_gate_now_ms)
WALL=$(( T1 - T0 ))
[[ $EXIT -ne 0 ]] && C=true || C=false
assert "par: tsc-fail-fast returns non-zero" "$C"
# If survivor was killed, wall stays well under the vite sleep (5000ms).
# Allow up to 2500ms for taskkill latency on Windows.
if (( WALL < 2500 )); then C=true; else C=false; fi
assert "par: survivor killed (wall=${WALL}ms < 2500ms cap)" "$C"
# Output should still carry both labels — defensive assembly even on partial fail.
[[ "$BUILD_GATE_OUTPUT" == *"# --- tsc --noEmit ---"* && "$BUILD_GATE_OUTPUT" == *"# --- vite build ---"* ]] && C=true || C=false
assert "par: tsc-fail output keeps both labels (defensive assembly)" "$C"
rm -rf "$S"

# ── Case 8: vite fails fast, tsc long-running — survivor MUST be killed ─
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=true; HAS_VITE=true
IAGO_PARALLEL_BUILD=1
IAGO_BUILD_GATE_TSC_CMD="sleep 5 && echo tsc-late"
IAGO_BUILD_GATE_VITE_CMD="exit 1"
T0=$(__build_gate_now_ms)
EXIT=0; run_build_gate || EXIT=$?
T1=$(__build_gate_now_ms)
WALL=$(( T1 - T0 ))
[[ $EXIT -ne 0 ]] && C=true || C=false
assert "par: vite-fail-fast returns non-zero" "$C"
if (( WALL < 2500 )); then C=true; else C=false; fi
assert "par: survivor killed when vite fails first (wall=${WALL}ms)" "$C"
rm -rf "$S"

# ── Case 9: only vite present (parallel) ───────────────────────────
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=false; HAS_VITE=true
IAGO_PARALLEL_BUILD=1
IAGO_BUILD_GATE_VITE_CMD="echo vite-only"
EXIT=0; run_build_gate || EXIT=$?
[[ $EXIT -eq 0 ]] && C=true || C=false
assert "par: vite-only returns 0" "$C"
[[ "$BUILD_GATE_OUTPUT" == *"# --- vite build ---"* && "$BUILD_GATE_OUTPUT" != *"# --- tsc --noEmit ---"* ]] && C=true || C=false
assert "par: vite-only output omits tsc label" "$C"
rm -rf "$S"

# ── Case 10: only tsc present (parallel) ──────────────────────────
S=$(mk_scratch)
PROJECT_DIR="$S"; PIPELINE_TMP="$S"
HAS_TSCONFIG=true; HAS_VITE=false
IAGO_PARALLEL_BUILD=1
IAGO_BUILD_GATE_TSC_CMD="echo tsc-only"
EXIT=0; run_build_gate || EXIT=$?
[[ $EXIT -eq 0 ]] && C=true || C=false
assert "par: tsc-only returns 0" "$C"
[[ "$BUILD_GATE_OUTPUT" == *"# --- tsc --noEmit ---"* && "$BUILD_GATE_OUTPUT" != *"# --- vite build ---"* ]] && C=true || C=false
assert "par: tsc-only output omits vite label" "$C"
rm -rf "$S"

echo
echo "Result: $PASS passed, $FAIL failed"
if [[ $FAIL -gt 0 ]]; then
  echo "Failures:"
  for d in "${FAIL_DETAILS[@]}"; do echo "  - $d"; done
  exit 1
fi
exit 0
