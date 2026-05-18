#!/usr/bin/env bash
# Manual test for learnings-writer.sh.
# Run: bash scripts/lib/learnings-writer.test.sh
# Exits 0 on all green; non-zero on any FAIL. Some perm-based tests SKIP on
# filesystems where chmod is advisory (Windows NTFS via Git Bash).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WRITER="$SCRIPT_DIR/learnings-writer.sh"
TELEMETRY="$SCRIPT_DIR/pipeline-telemetry.sh"

if [[ ! -f "$WRITER" ]]; then
  echo "FAIL: writer not found at $WRITER"
  exit 1
fi

PASS=0
FAIL=0
SKIP=0

ok()   { echo "OK:   $1"; PASS=$((PASS + 1)); }
nope() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }
skip() { echo "SKIP: $1"; SKIP=$((SKIP + 1)); }

# Detect whether chmod 0500 actually denies writes here. Cygwin/Git Bash on
# NTFS ignores the bit unless the noacl mount option is set — denial tests
# only have semantic value when this returns "yes".
chmod_denies_writes() {
  local probe
  probe=$(mktemp -d)
  mkdir "$probe/locked"
  chmod 0500 "$probe/locked" 2>/dev/null || true
  local got=no
  if ! ( : > "$probe/locked/probe" ) 2>/dev/null; then
    got=yes
  fi
  chmod 0700 "$probe/locked" 2>/dev/null || true
  rm -rf "$probe"
  echo "$got"
}

CHMOD_DENIES=$(chmod_denies_writes)

# ─── Test 1: happy path writes to patterns.md ───────────────────────
TMP1=$(mktemp -d)
(
  set -uo pipefail
  . "$WRITER"
  PROJECT_DIR="$TMP1" learnings_write "test-key" "test body"
) > /dev/null 2>&1
RC=$?
if (( RC == 0 )) \
    && [[ -f "$TMP1/.iago/learnings/patterns.md" ]] \
    && grep -q '## ' "$TMP1/.iago/learnings/patterns.md" \
    && grep -q 'test-key' "$TMP1/.iago/learnings/patterns.md" \
    && grep -q 'test body' "$TMP1/.iago/learnings/patterns.md"; then
  ok "happy path: patterns.md written with header + key + body (rc=0)"
else
  nope "happy path: rc=$RC; file=$TMP1/.iago/learnings/patterns.md"
  cat "$TMP1/.iago/learnings/patterns.md" 2>&1 >&2
fi
rm -rf "$TMP1"

# ─── Test 2: missing args → exit 64 + usage stderr ──────────────────
TMP2=$(mktemp -d)
ERR_FILE="$TMP2/err"
RC=$(
  set +e
  . "$WRITER"
  PROJECT_DIR="$TMP2" learnings_write 2> "$ERR_FILE"
  echo $?
)
if [[ "$RC" == "64" ]] && grep -q 'usage' "$ERR_FILE"; then
  ok "missing args: returns 64 + stderr contains 'usage'"
else
  nope "missing args: rc=$RC stderr=$(cat "$ERR_FILE")"
fi
rm -rf "$TMP2"

# ─── Test 3: perm-denied fail-loud (default) ────────────────────────
if [[ "$CHMOD_DENIES" != "yes" ]]; then
  skip "perm-denied fail-loud: chmod is advisory on this FS"
else
  TMP3=$(mktemp -d)
  mkdir -p "$TMP3/.iago/learnings"
  chmod 0500 "$TMP3/.iago/learnings"
  ERR3="$TMP3/err"
  RUN3="$TMP3/run.ndjson"
  : > "$RUN3"
  RC=$(
    set +e
    . "$TELEMETRY"
    . "$WRITER"
    PROJECT_DIR="$TMP3" RUN_FILE="$RUN3" \
      learnings_write "perm-key" "perm body" 2> "$ERR3"
    echo $?
  )
  chmod 0700 "$TMP3/.iago/learnings" 2>/dev/null || true
  if [[ "$RC" == "1" ]] \
      && grep -q 'FAIL' "$ERR3" \
      && grep -q 'learnings_write_failed' "$RUN3"; then
    ok "perm-denied fail-loud: rc=1, stderr 'FAIL', telemetry event emitted"
  else
    nope "perm-denied fail-loud: rc=$RC stderr=$(cat "$ERR3") run=$(cat "$RUN3")"
  fi
  rm -rf "$TMP3"
fi

# ─── Test 4: perm-denied fallback mode writes to fallback dir ───────
if [[ "$CHMOD_DENIES" != "yes" ]]; then
  skip "perm-denied fallback: chmod is advisory on this FS"
