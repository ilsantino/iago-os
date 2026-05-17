---
phase: feature-phase-2-vps-bootstrap
plan: 02
wave: 1
depends_on: []
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-2-vps-bootstrap/02-openclaw-teardown-scripts

## Goal

Ship the teardown scripts that retire OpenClaw cleanly at cutover-time: (1) `archive-openclaw.sh` — runs on the VPS as root, stops + disables `openclaw-gateway.service` (user systemd unit, requires `su - ilsantino`), tars `~/.openclaw/`, encrypts with `age -R /etc/iago-os/santiago-age.pub`, records SHA256 manifest, installs systemd timer for 30-day retention pruning (NOT cron — VPS has no crontab per Phase 0 audit); (2) `revoke-whatsapp.sh` — thin wrapper around the Meta Graph API curl sequence from spec § 7 (DELETE `/<WABA_ID>/subscribed_apps`, DELETE `/me/permissions`, debug_token probe), accepts IDs as env vars or args, NEVER stores Meta credentials; (3) `rotate-telegram-bot.sh` — partially-scripted documentation of the BotFather `/revoke` flow (the BotFather UI step is manual; this script handles the post-rotation `provision-credentials.sh telegram-token` invocation + verifies the old token is dead via Telegram getMe API). Plus a manifest template and bats-core tests for archive integrity (stub age + tar + systemctl). Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` §§ 3, 4, 7.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/deploy/archive-openclaw.sh` | VPS-side: stop + tar + age-encrypt OpenClaw + install retention timer |
| create | `runtime/deploy/archive-openclaw.test.sh` | bats-core tests with systemctl + tar + age stubbed |
| create | `runtime/deploy/revoke-whatsapp.sh` | Meta Graph API curl wrapper (WABA subscribed_apps + permissions DELETE) |
| create | `runtime/deploy/rotate-telegram-bot.sh` | Post-BotFather-rotation script: provision new token + verify old is dead |
| create | `runtime/migration/02-whatsapp-deauth.md` | Human-readable WhatsApp deauth runbook (copy of spec § 7) |
| create | `runtime/migration/02-telegram-bot-rotation.md` | Human-readable Telegram rotation runbook (copy of spec § 3) |
| create | `runtime/deploy/MANIFEST.template.md` | Manifest header template that archive-openclaw.sh appends rows to |

## Tasks

### Task 1: Author archive-openclaw.sh

- **files:** `runtime/deploy/archive-openclaw.sh`
- **action:** Write the bash script verbatim from spec § 4 "Exact script content". Shebang `#!/usr/bin/env bash`, `set -euo pipefail`, header comments naming purpose + idempotency + encryption rationale + retention rationale. Constants: `OPENCLAW_USER="ilsantino"`, `OPENCLAW_HOME="/home/ilsantino"`, `OPENCLAW_DIR="${OPENCLAW_HOME}/.openclaw"`, `ARCHIVE_ROOT="/var/lib/iago-os/openclaw-archive"`, `MANIFEST="${ARCHIVE_ROOT}/MANIFEST.md"`, `PUBKEY="/etc/iago-os/santiago-age.pub"`, `SERVICE="openclaw-gateway.service"`. Pre-flight: must run as root (check `id -u`); `age` installed (`command -v age`); pubkey exists (`-f $PUBKEY`); `OPENCLAW_DIR` exists (if not, exit 0 with "nothing to archive" — idempotent). 6 numbered steps with `echo "[N/6] ..."` headers: (1) `su - ilsantino -c "systemctl --user is-active SERVICE"` → stop if active, else "already stopped"; (2) `is-enabled` → disable if so, else "already disabled"; belt-and-braces `pgrep -u ilsantino -f openclaw-gateway` must return empty else exit 1; (3) create tarball with `TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)`, `TARBALL_NAME="openclaw-pre-cutover-${TIMESTAMP}.tar.gz"`, `tar -czf $TARBALL_PATH --warning=no-file-changed -C / home/ilsantino/.openclaw`, capture raw size + sha256; (4) encrypt with `age -R $PUBKEY -o $ENCRYPTED_PATH $TARBALL_PATH`; capture encrypted size + sha256; `shred -u $TARBALL_PATH` (raw tarball MUST NOT persist — contains plaintext credentials); chmod 0600 + chown root:root on encrypted; (5) append manifest row with all 6 columns (timestamp, file, raw size, raw sha, enc size, enc sha) — create manifest with header table if absent; (6) install retention timer + service at `/etc/systemd/system/iago-archive-prune.{service,timer}` if absent (oneshot service runs `find $ARCHIVE_ROOT -name '*.age' -mtime +30 -delete`; timer `OnCalendar=daily Persistent=true`; `systemctl daemon-reload && systemctl enable --now iago-archive-prune.timer`). Final summary echo block with file path + sizes + SHA + retention notice + manifest path. Verbatim from spec § 4.
- **verify:** `bash -n runtime/deploy/archive-openclaw.sh && shellcheck runtime/deploy/archive-openclaw.sh && grep -c "^# \|^echo \"\\[" runtime/deploy/archive-openclaw.sh`
- **expected:** `bash -n` exit 0. `shellcheck` exit 0 (inline `# shellcheck disable=` only for justified cases). Numbered-step echo count ≥6; total comment-or-step lines ≥30.

