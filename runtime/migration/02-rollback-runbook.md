# 02 — Rollback Runbook (Phase 2 cutover, ≤4-min reverse path)

**Owner:** Santiago
**Wall-clock target:** ≤4 minutes (meets ≤5-min spec)
**Plan:** `.iago/plans/feature-phase-2-vps-bootstrap/03b-cutover-rollback-runbooks.md`
**Spec source:** `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 9
**Executable companion:** `runtime/deploy/rollback.sh` (Plan 03a artifact)
**Forward path:** `runtime/migration/02-cutover-runbook.md` (the runbook this reverses)

When in doubt during the cutover window, **invoke rollback without
hesitation**. The forward path (`02-cutover-runbook.md`) is engineered
so that any of the 6 detection signals below means the right move is
rollback, not heroics-mode debugging in production.

---

## 1. Detection

Detection triggers (any of these → execute rollback):

| Signal | Where to see it | Threshold |
|---|---|---|
| journal ERROR | `journalctl -u iago-os-v2-daemon.service` | ≥3 ERROR lines in 60s |
| Daemon refuses to start | `systemctl status iago-os-v2-daemon.service` | "failed" state OR start-limit-hit |
| Telegram /agents no reply | Santiago's phone | No response within 60s of sending |
| IPC socket missing | `ls /var/lib/iago-os/daemon-state/ipc.sock` | File absent >30s after start |
| Approval handshake breaks | T+15 canonical workflow test | No approval message arrives within 60s |
| Santiago command | `"rollback"` typed in any terminal | Immediate, no question |

The Santiago-command trigger is intentional: any gut-level "this is
going wrong" beats waiting for a measurable threshold. The forward
runbook is deliberately conservative on rollback triggers because the
rollback path is fast (≤4 min) and reversible. Erring toward rollback
is the right default.

---

## 2. Automated watchdog (T+10 only — discontinue after T+20 of successful operation)

Run this in a separate terminal at T+08; abort with Ctrl-C at T+20 if
all good. The watchdog covers the highest-risk early-cutover window
when Santiago's attention is split between the phone (Telegram) and
the Tailscale SSH terminal.

```bash
# Run in a separate terminal at T+08; abort with Ctrl-C at T+20 if all good
while true; do
  STATUS=$(tailscale ssh root@srv1456441 -- 'systemctl is-active iago-os-v2-daemon.service' 2>&1) || STATUS="ssh-error"
  if [[ "$STATUS" != "active" ]]; then
    echo "*** ROLLBACK TRIGGER: daemon state = $STATUS (ssh-error means VPS unreachable, not necessarily daemon down) ***"
    # Audible alert (Windows beep)
    printf '\a'
    break
  fi
  sleep 15
done
```

Polling cadence (15s) is the right tradeoff: fast enough to catch a
crash inside the watchdog window, slow enough that Tailscale SSH
overhead doesn't burn the operator's bandwidth or pile up on the
journal.

---

## 3. Rollback steps

The block below mirrors spec § 9 verbatim — DO NOT summarize or
re-paraphrase. In a crisis, the operator opens this file and runs the
exact commands; any drift from spec is a hazard.

```
T+R+0:00  ROLLBACK START. Decision is made; execute without hesitation.

T+R+0:30  Stop the v2 daemon
            tailscale ssh root@srv1456441 -- 'systemctl stop iago-os-v2-daemon.service && systemctl disable iago-os-v2-daemon.service'
          Expected: clean stop (TimeoutStopSec=30s ceiling).
          Verification:
            tailscale ssh root@srv1456441 -- 'systemctl is-active iago-os-v2-daemon.service'
          Expected: "inactive"

