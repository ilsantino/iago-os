#!/usr/bin/env bash
#
# archive-openclaw.sh — Stop, archive, encrypt, and retain the legacy OpenClaw
# user-systemd deployment on the Hostinger VPS at FAST cutover-time.
#
# Purpose:
#   Phase 2 cutover retires `openclaw-gateway.service` (user systemd unit under
#   user@1001.service for ilsantino). This script captures the entire
#   ~ilsantino/.openclaw/ tree (sessions + credentials + LanceDB content),
#   age-encrypts the tarball to Santiago's pubkey, records a SHA256 manifest
#   row, and installs a systemd timer for 30-day retention pruning.
#
# Idempotency:
#   Same UTC date → same final state. Default behavior: if an encrypted archive
#   already exists for today (matching openclaw-pre-cutover-YYYYMMDD-*.age), the
#   script exits 0 without doing anything. Pass --force-new-archive to override
#   and create a second snapshot (distinguished by HHMMSS portion of timestamp);
#   the manifest gets a second row for the same date. Repeated invocations
#   without the flag are no-ops once the day's archive exists.
#
# Encryption rationale:
#   ~/.openclaw/ contains plaintext Anthropic credentials, Telegram bot tokens,
#   and ~12 MiB of session state. Local-only retention on the VPS is unsafe
#   (any future root compromise reads the tarball). age-encrypted with
#   Santiago's pubkey means the private key (stored offline on Santiago's
#   Windows box at ~/.age/santiago.key) is required to decrypt — VPS state is
#   safe at rest.
#
# Retention rationale:
#   30 days is the FAST-cutover rollback window. After 30 days, OpenClaw
#   rollback is no longer the documented recovery path (re-provision a fresh
#   VPS from Phase 0 audit + Phase 2 plans instead). systemd timer (NOT cron —
#   VPS has no crontab per Phase 0 audit) prunes *.age files older than 30
#   days. Pruning logs to journal via `logger -t iago-archive-prune` for
#   audit (`journalctl -t iago-archive-prune`).
#
# OpenClaw mid-task semantics:
#   SIGTERM to the user systemd unit (`systemctl --user stop
#   openclaw-gateway.service`) interrupts any in-flight Claude session inside
#   OpenClaw. Acceptable per FAST cutover — rollback restores the session
#   state from ~/.openclaw/sessions/ which is captured inside the encrypted
#   tarball. Operator MUST run this script ONLY at the agreed cutover window
#   when Santiago is at keyboard and acknowledges any in-flight OpenClaw work
#   will be lost. Do not run this script in a maintenance window without
#   confirming with Santiago first.
#
# Wrong-but-valid pubkey hazard:
#   A pubkey that is syntactically valid age (age1...) but corresponds to a
#   private key Santiago does NOT possess produces age-encryption.org/v1-
#   formatted ciphertext that passes the magic-byte header check yet is
#   permanently unrecoverable. Step 4b runs a bogus-identity probe against
#   the produced ciphertext, expecting age to fail with "no identity matched".
#   Any other response (silent success, hang, different error) means the
#   pubkey isn't behaving like a real age recipient — abort, do not proceed.
#
# Source of truth: .iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md § 4
#
set -euo pipefail

# ---------- Constants ----------
OPENCLAW_USER="ilsantino"
OPENCLAW_HOME="/home/ilsantino"
OPENCLAW_DIR="${OPENCLAW_HOME}/.openclaw"
ARCHIVE_ROOT="/var/lib/iago-os/openclaw-archive"
MANIFEST="${ARCHIVE_ROOT}/MANIFEST.md"
MANIFEST_LOCK="${MANIFEST}.lock"
PUBKEY="/etc/iago-os/santiago-age.pub"
SERVICE="openclaw-gateway.service"
NDJSON_LOG="/var/log/iago-os/cutover.ndjson"
PRUNE_SERVICE="/etc/systemd/system/iago-archive-prune.service"
PRUNE_TIMER="/etc/systemd/system/iago-archive-prune.timer"
RETENTION_DAYS=30
# age v1 file format magic bytes (literal header at byte 0 of any age ciphertext).
AGE_HEADER_MAGIC="age-encryption.org/v1"
AGE_HEADER_LEN=${#AGE_HEADER_MAGIC}

# ---------- Argv ----------
FORCE=0
for arg in "$@"; do
	case "$arg" in
		--force-new-archive) FORCE=1 ;;
		-h|--help)
			cat <<'EOF'
