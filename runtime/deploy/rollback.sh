#!/usr/bin/env bash
#
# rollback.sh — Phase 2 VPS rollback orchestrator (≤4-min wall clock)
#
# Wraps the spec § 9 rollback sequence. Run when ANY of these signals fires
# during the cutover window (the 6 spec § 9 detection triggers):
#   1. Daemon does not reach active within 30s of `systemctl enable --now`
#   2. journalctl shows daemon-start failure or stack trace
#   3. IPC socket missing at /var/lib/iago-os/daemon-state/ipc.sock
#   4. Operator replies 'n' to T+10 bot-reply confirmation
#   5. Sanity checkpoint at T+45/T+50/T+55 finds daemon down or socket gone
#   6. Operator-initiated abort during T+15 → T+30 monitoring window
#
# WARNING: rollback is one-way at T+R+1:30 onwards — re-cutover requires a
# fresh BotFather token because the previously-bound v2 token is revoked
# during this script (unless IAGO_ROLLBACK_SKIP_TOKEN=1, see below).
#
# Wall-clock target: 4:00 from invocation to bot smoke-test success.
#   T+R+0:30 — stop v2 daemon
#   T+R+1:30 — operator pastes fresh BotFather token (skipped if SKIP_TOKEN)
#   T+R+2:00 — patch OpenClaw config with fresh token
#   T+R+2:30 — start OpenClaw user-systemd unit
#   T+R+4:00 — operator confirms OpenClaw replies to /status
#
# Source of truth: .iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md § 9
#
# Global lock (Codex P1-5): shares /var/lock/iago-cutover.lock with
# cutover.sh — only one cutover OR rollback at a time. If a stale lock
# blocks rollback (cutover crashed mid-run), break it manually:
#   tailscale ssh root@$VPS_HOST -- \
#     'rm -f /var/lock/iago-cutover.lock /var/lock/iago-cutover.lock.pid'

set -euo pipefail

# ============================================================================
# Rollback step marker manifest (verify gate counts these flush-left)
# ============================================================================
# T+R+0:30  stop iago-os-v2-daemon
# T+R+1:30  BotFather token re-rotation prompt (skipped if SKIP_TOKEN)
# T+R+2:00  patch OpenClaw config with fresh token (skipped if SKIP_TOKEN)
# T+R+2:30  start openclaw-gateway user-systemd unit
# T+R+4:00  operator confirms /status reply

# ============================================================================
# Constants and SCRIPT_DIR resolution (I5 carry-over)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VPS_HOST="${VPS_HOST:-srv1456441}"
VPS_USER="${VPS_USER:-root}"

LOCK_MARKER=""

# ============================================================================
# Flag matrix (C2 carry-over)
# ============================================================================
# IAGO_ROLLBACK_CONFIRM=YES     required (refuse to run silently)
# IAGO_ROLLBACK_SKIP_TOKEN=1    rollback ran BEFORE T+05 of cutover, so
#                               OpenClaw's original token was never revoked
# IAGO_ROLLBACK_DRY_RUN=1       test harness — injects DRYRUN_TOKEN_AAA and
#                               bypasses all `read` prompts; same loud
#                               DRY-RUN warning as cutover

if [[ "${IAGO_ROLLBACK_DRY_RUN:-0}" == "1" ]]; then
  echo "DRY-RUN MODE — manual steps simulated as instant success."
  echo "                Real rollback MUST NOT use this flag."
  IAGO_ROLLBACK_CONFIRM=YES
fi

if [[ "${IAGO_ROLLBACK_CONFIRM:-}" != "YES" ]]; then
  echo "ABORT: IAGO_ROLLBACK_CONFIRM=YES required to proceed." >&2
  echo "       Rollback is a destructive, one-way action; refuse silent runs." >&2
  exit 1
fi

# ============================================================================
# Helpers
# ============================================================================

vssh() {
  tailscale ssh "${VPS_USER}@${VPS_HOST}" -- "$@"
}

