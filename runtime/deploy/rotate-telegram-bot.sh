#!/usr/bin/env bash
#
# rotate-telegram-bot.sh — wraps the SCRIPTABLE portion of the
# Telegram bot rotation procedure (spec § 3 Option A). The BotFather
# `/revoke` step is a manual Telegram-UI action; this script handles
# the steps before and after:
#
#   (a) records the OLD bot token's metadata BEFORE rotation,
#   (b) prompts the operator to perform the BotFather `/revoke` UI
#       flow + paste the new token into 1Password,
#   (c) invokes provision-credentials.sh telegram-token to push the
#       new token through the systemd-creds encrypted pipeline,
#   (d) verifies the OLD token is dead via Telegram getMe with a
#       5-attempt × 30 s backoff (BotFather propagation can take up
#       to 2.5 min in practice — see M2 in the Plan 02b stress test),
#   (e) verifies the NEW token works AND points at the same bot.
#
# BotFather rate-limit note (I2 from stress test):
#   BotFather's `/revoke` is informally rate-limited to roughly one
#   per minute per bot. Mid-cutover debugging that triggers a second
#   `/revoke` within the rate-limit window will fail silently in the
#   UI. The retry buffer at step 5 (5 × 30 s = 2.5 min) absorbs the
#   propagation delay; if step 5 still finds the old token live after
#   2.5 min, abort and wait ≥60 s before re-attempting `/revoke`.
#
# WARNING: this script is INTERACTIVE; do not invoke from pipeline/CI.
# Operator runs it at cutover-time per runtime/migration/02-telegram-bot-rotation.md.
# Set IAGO_ROTATE_NONINTERACTIVE=1 to skip the `read -r` prompt — that
# path is used ONLY by the Plan 03a dry-run harness (script verifies
# pre-rotation state then exits before the prompt; no rotation runs).
#
# Required env var (never echoed):
#   OLD_TOKEN  the Telegram bot token IN USE before rotation
#
# Optional env var:
#   PROVISION_SCRIPT  path to provision-credentials.sh (defaults to
#                     the sibling script shipped by Plan 01a)
#   IAGO_ROTATE_NONINTERACTIVE=1  skip the BotFather UI prompt
#
# Telemetry: writes one NDJSON line per step (and per retry attempt
# at step 5) to /var/log/iago-os/cutover.ndjson if writable.
#
# Source of truth: .iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md § 3

set -euo pipefail

# ---------- Pre-flight: required commands ----------
command -v curl > /dev/null || {
  echo "ERROR: curl required. apt install curl" >&2
  exit 1
}
command -v jq > /dev/null || {
  echo "ERROR: jq required for response parsing. apt install jq" >&2
  exit 1
}
command -v op > /dev/null || {
  echo "ERROR: 1Password CLI 'op' required. Install per developer.1password.com/docs/cli" >&2
  exit 1
}

# ---------- Pre-flight: required env vars ----------
: "${OLD_TOKEN:?ERROR: OLD_TOKEN env var required (the bot token before rotation; never echoed)}"

# ---------- Constants ----------
PROVISION_SCRIPT="${PROVISION_SCRIPT:-$(dirname "$0")/provision-credentials.sh}"
NONINTERACTIVE="${IAGO_ROTATE_NONINTERACTIVE:-0}"
TELEGRAM_BASE="https://api.telegram.org"
OP_ITEM="op://iago-os/v2-daemon-telegram-bot/token"
PRE_ROTATION_LOG="/var/log/iago-os/telegram-rotation-pre.json"
NDJSON_PATH="/var/log/iago-os/cutover.ndjson"

