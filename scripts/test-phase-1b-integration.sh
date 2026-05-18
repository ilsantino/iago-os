#!/usr/bin/env bash
# Phase 1b end-to-end integration test. Exercises the 4 bug fixes from
# feature-phase-1b-pipeline-tooling against controlled fixtures. Run after
# Plan 01 + Plan 02 commits land.
#
# Usage:
#   scripts/test-phase-1b-integration.sh [--section 1|2|3|4|all]
#
# Sections:
#   1 — sessionId plumbing through telemetry NDJSON
#   2 — learnings writer fail-loud + fallback + telemetry
#   3 — clean-tree guard (lenient filter, --strict, real dirt)
#   4 — adversarial fallback verdict sentinel parser
#
# Exit code: 0 if all requested sections pass; non-zero otherwise.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SECTION="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --section) SECTION="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -uo/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERROR: unknown arg: $1" >&2; exit 64 ;;
  esac
done

# Top-level cleanup (Stress I1): collect every mktemp dir + restore perms on
# exit so any locked sub-path cannot leak as undeletable cruft.
_all_tmp_dirs=()
cleanup_all() {
  local d
  for d in "${_all_tmp_dirs[@]:-}"; do
    [[ -z "$d" ]] && continue
    chmod -R 0700 "$d" 2>/dev/null || true
    rm -rf "$d" 2>/dev/null || true
  done
}
trap cleanup_all EXIT

S1_RESULT="?"; S2_RESULT="?"; S3_RESULT="?"; S4_RESULT="?"

