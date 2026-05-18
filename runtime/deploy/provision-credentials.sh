#!/usr/bin/env bash
# runtime/deploy/provision-credentials.sh
#
# Provisions encrypted credentials for iago-os-v2-daemon.service on
# the Hostinger VPS via Tailscale SSH.
#
# Per ADR 2026-05-15 § HTTP-shape adapter authentication:
#   - 1Password CLI is the provisioning input (this script)
#   - systemd LoadCredentialEncrypted= is the runtime path
#   - 1Password CLI NEVER runs on the VPS
#   - Plaintext token NEVER touches local OR remote disk (stdin pipe)
#
# Idempotent — safe to re-run for rotation. The systemd-creds encrypt
# step produces a fresh ciphertext on each run (random nonce); the
# daemon picks up the new credential on next restart.
#
# Usage:
#   bash runtime/deploy/provision-credentials.sh telegram-token
#   bash runtime/deploy/provision-credentials.sh gh-token
#   bash runtime/deploy/provision-credentials.sh anthropic-default
#   bash runtime/deploy/provision-credentials.sh all
#
# Prerequisites:
#   - 1Password CLI installed locally + signed in (`op signin`)
#   - Tailscale CLI installed locally + Hostinger VPS reachable
#   - root SSH on the VPS via Tailscale (current state per Phase 0 audit)
#   - 1Password vault item names per the table in runtime/deploy/README.md
#
# Does NOT restart the daemon — only daemon-reloads after writing
# credentials. Santiago triggers restart explicitly via Plan 03a
# cutover.sh so credential rotation is observable, not silent.

set -euo pipefail

VPS_HOST="${VPS_HOST:-srv1456441}"   # Tailscale node name
VPS_USER="${VPS_USER:-root}"
CREDSTORE="/etc/credstore.encrypted"
UNIT_NAME="iago-os-v2-daemon.service"

# Credential map — local 1Password reference → remote credential file name
# Format: [cred-key]="op://<vault>/<item>/<field>::<remote-cred-name>"
#
# gh-token: GitHub classic PAT, scopes "repo" + "read:org", 90-day
# expiry (regenerate via `provision-credentials.sh gh-token`). Used
# by Plan 04a/04b PR-triage agent (spawned via PTY adapter — needs
# GH_TOKEN in the spawned shell env).
declare -A CRED_MAP=(
  [telegram-token]="op://iago-os/v2-daemon-telegram-bot/token::iago-telegram-token"
  [gh-token]="op://iago-os/v2-gh-token/token::iago-gh-token"
  [anthropic-default]="op://iago-os/v2-anthropic-default/token::iago-anthropic-default"
  [anthropic-ilsantino]="op://iago-os/v2-anthropic-ilsantino/token::iago-anthropic-ilsantino"
  [anthropic-iaguito]="op://iago-os/v2-anthropic-iaguito/token::iago-anthropic-iaguito"
)

usage() {
  cat <<EOF
Usage: $0 <cred-key> [<cred-key>...]

Available cred-keys:
$(printf '  %s\n' "${!CRED_MAP[@]}")
  all              (provisions every key)

Examples:
  $0 telegram-token
  $0 gh-token
  $0 telegram-token gh-token
  $0 all

Environment:
  VPS_HOST   Tailscale node name (default: srv1456441)
  VPS_USER   SSH user on VPS (default: root)
EOF
  exit 64
}

