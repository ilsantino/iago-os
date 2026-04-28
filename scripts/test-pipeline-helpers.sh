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

echo
echo "Result: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] || exit 1
exit 0
