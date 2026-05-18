# 02 — WhatsApp Deauth Runbook (Phase 2 cutover step T+30)

**Plan:** `.iago/plans/feature-phase-2-vps-bootstrap/02b-whatsapp-telegram-and-runbooks.md`
**Spec source:** `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 7
**Script wrapper:** `runtime/deploy/revoke-whatsapp.sh`

---

## When to run

At **T+30** of the cutover runbook (Plan 03b), AFTER:

1. Telegram bot rotation confirmed working on the v2 daemon (Plan 03b T+10).
2. v2 daemon processing inbound Telegram traffic successfully.
3. OpenClaw archived; `openclaw-gateway.service` inactive (`runtime/deploy/archive-openclaw.sh`, Plan 02a).

If any gate has failed, **do not run this procedure**. WhatsApp deauth is
post-cutover security hardening; running it while OpenClaw could still need
to be re-started (rollback path) makes the rollback noticeably harder.

---

## Why this matters

Santiago's 2026-05-13 decision: v2 daemon is **Telegram-only**. WhatsApp is
dropped at cutover. Two consequences if Meta-side state is left dangling:

- **Webhook retries forever.** Meta keeps POSTing WhatsApp inbound events at
  the dead OpenClaw HTTP endpoint indefinitely.
- **Token leak ≠ message-send compromise.** The long-lived system-user token
  remains valid. If the encrypted OpenClaw archive leaks AND Santiago's age
  private key leaks AND no deauth has run, the attacker can send WhatsApp
  messages from Santiago's business number for the token's lifetime (often >
  60 days). Deauth reduces the consequence from "attacker controls business
  WhatsApp" to "attacker reads stale session state".

---

## Inputs

Five values from Meta, stored in 1Password vault `iago-os` item
`whatsapp-app-credentials` (per OQ5). The script never reads 1Password —
Santiago exports each value into the shell before invoking, then unsets after.

| Env var | What | Where to find in Meta Business Suite |
|---|---|---|
| `PHONE_NUMBER_ID` | Cloud API phone ID (~15 digits) | Business Settings → Accounts → WhatsApp Accounts → click WABA → Phone Numbers → click number → "Phone number ID" |
| `WABA_ID` | WhatsApp Business Account ID | Business Settings → Accounts → WhatsApp Accounts → top of WABA detail panel |
| `APP_ID` | Meta App ID | Apps → click app → Settings → Basic → "App ID" |
| `APP_SECRET` | Meta App secret | Apps → click app → Settings → Basic → "App secret" (click "Show") |
| `SYSTEM_USER_TOKEN` | Long-lived access token to revoke | Business Settings → Users → System Users → click OpenClaw system user → "Generate new token" history; OR the value already in 1Password |

If any value is missing from 1Password, **stop**. Locate via click paths
above and add to the 1Password item BEFORE proceeding. Mid-cutover credential
hunting is the single most expensive failure mode of this runbook.

---

## Procedure

### Option A — invoke the script wrapper (recommended)

```bash
export WABA_ID="<paste from 1Password>"
export APP_ID="<paste from 1Password>"
export APP_SECRET="<paste from 1Password>"
export SYSTEM_USER_TOKEN="<paste from 1Password>"
export PHONE_NUMBER_ID="<paste from 1Password>"  # optional; echoed only

bash runtime/deploy/revoke-whatsapp.sh

# Unset immediately — defence against shell-history scraping.
unset WABA_ID APP_ID APP_SECRET SYSTEM_USER_TOKEN PHONE_NUMBER_ID
```

### Option B — run the four curls manually

Verbatim from spec § 7. Use only if the script fails AND you have a specific
reason to walk through the calls one at a time.

```bash
# Step 3 — DELETE webhook subscription for the WABA
# Removes the subscribed_apps binding so Meta stops POSTing to OpenClaw.
curl -X DELETE \
  "https://graph.facebook.com/v21.0/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"
# expected: {"success": true}

# Step 4 — VERIFY subscription deletion (expect empty or other apps only)
curl -X GET \
  "https://graph.facebook.com/v21.0/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"

# Step 5a — REVOKE the system-user access token (app-side)
curl -X DELETE \
  "https://graph.facebook.com/v21.0/me/permissions" \
  -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"
# expected: {"success": true}

