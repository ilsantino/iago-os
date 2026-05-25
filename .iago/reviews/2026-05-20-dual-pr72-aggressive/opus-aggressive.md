# Opus 4.7 Adversarial Review — PR #72 (Plan 03b runbooks)

Reviewer: Claude Opus 4.7 subagent
Target: feat/phase-2-03b-cutover-runbooks against origin/main
Date: 2026-05-20
Independence: did NOT read Codex output, did NOT read PR #72 comments

Verdict: BLOCK

## Summary

PR #72 ships operator-facing runbooks for a production cutover scheduled 5 days out. As docs they read well, but they are not docs — they are production-deploy code that ships embedded bash/ssh/scp/jq/age commands an operator will execute against a live VPS during a 60-minute window with a 4-minute rollback budget. Treated as code, the diff has three Critical bugs that will materially affect the cutover: (1) the rollback runbook's "RECOMMENDED" heredoc both leaks the bot token through local variable expansion AND contains a broken jq filter that will fail to parse, leaving OpenClaw bricked under rollback pressure; (2) the T+05 credential-provisioning step provisions only `telegram-token` while the shipped `cutover.sh` provisions `telegram-token gh-token` — operator-followed runbook ends the cutover with no `iago-gh-token.cred` on disk, breaking Plan 04 PR-triage 12 hours later in an unwatched window; (3) the T+15 canonical workflow test in the runbook is a raw JSON file-drop with an unverified schema while the shipped script runs a different 5-step IPC interaction — the doc and the automation are testing two different things, so test "results" are not comparable across the two execution paths. Beyond the Criticals: 7 High findings (rollback boundary documented at T+05 should be T+02; missing `tasks/pending/` subdir creation; Day -1 git checkout deployment unspecified; secret leakage in heredoc body; silent failure modes in approval-gate timeouts; unverified SIGHUP handler in daemon binary), 8 Important findings (Telegram approval UX, watchdog ssh-failure handling, log-mode comment misleading, ndjson target conflation, verification command prints token chars, race window during rollback stop, doc claims TPM that VPS likely lacks, missing `IAGO_ROLLBACK_SKIP_TOKEN` flag documentation), and 5 Medium/Minor findings (subdir contracts, error propagation, heredoc quoting, wall-clock budget realism, decisions-log spec-source clarity, wake-check terminology). Recommend BLOCK until at minimum the 3 Criticals and the documented-but-not-implemented rollback boundary (T+02 vs T+05) are corrected. Most of the High/Important findings are fixable in a follow-up commit on this PR.

## Findings

### [Critical] Rollback runbook RECOMMENDED heredoc leaks bot token in process args AND fails jq syntax — 02-rollback-runbook.md:99-106

The "RECOMMENDED" form at T+R+1:30 has two compounding bugs that will make the rollback fail under pressure or leak the token, or both:

```bash
FRESH_TOKEN=<paste-fresh-token-here>
tailscale ssh root@srv1456441 'su - ilsantino' <<EOF
  cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.pre-rollback
  jq --arg t "$FRESH_TOKEN" \
    '.channels.telegram.botToken = \$t' \
    ~/.openclaw/openclaw.json > ~/.openclaw/openclaw.json.tmp \
    && mv ~/.openclaw/openclaw.json.tmp ~/.openclaw/openclaw.json
EOF
```

Bug 1 — **token leak via expansion before SSH**: the heredoc is unquoted `<<EOF`, so the LOCAL bash expands `$FRESH_TOKEN` BEFORE sending the body to `ssh`. The expanded body — containing the live bot token — is then written via stdin to the remote shell, which `su - ilsantino` runs. The token appears in `journalctl` if su logs argv, may appear in shell history on either side, and crucially exists in the local terminal's scrollback (operator's Git Bash window) for the rest of the cutover window. Compare to the shipped `rollback.sh:319-357` pattern which writes a static patch script body to disk and forwards `FRESH_TOKEN` via `SendEnv`, never expanding it on argv.

Bug 2 — **jq filter is broken**: `'.channels.telegram.botToken = \$t'` — the backslash before `$t` is inside SINGLE QUOTES, so it does NOT escape the dollar sign. It is sent to jq literally as `.channels.telegram.botToken = \$t`. jq will parse `\$t` as an invalid expression and exit non-zero. The cutover-runbook test never ran this command in the dry-run harness because the harness exercises `rollback.sh`, not the doc's heredoc.

Bug 3 — **first arg form `'su - ilsantino'` not `--` separator**: `tailscale ssh root@srv1456441 'su - ilsantino' <<EOF` — tailscale ssh treats `'su - ilsantino'` as the command-string positional, and the heredoc lands on stdin of the LOCAL tailscale ssh process, not of su on the remote. The interaction with su's interactive mode is implementation-defined and likely just hangs.

Why it matters in this PR's context: under rollback pressure, Santiago will see "RECOMMENDED" and follow this form. The 4-min budget collapses to 10+ minutes of debugging. Worse, the live bot token sits in the operator's terminal scrollback after copy-paste.

Recommended fix: delete the "RECOMMENDED" block entirely and tell the operator to invoke `rollback.sh` (which already handles SendEnv FRESH_TOKEN + tempfile-over-scp safely). If the doc must show a manual form, mirror the shipped script: write a tempfile, scp it, invoke with FRESH_TOKEN via SendEnv. Both alternative blocks are incorrect; both should go.

