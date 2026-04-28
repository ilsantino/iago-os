#!/usr/bin/env bash
# Manual test for pipeline-telemetry.sh
# Run: bash scripts/lib/pipeline-telemetry.test.sh
# Exits 0 with all OK; non-zero on any FAIL.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$SCRIPT_DIR/pipeline-telemetry.sh"

if [[ ! -f "$HELPER" ]]; then
  echo "FAIL: helper not found at $HELPER"
  exit 1
fi

PASS=0
FAIL=0

ok()   { echo "OK:   $1"; PASS=$((PASS + 1)); }
nope() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# ─── Test 1: Happy path — 3 NDJSON records ────────────────────────────
TMP1=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMP1" PIPELINE_TMP="$TMP1" PLAN_NAME="test1" \
  bash -c "
    set -uo pipefail
    . '$HELPER'
    pipeline_init
    stage_start foo
    stage_end foo 0
    pipeline_finalize 0
    echo \"\$RUN_FILE\"
  "
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  COUNT=$(grep -c '"type":' "$RUN_FILE_PATH" 2>/dev/null || echo 0)
  if [[ "$COUNT" == "3" ]]; then
    ok "happy path: 3 NDJSON records"
  else
    nope "happy path: expected 3 records, got $COUNT"
    cat "$RUN_FILE_PATH" >&2
  fi
  if grep -q '"type":"stage_start"' "$RUN_FILE_PATH"; then
    ok "happy path: stage_start record present"
  else
    nope "happy path: missing stage_start record"
  fi
  if grep -q '"type":"stage_end"' "$RUN_FILE_PATH"; then
    ok "happy path: stage_end record present"
  else
    nope "happy path: missing stage_end record"
  fi
  if grep -q '"type":"pipeline_finalize"' "$RUN_FILE_PATH"; then
    ok "happy path: pipeline_finalize record present"
  else
    nope "happy path: missing pipeline_finalize record"
  fi
else
  nope "happy path: run file not created (path='$RUN_FILE_PATH')"
fi
rm -rf "$TMP1"

# ─── Test 2: Timeout flag ─────────────────────────────────────────────
TMP2=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMP2" PIPELINE_TMP="$TMP2" PLAN_NAME="test2" \
  bash -c "
    set -uo pipefail
    . '$HELPER'
    pipeline_init
    stage_start foo
    __pipeline_write_timed_out true
    stage_end foo 1
    pipeline_finalize 0
    echo \"\$RUN_FILE\"
  "
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  if grep -q '"type":"stage_end".*"timed_out":true' "$RUN_FILE_PATH"; then
    ok "timeout flag: stage_end records timed_out:true"
  else
    nope "timeout flag: missing timed_out:true on stage_end"
    cat "$RUN_FILE_PATH" >&2
  fi
else
  nope "timeout flag: run file not created"
fi
rm -rf "$TMP2"

# ─── Test 3: EXIT trap fires on exit != 0 ─────────────────────────────
TMP3=$(mktemp -d)
RUN_FILE_PATH_FILE="$TMP3/run-file-path"
PROJECT_DIR="$TMP3" PIPELINE_TMP="$TMP3" PLAN_NAME="test3" \
bash -c "
  set -uo pipefail
  . '$HELPER'
  PIPELINE_STARTED=false
  trap '__exit=\$?; [[ \"\$PIPELINE_STARTED\" == \"true\" ]] && pipeline_finalize \"\$__exit\"' EXIT
  pipeline_init
  PIPELINE_STARTED=true
  echo \"\$RUN_FILE\" > '$RUN_FILE_PATH_FILE'
  exit 1
" || true
RUN_FILE_PATH=$(cat "$RUN_FILE_PATH_FILE" 2>/dev/null || echo "")
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  if grep -q '"type":"pipeline_finalize".*"pipeline_exit":"1"' "$RUN_FILE_PATH"; then
    ok "exit-nonzero: pipeline_finalize records pipeline_exit:\"1\""
  else
    nope "exit-nonzero: missing pipeline_exit:\"1\" in pipeline_finalize"
    cat "$RUN_FILE_PATH" >&2
  fi
else
  nope "exit-nonzero: run file not created (path='$RUN_FILE_PATH')"
fi
rm -rf "$TMP3"


# ─── Test 4: Stage-scoped timeout latch ─────────────────────────────
# Simulates a multi-call stage (e.g., review fix-loop) where the first
# claude call times out and the second succeeds. The stage_end record
# must still report timed_out:true.
TMP4=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMP4" PIPELINE_TMP="$TMP4" PLAN_NAME="test4" \
  bash -c "
    set -uo pipefail
    . '$HELPER'
    pipeline_init
    stage_start review
    # First call: times out
    __pipeline_latch_timed_out
    __pipeline_write_timed_out true
    # Second call inside the same stage: latch keeps the flag true
    __pipeline_latch_timed_out
    # (would normally write false at entry but latch sees prior true)
    stage_end review 0
    pipeline_finalize 0
    echo \"\$RUN_FILE\"
  "
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  if grep -q '"type":"stage_end".*"stage":"review".*"timed_out":true' "$RUN_FILE_PATH"; then
    ok "stage-scoped latch: timed_out persists across multiple run_claude calls"
  else
    nope "stage-scoped latch: timeout cleared by second call"
    cat "$RUN_FILE_PATH" >&2
  fi
else
  nope "stage-scoped latch: run file not created"
fi
rm -rf "$TMP4"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] || exit 1
