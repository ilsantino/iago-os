#!/usr/bin/env bash
# Pipeline telemetry helper — sourced by execute-pipeline.sh.
# Emits NDJSON records per pipeline run for offline aggregation.
# Self-contained: bash, date, mkdir, cat, printf only.

# Detect millisecond timestamp support once. Git Bash on Windows supports %3N.
if date -u +%s%3N 2>/dev/null | grep -qE '^[0-9]+$'; then
  __PIPELINE_HAVE_MS=true
else
  __PIPELINE_HAVE_MS=false
fi

__pipeline_now_ms() {
  if [[ "$__PIPELINE_HAVE_MS" == "true" ]]; then
    date -u +%s%3N
  else
    echo "$(($(date -u +%s) * 1000))"
  fi
}

__pipeline_now_iso() {
  date -u -Iseconds 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ
}

# run_claude is invoked via $(run_claude ...) which runs in a subshell.
# Variable assignments inside the subshell do not propagate back to the parent.
# Use a sentinel file as the cross-subshell signal for timeout state.
__pipeline_read_timed_out() {
  if [[ -n "${LAST_RUN_TIMED_OUT_FILE:-}" && -f "$LAST_RUN_TIMED_OUT_FILE" ]]; then
    cat "$LAST_RUN_TIMED_OUT_FILE"
  else
    echo "${LAST_RUN_TIMED_OUT:-false}"
  fi
}

__pipeline_write_timed_out() {
  local val="$1"
  if [[ -n "${LAST_RUN_TIMED_OUT_FILE:-}" ]]; then
    echo "$val" > "$LAST_RUN_TIMED_OUT_FILE"
  fi
  LAST_RUN_TIMED_OUT="$val"
}

# Stage-scoped latch: once a timeout fires within a stage, it stays true until
# stage_end reads it. Prevents a later run_claude call from clearing the flag
# of an earlier timed-out call inside the same stage (review fix-loop, codex
# fix, etc.).
__pipeline_latch_timed_out() {
  if [[ -n "${LAST_RUN_TIMED_OUT_FILE:-}" && -f "$LAST_RUN_TIMED_OUT_FILE" ]]; then
    if [[ "$(cat "$LAST_RUN_TIMED_OUT_FILE")" == "true" ]]; then
      return 0
    fi
  fi
  __pipeline_write_timed_out false
}

# Initialize one run. Sets RUN_ID, RUN_FILE, RUN_STARTED_AT, LAST_RUN_TIMED_OUT_FILE.
# Idempotent: callable once per pipeline invocation.
pipeline_init() {
  if [[ -n "${RUN_ID:-}" ]]; then
    return 0
  fi
  local plan_name="${PLAN_NAME:-unknown}"
  local stamp
  stamp=$(date -u +%Y%m%d-%H%M%S)
  RUN_ID="${stamp}-${plan_name}-${RANDOM}"
  local runs_dir="${PROJECT_DIR:-.}/.iago/state/pipeline-runs"
  mkdir -p "$runs_dir"
  RUN_FILE="$runs_dir/${RUN_ID}.ndjson"
  RUN_STARTED_AT=$(__pipeline_now_ms)
  STAGE_START_MS=0
  CURRENT_STAGE=""
  LAST_RUN_TIMED_OUT_FILE="${PIPELINE_TMP:-/tmp}/.pipeline-last-timed-out-$$"
  __pipeline_write_timed_out false
  : >> "$RUN_FILE"
}

# Mark stage start. Resets timed_out signal and records wall-clock start.
stage_start() {
  [[ -z "${RUN_FILE:-}" ]] && return 0
  local stage="$1"
  __pipeline_write_timed_out false
  CURRENT_STAGE="$stage"
  STAGE_START_MS=$(__pipeline_now_ms)
  printf '{"type":"stage_start","stage":"%s","ts":"%s"}\n' \
    "$stage" "$(__pipeline_now_iso)" >> "$RUN_FILE"
}

# Mark stage end. Reads timed_out signal, writes duration_ms.
# exit_code may be a number or the literal "skipped".
stage_end() {
  [[ -z "${RUN_FILE:-}" ]] && return 0
  local stage="$1"
  local exit_code="$2"
  local now duration timed_out
  now=$(__pipeline_now_ms)
  duration=$(( now - ${STAGE_START_MS:-$now} ))
  timed_out=$(__pipeline_read_timed_out)
  printf '{"type":"stage_end","stage":"%s","exit":"%s","duration_ms":%s,"timed_out":%s,"ts":"%s"}\n' \
    "$stage" "$exit_code" "$duration" "$timed_out" "$(__pipeline_now_iso)" >> "$RUN_FILE"
  CURRENT_STAGE=""
}

# Final record. Called from EXIT trap with pipeline-level exit code.
# Auto-emits stage_end for an in-progress stage so partial runs aren't orphaned.
pipeline_finalize() {
  [[ -z "${RUN_FILE:-}" ]] && return 0
  local exit_code="$1"
  if [[ -n "${CURRENT_STAGE:-}" ]]; then
    stage_end "$CURRENT_STAGE" "$exit_code"
  fi
  local now duration
  now=$(__pipeline_now_ms)
  duration=$(( now - ${RUN_STARTED_AT:-$now} ))
  printf '{"type":"pipeline_finalize","plan":"%s","pipeline_exit":%s,"duration_ms":%s,"ts":"%s"}\n' \
    "${PLAN_NAME:-unknown}" "$exit_code" "$duration" "$(__pipeline_now_iso)" >> "$RUN_FILE"
}
