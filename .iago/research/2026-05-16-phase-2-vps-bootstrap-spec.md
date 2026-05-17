# Phase 2 — VPS Bootstrap + FAST OpenClaw Cutover Delivery Spec

**Date:** 2026-05-16
**Status:** CANONICAL — executable as the master brief for Phase 2 implementation
**Author:** Claude (research dispatch) + Santiago direction 2026-05-16
**Supersedes:** Phase 2 framing in `docs/specs/iago-os-v2-vision.md` ("VPS install alongside OpenClaw" — that framing was rejected on 2026-05-16 in favor of the FAST cutover described here)
**Standard:** Garry-impressed — every command literal, every config file exact, every rollback step time-estimated, zero "details TBD"

---

## Table of Contents

1. [systemd unit file (`/etc/systemd/system/iago-os-v2-daemon.service`)](#1-systemd-unit-file)
2. [Credential provisioning script](#2-credential-provisioning-script)
3. [Telegram bot rotation procedure](#3-telegram-bot-rotation-procedure)
4. [OpenClaw archive script](#4-openclaw-archive-script)
5. [Anthropic auth migration](#5-anthropic-auth-migration)
6. [LanceDB data decision](#6-lancedb-data-decision)
7. [WhatsApp deauth procedure](#7-whatsapp-deauth-procedure)
8. [Cutover runbook (minute-by-minute)](#8-cutover-runbook-minute-by-minute)
9. [Rollback runbook (minute-by-minute)](#9-rollback-runbook-minute-by-minute)
10. [Phase 2 PR acceptance criteria](#10-phase-2-pr-acceptance-criteria)
11. [Open questions for Santiago](#open-questions-for-santiago)
12. [References](#references)

---

## Santiago override 2026-05-16 (governs everything below)

The 2026-05-13 vision had Phase 2 = "install v2 daemon alongside OpenClaw, run in parallel, migrate one non-critical workflow." Santiago override 2026-05-16 collapses this into a FAST single-hour cutover:

- Stop `openclaw-gateway.service` (user systemd unit, not root)
- Archive `~/.openclaw/` to encrypted tarball (preserved 30 days; NOT deleted at cutover)
- Install v2 daemon as **system-level** systemd unit `iago-os-v2-daemon.service`
- Rotate Telegram bot token via BotFather inside the same hour
- Revoke WhatsApp Cloud API token + delete webhook subscription via Graph API
- Rollback = restart OpenClaw + restore old Telegram bot token (≤5 min wall clock from detection)

Phase 7 in the vision doc (OpenClaw cutover + 30-day archive) is **moved forward to land inside Phase 2**. Phases 3–6 (multi-shape adapters, dashboard) follow Phase 2 instead of preceding cutover.

The Phase 1 hello-world acceptance gate (commit `4ee40ee`) is the prerequisite for this spec. If the local hello-world end-to-end on Santiago's Windows box is not green at cutover-time, abort.

---

## 1. systemd unit file

### File path

`/etc/systemd/system/iago-os-v2-daemon.service`

### Exact unit content

```ini
# /etc/systemd/system/iago-os-v2-daemon.service
#
# iaGO-OS v2 daemon — multi-agent runtime hosting AgentRuntime adapters
# across 5 shapes (PTY/HTTP-SDK/MCP/Webhook/Daemon). Replaces OpenClaw
# (which ran as user systemd unit openclaw-gateway.service under
# user@1001.service for user ilsantino).
#
# Cutover 2026-05-16 (Santiago override): FAST single-hour cutover.
# OpenClaw stopped + archived; v2 daemon takes over Telegram control
# surface. Rollback path: stop this unit, systemctl --user start
# openclaw-gateway under ilsantino.
#
# Sandboxing: per ADR 2026-05-15 agent-shape-taxonomy § HTTP-shape
# adapter authentication. systemd LoadCredential= with strict unit
# sandboxing is the smallest blast radius under the threat model
# (single-VPS, Tailscale-only inbound, systemd-managed daemon).
#
# State root: /var/lib/iago-os/daemon-state (set via
# IAGO_DAEMON_STATE_ROOT). Logs: journald only.
#
# Credentials: loaded from /etc/credstore.encrypted/ via
# LoadCredentialEncrypted. Provisioned by
# scripts/vps-bootstrap/provision-credentials.sh.

[Unit]
Description=iaGO-OS v2 daemon — multi-agent runtime
Documentation=https://github.com/ilsantino/iago-os/blob/main/runtime/README.md
Documentation=file:///opt/iago-os/runtime/README.md
After=network-online.target tailscaled.service
Wants=network-online.target
# tailscaled is the inbound auth path for dashboard + IPC clients;
# without it Santiago cannot reach the IPC server from his phone.
Requires=tailscaled.service

[Service]
Type=exec
# Type=exec waits until the binary has been exec'd before considering
# the service started. Type=notify would require sd_notify hooks in
# the daemon code (Phase 6+ TODO when the dashboard wires Type=notify
# for fast-startup signaling). exec is the right Phase 2 default.

User=iago
Group=iago
# Dedicated unprivileged user. NOT ilsantino (which ran OpenClaw as a
# user-systemd unit). System-level unit + dedicated user gives:
#   1. Cleaner /home isolation (daemon does not read ilsantino's $HOME)
#   2. ProtectHome=true is meaningful (denies access to ALL /home dirs)
#   3. No collision with ilsantino's interactive shells / cron / PM2
# Provisioning script creates the user with --system --no-create-home
# --shell /usr/sbin/nologin. UID assigned automatically (typically <1000).

WorkingDirectory=/opt/iago-os
# /opt/iago-os/runtime/dist/daemon/main.js is the compiled entry point.
# Repo checkout lives at /opt/iago-os, owned root:iago mode 0755.
# Runtime user has read+exec on the tree; write only on state-root
# (separate path, see ReadWritePaths below).

ExecStartPre=/usr/bin/test -d /var/lib/iago-os/daemon-state
ExecStartPre=/usr/bin/test -f /opt/iago-os/runtime/dist/daemon/main.js
# Hard fail at startup if either prerequisite is missing rather than
# letting Node throw an opaque error 200ms in.

ExecStart=/usr/bin/node --experimental-specifier-resolution=node /opt/iago-os/runtime/dist/daemon/main.js

# Restart policy — survive transient crashes but DON'T mask config errors
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=120
StartLimitBurst=5
# 5 restarts in 120s and systemd gives up. This catches the
# "malformed daemon-config.json" case (which throws immediately on
# every startup attempt) instead of looping forever. When this trips,
# `systemctl status iago-os-v2-daemon.service` shows
# "start-limit-hit" and Santiago gets a clear signal via Telegram
# heartbeat absence within 10 minutes.

# Graceful shutdown — daemon's SIGTERM handler writes .daemon-stop
# markers for every live handle (runtime/daemon/main.ts lines 162-206)
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30s
# 30s gives the daemon time to: stop heartbeat, stop bot polling,
# stop IPC server, shutdown every agent (each SIGTERM → 30s wait
# → SIGKILL in adapter code per Plan 04). After 30s systemd SIGKILLs
# anything remaining. Phase 3+ may need to extend this if HTTP-shape
# adapters need longer for in-flight request draining.

# ====== Credentials (per ADR 2026-05-15) ======
LoadCredentialEncrypted=iago-telegram-token:/etc/credstore.encrypted/iago-telegram-token.cred
# Future Phase 3 additions land here:
# LoadCredentialEncrypted=iago-anthropic-default:/etc/credstore.encrypted/iago-anthropic-default.cred
# LoadCredentialEncrypted=iago-anthropic-ilsantino:/etc/credstore.encrypted/iago-anthropic-ilsantino.cred
# LoadCredentialEncrypted=iago-anthropic-iaguito:/etc/credstore.encrypted/iago-anthropic-iaguito.cred
# Phase 9 webhook secrets:
# LoadCredentialEncrypted=iago-sentry-webhook-secret:/etc/credstore.encrypted/iago-sentry-webhook-secret.cred
# LoadCredentialEncrypted=iago-github-webhook-secret:/etc/credstore.encrypted/iago-github-webhook-secret.cred

# Credentials appear inside the unit at $CREDENTIALS_DIRECTORY/<name>.
# The daemon reads them via a small bootstrap helper that runs BEFORE
# loadConfig() and sets IAGO_TELEGRAM_BOT_TOKEN from the credential
# file (see § Credential bootstrap helper below).

# ====== Sandboxing (per ADR threat model — required) ======
NoNewPrivileges=true
# Prevents the daemon (or any child process it spawns) from gaining
# capabilities via setuid/setgid binaries. Hard wall against PTY
# adapters that might inadvertently exec setuid tools.

PrivateTmp=true
# Each invocation gets a private /tmp + /var/tmp. node-pty default
# socket paths default to /tmp; isolating prevents leaking PTY socket
# names across daemon restarts or to other system users.

PrivateDevices=true
# Daemon does not need /dev access beyond standard pipe/socket. Cuts
# off /dev/mem, /dev/kmem, raw block devices, USB. Adapters that need
# a PTY get /dev/ptmx via PrivateDevices's whitelist (TIOCSPTLCK
# unaffected).

ProtectSystem=strict
# / and /usr/ mounted read-only inside the unit. Daemon CANNOT write
# anywhere except paths explicitly listed in ReadWritePaths.

ProtectHome=true
# /home, /root, /run/user invisible to the daemon. Critical for FAST
# cutover safety — the daemon never touches ilsantino's home directory
# (where OpenClaw lived). Eliminates an entire class of "v2 daemon
# corrupted my OpenClaw state" failure mode.

ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
# Defense-in-depth. Daemon does not write to /proc/sys, does not need
# to load kernel modules, does not write to cgroups.

ProtectClock=true
ProtectHostname=true
# Daemon does not adjust clock or hostname.

LockPersonality=true
# Prevents personality(2) syscalls — defends against ROP-style
# personality switches.

RestrictNamespaces=true
# Cannot create new user/pid/net/mount namespaces. Container escape
# defenses become moot if you can never create a container in the
# first place.

RestrictSUIDSGID=true
RestrictRealtime=true
# Cannot create setuid files (defense alongside NoNewPrivileges).
# Cannot acquire SCHED_RR/FIFO priority.

MemoryDenyWriteExecute=true
# W^X enforced — pages cannot be both writable and executable. JIT
# code (V8 uses W^X by default since Node 18+) still works because
# V8 mprotects between W and X phases; this just prevents anonymous
# writable+executable mappings.

SystemCallArchitectures=native
# x86_64 only. Prevents 32-bit syscall trampolines bypass.

CapabilityBoundingSet=
AmbientCapabilities=
# No capabilities. Daemon does not need CAP_NET_BIND_SERVICE (IPC
# server binds /tmp/iago-os-v2-daemon.sock, not a privileged port).

# ====== ReadWritePaths — explicit writable surfaces ======
ReadWritePaths=/var/lib/iago-os/daemon-state
ReadWritePaths=/var/log/iago-os
# State root + log dir. Everything else read-only via ProtectSystem.

# ====== Environment ======
Environment=NODE_ENV=production
Environment=IAGO_DAEMON_STATE_ROOT=/var/lib/iago-os/daemon-state
Environment=IAGO_DAEMON_IPC_SOCKET_PATH=/var/lib/iago-os/daemon-state/ipc.sock
# Override the Phase 1 default of /tmp/iago-os-v2-daemon.sock —
# with PrivateTmp=true the /tmp default would not survive across
# IPC clients on the same host. Place IPC socket under state-root
# so Santiago's CLI (run as ilsantino over Tailscale SSH) can
# reach it via group-readable ACL.
Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=__SANTIAGO_TELEGRAM_USER_ID__
# Single integer — Santiago's Telegram user ID. The provisioning
# script substitutes this from a value Santiago provides at deploy
# time. Future multi-user support (Sebas joins Phase 6) extends to
# comma-separated.

# ====== Logging ======
StandardOutput=journal
StandardError=journal
SyslogIdentifier=iago-os-v2-daemon
# journald handles rotation + compression. View with:
#   journalctl -u iago-os-v2-daemon.service -f
# Rate-limit at the journald layer (global /etc/systemd/journald.conf
# defaults: 10000 messages per 30s per service). Daemon NDJSON
# telemetry is the canonical event stream — journald is a backup +
# debugging surface.

# ====== Resource limits ======
MemoryMax=2G
# 8GB total VPS, OpenClaw archived, dashboard reserved for Phase 6.
# 2G is generous for Phase 2 single-agent hello-world; revisit when
# Phase 3 multi-shape adapters land.

TasksMax=512
# Generous ceiling — node-pty spawns child processes per agent;
# subagent semantics add more.

[Install]
WantedBy=multi-user.target
```

### Credential bootstrap helper (lands in `runtime/daemon/cred-bootstrap.ts`)

The Phase 1 config loader (`runtime/daemon/config.ts`) reads `IAGO_TELEGRAM_BOT_TOKEN` directly from `process.env`. systemd `LoadCredentialEncrypted=` exposes the decrypted credential as a file at `$CREDENTIALS_DIRECTORY/iago-telegram-token`, not as an env var. A small bootstrap step bridges the two:

```ts
// runtime/daemon/cred-bootstrap.ts
// Runs BEFORE loadConfig() — invoked from main.ts startDaemon().
// Reads systemd-provided credential files from $CREDENTIALS_DIRECTORY
// and exports them into process.env so the rest of the daemon
// (which already understands env vars per Plan 07) sees them.

import * as fs from "node:fs";
import * as path from "node:path";

interface CredMap {
  readonly fileName: string;
  readonly envVar: string;
}

const CREDENTIALS: CredMap[] = [
  { fileName: "iago-telegram-token", envVar: "IAGO_TELEGRAM_BOT_TOKEN" },
  // Phase 3 additions:
  // { fileName: "iago-anthropic-default", envVar: "IAGO_ANTHROPIC_DEFAULT_TOKEN" },
  // { fileName: "iago-anthropic-ilsantino", envVar: "IAGO_ANTHROPIC_ILSANTINO_TOKEN" },
  // { fileName: "iago-anthropic-iaguito", envVar: "IAGO_ANTHROPIC_IAGUITO_TOKEN" },
];

export function loadSystemdCredentials(): void {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  if (dir === undefined || dir.length === 0) {
    // Not running under systemd LoadCredential — local dev path.
    // Caller falls back to env vars / file config per Plan 07 loader.
    return;
  }
  for (const { fileName, envVar } of CREDENTIALS) {
    const credPath = path.join(dir, fileName);
    if (!fs.existsSync(credPath)) continue;
    const value = fs.readFileSync(credPath, "utf8").trim();
    if (value.length === 0) continue;
    if (process.env[envVar] !== undefined && process.env[envVar]!.length > 0) {
      // Explicit env var beats credential — local override path.
      continue;
    }
    process.env[envVar] = value;
  }
}
```

`main.ts` calls `loadSystemdCredentials()` before `loadConfig()`. Local dev path (no `$CREDENTIALS_DIRECTORY`) is a no-op. Tests bypass via direct env var injection.

### `User=` choice — verdict

**Verdict: dedicated `iago` system user.** Reasoning:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `User=ilsantino` (current OpenClaw user) | Zero new user provisioning; existing SSH access | `ProtectHome=true` becomes useless (daemon would need /home/ilsantino access); daemon can read ilsantino's interactive-session data; daemon's state under /home/ilsantino is mixed with ilsantino's personal files | REJECT — fights ProtectHome= and leaks blast radius |
| `User=root` | No permission gymnastics | Daemon never needs root; violates least privilege; one Node CVE = root compromise | REJECT — Garry standard fails on day one |
| `User=iago` (new system user) | Clean isolation, `ProtectHome=true` meaningful, future multi-tenant cleanup trivial | One-time provisioning (5 lines in bootstrap script) | **ACCEPT** |

Provisioning command (lands in bootstrap script):
```bash
useradd --system --no-create-home --shell /usr/sbin/nologin --comment "iaGO-OS v2 daemon" iago
```

### Verification

After unit install:

```bash
sudo systemctl daemon-reload
sudo systemctl enable iago-os-v2-daemon.service
sudo systemd-analyze verify iago-os-v2-daemon.service
# expected: no output (any output = config error)
sudo systemd-analyze security iago-os-v2-daemon.service
# expected: exposure level ≤2.0 ("MEDIUM" or better) with all the
# above sandboxing flags applied. OpenClaw-style user units typically
# score 9.6 ("UNSAFE"); v2 daemon should be in low 2s.
```

---

## 2. Credential provisioning script

### File path

`scripts/vps-bootstrap/provision-credentials.sh`

Runs on Santiago's Windows box (under Git Bash or WSL) and pushes credentials to the VPS via Tailscale SSH. Reads from 1Password CLI; never persists plaintext on disk locally.

### Exact script content

```bash
#!/usr/bin/env bash
# scripts/vps-bootstrap/provision-credentials.sh
#
# Provisions encrypted credentials for iago-os-v2-daemon.service on
# the Hostinger VPS via Tailscale SSH.
#
# Per ADR 2026-05-15 § HTTP-shape adapter authentication:
#   - 1Password CLI is the provisioning input (this script)
#   - systemd LoadCredentialEncrypted= is the runtime path
#   - 1Password CLI NEVER runs on the VPS
#   - Plaintext token NEVER touches local disk (uses stdin pipe)
#
# Idempotent — safe to re-run for rotation. The systemd-creds encrypt
# step produces a fresh ciphertext on each run (encryption uses random
# nonce); the daemon picks up the new credential on next restart.
#
# Usage:
#   bash scripts/vps-bootstrap/provision-credentials.sh telegram-token
#   bash scripts/vps-bootstrap/provision-credentials.sh anthropic-default
#   bash scripts/vps-bootstrap/provision-credentials.sh all
#
# Prerequisites:
#   - 1Password CLI installed locally + signed in (`op signin`)
#   - Tailscale CLI installed locally + Hostinger VPS reachable
#   - root SSH on the VPS via Tailscale (current state per Phase 0 audit)
#   - 1Password vault item names per the table below

set -euo pipefail

VPS_HOST="${VPS_HOST:-srv1456441}"   # Tailscale node name
VPS_USER="${VPS_USER:-root}"
CREDSTORE="/etc/credstore.encrypted"
UNIT_NAME="iago-os-v2-daemon.service"

# Credential map — local 1Password reference → remote credential file name
declare -A CRED_MAP=(
  [telegram-token]="op://iago-os/v2-daemon-telegram-bot/token::iago-telegram-token"
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
  $0 telegram-token anthropic-default
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

  # 1Password → systemd-creds encrypt → /etc/credstore.encrypted/
  # The plaintext NEVER lands on local or remote disk.
  # `op read` pipes to local stdout → ssh stdin → remote systemd-creds.
  #
  # systemd-creds encrypt:
  #   --name=<cred_name> binds the name into the ciphertext (prevents
  #     swapping ciphertexts across credentials with different names)
  #   reads plaintext from stdin (-)
  #   writes ciphertext to stdout (-)
  #
  # Then dd over SSH writes ciphertext atomically to a tmp file +
  # mv to final path. Mode 0600 root:root.

  op read "$op_ref" \
    | tailscale ssh "${VPS_USER}@${VPS_HOST}" -- "
        set -e
        tmpfile=\$(mktemp '${CREDSTORE}/.${cred_name}.XXXXXX.cred')
        chmod 0600 \"\$tmpfile\"
        systemd-creds encrypt --name='${cred_name}' - \"\$tmpfile\"
        mv \"\$tmpfile\" '${CREDSTORE}/${cred_name}.cred'
        chown root:root '${CREDSTORE}/${cred_name}.cred'
        chmod 0600 '${CREDSTORE}/${cred_name}.cred'
      "

  # Verify: decrypt round-trip and confirm length matches what op gave
  remote_len=$(tailscale ssh "${VPS_USER}@${VPS_HOST}" -- \
    "systemd-creds decrypt '${CREDSTORE}/${cred_name}.cred' - | wc -c | tr -d ' \n'")
  local_len=$(op read "$op_ref" | wc -c | tr -d ' \n')

  if [[ "$remote_len" != "$local_len" ]]; then
    echo "ERROR: round-trip length mismatch for ${cred_name} (local=$local_len remote=$remote_len)" >&2
    exit 1
  fi

  echo "  ✓ ${cred_name} provisioned (len=${remote_len})"
done

# Reload the unit so it picks up new credentials on next restart.
# Does NOT restart the daemon — Santiago triggers that explicitly via
# the cutover runbook so credential rotation is observable, not silent.
tailscale ssh "${VPS_USER}@${VPS_HOST}" -- "systemctl daemon-reload"

echo ""
echo "Provisioning complete. To activate:"
echo "  tailscale ssh ${VPS_USER}@${VPS_HOST} -- systemctl restart ${UNIT_NAME}"
echo "  tailscale ssh ${VPS_USER}@${VPS_HOST} -- systemctl status ${UNIT_NAME}"
```

### Verification step

After running the script, validate the credential decrypts cleanly **without** running the daemon:

```bash
tailscale ssh root@srv1456441 -- 'systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | head -c 10 ; echo'
# expected: first 10 chars of the bot token + newline
# bot tokens look like "1234567890:ABC..." — first 10 chars include the bot ID
```

### Idempotency note

Re-running the script for the same key produces a fresh ciphertext (random nonce per `systemd-creds encrypt` invocation) but the same plaintext. After re-provisioning, restart the daemon for the new credential to be re-read. The old ciphertext is overwritten via `mv`; no leftover files.

### 1Password vault structure (Santiago creates these once)

| Vault item | Field | Used for |
|---|---|---|
| `v2-daemon-telegram-bot` | `token` | Active Telegram bot token (rotated per § 3) |
| `v2-anthropic-default` | `token` | Anthropic API key — default profile |
| `v2-anthropic-ilsantino` | `token` | Anthropic API key — ilsantino_anthropic_sutoken |
| `v2-anthropic-iaguito` | `token` | Anthropic API key — iaguito_anthropic_sutoken |

All in vault `iago-os`. Reasoning: collocates Phase 2 + Phase 3 credentials in one vault; simpler permission model than per-credential vaults.

---

## 3. Telegram bot rotation procedure

### Verdict — Option A: revoke + reissue same bot via BotFather

**Verdict: rotate the existing bot token via BotFather's `/revoke` flow inside the same hour.** Reasoning:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Same bot, rotate token via BotFather** | Same `@bot_handle` (zero Santiago-side reconfiguration); same chat IDs (no allowed-user-ID migration); BotFather revocation is atomic (old token dies instantly when new is issued) | Requires interactive BotFather session at cutover-time (no scripted rotation API) | **ACCEPT** |
| B. New bot, new handle | Clean break; old bot remains for sentimental rollback test | Santiago must re-`/start` the new bot on phone; allowed-user-ID rebuild; chat ID changes invalidate any saved approval chat references; rollback requires reverting Santiago's phone session too | REJECT — friction for zero benefit |
| C. Keep same token (no rotation) | Zero work | OpenClaw process retained the token for 30 days while archive sits; if archive leaks, token leaks | REJECT — security carry-over violates Garry standard |

The new token gets provisioned via `provision-credentials.sh telegram-token` (§ 2). The atomic moment: at BotFather's "Revoke current token" tap, the old token dies; the new token is shown immediately. Santiago copies it into the 1Password vault item `v2-daemon-telegram-bot::token`, then runs `provision-credentials.sh telegram-token`. Total wall clock: ~3 minutes.

### Allowed user IDs

Single integer (Santiago's Telegram user ID, **NOT** chat ID). Stored in the systemd unit `Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=__SANTIAGO_USER_ID__`.

Santiago obtains his user ID by messaging `@userinfobot` on Telegram (or any equivalent bot). Result is a 10-digit integer. Same number was likely already used by OpenClaw's `channels.telegram.allowFrom` — confirm via OpenClaw config inspection during pre-flight if needed.

Future multi-user (Sebas Phase 6): comma-separated:
```
Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=1234567890,9876543210
```

Phase 1 config loader (`runtime/daemon/config.ts` lines 95-103) already parses comma-separated decimal integers via `parseAllowedUserIds`.

### Rotation procedure (atomic)

```
T-0:00  Open Telegram, message @BotFather
T+0:30  Send: /mybots
T+0:40  Tap the bot's @handle (the one OpenClaw uses today)
T+0:50  Tap: API Token
T+1:00  Tap: Revoke current token
T+1:10  BotFather confirms; new token appears in chat
T+1:20  Copy new token to clipboard
T+1:30  In 1Password app: edit item v2-daemon-telegram-bot, paste new token into `token` field, save
T+2:00  In Git Bash on Windows:
          bash scripts/vps-bootstrap/provision-credentials.sh telegram-token
T+2:30  Verify credential round-trip succeeds
T+3:00  ← bot token rotation complete; OpenClaw bot polling now fails with 401
        (its token is dead — confirms revocation propagated)
```

The 401-on-OpenClaw signal is intentional — it's the test that the new token is genuinely a new token and not BotFather displaying the cached old one.

### Pre-cutover test plan (run BEFORE stopping OpenClaw)

CANNOT test the new bot token against the v2 daemon while OpenClaw is still polling — Telegram allows only one polling client per bot token. Test path:

1. Create a **throwaway test bot** with BotFather (1 minute): `/newbot`, name it `iago-os-v2-test-bot`, copy the test token
2. Run the v2 daemon locally on Santiago's Windows box with the test bot token (Phase 1 hello-world setup)
3. Confirm `/agents`, `/status <agent>`, and approval flow work via Telegram on phone
4. Stop the local daemon; delete the test bot via BotFather `/deletebot`
5. ONLY THEN proceed with the production bot token revocation at cutover-time

The test bot proves the v2 daemon's Telegram routing works; the production bot rotation is the actual cutover step.

---

## 4. OpenClaw archive script

### File path

`scripts/vps-bootstrap/archive-openclaw.sh`

Runs on the VPS (invoked via Tailscale SSH from Santiago's Windows box). Encrypts with `age` to Santiago's pubkey — Santiago has age installed and a keypair from the existing MUNET deployment workflows.

### Exact script content

```bash
#!/usr/bin/env bash
# scripts/vps-bootstrap/archive-openclaw.sh
#
# Run ON THE VPS as root (script su's to ilsantino for the user
# systemd commands). Stops OpenClaw, archives ~/.openclaw/ to an
# age-encrypted tarball under /var/lib/iago-os/openclaw-archive/,
# records manifest, schedules 30-day deletion.
#
# Idempotent: detects if OpenClaw already stopped + already archived
# and exits 0 with a status message.
#
# Encryption: age with Santiago's public key. Santiago's pubkey must
# be in /etc/iago-os/santiago-age.pub before running. If absent,
# script HARD FAILS rather than producing an unencrypted archive
# (Garry standard — credentials inside tarball).
#
# Retention: a systemd timer (separate file, also in this directory)
# deletes archives older than 30 days. NOT a cron job — the VPS has
# no crontab installed per Phase 0 audit; using a systemd timer keeps
# the dependency surface uniform with the daemon's substrate.

set -euo pipefail

OPENCLAW_USER="ilsantino"
OPENCLAW_HOME="/home/ilsantino"
OPENCLAW_DIR="${OPENCLAW_HOME}/.openclaw"
ARCHIVE_ROOT="/var/lib/iago-os/openclaw-archive"
MANIFEST="${ARCHIVE_ROOT}/MANIFEST.md"
PUBKEY="/etc/iago-os/santiago-age.pub"
SERVICE="openclaw-gateway.service"

# Must run as root (we su to ilsantino for systemctl --user)
if [[ "$(id -u)" != "0" ]]; then
  echo "ERROR: must run as root (need to su to ${OPENCLAW_USER} for systemctl --user)" >&2
  exit 1
fi

# Pre-flight: confirm age installed
if ! command -v age > /dev/null 2>&1; then
  echo "ERROR: 'age' not installed. apt install age" >&2
  exit 1
fi

# Pre-flight: confirm pubkey exists
if [[ ! -f "$PUBKEY" ]]; then
  echo "ERROR: Santiago's age pubkey not at $PUBKEY" >&2
  echo "Provision via: scp <local-path-to-pubkey> root@srv1456441:${PUBKEY}" >&2
  exit 1
fi

# Pre-flight: confirm OpenClaw is actually present
if [[ ! -d "$OPENCLAW_DIR" ]]; then
  echo "STATUS: ${OPENCLAW_DIR} does not exist — nothing to archive."
  echo "If this is a re-run after archive, check ${ARCHIVE_ROOT} for tarballs."
  exit 0
fi

# Ensure archive root exists with correct perms
mkdir -p "$ARCHIVE_ROOT"
chmod 0700 "$ARCHIVE_ROOT"
chown root:root "$ARCHIVE_ROOT"

# Step 1 — stop and disable openclaw-gateway.service (user systemd unit)
# Per Phase 0 audit: OpenClaw runs as user systemd unit under
# user@1001.service, NOT a system unit. Must invoke via su to ilsantino.
echo "[1/6] Stopping ${SERVICE} via user systemd..."
if su - "${OPENCLAW_USER}" -c "systemctl --user is-active ${SERVICE}" > /dev/null 2>&1; then
  su - "${OPENCLAW_USER}" -c "systemctl --user stop ${SERVICE}"
  echo "       stopped."
else
  echo "       was already stopped (idempotent path)."
fi

echo "[2/6] Disabling ${SERVICE} so it does NOT auto-start on reboot..."
if su - "${OPENCLAW_USER}" -c "systemctl --user is-enabled ${SERVICE}" > /dev/null 2>&1; then
  su - "${OPENCLAW_USER}" -c "systemctl --user disable ${SERVICE}"
  echo "       disabled."
else
  echo "       was already disabled (idempotent path)."
fi

# Belt-and-braces: confirm no openclaw-gateway process remains
if pgrep -u "${OPENCLAW_USER}" -f 'openclaw-gateway' > /dev/null; then
  echo "ERROR: openclaw-gateway process still running after stop. Investigate:" >&2
  pgrep -u "${OPENCLAW_USER}" -fa 'openclaw-gateway' >&2
  exit 1
fi

# Step 3 — create the archive
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
TARBALL_NAME="openclaw-pre-cutover-${TIMESTAMP}.tar.gz"
TARBALL_PATH="${ARCHIVE_ROOT}/${TARBALL_NAME}"
ENCRYPTED_PATH="${TARBALL_PATH}.age"

echo "[3/6] Creating tarball ${TARBALL_NAME}..."
# Tar from / so paths inside tarball are absolute, easing restore.
# --warning=no-file-changed: OpenClaw may have written files in its
# last microseconds before stop; we don't care about file-changed
# warnings on this one-shot archive.
tar -czf "$TARBALL_PATH" \
  --warning=no-file-changed \
  -C / \
  "home/${OPENCLAW_USER}/.openclaw"

# Capture size + sha256 BEFORE encryption (so manifest records raw
# tarball hash for forensic comparison)
RAW_SIZE=$(stat -c %s "$TARBALL_PATH")
RAW_SHA=$(sha256sum "$TARBALL_PATH" | cut -d' ' -f1)

# Step 4 — encrypt with age
echo "[4/6] Encrypting with age (pubkey: $(basename "$PUBKEY"))..."
age -R "$PUBKEY" -o "$ENCRYPTED_PATH" "$TARBALL_PATH"
ENC_SIZE=$(stat -c %s "$ENCRYPTED_PATH")
ENC_SHA=$(sha256sum "$ENCRYPTED_PATH" | cut -d' ' -f1)

# Wipe raw tarball — credentials inside, must not persist unencrypted
shred -u "$TARBALL_PATH"

chmod 0600 "$ENCRYPTED_PATH"
chown root:root "$ENCRYPTED_PATH"

# Step 5 — append manifest
echo "[5/6] Recording manifest..."
mkdir -p "$(dirname "$MANIFEST")"
if [[ ! -f "$MANIFEST" ]]; then
  cat > "$MANIFEST" <<'EOF'
# OpenClaw Archive Manifest

Archives created by `scripts/vps-bootstrap/archive-openclaw.sh`.
Encrypted to Santiago's age pubkey at /etc/iago-os/santiago-age.pub.
Retention: 30 days from creation. Deletion by
`scripts/vps-bootstrap/archive-prune.timer` (systemd timer).

To decrypt on Santiago's local machine:
    scp root@srv1456441:/var/lib/iago-os/openclaw-archive/<file>.age .
    age -d -i ~/.age/santiago.key -o <file> <file>.age
    tar -xzf <file>

| Timestamp (UTC) | File | Raw size | Raw SHA256 | Encrypted size | Encrypted SHA256 |
|---|---|---|---|---|---|
EOF
fi

printf '| %s | %s | %s | %s | %s | %s |\n' \
  "$TIMESTAMP" \
  "$(basename "$ENCRYPTED_PATH")" \
  "$RAW_SIZE" \
  "$RAW_SHA" \
  "$ENC_SIZE" \
  "$ENC_SHA" \
  >> "$MANIFEST"

# Step 6 — install retention timer if absent
echo "[6/6] Confirming retention timer is installed..."
TIMER_UNIT="/etc/systemd/system/iago-archive-prune.timer"
SERVICE_UNIT="/etc/systemd/system/iago-archive-prune.service"

if [[ ! -f "$TIMER_UNIT" ]]; then
  cat > "$SERVICE_UNIT" <<EOF
[Unit]
Description=Prune iago-os archives older than 30 days

[Service]
Type=oneshot
ExecStart=/usr/bin/find ${ARCHIVE_ROOT} -name '*.age' -mtime +30 -delete
EOF
  cat > "$TIMER_UNIT" <<EOF
[Unit]
Description=Daily prune of iago-os archives

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now iago-archive-prune.timer
  echo "       retention timer installed + active."
else
  echo "       retention timer already installed."
fi

# Final summary
echo ""
echo "========================================"
echo " OpenClaw archive complete"
echo "========================================"
echo " File: ${ENCRYPTED_PATH}"
echo " Encrypted size: ${ENC_SIZE} bytes"
echo " SHA256: ${ENC_SHA}"
echo " Retention: 30 days"
echo " Manifest: ${MANIFEST}"
echo "========================================"
```

### Encryption rationale

OpenClaw's `~/.openclaw/credentials/` contains 12 MiB of provider credentials (Anthropic, Telegram, WhatsApp, web search API key, OAuth refresh tokens for any connected MCPs). Even with 0700 directory mode, an unencrypted tarball sitting on the VPS for 30 days violates the Garry standard — if root is ever compromised in that window, every cred in the archive leaks.

age-encrypted tarball means: decryption requires Santiago's age **private key**, which lives only on his Windows box (and a paper backup). VPS root compromise during the 30-day window cannot decrypt the archive.

### Retention timer rationale

systemd timer over cron because:
1. VPS has no crontab installed per Phase 0 audit
2. Timer integrates with journald (audit trail of every prune run)
3. `Persistent=true` runs the prune at boot if the daemon was down at the scheduled time
4. Lives in the same `systemctl` workflow Santiago already uses for the daemon itself

### Verification

After running:
```bash
ls -la /var/lib/iago-os/openclaw-archive/
cat /var/lib/iago-os/openclaw-archive/MANIFEST.md
systemctl list-timers iago-archive-prune.timer
```

Decryption test (on Santiago's local Windows box, AFTER cutover, BEFORE the 30 days expire):
```bash
scp root@srv1456441:/var/lib/iago-os/openclaw-archive/openclaw-pre-cutover-*.tar.gz.age .
age -d -i ~/.age/santiago.key -o test.tar.gz openclaw-pre-cutover-*.tar.gz.age
tar -tzf test.tar.gz | head -20
# expected: home/ilsantino/.openclaw/openclaw.json, .../credentials/, etc.
rm test.tar.gz   # do not keep plaintext locally
```

---

## 5. Anthropic auth migration

### Source of truth — OpenClaw config

Per Phase 0 audit, OpenClaw stores 3 Anthropic profiles in `~/.openclaw/openclaw.json` under `auth.profiles`:

| Profile name | Mode |
|---|---|
| `default` | token |
| `ilsantino_anthropic_sutoken` | token |
| `iaguito_anthropic_sutoken` | token |

Tokens themselves live in `~/.openclaw/credentials/` (12 MiB state dir, 0700 mode, NOT inspected per audit redaction policy). Each profile maps to one Anthropic API key.

### Where they land in v2

**Verdict: per-agent config field `authProfile` selects which Anthropic key the adapter uses; the daemon resolves `authProfile` → env var via the systemd-creds bootstrap helper.**

Schema additions to `AgentConfig` in `runtime/daemon/config.ts`:

```ts
export interface AgentConfig {
  readonly agentId: string;
  readonly runtimeId: string;
  readonly org?: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly autoStart: boolean;
  readonly authProfile?: "default" | "ilsantino" | "iaguito";  // ← NEW Phase 2
}
```

Adapter resolves the env var name at spawn time:

```ts
function resolveAnthropicTokenEnv(profile?: string): string {
  switch (profile) {
    case undefined:
    case "default":
      return "IAGO_ANTHROPIC_DEFAULT_TOKEN";
    case "ilsantino":
      return "IAGO_ANTHROPIC_ILSANTINO_TOKEN";
    case "iaguito":
      return "IAGO_ANTHROPIC_IAGUITO_TOKEN";
    default:
      throw new RangeError(`unknown authProfile: ${profile}`);
  }
}
```

The adapter (Phase 1 Shape 1 PTY adapter `runtime/agent-runtime/pty/claude-pty.ts`, Phase 3 Shape 2 `anthropic-sdk.ts`) reads the resolved env var at spawn time and passes it as `ANTHROPIC_API_KEY` to the spawned process. **Adapter changes are Phase 3 work**, not Phase 2 — Phase 2 only provisions the credentials and adds the schema field. Phase 1 claude-pty currently passes through `env` as-is, which is sufficient for the hello-world acceptance gate (single default profile).

### Migration commands

```bash
# On Santiago's Windows box (Git Bash) — extract tokens from OpenClaw archive
# AFTER cutover (the archive is the canonical source post-cutover):

# 1. Decrypt the archive
age -d -i ~/.age/santiago.key -o openclaw.tar.gz openclaw-pre-cutover-*.tar.gz.age
mkdir -p /tmp/openclaw-extract
tar -xzf openclaw.tar.gz -C /tmp/openclaw-extract
cd /tmp/openclaw-extract/home/ilsantino/.openclaw/

# 2. Inspect credentials/ to find the three Anthropic token files
ls credentials/
# (file names depend on OpenClaw's internal layout — open openclaw.json
# auth.profiles[].credentialRef to map profile name → cred file name)

# 3. For each profile, pipe the plaintext token into 1Password CLI
# (REPLACES the value in the vault item; assumes vault items pre-exist
# per § 2 vault structure table)
cat credentials/default.token | op item edit "v2-anthropic-default" --vault iago-os "token[concealed]=$(cat -)"
cat credentials/ilsantino_anthropic_sutoken.token | op item edit "v2-anthropic-ilsantino" --vault iago-os "token[concealed]=$(cat -)"
cat credentials/iaguito_anthropic_sutoken.token | op item edit "v2-anthropic-iaguito" --vault iago-os "token[concealed]=$(cat -)"

# 4. Push to VPS via the credential provisioning script
bash scripts/vps-bootstrap/provision-credentials.sh anthropic-default anthropic-ilsantino anthropic-iaguito

# 5. Wipe plaintext extract
shred -u openclaw.tar.gz
rm -rf /tmp/openclaw-extract
```

### Per-profile post-migration test

After Phase 3 adapter work lands and authProfile field is wired, each profile is tested individually:

```bash
# Test default profile (Phase 2 — only profile in scope)
tailscale ssh root@srv1456441 -- '
  curl -sS https://api.anthropic.com/v1/messages \
    -H "x-api-key: $(systemd-creds decrypt /etc/credstore.encrypted/iago-anthropic-default.cred -)" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "{\"model\":\"claude-3-5-haiku-20241022\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}]}" \
    | head -200
'
# expected: JSON response with content[0].text — confirms key is valid
# 401 response = revoked/wrong key
```

For Phase 2 cutover scope, only `default` matters — the hello-world agent uses the default profile. ilsantino + iaguito migration is **provisioned at Phase 2** (credentials land on the VPS) but **activated at Phase 3** (when multi-profile agents start being registered).

---

## 6. LanceDB data decision

### Current state

Per Phase 0 audit, OpenClaw runs `plugins.entries.memory-lancedb.enabled=true` with data at `~/.openclaw/memory/` (72 KiB — small, audit-relevant detail: only 72 KiB, not gigabytes of vector embeddings). Stored content: unknown without inspection, but the small size suggests the LanceDB plugin captured few facts in the months OpenClaw was active.

Cross-reference: `memory:project_mempalace` confirms iaGO has MemPalace as the canonical conversation memory store — full stack ChromaDB + KG + diary + wings per client. MemPalace runs locally on Santiago's Windows box (and mines `~/.claude/projects/`), not on the VPS.

### Verdict — Option (b): drop LanceDB, commit to MemPalace canonical

**Reasoning:**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Move data dir to `runtime/memory/lancedb/` at cutover | Preserves continuity; OpenClaw's 72 KiB of facts not lost | LanceDB plugin adapter must land in v2 Phase 2 (out of scope per master prompt — adapters are Phase 3); creates a memory layer that competes with canonical MemPalace; carries forward Santiago's stated discomfort with "having a daemon and a memory store and a vector DB and..." complexity creep | REJECT |
| **(b) Drop LanceDB, commit to MemPalace canonical** | Single canonical memory layer (`memory:project_mempalace` already says this); ZERO v2 adapter work for memory in Phase 2; v2 daemon can call MemPalace MCP from Santiago's local box via Tailscale when memory recall is needed; the 72 KiB OpenClaw LanceDB content survives in the encrypted archive for 30 days if Santiago ever needs to extract a specific fact | LanceDB content needs explicit fact-extraction-to-MemPalace migration if any facts are load-bearing — but at 72 KiB this is one afternoon of work, not a Phase | **ACCEPT** |
| (c) Defer — keep LanceDB reading from old path during Phase 2, decide canonical store in Phase 6 | Lowest immediate change | Forces Phase 2 to wire a LanceDB adapter (out of scope); two memory systems coexist for 6+ weeks burning Santiago's cognitive load on a decision that's already made (MemPalace is canonical per memory) | REJECT |

**Action at cutover:** the 72 KiB of LanceDB data is preserved inside the encrypted OpenClaw archive (§ 4). No active migration. If Santiago wants to extract facts from it later, he decrypts the archive (`age -d`), inspects `~/.openclaw/memory/`, and either re-stores into MemPalace by hand or writes a small extraction script — but this is **post-Phase 2 housekeeping**, not a cutover blocker.

**Phase 2 PR contains:** a section in `runtime/migration/02-cutover-decisions.md` documenting this verdict + the 72 KiB fact about archive contents, so when Santiago looks at this in 3 months he doesn't have to re-litigate.

---

## 7. WhatsApp deauth procedure

### Decision context

Santiago decision 2026-05-13: WhatsApp dropped at cutover. v2 daemon is Telegram-only. OpenClaw's WhatsApp polling stops at archive-script step 1; the WhatsApp Cloud API token + webhook subscription must be revoked at Meta's side too, otherwise:
- Meta retries the webhook indefinitely against a dead OpenClaw HTTP endpoint
- The long-lived access token remains valid → if leaked, attacker can send messages from Santiago's business phone number

### Procedure (order matters)

Step ordering rationale: stop OpenClaw FIRST so it cannot mid-revoke send a message and confuse downstream state. THEN revoke API token. THEN delete webhook subscription. THEN verify with a probe call.

```bash
# Step 1 — STOP OpenClaw (done by archive-openclaw.sh § 4 step 1)
# The archive script kills openclaw-gateway.service which kills WhatsApp polling.

# Step 2 — Identify the values you need
# These come from Meta Business Manager / App Dashboard:
#   - PHONE_NUMBER_ID   (the Cloud API phone number id, ~15 digits)
#   - WABA_ID           (the WhatsApp Business Account id, ~15 digits)
#   - APP_ID            (the Meta app id, ~15 digits)
#   - SYSTEM_USER_TOKEN (the long-lived access token to revoke)
#
# Find them in Meta Business Suite > Business Settings > Accounts >
# WhatsApp Accounts (gives WABA_ID + PHONE_NUMBER_ID) and
# Apps > <App> > Settings > Basic (gives APP_ID).

# Step 3 — DELETE webhook subscription for the WABA
# Removes the subscribed_apps binding so Meta stops POSTing to the
# OpenClaw webhook URL.
curl -X DELETE \
  "https://graph.facebook.com/v21.0/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"
# expected response: {"success": true}

# Step 4 — VERIFY subscription deletion
# Subscribed apps list should now be empty (or not contain your app)
curl -X GET \
  "https://graph.facebook.com/v21.0/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"
# expected response: {"data": []} or {"data": [...other apps you keep...]}

# Step 5 — REVOKE the system user access token
# Two options; do both for defense in depth:

# 5a. App-side revocation — invalidates THIS specific access token
curl -X DELETE \
  "https://graph.facebook.com/v21.0/me/permissions" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"
# expected: {"success": true}

# 5b. App Dashboard manual step — also disable the system user in
# Meta Business Manager > Business Settings > Users > System Users.
# Click on the system user OpenClaw used → "Remove" or disable token.
# This step is manual; document the click path in the PR.

# Step 6 — VERIFY token is dead
curl "https://graph.facebook.com/v21.0/debug_token?input_token=${SYSTEM_USER_TOKEN}&access_token=${APP_ID}|${APP_SECRET}" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"
# expected: response shows is_valid: false
# OR direct probe with the token itself:
curl "https://graph.facebook.com/v21.0/me" -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"
# expected: 400 or 401 error — token rejected

# Step 7 — VERIFY no inbound webhooks arriving
# Send a WhatsApp test message from a different phone to the Cloud API
# phone number. With the webhook unsubscribed:
#   - Message arrives at Meta's side (visible in Meta Business Suite)
#   - NO POST hits OpenClaw's webhook (OpenClaw is stopped, but
#     if rolled back the daemon should also see nothing)
# Confirm via:
#   - Meta Business Suite > WhatsApp Manager > shows the test message
#   - tail -f the would-be webhook URL access log on the VPS — silent
```

### Why webhook deletion uses Graph API not Meta UI

Meta's App Dashboard webhook UI requires re-running the URL verification handshake (`hub.challenge` round-trip) to add or remove subscriptions. If OpenClaw is already stopped, the verification will fail and you'll get stuck. The Graph API `DELETE /<WABA_ID>/subscribed_apps` doesn't require URL verification because it's removing, not adding.

### Phase 2 deliverable

This procedure lives in `runtime/migration/02-whatsapp-deauth.md` as a runbook Santiago executes manually at cutover-time T+30 (after Telegram is confirmed working on v2 daemon). It's NOT scripted because: (a) the credentials needed to run it are Meta-side only (not in 1Password), and (b) running it is a one-time operation, not idempotent automation.

---

## 8. Cutover runbook (minute-by-minute)

### Pre-cutover gate (cannot cut over if any of these fail)

- [ ] Phase 1 hello-world acceptance gate green on Santiago's local box (commit `4ee40ee`)
- [ ] v2 daemon code deployed to VPS at `/opt/iago-os` (git clone + `npm install` + `npm run build` inside `runtime/`)
- [ ] systemd unit file installed at `/etc/systemd/system/iago-os-v2-daemon.service` (§ 1)
- [ ] `iago` user provisioned on VPS via `useradd --system`
- [ ] `/var/lib/iago-os/daemon-state` created, owned `iago:iago`, mode 0700
- [ ] `/var/log/iago-os` created, owned `iago:iago`, mode 0750
- [ ] `/etc/credstore.encrypted/` exists, owned `root:root`, mode 0700
- [ ] `/etc/iago-os/santiago-age.pub` deployed
- [ ] Throwaway test bot validated against v2 daemon locally (§ 3 pre-cutover test)
- [ ] OpenClaw archive script dry-run executed (read-only check: confirms it can su to ilsantino, can write to /var/lib/iago-os, age binary present)
- [ ] 1Password CLI signed in on Santiago's Windows box
- [ ] WhatsApp APP_ID, WABA_ID, PHONE_NUMBER_ID, SYSTEM_USER_TOKEN noted down

If ANY pre-flight item is unchecked, ABORT and resolve before scheduling cutover window.

### Cutover sequence

```
T-15:00  Santiago at keyboard. Tailscale up (verify: `tailscale status`
         shows srv1456441 online). VPS reachable
         (`tailscale ssh root@srv1456441 -- date` returns).
         All pre-flight items checked.

T-10:00  Open three terminal windows:
           (a) Git Bash on Santiago's Windows box (for provisioning)
           (b) Tailscale SSH to root@srv1456441 (for archive + systemctl)
           (c) Telegram on phone (for handshake verification)
         Also open: Meta Business Suite in browser, 1Password app.

T-05:00  Send goodbye message via OpenClaw bot (use the existing bot
         that's about to be revoked):
           (in Telegram) "/start" or just send "v2 cutover starting"
         Confirm OpenClaw responds — proves baseline path works
         BEFORE we touch anything.

T-00:00  CUTOVER START.

T+00:00  Terminal (b): run archive-openclaw.sh
           tailscale ssh root@srv1456441 -- 'bash /opt/iago-os/scripts/vps-bootstrap/archive-openclaw.sh'
         Expected output: 6 numbered steps, ends with "OpenClaw
         archive complete" + the tarball path + SHA256.
         Verification:
           tailscale ssh root@srv1456441 -- 'su - ilsantino -c "systemctl --user is-active openclaw-gateway"'
         Expected: "inactive"
         ROLLBACK TRIGGER: if archive script fails mid-flight,
         restart OpenClaw and abort:
           tailscale ssh root@srv1456441 -- 'su - ilsantino -c "systemctl --user start openclaw-gateway"'

T+02:00  Telegram rotation (per § 3 procedure):
           - Open @BotFather in Telegram
           - /mybots → select bot → API Token → Revoke current token
           - Copy new token
           - 1Password app: edit v2-daemon-telegram-bot, paste, save
         Verification: send any message to the OLD bot. Expected: no
         response (because we revoked — old token is dead).

T+05:00  Terminal (a): provision the new Telegram credential
           bash scripts/vps-bootstrap/provision-credentials.sh telegram-token
         Expected output: "  ✓ iago-telegram-token provisioned (len=NN)"
         then "Provisioning complete."
         Verification:
           tailscale ssh root@srv1456441 -- 'systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | head -c 10 ; echo'
         Expected: first 10 chars of new bot token.

T+07:00  Terminal (b): start the v2 daemon
           tailscale ssh root@srv1456441 -- 'systemctl daemon-reload && systemctl enable --now iago-os-v2-daemon.service'
         Verification:
           tailscale ssh root@srv1456441 -- 'systemctl status iago-os-v2-daemon.service'
         Expected: "active (running)", PID present, no error in last 5 lines.

T+08:00  Verify daemon is listening
           tailscale ssh root@srv1456441 -- 'journalctl -u iago-os-v2-daemon.service --since "2 minutes ago" | tail -30'
         Expected: log lines from runtime/daemon/main.ts startDaemon flow.
         Look for: "daemon-start" NDJSON event.
         Also verify IPC server is up:
           tailscale ssh root@srv1456441 -- 'ls -la /var/lib/iago-os/daemon-state/ipc.sock'
         Expected: socket file exists, owned iago:iago.
         ROLLBACK TRIGGER: daemon refuses to start, journal shows
         "error: <message>" line. Capture journal output, then
         execute rollback (§ 9).

T+10:00  Telegram test — phone side
           Send "/agents" to the (newly-rotated) bot from phone.
         Expected: bot replies with agent list (Phase 1 hello-world
         registers a "claude-main" agent if configured for auto-start,
         OR replies "No agents registered." which is also success
         — the bot replies at all, proving end-to-end path works).
         ROLLBACK TRIGGER: bot doesn't reply within 60s. Check
         allowed-user-IDs in unit env; if wrong, edit unit + reload.
         If still no reply, execute rollback.

T+15:00  Canonical workflow end-to-end test
           (Manually trigger one approval flow per Phase 1 hello-world
           pattern documented in runtime/PHASE-1-EVIDENCE.md § 4)
         On VPS:
           tailscale ssh root@srv1456441 -- '
             TASK_ID=$(node -e "console.log(crypto.randomUUID())")
             cat > /var/lib/iago-os/daemon-state/tasks/pending/claude-main__${TASK_ID}.json <<EOF
{ "prompt": "Test prompt from cutover — please respond OK", "needsApproval": true }
EOF
           '
         Expected: Telegram approval message arrives on phone.
         Tap "Allow". Agent resumes. Result lands at:
           /var/lib/iago-os/daemon-state/tasks/resolved/claude-main__<TASK_ID>.json
         Verification:
           tailscale ssh root@srv1456441 -- 'ls -la /var/lib/iago-os/daemon-state/tasks/resolved/'

T+25:00  Telegram + agent path proven working. Move to WhatsApp deauth.

T+30:00  WhatsApp deauth (per § 7 procedure)
           Open Meta Business Suite, gather APP_ID/WABA_ID/etc.
           Run the curl commands from § 7 steps 3-5 in terminal (a).
           Verification per § 7 step 6 + 7.
         No rollback trigger here — if WhatsApp deauth fails it's a
         security debt to fix in the next 24h, NOT a reason to roll
         back the v2 daemon cutover.

T+45:00  Smoke-check observability
           tailscale ssh root@srv1456441 -- 'head -20 /var/lib/iago-os/daemon-state/telemetry/$(date +%Y-%m-%d).ndjson'
         Expected: NDJSON lines including kinds: daemon-start,
         agent-registered (if auto-start configured), agent-spawned,
         task-claimed, approval-requested, approval-resolved.

T+50:00  Verify retention timer is scheduled
           tailscale ssh root@srv1456441 -- 'systemctl list-timers iago-archive-prune.timer'
         Expected: next run scheduled within 24h.

T+55:00  Smoke-check no orphaned processes
           tailscale ssh root@srv1456441 -- 'pgrep -fa openclaw'
         Expected: no output.
           tailscale ssh root@srv1456441 -- 'pgrep -fa iago-os-v2-daemon'
         Expected: exactly one Node process owned by uid of `iago` user.

T+60:00  CUTOVER COMPLETE.

         Santiago's tasks before stepping away:
           - Write session digest to Obsidian:
             sessions/2026-05-16-iago-os-v2-cutover.md
           - Update STATE.md Active table with cutover row
           - Stay at keyboard for 30 more minutes monitoring journal
             and Telegram. If anything regresses, execute rollback.
```

### Verification command summary (single block for runbook execution)

```bash
# Status block — run at T+08, T+15, T+45, T+55 for sanity
tailscale ssh root@srv1456441 -- '
  echo "=== systemctl status ==="
  systemctl is-active iago-os-v2-daemon.service
  echo "=== open agents ==="
  ls -la /var/lib/iago-os/daemon-state/agents/ 2>/dev/null
  echo "=== pending tasks ==="
  ls -la /var/lib/iago-os/daemon-state/tasks/pending/ 2>/dev/null
  echo "=== last 10 telemetry events ==="
  tail -10 /var/lib/iago-os/daemon-state/telemetry/$(date +%Y-%m-%d).ndjson 2>/dev/null
  echo "=== heartbeat status (last 60s) ==="
  journalctl -u iago-os-v2-daemon.service --since "60 seconds ago" | grep -E "heartbeat|error|warn" | tail -10
'
```

---

## 9. Rollback runbook (minute-by-minute)

### Detection

Detection triggers (any of these → execute rollback):

| Signal | Where to see it | Threshold |
|---|---|---|
| journal ERROR | `journalctl -u iago-os-v2-daemon.service` | ≥3 ERROR lines in 60s |
| Daemon refuses to start | `systemctl status iago-os-v2-daemon.service` | "failed" state OR start-limit-hit |
| Telegram /agents no reply | Santiago's phone | No response within 60s of sending |
| IPC socket missing | `ls /var/lib/iago-os/daemon-state/ipc.sock` | File absent >30s after start |
| Approval handshake breaks | T+15 canonical workflow test | No approval message arrives within 60s |
| Santiago command | `"rollback"` typed in any terminal | Immediate, no question |

### Automated watchdog (T+10 only — discontinue after T+20 of successful operation)

```bash
# Run in a separate terminal at T+08; abort with Ctrl-C at T+20 if all good
while true; do
  STATUS=$(tailscale ssh root@srv1456441 -- 'systemctl is-active iago-os-v2-daemon.service' 2>/dev/null)
  if [[ "$STATUS" != "active" ]]; then
    echo "*** ROLLBACK TRIGGER: daemon state = $STATUS ***"
    # Audible alert (Windows beep)
    printf '\a'
    break
  fi
  sleep 15
done
```

### Rollback steps

```
T+R+0:00  ROLLBACK START. Decision is made; execute without hesitation.

T+R+0:30  Stop the v2 daemon
            tailscale ssh root@srv1456441 -- 'systemctl stop iago-os-v2-daemon.service && systemctl disable iago-os-v2-daemon.service'
          Expected: clean stop (TimeoutStopSec=30s ceiling).
          Verification:
            tailscale ssh root@srv1456441 -- 'systemctl is-active iago-os-v2-daemon.service'
          Expected: "inactive"

T+R+1:30  Restore the OLD Telegram bot token
          Two paths depending on what was actually rotated:
          - If § 3 BotFather revocation already happened: must issue
            another /revoke on BotFather to get a fresh token, then
            update the OPENCLAW config to use that fresh token. Old
            tokens cannot be un-revoked.
          - If § 3 revocation has NOT happened yet (rollback before
            T+05): OpenClaw token is still valid; skip this step.

          For the post-T+05 path (the common case):
            (in Telegram) Message @BotFather → /mybots → bot →
              API Token → Revoke (gives fresh token)
            Save fresh token. Edit OpenClaw config:
            tailscale ssh root@srv1456441 -- 'su - ilsantino -c "
              # backup current config
              cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.pre-rollback
              # patch token field — use jq to avoid escaping hazards
              jq --arg t \"<FRESH-TOKEN>\" \
                \".channels.telegram.botToken = \$t\" \
                ~/.openclaw/openclaw.json > ~/.openclaw/openclaw.json.tmp \
                && mv ~/.openclaw/openclaw.json.tmp ~/.openclaw/openclaw.json
            "'

T+R+2:30  Start OpenClaw
            tailscale ssh root@srv1456441 -- 'su - ilsantino -c "systemctl --user enable --now openclaw-gateway.service"'
          Verification:
            tailscale ssh root@srv1456441 -- 'su - ilsantino -c "systemctl --user is-active openclaw-gateway.service"'
          Expected: "active"

T+R+4:00  Telegram smoke test (phone side)
            Send "/status" or any OpenClaw command to the bot.
          Expected: OpenClaw replies as it did pre-cutover.
          IF NO REPLY: this is a second failure. Escalate to Sebas
          via Telegram-via-some-other-channel (signal app /
          phone call) and investigate journal:
            tailscale ssh root@srv1456441 -- 'journalctl --user-unit openclaw-gateway.service --since "5 minutes ago"'

T+R+5:00  ROLLBACK COMPLETE. OpenClaw serving. v2 daemon stopped.

          Post-rollback required actions:
            1. Do NOT delete /var/lib/iago-os/daemon-state — preserve
               for root-cause analysis. The failed run's
               session-logs, markers, and telemetry are diagnostic.
            2. Do NOT re-attempt cutover today. Schedule a debug
               session in the next 24h.
            3. Write incident note:
               .iago/incidents/2026-05-16-v2-cutover-failure.md
               Include: failure signal, journal capture, what was
               tried, what was rolled back.
            4. Update STATE.md "Open" row with the incident.
            5. Notify Sebas if the failure mode is unclear or
               touches CTO infra patterns.
```

### State preservation question — answered

**Keep `/var/lib/iago-os/daemon-state` intact after rollback.** Reasoning:

- The failed run's `session.jsonl` event logs are the primary forensic surface for debugging
- `markers/*.daemon-stop` reveal what graceful-vs-crash state the agents were in when the failure hit
- `telemetry/<date>.ndjson` captures every stage event
- Disk cost: <50 MiB even after weeks of dev — preservation cost is zero
- If state corruption WAS the failure mode, rollback to OpenClaw is unaffected (OpenClaw reads its own dir under `/home/ilsantino/.openclaw/`)

Only wipe state-root if a subsequent debug session conclusively determines the state files themselves caused the failure AND a fresh re-cutover is being attempted. Even then: tar the state-root first before wiping.

### Target wall clock — meets ≤5 min spec

| Step | Wall clock |
|---|---|
| Stop v2 daemon | 0:30 |
| BotFather re-rotate (if needed) | 1:00 |
| Patch OpenClaw config | 0:30 |
| Start OpenClaw | 0:30 |
| Telegram smoke test | 1:30 |
| **Total** | **4:00** |

Within Santiago's 5-min spec. The most variable step is the BotFather re-rotate — if it's a pre-T+05 rollback (token not yet revoked) the total drops to ~2:30.

---

## 10. Phase 2 PR acceptance criteria

Per master prompt § Acceptance criteria. Each criterion + how Phase 2 PR satisfies it.

### 1. Build gate

**Spec says:** `tsc --noEmit && vite build` exit 0 (Node side). Pytest exit 0 (Python side).

**Phase 2 application:** No new Node code that compiles (the credential bootstrap helper `runtime/daemon/cred-bootstrap.ts` IS new Node code — counts). For shell scripts: shellcheck must pass.

**PR contains:**
- `cd runtime && npx tsc --noEmit` exit 0 (with new `cred-bootstrap.ts` integrated into the existing tsconfig include path)
- `cd runtime && npx vitest run` exit 0 (existing 199+ tests pass + new test for cred-bootstrap)
- `shellcheck scripts/vps-bootstrap/*.sh` exit 0

### 2. Unit tests — ≥80% coverage on new code

**Spec says:** `.claude/rules/tdd.md` — 80% line coverage per feature folder.

**Phase 2 application:**
- `cred-bootstrap.ts` has corresponding `cred-bootstrap.test.ts` covering: `$CREDENTIALS_DIRECTORY` absent (no-op), credential file present (loads to env), credential file present but env already set (skip), credential file empty (skip)
- shell scripts tested via bats-core or by stubbed-systemd-creds wrapper

**PR contains:**
- Vitest coverage table showing ≥80% lines on `cred-bootstrap.ts`
- bats-core run of `provision-credentials.sh` and `archive-openclaw.sh` with `systemd-creds`, `tar`, `age`, `tailscale` stubbed

### 3. Integration test

**Spec says:** End-to-end happy path documented and runnable.

**Phase 2 application:** Integration test = the dry-run cutover documented in § 8, executed against a fresh Hostinger VPS (NOT prod). Alternative: against a local VM (Vagrant Debian 13) configured to mirror VPS state.

**Verdict on staging VPS:** **provision a second Hostinger KVM 2 for staging** for the duration of this PR ($9/mo for ~1 week of testing = $2; trivial cost). Stops Phase 2 from being "test in prod with rollback ready" which violates Garry standard.

Staging VPS gets:
- Identical Debian 13 + Tailscale setup
- A fake OpenClaw state under `/home/ilsantino/.openclaw/` (mocked content — empty config + 100KB placeholder files in credentials/) so the archive script has real surface to operate on
- The full cutover runbook executed end-to-end
- Rollback executed end-to-end

**PR contains:** terminal log of the staging-VPS cutover from T-15 through T+60, with rollback path also exercised on a second pass.

### 4. Documentation

**Spec says:** `runtime/<component>/README.md` with purpose, dependencies, configuration, ops runbook, failure modes.

**Phase 2 application:**
- `runtime/migration/02-cutover-runbook.md` — copy of § 8 above
- `runtime/migration/02-rollback-runbook.md` — copy of § 9 above
- `runtime/migration/02-whatsapp-deauth.md` — copy of § 7 above
- `runtime/migration/02-cutover-decisions.md` — LanceDB verdict (§ 6), User=iago verdict (§ 1), Option-A Telegram rotation verdict (§ 3)
- `scripts/vps-bootstrap/README.md` — script catalog, prerequisites (1Password CLI, age, Tailscale CLI), run order
- Inline comments in the systemd unit file (§ 1 — already present in the spec)

### 5. Telemetry — NDJSON event emission

**Spec says:** NDJSON event emission per stage, keyed on `CLAUDE_CODE_SESSION_ID` where applicable.

**Phase 2 application:** Cutover-specific events emitted by the daemon at first start under systemd:
- `daemon-start` with new field `runUnder: "systemd"` (distinguishing from local dev)
- `cred-bootstrap-loaded` (new event kind) with field `credentialsLoaded: ["iago-telegram-token"]`
- Existing Phase 1 events (`agent-registered`, `agent-spawned`, `approval-requested`, `approval-resolved`, `agent-exited`) emit as normal

Cutover script side: each shell script writes a one-line NDJSON record per major step to `/var/log/iago-os/cutover.ndjson` so the post-cutover analysis can reconstruct exact timing.

### 6. Rollback path documented + tested

**Spec says:** What does "undo this deployment" look like?

**Phase 2 application:** § 9 above (runbook). Tested on staging VPS per criterion #3.

### 7. Verification path completed

**Spec says:** Pipeline via `/iago-execute` or `/iago-quick`, OR `/iago-fast`, OR doc-only via skill invocation.

**Phase 2 application:** This is multi-task work (systemd unit + 2 bash scripts + 1 TS module + 4 docs) — exceeds `/iago-fast` 3-file ceiling. Use `/iago-plan --feature phase-2-vps-bootstrap` to write the plan from this spec, then `/iago-execute feature-phase-2-vps-bootstrap` to run the full pipeline.

### 8. Self-evidence

**Spec says:** PR description includes screenshot or terminal log proving the feature works end-to-end. Not a description; evidence.

**Phase 2 application:** PR description embeds:
- Staging VPS cutover terminal log (T-15 through T+60)
- Staging VPS rollback terminal log
- Screenshot of Telegram approval flow from phone (during staging cutover)
- `journalctl -u iago-os-v2-daemon.service` excerpt showing clean startup under systemd
- `systemd-analyze security iago-os-v2-daemon.service` output (verifying exposure score ≤2.0)
- `systemd-creds decrypt` round-trip confirming credential provisioning works

---

## Open questions for Santiago

Each has a recommended default — accept the default unless flagged.

1. **Cutover window timing.** What day/hour? **Default:** Sunday 8pm US/Mexico time. Santiago at keyboard for first 30 min after T+60. Avoids MUNET sprint hours, off-peak for any inbound Telegram traffic.

2. **Staging VPS provisioning.** Approve $9/mo Hostinger KVM 2 for ~1 week of staging? **Default:** YES — Garry standard, $9 vs production-cutover-risk is no contest.

3. **`User=iago` system user.** Approve creating a dedicated `iago` system user (vs running daemon as `ilsantino`)? **Default:** YES per § 1 verdict — cleaner sandboxing, ProtectHome= becomes meaningful.

4. **age pubkey deployment.** Provide the local path to Santiago's age public key so it can be copied to `/etc/iago-os/santiago-age.pub`. **Default:** assumes Santiago already has an age keypair from MUNET workflows; if not, generate one before cutover: `age-keygen -o ~/.age/santiago.key` (private goes to ~/.age, pub gets copied to VPS).

5. **WhatsApp APP_SECRET availability.** § 7 step 6 uses `${APP_ID}|${APP_SECRET}` for debug_token call. Where does the app secret live? **Default:** in 1Password vault `iago-os` item `whatsapp-app-credentials` field `app_secret`. If not stored there yet, retrieve from Meta App Dashboard > Settings > Basic > App Secret > Show.

6. **Telegram bot @handle preservation.** Confirm Option A (rotate same bot, keep handle). **Default:** YES per § 3 verdict.

7. **LanceDB content fact-extraction.** Confirm decision to drop (preserve only in encrypted archive, no active migration). **Default:** YES per § 6 verdict — 72 KiB is small enough that Santiago can decrypt + grep the archive if a specific fact ever matters.

8. **Sebas notification.** Tell Sebas before or after the cutover? **Default:** before (Telegram message at T-15) so he's aware if rollback escalation needs his Mac-side eyes on AWS or any related infra.

9. **Anthropic key activation timing.** Phase 2 PROVISIONS the 3 Anthropic keys to /etc/credstore.encrypted/, but adapter wiring is Phase 3 work. Confirm we're OK with credentials sitting unused on disk for ~2 weeks until Phase 3 ships? **Default:** YES — credentials are encrypted at rest under TPM/host-key combo, unused-but-present is acceptable, alternative (provision-then-revoke-then-reprovision) burns ops cycles for no security gain.

10. **Iaguito vs iaguito_anthropic_sutoken.** The OpenClaw profile name is `iaguito_anthropic_sutoken` — verbose. Phase 2 schema uses short form `iaguito`. Confirm OK with the short form (§ 5 schema). **Default:** YES.

---

## References

### Internal files

- `C:\Users\sanal\dev\iago-os\CLAUDE.md` — Garry-impressed standard
- `C:\Users\sanal\dev\iago-os\docs\specs\iago-os-v2-vision.md` — original Phase 2 framing (superseded by this spec for Phase 2 only)
- `C:\Users\sanal\dev\iago-os\docs\specs\iago-os-v2-master-prompt.md` — § Acceptance criteria + § Phased sequencing
- `C:\Users\sanal\dev\iago-os\.iago\decisions\2026-05-15-agent-shape-taxonomy.md` — § HTTP-shape adapter authentication (systemd LoadCredential verdict)
- `C:\Users\sanal\dev\iago-os\runtime\migration\00-vps-audit.md` — Phase 0 audit (OpenClaw inventory, VPS state)
- `C:\Users\sanal\dev\iago-os\runtime\migration\phase-1-rollback.md` — Phase 1 rollback (reference pattern for shape of Phase 2 rollback)
- `C:\Users\sanal\dev\iago-os\runtime\daemon\config.ts` — DaemonConfig schema (extended with `authProfile` in Phase 2)
- `C:\Users\sanal\dev\iago-os\runtime\daemon\main.ts` — startDaemon flow (insertion point for `loadSystemdCredentials()`)
- `C:\Users\sanal\dev\iago-os\runtime\daemon\state-paths.ts` — IAGO_DAEMON_STATE_ROOT resolution
- `C:\Users\sanal\dev\iago-os\runtime\telegram\bot.ts` — Telegram allowed-user-ID semantics
- `C:\Users\sanal\dev\iago-os\runtime\PHASE-1-EVIDENCE.md` — § 4 hello-world manual test pattern (canonical workflow at T+15)

### External documentation

- [systemd Credentials — official docs](https://systemd.io/CREDENTIALS/) — LoadCredentialEncrypted, SetCredentialEncrypted, systemd-creds encrypt
- [systemd-creds(1) manpage — Debian](https://manpages.debian.org/testing/systemd/systemd-creds.1.en.html) — exact CLI flags
- [ArchWiki systemd-creds](https://wiki.archlinux.org/title/Systemd-creds) — practical examples
- [Credential Management With Systemd — SergeantBiggs Blog](https://blog.sergeantbiggs.net/posts/credential-management-with-systemd/) — sandboxing patterns
- [BotFather token revocation guide — CommandClaw](https://www.commandclaw.com/guides/rotate-telegram-bot-token) — /revoke flow
- [Telegram BotFather tutorial — core.telegram.org](https://core.telegram.org/bots/tutorial) — authoritative bot lifecycle
- [WhatsApp Business Account — Subscribed Apps API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api) — DELETE /subscribed_apps endpoint
- [Webhooks for WhatsApp Business Accounts](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-whatsapp/) — webhook lifecycle
- [Install Apps, Generate, Refresh, and Revoke Tokens — Meta](https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/) — system user token revocation
- [Debug Token endpoint — Meta](https://developers.facebook.com/docs/graph-api/reference/debug_token/) — verification of token validity
- [age encryption tool](https://github.com/FiloSottile/age) — `-R pubkey` recipient mode

### Memory references

- `memory:feedback_garry_impressed_standard` — completeness standard
- `memory:project_iago_v2_vision` — locked v2 vision (multi-agent OS framing)
- `memory:reference_iago_v2_vps` — Hostinger VPS coordinates (srv1456441 / 187.77.135.32 / Tailscale 100.94.1.34)
- `memory:project_mempalace` — MemPalace canonical-memory determination (drives § 6 LanceDB drop)
- `memory:feedback_decisions` — opinionated-verdict style (drives "Verdict:" framing throughout)
- `memory:feedback_explicit_authorization` — distinguishes spec from execution authorization (this is a spec, not an execute trigger)
