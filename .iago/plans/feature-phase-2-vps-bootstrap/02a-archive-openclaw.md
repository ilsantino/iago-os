---
phase: feature-phase-2-vps-bootstrap
plan: 02a
wave: 1
depends_on: []
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 02-openclaw-teardown-scripts
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 02a ships the OpenClaw archive script + bats tests + manifest template (Tasks 1, 2, 7 of original 02) — the heaviest piece by far. 02b ships the WhatsApp + Telegram scripts and human-readable runbooks (Tasks 3, 4, 5, 6).
---

# Plan: feature-phase-2-vps-bootstrap/02a-archive-openclaw

## Goal

Ship the OpenClaw archive system that retires the existing user-systemd OpenClaw deployment cleanly at cutover-time: stops + disables `openclaw-gateway.service` (user systemd unit, requires `su - ilsantino`), tars `~ilsantino/.openclaw/`, encrypts with `age -R /etc/iago-os/santiago-age.pub`, records SHA256 manifest, installs systemd timer for 30-day retention pruning (NOT cron — VPS has no crontab per Phase 0 audit). Three deliverables: (1) `archive-openclaw.sh` — VPS-side root script with full idempotency (same UTC date → same final state) and a real ephemeral-keypair round-trip test against a wrong-but-valid pubkey detection probe; (2) `archive-openclaw.test.sh` — bats-core tests with systemctl + tar + age stubbed PLUS one optional test that uses the real `age` binary against an ephemeral keypair to prove recipient correctness; (3) `MANIFEST.template.md` — header template appended by the script when manifest is auto-created. Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 4. The remaining teardown scripts (WhatsApp deauth, Telegram bot rotation) and human-readable runbooks ship in 02b.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/deploy/archive-openclaw.sh` | VPS-side: stop + tar + age-encrypt OpenClaw + install retention timer |
| create | `runtime/deploy/archive-openclaw.test.sh` | bats-core tests with systemctl + tar + age stubbed (+ optional real-age round-trip test) |
| create | `runtime/deploy/MANIFEST.template.md` | Manifest header template that archive-openclaw.sh appends rows to |

## Tasks

### Task 1: Author archive-openclaw.sh

- **files:** `runtime/deploy/archive-openclaw.sh`
- **action:** Write the bash script verbatim from spec § 4 "Exact script content". Shebang `#!/usr/bin/env bash`, `set -euo pipefail`, header comments naming purpose + idempotency + encryption rationale + retention rationale + **OpenClaw mid-task semantics: SIGTERM to user systemd unit (`systemctl --user stop openclaw-gateway.service`) interrupts in-flight Claude session — acceptable per FAST cutover (rollback restores the session from `~/.openclaw/sessions/` which is captured inside the encrypted tarball). Operator should run this script ONLY at the agreed cutover window when Santiago is at keyboard and acknowledges any in-flight OpenClaw work will be lost.** Constants: `OPENCLAW_USER="ilsantino"`, `OPENCLAW_HOME="/home/ilsantino"`, `OPENCLAW_DIR="${OPENCLAW_HOME}/.openclaw"`, `ARCHIVE_ROOT="/var/lib/iago-os/openclaw-archive"`, `MANIFEST="${ARCHIVE_ROOT}/MANIFEST.md"`, `PUBKEY="/etc/iago-os/santiago-age.pub"`, `SERVICE="openclaw-gateway.service"`. Pre-flight: must run as root (check `id -u`); `age` installed (`command -v age`); `jq` + `sha256sum` available (C1 carry-over — add explicit pre-flight `command -v jq > /dev/null || { echo "ERROR: jq required for response parsing. apt install jq" >&2; exit 1; }` and same for sha256sum, though both are part of base Debian — defensive guard); pubkey exists (`-f $PUBKEY`); `OPENCLAW_DIR` exists (if not, exit 0 with "nothing to archive" — idempotent). **Idempotency contract (Codex P1-3 fix):** same UTC date → same archive (same final state). Default behavior: as the FIRST in-script check (BEFORE step 1), `EXISTING_TODAY=$(find "$ARCHIVE_ROOT" -name "openclaw-pre-cutover-$(date -u +%Y%m%d)-*.age" 2>/dev/null | head -1)`; if `EXISTING_TODAY` is non-empty AND `--force-new-archive` was NOT passed on argv → echo "archive for today already exists at $EXISTING_TODAY — re-run skipped (use --force-new-archive to override)" and `exit 0`. With `--force-new-archive` flag (parsed via simple argv scan: `for arg in "$@"; do [[ "$arg" == "--force-new-archive" ]] && FORCE=1; done`): proceed to create new archive (HHMMSS portion of the existing TIMESTAMP keeps the second archive distinguishable; manifest row appended as a second row for the same date). This makes "idempotent" precisely defined: same calendar date → same final state (one archive, one manifest row); operator can explicitly request a second snapshot via the flag. 6 numbered steps with `echo "[N/6] ..."` headers: (1) `su - ilsantino -c "systemctl --user is-active SERVICE"` → stop if active, else "already stopped"; (2) `is-enabled` → disable if so, else "already disabled"; belt-and-braces `pgrep -u ilsantino -f openclaw-gateway` must return empty else exit 1; (3) create tarball with `TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)`, `TARBALL_NAME="openclaw-pre-cutover-${TIMESTAMP}.tar.gz"`, wrap the tar invocation with rc-aware error handling (I1 carry-over — tar exit 1 = warnings only, 2+ = errors): `set +e; tar -czf $TARBALL_PATH --warning=no-file-changed -C / home/ilsantino/.openclaw; rc=$?; set -e; [[ $rc -eq 0 || $rc -eq 1 ]] || exit $rc`; capture raw size + sha256; (4) encrypt with `age -R $PUBKEY -o $ENCRYPTED_PATH $TARBALL_PATH`; capture encrypted size + sha256; `shred -u $TARBALL_PATH` (raw tarball MUST NOT persist — contains plaintext credentials); chmod 0600 + chown root:root on encrypted. **(4a) Magic-byte header check** (C3 carry-over): `head -c 21 "$ENCRYPTED_PATH" | grep -q '^age-encryption.org/v1' || { echo "ERROR: encrypted file lacks age header — encryption may have silently failed" >&2; exit 1; }`. **(4b) Decrypt-with-bogus-identity probe** (pre-merge adversarial review I7 fix — catches wrong-but-valid pubkey corruption): `printf "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ7" > /tmp/bogus-age.key; chmod 0600 /tmp/bogus-age.key; if age -d -i /tmp/bogus-age.key "$ENCRYPTED_PATH" 2>&1 | grep -q "no identity matched"; then echo "✓ encrypted with correct pubkey (bogus identity correctly rejected with 'no identity matched' error)"; else echo "ERROR: age decryption with bogus identity returned unexpected response — pubkey may be wrong-but-valid; encrypted archive may be unrecoverable" >&2; shred -u /tmp/bogus-age.key; exit 1; fi; shred -u /tmp/bogus-age.key`. Rationale: a wrong-but-valid pubkey produces age-encryption.org/v1-formatted output that still passes step 4a but is permanently unrecoverable with Santiago's actual private key. The probe expects the bogus identity to fail with the SPECIFIC "no identity matched" error; any other response (silent success, different error wording, hang) indicates the pubkey isn't behaving like a real age recipient. Cheap; closes the silent-failure window. (5) append manifest row with all 6 columns (timestamp, file, raw size, raw sha, enc size, enc sha) — wrap append in `flock` (I3 carry-over): `(flock -w 5 200 || exit 1; printf '...' >> "$MANIFEST") 200>"$MANIFEST.lock"`; create manifest with header table if absent; (6) install retention timer + service at `/etc/systemd/system/iago-archive-prune.{service,timer}` if absent (oneshot service runs `find ${ARCHIVE_ROOT} -name '*.age' -mtime +30 -delete` plus `logger -t iago-archive-prune "pruned $count archives"` per I4 carry-over; timer `OnCalendar=daily Persistent=true`; `systemctl daemon-reload && systemctl enable --now iago-archive-prune.timer`). Each numbered step writes one NDJSON line to `/var/log/iago-os/cutover.ndjson` (spec § 10 criterion 5 closure). Final summary echo block with file path + sizes + SHA + retention notice + manifest path.
- **verify:** `bash -n runtime/deploy/archive-openclaw.sh && shellcheck runtime/deploy/archive-openclaw.sh && grep -c "^# \|^echo \"\\[" runtime/deploy/archive-openclaw.sh && grep -E 'command -v jq' runtime/deploy/archive-openclaw.sh && grep -E 'flock' runtime/deploy/archive-openclaw.sh && grep -E 'logger -t iago-archive-prune' runtime/deploy/archive-openclaw.sh`
- **expected:** `bash -n` exit 0. `shellcheck` exit 0 (inline `# shellcheck disable=` only for justified cases). Numbered-step echo count ≥6; total comment-or-step lines ≥30. All four guards present (jq pre-flight, flock manifest, logger in prune service, magic-byte header check from line above).

