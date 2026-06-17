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
cd runtime && npx tsc --noEmit
shellcheck runtime/deploy/*.sh
echo "exit code: $?"
```

Expected: both exit 0, no diagnostics. `cred-bootstrap.ts` and
`cron-scheduler.ts` compile inside the existing tsconfig include path.
(`runtime/agents/pr-triage/` is wired entirely in TypeScript per Plan 04 — it
ships no `.sh` files, so the only shell target is `runtime/deploy/*.sh`.)

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

Phone screenshot of the v2 bot replying to `/agents` AND the canonical
approval handshake from T+15 of the cutover (Telegram → Tailscale → VPS
systemd-managed bot). Paste the uploaded image link below.

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

Expected: **exposure score ≤2.0** (which `systemd-analyze security` labels
`OK` — the next band up, `MEDIUM`, maps to a higher score ~2–4, so a `MEDIUM`
result would be >2.0 and fail this threshold). The score range is
`0.0 ↔ 10.0` where LOWER is better — OpenClaw-style user units typically score
9.6 ("UNSAFE"); the v2 daemon should land in the low 2s. The final line reads
`→ Overall exposure level for iago-os-v2-daemon.service: 2.0 OK 😀`. Plan 05b's
`--strict` mode parses this line against
`integration/phase-2-vps.fixtures/security-analyze-sample.txt`; replace that
fixture with this live (anonymized) capture post-cutover.

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
  'tail -30 /var/lib/iago-os/daemon-state/telemetry/$(date +%F).ndjson'
```

Expected kinds (see `integration/phase-2-vps.fixtures/expected-events.json`):
`daemon-start` (with `runUnder: "systemd"`), `cred-bootstrap-loaded` (with
`credentialsLoaded` array), `agent-registered`, `agent-spawned`, `cron-fired`
OR `cron-skipped` (pr-triage), `task-claimed`/`task-resolved` (if a real 14:00
UTC tick happened). The successful-Telegram-send signal is the resolved
`pr-triage-send__*.json` envelope + the absence of
`pr-triage-telegram-send-failed` — not a dedicated telemetry kind.

**Evidence:**

```
<!-- TODO: paste evidence -->
```

### (k) Single daemon process (criterion #8) — `[ ]`

```bash
tailscale ssh root@srv1456441 -- 'pgrep -fa iago-os-v2-daemon'
```

Expected: exactly one Node process, owned by the `iago` user.

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
tailscale ssh root@srv1456441 -- \
  'journalctl -u iago-os-v2-daemon.service --since "1 minute ago" | grep cred-reload-fired'
```

Expected: one `cred-reload-fired` event with `credentialsReloaded` populated,
proving credential rotation takes effect without a daemon restart.

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
