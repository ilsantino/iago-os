---
phase: feature-phase-2-vps-bootstrap
plan: 02b
wave: 1
depends_on: [01a, 02a]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 02-openclaw-teardown-scripts
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 02b ships the WhatsApp + Telegram bot rotation scripts and the human-readable cutover-time runbooks (Tasks 3, 4, 5, 6 of original 02). Depends on 01a (`rotate-telegram-bot.sh` invokes `provision-credentials.sh` from 01a) and 02a (runbook cross-references `archive-openclaw.sh`).
---

# Plan: feature-phase-2-vps-bootstrap/02b-whatsapp-telegram-and-runbooks

## Goal

Ship the remaining OpenClaw teardown scripts and the human-readable runbooks operators follow at cutover-time. Four deliverables: (1) `revoke-whatsapp.sh` — thin wrapper around the Meta Graph API curl sequence (DELETE `/<WABA_ID>/subscribed_apps`, DELETE `/me/permissions`, debug_token probe), accepts IDs as env vars, NEVER stores Meta credentials; (2) `rotate-telegram-bot.sh` — partially-scripted documentation of the BotFather `/revoke` flow (the BotFather UI step is manual; this script handles the post-rotation `provision-credentials.sh telegram-token` invocation + verifies the old token is dead via Telegram `getMe` API with 5-retry × 30s backoff); (3) `02-whatsapp-deauth.md` — operator runbook (verbatim spec § 7 with click-path-to-find-Meta-IDs + manual system-user removal step); (4) `02-telegram-bot-rotation.md` — operator runbook (verbatim spec § 3 Option A verdict + atomic T-0:00 → T+3:00 sequence). Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` §§ 3, 7.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/deploy/revoke-whatsapp.sh` | Meta Graph API curl wrapper (WABA subscribed_apps + permissions DELETE) |
| create | `runtime/deploy/rotate-telegram-bot.sh` | Post-BotFather-rotation script: provision new token + verify old is dead |
| create | `runtime/migration/02-whatsapp-deauth.md` | Human-readable WhatsApp deauth runbook (copy of spec § 7) |
| create | `runtime/migration/02-telegram-bot-rotation.md` | Human-readable Telegram rotation runbook (copy of spec § 3) |

## Tasks

### Task 1: Author revoke-whatsapp.sh