T+R+1:30  Restore the OLD Telegram bot token
          Two paths depending on what was actually rotated:
          - If § 3 BotFather revocation already happened: must issue
            another /revoke on BotFather to get a fresh token, then
            update the OPENCLAW config to use that fresh token. Old
            tokens cannot be un-revoked.
          - If § 3 revocation has NOT happened yet (rollback before
            T+02): OpenClaw token is still valid; skip this step.

          For the post-T+05 path (the common case):
            (in Telegram) Message @BotFather → /mybots → bot →
              API Token → Revoke (gives fresh token)
            Save fresh token. Edit OpenClaw config.

            Safe form — token never in shell history or process argv:

            read -rs FRESH_TOKEN
            # (paste the fresh token at the prompt above — input is
            #  suppressed and not echoed; press Enter when done)

            # Pipe a single-quoted patch script via stdin (bash -s).
            # FRESH_TOKEN is forwarded via SendEnv — never on argv.
            # <<'PATCH' prevents local shell expansion; $FRESH_TOKEN
            # expands on the remote side from the forwarded env var.
            FRESH_TOKEN="$FRESH_TOKEN" \
              tailscale ssh -o SendEnv=FRESH_TOKEN root@srv1456441 -- 'bash -s' <<'PATCH'
: "${FRESH_TOKEN:?FRESH_TOKEN env var not set}"
umask 0077
cp ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
jq --arg t "$FRESH_TOKEN" '.channels.telegram.botToken = $t' \
  ~ilsantino/.openclaw/openclaw.json > ~ilsantino/.openclaw/openclaw.json.tmp \
  && mv ~ilsantino/.openclaw/openclaw.json.tmp ~ilsantino/.openclaw/openclaw.json
chmod 0600 ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
chown ilsantino:ilsantino ~ilsantino/.openclaw/openclaw.json ~ilsantino/.openclaw/openclaw.json.pre-rollback
PATCH

T+R+2:30  Start OpenClaw
            tailscale ssh root@srv1456441 -- 'su - ilsantino -c "systemctl --user enable --now openclaw-gateway.service"'
          Verification:
            tailscale ssh root@srv1456441 -- 'su - ilsantino -c "systemctl --user is-active openclaw-gateway.service"'
          Expected: "active"

T+R+4:00  Telegram smoke test (phone side)
            Send "/status" or any OpenClaw command to the bot.
          Expected: OpenClaw replies as it did pre-cutover.
          IF NO REPLY: this is a second failure. Escalate to Sebas
          via Signal or phone call (Telegram is the failure surface —
          do not escalate via Telegram) and investigate journal:
            tailscale ssh root@srv1456441 -- 'journalctl --user-unit openclaw-gateway.service --since "5 minutes ago"'