# ---------- Telemetry helper ----------
# Writes one NDJSON record per step. No-op if path is not writable.
emit_ndjson() {
  local step="$1"
  local status="$2"
  local detail="$3"
  if [[ -w "$NDJSON_PATH" ]] || { [[ ! -e "$NDJSON_PATH" ]] && [[ -w "$(dirname "$NDJSON_PATH")" ]]; }; then
    printf '{"ts":"%s","script":"rotate-telegram-bot.sh","step":"%s","status":"%s","detail":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$step" "$status" "$(printf '%s' "$detail" | jq -Rs .)" \
      >> "$NDJSON_PATH" 2>/dev/null || true
  fi
}

# ---------- Step 1/6: record old bot metadata BEFORE rotation ----------
echo "[1/6] Recording old bot metadata via getMe (pre-rotation snapshot)..."
pre_response=$(curl -sS "${TELEGRAM_BASE}/bot${OLD_TOKEN}/getMe")
pre_ok=$(echo "$pre_response" | jq -r '.ok')
if [[ "$pre_ok" != "true" ]]; then
  echo "ERROR: old token already dead — was rotation done previously?" >&2
  echo "Response: $pre_response" >&2
  emit_ndjson "1/6" "fail" "old token dead before rotation"
  exit 1
fi
pre_username=$(echo "$pre_response" | jq -r '.result.username')
pre_id=$(echo "$pre_response" | jq -r '.result.id')
echo "  Bot: @${pre_username} (id=${pre_id})"
# Debug-only snapshot — overwritten on each invocation by design (latest
# pre-rotation state is the only useful one; re-runs are a re-rotation event).
if [[ -w "$(dirname "$PRE_ROTATION_LOG")" ]] || [[ -w "$PRE_ROTATION_LOG" ]]; then
  echo "$pre_response" | jq . > "$PRE_ROTATION_LOG" 2>/dev/null || true
fi
emit_ndjson "1/6" "ok" "username=$pre_username id=$pre_id"

# ---------- NONINTERACTIVE early-exit (Plan 03a dry-run harness) ----------
if [[ "$NONINTERACTIVE" == "1" ]]; then
  echo ""
  echo "IAGO_ROTATE_NONINTERACTIVE=1 — exiting after pre-rotation snapshot."
  echo "No BotFather prompt issued; no provisioning run; OLD_TOKEN untouched."
  emit_ndjson "noninteractive-exit" "ok" "stopped after step 1"
  exit 0
fi

# ---------- Step 2/6: prompt for BotFather UI flow ----------
echo ""
echo "[2/6] MANUAL STEP — perform on your phone NOW:"
echo "  1. Open Telegram, message @BotFather"
echo "  2. Send: /mybots"
echo "  3. Tap the bot @${pre_username}"
echo "  4. Tap: API Token"
echo "  5. Tap: Revoke current token"
echo "  6. Copy the NEW token BotFather displays"
echo "  7. Open 1Password app, edit item 'v2-daemon-telegram-bot'"
echo "  8. Paste the new token into the 'token' field, save"
echo ""
echo "Press Enter to continue once 1Password has the new token..."
read -r _ack
emit_ndjson "2/6" "ok" "operator acked BotFather + 1Password update"

# ---------- Step 3/6: confirm 1Password actually has a fresh value ----------
echo "[3/6] Reading 1Password to confirm token was rotated..."
op_stderr=$(mktemp)
new_token_from_op=$(op read "$OP_ITEM" 2>"$op_stderr" || true)
op_err=$(cat "$op_stderr")
rm -f "$op_stderr"
if [[ -z "$new_token_from_op" ]]; then
  echo "ERROR: op read returned empty value for $OP_ITEM" >&2
  if [[ -n "$op_err" ]]; then
    echo "op stderr: $op_err" >&2
    echo "Hint: run 'op signin' if you see a session error above." >&2
  fi
  emit_ndjson "3/6" "fail" "op read empty: $op_err"
  exit 1
fi
if [[ "$new_token_from_op" == "$OLD_TOKEN" ]]; then
  echo "ERROR: 1Password value matches OLD_TOKEN — rotation aborted (1Password not updated)" >&2
  emit_ndjson "3/6" "fail" "1Password not updated"
  exit 1
