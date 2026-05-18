#!/usr/bin/env bash
#
# revoke-whatsapp.sh — Meta Graph API curl wrapper that revokes the
# WhatsApp Cloud API webhook subscription + long-lived system-user
# access token OpenClaw used. Run AFTER archive-openclaw.sh has
# stopped openclaw-gateway.service (Plan 02a). Six-step sequence
# verbatim from `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md`
# § 7.
#
# Meta credentials provenance:
#   1Password vault `iago-os` item `whatsapp-app-credentials`
#   (per OQ5 in the Phase 2 spec). The four IDs + the system-user
#   token are stored there. This script NEVER touches 1Password
#   directly — Santiago exports the values into the environment
#   before invoking the script (see Inputs section of the runbook
#   at runtime/migration/02-whatsapp-deauth.md). Reason: these are
#   one-time-use values for a one-time deauth, not rotating runtime
#   credentials. The provisioning-script pattern is overkill here.
#
# Non-idempotent — running twice on an already-revoked token will
# fail at step 2 (DELETE subscribed_apps) because the binding is
# already gone. That failure IS the intended verification signal
# on a second run: it proves step 2 worked the first time. Do not
# treat a step-2 failure as a re-run error — investigate the
# previous run's manifest first.
#
# Required env vars (script fails loudly if missing):
#   WABA_ID            WhatsApp Business Account ID (~15 digits)
#   APP_ID             Meta App ID (~15 digits)
#   APP_SECRET         Meta App secret (used for debug_token call)
#   SYSTEM_USER_TOKEN  The long-lived access token to revoke
#
# Optional env vars:
#   PHONE_NUMBER_ID    Cloud API phone number ID (echoed only)
#
# Steps:
#   [1/6] Confirm OpenClaw is stopped (assertion only)
#   [2/6] DELETE /<WABA_ID>/subscribed_apps  → success:true
#   [3/6] GET    /<WABA_ID>/subscribed_apps  → empty or other apps
#   [4/6] DELETE /me/permissions             → success:true
#   [5/6] GET    /debug_token                → is_valid:false
#   [6/6] GET    /me                         → HTTP 400 or 401
#
# Telemetry: writes one NDJSON line per step to
# /var/log/iago-os/cutover.ndjson if writable (spec § 10 criterion 5).
# Silent no-op if the path is not writable (script invoked standalone
# outside the cutover-runbook context — Plan 03a cutover.sh creates
# the dir + file).
#
# Source of truth: .iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md § 7

set -euo pipefail

# ---------- Pre-flight: required commands ----------
# C1 from stress test: defensive guards against a minimal Debian VPS
# that lacks jq. Phase 0 audit confirmed jq present, but the cost of
# the check is zero and the cost of a missing-jq surprise mid-cutover
# is high.
command -v curl > /dev/null || {
  echo "ERROR: curl required. apt install curl" >&2
  exit 1
}
command -v jq > /dev/null || {
  echo "ERROR: jq required for response parsing. apt install jq" >&2
  exit 1
}

# ---------- Pre-flight: required env vars ----------
: "${WABA_ID:?ERROR: WABA_ID env var required (WhatsApp Business Account ID)}"
: "${APP_ID:?ERROR: APP_ID env var required (Meta App ID)}"
: "${APP_SECRET:?ERROR: APP_SECRET env var required (Meta App secret)}"
: "${SYSTEM_USER_TOKEN:?ERROR: SYSTEM_USER_TOKEN env var required (long-lived access token)}"
PHONE_NUMBER_ID="${PHONE_NUMBER_ID:-<not-set>}"

# ---------- Constants ----------
GRAPH_BASE="https://graph.facebook.com/v21.0"
NDJSON_PATH="/var/log/iago-os/cutover.ndjson"
OPENCLAW_USER="ilsantino"
OPENCLAW_SERVICE="openclaw-gateway.service"

# ---------- Telemetry helper ----------
# Writes one NDJSON record per step. No-op if path is not writable.
emit_ndjson() {
  local step="$1"
  local status="$2"
  local detail="$3"
  if [[ -w "$NDJSON_PATH" ]] || { [[ ! -e "$NDJSON_PATH" ]] && [[ -w "$(dirname "$NDJSON_PATH")" ]]; }; then
    printf '{"ts":"%s","script":"revoke-whatsapp.sh","step":"%s","status":"%s","detail":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$step" "$status" "$(printf '%s' "$detail" | jq -Rs .)" \
      >> "$NDJSON_PATH" 2>/dev/null || true
  fi
}