### Task 2: bats-core tests for archive-openclaw.sh

- **files:** `runtime/deploy/archive-openclaw.test.sh`
- **action:** Bats test file. Setup: temp dir with stubs for `id` (returns "0"), `command` (returns success for age path), `su` (records invocations to a log, succeeds with empty stdout), `pgrep` (returns empty/success), `tar` (creates a sentinel file at the target path), `age` (creates a sentinel file at `-o` target), `shred` (deletes the file at last arg), `systemctl` (records invocations, returns success), `find` (no-op for the prune-test). Tests: (1) not-root → exits 1 with "must run as root"; (2) age missing → exits 1 with "'age' not installed"; (3) pubkey missing → exits 1 with helpful scp hint; (4) OpenClaw dir absent → exits 0 with "nothing to archive" message; (5) happy path → all 6 steps execute in order (assert via `su` + `tar` + `age` + `shred` + `systemctl` log files); raw tarball file does NOT exist after script completes (shred ran); manifest file has the new row appended with correct column count (6); (6) retention timer already installed → step 6 says "already installed" instead of writing; (7) idempotent re-run (OpenClaw already stopped, archive dir already exists) → exits 0; new tarball with different timestamp appears; manifest has 2 rows; (8) `pgrep` returns running PID → script exits 1 with "still running" message. File 150-250 lines.
- **verify:** `which bats || echo "bats absent — install per runtime/deploy/README.md" ; bats runtime/deploy/archive-openclaw.test.sh 2>&1 | tail -25`
- **expected:** All 8 tests pass when bats available. Per Plan 01 I1: bats run is documented-but-not-pipeline-gated on Windows.

### Task 3: Author revoke-whatsapp.sh