# ─── Section 1 — sessionId plumbing ───────────────────────────────────────
# Asserts emission-time env read per Plan 01 contract (telemetry helpers read
# ${CLAUDE_CODE_SESSION_ID:-} at the moment they print, not at pipeline_init
# capture time). If this section FAILS but Plan 01 sub-tests PASS, the
# contract was violated — investigate scripts/lib/pipeline-telemetry.sh first.
section_1() {
  echo "── Section 1: sessionId plumbing ─────────────────────────"
  local fails=0 tmp
  tmp=$(mktemp -d); _all_tmp_dirs+=("$tmp")

  # 1a — explicit sessionId set BEFORE pipeline_init: all 3 stage records
  # (start + end + finalize) must carry that exact id.
  (
    set +e
    cd "$tmp"
    export CLAUDE_CODE_SESSION_ID=integ-test-sess-001
    export PROJECT_DIR="$tmp" PLAN_NAME=integ-explicit PIPELINE_TMP="$tmp"
    # shellcheck source=lib/pipeline-telemetry.sh
    . "$SCRIPT_DIR/lib/pipeline-telemetry.sh"
    pipeline_init
    stage_start integ
    stage_end integ 0
    pipeline_finalize 0
    echo "$RUN_FILE"
  ) > "$tmp/.run1" 2>/dev/null
  local run1; run1=$(tail -n 1 "$tmp/.run1")
  if [[ -f "$run1" ]]; then
    local hits; hits=$(grep -c '"sessionId":"integ-test-sess-001"' "$run1" 2>/dev/null || echo 0)
    if (( hits >= 3 )); then
      echo "  PASS  1a: explicit sessionId appears in $hits records"
    else
      echo "  FAIL  1a: expected ≥3 sessionId hits, got $hits"
      fails=$((fails+1))
    fi
  else
    echo "  FAIL  1a: RUN_FILE missing at $run1"
    fails=$((fails+1))
  fi

  # 1b — unset CLAUDE_CODE_SESSION_ID: pipeline_init synthesizes a fallback
  # `claude-{RUN_ID}-{ms}-{rand}`. Records carry the synthesized id, NOT "".
  # (Plan 03 source-text predates the Codex PR-50 fix that introduced the
  # synth; the contract-as-shipped is non-empty fallback.)
  (
    set +e
    cd "$tmp"
    unset CLAUDE_CODE_SESSION_ID
    export PROJECT_DIR="$tmp" PLAN_NAME=integ-unset PIPELINE_TMP="$tmp"
    unset RUN_ID RUN_FILE RUN_STARTED_AT STAGE_START_MS CURRENT_STAGE
    # shellcheck source=lib/pipeline-telemetry.sh
    . "$SCRIPT_DIR/lib/pipeline-telemetry.sh"
    pipeline_init
    stage_start integ
    stage_end integ 0
    pipeline_finalize 0
    echo "$RUN_FILE"
  ) > "$tmp/.run2" 2>/dev/null
  local run2; run2=$(tail -n 1 "$tmp/.run2")
  # Opus PR #57 dual-review I2: Plan 03 §Section 1 was written against
  # the prior contract that asserted `sessionId:""` when env unset. The
  # shipped behavior was changed in PR #52 (commit e061734) —
  # pipeline_init now synthesizes a `claude-*` fallback in PARENT scope
  # so every NDJSON record carries a non-empty id. This assertion locks
  # the new contract. See `scripts/lib/pipeline-telemetry.sh` docblock
  # for the full rationale.
  if [[ -f "$run2" ]] && grep -q '"sessionId":"claude-' "$run2"; then
    echo "  PASS  1b: unset → synthesized fallback sessionId emitted"
  else
    echo "  FAIL  1b: synthesized fallback missing in $run2"
    fails=$((fails+1))
  fi

  # 1c — mid-flight env change: start sees A, end sees B. Validates that the
  # helpers read env at emission time (not cached at pipeline_init).
  (
    set +e
    cd "$tmp"
    export CLAUDE_CODE_SESSION_ID=mid-flight-A
    export PROJECT_DIR="$tmp" PLAN_NAME=integ-midflight PIPELINE_TMP="$tmp"
    unset RUN_ID RUN_FILE RUN_STARTED_AT STAGE_START_MS CURRENT_STAGE
    # shellcheck source=lib/pipeline-telemetry.sh
    . "$SCRIPT_DIR/lib/pipeline-telemetry.sh"
    pipeline_init
    stage_start integ
    export CLAUDE_CODE_SESSION_ID=mid-flight-B
    stage_end integ 0
    pipeline_finalize 0
    echo "$RUN_FILE"
  ) > "$tmp/.run3" 2>/dev/null
  local run3; run3=$(tail -n 1 "$tmp/.run3")
  if [[ -f "$run3" ]] \
      && grep -q '"type":"stage_start".*"sessionId":"mid-flight-A"' "$run3" \
      && grep -q '"type":"stage_end".*"sessionId":"mid-flight-B"' "$run3"; then
    echo "  PASS  1c: stage_start sees A, stage_end sees B (emission-time read)"
  else
    echo "  FAIL  1c: mid-flight env change not reflected in NDJSON"
    grep -E '"type":"stage_(start|end)"' "$run3" 2>/dev/null | head -2
    fails=$((fails+1))
  fi

  if (( fails == 0 )); then S1_RESULT="PASS"; else S1_RESULT="FAIL"; fi
}