- **files:** `runtime/deploy/revoke-whatsapp.sh`
- **action:** Bash wrapper around spec § 7 Meta Graph API sequence. Shebang + `set -euo pipefail`. Required env vars (fail loudly if missing): `WABA_ID`, `APP_ID`, `APP_SECRET`, `SYSTEM_USER_TOKEN`. Optional `PHONE_NUMBER_ID` (only used in verification echo). Pre-flight `command -v jq` + `command -v curl` (C1 carry-over from original Plan 02 — defensive guard). Header comments naming purpose + Meta credentials provenance (1Password vault `iago-os` item `whatsapp-app-credentials` per OQ5) + non-idempotent warning (running twice on an already-revoked token will fail at step 2 — that's the intended verification signal). Steps: (1) confirm OpenClaw is stopped (assertion only — spec § 7 dependency on archive-openclaw.sh having run first; check via `su - ilsantino -c "systemctl --user is-active openclaw-gateway.service" || true` — pass if "inactive" or "failed"; refuse to continue if "active"); (2) `curl -X DELETE "https://graph.facebook.com/v21.0/${WABA_ID}/subscribed_apps" -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"` — capture response, assert `success` field is `true` (use `jq` to parse); (3) `curl -X GET .../subscribed_apps` to verify empty (or only contains other unrelated apps), echo the JSON for the operator to review; (4) `curl -X DELETE .../me/permissions` — assert `success: true`; (5) `curl "https://graph.facebook.com/v21.0/debug_token?input_token=${SYSTEM_USER_TOKEN}&access_token=${APP_ID}|${APP_SECRET}"` — parse `data.is_valid`, MUST be `false`; (6) `curl "https://graph.facebook.com/v21.0/me" -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"` — MUST return HTTP 400 or 401 (use `curl -w "%{http_code}" -o /dev/null -s`). Each step echos `[N/6]` + intent + verify result. Final echo: "WhatsApp deauth complete. Manual step required: open Meta Business Suite → Business Settings → Users → System Users → remove/disable the system user. Manual step is NOT scripted; document the click in PR description." Script writes one NDJSON line per step to `/var/log/iago-os/cutover.ndjson` if writable (spec § 10 criterion 5). Treat any non-success response as fatal except in the `is-active` check at step 1 (which is informational).
- **verify:** `bash -n runtime/deploy/revoke-whatsapp.sh && shellcheck runtime/deploy/revoke-whatsapp.sh && grep -c "^# \|^echo \"\\[" runtime/deploy/revoke-whatsapp.sh && grep -E 'command -v jq' runtime/deploy/revoke-whatsapp.sh`
- **expected:** `bash -n` exit 0. `shellcheck` exit 0. Step-or-comment count ≥20. `jq` pre-flight present.

### Task 2: Author rotate-telegram-bot.sh

- **files:** `runtime/deploy/rotate-telegram-bot.sh`
- **action:** Bash script that wraps the SCRIPTABLE part of spec § 3 (the BotFather UI rotation is manual; this script handles before + after). Shebang + `set -euo pipefail`. Header explains: BotFather `/revoke` step is manual (no API); BotFather `/revoke` is rate-limited to roughly 1/min per bot per Telegram informal limits, so if Santiago is debugging mid-cutover the script's retry buffer (step 5) absorbs propagation delay. This script (a) records the OLD token's bot info BEFORE rotation so Santiago has a record, (b) PROMPTS the operator to run BotFather rotation now, (c) AFTER operator updates 1Password, runs `provision-credentials.sh telegram-token`, (d) verifies the OLD token is dead via `getMe` API with retries, (e) verifies the NEW token works via `getMe` API. **Interactive script — pipeline-safe via `IAGO_ROTATE_NONINTERACTIVE=1` flag (C2 carry-over):** `# WARNING: this script is INTERACTIVE; do not invoke from pipeline/CI. Operator runs at cutover-time per runbook.` With `IAGO_ROTATE_NONINTERACTIVE=1` env override, the `read -r` prompts are bypassed (used only for Plan 03a dry-run harness — script just verifies pre-rotation state and exits before the prompt). Required env var: `OLD_TOKEN` (the token before rotation, passed as env var; never echoed). Optional `PROVISION_SCRIPT="${PROVISION_SCRIPT:-$(dirname "$0")/provision-credentials.sh}"` — defaults to sibling script (01a artifact). Pre-flight `command -v curl` + `command -v jq` + `command -v op`. Steps: (1) `curl -s "https://api.telegram.org/bot${OLD_TOKEN}/getMe" | jq` → record bot username + ID, write to `/var/log/iago-os/telegram-rotation-pre.json`; if call fails → exit 1 with "old token already dead — was rotation done previously?"; (2) print instructions: "MANUAL STEP — open Telegram, go to @BotFather, /mybots, select your bot, API Token, Revoke current token. Copy new token. Open 1Password app, edit item v2-daemon-telegram-bot, paste new token into 'token' field, save. Press Enter to continue."; `read -r` (interactive; skipped on NONINTERACTIVE); (3) confirm 1Password has fresh value by reading it (`op read 'op://iago-os/v2-daemon-telegram-bot/token'` — if same as `OLD_TOKEN`, abort with "1Password not updated; rotation aborted"); (4) run `"$PROVISION_SCRIPT" telegram-token`; (5) Telegram verification with retry buffer (M2 carry-over — 5-attempt × 30s backoff loop, max 2.5 min total wait): `for i in $(seq 1 5); do response=$(curl -s "https://api.telegram.org/bot${OLD_TOKEN}/getMe"); ok_field=$(echo "$response" | jq -r '.ok'); if [[ "$ok_field" == "false" ]]; then echo "[5/6] OLD token revoked (attempt $i)"; break; fi; if [[ "$i" -eq 5 ]]; then echo "ERROR: OLD token still valid after 5 retries (2.5 min). BotFather /revoke may have rate-limited; wait 60s + manually re-revoke" >&2; exit 1; fi; echo "[5/6] OLD token still valid; retry $i/5 after 30s"; sleep 30; done`; (6) read new token via `op read`, run getMe → MUST return 200 with same bot username as recorded at step 1 (asserts SAME bot, just rotated key). Output: "Telegram bot rotation complete. Bot username preserved: <handle>." Write each step result (including retry attempt count for step 5) to `/var/log/iago-os/cutover.ndjson` if writable.
- **verify:** `bash -n runtime/deploy/rotate-telegram-bot.sh && shellcheck runtime/deploy/rotate-telegram-bot.sh && grep -c "^# \|^echo \"\\[" runtime/deploy/rotate-telegram-bot.sh && grep -E 'IAGO_ROTATE_NONINTERACTIVE' runtime/deploy/rotate-telegram-bot.sh`
- **expected:** `bash -n` exit 0. `shellcheck` exit 0. Step-or-comment count ≥18. NONINTERACTIVE flag handling present.

### Task 3: Author 02-whatsapp-deauth.md runbook

- **files:** `runtime/migration/02-whatsapp-deauth.md`
- **action:** Human-readable runbook copying spec § 7 + the click-path-to-find-Meta-IDs + the manual system-user removal step. Sections: (1) When to run — "At T+30 of cutover runbook (Plan 03b) after Telegram + v2 daemon confirmed working"; (2) Why this matters — "Stops Meta from retrying webhooks at OpenClaw's dead endpoint indefinitely; revokes long-lived access token so leak ≠ message-send compromise"; (3) Inputs — table of 5 IDs (PHONE_NUMBER_ID, WABA_ID, APP_ID, APP_SECRET, SYSTEM_USER_TOKEN) + where to find each in Meta Business Suite; (4) Procedure — verbatim copy of spec § 7 curl block with the rationale-comment lines preserved; if invoking via `runtime/deploy/revoke-whatsapp.sh` (Task 1), instructions for `export` of env vars BEFORE invoking; (5) Verification — copy of spec § 7 step 6 + 7; (6) Manual UI step — "Open Meta Business Suite → Business Settings → Users → System Users → click the system user OpenClaw used → Remove/disable. This step is NOT scripted; document the click in PR description with a screenshot."; (7) Rollback — "WhatsApp deauth is NOT undone in a Phase 2 rollback. If cutover is rolled back at T+R+5 (Plan 03b), OpenClaw restart will fail to send WhatsApp (token dead, webhook unsubscribed). This is acceptable per spec § 8 T+30: WhatsApp deauth is a security-debt operation, not a rollback trigger. To fully restore WhatsApp would require re-creating a system user and re-subscribing webhook — 30+ min manual work. Cost of leaving WhatsApp deauthed during rollback: WhatsApp inbound stops working, Telegram still works on OpenClaw. Net: acceptable for the rare rollback path." (8) Failure modes table. File 100-180 lines.
- **verify:** `wc -l runtime/migration/02-whatsapp-deauth.md && grep -c "^## " runtime/migration/02-whatsapp-deauth.md && grep -c "curl" runtime/migration/02-whatsapp-deauth.md`
- **expected:** Line count 100-180. ≥7 top-level sections. ≥4 curl references (4 distinct Graph API calls).

### Task 4: Author 02-telegram-bot-rotation.md runbook

- **files:** `runtime/migration/02-telegram-bot-rotation.md`
- **action:** Human-readable runbook copying spec § 3. Sections: (1) When to run — "At T+02 of cutover runbook (Plan 03b), AFTER OpenClaw stopped + archived (Plan 02a)"; (2) Why Option A — verbatim copy of spec § 3 Option A/B/C verdict table; (3) Procedure — verbatim copy of the T-0:00 to T+3:00 atomic sequence from spec § 3 with timestamps; (4) Allowed user IDs — explain single integer (NOT chat ID); how Santiago obtains his user ID via @userinfobot; how it lands in systemd unit's `Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=` (Plan 01a Task 1); (5) Pre-cutover test plan — verbatim copy of spec § 3 pre-cutover test plan (throwaway test bot via BotFather `/newbot`, validate locally, delete via `/deletebot`); (6) Verification — invoke `rotate-telegram-bot.sh` (Task 2) handles automated parts; manual verification = send `/agents` from phone, expect bot reply; (7) Rollback — if cutover is rolled back, the BotFather-revoked OLD token cannot be un-revoked. Rollback requires another `/revoke` to get a FRESH token, then patching `~/.openclaw/openclaw.json` (per spec § 9 rollback step T+R+1:30 jq snippet). This is the most variable step in the rollback timeline; spec § 9 reports it as ~1:00; ensure Santiago has BotFather UI open before triggering rollback to compress this further. File 100-180 lines.
- **verify:** `wc -l runtime/migration/02-telegram-bot-rotation.md && grep -c "^## " runtime/migration/02-telegram-bot-rotation.md && grep -c "BotFather\|/revoke\|getMe" runtime/migration/02-telegram-bot-rotation.md`
- **expected:** Line count 100-180. ≥6 sections. ≥6 BotFather/revoke/getMe references.

## Verification

```bash
for s in revoke-whatsapp.sh rotate-telegram-bot.sh; do
  bash -n "runtime/deploy/$s" && shellcheck "runtime/deploy/$s" || { echo "FAIL: $s"; exit 1; }
done
wc -l runtime/migration/02-whatsapp-deauth.md runtime/migration/02-telegram-bot-rotation.md
```

Expected:
- Both deploy scripts pass `bash -n` + `shellcheck`
- Both runbooks 100-180 lines

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 02 stress test, scoped to 02b tasks only)
**Date:** 2026-05-18 (pre-emptive split; original stress 2026-05-17)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — `revoke-whatsapp.sh` requires `jq` on VPS.** Phase 0 audit confirms `jq` present. But the original Plan 02 Task 3 didn't add a pre-flight check. **Fix:** Task 1 adds `command -v jq > /dev/null || { echo "ERROR: jq required for response parsing. apt install jq" >&2; exit 1; }` at the top. Same for `curl` (also base-Debian). Defensive guard — cheap; protects against a minimal VPS variant.
- **C2 — `rotate-telegram-bot.sh` interactive `read -r` blocks pipeline runs.** The pipeline implementer session is non-interactive (`claude -p`). If the pipeline tries to run `rotate-telegram-bot.sh` directly as a verify step, it hangs. **Fix:** Task 2 verify command is `bash -n` + `shellcheck` ONLY (already is). Add explicit comment to script: `# WARNING: this script is INTERACTIVE; do not invoke from pipeline/CI. Operator runs at cutover-time per runbook.` Also: add an env override `IAGO_ROTATE_NONINTERACTIVE=1` that auto-skips the `read -r` (used only for the dry-run test harness in Plan 03a Task 3 — script just verifies pre-rotation state and exits before the prompt).

