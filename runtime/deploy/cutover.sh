#!/usr/bin/env bash
#
# cutover.sh — Phase 2 VPS cutover orchestrator
#
# Wraps the spec § 8 T-15 → T+60 cutover sequence as a single executable
# with explicit verify commands at each checkpoint, idempotency guards,
# resumability via IAGO_CUTOVER_RESUME_FROM=Tnn, and rollback triggers.
#
# WARNING — PRODUCTION OPERATION
#   - Requires Santiago at keyboard (multiple manual decision points)
#   - Requires IAGO_CUTOVER_CONFIRM=YES to proceed (refuses otherwise)
#   - Expected wall clock: ~60 min (T-15 pre-flight → T+60 stay-at-keyboard)
#   - Rollback triggers (script invokes rollback.sh automatically):
#       * Daemon does not reach is-active=active within 30s of enable
#       * journalctl shows daemon-start failure or stack trace
#       * IPC socket file missing at /var/lib/iago-os/daemon-state/ipc.sock
#       * Operator replies 'n' to T+10 bot-reply confirmation
#       * Operator-initiated abort (Ctrl-C — trap NOT installed: aborting
#         mid-cutover requires explicit follow-up `bash rollback.sh`)
#
# Source of truth: .iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md § 8
#
# Path robustness (I5): SCRIPT_DIR resolves via BASH_SOURCE so the script
# works from any CWD (./cutover.sh vs bash deploy/cutover.sh vs absolute).
#
# Idempotency contract (I4): every step checks its pre-condition before
# running (systemctl is-enabled before enable; sha256 compare before
# re-uploading credentials/unit files; test -d before mkdir). This
# guarantees IAGO_CUTOVER_RESUME_FROM=Tnn never trips partial-state
# failures on already-completed steps when a Tailscale node disconnects
# mid-step and the operator re-runs from the same checkpoint.
#
# Global lock (Codex P1-5): cutover.sh and rollback.sh share a VPS-side
# flock at /var/lock/iago-cutover.lock to prevent concurrent runs. A
# stale lock (process crashed mid-run) can be broken manually:
#   tailscale ssh root@$VPS_HOST -- \
#     'rm -f /var/lock/iago-cutover.lock /var/lock/iago-cutover.lock.pid'

set -euo pipefail

# ============================================================================
# Sequence marker manifest (the verify gate counts these flush-left markers
# alongside the indented echo "[T...] ..." lines in main() below)
# ============================================================================
# T-15  final operator confirmation
# T+00  archive OpenClaw via 02a script
# T+02  BotFather rotation (manual)
# T+05  provision-credentials.sh telegram-token gh-token
# T+07  install systemd unit + enable+start daemon
# T+08  verify journalctl daemon-start + IPC socket
# T+10  bot-reply confirmation (rollback if no)
# T+15  canonical workflow test (manual)
# T+30  revoke-whatsapp.sh (manual)
# T+45  sanity checkpoint — daemon active + heartbeat
# T+50  sanity checkpoint — journalctl error count
# T+55  sanity checkpoint — IPC socket reachable
# T+60  cutover complete

# ============================================================================
# Constants and SCRIPT_DIR resolution (I5 carry-over)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR"
MIGRATION_DIR="$SCRIPT_DIR/../migration"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

VPS_HOST="${VPS_HOST:-srv1456441}"
VPS_USER="${VPS_USER:-root}"
SANTIAGO_USER_ID="${IAGO_TELEGRAM_USER_ID:-}"

LOCK_MARKER=""

# ============================================================================
# Flag matrix (C1 carry-over)
# ============================================================================
# IAGO_CUTOVER_CONFIRM=YES               required to proceed (production gate)
# IAGO_CUTOVER_NONINTERACTIVE=1          bypass `read -r` prompts (DRY-RUN ONLY)
# IAGO_CUTOVER_DRY_RUN=1                 sets NONINTERACTIVE + treats CONFIRM=YES
# IAGO_CUTOVER_RESUME_FROM=Tnn           skip earlier T-steps (I2)
# IAGO_CUTOVER_SKIP_TMINUS5_BASELINE=1   skip optional T-05 ping (M1)
# IAGO_CUTOVER_DRY_RUN_REPLY=y|n         dry-run default reply for `read` (default y)