# ─── Section 2 — learnings writer fail-loud + fallback ───────────────────
section_2() {
  echo "── Section 2: learnings writer ────────────────────────────"
  local fails=0 tmp
  tmp=$(mktemp -d); _all_tmp_dirs+=("$tmp")

  # 2a — happy path
  (
    set +e
    export PROJECT_DIR="$tmp" PLAN_NAME=integ PIPELINE_TMP="$tmp"
    export CLAUDE_CODE_SESSION_ID=integ-sess-2a
    # shellcheck source=lib/pipeline-telemetry.sh
    . "$SCRIPT_DIR/lib/pipeline-telemetry.sh"
    pipeline_init
    # shellcheck source=lib/learnings-writer.sh
    . "$SCRIPT_DIR/lib/learnings-writer.sh"
    learnings_write "integ-test-pattern" "test body"
    echo "RC=$?"; echo "$RUN_FILE"
  ) > "$tmp/.run-2a" 2>/dev/null
  local rc2a run2a
  rc2a=$(grep -E '^RC=' "$tmp/.run-2a" | tail -n1 | cut -d= -f2)
  run2a=$(tail -n 1 "$tmp/.run-2a")
  if [[ "$rc2a" == "0" ]] \
      && [[ -f "$tmp/.iago/learnings/patterns.md" ]] \
      && grep -q 'integ-test-pattern' "$tmp/.iago/learnings/patterns.md" \
      && grep -q '"type":"learnings_written"' "$run2a"; then
    echo "  PASS  2a: happy-path write + telemetry event"
  else
    echo "  FAIL  2a: rc=$rc2a"; fails=$((fails+1))
  fi

  # 2b — write failure → exit 1, stderr FAIL, telemetry write_failed.
  # Cross-platform failure injection: pre-create patterns.md as a DIRECTORY
  # so `>> patterns.md` fails on every filesystem (Windows NTFS via Git Bash
  # ignores chmod 0500 unless mounted noacl, so a perm-only probe would
  # SKIP — and the original Codex finding on PR #51 was that SKIP let the
  # whole acceptance harness pass without ever exercising the fail-loud path
  # on the dev environment this repo runs from).
  local tmp2; tmp2=$(mktemp -d); _all_tmp_dirs+=("$tmp2")
  mkdir -p "$tmp2/.iago/learnings/patterns.md"  # patterns.md is a directory
  (
    set +e
    export PROJECT_DIR="$tmp2" PLAN_NAME=integ PIPELINE_TMP="$tmp2"
    export CLAUDE_CODE_SESSION_ID=integ-sess-2b
    # shellcheck source=lib/pipeline-telemetry.sh
    . "$SCRIPT_DIR/lib/pipeline-telemetry.sh"
    pipeline_init
    # shellcheck source=lib/learnings-writer.sh
    . "$SCRIPT_DIR/lib/learnings-writer.sh"
    learnings_write "fail-test" "body" 2> "$tmp2/.err"
    echo "RC=$?"; echo "$RUN_FILE"
  ) > "$tmp2/.run-2b" 2>/dev/null
  local rc2b run2b
  rc2b=$(grep -E '^RC=' "$tmp2/.run-2b" | tail -n1 | cut -d= -f2)
  run2b=$(tail -n 1 "$tmp2/.run-2b")
  if [[ "$rc2b" == "1" ]] \
      && grep -q 'FAIL' "$tmp2/.err" \
      && grep -q '"type":"learnings_write_failed"' "$run2b"; then
    echo "  PASS  2b: write-failure → exit 1 + stderr FAIL + telemetry failed-event"
  else
    echo "  FAIL  2b: rc=$rc2b stderr=$(cat "$tmp2/.err" 2>/dev/null | head -1)"
    fails=$((fails+1))
  fi

  # 2c — fallback mode → exit 0, fallback file in .iago/logs, telemetry
  # to_fallback. Same patterns.md-as-directory injection forces primary write
  # to fail; LEARNINGS_FALLBACK_DIR default ($PROJECT_DIR/.iago/logs) is
  # writable (fresh tmpdir, no collisions).
  local tmp3; tmp3=$(mktemp -d); _all_tmp_dirs+=("$tmp3")
  mkdir -p "$tmp3/.iago/learnings/patterns.md"  # patterns.md is a directory
  (
    set +e
    export PROJECT_DIR="$tmp3" PLAN_NAME=integ PIPELINE_TMP="$tmp3"
    export CLAUDE_CODE_SESSION_ID=integ-sess-2c
    export LEARNINGS_WRITE_MODE=fallback
    # shellcheck source=lib/pipeline-telemetry.sh
    . "$SCRIPT_DIR/lib/pipeline-telemetry.sh"
    pipeline_init
    # shellcheck source=lib/learnings-writer.sh
    . "$SCRIPT_DIR/lib/learnings-writer.sh"
    learnings_write "fb-test" "body"
    echo "RC=$?"; echo "$RUN_FILE"
  ) > "$tmp3/.run-2c" 2>/dev/null
  local rc2c run2c fb_count
  rc2c=$(grep -E '^RC=' "$tmp3/.run-2c" | tail -n1 | cut -d= -f2)
  run2c=$(tail -n 1 "$tmp3/.run-2c")
  fb_count=$(find "$tmp3/.iago/logs" -name 'learnings-fallback-*.md' 2>/dev/null | wc -l)
  if [[ "$rc2c" == "0" ]] && (( fb_count >= 1 )) \
      && grep -q '"type":"learnings_written_to_fallback"' "$run2c"; then
    echo "  PASS  2c: fallback mode → exit 0 + fallback file + telemetry"
  else
    echo "  FAIL  2c: rc=$rc2c fb_count=$fb_count"
    fails=$((fails+1))
  fi

  if (( fails == 0 )); then S2_RESULT="PASS"; else S2_RESULT="FAIL"; fi
}

