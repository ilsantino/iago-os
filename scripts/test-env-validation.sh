#!/usr/bin/env bash
# Tests for scripts/lib/env-validation.sh and its wiring into
# scripts/execute-pipeline.sh.
#
# The validator guards every env-configurable timeout that reaches
# `(( waited < timeout_secs ))` in run_claude. The pipeline must reject
# hostile or malformed values at startup (before any stage runs), not
# late in the pipeline.
#
# Covered timeouts:
#   - IAGO_IMPL_TIMEOUT_SECS (default 1800) — impl stage
#   - IAGO_PR_TIMEOUT        (default 600)  — PR creation stage
#
# Run: bash scripts/test-env-validation.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib/env-validation.sh"

PASS=0
FAIL=0

assert_validator() {
  local label="$1"
  local var_name="$2"
  local value="$3"
  local expect_exit="$4"  # "0" (accept) or "1" (reject)

  local actual_exit
  if [[ -z "$value" ]]; then
    unset "$var_name"
  else
    export "$var_name=$value"
  fi
  validate_positive_int_env "$var_name" 999 >/dev/null 2>&1
  actual_exit=$?
  unset "$var_name"

  if [[ "$actual_exit" == "$expect_exit" ]]; then
    echo "  PASS  $label (value='$value' → exit $actual_exit)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (value='$value' expected exit $expect_exit, got $actual_exit)"
    FAIL=$((FAIL + 1))
  fi
}

echo "validate_positive_int_env — accept cases (unset, valid positive int):"
assert_validator "unset → accept"              IAGO_IMPL_TIMEOUT_SECS ""        "0"
assert_validator "valid 1"                     IAGO_IMPL_TIMEOUT_SECS "1"       "0"
assert_validator "valid 1800"                  IAGO_IMPL_TIMEOUT_SECS "1800"    "0"
assert_validator "valid large 999999"          IAGO_PR_TIMEOUT        "999999"  "0"

echo
echo "validate_positive_int_env — reject cases (non-numeric, sign, leading zero, injection):"
assert_validator "non-numeric 'abc'"           IAGO_IMPL_TIMEOUT_SECS "abc"     "1"
assert_validator "negative '-5'"               IAGO_IMPL_TIMEOUT_SECS "-5"      "1"
assert_validator "zero '0'"                    IAGO_IMPL_TIMEOUT_SECS "0"       "1"
assert_validator "leading zero '0123'"         IAGO_IMPL_TIMEOUT_SECS "0123"    "1"
assert_validator "decimal '1.5'"               IAGO_IMPL_TIMEOUT_SECS "1.5"     "1"
assert_validator "whitespace ' 60 '"           IAGO_IMPL_TIMEOUT_SECS " 60 "    "1"
assert_validator "injection \$(rm -rf /)"      IAGO_IMPL_TIMEOUT_SECS '$(rm -rf /)' "1"
assert_validator "backtick rm"                 IAGO_PR_TIMEOUT        '`rm -rf /`' "1"

echo
echo "validate_positive_int_env — same rules apply to IAGO_PR_TIMEOUT:"
assert_validator "PR timeout unset → accept"   IAGO_PR_TIMEOUT        ""        "0"
assert_validator "PR timeout valid 600"        IAGO_PR_TIMEOUT        "600"     "0"
assert_validator "PR timeout non-numeric"      IAGO_PR_TIMEOUT        "soon"    "1"
assert_validator "PR timeout negative"         IAGO_PR_TIMEOUT        "-1"      "1"

echo
echo "execute-pipeline.sh wiring — both vars are validated at startup:"
# Confirm both vars appear in the pipeline startup-validation block (single
# contiguous block above the self-freeze re-exec). Drift here = the test
# below catches it before the pipeline ships.
if grep -A2 "validate_positive_int_env IAGO_IMPL_TIMEOUT_SECS" "$SCRIPT_DIR/execute-pipeline.sh" \
    | grep -q "validate_positive_int_env IAGO_PR_TIMEOUT"; then
  echo "  PASS  pipeline validates IAGO_PR_TIMEOUT adjacent to IAGO_IMPL_TIMEOUT_SECS"
  PASS=$((PASS + 1))
else
  echo "  FAIL  pipeline missing IAGO_PR_TIMEOUT validation adjacent to IAGO_IMPL_TIMEOUT_SECS"
  FAIL=$((FAIL + 1))
fi

echo
echo "Total: $PASS passed, $FAIL failed"
[[ "$FAIL" == "0" ]]
