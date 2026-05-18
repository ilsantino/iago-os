#!/usr/bin/env bash
# Sourceable helper for parsing the Claude adversarial-fallback verdict.
#
# The Claude `-p opus` fallback in execute-pipeline.sh emits a structured
# sentinel — `===VERDICT: CLEAN===` or `===VERDICT: ISSUES===` — on its own
# line at the end of its response. This module:
#   - Builds the prompt suffix that instructs the model to emit the sentinel.
#   - Parses the response file and returns CLEAN / ISSUES / UNKNOWN.
#
# Why a structured sentinel instead of prose-pattern matching:
#   The old parser greps for `\bCritical\b|\bImportant\b` which collides with
#   prose like "no Critical issues found". Sentinel is exact-string only.
#
# UNKNOWN is fail-safe: caller MUST escalate (treat as ISSUES) rather than
# defaulting to CLEAN — `.claude/rules/systematic-debugging.md`
# "no assumption when evidence absent".
#
# parse_adversarial_verdict accepts an empty / missing file: `tail -n 10` of
# a non-existent path returns "" with exit 1; the conditional below treats
# that as "no sentinel" → UNKNOWN → caller escalates. Documented intent —
# do NOT add an existence check that maps missing-file to a hard error.

# Source-guard — sourcing is the intended mode; execution makes no sense.
(return 0 2>/dev/null) || {
  echo "adversarial-verdict.sh: source this file, do not execute" >&2
  exit 1
}

readonly _ADVERSARIAL_SENTINEL_CLEAN='===VERDICT: CLEAN==='
readonly _ADVERSARIAL_SENTINEL_ISSUES='===VERDICT: ISSUES==='

# parse_adversarial_verdict <text_file>
#
# Echoes one of: CLEAN | ISSUES | UNKNOWN
# Returns 0 in all cases (CLEAN/ISSUES/UNKNOWN are all valid signals — the
# caller decides escalation policy).
#
# Window: scans the LAST 10 LINES of the file. `tail -3` (the original
# choice) misses sentinels followed by 4+ lines of model-emitted prose
# ("I emitted ISSUES because of X, Y, Z, W") — Plan 02 Stress C1.
#
# Anchor: read line-by-line, strip trailing whitespace (handles `\r` from
# Windows line endings and trailing spaces), then bash string-equality
# against the literal sentinel. NOT a regex — `[[ "$line" == "$SENTINEL" ]]`
# requires the whole line to equal the sentinel after trailing-ws strip, so
# a fenced-code-block line like `    ===VERDICT: ISSUES===` (leading
# 4-space indent) or `` `===VERDICT: ISSUES===` `` (backtick prefix) will
# NOT match — the leading non-sentinel chars are not stripped.
#
# Collision safety: if BOTH sentinels appear in the tail window, prefer
# ISSUES (fail-safe — escalate rather than skip).
parse_adversarial_verdict() {
  local file="$1"
  local tail_block
  tail_block=$(tail -n 10 "$file" 2>/dev/null || echo "")

  local has_clean=false
  local has_issues=false
  # Line-by-line scan with line-anchored exact match. Avoids `grep -F` (no
  # anchor support) and `grep -E` with escaped equals (regex parses fine,
  # but the line anchor is required for collision safety).
  while IFS= read -r line; do
    # Strip trailing whitespace (CR for Windows-line-ended responses, spaces).
    line="${line%"${line##*[![:space:]]}"}"
    if [[ "$line" == "$_ADVERSARIAL_SENTINEL_ISSUES" ]]; then
      has_issues=true
    elif [[ "$line" == "$_ADVERSARIAL_SENTINEL_CLEAN" ]]; then
      has_clean=true
    fi
  done <<<"$tail_block"

  if $has_issues; then
    echo ISSUES
    return 0
  fi
  if $has_clean; then
    echo CLEAN
    return 0
  fi
  echo UNKNOWN
  return 0
}

# format_adversarial_prompt_suffix
#
# Returns the literal prompt suffix to append to the Claude fallback `-p`
# string. Uses `printf` (not a heredoc) so leading whitespace cannot leak
# from the surrounding `bash` indentation — Plan 02 Stress I1.
format_adversarial_prompt_suffix() {
  printf '\n\nEnd your response with EXACTLY ONE of these sentinels on its own line, with NO surrounding markdown, NO backticks, NO bold formatting:\n%s  if you found NO actionable issues\n%s  if you listed any actionable issues above\nThe pipeline parser greps the last 10 lines for these literal strings. If neither sentinel appears, the run is escalated to manual review.\n' \
    "$_ADVERSARIAL_SENTINEL_CLEAN" \
    "$_ADVERSARIAL_SENTINEL_ISSUES"
}