# ─── Section 3 — clean-tree guard ─────────────────────────────────────────
section_3() {
  echo "── Section 3: clean-tree guard ────────────────────────────"
  local fails=0 tmp guard="$SCRIPT_DIR/check-clean-tree.sh"
  tmp=$(mktemp -d); _all_tmp_dirs+=("$tmp")

  (
    cd "$tmp"
    git init -q 2>/dev/null
    git config user.email "integ@test"; git config user.name "integ"
    # Lenient mode hard-fails when .iago/state/ is not gitignored. Add the
    # entry so the fixture mirrors the real iago-os repo posture.
    printf '.iago/state/\n' > .gitignore
    echo "hello" > README.md
    git add .gitignore README.md
    git commit -q -m "init" 2>/dev/null
  ) > /dev/null 2>&1

  # 3a — truly clean tree → exit 0
  if "$guard" --project-dir "$tmp" >/dev/null 2>&1; then
    echo "  PASS  3a: clean tree → exit 0"
  else
    echo "  FAIL  3a: guard rejected clean tree"; fails=$((fails+1))
  fi

  # 3b — worktree metadata under .claude/worktrees/ filtered in lenient mode
  mkdir -p "$tmp/.claude/worktrees/fake-worktree-meta"
  : > "$tmp/.claude/worktrees/fake-worktree-meta/HEAD"
  if "$guard" --project-dir "$tmp" >/dev/null 2>&1; then
    echo "  PASS  3b: lenient mode filters .claude/worktrees/"
  else
    echo "  FAIL  3b: lenient mode failed to filter worktree metadata"
    fails=$((fails+1))
  fi

  # 3c — --strict catches the worktree metadata (no filter)
  if "$guard" --project-dir "$tmp" --strict >/dev/null 2>&1; then
    echo "  FAIL  3c: --strict missed untracked worktree file"
    fails=$((fails+1))
  else
    echo "  PASS  3c: --strict caught untracked worktree file"
  fi

  # 3d — real dirt: modify committed file → DIRTY in lenient mode
  echo "changed" >> "$tmp/README.md"
  if "$guard" --project-dir "$tmp" >/dev/null 2>&1; then
    echo "  FAIL  3d: lenient mode missed real working-tree edit"
    fails=$((fails+1))
  else
    echo "  PASS  3d: lenient mode caught real working-tree edit"
  fi

  if (( fails == 0 )); then S3_RESULT="PASS"; else S3_RESULT="FAIL"; fi
}

