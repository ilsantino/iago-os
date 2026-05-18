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
  # 4 records: pipeline_init + stage_start + stage_end + pipeline_finalize.
  if [[ "$COUNT" == "4" ]]; then
    ok "happy path: 4 NDJSON records"
  else
    nope "happy path: expected 4 records, got $COUNT"
    cat "$RUN_FILE_PATH" >&2
  fi
  if grep -q '"type":"pipeline_init"' "$RUN_FILE_PATH"; then
    ok "happy path: pipeline_init record present"
  else
    nope "happy path: missing pipeline_init record"
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


# ─── Test 5: sessionId emitted when CLAUDE_CODE_SESSION_ID set ───────
TMP5=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMP5" PIPELINE_TMP="$TMP5" PLAN_NAME="test5" \
  CLAUDE_CODE_SESSION_ID="test-sess-abc123" \
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
  HITS=$(grep -c '"sessionId":"test-sess-abc123"' "$RUN_FILE_PATH" || true)
  if (( HITS >= 2 )); then
    ok "session_id emitted: $HITS records carry test-sess-abc123 (>=2)"
  else
    nope "session_id emitted: expected >=2 hits, got $HITS"
    cat "$RUN_FILE_PATH" >&2
  fi
else
  nope "session_id emitted: run file not created"
fi
rm -rf "$TMP5"

# ─── Test 6: parent synthesizes claude-* sessionId when env unset ──────
# Regression test for Codex C-01 PR review finding: `run_claude` exported
# CLAUDE_CODE_SESSION_ID inside a $(…) subshell, so the parent shell that
# later emits stage_end / pipeline_finalize saw empty sessionId. pipeline_init
# now synthesizes a per-run fallback in PARENT scope so every NDJSON record
# carries a non-empty id even when the orchestrator was launched without a
# real Claude session.
TMP6=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMP6" PIPELINE_TMP="$TMP6" PLAN_NAME="test6" \
  bash -c "
    set -uo pipefail
    unset CLAUDE_CODE_SESSION_ID
    . '$HELPER'
    pipeline_init
    stage_start foo
    stage_end foo 0
    pipeline_finalize 0
    echo \"\$RUN_FILE\"
  "
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  if grep -q '"sessionId":""' "$RUN_FILE_PATH"; then
    nope "session_id parent-synthesis: empty sessionId leaked into NDJSON (Codex C-01 regression)"
    cat "$RUN_FILE_PATH" >&2
  elif grep -qE '"sessionId":"claude-[0-9]{8}-[0-9]{6}-[^"]+"' "$RUN_FILE_PATH"; then
    SYNTH_HITS=$(grep -cE '"sessionId":"claude-' "$RUN_FILE_PATH")
    if (( SYNTH_HITS >= 3 )); then
      ok "session_id parent-synthesis: claude-* fallback present on all 3 record types when env unset"
    else
      nope "session_id parent-synthesis: only $SYNTH_HITS records carry claude-* fallback (need >=3: stage_start + stage_end + pipeline_finalize)"
      cat "$RUN_FILE_PATH" >&2
    fi
  else
    nope "session_id parent-synthesis: no claude-* fallback pattern found"
    cat "$RUN_FILE_PATH" >&2
  fi
else
  nope "session_id parent-synthesis: run file not created"
fi
rm -rf "$TMP6"

# ─── Test 7: per-stage emission-time capture (env change mid-flight) ───
TMP7=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMP7" PIPELINE_TMP="$TMP7" PLAN_NAME="test7" \
  bash -c "
    set -uo pipefail
    . '$HELPER'
    export CLAUDE_CODE_SESSION_ID=A
    pipeline_init
    stage_start foo
    export CLAUDE_CODE_SESSION_ID=B
    stage_end foo 0
    pipeline_finalize 0
    echo \"\$RUN_FILE\"
  "
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  START_OK=no
  END_OK=no
  grep '"type":"stage_start"' "$RUN_FILE_PATH" | grep -q '"sessionId":"A"' && START_OK=yes
  grep '"type":"stage_end"'   "$RUN_FILE_PATH" | grep -q '"sessionId":"B"' && END_OK=yes
  if [[ "$START_OK" == "yes" && "$END_OK" == "yes" ]]; then
    ok "session_id per-stage: stage_start=A, stage_end=B (emission-time read)"
  else
    nope "session_id per-stage: start_ok=$START_OK end_ok=$END_OK"
    cat "$RUN_FILE_PATH" >&2
  fi
else
  nope "session_id per-stage: run file not created"
fi
rm -rf "$TMP7"

# ─── Test 8: pipeline_finalize carries sessionId ───────────────────────
TMP8=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMP8" PIPELINE_TMP="$TMP8" PLAN_NAME="test8" \
  CLAUDE_CODE_SESSION_ID="finalize-sess-xyz" \
  bash -c "
    set -uo pipefail
    . '$HELPER'
    pipeline_init
    pipeline_finalize 0
    echo \"\$RUN_FILE\"
  "
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  if grep '"type":"pipeline_finalize"' "$RUN_FILE_PATH" | grep -q '"sessionId":"finalize-sess-xyz"'; then
    ok "session_id finalize: pipeline_finalize record carries sessionId"
  else
    nope "session_id finalize: missing sessionId on pipeline_finalize"
    cat "$RUN_FILE_PATH" >&2
  fi
else
  nope "session_id finalize: run file not created"
fi
rm -rf "$TMP8"