T+R+5:00  ROLLBACK COMPLETE. OpenClaw serving. v2 daemon stopped.
```

---

## 4. State preservation

**Keep `/var/lib/iago-os/daemon-state` intact after rollback.**
Reasoning (verbatim from spec § 9):

- The failed run's `session.jsonl` event logs are the primary forensic
  surface for debugging.
- `markers/*.daemon-stop` reveal what graceful-vs-crash state the
  agents were in when the failure hit.
- `telemetry/<date>.ndjson` captures every stage event.
- Disk cost: <50 MiB even after weeks of dev — preservation cost is
  zero.
- If state corruption WAS the failure mode, rollback to OpenClaw is
  unaffected (OpenClaw reads its own dir under
  `/home/ilsantino/.openclaw/`).

Only wipe state-root if a subsequent debug session conclusively
determines the state files themselves caused the failure AND a fresh
re-cutover is being attempted. Even then: tar the state-root first
before wiping.

---

## 5. Target wall clock

| Step | Wall clock |
|---|---|
| Stop v2 daemon | 0:30 |
| BotFather re-rotate (if needed) | 1:00 |
| Patch OpenClaw config | 0:30 |
| Start OpenClaw | 0:30 |
| Telegram smoke test | 1:30 |
| **Total** | **4:00** |

Within Santiago's 5-min spec. The most variable step is the BotFather
re-rotate — if it's a pre-T+05 rollback (token not yet revoked) the
total drops to ~2:30. The post-T+05 case is the worst case and still
clears the spec ceiling with ~60s of margin.

---

## 6. Post-rollback required actions

After T+R+5:00, before stepping away:

1. **Do NOT delete `/var/lib/iago-os/daemon-state`** — preserve for
   root-cause analysis. The failed run's session-logs, markers, and
   telemetry are diagnostic.
2. **Do NOT re-attempt cutover today.** Schedule a debug session in
   the next 24h. The rollback succeeded; the productive next move is
   a deliberate post-mortem, not a same-day retry that compounds
   fatigue.
3. **Write incident note:**
   `.iago/incidents/<YYYY-MM-DD>-v2-cutover-failure.md`. Include:
   failure signal, journal capture, what was tried, what was rolled
   back.
4. **Update `.iago/STATE.md` Open row** with the incident (per
   `.claude/rules/git-workflow.md` STATE.md discipline).
5. **Notify Sebas** if the failure mode is unclear or touches CTO
   infra patterns. Telegram for non-urgent comms (OpenClaw is back up
   and serving); Signal/phone for ambiguous CTO-side issues that
   need a same-day eyes-on response.
6. **Sync 1Password after a post-T+05 rollback.** After T+R+1:30 you
   pasted a second fresh token into OpenClaw. The 1Password vault item
   `v2-daemon-telegram-bot::token` still holds the **first** rotation
   token (set at T+02), which is now dead (BotFather revocations are
   cumulative). Update `v2-daemon-telegram-bot::token` in 1Password
   with the rollback token before stepping away — any subsequent
   `provision-credentials.sh telegram-token` will read from 1Password,
   and provisioning a dead token silently breaks re-cutover.

---

## 7. Reference to `rollback.sh`

The executable in `runtime/deploy/rollback.sh` (Plan 03a artifact)
automates the deterministic parts of this runbook:

- T+R+0:30 v2 daemon stop + disable.
- T+R+2:30 OpenClaw re-enable + start.
- T+R+4:00 OpenClaw `is-active` verification.

**The BotFather re-rotate at T+R+1:30 is manual + interactive.**
BotFather has no API for token rotation; the operator must use the
Telegram UI. The script PAUSES at T+R+1:30 with a `MANUAL:` prompt
that explicitly asks Santiago to confirm whether the original § 3
revocation happened (common case YES → re-rotate required; rare case
NO → skip to T+R+2:30).

**Operator MUST have BotFather UI open BEFORE triggering rollback.**
This compresses the manual step to ~60 seconds. If BotFather is not
already open at rollback-decision time, the operator opens it FIRST,
then triggers `rollback.sh`. Without this pre-step, the 4-minute
target slips to 5+ minutes while Santiago hunts for BotFather inside
Telegram.

**Stale lock breakage.** `rollback.sh` acquires
`/var/lock/iago-cutover.lock` (shared with `cutover.sh`). If
`cutover.sh` crashed mid-run, `rollback.sh` will exit immediately with
"another cutover/rollback is running" and no further output. Break the
stale lock only when certain no other process is holding it:

```bash
tailscale ssh root@srv1456441 -- 'rm -f /var/lock/iago-cutover.lock /var/lock/iago-cutover.lock.pid'
```

Then re-run `rollback.sh`.

WhatsApp deauth (cutover T+30) is **not undone on rollback** per
`runtime/migration/02-whatsapp-deauth.md` § 7 — a successful
WhatsApp deauth is intentionally one-way: re-enabling WhatsApp on
the rolled-back daemon would require re-running URL verification +
re-subscribing webhooks, which is a Phase 6+ effort. Acceptable
because WhatsApp is **out of scope** for v2 (Telegram-only); the
deauth standing across the rollback is the correct end state.

---

## References

- Spec: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 9
- Forward path: `runtime/migration/02-cutover-runbook.md`
- Decisions: `runtime/migration/02-cutover-decisions.md`
- WhatsApp deauth (not undone): `runtime/migration/02-whatsapp-deauth.md`
- Executable: `runtime/deploy/rollback.sh` (Plan 03a)
- Phase 1 rollback pattern: `runtime/migration/phase-1-rollback.md`
