# Phase 2 — VPS Cutover PR Self-Evidence Template

> **DO NOT MERGE while this file still contains `<!-- TODO: paste evidence -->`
> sentinels.** The Phase 2 acceptance gate (master prompt criterion #8) is
> "PR description includes terminal log + screenshot proving the cutover works
> end-to-end." Until every sentinel below is replaced with real evidence from
> the VPS (and from Santiago's phone for the Telegram screenshot), this PR is
> NOT mergeable.
>
> **Verification gate (NOT YET WIRED — ships in Plan 05b):** the Phase 2 gate
> will be `npm run check:evidence -- --phase 2` (run from `runtime/`), which
> will select this file and grep for the `<!-- TODO: paste evidence -->`
> sentinel, exiting non-zero if any remain. **The current
> `runtime/scripts/check-evidence.mjs` does NOT yet support `--phase 2`** — it
> is hardcoded to `PHASE-1-EVIDENCE.md` and greps the old `PASTE-` sentinel, so
> running it today silently checks the (already-filled) Phase 1 file and
> green-passes regardless of this file's state. **Until Plan 05b lands, do NOT
> rely on `check:evidence` for Phase 2** — verify by eye that no
> `<!-- TODO: paste evidence -->` sentinels remain. Once 05b ships the
> `--phase` flag, the sentinel is an HTML comment no tool output ever produces,
> so a real log mentioning the word "paste" cannot falsely satisfy the gate
> (Plan 05a stress-test C1).

## 1. Purpose

This file is the **template the Phase 2 PR description must include**. Phase 2
ships the v2 daemon to the Hostinger VPS via the FAST cutover
(`runtime/migration/02-cutover-runbook.md`). **Acceptance criterion #8 (master
prompt):** the PR description includes a terminal log + screenshot proving the
cutover works end-to-end — not a description, evidence.

Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 10
(acceptance criteria 1–8). Replace every `<!-- TODO: paste evidence -->`
sentinel with actual output captured per the cutover runbook, then mark each
box `[x]`.

## 2. Required evidence blocks

Capture each block from the VPS over Tailscale SSH (`tailscale ssh
root@srv1456441 -- '<cmd>'`) unless the block says otherwise. **Redact every
token / credential byte** before pasting — only lengths and file names.

### (a) Build gate (criterion #1) — `[ ]`

```bash
cd runtime && npx tsc --noEmit && shellcheck deploy/*.sh
echo "exit code: $?  (0 = tsc AND shellcheck both passed)"
```

Expected: `exit code: 0` — `tsc` and `shellcheck` both pass with no diagnostics.
`cred-bootstrap.ts` and `cron-scheduler.ts` compile inside the existing tsconfig
include path. The `&&` chain means a `tsc` failure short-circuits and surfaces in
the exit code (a bare two-line form would let the final `echo` mask a `tsc`
error behind shellcheck's status). The shell target is `deploy/*.sh` —
cwd-relative because the block already `cd`'d into `runtime/`
(`runtime/deploy/*.sh` would resolve to `runtime/runtime/deploy/*.sh` and fail).
`runtime/agents/pr-triage/` is TypeScript-only per Plan 04 — it ships no `.sh`
files, so `deploy/*.sh` is the only shell target.

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (b) Vitest with coverage (criterion #2) — `[ ]`

```bash
cd runtime && npx vitest run --coverage 2>&1 | tail -60
```

Expected: all tests pass; the coverage table shows ≥80% lines on the new
Phase 2 files (`cred-bootstrap.ts`, `cron-scheduler.ts`, the pr-triage test
surface).

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (c) test-cutover.mjs dry-run (criterion #3) — `[ ]`

```bash
cd runtime && node --test scripts/test-cutover.mjs 2>&1 | tail -40
```

Expected: all cutover dry-run cases pass (23 numbered cases as of this
writing — the count grows as regression cases are added; the gate is "all
pass", not a fixed count). This is the staging-VPS substitute (see § 8 footer
— no staging VPS per Santiago override).

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (d) REAL CUTOVER TERMINAL LOG (criterion #8) — `[ ]`

Capture the full terminal output of `bash runtime/deploy/cutover.sh` from
T-15 through T+60 of the cutover window. **Redact any token/credential
bytes.** This is the master-prompt self-evidence.

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (e) REAL ROLLBACK TERMINAL LOG (criterion #6) — `[ ]`

Output showing the rollback completes in ≤4 min wall clock — from the
`test-cutover.mjs` rollback dry-run, OR the real rollback if the cutover
failed and you had to undo it.

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (f) TELEGRAM SCREENSHOT (criterion #8) — `[ ]`

Phone screenshot of the v2 bot replying to `/agents` (it lists the registered
`pr-triage` handle) — and, if a real approval surfaced during the cutover
window, the `/approve` inline-keyboard callback. This proves the
systemd-managed bot is reachable Telegram → Tailscale → VPS. Paste the uploaded
image link below.

> **Phase 2 command surface:** the bot answers `/start <agent>`, `/agents`,
> `/approve`, `/abort`, `/inject` (pty only), `/status`. `/start <agent>` is a
> Phase-1 placeholder (it replies "must be pre-registered … Dynamic spawn lands
> in Phase 3"), and `/sessions` / `/stop` do NOT exist yet — so the
> `/start → session → approval` handshake from the cutover runbook's T+15 step
> is NOT producible in Phase 2. Do not require it here; `/agents` (plus any real
> `/approve` callback) is the producible Phase 2 Telegram evidence.

**Evidence (image link):**

```
<!-- TODO: paste evidence -->
```

### (g) journalctl clean startup (criterion #5) — `[ ]`

```bash
tailscale ssh root@srv1456441 -- \
  'journalctl -u iago-os-v2-daemon.service --since "1 hour ago" | head -50'
```

Expected: clean startup events, no crash loop, no repeated restart.

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (h) systemd-analyze security exposure score (spec § 1) — `[ ]`

```bash
tailscale ssh root@srv1456441 -- \
  'systemd-analyze security iago-os-v2-daemon.service'
```

Expected: capture the **real** `Overall exposure level` score and treat **≤2.0**
as the spec § 1 *target*, not a hard pass/fail line. Read the numeric score, not
the text band label (`systemd-analyze security` scores `0.0 ↔ 10.0`, LOWER is
better; OpenClaw-style user units typically score 9.6 / `UNSAFE`). **Reality
check:** the shipped unit (`deploy/iago-os-v2-daemon.service`) sets
`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `MemoryDenyWriteExecute`,
an empty `CapabilityBoundingSet`, and `RestrictAddressFamilies`, but **no
`SystemCallFilter=`** — the single highest-weighted item — so it realistically
lands in the `MEDIUM`/`EXPOSED` band (~3–5), not 2.0. If the captured score
exceeds the ≤2.0 target, the cutover PR must EITHER harden the unit (add
`SystemCallFilter=@system-service` + `ProtectProc`/`RestrictNetworkInterfaces`/
`RemoveIPC` as a follow-up hardening task) to reach it, OR document the achieved
band as accepted-for-Phase-2 with rationale — do NOT fudge the fixture to claim
2.0. The `2.0 OK` value in `integration/phase-2-vps.fixtures/security-analyze-sample.txt`
is an **illustrative parser fixture** (it exercises Plan 05b's `--strict`
score-line regex), NOT a measured score; replace it with the live (anonymized)
capture post-cutover.

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (i) systemd-creds decrypt length (criterion #5 — length only) — `[ ]`

```bash
tailscale ssh root@srv1456441 -- \
  'systemd-creds decrypt /etc/credstore.encrypted/iago-telegram-token.cred - | wc -c'
```

Expected: a single integer byte count. **NEVER paste the decrypted value —
length only.**

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (j) NDJSON telemetry excerpt (criterion #5) — `[ ]`

```bash
tailscale ssh root@srv1456441 -- \
  'tail -30 /var/lib/iago-os/daemon-state/telemetry/$(date -u +%F).ndjson'
```

(`date -u` — the daemon names telemetry files by **UTC** date (`telemetry.ts`
`formatDate` uses `getUTC*`), matching the 14:00 UTC cron. A local-time
`date +%F` can point at the wrong or non-existent file near the UTC day
boundary and read empty on a live daemon.)

Expected kinds (see `integration/phase-2-vps.fixtures/expected-events.json`):
**always present** — `daemon-start` (with `runUnder: "systemd"`) and
`cred-bootstrap-loaded` (with `credentialsLoaded` array), the two boot-coupled
kinds. **Dispatch-coupled** (present only if a 14:00 UTC cron tick — and, for the
cron-fired branch, an open PR — fell in the window) — `cron-fired` OR
`cron-skipped`, then `agent-registered` + `agent-spawned` (both emitted in the
spawn flow, NOT at boot) and `task-claimed`/`task-resolved`. The
successful-Telegram-send signal is the resolved `pr-triage-send__*.json` envelope
+ the absence of `pr-triage-telegram-send-failed` — not a dedicated telemetry
kind. **Presence ≠ liveness:** this excerpt proves the daemon *emitted* these
kinds, not that it stayed healthy all window — ongoing liveness is proven by block
(g) journalctl + block (k) pgrep, not by telemetry presence.

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (k) Single daemon process (criterion #8) — `[ ]`

```bash
tailscale ssh root@srv1456441 -- \
  'ps -o user,pid,args -ww -C node | grep -F dist/daemon/main.js'
```

Expected: exactly one row, and its `USER` column reads `iago` — this proves
both the single-process criterion AND the `User=iago` systemd isolation
(decision recorded in `02-cutover-decisions.md`). Grep on the entry-point path
`dist/daemon/main.js` (the unit's `ExecStart` is
`node … /opt/iago-os/runtime/dist/daemon/main.js`): the string
`iago-os-v2-daemon` is the systemd UNIT name and never appears in the process
command line, so grepping it would match nothing on a healthy daemon. A bare
`pgrep -fa` prints pid + command line but NOT the owning user, so it cannot
prove ownership; if the row shows `root` or any other user, the unit's `User=`
directive is not taking effect.

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (l) OpenClaw is gone (criterion #8) — `[ ]`

```bash
tailscale ssh root@srv1456441 -- 'pgrep -fa openclaw'
```

Expected: **empty output** — OpenClaw is fully decommissioned.

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (m) SIGHUP credential reload (Plan 06 cross-ref) — `[ ]`

```bash
tailscale ssh root@srv1456441 -- \
  'systemctl kill -s SIGHUP iago-os-v2-daemon.service'
# The reload events are TELEMETRY — appended to the daily NDJSON, NOT the journal
# (telemetry.ts emit() only appendFile's; nothing reaches journalctl on success).
# The handler is async (re-read credstore -> diff -> await emit -> appendFile), so
# POLL the UTC-dated NDJSON until a cred-reload-* line lands (time out after ~10s):
tailscale ssh root@srv1456441 -- '
  f=/var/lib/iago-os/daemon-state/telemetry/$(date -u +%F).ndjson
  for i in $(seq 1 10); do
    if grep -qE "cred-reload-(fired|coalesced|failed)" "$f"; then
      grep -E "cred-reload-(fired|coalesced|failed)" "$f" | tail -3
      break
    fi
    sleep 1
  done'
```

Expected: a `cred-reload-fired` line. For a **no-rotation SIGHUP** (the safe
default — no credstore entry was changed first), the healthy result is
`credentialsReloaded: []` with `unchanged` listing the re-read credential names —
this alone proves the reload handler ran and re-read the credstore without a
restart. To prove an actual **rotation** takes effect, re-encrypt a credstore
`.cred` first, THEN send SIGHUP; `credentialsReloaded` will then list the changed
name. Two other outcomes are healthy-but-different and the poll surfaces them:
`cred-reload-coalesced` (a reload was already in flight, so this SIGHUP was merged
into one trailing reload — re-send after it settles to capture the `fired` line)
and `cred-reload-failed` (`errorCode` set — the credstore re-read threw; the
daemon keeps the old creds in memory and stays up). An **empty** result after the
10s poll means the handler never ran — that is the genuine failure. (These kinds
reach `journalctl` only on the telemetry-emit *failure* path, so do not grep the
journal for them.)

**Evidence:**

```
<!-- TODO: paste evidence -->
```

## 3. Failure-path evidence (criterion #2 — failure paths, not just happy path)

Confirm each Phase 2 failure-path test passes (verified via the coverage run
in block (b)):

- [ ] **cred-bootstrap NODE_ENV=test override** — `runtime/daemon/cred-bootstrap.test.ts`: env-already-set wins over credstore; `$CREDENTIALS_DIRECTORY` absent is a no-op.
- [ ] **provision-credentials length-mismatch** — `runtime/deploy/provision-credentials.test.sh`: refuses to write when the decrypted length does not match the source.
- [ ] **archive script age-header missing + ephemeral keypair round-trip** — `runtime/deploy/archive-openclaw.test.sh`: aborts on a missing age recipient; round-trips the ephemeral keypair.
- [ ] **cutover refuses without CONFIRM=YES** — `runtime/scripts/test-cutover.mjs`: the cutover script aborts when the confirmation gate is unset.
- [ ] **rollback wall-clock ≤4 min** — target met per spec § 9 table (block (e) above captures the real timing).

## 4. Cutover decisions cross-reference (criterion #4)

The cutover/rollback decision record (LanceDB drop, User=iago, Option-A
Telegram rotation, FAST cutover, no-staging-VPS) lives at
`runtime/migration/02-cutover-decisions.md` (Plan 03b artifact). Paste the PR
link / permalink here:

```
<!-- TODO: paste evidence -->
```

## 5. Garry-impressed checklist (apply before declaring done)

Copy from master prompt § Garry-impressed checklist. Tick every box:

- [ ] Implementation handles every code path I can think of, including the failure ones.
- [ ] Tests exercise the failure paths, not just the happy path (§ 3 above).
- [ ] Docs include a "what breaks and how to recover" section (cutover + rollback runbooks).
- [ ] No `TODO`, `FIXME`, or `XXX` comments left in shipped code (verify on the PR diff).
- [ ] No "this is good enough for now" rationalizations.
- [ ] If the real fix was 5 more minutes away, the real fix is what landed.
- [ ] If there's a workaround, the upstream issue is filed AND the workaround documents the issue link.
- [ ] If there's a dangling thread (cleanup, config migration, deprecation note), it's in this PR not the next one.
- [ ] Pipeline review came back clean, not "clean with carry-over findings."

## 6. Sign-off

- [ ] Santiago has stayed at keyboard 30 min post-cutover monitoring `journalctl -fu iago-os-v2-daemon.service` + Telegram with no regressions.
- [ ] Sebas notified pre-cutover (T-15).

## 7. Size guidance (I3 carry-over)

If the total filled evidence exceeds **50 KB**, attach the cutover + rollback
logs as files (PR file-attachment) OR upload them as gists and link from the
PR description; embed only the key excerpts inline. GitHub caps the PR
description at 65 536 chars, so prefer attachments for the large block (d)/(e)
captures.

## 8. Why no staging VPS? (M1 carry-over)

Phase 2 cuts over directly to production with rollback ready, substituting the
staging-VPS integration test with `runtime/scripts/test-cutover.mjs` (block
(c)). The rationale — Santiago override 2026-05-16 + the test-cutover.mjs
substitute — is in `runtime/migration/02-cutover-decisions.md` § 6 ("No
staging VPS — Santiago override"). Read it before questioning the test path.

## What the merge reviewer should see

Before merge approval, this template is filled out completely — **no
`<!-- TODO: paste evidence -->` sentinels remain** and every checkbox is
`[x]`. Once Plan 05b lands the `--phase` flag, the
`npm run check:evidence -- --phase 2` gate will enforce this (it confirms every
sentinel is replaced); judging whether the pasted content is meaningful is the
human reviewer's job. **Until 05b ships, that command does NOT check this file**
— see the DO-NOT-MERGE header — so the no-sentinels-remain check is by-eye for
any Phase 2 PR that merges before 05b.