- **files:** `runtime/deploy/revoke-whatsapp.sh`
- **action:** Bash wrapper around spec § 7 Meta Graph API sequence. Shebang + `set -euo pipefail`. Required env vars (fail loudly if missing): `WABA_ID`, `APP_ID`, `APP_SECRET`, `SYSTEM_USER_TOKEN`. Optional `PHONE_NUMBER_ID` (only used in verification echo). Header comments naming purpose + Meta credentials provenance (1Password vault `iago-os` item `whatsapp-app-credentials` per OQ5) + non-idempotent warning (running twice on an already-revoked token will fail at step 2 — that's the intended verification signal). Steps: (1) confirm OpenClaw is stopped (assertion only — spec § 7 dependency on archive-openclaw.sh having run first; check via `su - ilsantino -c "systemctl --user is-active openclaw-gateway.service" || true` — pass if "inactive" or "failed"; refuse to continue if "active"); (2) `curl -X DELETE "https://graph.facebook.com/v21.0/${WABA_ID}/subscribed_apps" -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"` — capture response, assert `success` field is `true` (use `jq` to parse); (3) `curl -X GET .../subscribed_apps` to verify empty (or only contains other unrelated apps), echo the JSON for the operator to review; (4) `curl -X DELETE .../me/permissions` — assert `success: true`; (5) `curl "https://graph.facebook.com/v21.0/debug_token?input_token=${SYSTEM_USER_TOKEN}&access_token=${APP_ID}|${APP_SECRET}"` — parse `data.is_valid`, MUST be `false`; (6) `curl "https://graph.facebook.com/v21.0/me" -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"` — MUST return HTTP 400 or 401 (use `curl -w "%{http_code}" -o /dev/null -s`). Each step echos `[N/6]` + intent + verify result. Final echo: "WhatsApp deauth complete. Manual step required: open Meta Business Suite → Business Settings → Users → System Users → remove/disable the system user. Manual step is NOT scripted; document the click in PR description." Script writes one NDJSON line per step to `/var/log/iago-os/cutover.ndjson` if writable (spec § 10 criterion 5). Treat any non-success response as fatal except in the `is-active` check at step 1 (which is informational).
- **verify:** `bash -n runtime/deploy/revoke-whatsapp.sh && shellcheck runtime/deploy/revoke-whatsapp.sh && grep -c "^# \|^echo \"\\[" runtime/deploy/revoke-whatsapp.sh`
- **expected:** `bash -n` exit 0. `shellcheck` exit 0. Step-or-comment count ≥20.

### Task 4: Author rotate-telegram-bot.sh

- **files:** `runtime/deploy/rotate-telegram-bot.sh`
- **action:** Bash script that wraps the SCRIPTABLE part of spec § 3 (the BotFather UI rotation is manual; this script handles before + after). Shebang + `set -euo pipefail`. Header explains: BotFather `/revoke` step is manual (no API). This script (a) records the OLD token's bot info BEFORE rotation so Santiago has a record, (b) PROMPTS the operator to run BotFather rotation now, (c) AFTER operator updates 1Password, runs `provision-credentials.sh telegram-token`, (d) verifies the OLD token is dead via `getMe` API, (e) verifies the NEW token works via `getMe` API. Required env var: `OLD_TOKEN` (the token before rotation, passed as env var; never echoed). Optional `PROVISION_SCRIPT="${PROVISION_SCRIPT:-$(dirname "$0")/provision-credentials.sh}"`. Steps: (1) `curl -s "https://api.telegram.org/bot${OLD_TOKEN}/getMe" | jq` → record bot username + ID, write to `/var/log/iago-os/telegram-rotation-pre.json`; if call fails → exit 1 with "old token already dead — was rotation done previously?"; (2) print instructions: "MANUAL STEP — open Telegram, go to @BotFather, /mybots, select your bot, API Token, Revoke current token. Copy new token. Open 1Password app, edit item v2-daemon-telegram-bot, paste new token into 'token' field, save. Press Enter to continue."; `read -r` (interactive); (3) confirm 1Password has fresh value by reading it (`op read 'op://iago-os/v2-daemon-telegram-bot/token'` — if same as `OLD_TOKEN`, abort with "1Password not updated; rotation aborted"); (4) run `"$PROVISION_SCRIPT" telegram-token`; (5) `curl -s "https://api.telegram.org/bot${OLD_TOKEN}/getMe"` — MUST return 401 (or `ok:false`). If still returns 200, ERROR: "old token still valid — revocation may not have propagated yet; wait 60s and re-run verify"; (6) read new token via `op read`, run getMe → MUST return 200 with same bot username as recorded at step 1 (asserts SAME bot, just rotated key). Output: "Telegram bot rotation complete. Bot username preserved: <handle>." Write each step result to `/var/log/iago-os/cutover.ndjson` if writable.
- **verify:** `bash -n runtime/deploy/rotate-telegram-bot.sh && shellcheck runtime/deploy/rotate-telegram-bot.sh && grep -c "^# \|^echo \"\\[" runtime/deploy/rotate-telegram-bot.sh`
- **expected:** `bash -n` exit 0. `shellcheck` exit 0. Step-or-comment count ≥18.

### Task 5: Author 02-whatsapp-deauth.md runbook

- **files:** `runtime/migration/02-whatsapp-deauth.md`
- **action:** Human-readable runbook copying spec § 7 + the click-path-to-find-Meta-IDs + the manual system-user removal step. Sections: (1) When to run — "At T+30 of cutover runbook (Plan 03) after Telegram + v2 daemon confirmed working"; (2) Why this matters — "Stops Meta from retrying webhooks at OpenClaw's dead endpoint indefinitely; revokes long-lived access token so leak ≠ message-send compromise"; (3) Inputs — table of 4 IDs (PHONE_NUMBER_ID, WABA_ID, APP_ID, APP_SECRET, SYSTEM_USER_TOKEN) + where to find each in Meta Business Suite; (4) Procedure — verbatim copy of spec § 7 curl block with the rationale-comment lines preserved; if invoking via `runtime/deploy/revoke-whatsapp.sh`, instructions for `export` of env vars BEFORE invoking; (5) Verification — copy of spec § 7 step 6 + 7; (6) Manual UI step — "Open Meta Business Suite → Business Settings → Users → System Users → click the system user OpenClaw used → Remove/disable. This step is NOT scripted; document the click in PR description with a screenshot."; (7) Rollback — "WhatsApp deauth is NOT undone in a Phase 2 rollback. If cutover is rolled back at T+R+5 (Plan 03), OpenClaw restart will fail to send WhatsApp (token dead, webhook unsubscribed). This is acceptable per spec § 8 T+30: WhatsApp deauth is a security-debt operation, not a rollback trigger. To fully restore WhatsApp would require re-creating a system user and re-subscribing webhook — 30+ min manual work. Cost of leaving WhatsApp deauthed during rollback: WhatsApp inbound stops working, Telegram still works on OpenClaw. Net: acceptable for the rare rollback path." (8) Failure modes table. File 100-180 lines.
- **verify:** `wc -l runtime/migration/02-whatsapp-deauth.md && grep -c "^## " runtime/migration/02-whatsapp-deauth.md && grep -c "curl" runtime/migration/02-whatsapp-deauth.md`
- **expected:** Line count 100-180. ≥7 top-level sections. ≥4 curl references (4 distinct Graph API calls).

### Task 6: Author 02-telegram-bot-rotation.md runbook

- **files:** `runtime/migration/02-telegram-bot-rotation.md`
- **action:** Human-readable runbook copying spec § 3. Sections: (1) When to run — "At T+02 of cutover runbook (Plan 03), AFTER OpenClaw stopped + archived"; (2) Why Option A — verbatim copy of spec § 3 Option A/B/C verdict table; (3) Procedure — verbatim copy of the T-0:00 to T+3:00 atomic sequence from spec § 3 with timestamps; (4) Allowed user IDs — explain single integer (NOT chat ID); how Santiago obtains his user ID via @userinfobot; how it lands in systemd unit's `Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=`; (5) Pre-cutover test plan — verbatim copy of spec § 3 pre-cutover test plan (throwaway test bot via BotFather `/newbot`, validate locally, delete via `/deletebot`); (6) Verification — invoke `rotate-telegram-bot.sh` (Task 4) handles automated parts; manual verification = send `/agents` from phone, expect bot reply; (7) Rollback — if cutover is rolled back, the BotFather-revoked OLD token cannot be un-revoked. Rollback requires another `/revoke` to get a FRESH token, then patching `~/.openclaw/openclaw.json` (per spec § 9 rollback step T+R+1:30 jq snippet). This is the most variable step in the rollback timeline; spec § 9 reports it as ~1:00; ensure Santiago has BotFather UI open before triggering rollback to compress this further. File 100-180 lines.
- **verify:** `wc -l runtime/migration/02-telegram-bot-rotation.md && grep -c "^## " runtime/migration/02-telegram-bot-rotation.md && grep -c "BotFather\|/revoke\|getMe" runtime/migration/02-telegram-bot-rotation.md`
- **expected:** Line count 100-180. ≥6 sections. ≥6 BotFather/revoke/getMe references.

### Task 7: Author MANIFEST.template.md + verification

- **files:** `runtime/deploy/MANIFEST.template.md`
- **action:** Header template that `archive-openclaw.sh` step 5 writes if the manifest file doesn't already exist. Content (markdown): "# OpenClaw Archive Manifest" + paragraph: "Archives created by `runtime/deploy/archive-openclaw.sh`. Encrypted to Santiago's age pubkey at /etc/iago-os/santiago-age.pub. Retention: 30 days from creation. Deletion by `iago-archive-prune.timer` (systemd timer; lives at `/etc/systemd/system/iago-archive-prune.timer` on VPS)." + a decryption recipe code block (`scp`, `age -d`, `tar -xzf`) + the table header row "`| Timestamp (UTC) | File | Raw size | Raw SHA256 | Encrypted size | Encrypted SHA256 |`" + separator row. This template is duplicated inline inside `archive-openclaw.sh` (Task 1 step 5) for the case where the manifest is auto-created; the file in `runtime/deploy/` serves as the human-readable source of truth + lint target. Add a note: "If you edit this template, also update the heredoc inside archive-openclaw.sh OR refactor archive-openclaw.sh to `cat` this file (preferred for DRY but requires the script to know its install path on the VPS, which it doesn't — keep duplicated for now)." File 30-60 lines.
- **verify:** `wc -l runtime/deploy/MANIFEST.template.md && grep -c "^| " runtime/deploy/MANIFEST.template.md && diff <(sed -n '/cat > "\$MANIFEST" <</,/^EOF$/p' runtime/deploy/archive-openclaw.sh | sed '1d;$d') <(sed -n '/^# OpenClaw Archive Manifest/,/^|---/p' runtime/deploy/MANIFEST.template.md) || echo "(manifest template and script heredoc may diverge; intentional — see template note)"`
- **expected:** Line count 30-60. Two table rows (header + separator). Diff command outputs lines either matching (DRY) or with explicit acknowledgment of intentional divergence per the inline note.

## Verification

```bash
for s in archive-openclaw.sh revoke-whatsapp.sh rotate-telegram-bot.sh; do
  bash -n "runtime/deploy/$s" && shellcheck "runtime/deploy/$s" || { echo "FAIL: $s"; exit 1; }
done
wc -l runtime/migration/02-whatsapp-deauth.md runtime/migration/02-telegram-bot-rotation.md runtime/deploy/MANIFEST.template.md
which bats && bats runtime/deploy/archive-openclaw.test.sh || echo "(bats absent; tests skipped per README I1)"
```

Expected:
- All 3 deploy scripts pass `bash -n` + `shellcheck`
- Both runbooks 100-180 lines
- MANIFEST.template.md 30-60 lines
- If bats present, all 8 archive tests pass

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline

### Critical (must fix in impl)

- **C1 — `revoke-whatsapp.sh` requires `jq` on VPS.** Phase 0 audit confirms `jq` present. But Task 3 doesn't add a pre-flight check. **Fix:** Add `command -v jq > /dev/null || { echo "ERROR: jq required for response parsing. apt install jq" >&2; exit 1; }` at the top of revoke-whatsapp.sh. Same for `archive-openclaw.sh` if it parses any JSON (it doesn't currently — but the manifest writer uses `sha256sum`, also confirm present).
- **C2 — `rotate-telegram-bot.sh` interactive `read -r` blocks pipeline runs.** The pipeline implementer session is non-interactive (`claude -p`). If the pipeline tries to run `rotate-telegram-bot.sh` directly as a verify step, it hangs. **Fix:** Task 4 verify must be `bash -n` + `shellcheck` ONLY (already is). Add explicit comment to script: `# WARNING: this script is INTERACTIVE; do not invoke from pipeline/CI. Operator runs at cutover-time per runbook.` Also: add an env override `IAGO_ROTATE_NONINTERACTIVE=1` that auto-skips the `read -r` (used only for the dry-run test harness in Plan 03 — script just verifies pre-rotation state and exits before the prompt).
- **C3 — Archive script does NOT verify the encrypted tarball actually decrypts.** Step 4 encrypts; nothing tests that `age -d` round-trips. If Santiago's pubkey is corrupted or wrong, the archive is permanently unrecoverable AND the script reports success. **Fix:** Add step 4b: `age -d -i /tmp/test-age-key $ENCRYPTED_PATH > /dev/null 2>&1 || true` — this WILL fail because we only have the pubkey on the VPS, not the private key. Better fix: extract the first 100 bytes of the encrypted file + verify the age header magic (`age-encryption.org/v1` ASCII header at byte 0). Add a simple check: `head -c 21 $ENCRYPTED_PATH | grep -q "^age-encryption.org/v1" || { echo "ERROR: encrypted file lacks age header — encryption may have silently failed" >&2; exit 1; }`. Catches the obvious failure mode without requiring private key on VPS.

### Important (forward to impl, don't block)

- **I1 — Spec § 4 says `--warning=no-file-changed` on `tar`.** Confirms that tar may emit warnings for files OpenClaw was writing during the brief stop-to-tar window. `--warning=no-file-changed` suppresses ONLY that specific warning. Other tar warnings (broken symlink, etc.) still surface. Document in Task 1 action paragraph: "If OpenClaw produced a broken symlink during its lifetime, tar will exit non-zero. Catch this case: wrap tar in `set +e; tar ...; rc=$?; set -e; [[ $rc -eq 0 || $rc -eq 1 ]] || exit $rc` — tar exit code 1 means warnings only, 2+ means errors."
- **I2 — `provision-credentials.sh` is referenced from `rotate-telegram-bot.sh` but lives in Plan 01.** Cross-plan dependency. The PROVISION_SCRIPT env var default (`$(dirname "$0")/provision-credentials.sh`) assumes both scripts ship in `runtime/deploy/`. Plan 01 + Plan 02 must agree on this. Confirmed: both write to `runtime/deploy/`. No conflict.
- **I3 — Manifest write race.** If two operators run `archive-openclaw.sh` simultaneously (e.g., Santiago + Sebas during a debug session), step 5 manifest append is not atomic — last writer wins, may corrupt rows. **Fix:** Wrap manifest append in `flock`: `(flock -w 5 200 || exit 1; printf '...' >> "$MANIFEST") 200>"$MANIFEST.lock"`. The wall-clock cost is microseconds; the safety win is real.
- **I4 — Retention timer pruning is silent.** Step 6 installs the timer but produces no notification when archives are pruned. Add to the service: `ExecStart=/bin/sh -c 'count=$(find ${ARCHIVE_ROOT} -name "*.age" -mtime +30 | wc -l); find ${ARCHIVE_ROOT} -name "*.age" -mtime +30 -delete; logger -t iago-archive-prune "pruned $count archives"'` — logger writes to journal. Santiago/Sebas can `journalctl -t iago-archive-prune` to audit. Cheap observability.

### Minor

- M1 — Spec § 4 mentions `journalctl -u iago-archive-prune.timer` as a debug surface; redundant with I4.
- M2 — `rotate-telegram-bot.sh` step 5 may need more than 60s wait — Telegram's BotFather revocation usually propagates in seconds but is documented as "up to 5 minutes" in some forum posts. Add a retry loop: 5 attempts × 30s = 2.5 min max wait before declaring failure.

### Dimension-by-dimension verdicts

- **Precision:** Every shell script has line-count + shellcheck verification + a behavioral test (bats for archive, manual-runbook + interactive-disclaimer for rotate, env-var-validation for revoke).
- **Edge cases:** C1 + C2 + C3 cover the worst non-obvious failures. I1 + I3 cover concurrency and partial-failure modes.
- **Contradictions:** Spec § 4 + spec § 8 cutover runbook both reference `archive-openclaw.sh`; Plan 02 owns the script; Plan 03 invokes it. No contradiction. Spec § 7 + Plan 02 Task 3 + Plan 02 Task 5 all describe the SAME 6 curls — agreement enforced by verbatim copy.
- **Simpler alternatives:** Could skip age encryption ("VPS is private"). REJECTED per Garry standard. Could use rsync to a remote backup instead of local age. REJECTED — adds dependency on a backup target Santiago doesn't have. age + local-disk + 30-day retention is the floor.
- **Missing acceptance criteria:** Spec § 10 criterion 5 (telemetry NDJSON per step) — covered via the `/var/log/iago-os/cutover.ndjson` write in Tasks 3 + 4. Add the same to Task 1 archive-openclaw.sh: each numbered step writes one JSON line.

### Implementer forward-list

1. Add `jq` + `sha256sum` pre-flight to revoke-whatsapp.sh + archive-openclaw.sh (C1 fix).
2. Add `IAGO_ROTATE_NONINTERACTIVE=1` skip path + warning comment to rotate-telegram-bot.sh (C2 fix).
3. Add age-header magic-byte check after step 4 encryption in archive-openclaw.sh (C3 fix).
4. Wrap tar invocation with rc-aware error handling (I1 fix).
5. Wrap manifest append with `flock` (I3 fix).
6. Extend retention timer ExecStart with `logger -t iago-archive-prune` (I4 fix).
7. Add per-step NDJSON write to `/var/log/iago-os/cutover.ndjson` in all 3 scripts (acceptance criterion 5 closure).
8. Add 5-retry × 30s wait loop to step 5 of rotate-telegram-bot.sh (M2 fix).
