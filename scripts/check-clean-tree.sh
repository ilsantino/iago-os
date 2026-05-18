#!/usr/bin/env bash
# Pre-flight clean-tree check for /iago-execute.
#
# Replaces the implicit `git status` check that false-positives on:
#   - `git worktree` metadata under `.claude/worktrees/`
#   - gitignored untracked artifacts under `.iago/state/`
# in an otherwise clean tree.
#
# Usage:
#   scripts/check-clean-tree.sh [--project-dir DIR] [--strict]
#
# Env:
#   IAGO_CLEAN_TREE_QUIET=1   suppress the .gitignore-coverage WARNING
#                              (the verdict line on stdout is unaffected)
#
# Exit codes:
#   0   tree is clean (after applicable lenient filters)
#   1   tree is dirty — offending lines printed on stdout after `DIRTY:`
#   64  usage error (unknown arg)
#   65  PROJECT_DIR is not a git repository
#
# Lenient mode (default): filters out `.claude/worktrees/` + `.iago/state/`
# untracked entries; honors `.gitignore` already (because git status with
# `--untracked-files=normal` does so by default).
#
# Strict mode (`--strict`): emits the raw `git status --porcelain=v1` output
# without filtering — catches ANY untracked file regardless of path.
#
# Telemetry (DUAL-MODE — Plan 02 Stress I5):
#   - Standalone invocation (from the `/iago-execute` orchestrator session):
#     `pipeline-telemetry.sh` is NOT sourced; the emit guard short-circuits
#     and no NDJSON record is written. This is the intended path today.
#   - Pipeline invocation (if a future stage chains this script): the helper
#     IS sourced and `RUN_FILE` is writable, so one `clean_tree_check` event
#     is appended with `mode` + `verdict` + `sessionId` + `ts`.
# This script does NOT source the telemetry helper itself — it only emits if
# the caller has already sourced it and exported RUN_FILE.

set -euo pipefail

PROJECT_DIR="$(pwd)"
STRICT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    --strict) STRICT=true; shift ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "ERROR: unknown arg: $1" >&2; exit 64 ;;
  esac
done

if ! cd "$PROJECT_DIR" 2>/dev/null; then
  echo "ERROR: cannot cd to $PROJECT_DIR" >&2
  exit 65
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: not a git repo: $PROJECT_DIR" >&2
  exit 65
fi

# Codex P1 fix: hard-fail (exit 1) when .iago/state/ is not gitignored in
# lenient mode. The previous warn-then-filter behavior let a repo without
# the ignore rule pass pre-flight, then have NDJSON / lock artifacts staged
# downstream by `git add -A` (which only excludes secrets). Failing here
# forces the operator to fix the underlying gitignore bug.
#
# Strict mode skips this check — strict mode does not filter `.iago/state/`
# entries anyway, so it would catch them itself.
#
# Env IAGO_CLEAN_TREE_QUIET=1 suppresses the stderr explanation but does
# NOT downgrade the exit code — the gate stays closed regardless.
if [[ "$STRICT" != "true" ]]; then
  _iago_state_ignored=true
  if [[ -f .gitignore ]]; then
    grep -q '\.iago/state/' .gitignore 2>/dev/null || _iago_state_ignored=false
  else
    _iago_state_ignored=false
  fi
  if [[ "$_iago_state_ignored" != "true" ]]; then
    if [[ "${IAGO_CLEAN_TREE_QUIET:-0}" != "1" ]]; then
      echo "ERROR: .iago/state/ is not covered by .gitignore — refusing to filter pipeline-state artifacts" >&2
      echo "       Add the line  .iago/state/  to .gitignore (or set IAGO_CLEAN_TREE_STRICT=1 to bypass the filter entirely)." >&2
    fi
    echo "DIRTY:"
    echo ".iago/state/ not in .gitignore (lenient filter would mask pipeline-state artifacts)"
    exit 1
  fi
fi

# `--untracked-files=all` (NOT `=normal`) so the porcelain output lists each
# untracked file with its full path. With `=normal`, git collapses untracked
# directories to a single `?? path/to/dir/` line, which would defeat the
# substring filter for `.claude/worktrees/agent-xyz/foo.txt`-style entries.
STATUS=$(git status --porcelain=v1 --untracked-files=all 2>/dev/null || echo "")

if [[ "$STRICT" == "true" ]]; then
  FILTERED="$STATUS"
else
  # `!!` lines come from `--ignored`; not requested here, but filter defensively.
  # `.claude/worktrees/` catches the local worktree convention.
  # `.iago/state/` catches the pipeline-lock dir + pipeline-runs NDJSON.
  FILTERED=$(echo "$STATUS" | grep -vE '^!! ' | grep -vE '^\?\? \.claude/worktrees/' | grep -vE '^\?\? \.iago/state/' || true)
fi

# Telemetry emit (dual-mode — see header). Guard against unset RUN_FILE,
# CURRENT_STAGE not initialized, etc. A failure here must NEVER alter the
# exit verdict of this script.
__emit_telemetry() {
  local verdict_word="$1"
  local mode_word="lenient"
  [[ "$STRICT" == "true" ]] && mode_word="strict"
  [[ -z "${RUN_FILE:-}" ]] && return 0
  [[ ! -w "${RUN_FILE}" ]] && return 0
  local sid="${CLAUDE_CODE_SESSION_ID:-}"
  sid="${sid//\"/\\\"}"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"type":"clean_tree_check","mode":"%s","verdict":"%s","ts":"%s","sessionId":"%s"}\n' \
    "$mode_word" "$verdict_word" "$ts" "$sid" >> "$RUN_FILE" 2>/dev/null || true
}

if [[ -z "$FILTERED" ]]; then
  echo "CLEAN"
  __emit_telemetry clean
  exit 0
fi

echo "DIRTY:"
echo "$FILTERED"
__emit_telemetry dirty
exit 1