Usage: archive-openclaw.sh [--force-new-archive]

Stops openclaw-gateway.service (user@1001), archives ~ilsantino/.openclaw/,
encrypts to Santiago's age pubkey, records a manifest row, and installs a
30-day retention timer. Idempotent: same UTC date → same final state unless
--force-new-archive is passed.

Run as root, on the VPS, during the agreed cutover window.
EOF
			exit 0
			;;
	esac
done

# ---------- NDJSON helper ----------
ndjson_event() {
	# Args: kind, step, status, extra_json (optional, must already be JSON-shaped)
	local kind="$1" step="$2" status="$3" extra="${4:-}"
	local ts
	ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	mkdir -p "$(dirname "$NDJSON_LOG")"
	if [[ -n "$extra" ]]; then
		printf '{"ts":"%s","script":"archive-openclaw.sh","kind":"%s","step":"%s","status":"%s","extra":%s}\n' \
			"$ts" "$kind" "$step" "$status" "$extra" >> "$NDJSON_LOG"
	else
		printf '{"ts":"%s","script":"archive-openclaw.sh","kind":"%s","step":"%s","status":"%s"}\n' \
			"$ts" "$kind" "$step" "$status" >> "$NDJSON_LOG"
	fi
}

# ---------- Pre-flight ----------
# Must run as root (we touch /etc/systemd/system + /var/lib + su to ilsantino).
if [[ "$(id -u)" -ne 0 ]]; then
	echo "ERROR: must run as root (sudo bash $0)" >&2
	exit 1
fi

# age is the encryption tool — abort early if missing.
if ! command -v age > /dev/null; then
	echo "ERROR: 'age' not installed. apt install age (Debian 13 has it in main)" >&2
	exit 1
fi

# age-keygen is invoked at step 4b for the bogus-identity probe. Pre-flight
# check mirrors the `age` guard above so a missing age-keygen does NOT cause
# the script to fail at step 4b *after* shred -u has already destroyed the
# raw tarball at step 4. age + age-keygen typically ship together on Debian
# 13, but a minimal/unusual image could trim one without the other.
if ! command -v age-keygen > /dev/null; then
	echo "ERROR: 'age-keygen' not installed (typically ships with age). apt install age" >&2
	exit 1
fi

# jq required for response parsing in sibling cutover scripts; defensive guard
# here in case a future minimal VPS image trims base packages.
if ! command -v jq > /dev/null; then
	echo "ERROR: jq required for response parsing. apt install jq" >&2
	exit 1
fi

# sha256sum is part of coreutils on Debian — defensive guard.
if ! command -v sha256sum > /dev/null; then
	echo "ERROR: sha256sum required (coreutils). apt install coreutils" >&2
	exit 1
fi

# Pubkey must exist. If missing, operator forgot the provisioning step.
if [[ ! -f "$PUBKEY" ]]; then
	echo "ERROR: age pubkey not found at $PUBKEY" >&2
	echo "       scp ~/.age/santiago.pub santiago@srv1456441:/tmp/ and" >&2
	echo "       sudo install -m 0644 /tmp/santiago.pub $PUBKEY" >&2
	exit 1
fi

# Ensure the archive root exists with safe perms before we touch it.
mkdir -p "$ARCHIVE_ROOT"
chmod 0700 "$ARCHIVE_ROOT"

# ---------- Step 6 (run early): install retention timer ----------
# The retention timer install runs UNCONDITIONALLY on every invocation, before
# the OpenClaw-dir-exists check and the day-sentinel exit. It has its own
# idempotency guard (file existence) so re-runs are no-ops. Running it early
# closes a partial-failure gap: if steps 1-5 succeed but the original step 6
# fails (e.g., systemctl is wedged), a same-day re-run without
# --force-new-archive would hit the day-sentinel exit and the timer would
# remain uninstalled silently. Running it early means every invocation
# re-attempts the install, even idempotent skips, so a stuck timer recovers
# on the next run.
echo "[6/6] install iago-archive-prune.{service,timer} (${RETENTION_DAYS}-day retention)"
ndjson_event "archive-openclaw" "step6-timer" "begin"
if [[ -f "$PRUNE_SERVICE" && -f "$PRUNE_TIMER" ]]; then
	echo "      already installed"
	ndjson_event "archive-openclaw" "step6-timer" "already-installed"