### [Critical] Doc-vs-script parity break: runbook provisions only telegram-token at T+05, script provisions telegram-token AND gh-token — 02-cutover-runbook.md:267 vs cutover.sh:461

The runbook at T+05:00 says:

```bash
bash /opt/iago-os/runtime/deploy/provision-credentials.sh telegram-token
```

The shipped `cutover.sh:461` runs:

```bash
bash "$DEPLOY_DIR/provision-credentials.sh" telegram-token gh-token
```

The script provisions BOTH telegram-token AND gh-token at T+05 because Plan 04 PR-triage agent needs `iago-gh-token.cred` present on disk by the time the cutover completes. The runbook tells the operator to provision only the telegram-token.

Why it matters: if the operator follows the runbook manually (e.g., resuming a partial cutover, debugging a script failure and re-running step-by-step from the runbook), they will end T+60 with NO `iago-gh-token.cred` on the VPS — Plan 04 PR-triage agent fails its first cron tick with a missing-credential error 12 hours later, in an environment Santiago is no longer watching. The Day -1 step (v) DOES correctly provision both — so the gap is specifically in the T+05 cutover-window step description, which is what the operator follows during the actual window.

Recommended fix: change the runbook T+05 command to `bash /opt/iago-os/runtime/deploy/provision-credentials.sh telegram-token gh-token` and update the verification block at line 271 to also decrypt `iago-gh-token.cred`. This matches the shipped script exactly.

### [Critical] Path translation leak in T+15 canonical workflow test: heredoc writes a task with `needsApproval` field that doesn't match the daemon's task schema — 02-cutover-runbook.md:301-316

The T+15 canonical workflow test uses:

```bash
TASK_ID=$(node -e "console.log(crypto.randomUUID())")
cat > /var/lib/iago-os/daemon-state/tasks/pending/claude-main__${TASK_ID}.json <<EOF
{ "prompt": "Test prompt from cutover — please respond OK", "needsApproval": true }
EOF
```

Two problems:

(a) The shipped `cutover.sh:619-626` instead documents the canonical workflow test as a 5-step IPC interaction (`/agents`, `/start hello-world`, `/sessions`, send text, `/stop <session-id>`) — NOT a raw task-file drop into the pending dir. The drop-a-JSON-file approach in the runbook bypasses the daemon's IPC layer and the schema validation that lives there; the daemon picks up the task only if its file-watcher accepts the schema. There is no doc-vs-script parity at all on this step — they're testing two different things.

(b) Even if file-drop were supported, the schema `{ "prompt": ..., "needsApproval": true }` likely does not match what `runtime/daemon/task-protocol.ts` (or equivalent) expects. The runbook does not reference the task schema source-of-truth. Operator copy-pastes, daemon ignores file (or worse, panics on parse), test "fails" by silence, rollback triggers — losing the entire cutover for a doc bug.

Why it matters: this is the canonical test that proves end-to-end Telegram-approval handshake works. If it's wrong, either (a) the test never actually exercises approval (silently passes), or (b) the test never works and operator rolls back unnecessarily. Either failure shape is in the highest-stakes 60-min window.

Recommended fix: replace lines 301-316 with the shipped script's IPC sequence (5-step copy-paste). The runbook should match the script, NOT introduce a parallel test surface that diverges. If a raw file-drop test is genuinely needed, validate the schema against `runtime/daemon/*.ts` first and document the canonical kind/version fields.

### [High] Rollback runbook documents wrong path: bot token rotation discusses revoking but cutover already revoked at T+02 — internal contradiction with rollback.sh

The rollback runbook at section 3 T+R+1:30 (lines 82-119) presents two cases:

> - If § 3 BotFather revocation already happened: must issue another /revoke on BotFather to get a fresh token, then update the OPENCLAW config to use that fresh token.
> - If § 3 revocation has NOT happened yet (rollback before T+05): OpenClaw token is still valid; skip this step.

But the cutover sequence (02-cutover-runbook.md:258-264) puts BotFather revocation at T+02, BEFORE T+05 credential provisioning. So "rollback before T+05" still post-dates revocation. The runbook's "rollback before T+05" case (skip token re-rotate) is therefore unreachable in practice — any rollback after T+02 needs re-rotation.

The shipped `rollback.sh` correctly recognizes this: `IAGO_ROLLBACK_SKIP_TOKEN=1` is only invoked when the cutover script never reached T+02 (i.e., pre-flight failure). The runbook should mirror this: the boundary is T+02, not T+05.

Why it matters: under rollback pressure at e.g. T+04, Santiago reads "If § 3 revocation has NOT happened yet (rollback before T+05): OpenClaw token is still valid", concludes he doesn't need to re-rotate, skips that step, OpenClaw starts with a dead token, smoke test fails, escalation. The wall-clock budget overshoots.

Recommended fix: change both boundaries from "before T+05" to "before T+02" (BotFather revocation step). Even better — delete the conditional entirely and instruct: "Always re-rotate. If the original token wasn't revoked, the re-rotate is a free safety net; if it was revoked, you need this step. There is no case where you should skip it under rollback pressure."

### [High] Day -1 step (i) creates daemon-state/log dirs but never creates the tasks/pending subdir that T+15 canonical workflow test writes to — 02-cutover-runbook.md:51-62 vs 301-316

Day -1 prep step (i) runs:

