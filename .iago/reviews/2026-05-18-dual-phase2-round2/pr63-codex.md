> Note: PowerShell command-trace prefix from codex-companion stripped at archive time. Verdict and findings below are verbatim from the run.

# Codex Adversarial Review

Target: branch diff against 20c8348
Verdict: needs-attention

No-ship: the Telegram runbook can strand cutover before provisioning, and both new scripts expose freshly rotated secrets through process arguments.

Findings:
- [high] Runbook revokes the Telegram token before the script can snapshot it (runtime/migration/02-telegram-bot-rotation.md:48-54)
  The procedure tells the operator to tap BotFather `Revoke current token` at T+1:00 and only run `rotate-telegram-bot.sh` at T+2:00. The script's first action is `getMe` with `OLD_TOKEN` and it exits if that token is already dead. Following this runbook literally aborts before provisioning the new 1Password value into systemd creds, leaving the old token revoked and the daemon without the new credential during cutover.
  Recommendation: Change the runbook so the operator starts `rotate-telegram-bot.sh` before the BotFather action and lets the script own the manual prompt, or add a supported post-revoke mode that skips the pre-rotation `getMe` snapshot and still provisions/verifies safely.
- [high] Telegram rotation puts live bot tokens in curl argv (runtime/deploy/rotate-telegram-bot.sh:89-195)
  The script interpolates `OLD_TOKEN` and `new_token_from_op` directly into curl URL arguments. Those arguments are visible via process inspection while curl runs; line 195 exposes the freshly rotated live bot token immediately after it is read from 1Password. This defeats the rotation's goal on any host with local process monitoring, audit capture, or another same-box user/process boundary.
  Recommendation: Route Telegram API calls through a helper that passes the full URL via curl config/stdin or another non-argv channel, and ensure no token-bearing command line is emitted by retries or diagnostics.
- [high] WhatsApp deauth exposes Meta tokens and app secret in process arguments (runtime/deploy/revoke-whatsapp.sh:112-167)
  Every Graph API call builds the bearer token into curl's `-H` argument, and the `debug_token` call also places both `SYSTEM_USER_TOKEN` and `APP_SECRET` in the URL argument. These secrets are process-argv visible during a security cleanup step that is specifically meant to reduce credential leakage risk; the debug call can expose the app secret plus the still-sensitive token to local process/audit capture.
  Recommendation: Use curl config/stdin or an equivalent wrapper so Authorization headers, query parameters, and form data are not present in argv; update the manual runbook curls the same way.

Next steps:
- Fix the Telegram runbook ordering or script mode mismatch before cutover.
- Remove secret-bearing curl arguments from both scripts and their documented manual fallbacks.