else
	cat > "$PRUNE_SERVICE" <<EOF
[Unit]
Description=Prune iago-os OpenClaw archives older than ${RETENTION_DAYS} days
Documentation=file://${ARCHIVE_ROOT}/MANIFEST.md

[Service]
Type=oneshot
ExecStart=/usr/bin/bash -c 'count=\$(find ${ARCHIVE_ROOT} -name "*.age" -mtime +${RETENTION_DAYS} -print -delete | wc -l); logger -t iago-archive-prune "pruned \$count archives"'
EOF
	cat > "$PRUNE_TIMER" <<'EOF'
[Unit]
Description=Daily prune of iago-os OpenClaw archives
Documentation=file:///var/lib/iago-os/openclaw-archive/MANIFEST.md

[Timer]
OnCalendar=daily
Persistent=true
Unit=iago-archive-prune.service

[Install]
WantedBy=timers.target
EOF
	chmod 0644 "$PRUNE_SERVICE" "$PRUNE_TIMER"
	systemctl daemon-reload
	systemctl enable --now iago-archive-prune.timer
	echo "      installed + enabled"
	ndjson_event "archive-openclaw" "step6-timer" "ok"
fi

# If OpenClaw was never installed (e.g., re-running script on a fresh VPS), exit 0.
if [[ ! -d "$OPENCLAW_DIR" ]]; then
	echo "[0/6] $OPENCLAW_DIR does not exist — nothing to archive. exiting 0."
	ndjson_event "archive-openclaw" "preflight" "nothing-to-archive"
	exit 0
fi

# Idempotency day-sentinel check (Codex P1-3 fix).
TODAY_UTC=$(date -u +%Y%m%d)
EXISTING_TODAY=$(find "$ARCHIVE_ROOT" -name "openclaw-pre-cutover-${TODAY_UTC}-*.age" 2>/dev/null | head -1)
if [[ -n "$EXISTING_TODAY" && "$FORCE" -ne 1 ]]; then
	echo "archive for today already exists at $EXISTING_TODAY — re-run skipped (use --force-new-archive to override)"
	ndjson_event "archive-openclaw" "preflight" "idempotent-skip" "{\"existing\":\"$EXISTING_TODAY\"}"
	exit 0
fi

# ---------- Step 1: stop openclaw-gateway.service ----------
echo "[1/6] stop openclaw-gateway.service (user systemd, ilsantino)"
ndjson_event "archive-openclaw" "step1-stop" "begin"
if su - "$OPENCLAW_USER" -c "systemctl --user is-active --quiet $SERVICE"; then
	su - "$OPENCLAW_USER" -c "systemctl --user stop $SERVICE"
	echo "      stopped"
else
	echo "      already stopped"
fi
ndjson_event "archive-openclaw" "step1-stop" "ok"

# ---------- Step 2: disable + verify no leftover process ----------
echo "[2/6] disable $SERVICE + verify no leftover process"
ndjson_event "archive-openclaw" "step2-disable" "begin"
if su - "$OPENCLAW_USER" -c "systemctl --user is-enabled --quiet $SERVICE"; then
	su - "$OPENCLAW_USER" -c "systemctl --user disable $SERVICE"
	echo "      disabled"
else
	echo "      already disabled"
fi
# Belt-and-braces: the systemd unit may have stopped, but a stray python
# subprocess could still be running. pgrep finds any remaining process.
if pgrep -u "$OPENCLAW_USER" -f openclaw-gateway > /dev/null; then
	echo "ERROR: openclaw-gateway process still running under $OPENCLAW_USER — aborting" >&2
	ndjson_event "archive-openclaw" "step2-disable" "error" '{"reason":"process-still-running"}'
	exit 1
fi
ndjson_event "archive-openclaw" "step2-disable" "ok"

