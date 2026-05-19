# 02 — Telegram Bot Rotation Runbook (Phase 2 cutover step T+02)

**Plan:** `.iago/plans/feature-phase-2-vps-bootstrap/02b-whatsapp-telegram-and-runbooks.md`
**Spec source:** `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 3
**Script wrapper:** `runtime/deploy/rotate-telegram-bot.sh`

---

## When to run

At **T+02** of the cutover runbook (Plan 03b), AFTER:

1. OpenClaw stopped + archived (`runtime/deploy/archive-openclaw.sh`, Plan 02a).
2. Pre-cutover test plan (below) executed successfully against a throwaway bot.

If OpenClaw is still polling the bot's token, BotFather rotation will still
work — but the v2 daemon cannot validate the new token end-to-end (Telegram
permits only one polling client per token, and OpenClaw still holds it).
Always stop OpenClaw first.

---

## Why Option A (same bot, rotate token via BotFather)

Verbatim from spec § 3:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Same bot, rotate token via BotFather** | Same `@bot_handle` (zero Santiago-side reconfiguration); same chat IDs (no allowed-user-ID migration); BotFather revocation is atomic (old token dies instantly when new is issued) | Requires interactive BotFather session at cutover-time (no scripted rotation API) | **ACCEPT** |
| B. New bot, new handle | Clean break; old bot remains for sentimental rollback test | Santiago must re-`/start` the new bot on phone; allowed-user-ID rebuild; chat ID changes invalidate any saved approval chat references; rollback requires reverting phone session too | REJECT — friction for zero benefit |
| C. Keep same token (no rotation) | Zero work | OpenClaw retained the token for 30 days while archive sits; if archive leaks, token leaks | REJECT — security carry-over violates Garry standard |

The new token gets provisioned via `provision-credentials.sh telegram-token`
(Plan 01a). Atomic moment: at BotFather's "Revoke current token" tap, the old
token dies, the new token is shown immediately. Santiago copies it into the
1Password item `v2-daemon-telegram-bot::token`, then runs the provisioning
script. Total wall clock: ~3 minutes.

---

## Procedure (atomic — T-0:30 → T+3:00)

The script is interactive: it snapshots the OLD token via `getMe` BEFORE
the operator touches BotFather, then prompts the operator to perform the
revoke + 1Password update, then provisions and verifies after the
operator presses Enter. Starting the script first is mandatory — if
BotFather `/revoke` runs first, the OLD token is already dead and the
script's step [1/6] snapshot aborts before any rotation work happens,
stranding the cutover.

```
T-0:30  In Git Bash on Windows, start the script (records pre-rotation
          snapshot, then blocks at the manual-step prompt):
          OLD_TOKEN="<old token>" bash runtime/deploy/rotate-telegram-bot.sh
T-0:20  Script step [1/6] prints "Bot: @<handle> (id=<id>)" then displays
          the BotFather instructions and "Press Enter to continue once
          1Password has the new token..."
T+0:00  On phone: open Telegram, message @BotFather
T+0:10  Send: /mybots
T+0:15  Tap the bot's @handle (the one OpenClaw uses today)
T+0:20  Tap: API Token
T+0:25  Tap: Revoke current token
T+0:30  BotFather confirms; new token appears in chat. Copy to clipboard.
T+0:40  In 1Password app: edit item v2-daemon-telegram-bot, paste new
          token into `token` field, save.
T+0:50  Return to Git Bash on Windows. Press Enter at the script prompt.
T+1:00  Script step [3/6] reads 1Password, [4/6] provisions via
          systemd-creds, [5/6] verifies OLD token returns getMe ok=false
          (5 × 30s retry buffer for BotFather propagation), [6/6] verifies
          NEW token points at same bot id as step [1/6] snapshot.
T+3:00  ← bot token rotation complete; OpenClaw bot polling (if it were
          still running) would now fail with 401.
