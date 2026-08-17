#!/usr/bin/env bash
#
# bootstrap-vps.sh — provision a VPS to the state cutover.sh expects
#
# WHY THIS EXISTS
#   cutover.sh's pre-flight gate ASSERTS a provisioned box: the `iago` user, the
#   state root, the /opt/iago-os checkout, and a built dist tree. It does not
#   create any of them — it fails closed if they are missing. The commands that
#   create them live only as a human checklist ("Day -1 prep") inside
#   runtime/migration/02-cutover-runbook.md § 3a, and were never automated.
#
#   runtime/deploy/README.md compounds the confusion by claiming cutover.sh
#   creates the iago user and builds + rsyncs the dist tree. It does neither.
#   This script is the missing half, written to match the runbook step for step.
#
#   Run it once, T-24h or immediately before the cutover. Then run cutover.sh.
#
# WHAT IT DOES NOT DO (deliberately)
#   - Does NOT install or start the systemd unit      → cutover.sh T+07
#   - Does NOT provision credentials                  → provision-credentials.sh
#     (invoked by cutover.sh T+05; needs 1Password on the operator's machine)
#   - Does NOT touch OpenClaw                         → cutover.sh T+00 owns that
#     On a migration box OpenClaw keeps running throughout bootstrap: nothing
#     here stops, reads, or archives it. Bootstrap is purely additive, so it is
#     safe to run hours or days before the cutover window with the old system
#     still serving traffic.
#
# WHY BUILD ON THE VPS RATHER THAN RSYNC A LOCAL BUILD
#   runtime/.gitignore excludes dist/, so there is nothing to ship from git, and
#   node-pty is a NATIVE module. A dist + node_modules tree built on Santiago's
#   Windows box carries a Windows-ABI node-pty binary that cannot load on Linux.
#   The repo is public, so the VPS clones it directly and builds in place — no
#   deploy key, no cross-platform binary hazard. (This also means the box needs
#   a C toolchain; step B2 installs it.)
#
# USAGE
#   IAGO_BOOTSTRAP_CONFIRM=YES bash runtime/deploy/bootstrap-vps.sh
#
# IDEMPOTENT — safe to re-run. Every step checks its post-condition first:
#   existing user is left alone, existing checkout is fetched + hard-reset to
#   the target ref rather than re-cloned, npm ci re-runs cheaply, dirs are
#   mkdir -p. Re-running after a partial failure resumes rather than conflicts.
#
# Shares /var/lock/iago-cutover.lock with cutover.sh and rollback.sh so a
# bootstrap can never rebuild /opt/iago-os underneath an in-flight cutover.

set -euo pipefail

# ============================================================================
# Step marker manifest (flush-left, mirrors the cutover.sh convention)
# ============================================================================
# B1  verify node >= 20 on the VPS
# B2  install build prerequisites (git + C toolchain for node-pty)
# B3  create the iago system user
# B4  create state root, daemon-state subdirs, log dir, credstore, /etc/iago-os
# B5  clone or update /opt/iago-os at the target ref
# B6  npm ci + npm run build inside runtime/
# B7  set ownership and modes across the tree
# B8  verify every condition cutover.sh's pre-flight gate checks

VPS_HOST="${VPS_HOST:-srv1456441}"
VPS_USER="${VPS_USER:-root}"
REPO_URL="${IAGO_BOOTSTRAP_REPO_URL:-https://github.com/ilsantino/iago-os.git}"
REPO_REF="${IAGO_BOOTSTRAP_REF:-main}"
CHECKOUT=/opt/iago-os
STATE_ROOT=/var/lib/iago-os/daemon-state
LOG_DIR=/var/log/iago-os

LOCK_MARKER=""

if [[ "${IAGO_BOOTSTRAP_CONFIRM:-}" != "YES" ]]; then
  echo "ABORT: IAGO_BOOTSTRAP_CONFIRM=YES required to proceed." >&2
  echo "       This provisions a production VPS; refuse to run silently." >&2
  exit 1
fi

vssh() {
  tailscale ssh "${VPS_USER}@${VPS_HOST}" -- "$@"
}

# ============================================================================
# Global lock — shared with cutover.sh / rollback.sh
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
    echo "ERROR: a cutover/rollback/bootstrap is already running (${out})." >&2
    echo "       If you are certain nothing is in flight, break the stale lock with:" >&2
    echo "         tailscale ssh ${VPS_USER}@${VPS_HOST} -- 'rm -f /var/lock/iago-cutover.lock /var/lock/iago-cutover.lock.pid'" >&2
    exit 1
  fi
  echo "  OK acquired global lock (marker=${LOCK_MARKER})"
}