if [[ "${IAGO_CUTOVER_DRY_RUN:-0}" == "1" ]]; then
  echo "DRY-RUN MODE — manual steps simulated as instant success."
  echo "                Real cutover MUST NOT use this flag."
  IAGO_CUTOVER_NONINTERACTIVE=1
  IAGO_CUTOVER_CONFIRM=YES
fi

if [[ "${IAGO_CUTOVER_NONINTERACTIVE:-0}" == "1" && "${IAGO_CUTOVER_CONFIRM:-}" == "YES" && "${IAGO_CUTOVER_DRY_RUN:-0}" != "1" ]]; then
  echo "ABORT: IAGO_CUTOVER_NONINTERACTIVE=1 AND IAGO_CUTOVER_CONFIRM=YES are contradictory." >&2
  echo "       NONINTERACTIVE bypasses manual gates — never use it in real cutover." >&2
  echo "       For test harness use, set IAGO_CUTOVER_DRY_RUN=1 instead." >&2
  exit 1
fi

if [[ "${IAGO_CUTOVER_CONFIRM:-}" != "YES" ]]; then
  echo "ABORT: IAGO_CUTOVER_CONFIRM=YES required to proceed." >&2
  echo "       This is a production operation; refuse to run silently." >&2
  exit 1
fi

# DRY_RUN_REPLY only applies to the T+10 bot-reply prompt. T-15 ("go") and
# generic ack prompts get their own per-call default so a single env knob can
# drive the rollback-trigger test case without aborting at T-15.
T10_DRY_RUN_REPLY="${IAGO_CUTOVER_DRY_RUN_REPLY:-y}"

# ============================================================================
# Helpers
# ============================================================================

# vssh: wrap tailscale ssh with the configured host/user.
vssh() {
  tailscale ssh "${VPS_USER}@${VPS_HOST}" -- "$@"
}