### Important (forward to impl, don't block)

- **I1 — `provision-credentials.sh` cross-script dependency.** `rotate-telegram-bot.sh` calls `provision-credentials.sh` (01a artifact). The `PROVISION_SCRIPT` env var default (`$(dirname "$0")/provision-credentials.sh`) assumes both scripts ship in `runtime/deploy/`. Plan 01a + 02b agree on this; both write to `runtime/deploy/`. depends_on chain enforces 01a lands first.
- **I2 — BotFather rate-limit + retry semantics.** Telegram's BotFather revocation usually propagates in seconds but is documented as "up to 5 minutes" in some forum posts. Task 2 step 5 wraps the OLD-token-dead check in 5-attempt × 30s backoff = 2.5 min max wait (M2 carry-over from original Plan 02 stress).
- **I3 — Telemetry NDJSON file `/var/log/iago-os/cutover.ndjson`.** Both scripts write here. Path must exist + be writable by root. Plan 03a cutover.sh pre-flight creates the dir + file. If invoked standalone (not via cutover.sh), the writes silently no-op via the `if writable` check.

### Minor

- M1 — Rollback section in 02-whatsapp-deauth.md (Task 3 section 7) explicitly states WhatsApp is NOT restored on rollback. Sets operator expectation.
- M2 — `rotate-telegram-bot.sh` step 5 retry timing (5 × 30s) chosen empirically. Documented in script comment so a future tweak doesn't lose the rationale.