```bash
mkdir -p /var/lib/iago-os/daemon-state /var/log/iago-os
```

The T+15 canonical workflow test then writes to:

```
/var/lib/iago-os/daemon-state/tasks/pending/claude-main__${TASK_ID}.json
```

The `tasks/pending/` subdir is NOT created by Day -1 step (i). Whether the daemon creates it on startup depends on `runtime/daemon/*.ts` initialization (not part of the runbook scope). If the daemon hasn't created it by T+15, the heredoc `cat > .../tasks/pending/<id>.json` fails (no such directory), the test "fails" by file-not-found, Santiago rolls back.

Recommended fix: add to Day -1 step (i) the explicit `mkdir -p /var/lib/iago-os/daemon-state/{tasks/pending,tasks/resolved,markers,telemetry,agents}` so every subdir referenced in the runbook exists before T+00. Then the daemon either uses them as-is (correct) or its initialization overrides them with idempotent `mkdir -p` (also correct). Either way, the canonical test step doesn't depend on the daemon having run yet. Also drop the unused subdirs if daemon initialization is the real owner.

### [High] systemd `/opt/iago-os` git checkout assumption is unverified by Day -1 step (vii) and contradicts the WARNING in cutover.sh — 02-cutover-runbook.md:142-148

Day -1 step (vii) checks `test -d /opt/iago-os/.git` but does NOT create the checkout if missing. The pre-flight gate at line 203 then asserts:

> v2 daemon code deployed to VPS at `/opt/iago-os` (git clone + `npm install` + `npm run build` inside `runtime/`)

The runbook has no command to do this initial deployment. Either it was done in a prior plan (01a / 01b) or the operator must figure it out at T-24h with no guidance. The Day -1 verify section is silent on what to do if the gate item fails.

Worse, if the operator runs `git clone https://github.com/...iago-os.git /opt/iago-os` at T-24h, the runbook never tells them which branch/SHA to check out. Phase 1 hello-world acceptance is at SHA `4ee40ee` (mentioned at line 202); is that the SHA to deploy? Or does Phase 2 land on a later SHA? The runbook is ambiguous.

Recommended fix: add a Day -1 step (vii-a) that documents the explicit `git clone + checkout SHA + npm ci + npm run build` sequence. Use the SHA being merged for this PR's cutover window (Sunday 2026-05-25 20:00) — pin the exact ref the operator should deploy. The current state where the runbook assumes the code is already there is a Day -1 prep failure mode that surfaces 24h before cutover (good) but with no resolution path documented (bad).

### [High] Rollback runbook lines 102-105 use `$FRESH_TOKEN` inside an UNQUOTED heredoc — secret leak — 02-rollback-runbook.md:100-106

Reiterating with focus on the unquoted heredoc: in shell, `<<EOF` expands variables in the body; `<<'EOF'` does not. The runbook uses `<<EOF`, so `$FRESH_TOKEN` is expanded LOCALLY before the body is sent to ssh's stdin. Concretely the line:

```bash
jq --arg t "$FRESH_TOKEN" \
```

is sent over the wire as:

```bash
jq --arg t "1234567890:ABC-xyz..." \
```

The expanded body appears in:
- The operator's terminal scrollback (visible to anyone with shoulder/screenshare access for the rest of the session)
- Anywhere ssh logs the stdin stream (unusual but configurable)
- The local shell's command-substitution audit logs if any are configured

Compare to the safer pattern in `rollback.sh:355-357`:

```bash
FRESH_TOKEN="$FRESH_TOKEN" \
  tailscale ssh -o SendEnv=FRESH_TOKEN "${VPS_USER}@${VPS_HOST}" -- \
    "bash ${remote_patch}"
```

The variable is forwarded via SSH SendEnv as a process env var on the remote, never appearing in the wire stream as cleartext within the command body.

Recommended fix: replace the "RECOMMENDED" heredoc with the SendEnv pattern, or delete it entirely and direct operators to run `rollback.sh` (which already does this safely). At minimum, switch to `<<'EOF'` (single-quoted heredoc) and have the operator type the literal token at the jq line as the script is sent — but this still leaves the token in the operator's terminal. SendEnv is the only secure pattern.

### [High] No documented behavior when operator gets distracted during Telegram approval gate — runbook silent on timeout state

The runbook section T+15 (lines 301-316) puts the operator at "Tap 'Allow'" to approve. The runbook does NOT specify:

