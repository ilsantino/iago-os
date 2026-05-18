#!/usr/bin/env bats
# runtime/deploy/provision-credentials.test.sh
#
# bats-core tests for provision-credentials.sh
#
# Strategy:
#   - Create a tmp/ dir with fake `op`, `tailscale`, `systemd-creds`
#     binaries that log invocations + return predictable output.
#   - Prepend tmp/ to PATH so the script under test resolves the fakes.
#   - Each test asserts script exit status + captured output OR the
#     contents of the stub log files.
#
# Run with:
#   bats runtime/deploy/provision-credentials.test.sh
#
# Skipped on Windows where bats is awkward; covered by build gate on
# macOS/Linux dev boxes and by VPS pre-cutover verification.

SCRIPT_DIR_REL="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
SCRIPT_UNDER_TEST="${SCRIPT_DIR_REL}/provision-credentials.sh"

setup() {
  BATS_TMPDIR_LOCAL="$(mktemp -d)"
  export BATS_TMPDIR_LOCAL
  export STUB_LOG="${BATS_TMPDIR_LOCAL}/stub.log"
  : > "${STUB_LOG}"

  # Default stub behavior — each test can override before `run`.
  export OP_WHOAMI_RC=0
  export OP_READ_OUTPUT="fake-token-1234567890"
  export OP_READ_RC=0
  export TAILSCALE_TRUE_RC=0
  export SYSTEMD_CREDS_DECRYPT_OUTPUT="fake-token-1234567890"

  # Build fake op
  cat > "${BATS_TMPDIR_LOCAL}/op" <<'EOF'
#!/usr/bin/env bash
echo "op $*" >> "${STUB_LOG}"
case "$1" in
  whoami) exit "${OP_WHOAMI_RC:-0}" ;;
  read)   printf '%s' "${OP_READ_OUTPUT:-fake-token}"; exit "${OP_READ_RC:-0}" ;;
  *)      exit 0 ;;
esac
EOF
  chmod +x "${BATS_TMPDIR_LOCAL}/op"

  # Build fake tailscale — recognizes:
  #   tailscale ssh user@host -- true            (reachability check)
  #   tailscale ssh user@host -- "<remote cmd>"  (remote provisioning)
  cat > "${BATS_TMPDIR_LOCAL}/tailscale" <<'EOF'
#!/usr/bin/env bash
echo "tailscale $*" >> "${STUB_LOG}"
if [[ "$*" == *"-- true"* ]]; then
  exit "${TAILSCALE_TRUE_RC:-0}"
fi
# Special case: round-trip length verifier sub-command
if [[ "$*" == *"systemd-creds decrypt"* && "$*" == *"wc -c"* ]]; then
  printf '%s' "${SYSTEMD_CREDS_DECRYPT_OUTPUT:-fake-token-1234567890}" | wc -c | tr -d ' \n'
  exit 0
fi
# Any other remote command — succeed silently
exit 0
EOF
  chmod +x "${BATS_TMPDIR_LOCAL}/tailscale"

  # Build fake systemd-creds (not actually invoked locally — script
  # only invokes it inside the tailscale ssh remote command — but if
  # any local path tries to reach it, this returns OK).
  cat > "${BATS_TMPDIR_LOCAL}/systemd-creds" <<'EOF'
#!/usr/bin/env bash
echo "systemd-creds $*" >> "${STUB_LOG}"
exit 0
EOF
  chmod +x "${BATS_TMPDIR_LOCAL}/systemd-creds"

  PATH="${BATS_TMPDIR_LOCAL}:${PATH}"
  export PATH
}

teardown() {
  rm -rf "${BATS_TMPDIR_LOCAL:-}"
}

# Test 1 — usage printed when no args
@test "no args prints usage and exits 64" {
  run bash "${SCRIPT_UNDER_TEST}"
  [ "${status}" -eq 64 ]
  [[ "${output}" == *"Usage:"* ]]
}

# Test 2 — unknown cred-key rejected
@test "unknown cred-key rejected" {
  run bash "${SCRIPT_UNDER_TEST}" frobnicate
  [ "${status}" -ne 0 ]
  [[ "${output}" == *"unknown cred-key"* ]]
}

# Test 3 — op whoami failure → exit 1 with hint
@test "op signin hint on op whoami failure" {
  OP_WHOAMI_RC=1 run bash "${SCRIPT_UNDER_TEST}" telegram-token
  [ "${status}" -eq 1 ]
  [[ "${output}" == *"op signin"* ]]
}

# Test 4 — tailscale unreachable → exit 1 with hint
@test "tailscale status hint when VPS unreachable" {
  TAILSCALE_TRUE_RC=1 run bash "${SCRIPT_UNDER_TEST}" telegram-token
  [ "${status}" -eq 1 ]
  [[ "${output}" == *"tailscale status"* ]]
}

# Test 5 — happy path single key
@test "happy path single key succeeds with completion message" {
  run bash "${SCRIPT_UNDER_TEST}" telegram-token
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"Provisioning complete"* ]]
  [[ "${output}" == *"iago-telegram-token provisioned"* ]]
}

# Test 6 — length mismatch failure
@test "round-trip length mismatch exits 1" {
  SYSTEMD_CREDS_DECRYPT_OUTPUT="different-length-output-xxxxxxxxxx" \
    run bash "${SCRIPT_UNDER_TEST}" telegram-token
  [ "${status}" -eq 1 ]
  [[ "${output}" == *"round-trip length mismatch"* ]]
}

# Test 7 — `all` expands to every key (5 keys: telegram + gh + 3 anthropic)
@test "all keyword expands to every key (5 invocations)" {
  run bash "${SCRIPT_UNDER_TEST}" all
  [ "${status}" -eq 0 ]
  # One "provisioned" line per key = 5
  count=$(echo "${output}" | grep -c "provisioned (len=")
  [ "${count}" -eq 5 ]
}

# Test 8 — VPS_HOST env override hits stubbed tailscale with that host
@test "VPS_HOST env override propagates to tailscale invocation" {
  VPS_HOST=other-host run bash "${SCRIPT_UNDER_TEST}" telegram-token
  [ "${status}" -eq 0 ]
  grep -q "tailscale ssh root@other-host" "${STUB_LOG}"
}

# Test 9 — gh-token key alone is accepted (forward-compat for Plan 04)
@test "gh-token key alone provisions without error" {
  run bash "${SCRIPT_UNDER_TEST}" gh-token
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"iago-gh-token provisioned"* ]]
}

# Test 10 — op whoami passes but op read fails (missing item, permissions,
# transient API error). Prior bug: subshell exit status was printf's (0),
# so set -e ignored the failure and silently published an empty credential.
@test "op read failure exits 1 with helpful error" {
  OP_READ_RC=1 OP_READ_OUTPUT="" run bash "${SCRIPT_UNDER_TEST}" telegram-token
  [ "${status}" -eq 1 ]
  [[ "${output}" == *"op read failed"* ]]
}

# Test 11 — op read succeeds (exit 0) but returns empty stdout (1Password
# item exists, field is empty). Prior bug: empty plaintext encrypted +
# published; round-trip length check compared 0==0 and reported success,
# silently rotating a live token to an unusable empty credential.
@test "op read empty value exits 1 with empty-value error" {
  OP_READ_OUTPUT="" run bash "${SCRIPT_UNDER_TEST}" telegram-token
  [ "${status}" -eq 1 ]
  [[ "${output}" == *"empty value"* ]]
}