# ---------- Step 1/6: confirm OpenClaw stopped ----------
echo "[1/6] Confirming OpenClaw is stopped (archive-openclaw.sh dependency)..."
if id "$OPENCLAW_USER" > /dev/null 2>&1; then
  state=$(su - "$OPENCLAW_USER" -c "systemctl --user is-active $OPENCLAW_SERVICE" 2>/dev/null || echo "unknown")
  if [[ "$state" == "active" ]]; then
    echo "ERROR: $OPENCLAW_SERVICE is still active. Run archive-openclaw.sh first (Plan 02a)." >&2
    emit_ndjson "1/6" "fail" "openclaw still active"
    exit 1
  fi
  echo "  OK OpenClaw state: $state (inactive/failed/unknown — safe to proceed)"
  emit_ndjson "1/6" "ok" "openclaw state: $state"
else
  echo "  NOTE: user '$OPENCLAW_USER' not present on this host. Assuming OpenClaw never ran here."
  emit_ndjson "1/6" "ok" "user $OPENCLAW_USER absent"
fi

# ---------- Step 2/6: DELETE webhook subscription ----------
echo "[2/6] DELETE /${WABA_ID}/subscribed_apps (removes Meta webhook binding)..."
response=$(curl -sS -X DELETE \
  "${GRAPH_BASE}/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}")
success=$(echo "$response" | jq -r '.success // false')
if [[ "$success" != "true" ]]; then
  echo "ERROR: subscribed_apps DELETE did not return success:true. Response:" >&2
  echo "$response" >&2
  emit_ndjson "2/6" "fail" "$response"
  exit 1
fi
echo "  OK subscribed_apps unsubscribed"
emit_ndjson "2/6" "ok" "$response"

# ---------- Step 3/6: VERIFY subscription removed ----------
echo "[3/6] GET /${WABA_ID}/subscribed_apps (verify deletion)..."
response=$(curl -sS -X GET \
  "${GRAPH_BASE}/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}")
echo "  Subscribed apps after DELETE:"
echo "$response" | jq .
emit_ndjson "3/6" "ok" "$response"

# ---------- Step 4/6: REVOKE access token (app-side) ----------
echo "[4/6] DELETE /me/permissions (revokes this access token)..."
response=$(curl -sS -X DELETE \
  "${GRAPH_BASE}/me/permissions" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}")
success=$(echo "$response" | jq -r '.success // false')
if [[ "$success" != "true" ]]; then
  echo "ERROR: /me/permissions DELETE did not return success:true. Response:" >&2
  echo "$response" >&2
  emit_ndjson "4/6" "fail" "$response"
  exit 1
fi
echo "  OK token revoked at app level"
emit_ndjson "4/6" "ok" "$response"

# ---------- Step 5/6: debug_token must report is_valid:false ----------
echo "[5/6] GET /debug_token (verify token is_valid=false)..."
response=$(curl -sS \
  "${GRAPH_BASE}/debug_token?input_token=${SYSTEM_USER_TOKEN}&access_token=${APP_ID}|${APP_SECRET}")
is_valid=$(echo "$response" | jq -r '.data.is_valid')
if [[ "$is_valid" != "false" ]]; then
  echo "ERROR: debug_token reports is_valid=${is_valid} (expected false). Response:" >&2
  echo "$response" >&2
  emit_ndjson "5/6" "fail" "$response"
  exit 1
fi
echo "  OK debug_token confirms is_valid:false"
emit_ndjson "5/6" "ok" "$response"

# ---------- Step 6/6: direct /me probe must return 400 or 401 ----------
echo "[6/6] GET /me with revoked token (expect HTTP 400 or 401)..."
http_code=$(curl -sS -o /dev/null -w "%{http_code}" \
  "${GRAPH_BASE}/me" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}")
if [[ "$http_code" != "400" && "$http_code" != "401" ]]; then
  echo "ERROR: /me returned HTTP ${http_code} (expected 400 or 401 — token should be dead)" >&2
  emit_ndjson "6/6" "fail" "http_code=$http_code"
  exit 1
fi
echo "  OK /me returned HTTP ${http_code} (token rejected as expected)"
emit_ndjson "6/6" "ok" "http_code=$http_code"

# ---------- Final summary + manual step reminder ----------
echo ""
echo "WhatsApp deauth complete."
echo "  WABA_ID         = ${WABA_ID}"
echo "  PHONE_NUMBER_ID = ${PHONE_NUMBER_ID}"
echo ""
echo "Manual step required (NOT scripted):"
echo "  Open Meta Business Suite -> Business Settings -> Users -> System Users"
echo "  Find the system user OpenClaw used. Click 'Remove' (or disable token)."
echo "  Document the click path in the PR description with a screenshot."
echo ""
echo "This script is non-idempotent: re-running will fail at step [2/6] because"
echo "the subscribed_apps binding is already deleted. That failure is the"
echo "intended verification signal — do not treat it as an error."

emit_ndjson "complete" "ok" "waba=$WABA_ID phone=$PHONE_NUMBER_ID"
