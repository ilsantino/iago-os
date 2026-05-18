#!/usr/bin/env bats
#
# bats-core tests for runtime/deploy/archive-openclaw.sh
#
# Strategy: each test builds an isolated temp dir, populates it with a fake
# layout (HOME, age pubkey, OpenClaw dir, ARCHIVE_ROOT, etc.), and prepends a
# stubs/ directory to PATH so all external commands the script invokes —
# systemctl, su, pgrep, tar, age, shred, find, logger — are replaced with
# scripts that record their invocations to per-stub log files and return
# scripted exit codes. We then `bash archive-openclaw.sh` (NOT source, since
# `set -euo pipefail` would propagate into bats) and inspect the recorded
# logs + the temp ARCHIVE_ROOT contents.
#
# The one exception is Test 9 (ephemeral-keypair round-trip): instead of
# stubbing `age`, that test executes the REAL age binary against a generated
# throwaway keypair and proves the ciphertext is recoverable. It skips
# automatically if `age` and `age-keygen` are absent.
#
# Run: bats runtime/deploy/archive-openclaw.test.sh
# On Windows: bats is documented but not pipeline-gated (Plan 01a I1 carry-over).

# ───────────────────────────── Helpers ─────────────────────────────

# Build a stub script at $STUBS_DIR/<name>. The stub records every invocation
# to $LOG_DIR/<name>.log (one line per call, with argv) and then executes the
# body passed as the second argument (default: `exit 0`).
mkstub() {
	local name="$1" body="${2:-exit 0}"
	cat > "$STUBS_DIR/$name" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$LOG_DIR/$name.log"
$body
EOF
	chmod +x "$STUBS_DIR/$name"
}

# Patch the SUT into a temp copy with overridden constants so the script
# writes into our scratch tree instead of /var/lib, /etc/systemd, etc.
prepare_sut() {
	cp "$SUT_SRC" "$SUT_COPY"
	sed -i \
		-e "s|^OPENCLAW_USER=.*|OPENCLAW_USER=\"$(whoami)\"|" \
		-e "s|^OPENCLAW_HOME=.*|OPENCLAW_HOME=\"$FAKE_HOME\"|" \
		-e "s|^OPENCLAW_DIR=.*|OPENCLAW_DIR=\"$FAKE_OPENCLAW\"|" \
		-e "s|^ARCHIVE_ROOT=.*|ARCHIVE_ROOT=\"$ARCHIVE_ROOT\"|" \
		-e "s|^MANIFEST=.*|MANIFEST=\"$ARCHIVE_ROOT/MANIFEST.md\"|" \
		-e "s|^MANIFEST_LOCK=.*|MANIFEST_LOCK=\"$ARCHIVE_ROOT/MANIFEST.md.lock\"|" \
		-e "s|^PUBKEY=.*|PUBKEY=\"$FAKE_PUBKEY\"|" \
		-e "s|^NDJSON_LOG=.*|NDJSON_LOG=\"$NDJSON_LOG\"|" \
		-e "s|^PRUNE_SERVICE=.*|PRUNE_SERVICE=\"$ETC_SYSTEMD/iago-archive-prune.service\"|" \
		-e "s|^PRUNE_TIMER=.*|PRUNE_TIMER=\"$ETC_SYSTEMD/iago-archive-prune.timer\"|" \
		"$SUT_COPY"
	# Neuter the root check — bats runs as a regular user.
	sed -i 's|^if \[\[ "\$(id -u)" -ne 0 \]\]; then|if false; then|' "$SUT_COPY"
}

# ───────────────────────────── Setup ─────────────────────────────