```

The 401-on-OpenClaw signal is intentional — it's the test that the new token
is genuinely a new token and not BotFather displaying the cached old one.

**Do NOT** issue BotFather `/revoke` before starting the script. The first
thing the script does is call `getMe` with `OLD_TOKEN` to snapshot the bot's
username + id. If `/revoke` has already fired, that call returns `ok:false`
and the script exits at step [1/6] before provisioning anything.

---

## Allowed user IDs

The v2 daemon authenticates Telegram messages against a single integer:
**Santiago's Telegram user ID**, NOT the chat ID. Stored in the systemd unit
as `Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=__SANTIAGO_USER_ID__` (set
once at Plan 01a Task 1).

Santiago obtains his user ID by messaging `@userinfobot` on Telegram (or any
equivalent bot). Result is a 10-digit integer. The same number was likely
already used by OpenClaw's `channels.telegram.allowFrom` — confirm via
OpenClaw config inspection during pre-flight if needed.

Future multi-user (Sebas onboarding in Phase 6): comma-separated decimals:

```
Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=1234567890,9876543210
```

Phase 1 config loader (`runtime/daemon/config.ts` lines 95-103) already
parses comma-separated decimal integers via `parseAllowedUserIds`.

---

## Pre-cutover test plan (run BEFORE stopping OpenClaw)

The v2 daemon cannot be validated against the production bot token while
OpenClaw is still polling — Telegram allows only one polling client per
token. Use a throwaway test bot instead:

1. Create test bot in BotFather (1 min):
   - Send `/newbot` to @BotFather
   - Name it `iago-os-v2-test-bot` (or any unused name)
   - Copy the test token
2. Run the v2 daemon locally on Santiago's Windows box with the test token
   (Phase 1 hello-world setup pattern).
3. From Telegram on phone, confirm `/agents`, `/status <agent>`, and the
   approval flow all work.
4. Stop the local daemon. Delete the test bot via BotFather `/deletebot`.
5. ONLY THEN proceed with the production bot rotation procedure above.

The test bot proves the v2 daemon's Telegram routing works; the production
rotation is the actual cutover step.

---

## Verification

Automated by `rotate-telegram-bot.sh` (see Task 2 of Plan 02b):

| Step | Check |
|---|---|
| [1/6] | OLD token getMe returns `ok:true` (snapshot bot @handle + id) |
| [3/6] | 1Password item value differs from `OLD_TOKEN` |
| [4/6] | `provision-credentials.sh telegram-token` round-trip succeeds |
| [5/6] | OLD token getMe returns `ok:false` within 2.5 min |
| [6/6] | NEW token getMe returns `ok:true` AND `result.id` matches step [1/6] snapshot |

Manual verification: send `/agents` from Santiago's phone, expect bot reply
from the v2 daemon (after `cutover.sh` restarts the daemon with the new
credential — Plan 03a).

---

## Rollback

If cutover rolls back, the BotFather-revoked OLD token **cannot** be
un-revoked. Rollback requires:

1. Another BotFather `/revoke` to get a FRESH token (counts as a third
   rotation in the BotFather rate-limit window; if attempted within ~60s of
   the cutover-time `/revoke`, BotFather may silently refuse — wait the full
   minute first).
2. Patching `~/.openclaw/openclaw.json` with the fresh token via the spec
   § 9 rollback `jq` snippet (T+R+1:30).
3. Re-starting `openclaw-gateway.service` via `systemctl --user start`.

This is the most variable step in the rollback timeline. Spec § 9 reports
~1:00 wall-clock for it; ensure Santiago has BotFather UI already open on
his phone BEFORE triggering rollback, to compress steps 1+2 further.

Pre-cutover: brief BotFather UI rehearsal (open `/mybots` → bot handle → API
Token, stop short of tapping Revoke) so the muscle memory is fresh if
rollback fires.

---

## Failure modes

| Symptom | Likely cause | Resolution |
|---|---|---|
| `[1/6]` reports `old token already dead` | Rotation was done in a previous run; OLD_TOKEN env var is stale | Confirm in Telegram via BotFather → bot → API Token whether the current token matches OLD_TOKEN; if not, skip rotation (already done) |
| `[3/6]` reports `1Password not updated` | Operator pressed Enter at the manual-step prompt before saving the new token in 1Password | Press Ctrl-C, save in 1Password, re-run with same OLD_TOKEN |
| `[5/6]` exhausts 5 retries (2.5 min) | BotFather `/revoke` rate-limited the request silently (most likely a second `/revoke` within ~60s of the first); OR propagation actually exceeded 2.5 min (rare) | Wait 60s, in BotFather UI tap "Revoke current token" again, confirm new token appears, update 1Password if it changed, re-run script |
| `[6/6]` reports `bot id mismatch` | Wrong bot rotated in BotFather UI (e.g., Santiago tapped a different `@handle` in `/mybots`) | DO NOT restart the daemon — re-run BotFather rotation against the correct bot; the daemon is still on the OLD credential at this point and is safe |
| NDJSON line not written to `/var/log/iago-os/cutover.ndjson` | Script invoked standalone, log file does not exist + dir not writable | Acceptable — telemetry is best-effort. stdout is source of truth |

---

## Source of truth

`.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 3. Any divergence
between this runbook and the spec is a bug in this runbook — open a fix PR
against `runtime/migration/02-telegram-bot-rotation.md` referencing the spec
line.