if [[ $# -eq 0 ]]; then
  usage
fi

# Expand "all" to every key
if [[ "$1" == "all" ]]; then
  set -- "${!CRED_MAP[@]}"
fi

# Validate every key BEFORE making any remote changes
for key in "$@"; do
  if [[ -z "${CRED_MAP[$key]:-}" ]]; then
    echo "ERROR: unknown cred-key '$key'" >&2
    usage
  fi
done

# Pre-flight: confirm 1Password CLI signed in
if ! op whoami > /dev/null 2>&1; then
  echo "ERROR: 1Password CLI not signed in. Run: op signin" >&2
  exit 1
fi

# Pre-flight: confirm Tailscale SSH reachable
if ! tailscale ssh "${VPS_USER}@${VPS_HOST}" -- true > /dev/null 2>&1; then
  echo "ERROR: cannot reach ${VPS_USER}@${VPS_HOST} over Tailscale SSH" >&2
  echo "Check: tailscale status; ensure VPS is online" >&2
  exit 1
fi

# Pre-flight: confirm credstore dir exists on VPS
tailscale ssh "${VPS_USER}@${VPS_HOST}" -- "mkdir -p ${CREDSTORE} && chmod 0700 ${CREDSTORE}"

for key in "$@"; do
  spec="${CRED_MAP[$key]}"
  op_ref="${spec%%::*}"        # everything before ::
  cred_name="${spec##*::}"     # everything after ::

  echo "Provisioning ${cred_name} from ${op_ref}..."

  # Capture the 1Password value ONCE into a shell variable, then reuse
  # for both the encrypt pipe and the local length comparison. Reasons:
  #   1. TOCTOU — two `op read` invocations could race a concurrent
  #      rotation in 1Password and ship encrypted value A while
  #      comparing length against value B.
  #   2. Halves 1Password API calls (matters for `all`, which loops 5×).
  # The `; printf X` + `${var%X}` trick preserves trailing newlines
  # which bash command substitution would otherwise strip — keeps the
  # bytes shipped identical to what `op read` produces verbatim.
  plaintext_marker=$(op read "$op_ref"; printf 'X')
  plaintext="${plaintext_marker%X}"
  unset plaintext_marker
  local_len=$(printf '%s' "$plaintext" | wc -c | tr -d ' \n')

  # 1Password → systemd-creds encrypt → /etc/credstore.encrypted/
  # The plaintext NEVER lands on local or remote disk (only in this
  # script's process memory and the SSH stdin pipe).
  #
  # systemd-creds encrypt:
  #   --name=<cred_name> binds the name into the ciphertext (prevents
  #     swapping ciphertexts across credentials with different names)
  #   reads plaintext from stdin (-)
  #   writes ciphertext to a path argument
  #
  # mktemp + chmod 0600 + mv gives atomic publish. Mode 0600 root:root.

  printf '%s' "$plaintext" \
    | tailscale ssh "${VPS_USER}@${VPS_HOST}" -- "
        set -e
        tmpfile=\$(mktemp '${CREDSTORE}/.${cred_name}.XXXXXX.cred')
        trap 'rm -f \"\$tmpfile\"' EXIT
        chmod 0600 \"\$tmpfile\"
        systemd-creds encrypt --name='${cred_name}' - \"\$tmpfile\"
        mv \"\$tmpfile\" '${CREDSTORE}/${cred_name}.cred'
        chown root:root '${CREDSTORE}/${cred_name}.cred'
        chmod 0600 '${CREDSTORE}/${cred_name}.cred'
      "

  # Verify: decrypt round-trip and confirm length matches the captured
  # local plaintext (NOT a fresh `op read` — that would re-introduce
  # the TOCTOU window the capture-once pattern just closed).
  remote_len=$(tailscale ssh "${VPS_USER}@${VPS_HOST}" -- \
    "systemd-creds decrypt '${CREDSTORE}/${cred_name}.cred' - | wc -c | tr -d ' \n'")

  # Drop the captured plaintext as soon as we have what we need from it.
  unset plaintext

  if [[ "$remote_len" != "$local_len" ]]; then
    echo "ERROR: round-trip length mismatch for ${cred_name} (local=$local_len remote=$remote_len)" >&2
    exit 1
  fi

  echo "  OK ${cred_name} provisioned (len=${remote_len})"
done

# Reload the unit so it picks up new credentials on next restart.
# Does NOT restart the daemon — Santiago triggers that explicitly via
# the cutover runbook so credential rotation is observable, not silent.
tailscale ssh "${VPS_USER}@${VPS_HOST}" -- "systemctl daemon-reload"

echo ""
echo "Provisioning complete. To activate:"
echo "  tailscale ssh ${VPS_USER}@${VPS_HOST} -- systemctl restart ${UNIT_NAME}"
echo "  tailscale ssh ${VPS_USER}@${VPS_HOST} -- systemctl status ${UNIT_NAME}"
