#!/usr/bin/env bash
# Pipeline telemetry helper — sourced by execute-pipeline.sh.
# Emits NDJSON records per pipeline run for offline aggregation.
# Self-contained: bash, date, mkdir, cat, printf only.
#
# sessionId scope (read carefully — design choice, not a bug):
#   - Every NDJSON record carries sessionId = CLAUDE_CODE_SESSION_ID READ AT
#     EMISSION TIME (not at pipeline_init time).
#   - pipeline_init captures the outer env once into RUN_SESSION_ID and emits a
#     `pipeline_init` NDJSON record so the orchestrator's session (if any) is
#     pinned at the start. RUN_SESSION_ID is NOT synthesized and NOT exported.
#   - run_claude (in execute-pipeline.sh) synthesizes a `claude-{RUN_ID}-...`
#     id and exports it ONLY within its own `$(run_claude ...)` subshell so the
#     spawned `claude -p` process inherits it. That synthesis intentionally
#     does NOT reach the parent shell — therefore stage_end/pipeline_finalize
#     records emitted in the PARENT after the subshell returns will carry the
#     OUTER env value (empty string if unset). The synthesized id correlates
#     the SPAWNED child's own telemetry, not the wrapping stage record.
#   - Codex finding on PR #50 noted this gap; the plan explicitly accepts it
#     (Plan 03 owns the cross-record projection that joins parent stage
#     records to child-spawned session ids via timestamp + RUN_ID).
# JSON-escape scope: literal `"` only (UUID-shaped session ids never contain \n or \t).

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
  # Session-id contract (parent-scope synthesis — see Codex PR review of C-01):
  #   1. CLAUDE_CODE_SESSION_ID inherited from parent (real Claude Code session)
  #      → preserve it as-is.
  #   2. Unset/empty → synthesize ONE per-pipeline fallback id in PARENT scope.
  # Synthesizing here (not inside run_claude) is load-bearing: run_claude is
  # called as `$(cd ... && run_claude ...)`, which spawns a subshell. An export
  # inside that subshell never reaches the parent shell that later emits
  # stage_end / pipeline_finalize, so a fallback exported only there silently
  # writes `sessionId:""` into NDJSON records.
  local _sid_now="${EPOCHSECONDS:-$(date +%s)}"
  if command -v __pipeline_now_ms >/dev/null 2>&1; then
    _sid_now=$(__pipeline_now_ms)
  fi
  export CLAUDE_CODE_SESSION_ID="${CLAUDE_CODE_SESSION_ID:-claude-${RUN_ID}-${_sid_now}-${RANDOM}}"
  # Capture session id at init time for diagnostics. Emission sites read the
  # live env value (not RUN_SESSION_ID) for forward compatibility.
  RUN_SESSION_ID="${CLAUDE_CODE_SESSION_ID}"
  local runs_dir="${PROJECT_DIR:-.}/.iago/state/pipeline-runs"
  mkdir -p "$runs_dir"
  RUN_FILE="$runs_dir/${RUN_ID}.ndjson"
  RUN_STARTED_AT=$(__pipeline_now_ms)
  STAGE_START_MS=0
  STAGE_EXTRAS=""
  CURRENT_STAGE=""
  LAST_RUN_TIMED_OUT_FILE="${PIPELINE_TMP:-/tmp}/.pipeline-last-timed-out"
  __pipeline_write_timed_out false
  : >> "$RUN_FILE"
  # Pin the outer (orchestrator) session-id once at init. Downstream Plan 03
  # joiner uses this to bind parent stage records to the spawn series even when
  # run_claude exports a synthesized id only into its subshell.
  local _outer_sid="${RUN_SESSION_ID//\"/\\\"}"
  printf '{"type":"pipeline_init","plan":"%s","run_id":"%s","outer_session_id":"%s","ts":"%s"}\n' \
    "$plan_name" "$RUN_ID" "$_outer_sid" "$(__pipeline_now_iso)" >> "$RUN_FILE"
}

# Mark stage start. Resets timed_out signal and records wall-clock start.
stage_start() {
  [[ -z "${RUN_FILE:-}" ]] && return 0
  local stage="$1"
  __pipeline_write_timed_out false
  CURRENT_STAGE="$stage"
  STAGE_START_MS=$(__pipeline_now_ms)
  STAGE_EXTRAS=""
  local _sid="${CLAUDE_CODE_SESSION_ID:-}"
  _sid="${_sid//\"/\\\"}"
  printf '{"type":"stage_start","stage":"%s","ts":"%s","sessionId":"%s"}\n' \
    "$stage" "$(__pipeline_now_iso)" "$_sid" >> "$RUN_FILE"
}

# Attach a numeric extra field to the current stage. Appended to stage_end.
# Plan 06 uses this for tsc_duration_ms / vite_duration_ms; future stages can
# add their own keys without changing the helper signature.
# Caller passes a raw JSON value (number, true/false, or "quoted string"); the
# helper does not quote — keeps the door open for non-numeric extras.
stage_extra() {
  [[ -z "${RUN_FILE:-}" ]] && return 0
  local key="$1"
  local val="$2"
  # sessionId is sourced from CLAUDE_CODE_SESSION_ID at emission time —
  # forbid stage_extra "sessionId" to prevent duplicate keys in stage_end.
  if [[ "$key" == "sessionId" ]]; then
    echo "stage_extra: 'sessionId' is reserved — use CLAUDE_CODE_SESSION_ID env" >&2
    return 1
  fi
  STAGE_EXTRAS="${STAGE_EXTRAS},\"${key}\":${val}"
}

# Mark stage end. Reads timed_out signal, writes duration_ms, appends any
# extras attached via stage_extra during the stage.
# exit_code may be a number or the literal "skipped".
stage_end() {
  [[ -z "${RUN_FILE:-}" ]] && return 0
  local stage="$1"
  local exit_code="$2"
  local now duration timed_out
  now=$(__pipeline_now_ms)
  duration=$(( now - ${STAGE_START_MS:-$now} ))
  timed_out=$(__pipeline_read_timed_out)
  local _sid="${CLAUDE_CODE_SESSION_ID:-}"
  _sid="${_sid//\"/\\\"}"
  # sessionId inserted BEFORE STAGE_EXTRAS so legacy aggregators that split
  # on `,"ts"` continue working (extras still flow into the trailing slot).
  printf '{"type":"stage_end","stage":"%s","exit":"%s","duration_ms":%s,"timed_out":%s,"sessionId":"%s"%s,"ts":"%s"}\n' \
    "$stage" "$exit_code" "$duration" "$timed_out" "$_sid" "${STAGE_EXTRAS:-}" "$(__pipeline_now_iso)" >> "$RUN_FILE"
  CURRENT_STAGE=""
  STAGE_EXTRAS=""
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
  local _sid="${CLAUDE_CODE_SESSION_ID:-}"
  _sid="${_sid//\"/\\\"}"
  printf '{"type":"pipeline_finalize","plan":"%s","pipeline_exit":"%s","duration_ms":%s,"sessionId":"%s","ts":"%s"}\n' \
    "${PLAN_NAME:-unknown}" "$exit_code" "$duration" "$_sid" "$(__pipeline_now_iso)" >> "$RUN_FILE"
}