# Step 6 — VERIFY token is dead
curl "https://graph.facebook.com/v21.0/debug_token?input_token=${SYSTEM_USER_TOKEN}&access_token=${APP_ID}|${APP_SECRET}"
# expected: data.is_valid == false
# OR direct probe (expect HTTP 400 or 401):
curl "https://graph.facebook.com/v21.0/me" -H "Authorization: Bearer ${SYSTEM_USER_TOKEN}"
```

Why Graph API and not the Meta UI for webhook deletion: the App Dashboard
webhook UI requires re-running the `hub.challenge` URL-verification handshake
when removing subscriptions. With OpenClaw stopped, that verification fails
and the UI gets stuck. The Graph API `DELETE` does not.

---

## Verification (post-script)

The script enforces all of these inline. Re-verify manually only on failure.

| Check | Expected |
|---|---|
| `debug_token` returns `data.is_valid` | `false` |
| `GET /v21.0/me` with the revoked token | HTTP 400 or 401 |
| `GET /v21.0/<WABA_ID>/subscribed_apps` | Empty `data`, or only apps unrelated to OpenClaw |
| Test WhatsApp message from a different phone to the Cloud API number | Visible in Meta Business Suite → WhatsApp Manager; NO webhook POST hits OpenClaw's URL |

---

## Manual UI step (NOT scripted)

Open Meta Business Suite → Business Settings → Users → System Users → click the
system user OpenClaw used → **Remove** or disable token.

Why this isn't scripted: the action is one-time and the Graph API for system-user
deletion requires a different (admin-level) credential than the one being revoked.
The two-credential setup is more dangerous to script than to click once.

Document the click path in the PR description with a screenshot before merging
the cutover PR.

---

## Rollback

WhatsApp deauth is **NOT** undone in a Phase 2 rollback.

If cutover rolls back at T+R+5 (Plan 03b rollback section), restarting OpenClaw
will leave it unable to send WhatsApp: token dead, webhook unsubscribed. This is
acceptable per spec § 8 T+30 — WhatsApp deauth is security-debt closure, NOT a
rollback trigger.

Fully restoring WhatsApp would require: create new Meta system user, generate
new long-lived token, re-subscribe OpenClaw webhook to the WABA (also re-runs
`hub.challenge` handshake), re-deploy token + restart. 30+ min of manual work,
requires admin-level Meta credentials, undoes the security hardening just
performed. Cost of leaving WhatsApp deauthed during a rollback: **WhatsApp
inbound stops working; Telegram still works on OpenClaw**. Telegram is the
primary surface. Net: acceptable for the rare rollback path.

If WhatsApp restoration is required during a rollback, that becomes its own
post-rollback follow-up plan — not an inline cutover step.

---

## Failure modes

| Symptom | Likely cause | Resolution |
|---|---|---|
| `[1/6]` reports `openclaw still active` | Plan 02a archive-openclaw.sh did not run, or unit re-started | Stop OpenClaw first: `tailscale ssh root@srv1456441 -- su - ilsantino -c "systemctl --user stop openclaw-gateway.service"` then re-run |
| `[2/6]` returns `success:false` | WABA already unsubscribed, OR token lacks `whatsapp_business_management` scope | Check Meta App Dashboard → WhatsApp → Configuration; if already unsubscribed, skip step 2 and continue from step 3 manually |
| `[4/6]` returns `success:false` | Token already revoked, OR token is App-level and lacks `/me/permissions` access | If previously revoked, step 5/6 will still confirm dead — continue. If wrong type, regenerate as System User token |
| `[5/6]` reports `is_valid:null` | `APP_ID` or `APP_SECRET` mismatched against the token's app (debug_token returns an error with no `data.is_valid` field) | Verify all three come from the SAME Meta App |
| `[6/6]` returns HTTP 200 | Token did not actually revoke (Meta caching) | Wait 60s, re-run step 6 manually; if still 200, the `/me/permissions` DELETE silently failed — investigate Meta App Dashboard audit log |
| Script failed between `[2/6]` and `[4/6]` (e.g. network drop) | Partial deauth: webhook subscription deleted, system-user token still live | Webhook cleanup is done. Manually revoke the system-user token: Meta Business Suite → Business Settings → Users → System Users → click the OpenClaw system user → Revoke token. Do NOT re-run the script — step 2 (`DELETE /subscribed_apps`) is non-idempotent and will error if re-run after a clean deletion. |

---

## Source of truth

`.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 7. Any divergence
between this runbook and the spec is a bug in this runbook — open a fix PR
against `runtime/migration/02-whatsapp-deauth.md` referencing the spec line.
