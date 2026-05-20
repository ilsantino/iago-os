# 02 — Cutover Runbook (Phase 2 FAST cutover, T-15 → T+60)

**Owner:** Santiago
**Wall-clock target:** 60 minutes (T-15 → T+60)
**Plan:** `.iago/plans/feature-phase-2-vps-bootstrap/03b-cutover-rollback-runbooks.md`
**Spec source:** `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 8
**Executable companion:** `runtime/deploy/cutover.sh` (Plan 03a artifact)
**Rollback companion:** `runtime/migration/02-rollback-runbook.md` (≤4-min rollback)

The executable in `runtime/deploy/cutover.sh` automates the deterministic
parts of the sequence below. Manual steps (BotFather UI, Telegram phone
testing, WhatsApp deauth click-path) remain operator-driven and are clearly
marked in the script with `MANUAL` prompts. This runbook is the
human-readable counterpart Santiago opens on a second screen while the
script runs.

---

## 1. Owner

Santiago. At keyboard for the full 60-minute window and for 30 additional
minutes of stay-at-keyboard monitoring after T+60. Phone (Telegram) and
Windows box (Git Bash + Tailscale SSH) both required.

---

## 2. Wall-clock target

60 minutes from T-15 to T+60, with a hard rollback ceiling of ≤4 minutes
(see `02-rollback-runbook.md` for the reverse path). The sequence is
front-loaded: by T+25 the v2 daemon is proven on Telegram; T+25 → T+60 is
WhatsApp deauth + observability smoke-checks + retention-timer
verification.

---

## 3a. Day -1: Pre-cutover prep (T-24h)

These steps run THE DAY BEFORE the cutover window. Their purpose is to
create every condition that the `cutover.sh` pre-flight gate checks at
T-15 (§ 3 below). Doing this 24h ahead eliminates the
"deploy-a-prerequisite-during-cutover" failure mode and surfaces any VPS
state drift while there is still time to fix it without a rollback.

Each step has its own checkbox + a `verify:` command. Run all items.
Items gated by `if`/`getent` are idempotent — safe to re-run if a previous
attempt was interrupted.

- [ ] **(i) Create state + log directories on VPS.**

  ```bash
  tailscale ssh root@srv1456441 -- 'mkdir -p /var/lib/iago-os/daemon-state /var/log/iago-os && chown iago:iago /var/lib/iago-os/daemon-state /var/log/iago-os && chmod 0700 /var/lib/iago-os/daemon-state && chmod 0750 /var/log/iago-os'
  ```

  verify:

  ```bash
  tailscale ssh root@srv1456441 -- 'stat -c "%U:%G %a" /var/lib/iago-os/daemon-state /var/log/iago-os'
  # expect:
  #   iago:iago 700  (daemon-state)
  #   iago:iago 750  (log dir — matches cutover.sh pre-flight gate)
  ```

- [ ] **(ii) Create `iago` system user (skip if already exists).**

  ```bash
  if ! tailscale ssh root@srv1456441 -- 'getent passwd iago > /dev/null 2>&1'; then
    tailscale ssh root@srv1456441 -- 'useradd --system --no-create-home --shell /usr/sbin/nologin iago'
  fi
  ```

  verify:

  ```bash
  tailscale ssh root@srv1456441 -- 'getent passwd iago'
  # expect: iago:x:<uid>:<gid>:...:/usr/sbin/nologin
  ```

- [ ] **(iii) Upload age pubkey to VPS.**

  ```bash
  # Ensure target dir exists — scp does NOT create intermediate dirs.
  tailscale ssh root@srv1456441 -- 'mkdir -p /etc/iago-os && chmod 0755 /etc/iago-os'
  scp ~/.age/santiago.pub root@srv1456441:/etc/iago-os/santiago-age.pub
  tailscale ssh root@srv1456441 -- 'chmod 0644 /etc/iago-os/santiago-age.pub'
  ```

  verify:

  ```bash
  tailscale ssh root@srv1456441 -- 'test -f /etc/iago-os/santiago-age.pub && wc -c /etc/iago-os/santiago-age.pub'
  # expect: positive byte count
  ```

- [ ] **(iv) Confirm 1Password items exist for ALL Phase 2 credentials.**

  ```bash
  op item list --vault iago-os | grep -E 'v2-'
  # expect 5 items: v2-daemon-telegram-bot, v2-gh-token, v2-anthropic-default,
  #                 v2-anthropic-ilsantino, v2-anthropic-iaguito
  ```

  The `v2-gh-token` item MUST be a GitHub classic PAT scoped to
  `repo + read:org` (Plan 04 wake-check requires `read:org`) with 90-day
  expiry. Regenerate quarterly via
  `runtime/deploy/provision-credentials.sh gh-token`.

  If any of the 5 items are missing, create them and paste their values
  into 1Password **before** proceeding. Do NOT proceed to step (v) until
  all five are present.

- [ ] **(v) Provision Phase 2 active credentials onto VPS.**

  ```bash
  bash runtime/deploy/provision-credentials.sh telegram-token gh-token
  ```

  verify:

  ```bash
  tailscale ssh root@srv1456441 -- 'ls -la /etc/credstore.encrypted/'
  # expect: iago-telegram-token.cred + iago-gh-token.cred, both 0600 root:root
  ```

- [ ] **(vi) Re-verify OpenClaw cron inventory matches `runtime/migration/openclaw-cron-inventory.json`.**

  ```bash
  tailscale ssh ilsantino@srv1456441 -- 'crontab -l 2>&1 | grep -v "no crontab" | head'
  tailscale ssh root@srv1456441 -- 'systemctl --user --machine=ilsantino@.host list-timers --all --no-pager | grep -iE "openclaw|claw" | head'
  ```

  Expected: **empty output** for both. The inventory file
  (`runtime/migration/openclaw-cron-inventory.json`) records the state of
  cron + user-timer surfaces at audit time; if the re-verify surfaces a
  forgotten entry, **update the inventory file with the new entries +
  commit BEFORE proceeding** with cutover. Drift between the recorded
  inventory and live VPS state is a deployment hazard (Plan 07b acceptance
  gate).

- [ ] **(vii) Confirm git checkout has `.git/`.**

  ```bash
  tailscale ssh root@srv1456441 -- 'test -d /opt/iago-os/.git'
  ```

  Required for any rollback that needs to revert the checkout, and for
  the post-cutover Anthropic provisioning step that pulls fresh secrets
  during Phase 3.

- [ ] **(viii) SIGHUP reload verification (Plan 06 cross-ref).**

  Confirm the SIGHUP credential-reload path is present in the daemon. The
  handler is in the Node process (Plan 06 `runtime/daemon/main.ts` edit
  + `runtime/daemon/sighup.test.ts`), not in the systemd unit. The unit
  carries `KillSignal=SIGTERM` unchanged from Plan 01a; SIGHUP is layered
  on top via `process.on("SIGHUP", ...)`. cat-config validates the final
  unit:

  ```bash
  tailscale ssh root@srv1456441 -- 'systemd-analyze cat-config iago-os-v2-daemon.service | grep -E "KillSignal=SIGTERM"'
  # expect: KillSignal=SIGTERM line present
  ```

  Functional test of the SIGHUP handler itself runs at T+60 post-cutover
  (§ 6 below — `cred-reload-fired` telemetry event check).

- [ ] **(ix) Export Santiago's Telegram user ID in the cutover shell.**

  Required by the systemd unit
  (`Environment=IAGO_TELEGRAM_ALLOWED_USER_IDS=...`) and by the
  provisioning script substitution. Run in the SAME shell session as the
  cutover commands at T+05:

  ```bash
  export IAGO_TELEGRAM_USER_ID=<your numeric Telegram user ID>
  ```

  verify:

  ```bash
  echo $IAGO_TELEGRAM_USER_ID
  # expect: numeric, e.g., 123456789
  ```

  If forgotten, send any message to `@userinfobot` in Telegram to
  retrieve the ID (10-digit integer).

These nine items together create every condition the `cutover.sh`
pre-flight gate checks at T-15. With Day -1 prep complete, the gate at
§ 3 below collapses to a one-pass verification rather than a hunt for
missing prerequisites.

---

## 3. Pre-cutover gate (cannot cut over if any of these fail)

These checkboxes are the GATE the `cutover.sh` script enforces at T-15.
§ 3a (Day -1) is the PREP that creates the conditions the gate verifies.
If ANY pre-flight item is unchecked, ABORT and resolve before scheduling
the cutover window.

- [ ] Phase 1 hello-world acceptance gate green on Santiago's local box (commit `4ee40ee`)
- [ ] v2 daemon code deployed to VPS at `/opt/iago-os` (git clone + `npm install` + `npm run build` inside `runtime/`)
- [ ] systemd unit file installed at `/etc/systemd/system/iago-os-v2-daemon.service` (§ 1 of spec)
- [ ] `iago` user provisioned on VPS via `useradd --system` (Day -1 step ii)
- [ ] `/var/lib/iago-os/daemon-state` created, owned `iago:iago`, mode 0700 (Day -1 step i)
- [ ] `/var/log/iago-os` created, owned `iago:iago`, mode 0750 (Day -1 step i)
- [ ] `/etc/credstore.encrypted/` exists, owned `root:root`, mode 0700
- [ ] `/etc/iago-os/santiago-age.pub` deployed (Day -1 step iii)
- [ ] Throwaway test bot validated against v2 daemon locally (spec § 3 pre-cutover test)
- [ ] OpenClaw archive script dry-run executed (read-only check: confirms it can su to ilsantino, can write to /var/lib/iago-os, age binary present)
- [ ] 1Password CLI signed in on Santiago's Windows box
- [ ] WhatsApp APP_ID, WABA_ID, PHONE_NUMBER_ID, SYSTEM_USER_TOKEN noted down

If ANY pre-flight item is unchecked, ABORT and resolve before scheduling
cutover window.

---

## 4. Cutover sequence

The block below mirrors spec § 8 verbatim with the canonical
`/opt/iago-os/runtime/deploy/<name>.sh` path applied throughout (path
translation per CONTEXT.md, Codex P0-2 fix). Each `T+...` entry is a
single shell step + its verify command + any inline ROLLBACK TRIGGER.

```
T-15:00  Santiago at keyboard. Tailscale up (verify: `tailscale status`
         shows srv1456441 online). VPS reachable
         (`tailscale ssh root@srv1456441 -- date` returns).
         All pre-flight items checked.

