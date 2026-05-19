---
plan: 02b-whatsapp-telegram-and-runbooks
status: done-with-manual-fix-history
verified: 2026-05-18
pr: https://github.com/ilsantino/iago-os/pull/63
---

# Summary: 02b-whatsapp-telegram-and-runbooks

## Pipeline Result

- **Implement:** exit 0
- **Build gate:** passed
- **Review:** PASS
- **Codex:** exit 0
- **PR:** https://github.com/ilsantino/iago-os/pull/63

## Manual dual review intervention

The pipeline marked this plan as PASS on its single review pass, but a follow-up
manual dual review (Opus + Codex) caught 1 Important and 3 HIGH findings that
the pipeline alone missed. All were resolved before PR #63 was merged.

- **1 Opus Important (I1) caught after pipeline marked PASS:**
  `runtime/deploy/revoke-whatsapp.sh` step 1 OpenClaw-active guard was silently
  bypassed on the operator's Windows host (the guard probed the local machine
  rather than the VPS that actually hosts OpenClaw).
  - **Fix:** switched the guard to a Tailscale SSH probe of the VPS, with an
    `IAGO_OPENCLAW_STOPPED=1` operator override for the cutover window
    (commit `450594d`).
- **3 Codex HIGH caught after pipeline marked PASS:**
  - Runbook ordering bug — Telegram rotation runbook told operators to call
    BotFather `/revoke` *before* running `rotate-telegram-bot.sh`, which
    stranded the cutover because the script's first call (`getMe` with the
    old token) failed against a dead token.
  - Telegram rotation script leaked the live bot token via `curl` argv
    (visible in `ps`); rewrote every call to use `curl --silent --config -`
    so tokens stay on stdin.
  - WhatsApp deauth script leaked Meta system-user token and `APP_SECRET`
    via `curl` argv (Authorization header and `debug_token` query string);
    same `--config -` fix applied to all six `curl` steps, plus the
    documented manual-fallback `curl` examples in both runbooks.
- **All resolved BEFORE merge of PR #63.** Pipeline review-pass was retained
  for audit purposes; this section exists to make explicit that the merged
  artifact reflects post-manual-review fixes, not the pipeline-PASS state.

## Diff Stats

```
 .iago/runs/round-2-dispatch/02b.log           | 104 +++++++++++++
 runtime/deploy/revoke-whatsapp.sh             | 191 +++++++++++++++++++++++
 runtime/deploy/rotate-telegram-bot.sh         | 216 ++++++++++++++++++++++++++
 runtime/migration/02-telegram-bot-rotation.md | 170 ++++++++++++++++++++
 runtime/migration/02-whatsapp-deauth.md       | 179 +++++++++++++++++++++
 5 files changed, 860 insertions(+)
```
