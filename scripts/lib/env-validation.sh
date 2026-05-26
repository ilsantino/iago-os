#!/usr/bin/env bash
# Env-var validation helpers for execute-pipeline.sh.
#
# Why this exists: when an env var feeds into a bash arithmetic context
# (e.g. `(( waited < timeout_secs ))` in run_claude), a non-numeric or
# bash-injection value (`"abc"`, `"$(rm -rf /)"`) under `set -euo pipefail`
# either kills the pipeline with a confusing error or executes the
# substitution. Validate at the call site BEFORE the value reaches `(( ))`.

# validate_positive_int_env <var_name> <default>
#
# Returns 0 if the env var is unset or empty (caller uses <default>).
# Returns 0 if the env var matches ^[1-9][0-9]*$ (positive integer, no
#   leading zero, no decimals, no negatives, no whitespace).
# Returns 1 + writes a contextual error to stderr otherwise.
#
# Usage at call sites:
#   validate_positive_int_env IAGO_IMPL_TIMEOUT_SECS 1800 || exit 1
#
# The function does NOT modify the env var; default substitution stays at
# the consumer (`${IAGO_IMPL_TIMEOUT_SECS:-1800}`). The validator only
# rejects explicitly-set invalid values.
validate_positive_int_env() {
  local var_name="$1"
  local default_for_msg="$2"
  local value="${!var_name:-}"

  # Unset or empty → defer to caller's ${VAR:-default}.
  [[ -z "$value" ]] && return 0

  # Positive integer with no leading zero, no sign, no decimals.
  if [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    return 0
  fi

  echo "ERROR: $var_name must be a positive integer (default ${default_for_msg}); got: '$value'" >&2
  return 1
}
