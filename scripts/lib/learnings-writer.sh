#!/usr/bin/env bash
# Learnings writer — sourceable helper.
#
# Fail-loud replacement for the silent `printf >> $LEARNINGS_DIR/patterns.md`
# pattern. Bug being fixed: a chmod 0500 parent or full disk would cause the
# write to fail with no signal — reviewers thought learnings were captured
# while the file was actually untouched.
#
# Usage:
#   . scripts/lib/learnings-writer.sh
#   learnings_write "pattern-key" "$markdown_body"
#
# Required env: PROJECT_DIR (writer derives LEARNINGS_DIR="$PROJECT_DIR/.iago/learnings").
# Optional env:
#   LEARNINGS_WRITE_MODE     fail-loud (default) | fallback
#   LEARNINGS_FALLBACK_DIR   default "$PROJECT_DIR/.iago/logs"
#
# Return codes:
#   0   success (or fallback write succeeded)
#   1   fail-loud mode and the write failed
#   64  usage error (missing args)
#
# Telemetry: when sourced alongside pipeline-telemetry.sh and a RUN_FILE is
# present, emits one of:
#   - {"type":"learnings_written", ...}
#   - {"type":"learnings_write_failed", ...}
#   - {"type":"learnings_written_to_fallback", ...}
# Each event carries sessionId = ${CLAUDE_CODE_SESSION_ID:-} at emission time.

# File-scope helper so it isn't redefined on every learnings_write call.
# Reads $key, $mode, $sid, $ts from the caller's local scope.
__learnings_emit_event() {
  local ev_type="$1"
  local ev_path="$2"
  local ev_err="${3:-}"
  [[ -z "${RUN_FILE:-}" ]] && return 0
  [[ ! -w "${RUN_FILE:-/nonexistent}" ]] && return 0
  local ev_ts
  if command -v __pipeline_now_iso >/dev/null 2>&1; then
    ev_ts=$(__pipeline_now_iso)
  else
    ev_ts="${ts:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  fi
  # Escape literal `"`, newline, and tab so multi-line stderr (rare but
  # possible on some shells/printf failures) cannot break NDJSON
  # one-record-per-line invariant.
  local p="${ev_path//\"/\\\"}"
  p="${p//$'\n'/\\n}"
  p="${p//$'\t'/\\t}"
  local e="${ev_err//\"/\\\"}"
  e="${e//$'\n'/\\n}"
  e="${e//$'\t'/\\t}"
  local k="${key//\"/\\\"}"
  k="${k//$'\n'/\\n}"
  k="${k//$'\t'/\\t}"
  printf '{"type":"%s","key":"%s","path":"%s","mode":"%s","err":"%s","ts":"%s","sessionId":"%s"}\n' \
    "$ev_type" "$k" "$p" "$mode" "$e" "$ev_ts" "$sid" >> "$RUN_FILE"
}

learnings_write() {
  if [[ $# -lt 2 ]]; then
    echo "learnings_write: usage: learnings_write <key> <body>" >&2
    return 64
  fi

  local key="$1"
  local body="$2"
  local mode="${LEARNINGS_WRITE_MODE:-fail-loud}"
  local proj="${PROJECT_DIR:-.}"
  local learnings_dir="$proj/.iago/learnings"
  local target="$learnings_dir/patterns.md"
  local fallback_dir="${LEARNINGS_FALLBACK_DIR:-$proj/.iago/logs}"

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  local sid="${CLAUDE_CODE_SESSION_ID:-}"
  sid="${sid//\"/\\\"}"

  # Best-effort mkdir — failure is not fatal here, the write will surface it.
  mkdir -p "$learnings_dir" 2>/dev/null || true

  local err
  err=$(printf '\n## %s — %s\n\n%s\n' "$ts" "$key" "$body" 2>&1 >> "$target")
  local write_rc=$?

  if (( write_rc == 0 )); then
    __learnings_emit_event "learnings_written" "$target" ""
    return 0
  fi

  if [[ "$mode" == "fallback" ]]; then
    mkdir -p "$fallback_dir" 2>/dev/null || true
    local fb_ts
    fb_ts=$(date -u +%Y%m%d-%H%M%S)
    local fb_path="$fallback_dir/learnings-fallback-${fb_ts}-$$.md"
    local fb_err
    fb_err=$(printf '\n## %s — %s\n\n%s\n' "$ts" "$key" "$body" 2>&1 >> "$fb_path")
    local fb_rc=$?
    if (( fb_rc == 0 )); then
      echo "learnings_write: WARNING — primary write failed ($err); fell back to $fb_path" >&2
      __learnings_emit_event "learnings_written_to_fallback" "$fb_path" "$err"
      return 0
    fi
    echo "learnings_write: FAIL — both primary ($target) and fallback ($fb_path) failed: $err / $fb_err" >&2
    __learnings_emit_event "learnings_write_failed" "$target" "$err"
    return 1
  fi

  echo "learnings_write: FAIL — could not write to $target: $err" >&2
  __learnings_emit_event "learnings_write_failed" "$target" "$err"
  return 1
}
