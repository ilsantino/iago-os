---
phase: feature-daemon-durability-hardening
plan: 04
wave: 1
depends_on: []
context: .iago/research/2026-06-13-daemon-durability-deferrals.md
created: 2026-07-01
updated: 2026-07-01
source: feature
---

# Plan: feature-daemon-durability-hardening/04-windows-test-portability

## Goal

Eliminate the 2 known Windows-only full-suite red failures + 1 flaky timeout (DD-T1/DD-T2) with the
**minimal, zero-production-risk** fix the stress test converged on: skip the two POSIX-permission
error-path tests on Windows (their real coverage already runs green on Linux CI) and raise the
timeout on the fsync-heavy append test. **No production code changes** — the original fs-hooks seam
was BLOCKED (it routed prod durability/auth through a test-only hook and rested on a false premise:
`cred-bootstrap` reads via **sync** `fs.readFileSync`, not `fsp`).

## Background anchors (main @ `2ec6c07`)

- `cred-bootstrap.test.ts:156-182` — `fs.chmodSync(credPath, 0o000)` to force EACCES; on NTFS this only toggles read-only (owner still reads), so the `errorSpy` "EACCES" assertion never fires. Real cred read is sync `fs.readFileSync` (`cred-bootstrap.ts:134`). Passes on Linux CI.
- `approval-bus.test.ts:821-828` — replaces `approvals/resolved` dir with a FILE to force ENOTDIR in `recoverStrandedApprovals`; NTFS `rm`/stat semantics differ (EBUSY/other errno), so `report.failed` may not populate. Passes on Linux CI.
- `session-log.test.ts:61-76` — 100 serial `appendEvent`; each `performAppend` does two `handle.datasync()` (`session-log.ts:212,262`) under `withFileLock` = 200 serialized FlushFileBuffers → can exceed the 5s Vitest default on NTFS. Passes in isolation.
- CI runtime is Linux — the error-path branches these tests cover are already exercised green there.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `runtime/daemon/cred-bootstrap.test.ts` | `skipIf(win32)` the EACCES error-path case, with a doc comment |
| modify | `runtime/telegram/approval-bus.test.ts` | `skipIf(win32)` the ENOTDIR per-entry-fault case, with a doc comment |
| modify | `runtime/daemon/session-log.test.ts` | Per-test `testTimeout` bump (and/or de-parallelize) on the 100-append test |

## Tasks

### Task 1: Skip the two POSIX-permission error-path tests on Windows (DD-T1)
- **files:** `runtime/daemon/cred-bootstrap.test.ts`, `runtime/telegram/approval-bus.test.ts`
- **action:** Gate ONLY the EACCES/`chmod 0o000` case (`cred-bootstrap.test.ts:156-182`) and the ENOTDIR dir-replaced-by-file case (`approval-bus.test.ts:821-828`) behind `it.skipIf(process.platform === "win32")(...)`, each with a comment: "POSIX permission fault (chmod 0o000 / dir-as-file) no-ops on NTFS for the owner; real coverage runs on Linux CI. See `.iago/research/2026-06-13-daemon-durability-deferrals.md` (DD-T1)." Do NOT touch any other case in either file; do not change production code.
- **verify:** `npm --prefix runtime test -- --run daemon/cred-bootstrap.test.ts telegram/approval-bus.test.ts`
- **expected:** on Windows, the two cases report `skipped` (not failed); every other case passes

### Task 2: Raise the append-test timeout (DD-T2)
- **files:** `runtime/daemon/session-log.test.ts`
- **action:** Give the "100 sequential appends" test (`session-log.test.ts:61`) an explicit per-test `testTimeout` of 30000ms (Vitest `it(name, { timeout: 30000 }, fn)`), so 200 serialized NTFS `datasync` flushes under full-suite parallel I/O no longer exceed the 5s default. Do NOT weaken the durability path — `datasync` still runs; only the test's patience changes. Add a one-line comment citing DD-T2.
- **verify:** `npm --prefix runtime test -- --run daemon/session-log.test.ts`
- **expected:** the append test passes without timing out

### Task 3: Confirm the full suite is green on Windows
- **files:** (no new edits — verification task)
- **action:** Run the whole runtime suite on Windows and confirm the two previously-red cases now report `skipped` and the session-log append test does not time out — i.e. 0 failed. No production file was modified (git diff touches only the three `*.test.ts` files).
- **verify:** `npm --prefix runtime test`
- **expected:** exit 0; 0 failed; the 2 DD-T1 cases skipped on Windows

## Stress Test

**Verdict:** BLOCK (original fs-hooks seam) → descoped, re-scoped plan below
**Date:** 2026-07-01 (analyst/opus, anchors verified against `2ec6c07`)

- **BLOCK reasons (original plan):** (1) false premise — `cred-bootstrap` reads via **sync**
  `fs.readFileSync`, not `fsp`, so an async-only hook could not wrap it; (2) the seam routed
  production `datasync` (durability) and the credential read (auth) through a test-only hook, and the
  prod-passthrough guarantee was proven only by "manual trace" — a silently-broken passthrough would
  pass every task, a genuine durability-weakening escape hatch; (3) per `.claude/rules/layer-triage.md`
  it spent AI/seam complexity where a deterministic one-line config change suffices.
- **Resolution (adopted):** DD-T1 → `skipIf(win32)` on the two error-path cases (their real branch
  coverage already runs green on Linux CI — the Windows failures are false negatives, not coverage
  gaps). DD-T2 → per-test `testTimeout` bump (the fix the source doc itself lists, § "Pre-existing").
  Net: 3 test files touched, **zero production code**, zero durability/auth risk.
- **Trade acknowledged:** the two error paths are no longer *executed* on Windows (only Linux CI).
  Accepted — cross-OS *execution* of a POSIX-permission fault is not a project requirement, and Linux
  CI is the gate. If cross-OS execution ever becomes required, revisit with a properly-proven fs seam
  (passthrough call-count assertion + sync+async shapes), not the blocked design.

## Verification

- `npm --prefix runtime test` on Windows → exit 0, 0 failed (2 DD-T1 cases skipped)
- `git diff --name-only` → only `cred-bootstrap.test.ts`, `approval-bus.test.ts`, `session-log.test.ts` (no production files)
- On Linux CI the two error-path cases still RUN and pass (skipIf is win32-only), so coverage is unchanged there.