read_or_skip() {
  local prompt="$1" var_name="$2" silent="${3:-0}"
  if [[ "${IAGO_ROLLBACK_DRY_RUN:-0}" == "1" ]]; then
    # Dry-run defaults: token prompt → DRYRUN_TOKEN_AAA, confirmation → y
    if [[ "$var_name" == "FRESH_TOKEN" ]]; then
      printf -v "$var_name" '%s' "DRYRUN_TOKEN_AAA"
    else
      printf -v "$var_name" '%s' "y"
    fi
    echo "DRY-RUN: prompt '${prompt}' → auto-reply (value hidden)"
    sleep 1
  elif [[ "$silent" == "1" ]]; then
    read -rs -p "$prompt" "$var_name"
    echo ""
  else
    read -r -p "$prompt" "$var_name"
  fi
}

# ndjson_write: write one structured-log line to the cutover NDJSON on the
# VPS. Best-effort — never fails the script if the file is unreachable.
# Parameters: stage action result
#   stage  — time offset label, e.g. "+0:30"
#   action — what ran, e.g. "stop-v2"
#   result — outcome, default "ok"
# Note: rollback.sh's ndjson_write has a different parameter order than
# cutover.sh (stage/action vs kind/stage). Do not copy between scripts.
ndjson_write() {
  local stage=$1 action=$2 result=${3:-ok}
  local ts line
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  line=$(printf '{"ts":"%s","kind":"rollback-step","stage":"%s","action":"%s","result":"%s"}' \
    "$ts" "$stage" "$action" "$result")
  # M-1 fix: stdin-pipe pattern instead of `echo '${line}'`. Reason: rollback
  # records reason strings that include single quotes (state='inactive',
  # marker='HIJACKER:...'). Echoing with single-quote wrappers breaks the
  # remote shell parsing and `|| true` silently swallows the loss. stdin
  # pipe sidesteps the quote-escape gauntlet entirely.
  vssh "cat >> /var/log/iago-os/cutover.ndjson" <<< "$line" \
    > /dev/null 2>&1 || true
}

# ============================================================================
# Global lock — same flock as cutover.sh (intentional: only one at a time)
# ============================================================================

acquire_remote_lock() {
  LOCK_MARKER="$(hostname):$$:$(date +%s)"
  local out
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
    echo "ERROR: another cutover/rollback is running (${out}). Aborting." >&2
    echo "       If you are SURE no other run is in flight, break the stale lock with:" >&2
    echo "         tailscale ssh ${VPS_USER}@${VPS_HOST} -- 'rm -f /var/lock/iago-cutover.lock /var/lock/iago-cutover.lock.pid'" >&2
    exit 1
  fi
  echo "  OK acquired global lock (marker=${LOCK_MARKER})"
}