fi
echo "  OK 1Password holds a new value (differs from OLD_TOKEN)"
emit_ndjson "3/6" "ok" "op item updated"

# ---------- Step 4/6: provision via systemd-creds pipeline ----------
echo "[4/6] Provisioning new token via $PROVISION_SCRIPT telegram-token..."
if [[ ! -x "$PROVISION_SCRIPT" ]]; then
  echo "ERROR: $PROVISION_SCRIPT not executable (expected sibling script from Plan 01a)" >&2
  emit_ndjson "4/6" "fail" "provision script missing"
  exit 1
fi
"$PROVISION_SCRIPT" telegram-token
emit_ndjson "4/6" "ok" "provision-credentials.sh telegram-token"

# ---------- Step 5/6: verify OLD token is dead (5 × 30s retry) ----------
# M2 from stress test: BotFather revocation usually propagates in
# seconds but is documented as "up to 5 minutes" in Telegram forum
# discussions. 5 attempts × 30 s = 2.5 min covers the common case
# without burning the cutover budget.
echo "[5/6] Verifying OLD token is dead (max 5 × 30s = 2.5 min)..."
old_dead="no"
for i in $(seq 1 5); do
  response=$(curl -sS "${TELEGRAM_BASE}/bot${OLD_TOKEN}/getMe")
  ok_field=$(echo "$response" | jq -r '.ok')
  if [[ "$ok_field" == "false" ]]; then
    echo "  OK OLD token revoked (attempt $i)"
    emit_ndjson "5/6" "ok" "old token dead on attempt $i"
    old_dead="yes"
    break
  fi
  emit_ndjson "5/6-retry" "pending" "attempt $i still valid"
  if [[ "$i" -eq 5 ]]; then
    echo "ERROR: OLD token still valid after 5 retries (2.5 min)." >&2
    echo "BotFather /revoke may have rate-limited; wait 60s + manually re-revoke." >&2
    emit_ndjson "5/6" "fail" "old token still valid after 5 retries"
    exit 1
  fi
  echo "  OLD token still valid; retry $i/5 after 30s"
  sleep 30
done
# Loop exits only via `break` (success → old_dead=yes) or `exit 1` on attempt 5.

# ---------- Step 6/6: verify NEW token works AND identifies the same bot ----------
echo "[6/6] Verifying NEW token resolves to the same bot (@${pre_username})..."
new_response=$(curl -sS "${TELEGRAM_BASE}/bot${new_token_from_op}/getMe")
new_ok=$(echo "$new_response" | jq -r '.ok')
if [[ "$new_ok" != "true" ]]; then
  echo "ERROR: NEW token getMe returned ok=false. Response:" >&2
  echo "$new_response" >&2
  emit_ndjson "6/6" "fail" "new token getMe failed"
  exit 1
fi
new_username=$(echo "$new_response" | jq -r '.result.username')
new_id=$(echo "$new_response" | jq -r '.result.id')
if [[ "$new_id" != "$pre_id" ]]; then
  echo "ERROR: NEW token points at bot id=${new_id}, expected ${pre_id}" >&2
  echo "Wrong bot rotated? Aborting before daemon restart." >&2
  emit_ndjson "6/6" "fail" "bot id mismatch new=$new_id pre=$pre_id"
  exit 1
fi
echo "  OK NEW token resolves to @${new_username} (id=${new_id}) — same bot"
emit_ndjson "6/6" "ok" "username=$new_username id=$new_id"

# ---------- Final summary ----------
echo ""
echo "Telegram bot rotation complete. Bot username preserved: @${pre_username}"
echo "Next: restart iago-os-v2-daemon.service via cutover.sh (Plan 03a) to pick up the new credential."
emit_ndjson "complete" "ok" "bot @$pre_username id=$pre_id rotated"