T-10:00  Open three terminal windows:
           (a) Git Bash on Santiago's Windows box (for provisioning)
           (b) Tailscale SSH to root@srv1456441 (for archive + systemctl)
           (c) Telegram on phone (for handshake verification)
         Also open: Meta Business Suite in browser, 1Password app.

T-05:00  Send goodbye message via OpenClaw bot (use the existing bot
         that's about to be revoked):
           (in Telegram) "/start" or just send "v2 cutover starting"
         Confirm OpenClaw responds — proves baseline path works
         BEFORE we touch anything.

T-00:00  CUTOVER START.

T+00:00  Terminal (b): run archive-openclaw.sh
           tailscale ssh root@srv1456441 -- 'bash /opt/iago-os/runtime/deploy/archive-openclaw.sh'
         Expected output: 6 numbered steps, ends with "OpenClaw
         archive complete" + the tarball path + SHA256.
         Verification:
           tailscale ssh root@srv1456441 -- 'su - ilsantino -c "systemctl --user is-active openclaw-gateway"'
         Expected: "inactive"
         ROLLBACK TRIGGER: if archive script fails mid-flight,
         restart OpenClaw and abort:
           tailscale ssh root@srv1456441 -- 'su - ilsantino -c "systemctl --user start openclaw-gateway"'

T+02:00  Telegram rotation (per spec § 3 procedure):
           - Open @BotFather in Telegram
           - /mybots → select bot → API Token → Revoke current token
           - Copy new token
           - 1Password app: edit v2-daemon-telegram-bot, paste, save
         Verification: send any message to the OLD bot. Expected: no
         response (because we revoked — old token is dead).

T+05:00  Terminal (a): provision the new Telegram credential
           bash /opt/iago-os/runtime/deploy/provision-credentials.sh telegram-token
         Expected output: "  ✓ iago-telegram-token provisioned (len=NN)"
         then "Provisioning complete."
         Verification:
           tailscale ssh root@srv1456441 -- 'systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | head -c 10 ; echo'
         Expected: first 10 chars of new bot token.

T+07:00  Terminal (b): start the v2 daemon
           tailscale ssh root@srv1456441 -- 'systemctl daemon-reload && systemctl enable --now iago-os-v2-daemon.service'
         Verification:
           tailscale ssh root@srv1456441 -- 'systemctl status iago-os-v2-daemon.service'
         Expected: "active (running)", PID present, no error in last 5 lines.

T+08:00  Verify daemon is listening
           tailscale ssh root@srv1456441 -- 'journalctl -u iago-os-v2-daemon.service --since "2 minutes ago" | tail -30'
         Expected: log lines from runtime/daemon/main.ts startDaemon flow.
         Look for: "daemon-start" NDJSON event.
         Also verify IPC server is up:
           tailscale ssh root@srv1456441 -- 'ls -la /var/lib/iago-os/daemon-state/ipc.sock'
         Expected: socket file exists, owned iago:iago.
         ROLLBACK TRIGGER: daemon refuses to start, journal shows
         "error: <message>" line. Capture journal output, then
         execute rollback (02-rollback-runbook.md).

T+10:00  Telegram test — phone side
           Send "/agents" to the (newly-rotated) bot from phone.
         Expected: bot replies with agent list (Phase 1 hello-world
         registers a "claude-main" agent if configured for auto-start,
         OR replies "No agents registered." which is also success
         — the bot replies at all, proving end-to-end path works).
         ROLLBACK TRIGGER: bot doesn't reply within 60s. Check
         allowed-user-IDs in unit env; if wrong, edit unit + reload.
         If still no reply, execute rollback.

T+15:00  Canonical workflow end-to-end test
           (Manually trigger one approval flow per Phase 1 hello-world
           pattern documented in runtime/PHASE-1-EVIDENCE.md § 4)
         On VPS:
           tailscale ssh root@srv1456441 -- '
             TASK_ID=$(node -e "console.log(crypto.randomUUID())")
             cat > /var/lib/iago-os/daemon-state/tasks/pending/claude-main__${TASK_ID}.json <<EOF
{ "prompt": "Test prompt from cutover — please respond OK", "needsApproval": true }
EOF
           '
         Expected: Telegram approval message arrives on phone.
         Tap "Allow". Agent resumes. Result lands at:
           /var/lib/iago-os/daemon-state/tasks/resolved/claude-main__<TASK_ID>.json
         Verification:
           tailscale ssh root@srv1456441 -- 'ls -la /var/lib/iago-os/daemon-state/tasks/resolved/'

T+25:00  Telegram + agent path proven working. Move to WhatsApp deauth.

T+30:00  WhatsApp deauth (per spec § 7 procedure, runbook
         runtime/migration/02-whatsapp-deauth.md)
           Open Meta Business Suite, gather APP_ID/WABA_ID/etc.
           Run the curl commands from § 7 steps 3-5 in terminal (a).
           Verification per § 7 step 6 + 7.
         No rollback trigger here — if WhatsApp deauth fails it's a
         security debt to fix in the next 24h, NOT a reason to roll
         back the v2 daemon cutover.

T+45:00  Smoke-check observability
           tailscale ssh root@srv1456441 -- 'head -20 /var/lib/iago-os/daemon-state/telemetry/$(date +%Y-%m-%d).ndjson'
         Expected: NDJSON lines including kinds: daemon-start,
         agent-registered (if auto-start configured), agent-spawned,
         task-claimed, approval-requested, approval-resolved.

T+50:00  Verify retention timer is scheduled
           tailscale ssh root@srv1456441 -- 'systemctl list-timers iago-archive-prune.timer'
         Expected: next run scheduled within 24h.

T+55:00  Smoke-check no orphaned processes
           tailscale ssh root@srv1456441 -- 'pgrep -fa openclaw'
         Expected: no output.
           tailscale ssh root@srv1456441 -- 'pgrep -fa iago-os-v2-daemon'
         Expected: exactly one Node process owned by uid of `iago` user.

T+60:00  CUTOVER COMPLETE.

         Santiago's tasks before stepping away — see § 6 below.
```

---

## 5. Verification command summary (single block for runbook execution)

Run this block at T+08, T+15, T+45, T+55 for sanity. The block lives
verbatim in spec § 8.

```bash
# Status block — run at T+08, T+15, T+45, T+55 for sanity
tailscale ssh root@srv1456441 -- '
  echo "=== systemctl status ==="
  systemctl is-active iago-os-v2-daemon.service
  echo "=== open agents ==="
  ls -la /var/lib/iago-os/daemon-state/agents/ 2>/dev/null
  echo "=== pending tasks ==="
  ls -la /var/lib/iago-os/daemon-state/tasks/pending/ 2>/dev/null
  echo "=== last 10 telemetry events ==="
  tail -10 /var/lib/iago-os/daemon-state/telemetry/$(date +%Y-%m-%d).ndjson 2>/dev/null
  echo "=== heartbeat status (last 60s) ==="
  journalctl -u iago-os-v2-daemon.service --since "60 seconds ago" | grep -E "heartbeat|error|warn" | tail -10
'
```

The four checkpoints (T+08, T+15, T+45, T+55) span the cutover at
~15-minute intervals; the block is one Tailscale SSH invocation so the
operator can paste it directly without retyping host coordinates.

---

## 6. Post-cutover required actions

After T+60, before stepping away:

- [ ] Write session digest to Obsidian: `sessions/<YYYY-MM-DD>-iago-os-v2-cutover.md` per
      `~/.claude/rules/obsidian.md`. Include the four verification block
      outputs (T+08, T+15, T+45, T+55) and any anomalies observed.
- [ ] Update `.iago/STATE.md` Active table with cutover row (per
      `.claude/rules/git-workflow.md` STATE.md discipline).
- [ ] Stay at keyboard for 30 more minutes monitoring `journalctl -fu iago-os-v2-daemon.service`
      and Telegram. If anything regresses, execute rollback per
      `runtime/migration/02-rollback-runbook.md`.
- [ ] **Confirm SIGHUP reload path works.** Rotate a benign credential
      (or simulate by re-running `provision-credentials.sh`) +
      `tailscale ssh root@srv1456441 -- 'systemctl kill -s SIGHUP iago-os-v2-daemon.service'`
      + `journalctl -u iago-os-v2-daemon.service --since "60 seconds ago" | grep cred-reload-fired`.
      Expected: a `cred-reload-fired` NDJSON record appears in the
      telemetry stream within 5 seconds. Documented in
      `runtime/daemon/README.md` § Reloading credentials without restart
      (SIGHUP). Plan 06 ships the handler; this is the post-cutover
      functional test confirming the path works in production.

The SIGHUP reload check is intentionally in the post-cutover list
rather than the cutover sequence — credential rotation under SIGHUP is
a Phase 3+ operational concern (Anthropic key rotation when adapters
land), and a failed SIGHUP test is **not** a rollback trigger. Capture
the failure in an incident note and debug post-window.

---

## 7. Failure escalation

When in doubt during the cutover window:

1. **Invoke rollback.** See `runtime/migration/02-rollback-runbook.md`
   for the ≤4-minute reverse path. The executable is
   `runtime/deploy/rollback.sh` (Plan 03a artifact). Decision rule per
   spec § 9: any of the 6 trigger signals → roll back without
   hesitation.
2. **If rollback also fails** (OpenClaw refuses to restart, Telegram
   smoke test no-reply after rollback), escalate to Sebas via Signal
   or phone call. Telegram is the failure surface; do NOT escalate
   through Telegram. Telegram messages from a different phone won't
   reach Sebas if the failure is bot-side; Signal/phone is the
   out-of-band channel.
3. **State preservation rule (per spec § 9):** Do NOT delete
   `/var/lib/iago-os/daemon-state` after rollback. The failed run's
   `session.jsonl`, `markers/*.daemon-stop`, and `telemetry/*.ndjson`
   are diagnostic.

---

## 8. Reference to `cutover.sh`

The executable in `runtime/deploy/cutover.sh` (Plan 03a artifact)
automates the deterministic parts of this runbook:

- Pre-flight gate checks (§ 3 — 12 checkboxes) run as automated
  assertions that abort if any condition is missing.
- T+00 archive invocation
  (`bash /opt/iago-os/runtime/deploy/archive-openclaw.sh`).
- T+05 credential provisioning invocation.
- T+07 daemon enable/start.
- T+08, T+15, T+45, T+55 verification block runs (the verification
  summary in § 5).
- T+55 orphan-process smoke check.

Manual steps remain operator-driven and are marked in the script
with `MANUAL:` prompts. They are:

- T+02 BotFather UI revocation + 1Password paste.
- T+10 Telegram phone testing (send `/agents`, observe reply).
- T+15 phone-side approval tap on the canonical workflow test.
- T+30 WhatsApp deauth click-path in Meta Business Suite.

The script never proceeds past a `MANUAL:` prompt without operator
confirmation. This keeps Santiago in the loop for every interactive
step while letting the script handle the deterministic surface.

---

## 9. Coupling note (M2 carry-over)

**This runbook and `runtime/deploy/cutover.sh` (Plan 03a artifact) both
derive from spec § 8.** They are intentional duplicates: the script is
the deterministic execution surface, this runbook is the
operator-readable surface that explains intent + verifies the script's
output at every step.

**Any future spec amendment MUST update both files together.** Drift
between runbook commands and script behavior is a deployment hazard:
the operator copy-pastes the runbook's command, the script silently
runs a slightly different command (or vice versa), and the cutover
fails in a way that's hard to root-cause because the documentation
and the automation disagree.

Pre-PR review on any plan touching spec § 8 must grep both files and
assert content alignment — specifically the T+00, T+05, T+07, T+08,
T+15, T+45, T+50, T+55 commands. The verify command at the top of this
file's plan (Task 1) checks the line count + cross-reference strings;
future audits should extend to command-by-command parity.

---

## References

- Spec: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 8
- Rollback: `runtime/migration/02-rollback-runbook.md`
- Decisions: `runtime/migration/02-cutover-decisions.md`
- Telegram bot rotation detail: `runtime/migration/02-telegram-bot-rotation.md`
- WhatsApp deauth detail: `runtime/migration/02-whatsapp-deauth.md`
- OpenClaw cron inventory: `runtime/migration/openclaw-cron-inventory.json`
- Executable: `runtime/deploy/cutover.sh` (Plan 03a)
- Rollback executable: `runtime/deploy/rollback.sh` (Plan 03a)
- SIGHUP handler: `runtime/daemon/main.ts` + `runtime/daemon/sighup.test.ts` (Plan 06)
- Credential provisioning: `runtime/deploy/provision-credentials.sh` (Plan 01a)
- Phase 0 VPS audit: `runtime/migration/00-vps-audit.md`
- Plan 01a (systemd unit + credentials)
- Plan 01b (cred-bootstrap.ts + authProfile schema)
- Plan 02a (archive-openclaw.sh + retention timer)
- Plan 02b (Telegram rotation + WhatsApp deauth wrappers)
- Plan 03a (cutover.sh + rollback.sh + test-cutover.mjs)
- Plan 04 (PR-triage agent — uses `v2-gh-token` with `read:org`)
- Plan 06 (SIGHUP credential-reload handler — `cred-reload-fired` telemetry kind)
- Plan 07b (cron-migration inventory — `openclaw-cron-inventory.json`)