release_remote_lock() {
  # Codex P1 finding: unconditional `rm -f` on the pid marker could delete
  # another run's marker if an operator broke a stale lock mid-run or a
  # second cutover/rollback acquired the slot before our EXIT trap fired.
  # Fix: re-acquire the same flock and delete the marker ONLY if its
  # contents still equal this process's LOCK_MARKER.
  [[ -n "$LOCK_MARKER" ]] || return 0
  local local_marker="$LOCK_MARKER"
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
# Main rollback sequence
# ============================================================================

main() {
  echo "iaGO-OS v2 rollback — wall-clock target 4:00"
  echo "VPS: ${VPS_USER}@${VPS_HOST}"
  echo "SCRIPT_DIR: ${SCRIPT_DIR}"
  echo "SKIP_TOKEN: ${IAGO_ROLLBACK_SKIP_TOKEN:-0}"
  echo ""

  acquire_remote_lock

  # --- T+R+0:30 — stop v2 daemon ---
  # T+R+0:30 stop v2 daemon
  echo "[T+R+0:30] Stop iago-os-v2-daemon.service"
  # Codex P0 finding: combined `stop && disable || true` masks disable
  # failures, leaving a broken v2 daemon enabled (would restart on reboot,
  # causing split-brain recovery once OpenClaw is back up). Run each step
  # separately, do NOT ignore disable failures, and assert is-enabled has
  # actually transitioned out of "enabled" before considering rollback safe.
  local stop_rc
  if vssh "systemctl stop iago-os-v2-daemon.service"; then
    stop_rc=0
    echo "  OK systemctl stop succeeded"
  else
    stop_rc=$?
    # Stop failure isn't fatal on its own — the unit may already be
    # inactive/failed. Disable below is what gates split-brain risk.
    echo "WARN: systemctl stop returned rc=${stop_rc} — proceeding to disable+verify"
  fi

  local disable_rc
  if vssh "systemctl disable iago-os-v2-daemon.service"; then
    disable_rc=0
    echo "  OK systemctl disable succeeded"
  else
    disable_rc=$?
    echo "ERROR: systemctl disable iago-os-v2-daemon.service failed (rc=${disable_rc})." >&2
    echo "       Cannot leave v2 daemon enabled — it would restart on reboot and" >&2
    echo "       collide with the restored OpenClaw, causing split-brain recovery." >&2
    echo "       Manual recovery: tailscale ssh ${VPS_USER}@${VPS_HOST} -- 'systemctl disable iago-os-v2-daemon.service'" >&2
    ndjson_write +0:30 stop-v2 fail-disable-rc-${disable_rc}
    exit 2
  fi

  # Assert is-enabled has actually transitioned to a non-enabled state.
  # is-enabled exit codes: 0=enabled-ish (enabled/static/alias/etc),
  # 1=disabled/linked-runtime/masked-runtime, 4=no such unit.
  local enabled_state enabled_rc
  if enabled_state=$(vssh "systemctl is-enabled iago-os-v2-daemon.service" 2>&1); then
    enabled_rc=0
  else
    enabled_rc=$?
  fi
  enabled_state="${enabled_state//[[:space:]]/}"
  case "$enabled_state" in
    enabled|enabled-runtime|alias)
      # disable claimed success but is-enabled still says enabled → fatal.
      echo "ERROR: iago-os-v2-daemon.service still '${enabled_state}' after disable (rc=${enabled_rc})." >&2
      echo "       Disable did not take effect. Refusing to declare rollback safe." >&2
      ndjson_write +0:30 stop-v2 fail-still-enabled-${enabled_state}
      exit 2
      ;;
    disabled|linked|linked-runtime|masked|masked-runtime|static|indirect|generated|transient|"")
      echo "  OK iago-os-v2-daemon.service is-enabled='${enabled_state:-not-found}' (rc=${enabled_rc})"
      ;;
    *)
      # Unknown / unparseable output AND non-zero rc → likely "no such unit"
      # (rc=4) which is the safest possible state. Anything else with
      # rc=0 is suspicious — fail closed.
      if [[ "$enabled_rc" -ne 0 ]]; then
        echo "  OK iago-os-v2-daemon.service is-enabled query returned rc=${enabled_rc} ('${enabled_state}') — treating as not-installed"
      else
        echo "ERROR: unexpected is-enabled state '${enabled_state}' (rc=${enabled_rc} but parseable)." >&2
        ndjson_write +0:30 stop-v2 fail-unexpected-enabled-${enabled_state}
        exit 2
      fi
      ;;
  esac

  # Codex HIGH fix: final is-active check is now FATAL when the v2 daemon is
  # still active. Pre-fix this was informational — if `systemctl stop` timed
  # out but `disable` succeeded, the script continued to token rotation +
  # openclaw start → split-brain (both daemons running, both pulling Telegram
  # updates, both trying to write the same state). Fail closed.
  local v2_state v2_rc
  if v2_state=$(vssh "systemctl is-active iago-os-v2-daemon.service" 2>&1); then
    v2_rc=0
  else
    v2_rc=$?
  fi
  v2_state="${v2_state//[[:space:]]/}"
  case "$v2_state" in
    inactive|failed|""|not-found|unknown)
      echo "  OK iago-os-v2-daemon.service is-active='${v2_state:-not-found}' (rc=${v2_rc})"
      ndjson_write +0:30 stop-v2 ok
      ;;
    *)
      echo "FATAL: v2 daemon still '${v2_state}' after stop+disable (stop_rc=${stop_rc}, v2_rc=${v2_rc})." >&2
      echo "       Cannot proceed to OpenClaw restart — that would create a split-brain (two daemons polling Telegram simultaneously)." >&2
      echo "       Manual recovery: tailscale ssh ${VPS_USER}@${VPS_HOST} -- 'systemctl kill iago-os-v2-daemon.service'" >&2
      ndjson_write +0:30 stop-v2 fail-still-active-${v2_state}
      exit 2
      ;;
  esac

  # --- T+R+1:30 — BotFather token re-rotation (skipped if SKIP_TOKEN) ---
  # T+R+1:30 token re-rotation
  local FRESH_TOKEN=""
  if [[ "${IAGO_ROLLBACK_SKIP_TOKEN:-0}" == "1" ]]; then
    echo "[T+R+1:30] Skipping BotFather token re-rotation (IAGO_ROLLBACK_SKIP_TOKEN=1 — OpenClaw token still valid)."
    ndjson_write +1:30 token-rotation skipped
  else
    echo "[T+R+1:30] MANUAL: open BotFather on phone."
    echo "             /mybots → bot → API Token → Revoke → copy fresh token."
    read_or_skip "Paste new token here (input hidden): " FRESH_TOKEN 1
    if [[ -z "$FRESH_TOKEN" ]]; then
      echo "ABORT: empty FRESH_TOKEN — cannot patch OpenClaw config." >&2
      exit 1
    fi
    ndjson_write +1:30 token-rotation ok
  fi

  # --- T+R+2:00 — patch OpenClaw config (temp-file-over-scp pattern, C3) ---
  # T+R+2:00 patch openclaw config
  if [[ "${IAGO_ROLLBACK_SKIP_TOKEN:-0}" == "1" ]]; then
    echo "[T+R+2:00] Skipping OpenClaw config patch (token unchanged)."
    ndjson_write +2:00 patch-config skipped
  else
    echo "[T+R+2:00] Patch OpenClaw config with fresh token (temp-file-over-scp pattern)"
    # C3 fix: nested bash → ssh → sh → jq → bash quoting is fragile. Write
    # the patch script to a local tempfile, scp it across, invoke remotely,
    # then rm the remote temp. FRESH_TOKEN is forwarded via SSH SendEnv —
    # NEVER on the command line (avoids `ps`-visible disclosure).
    local local_patch remote_patch unix_ts
    unix_ts=$(date +%s)
    remote_patch="/tmp/iago-rollback-patch-${unix_ts}.sh"
    local_patch=$(mktemp)
    cat > "$local_patch" <<'PATCH_EOF'