# ─── Test 9: JSON-escape literal `"` in session id ─────────────────────
TMP9=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMP9" PIPELINE_TMP="$TMP9" PLAN_NAME="test9" \
  bash -c '
    set -uo pipefail
    . "'"$HELPER"'"
    export CLAUDE_CODE_SESSION_ID="weird\"id"
    pipeline_init
    stage_start foo
    stage_end foo 0
    pipeline_finalize 0
    echo "$RUN_FILE"
  '
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  if grep -q '"sessionId":"weird\\"id"' "$RUN_FILE_PATH"; then
    ok "session_id json-escape: literal quote escaped as \\\""
  else
    nope "session_id json-escape: escape not preserved"
    cat "$RUN_FILE_PATH" >&2
  fi
else
  nope "session_id json-escape: run file not created"
fi
rm -rf "$TMP9"

# ─── Test 10: sessionId co-exists with stage_extra extras ──────────────
TMPA=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMPA" PIPELINE_TMP="$TMPA" PLAN_NAME="testA" \
  CLAUDE_CODE_SESSION_ID="extras-sess" \
  bash -c "
    set -uo pipefail
    . '$HELPER'
    pipeline_init
    stage_start build_gate
    stage_extra build_gate_mode '\"parallel\"'
    stage_end build_gate 0
    pipeline_finalize 0
    echo \"\$RUN_FILE\"
  "
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  SE_LINE=$(grep '"type":"stage_end"' "$RUN_FILE_PATH")
  if [[ -n "$SE_LINE" ]] \
      && echo "$SE_LINE" | grep -q '"sessionId":"extras-sess"' \
      && echo "$SE_LINE" | grep -q '"build_gate_mode":"parallel"'; then
    ok "session_id + extras: both sessionId and build_gate_mode present on stage_end"
  else
    nope "session_id + extras: missing one or both fields"
    echo "$SE_LINE" >&2
  fi
else
  nope "session_id + extras: run file not created"
fi
rm -rf "$TMPA"

# ─── Test 11: stage_extra refuses reserved 'sessionId' key ─────────────
TMPB=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMPB" PIPELINE_TMP="$TMPB" PLAN_NAME="testB" \
  CLAUDE_CODE_SESSION_ID="guard-sess" \
  bash -c "
    set -uo pipefail
    . '$HELPER'
    pipeline_init
    stage_start foo
    stage_extra sessionId '\"hijacked\"' 2>/dev/null && echo BUG_OK || echo GUARD_OK
    stage_end foo 0
    pipeline_finalize 0
    echo \"\$RUN_FILE\"
  "
)
RUN_FILE_LINE=$(echo "$RUN_FILE_PATH" | tail -1)
GUARD_LINE=$(echo "$RUN_FILE_PATH" | grep -E '^(GUARD_OK|BUG_OK)$' | head -1)
if [[ "$GUARD_LINE" == "GUARD_OK" && -f "$RUN_FILE_LINE" ]]; then
  HITS=$(grep -c '"sessionId":' "$RUN_FILE_LINE" || true)
  HIJACK=$(grep -c '"hijacked"' "$RUN_FILE_LINE" || true)
  if (( HITS >= 1 )) && (( HIJACK == 0 )); then
    ok "session_id guard: stage_extra 'sessionId' rejected; no hijacked value emitted"
  else
    nope "session_id guard: hijacked=$HIJACK sessionId_hits=$HITS"
    cat "$RUN_FILE_LINE" >&2
  fi
else
  nope "session_id guard: guard did not fire (line='$GUARD_LINE')"
fi
rm -rf "$TMPB"

# ─── Test 12: pipeline_init emits outer_session_id (RUN_SESSION_ID consumer) ─
TMPC=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMPC" PIPELINE_TMP="$TMPC" PLAN_NAME="testC" \
  CLAUDE_CODE_SESSION_ID="outer-init-sess" \
  bash -c "
    set -uo pipefail
    . '$HELPER'
    pipeline_init
    echo \"\$RUN_FILE\"
  "
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  INIT_LINE=$(grep '"type":"pipeline_init"' "$RUN_FILE_PATH")
  if [[ -n "$INIT_LINE" ]] && echo "$INIT_LINE" | grep -q '"outer_session_id":"outer-init-sess"'; then
    ok "pipeline_init: outer_session_id captured from CLAUDE_CODE_SESSION_ID at init"
  else
    nope "pipeline_init: outer_session_id missing or wrong (line='$INIT_LINE')"
  fi
else
  nope "pipeline_init: run file not created"
fi
rm -rf "$TMPC"

# ─── Test 13: outer_session_id is EMPTY when env unset (Opus PR #52 I2) ─
# Regression test for the misleading-field-name bug: prior code captured
# RUN_SESSION_ID AFTER the synthesis-export, so when the outer env was
# unset the pipeline_init record falsely reported the synthesized
# `claude-*` fallback as the "outer" session id. Plan 03's joiner would
# then think the run had an upstream session when it didn't. Fix captures
# the outer env BEFORE the synthesis-export.
TMPD=$(mktemp -d)
RUN_FILE_PATH=$(
  PROJECT_DIR="$TMPD" PIPELINE_TMP="$TMPD" PLAN_NAME="testD" \
  bash -c "
    set -uo pipefail
    unset CLAUDE_CODE_SESSION_ID
    . '$HELPER'
    pipeline_init
    echo \"\$RUN_FILE\"
  "
)
if [[ -n "$RUN_FILE_PATH" && -f "$RUN_FILE_PATH" ]]; then
  INIT_LINE=$(grep '"type":"pipeline_init"' "$RUN_FILE_PATH")
  if [[ -n "$INIT_LINE" ]] && echo "$INIT_LINE" | grep -q '"outer_session_id":""'; then
    ok "pipeline_init: outer_session_id is empty when env unset (I2)"
  else
    nope "pipeline_init: outer_session_id leaked synth fallback (I2 regression): $INIT_LINE"
  fi
else
  nope "pipeline_init: run file not created (Test 13)"
fi
rm -rf "$TMPD"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] || exit 1