### Dimension-by-dimension verdicts (02b scope)

- **Precision:** Both bash scripts have `bash -n` + `shellcheck` + grep verifications. Runbooks have line-count + heading-count + content-keyword greps.
- **Edge cases:** C1 (jq missing), C2 (interactive blocks pipeline), I2 (BotFather rate-limit) covered.
- **Contradictions:** Spec § 7 + Task 1 + Task 3 all describe the SAME 6 curls — agreement enforced by verbatim copy. Same for spec § 3 + Task 2 + Task 4.
- **Simpler alternatives:** Could collapse 02b into 02a (single plan). REJECTED — original 02 was 7 tasks, hit Phase 1 ceiling pattern. Split is safer. Could skip the BotFather retry loop. REJECTED — `getMe` propagation is documented to take up to 5 min.
- **Missing acceptance criteria:** Spec § 3 + § 7 covered. Spec § 10 criterion 5 (per-step NDJSON) covered.

### Implementer forward-list

1. `jq` + `curl` pre-flight in revoke-whatsapp.sh (C1 fix).
2. `IAGO_ROTATE_NONINTERACTIVE=1` skip path + warning comment in rotate-telegram-bot.sh (C2 fix).
3. 5-retry × 30s wait loop at step 5 of rotate-telegram-bot.sh (M2 fix carried from original).
4. NDJSON write to `/var/log/iago-os/cutover.ndjson` in both scripts (acceptance criterion 5 closure).