setup() {
	SUT_SRC="$BATS_TEST_DIRNAME/archive-openclaw.sh"
	TMPDIR_TEST=$(mktemp -d -t iago-archive.XXXXXX)
	export TMPDIR_TEST

	STUBS_DIR="$TMPDIR_TEST/stubs"
	LOG_DIR="$TMPDIR_TEST/logs"
	FAKE_HOME="$TMPDIR_TEST/home"
	FAKE_OPENCLAW="$FAKE_HOME/.openclaw"
	ARCHIVE_ROOT="$TMPDIR_TEST/var/lib/iago-os/openclaw-archive"
	NDJSON_LOG="$TMPDIR_TEST/var/log/iago-os/cutover.ndjson"
	ETC_SYSTEMD="$TMPDIR_TEST/etc/systemd/system"
	FAKE_PUBKEY="$TMPDIR_TEST/etc/iago-os/santiago-age.pub"
	SUT_COPY="$TMPDIR_TEST/archive-openclaw.sh"

	mkdir -p "$STUBS_DIR" "$LOG_DIR" "$FAKE_HOME" "$FAKE_OPENCLAW" \
		"$(dirname "$NDJSON_LOG")" "$ETC_SYSTEMD" "$(dirname "$FAKE_PUBKEY")"

	# Default OpenClaw content (real files, not just empty dir).
	echo '{"placeholder":"openclaw-cred"}' > "$FAKE_OPENCLAW/openclaw.json"
	mkdir -p "$FAKE_OPENCLAW/sessions"
	echo 'session-state' > "$FAKE_OPENCLAW/sessions/2026-05-18.json"

	# Default age pubkey (any non-empty file — pre-flight only checks existence).
	echo 'age1exampleexampleexampleexampleexampleexampleexampleexample' > "$FAKE_PUBKEY"

	# Default stubs — every test gets these; individual tests override as needed.
	mkstub systemctl 'exit 0'
	# su shim — emulates `su - user -c "<cmd>"`. argv is: `- user -c <cmd>`.
	# We just succeed; record the invocation. For is-active / is-enabled we
	# return success by default (so the script takes the "stop" / "disable"
	# branch); individual tests override.
	mkstub su 'exit 0'
	mkstub pgrep 'exit 1'  # default: no matching process
	# tar stub: creates the file passed via -f, recording argv.
	cat > "$STUBS_DIR/tar" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TMPDIR_TEST/logs/tar.log"
# Find -f arg
prev=""
for a in "$@"; do
	if [[ "$prev" == "-f" || "$prev" == "--file" ]]; then
		printf 'fake-tarball-content\n' > "$a"
		break
	fi
	# also handle -czf style
	if [[ "$a" == -*f* && "$a" != *=* ]]; then
		: # next arg is the file
	fi
	prev="$a"
done
# Also handle the combined -czf form: find first non-flag arg after a -*f*.
for ((i=1; i<=$#; i++)); do
	cur="${!i}"
	if [[ "$cur" == -*f* ]]; then
		j=$((i+1))
		if [[ $j -le $# ]]; then
			fpath="${!j}"
			printf 'fake-tarball-content\n' > "$fpath"
		fi
		break
	fi
done
exit 0
EOF
	chmod +x "$STUBS_DIR/tar"
	# age stub: writes age-encryption.org/v1 header to -o target.
	cat > "$STUBS_DIR/age" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TMPDIR_TEST/logs/age.log"
# -d means decrypt; for the bogus-identity probe the script EXPECTS failure.
for a in "$@"; do
	if [[ "$a" == "-d" ]]; then
		echo "age: error decrypting: no identity matched any of the recipients" >&2
		exit 1
	fi
done
# Encrypt path: find -o arg, write a valid age v1 header.
prev=""
for a in "$@"; do
	if [[ "$prev" == "-o" ]]; then
		printf 'age-encryption.org/v1\n-> X25519 fakedata\n--- fakemac\nciphertextciphertext' > "$a"
		exit 0
	fi
	prev="$a"
done
exit 0
EOF
	chmod +x "$STUBS_DIR/age"
	# age-keygen stub — produces an ephemeral key file.
	cat > "$STUBS_DIR/age-keygen" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TMPDIR_TEST/logs/age-keygen.log"
prev=""
for a in "$@"; do
	if [[ "$prev" == "-o" ]]; then
		printf '# created: stub\n# public key: age1fakefakefakefake\nAGE-SECRET-KEY-1FAKEFAKEFAKEFAKE\n' > "$a"
		exit 0
	fi
	prev="$a"
done
exit 0
EOF
	chmod +x "$STUBS_DIR/age-keygen"
	# shred stub: just deletes the last arg.
	cat > "$STUBS_DIR/shred" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TMPDIR_TEST/logs/shred.log"
last="${!#}"
[[ -f "$last" ]] && rm -f "$last"
exit 0
EOF
	chmod +x "$STUBS_DIR/shred"
	# find stub — passes through to real find (we need actual filesystem
	# scanning for the day-sentinel idempotency check). Implementation: just
	# exec the real find binary.
	REAL_FIND=$(command -v find)
	cat > "$STUBS_DIR/find" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$LOG_DIR/find.log"
exec "$REAL_FIND" "\$@"
EOF
	chmod +x "$STUBS_DIR/find"
	# logger stub
	mkstub logger 'exit 0'

	# Note: do NOT stub `command` — it's a bash builtin and stubbing breaks
	# the script's own `command -v` checks. Provide age/jq/sha256sum via PATH.

	# Provide real jq + sha256sum from the host so `command -v` succeeds.
	# (bats's PATH is parent-shell PATH; we PREPEND stubs so real coreutils
	# remain reachable.)
	export PATH="$STUBS_DIR:$PATH"

	prepare_sut
}

teardown() {
	rm -rf "$TMPDIR_TEST"
}

# ───────────────────────────── Tests ─────────────────────────────

@test "1: not-root → exits 1 with 'must run as root'" {
	# Un-neuter the root check so it actually fires.
	sed -i 's|^if false; then|if [[ "$(id -u)" -ne 99999 ]]; then|' "$SUT_COPY"
	run bash "$SUT_COPY"
	[ "$status" -eq 1 ]
	[[ "$output" == *"must run as root"* ]]
}

@test "2: age missing → exits 1 with \"'age' not installed\"" {
	rm -f "$STUBS_DIR/age"
	# Also need to hide the real age binary if present. Easiest: clobber PATH
	# to only contain stubs.
	PATH="$STUBS_DIR" run bash "$SUT_COPY"
	[ "$status" -eq 1 ]
	[[ "$output" == *"'age' not installed"* ]]
}

@test "3: pubkey missing → exits 1 with helpful scp hint" {
	rm -f "$FAKE_PUBKEY"
	run bash "$SUT_COPY"
	[ "$status" -eq 1 ]
	[[ "$output" == *"age pubkey not found"* ]]
	[[ "$output" == *"scp"* ]]
}

@test "4: OpenClaw dir absent → exits 0 with 'nothing to archive'" {
	rm -rf "$FAKE_OPENCLAW"
	run bash "$SUT_COPY"
	[ "$status" -eq 0 ]
	[[ "$output" == *"nothing to archive"* ]]
}

@test "5: happy path → all 6 steps execute, raw tarball is shredded, manifest row appended" {
	run bash "$SUT_COPY"
	[ "$status" -eq 0 ]
	# Step 1: systemctl is-active + stop
	grep -q "is-active" "$LOG_DIR/su.log"
	grep -q "stop openclaw-gateway" "$LOG_DIR/su.log"
	# Step 2: disable
	grep -q "disable openclaw-gateway" "$LOG_DIR/su.log"
	# Step 3: tar
	[[ -s "$LOG_DIR/tar.log" ]]
	# Step 4: age + shred
	[[ -s "$LOG_DIR/age.log" ]]
	[[ -s "$LOG_DIR/shred.log" ]]
	# Step 6: systemctl daemon-reload + enable timer
	grep -q "daemon-reload" "$LOG_DIR/systemctl.log"
	grep -q "enable --now iago-archive-prune.timer" "$LOG_DIR/systemctl.log"
	# Encrypted file exists, raw .tar.gz (sans .age) does NOT
	enc=$(find "$ARCHIVE_ROOT" -name "*.age" | head -1)
	[[ -n "$enc" ]]
	raw="${enc%.age}"
	[[ ! -f "$raw" ]]
	# Manifest has header + 1 data row (6 pipes per row = 7 columns).
	# Year-agnostic match: data rows start with "| YYYYMMDD-" (8 digits, dash).
	[[ -f "$ARCHIVE_ROOT/MANIFEST.md" ]]
	rows=$(grep -cE "^\| [0-9]{8}-" "$ARCHIVE_ROOT/MANIFEST.md" || true)
	[ "$rows" -eq 1 ]
	# NDJSON log has step-by-step entries.
	grep -q '"step":"step1-stop"' "$NDJSON_LOG"
	grep -q '"step":"step3-tar"' "$NDJSON_LOG"
	grep -q '"step":"step6-timer"' "$NDJSON_LOG"
}

@test "6: retention timer already installed → step 6 says 'already installed'" {
	# Pre-create the unit files.
	touch "$ETC_SYSTEMD/iago-archive-prune.service" "$ETC_SYSTEMD/iago-archive-prune.timer"
	run bash "$SUT_COPY"
	[ "$status" -eq 0 ]
	[[ "$output" == *"already installed"* ]]
	# daemon-reload should NOT have been called (already-installed branch).
	! grep -q "daemon-reload" "$LOG_DIR/systemctl.log" 2>/dev/null
}

@test "7: idempotent re-run with --force-new-archive → second archive + 2 manifest rows" {
	run bash "$SUT_COPY"
	[ "$status" -eq 0 ]
	# Need a different HHMMSS for the second run; sleep 1s.
	sleep 1
	run bash "$SUT_COPY" --force-new-archive
	[ "$status" -eq 0 ]
	# 2 .age files for today
	count=$(find "$ARCHIVE_ROOT" -name "*.age" | wc -l)
	[ "$count" -eq 2 ]
	# Manifest has 2 data rows (year-agnostic match).
	rows=$(grep -cE "^\| [0-9]{8}-" "$ARCHIVE_ROOT/MANIFEST.md" || true)
	[ "$rows" -eq 2 ]
}

@test "8: idempotent re-run (same UTC date) → exits 0, no second archive, manifest unchanged" {
	run bash "$SUT_COPY"
	[ "$status" -eq 0 ]
	rows_before=$(grep -cE "^\| [0-9]{8}-" "$ARCHIVE_ROOT/MANIFEST.md" || true)
	manifest_before=$(sha256sum "$ARCHIVE_ROOT/MANIFEST.md" | awk '{print $1}')
	sleep 1
	run bash "$SUT_COPY"
	[ "$status" -eq 0 ]
	[[ "$output" == *"re-run skipped"* ]]
	# Still 1 archive, manifest unchanged (year-agnostic row match).
	count=$(find "$ARCHIVE_ROOT" -name "*.age" | wc -l)
	[ "$count" -eq 1 ]
	rows_after=$(grep -cE "^\| [0-9]{8}-" "$ARCHIVE_ROOT/MANIFEST.md" || true)
	[ "$rows_before" -eq "$rows_after" ]
	manifest_after=$(sha256sum "$ARCHIVE_ROOT/MANIFEST.md" | awk '{print $1}')
	[ "$manifest_before" = "$manifest_after" ]
}

@test "8c: pgrep returns running PID → script exits 1 with 'still running'" {
	# Override pgrep to report a running process.
	mkstub pgrep 'echo 12345; exit 0'
	run bash "$SUT_COPY"
	[ "$status" -eq 1 ]
	[[ "$output" == *"still running"* ]]
}

@test "9: ephemeral keypair real-age round-trip (recipient correctness)" {
	# Remove stubs FIRST so command -v resolves to the real binary (or nothing).
	rm -f "$STUBS_DIR/age" "$STUBS_DIR/age-keygen"
	if ! command -v age > /dev/null || ! command -v age-keygen > /dev/null; then
		skip "real age/age-keygen not available on PATH"
	fi
	# Use the REAL age binaries (stubs already removed above).

	# Generate a real keypair.
	priv="$TMPDIR_TEST/test-priv.key"
	pub="$TMPDIR_TEST/test-pub.txt"
	age-keygen -o "$priv" 2> "$pub"
	chmod 0600 "$priv"
	REAL_PUBKEY=$(grep '# public key:' "$pub" | sed 's/^# public key: //' | tr -d '[:space:]')
	[[ -n "$REAL_PUBKEY" ]]
	# Install the real pubkey at the script's expected location.
	echo "$REAL_PUBKEY" > "$FAKE_PUBKEY"

	# Run with the real age binary in the loop (stub tar still produces our
	# sentinel content, which is fine — age will encrypt whatever the file
	# contains).
	run bash "$SUT_COPY"
	[ "$status" -eq 0 ]
	enc=$(find "$ARCHIVE_ROOT" -name "*.age" | head -1)
	[[ -n "$enc" ]]
	# Real decryption with the matching private key MUST succeed.
	decrypted="$TMPDIR_TEST/decrypted.bin"
	age -d -i "$priv" "$enc" > "$decrypted"
	[[ -s "$decrypted" ]]
	# Decrypted content matches what our tar stub wrote ("fake-tarball-content").
	grep -q "fake-tarball-content" "$decrypted"
	# Cleanup
	shred -u "$priv" "$pub" "$decrypted" 2>/dev/null || rm -f "$priv" "$pub" "$decrypted"
}

@test "11: age encrypt fails → script exits non-zero and plaintext tarball not left on disk" {
	# Override the age stub to exit 1 on the encrypt path (no -d flag).
	# This exercises the EXIT trap added for I1: the plaintext tarball must be
	# shredded even when age itself fails before the shred -u line is reached.
	cat > "$STUBS_DIR/age" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TMPDIR_TEST/logs/age.log"
for a in "$@"; do
	if [[ "$a" == "-d" ]]; then
		echo "age: error decrypting: no identity matched any of the recipients" >&2
		exit 1
	fi
done
# Encrypt path: simulate failure (e.g., pubkey parse error).
echo "age: error encrypting: recipient error" >&2
exit 1
EOF
	chmod +x "$STUBS_DIR/age"
	run bash "$SUT_COPY"
	# Script must exit non-zero.
	[ "$status" -ne 0 ]
	# No plaintext .tar.gz should remain in ARCHIVE_ROOT (EXIT trap shredded it).
	raw_count=$(find "$ARCHIVE_ROOT" -name "*.tar.gz" | wc -l)
	[ "$raw_count" -eq 0 ]
}

@test "10: jq missing → exits 1 with apt install hint" {
	# Shadow real jq with a non-executable stub-named file is awkward — easier:
	# clobber PATH to only contain stubs minus jq (and we never installed a jq
	# stub).
	# Need age + the rest of stubs; remove access to real jq by setting PATH
	# to just $STUBS_DIR.
	PATH="$STUBS_DIR" run bash "$SUT_COPY"
	# When PATH is only stubs, `command -v jq` fails (we don't ship a jq stub).
	[ "$status" -eq 1 ]
	[[ "$output" == *"jq required"* ]]
}