# stage_to_number: convert "T-15" → -15, "T+05" → 5, "T+60" → 60.
# Strips leading zeros to keep downstream `(( ... ))` arithmetic in base 10
# (bash treats `08` and `09` as invalid octal — `should_run` would error
# at T+08/T+09 otherwise).
stage_to_number() {
  local stage=$1
  local sign=${stage:1:1}
  local num=${stage:2}
  num=$((10#$num))
  if [[ "$sign" == "-" ]]; then
    echo "-$num"
  else
    echo "$num"
  fi
}

# should_run: gate for T-step blocks honoring IAGO_CUTOVER_RESUME_FROM (I2).
should_run() {
  local stage=$1
  if [[ -z "${IAGO_CUTOVER_RESUME_FROM:-}" ]]; then
    return 0
  fi
  local cur resume
  cur=$(stage_to_number "$stage")
  resume=$(stage_to_number "$IAGO_CUTOVER_RESUME_FROM")
  (( cur >= resume ))
}

# read_or_skip: prompts the operator in interactive mode; auto-replies in
# dry-run mode with the per-call default. Default defaults to empty so a
# bare "press Enter" ack works without per-call ceremony.
read_or_skip() {
  local prompt="$1" var_name="$2" default="${3:-}"
  if [[ "${IAGO_CUTOVER_NONINTERACTIVE:-0}" == "1" ]]; then
    printf -v "$var_name" '%s' "$default"
    echo "DRY-RUN: prompt '${prompt}' → auto-reply '${default}'"
    sleep 1
  else
    read -r -p "$prompt" "$var_name"
  fi
}

# ndjson_write: write one structured-log line to the cutover NDJSON on the
# VPS. Best-effort — never fails the script if the file is unreachable.
ndjson_write() {
  local kind=$1 stage=$2 result=${3:-ok}
  local ts line
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  line=$(printf '{"ts":"%s","kind":"%s","stage":"%s","result":"%s"}' \
    "$ts" "$kind" "$stage" "$result")
  vssh "echo '${line}' >> /var/log/iago-os/cutover.ndjson" \
    > /dev/null 2>&1 || true
}

# preflight_check: assert a single condition, abort with the exact unchecked
# item name if it fails. Used by the 12-check gate below.
preflight_check() {
  local label="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  OK ${label}"
  else
    echo "ABORT: pre-flight check failed: ${label}" >&2
    exit 1
  fi
}

# ============================================================================
# Global lock (Codex P1-5) — acquired BEFORE any T-step runs
# ============================================================================

acquire_remote_lock() {
  LOCK_MARKER="$(hostname):$$:$(date +%s)"
  local out
  # The exec 200>"$LOCKFILE" + flock -n 200 idiom atomically test-and-sets
  # the lock; we then persist a PID marker to the sidecar .pid file so the
  # claim survives SSH disconnection and rollback.sh can detect concurrent
  # cutover runs even after the original ssh fd closes.
  out=$(vssh bash -s <<EOF || true
LOCKFILE=/var/lock/iago-cutover.lock
exec 200>"\$LOCKFILE"
if ! flock -n 200; then
  echo "BUSY:\$(cat \$LOCKFILE.pid 2>/dev/null || echo unknown)"
  exit 1
fi
if [[ -s "\$LOCKFILE.pid" ]]; then
  echo "BUSY:\$(cat \$LOCKFILE.pid)"
  exit 1
fi
echo "${LOCK_MARKER}" > "\$LOCKFILE.pid"
echo OK
EOF
)
  if [[ "$out" != *"OK"* ]]; then
    echo "ERROR: another cutover/rollback is running (${out}). Aborting to prevent concurrent state corruption." >&2
    echo "       If you are certain no other run is in flight, break the stale lock with:" >&2
    echo "         tailscale ssh ${VPS_USER}@${VPS_HOST} -- 'rm -f /var/lock/iago-cutover.lock /var/lock/iago-cutover.lock.pid'" >&2
    exit 1
  fi
  echo "  OK acquired global lock (marker=${LOCK_MARKER})"
}

# verify_lock_still_ours: re-check the PID file before every major remote
# operation to detect stale-lock breakage by a concurrent operator.
verify_lock_still_ours() {
  local current
  current=$(vssh "cat /var/lock/iago-cutover.lock.pid 2>/dev/null || echo MISSING")
  if [[ "$current" != "$LOCK_MARKER" ]]; then
    echo "ERROR: lock pid marker changed (expected '${LOCK_MARKER}', found '${current}'). Aborting." >&2
    exit 1
  fi
}

release_remote_lock() {
  # Codex P1 finding: unconditional `rm -f` on the pid marker could delete
  # another run's marker if an operator broke a stale lock mid-run or a
  # second cutover/rollback acquired the slot before our EXIT trap fired.
  # Fix: re-acquire the same flock and delete the marker ONLY if its
  # contents still equal this process's LOCK_MARKER.
  [[ -n "$LOCK_MARKER" ]] || return 0
  local local_marker="$LOCK_MARKER"
  # Clear the local handle before the remote round-trip so a re-entrant
  # trap (SIGINT during EXIT) can't fire this function twice.
  LOCK_MARKER=""
  vssh bash -s <<EOF > /dev/null 2>&1 || true
# release-lock-with-owner-check expected_marker=${local_marker}
LOCKFILE=/var/lock/iago-cutover.lock
exec 200>"\$LOCKFILE"
flock -n 200 || exit 0
if [[ -s "\$LOCKFILE.pid" ]] && [[ "\$(cat \$LOCKFILE.pid)" == "${local_marker}" ]]; then
  rm -f "\$LOCKFILE.pid"
fi
EOF
}

trap release_remote_lock EXIT

# ============================================================================
# Pre-flight gate — 12 checks, abort with the exact unchecked item if any
# fails. Always runs (not gated by RESUME_FROM).
# ============================================================================

run_preflight() {
  echo "=== Pre-flight gate (12 checks) ==="

  # 1. IAGO_TELEGRAM_USER_ID set
  [[ -n "$SANTIAGO_USER_ID" ]] || { echo "ABORT: IAGO_TELEGRAM_USER_ID not set" >&2; exit 1; }
  echo "  OK IAGO_TELEGRAM_USER_ID set"

  # 2. Phase 1 hello-world acceptance evidence
  preflight_check "PHASE-1-EVIDENCE.md exists" test -f "$REPO_ROOT/runtime/PHASE-1-EVIDENCE.md"

  # 3. VPS daemon-state directory
  preflight_check "VPS daemon-state dir present" vssh "test -d /var/lib/iago-os/daemon-state"

  # 4. VPS telegram-token credential already provisioned (01a output)
  preflight_check "VPS telegram-token credential present" vssh "test -f /etc/credstore.encrypted/iago-telegram-token.cred"

  # 5. VPS iago system user
  preflight_check "VPS iago user exists" vssh "getent passwd iago > /dev/null"

  # 6. VPS age pubkey for openclaw archive encryption (02a)
  preflight_check "VPS santiago-age.pub present" vssh "test -f /etc/iago-os/santiago-age.pub"

  # 7. VPS /opt/iago-os/.git for any agent needing cwd-with-git (I3)
  preflight_check "VPS /opt/iago-os/.git present" vssh "test -d /opt/iago-os/.git"

  # 8. NDJSON path bootstrap (I1) — create dir + file + chmod
  if vssh "mkdir -p /var/log/iago-os && touch /var/log/iago-os/cutover.ndjson && chmod 0640 /var/log/iago-os/cutover.ndjson" > /dev/null 2>&1; then
    echo "  OK NDJSON path /var/log/iago-os/cutover.ndjson bootstrapped"
  else
    echo "ABORT: pre-flight check failed: NDJSON path bootstrap" >&2
    exit 1
  fi

  # 9. archive-openclaw.sh deployed on VPS (02a output)
  preflight_check "VPS archive-openclaw.sh present" vssh "test -x /opt/iago-os/runtime/deploy/archive-openclaw.sh"

  # 10. Local provision-credentials.sh present (01a output)
  preflight_check "local provision-credentials.sh present" test -x "$DEPLOY_DIR/provision-credentials.sh"

  # 11. Local systemd unit template present (01a output)
  preflight_check "local iago-os-v2-daemon.service present" test -f "$DEPLOY_DIR/iago-os-v2-daemon.service"

  # 12. Local rollback.sh present (this plan, Task 2)
  preflight_check "local rollback.sh present" test -x "$DEPLOY_DIR/rollback.sh"

  echo "=== Pre-flight gate: all 12 checks passed ==="
  ndjson_write cutover-step preflight ok
}

# ============================================================================
# trigger_rollback — called when a T-step rollback condition fires
# ============================================================================

trigger_rollback() {
  local reason="$1"
  echo ""
  echo "!!! ROLLBACK TRIGGERED: ${reason}"
  echo "!!! Invoking rollback.sh — release global lock first so rollback can acquire it"
  ndjson_write cutover-step rollback-triggered "${reason}"
  release_remote_lock
  LOCK_MARKER=""

  local rollback_env=(IAGO_ROLLBACK_CONFIRM=YES)
  if [[ "${IAGO_CUTOVER_DRY_RUN:-0}" == "1" ]]; then
    rollback_env+=(IAGO_ROLLBACK_DRY_RUN=1 IAGO_ROLLBACK_SKIP_TOKEN=1)
  fi
  env "${rollback_env[@]}" bash "$DEPLOY_DIR/rollback.sh"
  exit 2
}

# ============================================================================
# Main T-15 → T+60 sequence
# ============================================================================

main() {
  echo "iaGO-OS v2 cutover — wall-clock target 60 min"
  echo "VPS: ${VPS_USER}@${VPS_HOST}"
  echo "SCRIPT_DIR: ${SCRIPT_DIR}"
  echo ""

  acquire_remote_lock
  run_preflight

  # ----- T-15: final operator confirmation + baseline -----
  # T-15 final operator confirmation
  if should_run "T-15"; then
    echo ""
    echo "[T-15] Final operator confirmation — confirm Santiago is at keyboard, OpenClaw queue is drained, no in-flight work."
    read_or_skip "Type 'go' to proceed, anything else aborts: " confirm "go"
    if [[ "$confirm" != "go" ]]; then
      echo "ABORT: operator did not type 'go' at T-15." >&2
      exit 1
    fi

    # T-05 baseline ping via OpenClaw (M1 opt-out)
    if [[ "${IAGO_CUTOVER_SKIP_TMINUS5_BASELINE:-0}" == "1" ]]; then
      echo "[T-05] Skipping baseline ping (IAGO_CUTOVER_SKIP_TMINUS5_BASELINE=1)"
    else
      echo "[T-05] MANUAL: send 'v2 cutover starting' to OpenClaw bot from phone to confirm baseline."
      read_or_skip "Press Enter once acknowledged: " _ack
    fi
    ndjson_write cutover-step T-15 ok
  fi

  # ----- T+00: archive OpenClaw -----
  # T+00 archive openclaw
  if should_run "T+00"; then
    echo ""
    echo "[T+00] Archive OpenClaw — invoking archive-openclaw.sh on VPS"
    verify_lock_still_ours

    # Pre-archive query — same ilsantino user context as rollback uses
    # (Codex P0 finding: root SSH cannot reach ilsantino's user systemd
    # bus, so the old `systemctl --user is-active openclaw-gateway` query
    # silently failed; combined with `|| echo inactive` it falsely reported
    # OpenClaw stopped while it was still running, opening a duplicate-
    # processing window during cutover). Fail closed on query errors —
    # systemctl is-active exit codes: 0=active, 3=inactive|failed, others
    # = query error (which we treat as verification failure and abort
    # BEFORE archive runs, so nothing has been torn down yet).
    local pre_state pre_rc
    if pre_state=$(vssh "su - ilsantino -c 'systemctl --user is-active openclaw-gateway'" 2>&1); then
      pre_rc=0
    else
      pre_rc=$?
    fi
    pre_state="${pre_state//[[:space:]]/}"
    if [[ "$pre_rc" -ne 0 && "$pre_rc" -ne 3 ]]; then
      echo "ABORT: openclaw-gateway pre-archive query failed (rc=${pre_rc}, output='${pre_state}')." >&2
      echo "       Cannot verify baseline state via ilsantino user systemd bus." >&2
      echo "       Refusing to proceed with archive (fail-closed)." >&2
      exit 1
    fi
    if [[ "$pre_state" == "inactive" ]]; then
      echo "  IDEMPOTENT: openclaw-gateway already inactive — archive script will be a no-op for stop, may still emit archive"
    fi

    vssh "bash /opt/iago-os/runtime/deploy/archive-openclaw.sh"

    # Post-archive verification — same query path, fail closed → rollback.
    local state rc
    if state=$(vssh "su - ilsantino -c 'systemctl --user is-active openclaw-gateway'" 2>&1); then
      rc=0
    else
      rc=$?
    fi
    state="${state//[[:space:]]/}"
    if [[ "$rc" -ne 0 && "$rc" -ne 3 ]]; then
      trigger_rollback "openclaw-gateway post-archive query failed (rc=${rc}, output='${state}')"
    fi
    if [[ "$state" != "inactive" ]]; then
      echo "ERROR: openclaw-gateway still '${state}' after archive — expected inactive" >&2
      trigger_rollback "openclaw-gateway did not stop after archive (state='${state}')"
    fi
    echo "  OK openclaw-gateway is inactive"
    ndjson_write cutover-step T+00 ok
  fi

  # ----- T+02: BotFather rotation (manual) -----
  # T+02 botfather rotation
  if should_run "T+02"; then
    echo ""
    echo "[T+02] MANUAL: run BotFather rotation per ${MIGRATION_DIR}/02-telegram-bot-rotation.md (Plan 02b artifact)"
    echo "         Use /revoke against the v2 bot; capture the new token into 1Password vault iago-os item v2-daemon-telegram-bot field token."
    read_or_skip "Press Enter once BotFather rotation completes: " _ack
    ndjson_write cutover-step T+02 ok
  fi

  # ----- T+05: provision credentials locally + verify decrypt round-trip -----
  # T+05 provision credentials
  if should_run "T+05"; then
    echo ""
    echo "[T+05] Provision credentials — invoking provision-credentials.sh telegram-token gh-token"
    verify_lock_still_ours
    bash "$DEPLOY_DIR/provision-credentials.sh" telegram-token gh-token
    if vssh "systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c" > /dev/null 2>&1; then
      echo "  OK systemd-creds round-trip verified"
    else
      trigger_rollback "systemd-creds decrypt round-trip failed for iago-telegram-token"
    fi
    ndjson_write cutover-step T+05 ok
  fi

  # ----- T+07: install systemd unit + start daemon (idempotent) -----
  # T+07 install systemd unit + start daemon
  if should_run "T+07"; then
    echo ""
    echo "[T+07] Install systemd unit + start daemon"
    verify_lock_still_ours

    local remote_unit_path=/etc/systemd/system/iago-os-v2-daemon.service
    local local_rendered local_sha remote_sha
    local_rendered=$(mktemp)
    sed "s/__SANTIAGO_TELEGRAM_USER_ID__/${SANTIAGO_USER_ID}/" \
      "$DEPLOY_DIR/iago-os-v2-daemon.service" > "$local_rendered"
    local_sha=$(sha256sum "$local_rendered" | awk '{print $1}')
    remote_sha=$(vssh "test -f ${remote_unit_path} && sha256sum ${remote_unit_path} | awk '{print \$1}'" 2>/dev/null || echo missing)

    if [[ "$local_sha" == "$remote_sha" ]]; then
      echo "  IDEMPOTENT: remote unit file already matches rendered local — skipping copy"
    else
      cat "$local_rendered" | vssh "cat > ${remote_unit_path} && systemctl daemon-reload"
      echo "  OK unit file copied + daemon-reload issued"
    fi

    local enabled active
    enabled=$(vssh "systemctl is-enabled iago-os-v2-daemon.service 2>/dev/null" || echo disabled)
    active=$(vssh "systemctl is-active iago-os-v2-daemon.service 2>/dev/null" || echo inactive)
    if [[ "$enabled" == "enabled" && "$active" == "active" ]]; then
      echo "  IDEMPOTENT: daemon already enabled+active — skipping systemctl enable --now"
    else
      vssh "systemctl enable --now iago-os-v2-daemon.service"
    fi

    # Poll is-active up to 30s — matches the documented rollback trigger
    # ("Daemon does not reach is-active=active within 30s of enable").
    # systemd unit startup commonly takes 5-15s; a single check after 3s
    # would trigger premature rollback for any legitimately-slow start.
    local waited=0
    active=""
    while (( waited < 30 )); do
      active=$(vssh "systemctl is-active iago-os-v2-daemon.service 2>/dev/null" || echo inactive)
      if [[ "$active" == "active" ]]; then
        break
      fi
      sleep 2
      waited=$(( waited + 2 ))
    done
    if [[ "$active" != "active" ]]; then
      trigger_rollback "iago-os-v2-daemon.service not active within 30s of start (state=${active})"
    fi
    echo "  OK iago-os-v2-daemon.service is active (waited ${waited}s)"

    # Render-file tempfile cleanup (intent: end of T+07 block; trap RETURN
    # would only fire at main()'s return, leaving the file resident for
    # T+08…T+60). Explicit rm here matches the documented intent.
    rm -f "$local_rendered"
    ndjson_write cutover-step T+07 ok
  fi

  # ----- T+08: verify journal + IPC socket -----
  # T+08 verify journal + IPC
  if should_run "T+08"; then
    echo ""
    echo "[T+08] Verify journalctl daemon-start event + IPC socket presence"
    verify_lock_still_ours

    if ! vssh "journalctl -u iago-os-v2-daemon.service --since '5 minutes ago' -o cat | grep -q daemon-start"; then
      trigger_rollback "journalctl shows no daemon-start event in last 5 min"
    fi
    echo "  OK daemon-start telemetry present"

    if ! vssh "test -S /var/lib/iago-os/daemon-state/ipc.sock"; then
      trigger_rollback "IPC socket /var/lib/iago-os/daemon-state/ipc.sock missing"
    fi
    echo "  OK IPC socket present"
    ndjson_write cutover-step T+08 ok
  fi

  # ----- T+10: bot reply confirmation (rollback if no) -----
  # T+10 bot reply confirmation
  if should_run "T+10"; then
    echo ""
    echo "[T+10] MANUAL: send /agents to v2 bot from phone."
    local reply
    read_or_skip "Press y if bot replies with agent list, n to roll back: " reply "$T10_DRY_RUN_REPLY"
    if [[ "$reply" != "y" ]]; then
      trigger_rollback "operator replied '${reply}' at T+10 bot-reply check"
    fi
    echo "  OK operator confirmed bot reply"
    ndjson_write cutover-step T+10 ok
  fi

  # ----- T+15: canonical workflow test -----
  # T+15 workflow test
  if should_run "T+15"; then
    echo ""
    echo "[T+15] Operator: run canonical workflow test from spec § 8 T+15 block."
    cat <<'TEST_BLOCK'
   Canonical test (copy-paste):
     1. /agents → list (should include hello-world)
     2. /start hello-world → daemon spawns adapter
     3. /sessions → confirm session id appears
     4. Send free-form text → adapter receives, replies
     5. /stop <session-id> → daemon SIGTERMs adapter, marker written
TEST_BLOCK
    read_or_skip "Press Enter once canonical workflow test passes: " _ack
    ndjson_write cutover-step T+15 ok
  fi

  # ----- T+30: revoke WhatsApp -----
  # T+30 revoke whatsapp
  if should_run "T+30"; then
    echo ""
    echo "[T+30] MANUAL: run revoke-whatsapp.sh per ${MIGRATION_DIR}/02-whatsapp-deauth.md (Plan 02b artifact)"
    echo "         Required env: WABA_ID, APP_ID, APP_SECRET, SYSTEM_USER_TOKEN."
    read_or_skip "Press Enter once revoke-whatsapp.sh succeeds: " _ack
    ndjson_write cutover-step T+30 ok
  fi

  # ----- T+45 / T+50 / T+55: spec § 8 verification checkpoints -----
  # T+45 sanity checkpoint
  if should_run "T+45"; then
    echo ""
    echo "[T+45] Sanity checkpoint #1 — daemon still active, heartbeat ticking"
    verify_lock_still_ours
    vssh "systemctl is-active iago-os-v2-daemon.service" || trigger_rollback "daemon not active at T+45"
    vssh "test -f /var/lib/iago-os/daemon-state/heartbeat.json" || trigger_rollback "heartbeat.json missing at T+45"
    ndjson_write cutover-step T+45 ok
  fi

  # T+50 sanity checkpoint
  if should_run "T+50"; then
    echo ""
    echo "[T+50] Sanity checkpoint #2 — journalctl free of errors"
    verify_lock_still_ours
    local err_count
    err_count=$(vssh "journalctl -u iago-os-v2-daemon.service --since '1 hour ago' -p err -o cat | wc -l" || echo 0)
    if (( err_count > 0 )); then
      echo "WARN: ${err_count} error-level log lines in last hour"
    fi
    ndjson_write cutover-step T+50 ok
  fi

  # T+55 sanity checkpoint
  if should_run "T+55"; then
    echo ""
    echo "[T+55] Sanity checkpoint #3 — IPC socket reachable from ilsantino"
    verify_lock_still_ours
    vssh "test -S /var/lib/iago-os/daemon-state/ipc.sock" || trigger_rollback "IPC socket missing at T+55"
    ndjson_write cutover-step T+55 ok
  fi

  # ----- T+60: complete -----
  # T+60 complete
  if should_run "T+60"; then
    echo ""
    echo "[T+60] CUTOVER COMPLETE."
    echo ""
    echo "Post-cutover reminder list:"
    echo "  1. Write Obsidian session digest under sessions/$(date -u +%Y-%m-%d)-iago-v2-cutover.md"
    echo "  2. Update .iago/STATE.md Updated: date + add Active row for the cutover"
    echo "  3. Stay at keyboard 30 min monitoring journalctl + heartbeat"
    echo "  4. Confirm GitHub Actions PR-triage cron fires at next 14:00 UTC"
    echo "  5. Confirm rollback.sh is NOT invoked unless a documented trigger fires"
    ndjson_write cutover-step T+60 ok
  fi
}

main "$@"