else
  TMP4=$(mktemp -d)
  mkdir -p "$TMP4/.iago/learnings"
  chmod 0500 "$TMP4/.iago/learnings"
  ERR4="$TMP4/err"
  RUN4="$TMP4/run.ndjson"
  : > "$RUN4"
  RC=$(
    set +e
    . "$TELEMETRY"
    . "$WRITER"
    PROJECT_DIR="$TMP4" RUN_FILE="$RUN4" LEARNINGS_WRITE_MODE=fallback \
      learnings_write "fb-key" "fb body" 2> "$ERR4"
    echo $?
  )
  chmod 0700 "$TMP4/.iago/learnings" 2>/dev/null || true
  FB_COUNT=$(find "$TMP4/.iago/logs" -name 'learnings-fallback-*.md' 2>/dev/null | wc -l)
  if [[ "$RC" == "0" ]] \
      && (( FB_COUNT >= 1 )) \
      && grep -q 'WARNING' "$ERR4" \
      && grep -q 'learnings_written_to_fallback' "$RUN4"; then
    ok "perm-denied fallback: rc=0, fallback file present, WARNING + telemetry"
  else
    nope "perm-denied fallback: rc=$RC fb_count=$FB_COUNT stderr=$(cat "$ERR4")"
  fi
  rm -rf "$TMP4"
fi

# ─── Test 5: parent .iago/ missing → mkdir -p recovers ──────────────
TMP5=$(mktemp -d)
# Intentionally no .iago dir — writer's mkdir -p must create the whole chain.
(
  set -uo pipefail
  . "$WRITER"
  PROJECT_DIR="$TMP5" learnings_write "recover-key" "recover body"
) > /dev/null 2>&1
RC=$?
if (( RC == 0 )) && [[ -f "$TMP5/.iago/learnings/patterns.md" ]]; then
  ok "parent dir missing: writer recovered via mkdir -p (rc=0)"
else
  nope "parent dir missing: rc=$RC file present=$([[ -f "$TMP5/.iago/learnings/patterns.md" ]] && echo yes || echo no)"
fi
rm -rf "$TMP5"

# ─── Test 6: advisory-lock no-false-fail ────────────────────────────
# Documented limit (per I1): flock is advisory on Linux/Mac, mandatory locking
# is non-portable. This test verifies the writer DOES succeed against an
# advisory-locked file (no false fail-loud trigger) — NOT that the writer
# survives a true exclusive lock.
TMP6=$(mktemp -d)
mkdir -p "$TMP6/.iago/learnings"
TARGET6="$TMP6/.iago/learnings/patterns.md"
: > "$TARGET6"
exec 9>"$TARGET6"
if command -v flock >/dev/null 2>&1; then
  flock 9
fi
(
  set -uo pipefail
  . "$WRITER"
  PROJECT_DIR="$TMP6" learnings_write "lock-key" "lock body"
) > /dev/null 2>&1
RC=$?
exec 9>&-
if (( RC == 0 )) && grep -q 'lock-key' "$TARGET6"; then
  ok "advisory-lock no-fail: write succeeded under advisory lock (rc=0)"
else
  nope "advisory-lock no-fail: rc=$RC content=$(cat "$TARGET6" | head -3)"
fi
rm -rf "$TMP6"

# ─── Test 7: telemetry event carries sessionId ──────────────────────
TMP7=$(mktemp -d)
RUN7="$TMP7/run.ndjson"
: > "$RUN7"
(
  set -uo pipefail
  . "$TELEMETRY"
  . "$WRITER"
  export CLAUDE_CODE_SESSION_ID="writer-sess"
  PROJECT_DIR="$TMP7" RUN_FILE="$RUN7" learnings_write "sid-key" "sid body"
) > /dev/null 2>&1
if grep -q '"type":"learnings_written"' "$RUN7" \
    && grep -q '"sessionId":"writer-sess"' "$RUN7"; then
  ok "telemetry sessionId: event carries sessionId=writer-sess"
else
  nope "telemetry sessionId: event missing or sessionId not propagated"
  cat "$RUN7" >&2
fi
rm -rf "$TMP7"

# ─── Test 8: disk-full sim (best-effort SKIP on Windows) ────────────
# Real ENOSPC sim requires a tmpfs with size= mount option (Linux) or a
# small loop device. Neither is reliably available on Git Bash / Windows.
# Document the skip clearly.
skip "disk-full sim: requires Linux tmpfs (size=) or loop device — not portable to Git Bash"

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[[ $FAIL -eq 0 ]] || exit 1
exit 0
