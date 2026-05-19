# PR #63 — Plan 02b WhatsApp + Telegram + Runbooks

**Reviewer:** Opus (adversarial) · **Date:** 2026-05-18
**Verdict:** PASS_WITH_CONCERNS

## Important

### I1 — `revoke-whatsapp.sh` OpenClaw is-active guard silently bypassed on operator host

Current step 1 logic:
```bash
if id -u "$OPENCLAW_USER" >/dev/null 2>&1; then
  is_active=$(su - "$OPENCLAW_USER" -c "systemctl --user is-active $OPENCLAW_SERVICE" 2>/dev/null || echo unknown)
  ...
else
  echo "  NOTE: user '$OPENCLAW_USER' not present on this host. Assuming OpenClaw never ran here."
  emit_ndjson "1/6" "ok" "user $OPENCLAW_USER absent"
fi
```

Verified locally on operator MINGW64 host: `id ilsantino` → `no such user`. Step 1 silently passes via the user-absent no-op branch — deauth proceeds **without ever verifying OpenClaw is stopped on the VPS**.

**Concrete failure path:** Santiago skips/forgets `archive-openclaw.sh`. Meta webhook DELETE races against a still-polling OpenClaw, leaving downstream state confused.

**Impact:** loss of the only mechanical gate the spec demanded.

**Fix options:**
1. **Remote probe via Tailscale SSH** — `tailscale ssh "${VPS_USER:-root}@${VPS_HOST:-srv1456441}" -- "su - $OPENCLAW_USER -c 'systemctl --user is-active $OPENCLAW_SERVICE'"`. Recommended.
2. **`IAGO_REVOKE_HOST=vps|local` env switch** — on local, require `IAGO_OPENCLAW_STOPPED=1` ack.
3. **Hard-fail when ilsantino is absent** unless `--remote-check`.

### I2 — Runbook Option A omits "where do I run this" instruction

`02-whatsapp-deauth.md` Procedure → Option A shows `bash runtime/deploy/revoke-whatsapp.sh` with no host context. Add explicit `Run from:` line above Option A.

## Minor

- **M1** — Spec §7 rationale text vs curl-block ordering contradiction inherited verbatim. Flag for spec amendment.
- **M2** — `revoke-whatsapp.sh:130` step 3 echoes raw subscribed-apps JSON to stdout (may contain other apps' IDs).
- **M3** — `rotate-telegram-bot.sh:172-189` retry loop fragile to malformed responses (transient 5xx empty body → `jq -r` error → `set -e` exits mid-retry).
- **M4** — NDJSON `detail` payload writes full Meta response bodies — if Meta ever echoes bearer token in error shape, lands in log.
- **M5** — `shellcheck` gate not actually exercised on operator box (per 02b.log:19).

## Cross-cutting

- **Auth bypass:** env-var fail-loud guards on 5 WhatsApp inputs + OLD_TOKEN ✓. Step 3 `op read` ≠ OLD_TOKEN catches operator pressing Enter without rotating ✓. Step 6 bot-id-match prevents wrong-bot rotation ✓.
- **Data loss:** WhatsApp non-idempotency documented + intentional ✓. **Concern:** I1 bypass enables one mode (revoke while OpenClaw polls) that can desync Meta webhook state.
- **Race conditions:** Operator-driven. Only race surface is I1 is-active guard, which doesn't actually guard.
- **Rollback safety:** WhatsApp explicitly NOT rolled back ✓. Telegram rollback documents BotFather rate-limit + UI-pre-open advice ✓.

## Recommended follow-up before cutover-time use

1. Apply I1 fix (option 1 — Tailscale SSH probe) so the OpenClaw-stopped guard actually fires on Santiago's host.
2. Add "Run from: Santiago's Windows box (Git Bash)" callout above Option A in `02-whatsapp-deauth.md`.
3. Install `shellcheck` on operator box and rerun verify block.

## Reconciliation with Codex findings (separate file: pr63-codex.md)

Codex found 3 HIGH:
- HIGH-1 (runbook order) — **fixed by 298b06c**
- HIGH-2 (Telegram tokens in argv) — **fixed by 298b06c**
- HIGH-3 (WhatsApp tokens in argv) — **fixed by 298b06c**

Opus found 2 Important + 5 Minor not flagged by Codex:
- I1 (OpenClaw guard silent bypass) — **OPEN, recommended for follow-up commit**
- I2 (runbook host context) — **OPEN, doc-only**
- M1-M5 — informational, not blocking

GH Action loop (rounds 1-3 + 87f5eb8) caught the original Codex Critical (jq false-collapse) and partial-deauth runbook. Dual review caught what GH Action missed.