release_remote_lock() {
  [[ -n "$LOCK_MARKER" ]] || return 0
  local local_marker="$LOCK_MARKER"
  LOCK_MARKER=""
  vssh bash -s <<EOF > /dev/null 2>&1 || true
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
# Main
# ============================================================================

main() {
  echo "iaGO-OS v2 VPS bootstrap"
  echo "VPS:      ${VPS_USER}@${VPS_HOST}"
  echo "Checkout: ${CHECKOUT} @ ${REPO_REF}"
  echo ""

  # Reachability first — a clear message beats twelve confusing ones.
  if ! vssh true > /dev/null 2>&1; then
    echo "ABORT: cannot reach ${VPS_USER}@${VPS_HOST} over Tailscale SSH." >&2
    echo "       Check: tailscale status. If SSH prompts for re-auth, approve it in the browser first." >&2
    exit 1
  fi
  acquire_remote_lock

  # --- B1: node version ---
  # B1 verify node
  echo "[B1] Verify node >= 20 on the VPS"
  local node_major
  node_major=$(vssh "node -p 'process.versions.node.split(\".\")[0]' 2>/dev/null || echo 0")
  node_major="${node_major//[[:space:]]/}"
  if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 20 )); then
    echo "ABORT: VPS node major version is '${node_major}' — runtime/package.json requires >=20." >&2
    exit 1
  fi
  echo "  OK node major ${node_major}"

  # --- B2: build prerequisites ---
  # B2 install build prerequisites
  # node-pty compiles from source; without python3/make/g++ the npm ci in B6
  # fails deep inside node-gyp with an error that reads like a network problem.
  # Install up front so the failure mode never appears.
  echo "[B2] Install build prerequisites (git, python3, make, g++)"
  vssh bash -s <<'EOF'
set -e
missing=""
for b in git python3 make g++; do
  command -v "$b" > /dev/null 2>&1 || missing="${missing} ${b}"
done
if [[ -z "$missing" ]]; then
  echo "  IDEMPOTENT: all build prerequisites already present"
  exit 0
fi
echo "  installing:${missing}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# build-essential covers make + g++; python3 and git named explicitly.
apt-get install -y -qq git python3 build-essential
EOF
  echo "  OK build prerequisites present"

  # --- B3: iago system user ---
  # B3 create iago user
  # Flags per spec § 1 / migration/02-cutover-decisions.md:73 — a system user
  # with no home and no shell. ProtectHome=true in the unit is only meaningful
  # because this user owns nothing under /home.
  echo "[B3] Create the iago system user"
  vssh bash -s <<'EOF'
set -e
if getent passwd iago > /dev/null 2>&1; then
  echo "  IDEMPOTENT: iago user already exists"
else
  useradd --system --no-create-home --shell /usr/sbin/nologin \
    --comment "iaGO-OS v2 daemon" iago
  echo "  created iago user"
fi
getent passwd iago
EOF

  # --- B4: directories ---
  # B4 create state root, subdirs, log dir, credstore
  # The daemon-state SUBDIRS matter as much as the root: the daemon's first
  # task-claim / telemetry-write / marker-write hits ENOENT without them, and
  # that ENOENT trips cutover.sh's T+08 failure-pattern grep — presenting as a
  # rollback-triggering daemon fault when the real cause is a missing mkdir.
  echo "[B4] Create state root, daemon-state subdirs, log dir, credstore"
  vssh bash -s <<EOF
set -e
mkdir -p ${STATE_ROOT}/{tasks/pending,tasks/resolved,markers,telemetry,agents} ${LOG_DIR}
chown -R iago:iago /var/lib/iago-os ${LOG_DIR}
chmod 0700 ${STATE_ROOT}
chmod 0750 ${LOG_DIR}
# credstore: provision-credentials.sh also mkdir's this, but cutover.sh's
# pre-flight reads it before that runs, so create it here too.
mkdir -p /etc/credstore.encrypted && chmod 0700 /etc/credstore.encrypted
# /etc/iago-os holds the age pubkey that archive-openclaw.sh encrypts to.
# Unused when the archive is skipped or taken as a plain tar; created empty
# so the path exists if a later phase wants it.
mkdir -p /etc/iago-os && chmod 0755 /etc/iago-os
stat -c '%n %U:%G %a' ${STATE_ROOT} ${LOG_DIR} /etc/credstore.encrypted
EOF
  echo "  OK directories created"

  # --- B5: checkout ---
  # B5 clone or update the checkout
  # Public repo → https clone with no credential. Existing checkout is reset
  # rather than re-cloned so a re-run never destroys a dirty tree silently:
  # fetch + hard reset to the target ref is explicit about what wins.
  echo "[B5] Clone or update ${CHECKOUT} at ${REPO_REF}"
  vssh bash -s <<EOF