# ---------- Step 3: tar the OpenClaw home ----------
echo "[3/6] tar ${OPENCLAW_DIR} → ${ARCHIVE_ROOT}/openclaw-pre-cutover-<ts>.tar.gz"
ndjson_event "archive-openclaw" "step3-tar" "begin"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
TARBALL_NAME="openclaw-pre-cutover-${TIMESTAMP}.tar.gz"
TARBALL_PATH="${ARCHIVE_ROOT}/${TARBALL_NAME}"
# Ensure plaintext tarball is shredded even if age, stat, or sha256sum fails.
# The script's own comment says "Raw tarball MUST NOT persist on disk".
trap 'shred -u "$TARBALL_PATH" 2>/dev/null || rm -f "$TARBALL_PATH"' EXIT
# tar exit 1 = warnings only (e.g., file changed during read — expected briefly
# after the systemd stop); 2+ = hard errors. We tolerate 1, fail on >=2.
set +e
tar -czf "$TARBALL_PATH" --warning=no-file-changed -C / "home/${OPENCLAW_USER}/.openclaw"
rc=$?
set -e
if [[ $rc -ne 0 && $rc -ne 1 ]]; then
	echo "ERROR: tar failed with exit code $rc" >&2
	ndjson_event "archive-openclaw" "step3-tar" "error" "{\"rc\":$rc}"
	exit $rc
fi
RAW_SIZE=$(stat -c %s "$TARBALL_PATH")
RAW_SHA=$(sha256sum "$TARBALL_PATH" | awk '{print $1}')
echo "      tar ok (rc=$rc); raw size=${RAW_SIZE} bytes; raw sha256=${RAW_SHA}"
ndjson_event "archive-openclaw" "step3-tar" "ok" "{\"rc\":$rc,\"raw_size\":$RAW_SIZE,\"raw_sha\":\"$RAW_SHA\"}"

# ---------- Step 4: age-encrypt + shred raw + chmod/chown ----------
echo "[4/6] age-encrypt → ${TARBALL_NAME}.age; shred raw tarball"
ndjson_event "archive-openclaw" "step4-encrypt" "begin"
ENCRYPTED_NAME="${TARBALL_NAME}.age"
ENCRYPTED_PATH="${ARCHIVE_ROOT}/${ENCRYPTED_NAME}"
age -R "$PUBKEY" -o "$ENCRYPTED_PATH" "$TARBALL_PATH"
ENC_SIZE=$(stat -c %s "$ENCRYPTED_PATH")
ENC_SHA=$(sha256sum "$ENCRYPTED_PATH" | awk '{print $1}')
# Raw tarball MUST NOT persist on disk — contains plaintext credentials.
shred -u "$TARBALL_PATH"
trap - EXIT  # tarball gone; EXIT trap no longer needed
chmod 0600 "$ENCRYPTED_PATH"
chown root:root "$ENCRYPTED_PATH"
echo "      encrypted ok; enc size=${ENC_SIZE} bytes; enc sha256=${ENC_SHA}"
ndjson_event "archive-openclaw" "step4-encrypt" "ok" "{\"enc_size\":$ENC_SIZE,\"enc_sha\":\"$ENC_SHA\"}"

# Step 4a: magic-byte header check — catches silent encryption failures where
# age exits 0 but produces empty/random output. age v1 file format starts with
# the literal string "age-encryption.org/v1".
echo "[4a/6] verify age header magic bytes"
if head -c "$AGE_HEADER_LEN" "$ENCRYPTED_PATH" | grep -qF "$AGE_HEADER_MAGIC"; then
	echo "      ✓ age header present"
else
	echo "ERROR: encrypted file lacks age header — encryption may have silently failed" >&2
	ndjson_event "archive-openclaw" "step4a-magic" "error"
	exit 1
fi
ndjson_event "archive-openclaw" "step4a-magic" "ok"

# Step 4b: bogus-identity probe (C2 fix). Generate a syntactically valid but
# wrong age private key in-memory, attempt to decrypt the ciphertext, and
# REQUIRE that age fails with the specific "no identity matched" error. Any
# other outcome (silent success, hang, different error) means the recipient
# wasn't behaving as a real age recipient — the actual pubkey may be wrong-
# but-valid and Santiago will never be able to decrypt.
echo "[4b/6] bogus-identity probe (proves recipient is a real age recipient)"
BOGUS_KEY="/tmp/iago-bogus-age.key.$$"
# Use a fresh, ephemeral throwaway keypair generated by age-keygen so the
# bogus identity is guaranteed to be syntactically valid and accepted by age
# as a real identity, yet (by construction) different from the pubkey on the
# archive — guaranteeing the "no identity matched" branch is the correct
# expected response.
# If /tmp is tmpfs, shred below is a no-op (data is in RAM); the key evaporates
# on unlink anyway, so the security consequence is negligible.
age-keygen -o "$BOGUS_KEY" 2>/dev/null
chmod 0600 "$BOGUS_KEY"
set +e
# 2>&1 1>/dev/null: redirect stdout to /dev/null first, then stderr to the $()
# pipe — captures stderr (age error msg) while discarding stdout (decrypted data).
PROBE_OUT=$(age -d -i "$BOGUS_KEY" "$ENCRYPTED_PATH" 2>&1 1>/dev/null)
PROBE_RC=$?
set -e
shred -u "$BOGUS_KEY"
# "no identity matched" substring covers age 1.0+ wording (confirmed on Debian 13
# age package). Conservative failure mode if age changes this string entirely.
if [[ $PROBE_RC -ne 0 ]] && echo "$PROBE_OUT" | grep -q "no identity matched"; then
	echo "      ✓ encrypted with correct pubkey (bogus identity correctly rejected: 'no identity matched')"
	ndjson_event "archive-openclaw" "step4b-probe" "ok"