- What if the operator gets distracted for 5 minutes between the approval message arriving and tapping "Allow"?
- What if the operator's phone screen times out and the approval message is buried under other notifications?
- What if the operator accidentally taps "Deny"?
- What if the approval message never arrives (because of the schema bug in finding #3 above) — how long does the operator wait before declaring the test failed?

The rollback runbook detection signals include "T+15 canonical workflow test → No approval message arrives within 60s" but the cutover runbook itself doesn't tell the operator to set a 60-second mental timer.

Why it matters: in a 60-minute cutover window with Santiago alone at keyboard, a missed-tap scenario could leave the daemon in an indeterminate state. Did the approval timeout? Did the daemon drop the task? Is the test still running? The runbook gives no guidance on the state machine.

Recommended fix: add to T+15 step:

> Set a 60-second mental timer from "send the task" to "approval message arrives". If approval message does NOT arrive within 60s, treat as rollback trigger (matches rollback runbook § 1 row 5). If approval message arrives but operator does not tap within 5 minutes, the daemon's approval timeout (configured in `runtime/daemon/*.ts`) will mark the task as denied — the test is then INCONCLUSIVE, not failed. Re-issue from scratch with a fresh TASK_ID. Document outcome in the post-cutover digest.

### [Important] Day -1 step (viii) SIGHUP verification only checks `KillSignal=SIGTERM` line — does NOT verify SIGHUP handler is actually wired in daemon code — 02-cutover-runbook.md:160-162

```bash
tailscale ssh root@srv1456441 -- 'systemd-analyze cat-config iago-os-v2-daemon.service | grep -E "KillSignal=SIGTERM"'
```

This grep proves the systemd unit's KillSignal is SIGTERM (which is unchanged from Plan 01a — useful to confirm no regression). It does NOT prove `runtime/daemon/main.ts` registers a `process.on("SIGHUP", ...)` handler. The runbook's own comment at line 156 says "The handler is in the Node process (Plan 06 main.ts edit + sighup.test.ts), not in the systemd unit." — so checking the systemd unit's KillSignal tells you nothing about whether the SIGHUP handler is in the daemon binary.

Why it matters: at T+60 post-cutover the operator runs:

```bash
tailscale ssh root@srv1456441 -- 'systemctl kill -s SIGHUP iago-os-v2-daemon.service'
```

If Plan 06 didn't merge in time (or merged with a broken handler), the daemon receives SIGHUP, has no handler, and dies (default Node behavior on SIGHUP without a registered listener is to terminate). The cutover window is over, Santiago has just killed the daemon, and the rollback runbook says SIGHUP failure is NOT a rollback trigger.

Recommended fix: replace the cat-config grep with a direct check that the daemon binary has the handler:

```bash
tailscale ssh root@srv1456441 -- 'grep -lE "process\\.on\\(.SIGHUP" /opt/iago-os/runtime/daemon/main.ts'
```

OR check the built artifact:

```bash
tailscale ssh root@srv1456441 -- 'grep -q SIGHUP /opt/iago-os/runtime/daemon/dist/main.js && echo present'
```

This actually proves the handler is in the running daemon's code.

### [Important] Telegram approval message recognition is operator-implicit, not documented — Failure mode shipping requirements unclear

The cutover runbook references the Telegram approval gate multiple times (T+15) but never documents what the approval message looks like, what buttons it has, what tapping each does, or how to recognize a "yes" vs "no" outcome on the daemon side.

The Telegram approval flow is presumably implemented in some `runtime/daemon/telegram-adapter.ts` or similar (Plan 05 work?). The runbook treats it as common knowledge but Santiago will be operating under pressure and reading this runbook precisely because he wants to be sure.

Recommended fix: add to T+10 (right after "send /agents") a one-line description:

> Expected approval message format: "Approve task <id>? prompt: '<truncated prompt>'" with two inline buttons "Allow" (left) and "Deny" (right). Tapping "Allow" posts to the daemon's IPC, which writes the resolved task to `/var/lib/iago-os/daemon-state/tasks/resolved/<file>.json` (verified in T+15). Tapping "Deny" writes the task to `tasks/resolved/` with `decision: "deny"`.

If this format differs from actual implementation, fix the runbook to match. The point is: the operator should know what they're looking for BEFORE T+15 fires.

### [Important] Rollback automated watchdog (02-rollback-runbook.md:46-57) polls but never logs — silent on what to do if watchdog and Tailscale both die

The watchdog snippet:

```bash
while true; do
  STATUS=$(tailscale ssh root@srv1456441 -- 'systemctl is-active iago-os-v2-daemon.service' 2>/dev/null)
  if [[ "$STATUS" != "active" ]]; then
    echo "*** ROLLBACK TRIGGER: daemon state = $STATUS ***"
    printf '\a'
    break
  fi
  sleep 15
done
```

Problems:

(a) `2>/dev/null` swallows ssh errors. If Tailscale drops (operator's home WiFi blips), STATUS=`""`, which doesn't equal "active", so the loop fires a false-positive rollback trigger. Operator panics, runs rollback against a perfectly-fine daemon. Better: distinguish "ssh failed → unknown" from "ssh succeeded but daemon is dead". E.g., check `$?` of the ssh call.

(b) No timestamp in the trigger output. When the operator screenshots/copies the trigger line into the incident note, the time is missing.

(c) `printf '\a'` is the only audio signal. On many modern Windows terminals (Windows Terminal, Git Bash MinTTY) `\a` is silently mapped to a visual flash that's easy to miss if the operator is looking at a phone.

(d) The watchdog runs in a "separate terminal" but the runbook never tells the operator HOW to start that terminal in the same Tailscale-authed session, or what to do if Tailscale auth is per-shell.

Recommended fix:

```bash
while true; do
  if ! STATUS=$(tailscale ssh root@srv1456441 -- 'systemctl is-active iago-os-v2-daemon.service' 2>&1); then
    echo "$(date -u +%H:%M:%S) WATCHDOG: ssh failed (output: $STATUS) — could be transient, will recheck in 15s"
    sleep 15
    continue
  fi
  if [[ "$STATUS" != "active" ]]; then
    echo "$(date -u +%H:%M:%S) *** ROLLBACK TRIGGER: daemon state = $STATUS ***"
    printf '\a\a\a'  # triple beep
    break
  fi
  sleep 15
done
```

### [Important] Day -1 step (i) `chmod 0750` on log dir is silently inconsistent with step (i) action and verify line — internal contradiction

Step (i) action (line 52):

```bash
mkdir -p /var/lib/iago-os/daemon-state /var/log/iago-os && chown iago:iago /var/lib/iago-os/daemon-state /var/log/iago-os && chmod 0700 /var/lib/iago-os/daemon-state && chmod 0750 /var/log/iago-os
```

Step (i) verify (line 58):

```bash
tailscale ssh root@srv1456441 -- 'stat -c "%U:%G %a" /var/lib/iago-os/daemon-state /var/log/iago-os'
# expect:
#   iago:iago 700  (daemon-state)
#   iago:iago 750  (log dir — matches cutover.sh pre-flight gate)
```

Now in `cutover.sh:296`, pre-flight check 8 does:

```bash
vssh "mkdir -p /var/log/iago-os && touch /var/log/iago-os/cutover.ndjson && chmod 0640 /var/log/iago-os/cutover.ndjson"
```

The cutover.sh pre-flight gate creates the file at 0640 BUT it does NOT chown/chmod the parent dir. If Day -1 step (i) sets the dir to 0750 owned by `iago:iago`, then cutover.sh's pre-flight (running as root) hits the dir as root → 0750 means owner+group r-x, root has access because it's root, so mkdir+touch succeed. But the resulting file is owned by ROOT, mode 0640, in a dir owned by `iago:iago`. The daemon (running as `iago`) then tries to APPEND to this file from `ndjson_write` and may or may not succeed depending on whether 0640 + iago-group membership grants write… and it doesn't (0640 = root rw, group r, others none — daemon as iago has read-only access).

Actually wait — checking ndjson_write at cutover.sh:166-180:

```bash
vssh "cat >> /var/log/iago-os/cutover.ndjson" <<< "$line"
```

That's running as root (vssh = `tailscale ssh root@$VPS_HOST`), so root writes to the file. Fine. The daemon does NOT write to `cutover.ndjson` — it writes to `daemon-state/telemetry/<date>.ndjson` which is in a separate directory. So this particular concern is mitigated.

BUT — the day -1 verify on line 61 says `iago:iago 750  (log dir — matches cutover.sh pre-flight gate)`. The "matches cutover.sh pre-flight gate" comment is misleading because cutover.sh's pre-flight does NOT verify the log dir mode — it only mkdir's (which is a no-op if the dir exists), touches the file, and chmods the file. It never verifies the parent dir is iago:iago / 750. So the comment is documentation-as-claim that no code enforces.

Recommended fix: either remove the misleading comment "matches cutover.sh pre-flight gate", or add an explicit pre-flight check in cutover.sh that verifies `/var/log/iago-os` is `iago:iago 750`. Choose one. The current state where a doc comment claims a property the script doesn't verify is exactly the doc-vs-script drift the coupling note (§ 9) warns against.

### [Important] `runtime/migration/02-cutover-runbook.md` ndjson_write target differs from what the runbook implies — `/var/lib/iago-os/daemon-state/telemetry/$(date +%Y-%m-%d).ndjson` vs `/var/log/iago-os/cutover.ndjson`

The runbook at T+45 (line 329) tells the operator to inspect:

```bash
head -20 /var/lib/iago-os/daemon-state/telemetry/$(date +%Y-%m-%d).ndjson
```

But `cutover.sh:178` writes its cutover-progress NDJSON to:

```bash
vssh "cat >> /var/log/iago-os/cutover.ndjson"
```

Two different files, two different schemas. The daemon writes the telemetry stream (`daemon-state/telemetry/<date>.ndjson`); the cutover script writes the cutover-progress log (`/var/log/iago-os/cutover.ndjson`). The runbook conflates them — the T+45 inspection should probably look at BOTH to verify "the cutover progressed AND the daemon emitted telemetry".

Why it matters: at T+45 the operator looks at one file, doesn't see expected events, panics. The cutover.sh's own progress log might be on the other file showing everything's fine.

Recommended fix: at T+45 show both:

```bash
echo "--- cutover progress (from cutover.sh) ---"
tailscale ssh root@srv1456441 -- 'tail -20 /var/log/iago-os/cutover.ndjson'
echo "--- daemon telemetry (from daemon) ---"
tailscale ssh root@srv1456441 -- 'tail -20 /var/lib/iago-os/daemon-state/telemetry/$(date +%Y-%m-%d).ndjson 2>/dev/null'
```

### [Important] T+05 verification command at 02-cutover-runbook.md:271 prints first 10 chars of bot token to terminal — minor token disclosure

```bash
tailscale ssh root@srv1456441 -- 'systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | head -c 10 ; echo'
```

The first 10 characters of a Telegram bot token are the bot-ID prefix (e.g., `1234567890`) — which is PUBLIC INFO (it's the part before the colon, visible in any message from the bot via `getMe`). So this isn't a leak per se. BUT the runbook frames it as "Expected: first 10 chars of new bot token" — which suggests the operator is verifying secret material. If they assume that's the discriminator, they may compare partial tokens across rotations and conclude wrong things (e.g., "wait, the first 10 chars are the same as the OLD token" — they would be, the bot-ID doesn't change on rotation, only the part after the colon does).

Compare to `cutover.sh:484` which uses `systemd-creds decrypt ... | wc -c` — counts bytes, never prints token material. Cleaner pattern.

Recommended fix: change the runbook verification to:

```bash
tailscale ssh root@srv1456441 -- 'systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c'
# Expected: 46 or more bytes (Telegram bot tokens are 46+ chars).
```

This proves provisioning worked without printing token material, and matches the shipped script pattern.

### [Important] Rollback runbook references `/var/lib/iago-os/daemon-state` preservation but doesn't explain how to confirm v2 daemon has stopped writing to it — race window during rollback

The rollback runbook § 4 says:

> Keep `/var/lib/iago-os/daemon-state` intact after rollback.

But the rollback sequence stops the daemon at T+R+0:30. The daemon may have an in-flight task spawn / file write at the moment SIGTERM arrives. If `TimeoutStopSec=30s` fires before the daemon flushes a partial telemetry record, the state dir holds a half-written JSON line that confounds post-mortem analysis.

The shipped `rollback.sh:266-285` does the right thing — it asserts `is-active=inactive` after stop+disable and fails closed if still active. But the runbook doesn't tell the operator how to confirm the daemon has actually stopped writing. A `lsof | grep daemon-state` or `fuser /var/lib/iago-os/daemon-state` check would catch leftover file descriptors.

Recommended fix: add to T+R+0:30 a verify step:

```bash
tailscale ssh root@srv1456441 -- 'fuser /var/lib/iago-os/daemon-state 2>&1 | grep -v "^$" && echo "STILL OPEN" || echo "QUIESCENT"'
```

If "STILL OPEN" after the stop, escalate the stop with `systemctl kill -s SIGKILL`.

### [Important] Decisions log § 7 says credentials are "encrypted at rest under TPM/host-key combo" but Hostinger KVM 2 typically has no TPM — factual error

02-cutover-decisions.md line 222:

> Credentials sitting unused on disk for ~2 weeks until Phase 3 ships are encrypted at rest under TPM/host-key combo; unused-but-present is acceptable

Hostinger's KVM 2 virtual machines are KVM-based VPSes. They typically do not expose a vTPM by default; the host runs the TPM and the guest only sees what the host exposes. `systemd-creds` will fall back to host-key (`/var/lib/systemd/credential.secret`) when no TPM2 device is available. This is fine security-wise, but the doc claims "TPM" specifically.

Worse, the doc says "TPM/host-key combo" as if BOTH protect the secret. They don't — `systemd-creds` uses one OR the other (or neither, in which case it errors).

Why it matters: this is a decisions log meant to ground future decisions. A future operator reading "TPM" assumes hardware-rooted protection and may make architectural decisions on that basis (e.g., "we can store more sensitive material here, it's TPM-backed"). Factual sloppiness in a decisions log compounds over time.

Recommended fix: verify with `tailscale ssh root@srv1456441 -- 'systemd-creds --no-pager has-tpm2'` and document the actual answer. Replace "TPM/host-key combo" with the actual mechanism in use (likely "host-key, stored at `/var/lib/systemd/credential.secret`, root-only").

### [Important] Rollback runbook never mentions the `IAGO_ROLLBACK_SKIP_TOKEN=1` flag operators need under pre-T+02 rollback — drift from rollback.sh:290-302

The rollback.sh script has a critical flag `IAGO_ROLLBACK_SKIP_TOKEN=1` that the operator MUST set if rolling back before BotFather revocation occurred. The runbook never names this flag.

If the operator invokes `bash rollback.sh` after a pre-T+02 cutover failure (e.g., pre-flight gate failed and they want to clean up), the script will prompt them to paste a "fresh BotFather token" at T+R+1:30 — but no token was revoked, so this prompt is meaningless. Without the flag, the operator either fabricates a token (script then patches OpenClaw with garbage and OpenClaw fails to start) or gets stuck at the prompt.

Recommended fix: add a sentence at section 7 (Reference to rollback.sh) that says:

> If rollback fires BEFORE T+02 of cutover (BotFather token has NOT been revoked), invoke with: `IAGO_ROLLBACK_CONFIRM=YES IAGO_ROLLBACK_SKIP_TOKEN=1 bash rollback.sh`. This skips the manual token re-rotation step. For all other cases (rollback at or after T+02), invoke with: `IAGO_ROLLBACK_CONFIRM=YES bash rollback.sh` and the script will prompt for a fresh BotFather token.

### [Medium] Day -1 step (i) does not include `tasks/`, `markers/`, `telemetry/`, `agents/` subdirs — only top-level dir

Echoing finding above but specifically as a state-pre-creation issue: the daemon at first start needs to write to multiple subdirs under `daemon-state/`. If the daemon's initialization is best-effort (creates dirs as it needs them), step (i) is fine; if the daemon assumes they exist (and crashes otherwise), step (i) is incomplete. The runbook does not state the daemon's contract on this.

Recommended fix: pin the contract — either the daemon creates all subdirs on startup (no runbook fix needed, but document in the runbook that step (i) is fully sufficient) OR step (i) creates them all explicitly. Either is fine; the runbook should reflect the actual contract.

### [Medium] No error propagation discipline in Day -1 commands — `chmod` after `chown` after `mkdir` chained with `&&` but no pipefail context

Day -1 step (i):

```bash
tailscale ssh root@srv1456441 -- 'mkdir -p /var/lib/iago-os/daemon-state /var/log/iago-os && chown iago:iago /var/lib/iago-os/daemon-state /var/log/iago-os && chmod 0700 /var/lib/iago-os/daemon-state && chmod 0750 /var/log/iago-os'
```

This is fine as it stands — the `&&` chain stops at first failure. But there's no logging of which step failed. If `chown` fails because `iago` user doesn't exist yet (step ii hasn't run), the operator sees a `chown: invalid user: 'iago'` error but the prior `mkdir` succeeded (leaving root-owned dirs that step ii's user-creation can't fix). Now the operator has dirs owned by root that need explicit chown.

Recommended fix: reorder Day -1 prep to (ii) before (i): create the `iago` user first, then create the dirs that chown to iago. Currently step (i) chowns to a user that step (ii) creates — execution order is wrong if the steps are strictly sequential. The `getent || useradd` guard in (ii) makes the user-creation idempotent; running it first is harmless.

Alternative: split (i) into mkdir + (after ii) chown+chmod.

### [Medium] T+15 task-file write uses `crypto.randomUUID()` via `node -e` — implicitly assumes Node is on the operator's local box (but the cat heredoc runs on the VPS) — context confusion

Line 305-310:

```bash
tailscale ssh root@srv1456441 -- '
  TASK_ID=$(node -e "console.log(crypto.randomUUID())")
  cat > /var/lib/iago-os/daemon-state/tasks/pending/claude-main__${TASK_ID}.json <<EOF
{ "prompt": "Test prompt from cutover — please respond OK", "needsApproval": true }
EOF
'
```

This is a single-quoted argument to tailscale ssh, so the entire body runs on the VPS. `node -e` therefore runs on the VPS. That requires Node to be installed on the VPS — which it must be, since the daemon runs Node, fine. But the heredoc inside a single-quoted ssh argument has tricky escaping (the inner `${TASK_ID}` is intended to expand on the VPS, not locally — the single-quote wrapping of the whole ssh arg saves this).

Subtler issue: `${TASK_ID}` is expanded by the remote shell when it parses the heredoc body. So the heredoc is `<<EOF` (unquoted), which means any `$` in the JSON content also expands. The current JSON has no `$` so this is harmless TODAY. But if someone adds a `$prompt` placeholder or any field with `$` (e.g., for testing), the heredoc would silently strip it. Use `<<'EOF'` (single-quoted heredoc delimiter) to prevent variable expansion in the body — though then `${TASK_ID}` in the filename wouldn't work because the filename is outside the heredoc body, so it's actually fine. But: the `${TASK_ID}` reference is OUTSIDE the heredoc body (it's in the `cat > ...` filename arg). So `<<'EOF'` would actually work cleanly.

Recommended fix: use `<<'EOF'` to prevent silent variable expansion in JSON body. Also: consider whether `crypto.randomUUID()` requires Node 20+ (older Node 14/16 don't have it). The VPS audit said Debian 13, which ships Node 20+, so this is fine — but worth noting in the runbook that the command requires Node 20+.

### [Medium] Rollback runbook § 5 wall-clock table sums to 4:00 but individual rows sum to 4:00 ALREADY without operator dwell time — unrealistic budget

The table:

| Step | Wall clock |
|---|---|
| Stop v2 daemon | 0:30 |
| BotFather re-rotate (if needed) | 1:00 |
| Patch OpenClaw config | 0:30 |
| Start OpenClaw | 0:30 |
| Telegram smoke test | 1:30 |
| **Total** | **4:00** |

The "BotFather re-rotate" at 1:00 includes: open BotFather → /mybots → bot → API Token → Revoke → copy token. Under stress, with a phone keyboard, this is realistically 60-120 seconds. The "patch OpenClaw config" at 0:30 includes: SSH round-trip + jq invocation + chown/chmod + verify. SSH round-trip alone over Tailscale is 200-500ms; the rest is fast, so 30s is plausible.

But the "Telegram smoke test" at 1:30 budgets only 90 seconds for: send `/status`, wait for OpenClaw to receive Telegram update poll (Telegram polls long-poll every ~30s), process the message, send a reply, see the reply on phone. The OpenClaw poll interval alone can eat 30s; if OpenClaw just restarted, the first poll cycle may be longer.

Total realistic is closer to 4:30-5:00, which still meets the ≤5-min spec, but the 4:00 budget claim is optimistic. Under pressure, an overrun feels like failure even when it's within the real ceiling.

Recommended fix: change the total row to "4:00 (target) / 5:00 (ceiling per spec § 9)" so the operator knows what's "on time" vs "still acceptable". Match the rollback.sh script's own messaging which uses "wall-clock target 4:00".

### [Medium] Decisions log § 5 (FAST cutover) doesn't note that the spec was AMENDED on 2026-05-16 — risk of future readers thinking the spec endorses parallel-run

Section 5:

> The original v2 vision spec (docs/specs/iago-os-v2-vision.md § Phase Sequencing) framed Phase 2 as a parallel-run period during which OpenClaw and the v2 daemon both handle traffic, with a progressive cutover over days. Santiago overrode this 2026-05-16.

But the spec source cited at the top of the decisions log is `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` — i.e., the post-override spec. So which spec is the decisions log overriding? The vision-spec (the older, parallel-run framing) or the phase-2-bootstrap-spec (the post-override FAST framing)?

If the cited "spec source" is already post-override, the decision is documenting "what we already changed in the spec", not "what we're overriding". That's still useful (institutional memory) but the framing is misleading.

Recommended fix: clarify the relationship — "The vision-spec proposed parallel-run; Santiago overrode this on 2026-05-13 (chat decision); the override was baked into the 2026-05-16 phase-2-bootstrap-spec; the 2026-05-16 spec is the canonical source for this plan. This decisions-log entry records the override for institutional memory and lock-in against re-litigation."

### [Minor] Cutover runbook references "Plan 04 wake-check" without defining what wake-check is — terminology drift

Line 105:

> The `v2-gh-token` item MUST be a GitHub classic PAT scoped to `repo + read:org` (Plan 04 wake-check requires `read:org`)

"Wake-check" isn't defined anywhere in this runbook. A future operator reads "wake-check" and either has to chase Plan 04's docs to figure out what it means, or shrugs and provisions with whatever scopes feel right.

Recommended fix: one-line gloss: "Plan 04 wake-check (the PR-triage agent's GitHub-API polling loop) requires `read:org` scope to enumerate open PRs in the org".

### [Minor] Cutover runbook lines 437-455 reference `cutover.sh` MANUAL prompts at T+02, T+10, T+15, T+30 but the script only marks T+02, T+10, T+15, T+30 — fine, no drift. But T+15 in the script does NOT use the task-file-drop heredoc that the runbook documents — adjacent to finding #3 above

Just noting the parity gap from finding #3 also surfaces here: the doc-side claim "Manual steps remain operator-driven and are marked in the script with MANUAL: prompts. They are: T+02 BotFather, T+10 Telegram phone testing, T+15 phone-side approval tap on the canonical workflow test, T+30 WhatsApp deauth." matches the script. But the actual T+15 test BLOCK differs between the two — the script has a 5-step IPC interaction, the runbook has a JSON-file drop. The "MANUAL" prompt is the same; the test content is different. Mentioned for completeness.



## Verification methods used

Files read in full:
- `runtime/migration/02-cutover-runbook.md` (the PR diff)
- `runtime/migration/02-rollback-runbook.md` (the PR diff)
- `runtime/migration/02-cutover-decisions.md` (the PR diff)
- `runtime/deploy/cutover.sh` (sibling shipped script — PR #68)
- `runtime/deploy/rollback.sh` (sibling shipped script — PR #68)
- `runtime/deploy/provision-credentials.sh` (sibling shipped script — PR #62, partial — lines 1-200 of ~200)
- `.iago/plans/feature-phase-2-vps-bootstrap/03b-cutover-rollback-runbooks.md` (the plan)

Greps run:
- `scripts/vps-bootstrap` against `runtime/migration/` → no matches (good — path translation per Codex P0-2 fix landed cleanly; no leftover references)
- `cutover.sh|rollback.sh|provision-credentials.sh|archive-openclaw.sh|revoke-whatsapp.sh` against `02-cutover-runbook.md` → 22 references, all using the `runtime/deploy/` path; confirms canonical Gen 2 layout

Bash checks:
- `ls runtime/scripts/` → confirms `test-cutover.mjs`, `test-rollback.mjs`, `check-evidence.mjs`, `test-cutover.fixtures/` all present (decisions doc § 6 cross-reference valid)

Parity checks performed (doc-vs-script command-by-command):
- T+00 archive: runbook and script BOTH invoke `bash /opt/iago-os/runtime/deploy/archive-openclaw.sh` — MATCH
- T+05 credentials: runbook says `provision-credentials.sh telegram-token`, script does `telegram-token gh-token` — DRIFT (Critical finding)
- T+05 verification: runbook prints first 10 chars of token, script does `wc -c` — DRIFT (Important finding)
- T+07 daemon enable: runbook says `systemctl daemon-reload && systemctl enable --now`, script does sha256-compare-before-copy-unit + idempotent enable + 30s polling — DRIFT in safety/idempotency (Important — not blocking, the runbook is simpler than the script which is fine for human reading)
- T+08 verify: runbook says `journalctl --since "2 minutes ago" | tail -30 | look for daemon-start`, script does explicit grep with rollback trigger on missing daemon-start AND a separate grep for panic/UnhandledPromise/level":50/etc — script is stricter; runbook is informational (acceptable for human-readable surface but undocuments the failure-pattern scan)
- T+10 bot reply: runbook says "wait for bot reply", script has explicit y/n prompt with rollback trigger on n — runbook MISSING the operator's binary-choice escalation path (covered by general failure-escalation language but no T+10-specific gate language)
- T+15 canonical test: runbook does JSON file drop, script does 5-step IPC — DRIFT (Critical finding #3)
- T+30 WhatsApp: runbook references manual click-path + curl, script defers to manual + revoke-whatsapp.sh — MATCH
- T+45/T+50/T+55: runbook offers a paste-block of 5 status checks; script has 3 distinct sanity checkpoints each with its own rollback trigger — DRIFT in granularity (the script catches at the per-check level; the runbook lumps them into a single status snapshot, so a single failed check inside the paste doesn't visibly trigger rollback unless the operator reads each line). Minor / Medium.

Independence rules:
- Did NOT read `.iago/reviews/2026-05-20-dual-pr72-aggressive/codex-aggressive.md`
- Did NOT read `.iago/state/sessions/2026-05-20-03b-pipeline-success.log`
- Did NOT run `gh pr view 72 --comments` or any GH command
- Findings derived solely from the 3 runbook files + sibling shipped scripts + plan file