set -e
if [[ -d ${CHECKOUT}/.git ]]; then
  echo "  IDEMPOTENT: checkout exists — fetching and resetting to ${REPO_REF}"
  git -C ${CHECKOUT} fetch --prune origin
  git -C ${CHECKOUT} checkout -B ${REPO_REF} origin/${REPO_REF}
  git -C ${CHECKOUT} reset --hard origin/${REPO_REF}
else
  git clone --branch ${REPO_REF} ${REPO_URL} ${CHECKOUT}
fi
git -C ${CHECKOUT} rev-parse --short HEAD
EOF
  echo "  OK checkout at ${REPO_REF}"

  # --- B6: install + build ---
  # B6 npm ci + build
  # npm ci (not install) — runtime/package-lock.json is committed, and ci gives
  # a reproducible tree. This is the step that compiles node-pty; expect it to
  # take a few minutes on a small VPS.
  echo "[B6] npm ci + npm run build (compiles node-pty — takes a few minutes)"
  vssh bash -s <<EOF
set -e
cd ${CHECKOUT}/runtime
npm ci --no-audit --no-fund
npm run build
test -f ${CHECKOUT}/runtime/dist/daemon/main.js
echo "  built: \$(wc -c < ${CHECKOUT}/runtime/dist/daemon/main.js) bytes"
EOF
  echo "  OK dist/daemon/main.js built"

  # --- B7: ownership ---
  # B7 set ownership and modes
  # Tree is root-owned and group-readable by iago: the daemon reads its own code
  # but cannot rewrite it (ProtectSystem=strict would block writes anyway; this
  # makes the intent explicit at the filesystem layer too).
  echo "[B7] Set ownership root:iago 0755 on ${CHECKOUT}"
  vssh "chown -R root:iago ${CHECKOUT} && chmod 0755 ${CHECKOUT}"
  echo "  OK ownership set"

  # --- B8: verify against cutover.sh's pre-flight gate ---
  # B8 verify preflight conditions
  # Assert exactly what cutover.sh checks, so a bootstrap that "succeeded" but
  # left a gap is caught here rather than 15 minutes into a timed cutover.
  echo "[B8] Verify every condition cutover.sh pre-flight checks"
  local failures=0
  check() {
    local label="$1" cmd="$2"
    if vssh "$cmd" > /dev/null 2>&1; then
      echo "  OK ${label}"
    else
      echo "  FAIL ${label}"
      failures=$(( failures + 1 ))
    fi
  }
  check "iago user exists"                "getent passwd iago"
  check "state root present"              "test -d ${STATE_ROOT}"
  check "state root owned by iago"        "test \"\$(stat -c %U ${STATE_ROOT})\" = iago"
  check "daemon-state subdirs present"    "test -d ${STATE_ROOT}/tasks/pending -a -d ${STATE_ROOT}/markers -a -d ${STATE_ROOT}/telemetry -a -d ${STATE_ROOT}/agents"
  check "log dir present"                 "test -d ${LOG_DIR}"
  check "credstore present"               "test -d /etc/credstore.encrypted"
  check "checkout has .git"               "test -d ${CHECKOUT}/.git"
  check "dist entry point built"          "test -f ${CHECKOUT}/runtime/dist/daemon/main.js"
  check "node >= 20"                      "test \"\$(node -p 'process.versions.node.split(\".\")[0]')\" -ge 20"

  if (( failures > 0 )); then
    echo ""
    echo "ABORT: ${failures} post-bootstrap check(s) failed — do NOT start the cutover." >&2
    exit 1
  fi

  echo ""
  echo "BOOTSTRAP COMPLETE — the box now satisfies cutover.sh's pre-flight gate."
  echo ""
  echo "Still required before cutover.sh (this script does not do them):"
  echo "  1. 1Password CLI installed + signed in ON THE OPERATOR MACHINE (op whoami)"
  echo "     — provision-credentials.sh runs locally and reads op:// refs at T+05."
  echo "  2. 1Password vault 'iago-os' holds items 'v2-daemon-telegram-bot' (field"
  echo "     token) and 'v2-gh-token' (classic PAT, scopes repo + read:org)."
  echo "  3. export IAGO_TELEGRAM_USER_ID=<numeric id>   (ask @userinfobot on Telegram)"
  echo ""
  echo "Then:"
  echo "  IAGO_CUTOVER_CONFIRM=YES \\"
  echo "    IAGO_TELEGRAM_USER_ID=\$IAGO_TELEGRAM_USER_ID \\"
  echo "    bash runtime/deploy/cutover.sh"
  echo ""
  echo "  (Add IAGO_CUTOVER_GREENFIELD=1 only on a box that has never run OpenClaw."
  echo "   cutover.sh verifies that claim and aborts if it finds an install.)"
}

main "$@"