else
	echo "ERROR: age decryption with bogus identity returned unexpected response (rc=$PROBE_RC)" >&2
	echo "       output: $PROBE_OUT" >&2
	echo "       pubkey at $PUBKEY may be wrong-but-valid; encrypted archive may be unrecoverable" >&2
	ndjson_event "archive-openclaw" "step4b-probe" "error" "{\"rc\":$PROBE_RC}"
	exit 1
fi

# ---------- Step 5: append manifest row (flock-guarded) ----------
echo "[5/6] append manifest row → ${MANIFEST}"
ndjson_event "archive-openclaw" "step5-manifest" "begin"
# Create manifest with header if absent. This duplicates the content of
# runtime/deploy/MANIFEST.template.md — if you edit one, edit the other (or
# refactor the script to cat the template; see template note for why we
# duplicate today).
if [[ ! -f "$MANIFEST" ]]; then
	cat > "$MANIFEST" <<'MANIFEST_HEADER'
# OpenClaw Archive Manifest

Archives created by `runtime/deploy/archive-openclaw.sh`. Encrypted to
Santiago's age pubkey at `/etc/iago-os/santiago-age.pub`. Retention: 30 days
from creation. Deletion by `iago-archive-prune.timer` (systemd timer; lives
at `/etc/systemd/system/iago-archive-prune.timer` on the VPS).

## Decryption recipe

```bash
# From Santiago's Windows box (private key at ~/.age/santiago.key):
scp santiago@srv1456441:/var/lib/iago-os/openclaw-archive/<file>.age .
age -d -i ~/.age/santiago.key <file>.age > <file>.tar.gz
tar -xzf <file>.tar.gz
```

## Audit

```bash
# Check prune timer status on the VPS:
journalctl -t iago-archive-prune
systemctl status iago-archive-prune.timer
```

## Archives

| Timestamp (UTC) | File | Raw size | Raw SHA256 | Encrypted size | Encrypted SHA256 |
| --- | --- | --- | --- | --- | --- |
MANIFEST_HEADER
	chmod 0600 "$MANIFEST"
fi
# flock-guarded append: prevents row corruption if two operators run the
# script simultaneously (e.g., Santiago + Sebas during a debug session).
(
	flock -w 5 200 || {
		echo "ERROR: could not acquire $MANIFEST_LOCK within 5s" >&2
		exit 1
	}
	printf '| %s | %s | %s | %s | %s | %s |\n' \
		"$TIMESTAMP" "$ENCRYPTED_NAME" "$RAW_SIZE" "$RAW_SHA" "$ENC_SIZE" "$ENC_SHA" \
		>> "$MANIFEST"
) 200>"$MANIFEST_LOCK"
echo "      manifest row appended"
ndjson_event "archive-openclaw" "step5-manifest" "ok"

# Step 6 (retention timer install) already ran near top of script — see
# block above. Located early so that a partial failure between steps 1-5
# and step 6 cannot leave the VPS without a prune timer on a same-day
# re-run (the day-sentinel would otherwise exit 0 before reaching it).

# ---------- Summary ----------
cat <<EOF

archive-openclaw.sh: done
  encrypted archive : ${ENCRYPTED_PATH}
  raw size          : ${RAW_SIZE} bytes
  raw sha256        : ${RAW_SHA}
  encrypted size    : ${ENC_SIZE} bytes
  encrypted sha256  : ${ENC_SHA}
  manifest          : ${MANIFEST}
  retention         : ${RETENTION_DAYS} days (iago-archive-prune.timer)
  audit prune log   : journalctl -t iago-archive-prune
EOF
ndjson_event "archive-openclaw" "done" "ok"