### Task 2: bats-core tests for archive-openclaw.sh

- **files:** `runtime/deploy/archive-openclaw.test.sh`
- **action:** Bats test file. Setup: temp dir with stubs for `id` (returns "0"), `command` (returns success for age path), `su` (records invocations to a log, succeeds with empty stdout), `pgrep` (returns empty/success), `tar` (creates a sentinel file at the target path), `age` (creates a sentinel file at `-o` target), `shred` (deletes the file at last arg), `systemctl` (records invocations, returns success), `find` (no-op for the prune-test). Tests: (1) not-root → exits 1 with "must run as root"; (2) age missing → exits 1 with "'age' not installed"; (3) pubkey missing → exits 1 with helpful scp hint; (4) OpenClaw dir absent → exits 0 with "nothing to archive" message; (5) happy path → all 6 steps execute in order (assert via `su` + `tar` + `age` + `shred` + `systemctl` log files); raw tarball file does NOT exist after script completes (shred ran); manifest file has the new row appended with correct column count (6); (6) retention timer already installed → step 6 says "already installed" instead of writing; (7) idempotent re-run (OpenClaw already stopped, archive dir already exists) → exits 0; new tarball with different timestamp appears; manifest has 2 rows; (8) idempotent re-run (same UTC date) per Codex P1-3 fix → default behavior: exits 0 WITHOUT creating a second archive AND manifest is unchanged (the day-sentinel check at step 3 short-circuits); (8b) idempotent re-run with `--force-new-archive` flag → second archive created (HHMMSS-distinguished), second manifest row appended; (8c) `pgrep` returns running PID → script exits 1 with "still running" message; (9) **ephemeral keypair round-trip test (Codex P1-2 fix):** instead of stubbing `age`, run the REAL `age` binary (skip the test with a clear `skip` marker if `command -v age` returns non-zero). Setup: `age-keygen -o /tmp/test-priv.key 2>/tmp/test-pub.txt; PUBKEY=$(cat /tmp/test-pub.txt | grep '# public key:' | cut -d: -f2 | tr -d ' ')`; stub the script to use `$PUBKEY` as the `PUBKEY` constant instead of `/etc/iago-os/santiago-age.pub`; run the script against a fixture OpenClaw dir (a temp dir with 2-3 placeholder credential files like `~ilsantino/.openclaw/openclaw.json` containing `{"placeholder": "value"}`); capture the encrypted `.age` output path; run `age -d -i /tmp/test-priv.key $ENCRYPTED_PATH > /tmp/test-decrypted.tar.gz; tar -tzf /tmp/test-decrypted.tar.gz | head -5` — MUST succeed AND show original file names (e.g., the placeholder `openclaw.json`); cleanup keys (`shred -u /tmp/test-priv.key /tmp/test-pub.txt /tmp/test-decrypted.tar.gz`). This test proves the encryption recipient is correct (a wrong-but-valid pubkey would cause `age -d -i` to fail), not just that age outputs SOMETHING; fails fast on wrong-but-valid pubkey corruption (closes the gap left by the magic-byte header check + bogus-identity probe which only verify shape, not recipient correctness against a real private key). File 200-330 lines.
- **verify:** `which bats || echo "bats absent — install per runtime/deploy/README.md" ; bats runtime/deploy/archive-openclaw.test.sh 2>&1 | tail -25`
- **expected:** All 10 tests pass when bats available (including the ephemeral keypair round-trip — skipped only if `age` binary absent). Per Plan 01a I1 carry-over: bats run is documented-but-not-pipeline-gated on Windows.