#!/usr/bin/env bash
set -euo pipefail
: "${FRESH_TOKEN:?FRESH_TOKEN env var not set}"
# I-2A fix (round 3): set umask BEFORE any file is created. Without this,
# `jq > .tmp` lands at 0644 (root's default umask 0022). mv preserves mode,
# so openclaw.json holds the freshly-rotated bot token at 0644 during the
# race window between mv and the trailing chmod. umask 0077 makes the
# create-time mode 0600 from birth, closing the disclosure window.
umask 0077
cd ~ilsantino
cp ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
jq --arg t "$FRESH_TOKEN" '.channels.telegram.botToken = $t' \
  ~ilsantino/.openclaw/openclaw.json > ~ilsantino/.openclaw/openclaw.json.tmp
mv ~ilsantino/.openclaw/openclaw.json.tmp ~ilsantino/.openclaw/openclaw.json
chown ilsantino:ilsantino ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
# I-2 fix: `jq > .tmp` creates the new file with default umask (0022 → 0644).
# mv preserves mode. Without explicit chmod, the freshly-tokened
# openclaw.json ends up 0644 — world-readable, holding the live bot token.
# (Defense-in-depth alongside I-2A umask above: chmod ensures final mode is
# 0600 even if a future change relaxes the umask.)
chmod 0600 ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
PATCH_EOF
    # Copy patch script to the VPS via tailscale scp (mirror of tailscale ssh)
    # The patch script holds no secret material (FRESH_TOKEN flows via SendEnv,
    # not the file body) and is invoked with `bash ${remote_patch}` so no exec
    # bit is needed — both transport paths intentionally leave default perms.
    tailscale file cp "$local_patch" "${VPS_USER}@${VPS_HOST}:${remote_patch}" \
      > /dev/null 2>&1 \
      || {
        # Fallback: pipe over ssh if tailscale file cp not available
        cat "$local_patch" | vssh "cat > ${remote_patch}"
      }

    # SSH the script with FRESH_TOKEN forwarded via SendEnv (NOT on argv).
    # Note: requires sshd_config AcceptEnv FRESH_TOKEN — provisioned by 01a.
    FRESH_TOKEN="$FRESH_TOKEN" \
      tailscale ssh -o SendEnv=FRESH_TOKEN "${VPS_USER}@${VPS_HOST}" -- \
        "bash ${remote_patch}"

    vssh "rm -f ${remote_patch}" || true
    rm -f "$local_patch"
    echo "  OK OpenClaw config patched"
    ndjson_write +2:00 patch-config ok
  fi

  # --- T+R+2:30 — start OpenClaw user systemd unit ---
  # T+R+2:30 start openclaw
  echo "[T+R+2:30] Start openclaw-gateway.service (user systemd unit for ilsantino)"
  vssh "loginctl enable-linger ilsantino 2>/dev/null || true"
  vssh "su - ilsantino -c 'systemctl --user enable --now openclaw-gateway.service'" || {
    echo "ERROR: failed to start openclaw-gateway.service" >&2
    ndjson_write +2:30 start-openclaw fail
    exit 2
  }
  local oc_state
  oc_state=$(vssh "su - ilsantino -c 'systemctl --user is-active openclaw-gateway.service'" 2>/dev/null || echo inactive)
  if [[ "$oc_state" != "active" ]]; then
    echo "ERROR: openclaw-gateway.service not active after start (state=${oc_state})" >&2
    ndjson_write +2:30 start-openclaw fail-state-${oc_state}
    exit 2
  fi
  echo "  OK openclaw-gateway.service active"
  ndjson_write +2:30 start-openclaw ok

  # --- T+R+4:00 — operator smoke test ---
  # T+R+4:00 operator smoke test
  echo "[T+R+4:00] MANUAL: send /status to OpenClaw bot from phone."
  local reply
  read_or_skip "Press y if it replies, n for escalation: " reply
  if [[ "$reply" == "y" ]]; then
    echo "ROLLBACK COMPLETE."
    ndjson_write +4:00 smoke-test ok
    # Wall clock target met. Post-rollback actions below are not time-critical.
    echo ""
    echo "Post-rollback action list (NOT on the wall clock — do these now, calmly):"
    echo "  1. Write incident note under sessions/$(date -u +%Y-%m-%d)-iago-v2-rollback.md"
    echo "  2. Update .iago/STATE.md Updated: date + add row marking rollback"
    echo "  3. Notify Sebas via Signal (Telegram is OpenClaw-only post-rollback)"
    echo "  4. Capture journalctl -u iago-os-v2-daemon.service --since '2 hours ago' for diagnosis"
    echo "  5. Do NOT delete /var/lib/iago-os/daemon-state — diagnostic artifact"
    exit 0
  else
    echo "ESCALATE: capture diagnostics + notify Sebas via Signal or phone call (Telegram path is broken)."
    echo "  journalctl --user-unit openclaw-gateway --since '5 minutes ago'"
    ndjson_write +4:00 smoke-test fail
    exit 2
  fi
}

main "$@"
