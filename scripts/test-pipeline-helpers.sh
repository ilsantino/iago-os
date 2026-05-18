#!/usr/bin/env bash
# Tests for the verdict-extraction regexes used by execute-pipeline.sh.
#
# These regexes decide whether the local fix loop runs (must trigger on FAIL or
# PASS_WITH_CONCERNS) and what gets written into the summary block. Reviewer
# sessions sometimes write canonical single-line `Verdict: FAIL` and sometimes
# regress to multi-line markdown like `## Verdict\n\n**FAIL**`. Both forms
# must work; PASS must not falsely trigger the loop.
#
# Run: bash scripts/test-pipeline-helpers.sh
set -uo pipefail

PASS=0
FAIL=0

# Mirror of the loop-trigger condition in scripts/execute-pipeline.sh (while loop, ~line 474).
# Keep in sync: if the pattern there changes, update this function too.
assert_loop_triggers() {
  local label="$1"
  local input="$2"
  local expect_match="$3"  # "yes" or "no"

  if echo "$input" | tr '\n' ' ' | grep -qiE "Verdict\s*:?\s*\*{0,2}\s*(FAIL|PASS_WITH_CONCERNS)"; then
    actual="yes"
  else
    actual="no"
  fi

  if [[ "$actual" == "$expect_match" ]]; then
    echo "  PASS  $label (loop triggers: $actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (expected: $expect_match, got: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# Mirror of the summary-extract pipeline in scripts/execute-pipeline.sh (~line 860).
# Keep in sync: if the pipeline there changes, update this function too.
assert_summary_extracts() {
  local label="$1"
  local input="$2"
  local expect_verdict="$3"

  actual=$(echo "$input" | tr '\n' ' ' | grep -oiE 'Verdict[^A-Za-z]+(PASS_WITH_CONCERNS|PASS|FAIL)' | tail -1 | grep -oE '(PASS_WITH_CONCERNS|PASS|FAIL)' | tail -1 || echo "")

  if [[ "$actual" == "$expect_verdict" ]]; then
    echo "  PASS  $label (summary extracts: $actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (expected: '$expect_verdict', got: '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

echo "Loop-trigger regex (must match FAIL and PASS_WITH_CONCERNS in any form):"

# Canonical single-line — what the tightened prompt asks for.
assert_loop_triggers "single-line FAIL"               "Verdict: FAIL"                              "yes"
assert_loop_triggers "single-line PASS_WITH_CONCERNS" "Verdict: PASS_WITH_CONCERNS"                "yes"
assert_loop_triggers "single-line PASS"               "Verdict: PASS"                              "no"

# Case-insensitive coverage — reviewers may write lowercase.
assert_loop_triggers "lowercase verdict: fail"               "verdict: fail"                    "yes"
assert_loop_triggers "uppercase VERDICT: PASS_WITH_CONCERNS" "VERDICT: PASS_WITH_CONCERNS"      "yes"
assert_loop_triggers "mixed-case verdict: Pass"              "verdict: Pass"                    "no"

# Legacy multi-line markdown — what reviewers actually wrote on PR #73.
assert_loop_triggers "markdown header + bold FAIL"               $'## Verdict\n\n**FAIL** \xe2\x80\x94 three Important findings'                "yes"
assert_loop_triggers "markdown header + bold PASS_WITH_CONCERNS" $'## Verdict\n\n**PASS_WITH_CONCERNS** \xe2\x80\x94 two Minor findings'      "yes"
assert_loop_triggers "markdown header + bold PASS"               $'## Verdict\n\n**PASS** \xe2\x80\x94 all clean'                              "no"

# Embedded in a longer transcript with both narrative and the verdict line at the end.
LONG_FAIL=$'Pass 1: plan compliance...\nPass 2: domain routing...\nFinal assessment: significant issues remain.\n\nVerdict: FAIL'
assert_loop_triggers "trailing canonical FAIL after narrative" "$LONG_FAIL" "yes"

LONG_PASS=$'Pass 1: plan compliance...\nNo issues.\n\nVerdict: PASS'
assert_loop_triggers "trailing canonical PASS after narrative" "$LONG_PASS" "no"

echo
echo "Summary-extract regex (must pull the verdict word out of any form):"

assert_summary_extracts "single-line FAIL"                $'Some prose here.\nVerdict: FAIL'                          "FAIL"
assert_summary_extracts "single-line PASS_WITH_CONCERNS"  $'Some prose here.\nVerdict: PASS_WITH_CONCERNS'            "PASS_WITH_CONCERNS"
assert_summary_extracts "single-line PASS"                $'Some prose here.\nVerdict: PASS'                          "PASS"
assert_summary_extracts "markdown header + bold FAIL"     $'## Verdict\n\n**FAIL** \xe2\x80\x94 issues remain'        "FAIL"
assert_summary_extracts "markdown header + bold PASS_WITH_CONCERNS" $'## Verdict\n\n**PASS_WITH_CONCERNS**'           "PASS_WITH_CONCERNS"
assert_summary_extracts "markdown header + bold PASS"     $'## Verdict\n\n**PASS** all clean'                         "PASS"

# Last verdict wins when prose quotes a prior one (reviewer writes "was FAIL, now PASS").
QUOTED_VERDICT=$'Previously the verdict was Verdict: FAIL. After fixes... Verdict: PASS'
assert_summary_extracts "last verdict wins over quoted earlier one" "$QUOTED_VERDICT" "PASS"

# Prose-surrounded canonical verdict — ensures a verdict line embedded in a
# narrative paragraph still triggers the loop. Council worry #2.
PROSE_FAIL=$'The reviewer wrote a long narrative about the implementation. The narrative spans several lines and mentions various concerns. Then the reviewer concludes with the verdict line.\n\nVerdict: FAIL'
assert_loop_triggers "prose-surrounded canonical FAIL" "$PROSE_FAIL" "yes"

# Multi-mention with tail -1: PASS quoted earlier, FAIL is the final verdict.
# Loop must trigger; summary extractor must pick FAIL (last), not PASS (first).
# Council worry #3.
MULTI_FAIL_LAST=$'Initial round: Verdict: PASS (quoted from a prior review). Re-review surfaced regressions. Verdict: FAIL'
assert_loop_triggers     "multi-mention tail picks FAIL"     "$MULTI_FAIL_LAST" "yes"
assert_summary_extracts  "multi-mention tail extracts FAIL"  "$MULTI_FAIL_LAST" "FAIL"

echo
echo "Liveness gate (timeout wrapper around long-running child):"

# Regression test for Phase 0 — Codex stage 4 liveness gate.
# Ensures $_TIMEOUT_CMD (timeout / gtimeout) terminates a hung child within
# budget + grace, mirroring the wrapper around the codex-companion call in
# execute-pipeline.sh. Stubs `node` with a sleep-forever script via PATH
# prefix so we don't need a real Codex install.
liveness_gate_test() {
  local label="liveness gate fires within budget + grace"

  # Resolve the same timeout binary the pipeline uses.
  local tcmd=""
  if command -v timeout >/dev/null 2>&1; then
    tcmd="timeout"
  elif command -v gtimeout >/dev/null 2>&1; then
    tcmd="gtimeout"
  else
    echo "  FAIL  $label (neither timeout nor gtimeout available — install GNU coreutils)"
    FAIL=$((FAIL + 1))
    return
  fi

  local stub_dir
  stub_dir=$(mktemp -d -t iago-liveness-stub.XXXXXX)
  local marker="$stub_dir/node-was-invoked"
  # Stub `node`: touch a marker file to prove invocation, then sleep 30s. If
  # the wrapper works, $tcmd kills it at 5s (SIGTERM) or 7s (SIGKILL after 2s
  # grace). The marker rules out exit 127 from misordered timeout args (e.g.
  # `$tcmd 5 --kill-after=2 node` would parse `--kill-after=2` as the command
  # and exit 127 in <1s — which would otherwise be indistinguishable from a
  # timeout pass). Trap-on-exit cleanup so failures don't orphan the stub.
  trap 'rm -rf "$stub_dir" 2>/dev/null' RETURN
  cat > "$stub_dir/node" <<STUB
#!/usr/bin/env bash
touch "$marker"
sleep 30
STUB
  chmod +x "$stub_dir/node"

  local start_s
  start_s=$(date +%s)
  local exit_code=0
  # GNU timeout requires options BEFORE the duration:
  # `timeout [OPTION] DURATION COMMAND [ARG]...`
  PATH="$stub_dir:$PATH" "$tcmd" --kill-after=2 5 node anything >/dev/null 2>&1 || exit_code=$?
  local end_s
  end_s=$(date +%s)
  local elapsed=$((end_s - start_s))

  local node_invoked="no"
  [[ -f "$marker" ]] && node_invoked="yes"

  # Accept 124 (SIGTERM after budget) or 137 (SIGKILL after grace).
  # Elapsed: 5s budget + 2s kill-after grace + 2s slack = 9s ceiling.
  # node_invoked must be "yes" — if not, timeout misparsed and never spawned
  # the stub, which means a production argument-order regression is masked.
  if { [[ "$exit_code" == "124" ]] || [[ "$exit_code" == "137" ]]; } && (( elapsed <= 9 )) && [[ "$node_invoked" == "yes" ]]; then
    echo "  PASS  $label (exit=$exit_code elapsed=${elapsed}s node_invoked=$node_invoked)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (expected exit ∈ {124,137}, elapsed ≤ 9s, node_invoked=yes; got exit=$exit_code elapsed=${elapsed}s node_invoked=$node_invoked)"
    FAIL=$((FAIL + 1))
  fi
}

liveness_gate_test

# ─── run_claude session-id integration ──────────────────────────────
# Verifies the per-call session-id contract in scripts/execute-pipeline.sh
# `run_claude` propagates to telemetry emissions inside the subshell:
#   - outer CLAUDE_CODE_SESSION_ID set → preserved as-is
#   - outer unset → synthesized `claude-{RUN_ID}-{ms}-{RANDOM}` prefix
# Windows quirk: bash on Git Bash resolves shell scripts on PATH BEFORE
# .exe with PATH prepend, so a stub named `claude` (no extension) wins.
# Skip toggle: `SKIP_RUN_CLAUDE_TESTS=1 bash scripts/test-pipeline-helpers.sh`.
run_claude_session_id_test() {
  local label="$1"
  local outer_sid="$2"   # empty string = unset
  local expect_prefix="$3"  # literal prefix that must appear in env seen by spawned claude
  local should_match_literal="$4"  # "yes" → expect exact match, "no" → prefix only

  if [[ "${SKIP_RUN_CLAUDE_TESTS:-0}" == "1" ]]; then
    echo "  SKIP  $label (SKIP_RUN_CLAUDE_TESTS=1)"
    return 0
  fi

  local repo_root
  repo_root="$(cd "$(dirname "$0")/.." && pwd)"
  local telemetry_helper="$repo_root/scripts/lib/pipeline-telemetry.sh"
  local pipeline_script="$repo_root/scripts/execute-pipeline.sh"

  if [[ ! -f "$telemetry_helper" || ! -f "$pipeline_script" ]]; then
    echo "  FAIL  $label (helper/script not found)"
    FAIL=$((FAIL + 1))
    return
  fi

  local stub_dir tmp_dir
  stub_dir=$(mktemp -d -t iago-run-claude-stub.XXXXXX)
  tmp_dir=$(mktemp -d -t iago-run-claude-tmp.XXXXXX)
  # shellcheck disable=SC2064
  trap "rm -rf '$stub_dir' '$tmp_dir' 2>/dev/null" RETURN

  # Stub `claude`: writes its CLAUDE_CODE_SESSION_ID env to a marker file
  # then exits 0. The marker proves what env the spawned process actually saw —
  # which IS the contract for run_claude:
  #   The synthesized/preserved id reaches the spawned `claude -p` so all
  #   telemetry the CHILD emits correlates to ONE id.
  # What this test does NOT cover (and intentionally so — see Plan 03 + the
  # sessionId-scope docblock at top of scripts/lib/pipeline-telemetry.sh):
  #   The wrapping stage_end record emitted in the PARENT shell after the
  #   `$(run_claude ...)` subshell returns reflects the OUTER env (empty
  #   when unset). Joining parent stage records to child spawn ids is owned
  #   by the Plan 03 NDJSON projector via RUN_ID + timestamp, NOT by env
  #   export. The complementary regression test below
  #   (run_claude_parent_stage_end_observability_test) asserts the parent
  #   record stays empty by design so a future "fix" that exports back to
  #   the parent shell (would silently re-introduce the gap Codex flagged)
  #   trips the test instead.
  local marker="$tmp_dir/claude-env-seen"
  cat > "$stub_dir/claude" <<STUB
#!/usr/bin/env bash
printf '%s' "\${CLAUDE_CODE_SESSION_ID:-__UNSET__}" > "$marker"
echo "OK"
exit 0
STUB
  chmod +x "$stub_dir/claude"

  # Extract just the run_claude function body from execute-pipeline.sh so the
  # test can source it without booting the whole pipeline (lock, self-freeze,
  # etc.). awk pulls lines between `run_claude() {` and the next closing `}`
  # at column 0.
  local fn_file="$tmp_dir/run_claude.sh"
  awk '/^run_claude\(\) \{/{flag=1} flag{print} /^\}$/ && flag{flag=0}' \
    "$pipeline_script" > "$fn_file"

  if [[ ! -s "$fn_file" ]]; then
    echo "  FAIL  $label (could not extract run_claude function body)"
    FAIL=$((FAIL + 1))
    return
  fi

  PATH="$stub_dir:$PATH" \
  PROJECT_DIR="$tmp_dir" \
  PIPELINE_TMP="$tmp_dir" \
  PLAN_NAME="rc-test" \
  OUTER_SID="$outer_sid" \
  HELPER="$telemetry_helper" \
  FN_FILE="$fn_file" \
  bash -c '
    set -uo pipefail
    . "$HELPER"
    . "$FN_FILE"
    if [[ -n "$OUTER_SID" ]]; then
      export CLAUDE_CODE_SESSION_ID="$OUTER_SID"
    else
      unset CLAUDE_CODE_SESSION_ID
    fi
    pipeline_init
    stage_start rc_stage
    output=$(run_claude 30 -p stub) || true
    stage_end rc_stage 0
    pipeline_finalize 0
  ' >/dev/null 2>&1 || true

  if [[ ! -f "$marker" ]]; then
    echo "  FAIL  $label (stub never invoked — marker missing)"
    FAIL=$((FAIL + 1))
    return
  fi

  local seen
  seen=$(cat "$marker")

  if [[ "$should_match_literal" == "yes" ]]; then
    if [[ "$seen" == "$expect_prefix" ]]; then
      echo "  PASS  $label (env seen by claude == '$expect_prefix')"
      PASS=$((PASS + 1))
    else
      echo "  FAIL  $label (expected literal '$expect_prefix', got '$seen')"
      FAIL=$((FAIL + 1))
    fi
  else
    if [[ "$seen" == "$expect_prefix"* && "$seen" != "__UNSET__" ]]; then
      echo "  PASS  $label (env seen by claude starts with '$expect_prefix', got '$seen')"
      PASS=$((PASS + 1))
    else
      echo "  FAIL  $label (expected prefix '$expect_prefix', got '$seen')"
      FAIL=$((FAIL + 1))
    fi
  fi
}

run_claude_synthesis_fallback_test() {
  # C2 regression: even if __pipeline_now_ms is not loaded, synthesis still
  # produces a well-formed id via $EPOCHSECONDS fallback (no double-dash).
  local label="run_claude synthesizes well-formed id when helper unsourced"

  if [[ "${SKIP_RUN_CLAUDE_TESTS:-0}" == "1" ]]; then
    echo "  SKIP  $label (SKIP_RUN_CLAUDE_TESTS=1)"
    return 0
  fi

  local repo_root
  repo_root="$(cd "$(dirname "$0")/.." && pwd)"
  local pipeline_script="$repo_root/scripts/execute-pipeline.sh"

  local stub_dir tmp_dir
  stub_dir=$(mktemp -d -t iago-rc-fallback-stub.XXXXXX)
  tmp_dir=$(mktemp -d -t iago-rc-fallback-tmp.XXXXXX)
  # shellcheck disable=SC2064
  trap "rm -rf '$stub_dir' '$tmp_dir' 2>/dev/null" RETURN

  local marker="$tmp_dir/claude-env-seen"
  cat > "$stub_dir/claude" <<STUB
#!/usr/bin/env bash
printf '%s' "\${CLAUDE_CODE_SESSION_ID:-__UNSET__}" > "$marker"
exit 0
STUB
  chmod +x "$stub_dir/claude"

  local fn_file="$tmp_dir/run_claude.sh"
  awk '/^run_claude\(\) \{/{flag=1} flag{print} /^\}$/ && flag{flag=0}' \
    "$pipeline_script" > "$fn_file"

  # No telemetry helper sourced → __pipeline_now_ms unavailable, EPOCHSECONDS
  # fallback path must produce a well-formed id (no `claude--` double-dash).
  PATH="$stub_dir:$PATH" \
  PIPELINE_TMP="$tmp_dir" \
  FN_FILE="$fn_file" \
  bash -c '
    set -uo pipefail
    . "$FN_FILE"
    # Provide a no-op latch since the helper is not sourced.
    __pipeline_latch_timed_out() { :; }
    __pipeline_write_timed_out() { :; }
    log() { :; }
    unset CLAUDE_CODE_SESSION_ID
    RUN_ID="norun-test"
    output=$(run_claude 30 -p stub) || true
  ' >/dev/null 2>&1 || true

  if [[ ! -f "$marker" ]]; then
    echo "  FAIL  $label (stub never invoked)"
    FAIL=$((FAIL + 1))
    return
  fi

  local seen
  seen=$(cat "$marker")

  # Well-formed: claude-{RUN_ID}-{digits}-{digits}. No empty segments → no `--`.
  if [[ "$seen" == claude-norun-test-* && "$seen" != *--* ]]; then
    echo "  PASS  $label (id='$seen' well-formed)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (expected claude-norun-test-{ms}-{rand}, got '$seen')"
    FAIL=$((FAIL + 1))
  fi
}

run_claude_parent_stage_end_observability_test() {
  # I-B regression test (per Codex finding on PR #50).
  # Asserts the DESIGNED behavior at the NDJSON level: a stage_end record
  # emitted in the PARENT shell after `$(run_claude ...)` (with the outer
  # CLAUDE_CODE_SESSION_ID UNSET) carries `"sessionId":""`. The synthesized
  # `claude-*` id from run_claude lives in its subshell only.
  # This test serves two purposes:
  #   1. Locks the documented contract so a future "fix" that exports the
  #      synthesized id back to the parent shell breaks the test instead
  #      of silently changing aggregator semantics.
  #   2. Makes the observability gap (parent stage_end has no spawn id)
  #      explicit and grep-able for anyone reading the test suite.
  local label="parent stage_end after run_claude (env unset) emits empty sessionId by design"

  if [[ "${SKIP_RUN_CLAUDE_TESTS:-0}" == "1" ]]; then
    echo "  SKIP  $label (SKIP_RUN_CLAUDE_TESTS=1)"
    return 0
  fi

  local repo_root
  repo_root="$(cd "$(dirname "$0")/.." && pwd)"
  local telemetry_helper="$repo_root/scripts/lib/pipeline-telemetry.sh"
  local pipeline_script="$repo_root/scripts/execute-pipeline.sh"

  if [[ ! -f "$telemetry_helper" || ! -f "$pipeline_script" ]]; then
    echo "  FAIL  $label (helper/script not found)"
    FAIL=$((FAIL + 1))
    return
  fi

  local stub_dir tmp_dir
  stub_dir=$(mktemp -d -t iago-parent-obs-stub.XXXXXX)
  tmp_dir=$(mktemp -d -t iago-parent-obs-tmp.XXXXXX)
  # shellcheck disable=SC2064
  trap "rm -rf '$stub_dir' '$tmp_dir' 2>/dev/null" RETURN

  cat > "$stub_dir/claude" <<'STUB'
#!/usr/bin/env bash
echo "OK"
exit 0
STUB
  chmod +x "$stub_dir/claude"

  local fn_file="$tmp_dir/run_claude.sh"
  awk '/^run_claude\(\) \{/{flag=1} flag{print} /^\}$/ && flag{flag=0}' \
    "$pipeline_script" > "$fn_file"

  PATH="$stub_dir:$PATH" \
  PROJECT_DIR="$tmp_dir" \
  PIPELINE_TMP="$tmp_dir" \
  PLAN_NAME="parent-obs" \
  HELPER="$telemetry_helper" \
  FN_FILE="$fn_file" \
  bash -c '
    set -uo pipefail
    . "$HELPER"
    . "$FN_FILE"
    unset CLAUDE_CODE_SESSION_ID
    pipeline_init
    stage_start parent_obs
    output=$(run_claude 30 -p stub) || true
    stage_end parent_obs 0
    pipeline_finalize 0
  ' >/dev/null 2>&1 || true

  # Find the single NDJSON file under .iago/state/pipeline-runs/.
  local run_file
  run_file=$(find "$tmp_dir/.iago/state/pipeline-runs" -type f -name '*.ndjson' 2>/dev/null | head -1)
  if [[ -z "$run_file" || ! -f "$run_file" ]]; then
    echo "  FAIL  $label (RUN_FILE not produced)"
    FAIL=$((FAIL + 1))
    return
  fi

  # Codex C-01 fix (PR #52 dual-review): pipeline_init now synthesizes the
  # fallback sessionId in PARENT scope (was subshell-only via run_claude),
  # so the parent stage_end MUST carry a non-empty `claude-*` id when the
  # outer env is unset. The synthesized id format is
  # `claude-{RUN_ID}-{ms}-{RANDOM}` where {RUN_ID} starts with a UTC
  # timestamp like `20260517-123456`.
  local stage_end_line
  stage_end_line=$(grep '"type":"stage_end"' "$run_file" | tail -1)
  if [[ -z "$stage_end_line" ]]; then
    echo "  FAIL  $label (no stage_end record in RUN_FILE)"
    FAIL=$((FAIL + 1))
    return
  fi

  if [[ "$stage_end_line" == *'"sessionId":""'* ]]; then
    echo "  FAIL  $label (stage_end leaked empty sessionId — parent-scope synthesis regression: $stage_end_line)"
    FAIL=$((FAIL + 1))
  elif [[ "$stage_end_line" == *'"sessionId":"claude-'* ]]; then
    echo "  PASS  $label (stage_end carries parent-synth claude-* fallback)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (stage_end sessionId is neither empty nor a claude-* fallback: $stage_end_line)"
    FAIL=$((FAIL + 1))
  fi
}

echo
echo "run_claude session-id (per-call synthesis + outer preservation):"

run_claude_session_id_test \
  "run_claude synthesizes sessionId when env unset" \
  "" \
  "claude-" \
  "no"

run_claude_session_id_test \
  "run_claude preserves outer CLAUDE_CODE_SESSION_ID" \
  "outer-abc" \
  "outer-abc" \
  "yes"

run_claude_synthesis_fallback_test
run_claude_parent_stage_end_observability_test

echo
echo "Result: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] || exit 1
exit 0