### Task 3: Author MANIFEST.template.md

- **files:** `runtime/deploy/MANIFEST.template.md`
- **action:** Header template that `archive-openclaw.sh` step 5 writes if the manifest file doesn't already exist. Content (markdown): "# OpenClaw Archive Manifest" + paragraph: "Archives created by `runtime/deploy/archive-openclaw.sh`. Encrypted to Santiago's age pubkey at /etc/iago-os/santiago-age.pub. Retention: 30 days from creation. Deletion by `iago-archive-prune.timer` (systemd timer; lives at `/etc/systemd/system/iago-archive-prune.timer` on VPS)." + a decryption recipe code block (`scp`, `age -d`, `tar -xzf`) + the table header row "`| Timestamp (UTC) | File | Raw size | Raw SHA256 | Encrypted size | Encrypted SHA256 |`" + separator row. This template is duplicated inline inside `archive-openclaw.sh` (Task 1 step 5) for the case where the manifest is auto-created; the file in `runtime/deploy/` serves as the human-readable source of truth + lint target. Add a note: "If you edit this template, also update the heredoc inside archive-openclaw.sh OR refactor archive-openclaw.sh to `cat` this file (preferred for DRY but requires the script to know its install path on the VPS, which it doesn't — keep duplicated for now)." File 30-60 lines.
- **verify:** `wc -l runtime/deploy/MANIFEST.template.md && grep -c "^| " runtime/deploy/MANIFEST.template.md`
- **expected:** Line count 30-60. Two table rows (header + separator).

## Verification

```bash
bash -n runtime/deploy/archive-openclaw.sh \
  && shellcheck runtime/deploy/archive-openclaw.sh \
  && wc -l runtime/deploy/MANIFEST.template.md \
  && (which bats && bats runtime/deploy/archive-openclaw.test.sh || echo "(bats absent; tests skipped per deploy/README.md § 8)")
```

Expected:
- `archive-openclaw.sh` passes `bash -n` + `shellcheck`
- `MANIFEST.template.md` 30-60 lines
- If bats present, all 10 archive tests pass (including ephemeral-keypair test #9 unless `age` absent)

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 02 stress test, scoped to 02a tasks only)
**Date:** 2026-05-18 (pre-emptive split; original stress 2026-05-17)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — `archive-openclaw.sh` requires `jq` + `sha256sum`.** Phase 0 audit confirms `jq` + `sha256sum` present (base Debian). **Fix:** Add explicit pre-flight `command -v` check + helpful error message at top of script. Defensive guard — adds 4 lines, prevents a silent obscure failure if a future minimal VPS image lacks them.
- **C2 — Archive script verifies encryption SHAPE only (header magic-byte) without proving RECIPIENT correctness.** A wrong-but-valid pubkey produces correctly-shaped output that's permanently unrecoverable with Santiago's real private key. **Fix:** Two-part guard: (a) Task 1 step 4b bogus-identity probe ("no identity matched" expected); (b) Task 2 test 9 ephemeral-keypair round-trip with the REAL age binary against a real private key. Both together close the silent-failure window. Test 9 is the gold standard; the runtime probe is the in-script defence-in-depth.
- **C3 — Magic-byte header check alone is insufficient (closes silent failure).** Task 1 step 4a greps for `^age-encryption.org/v1` in the first 21 bytes. Catches "encryption silently failed and produced empty/random output" but NOT "encryption produced valid age output against the wrong recipient". 4b probe + Task 2 test 9 are the complete fix.

### Important (forward to impl, don't block)

- **I1 — Spec § 4 `--warning=no-file-changed` on `tar`.** Confirms that tar may emit warnings for files OpenClaw was writing during the brief stop-to-tar window. `--warning=no-file-changed` suppresses ONLY that specific warning. Other tar warnings (broken symlink, etc.) still surface. Task 1 wraps tar in `set +e; tar ...; rc=$?; set -e; [[ $rc -eq 0 || $rc -eq 1 ]] || exit $rc` — tar exit code 1 means warnings only, 2+ means errors.
- **I2 — Manifest write race.** If two operators run `archive-openclaw.sh` simultaneously (e.g., Santiago + Sebas during a debug session), step 5 manifest append is not atomic — last writer wins, may corrupt rows. **Fix:** Wrap manifest append in `flock`: `(flock -w 5 200 || exit 1; printf '...' >> "$MANIFEST") 200>"$MANIFEST.lock"`. The wall-clock cost is microseconds; the safety win is real. Task 1 includes this; verify command greps for `flock`.
- **I3 — Retention timer pruning is silent.** Step 6 installs the timer but produces no notification when archives are pruned. **Fix:** Service `ExecStart` includes `logger -t iago-archive-prune "pruned $count archives"` — logger writes to journal. Santiago/Sebas can `journalctl -t iago-archive-prune` to audit. Cheap observability. Task 1 includes this; verify command greps for `logger -t iago-archive-prune`.
- **I4 — NDJSON write to `/var/log/iago-os/cutover.ndjson`.** Spec § 10 criterion 5. Each numbered step writes one JSON line. Path must exist + be writable. Plan 03a cutover.sh pre-flight creates the dir + file with `0640 root` mode before invoking any of these scripts.

### Minor

- M1 — Spec § 4 mentions `journalctl -u iago-archive-prune.timer` as a debug surface; redundant with I3 telemetry.
- M2 — Decryption recipe in MANIFEST.template.md uses `scp ... && age -d -i ~/.age/santiago.key`. Santiago's private key path on Windows is `~/.age/santiago.key` per reference_iago_v2_vps memory; template documents this.

### Dimension-by-dimension verdicts (02a scope)

- **Precision:** Task 1 script has explicit grep verifications for jq, flock, logger, magic-byte. Task 2 enumerates 10 test cases. Task 3 has line-count + table-row count.
- **Edge cases:** C1 (jq missing) + C2 (wrong-but-valid pubkey) + C3 (silent encryption failure) covered by defense-in-depth.
- **Contradictions:** 02a archive script vs 02b's whatsapp/telegram scripts — clean split (different files, different concerns). Both write to `/var/log/iago-os/cutover.ndjson` per spec § 10 criterion 5 — no race because the cutover invokes them sequentially via 03a cutover.sh.
- **Simpler alternatives:** Could skip age encryption ("VPS is private"). REJECTED per Garry standard. Could use rsync to a remote backup instead of local age. REJECTED — adds dependency on a backup target Santiago doesn't have. Could skip the bogus-identity probe ("magic-byte check is enough"). REJECTED — wrong-but-valid pubkey is the silent-failure mode the probe catches.
- **Missing acceptance criteria:** Spec § 4 fully covered. Spec § 10 criterion 5 (per-step NDJSON) covered via cutover.ndjson append in each numbered step.

### Implementer forward-list

1. Add `jq` + `sha256sum` pre-flight check (C1 fix).
2. Bogus-identity probe at step 4b (C2 fix part 1).
3. Ephemeral keypair real-age round-trip test (Task 2 test 9, C2 fix part 2).
4. tar rc-aware wrapper (I1 fix).
5. `flock` wrapper on manifest append (I2 fix).
6. `logger -t iago-archive-prune` in prune service ExecStart (I3 fix).
7. Per-step NDJSON write to `/var/log/iago-os/cutover.ndjson` (acceptance criterion 5 closure).