# ─── Section 4 — adversarial fallback parser ─────────────────────────────
# Verifies the line-anchored sentinel match from Plan 02 (Stress C1):
# `parse_adversarial_verdict` must NOT match a sentinel wrapped in backticks
# or fenced inside a markdown code block — only an exact line equal to the
# sentinel (after trailing whitespace strip) counts.
section_4() {
  echo "── Section 4: adversarial verdict parser ──────────────────"
  local fails=0 tmp
  tmp=$(mktemp -d); _all_tmp_dirs+=("$tmp")
  # shellcheck source=lib/adversarial-verdict.sh
  . "$SCRIPT_DIR/lib/adversarial-verdict.sh"

  # 4a — last line clean sentinel
  printf 'reviewed diff.\nno issues seen.\n===VERDICT: CLEAN===\n' > "$tmp/a.txt"
  local v; v=$(parse_adversarial_verdict "$tmp/a.txt")
  if [[ "$v" == "CLEAN" ]]; then echo "  PASS  4a: CLEAN sentinel parsed"; else echo "  FAIL  4a: got $v"; fails=$((fails+1)); fi

  # 4b — last line issues sentinel
  printf 'found Critical bug.\n===VERDICT: ISSUES===\n' > "$tmp/b.txt"
  v=$(parse_adversarial_verdict "$tmp/b.txt")
  if [[ "$v" == "ISSUES" ]]; then echo "  PASS  4b: ISSUES sentinel parsed"; else echo "  FAIL  4b: got $v"; fails=$((fails+1)); fi

  # 4c — prose only ("no issues found") → UNKNOWN (fail-safe)
  printf 'checked auth flow, no issues found.\n' > "$tmp/c.txt"
  v=$(parse_adversarial_verdict "$tmp/c.txt")
  if [[ "$v" == "UNKNOWN" ]]; then echo "  PASS  4c: prose-only → UNKNOWN"; else echo "  FAIL  4c: got $v"; fails=$((fails+1)); fi

  # 4d — sentinel wrapped in inline backticks → UNKNOWN (anchor guard)
  printf 'reviewer wrote:\n`===VERDICT: CLEAN===`\nthen explained why.\n' > "$tmp/d.txt"
  v=$(parse_adversarial_verdict "$tmp/d.txt")
  if [[ "$v" == "UNKNOWN" ]]; then echo "  PASS  4d: backtick-wrapped sentinel rejected (anchor-to-own-line guard)"; else echo "  FAIL  4d: got $v (wrapped sentinel leaked)"; fails=$((fails+1)); fi

  # 4e — sentinel followed by ≤5 chat lines (within tail -10 window per C1 fix)
  printf '===VERDICT: ISSUES===\nadditional commentary line 1\nline 2\nline 3\nline 4\nline 5\n' > "$tmp/e.txt"
  v=$(parse_adversarial_verdict "$tmp/e.txt")
  if [[ "$v" == "ISSUES" ]]; then echo "  PASS  4e: sentinel + 5 trailing chat lines captured (tail -10 window)"; else echo "  FAIL  4e: got $v"; fails=$((fails+1)); fi

  if (( fails == 0 )); then S4_RESULT="PASS"; else S4_RESULT="FAIL"; fi
}

# ─── Dispatch + acceptance matrix ─────────────────────────────────────────
case "$SECTION" in
  1) section_1 ;;
  2) section_2 ;;
  3) section_3 ;;
  4) section_4 ;;
  all) section_1; section_2; section_3; section_4 ;;
  *) echo "ERROR: --section must be 1|2|3|4|all" >&2; exit 64 ;;
esac

echo ""
echo "Phase 1b acceptance matrix"
echo ""
echo "| Bug | Section | Result |"
echo "|-----|---------|--------|"
echo "| sessionId plumbing                | 1 | $S1_RESULT |"
echo "| learnings writer fail-loud        | 2 | $S2_RESULT |"
echo "| clean-tree guard pre-flight       | 3 | $S3_RESULT |"
echo "| adversarial verdict sentinel      | 4 | $S4_RESULT |"
echo ""

overall=0
for r in "$S1_RESULT" "$S2_RESULT" "$S3_RESULT" "$S4_RESULT"; do
  case "$r" in
    PASS|"?" ) ;; # "?" = not run (--section N partial run), counts as non-failure
    *) overall=1 ;;
  esac
done
exit "$overall"
