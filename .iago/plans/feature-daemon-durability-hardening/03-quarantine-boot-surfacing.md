---
phase: feature-daemon-durability-hardening
plan: 03
wave: 1
depends_on: []
context: .iago/research/2026-06-13-daemon-durability-deferrals.md
created: 2026-07-01
updated: 2026-07-01
source: feature
---

# Plan: feature-daemon-durability-hardening/03-quarantine-boot-surfacing

## Goal

Close DD-R2: a durable quarantine record is surfaced today only reactively, when a re-registration
for that exact `agentId` is attempted. A quarantined agent not re-registered at boot is silently
disabled across restarts with no operator signal. Add a boot-time quarantine-dir scan that surfaces
every quarantined agent via telemetry, rehydrates the in-memory map, and keeps the agent disabled —
without ever aborting boot.

## Background anchors (main @ `2ec6c07`)

- `quarantine/` state dir `state-paths.ts:60,74`; records `quarantine/<agentId>.json` (+ possible `.tmp` from a crashed `persistQuarantineRecord`).
- `QuarantineRecord` `agent-manager.ts:195-200`; `quarantinedAgents` map `agent-manager.ts:346`; `readQuarantineRecord(agentId)` `agent-manager.ts:718-762` (fail-safe: ENOENT→null; present-but-corrupt→**synthesized** record, never throws); `assertAgentIdAvailable` `agent-manager.ts:2004-2029` (its own dir scan filters `.json` at `agent-manager.ts:2049`); `isAgentQuarantined` `agent-manager.ts:790`; `releaseQuarantinedAgent` (operator remediation) `agent-manager.ts:771-785`.
- Boot order in `startDaemon`: `bootRecovery` `main.ts:2905` → `recoverStrandedApprovals` `main.ts:2927` → `recoverResultTimers` `main.ts:3085`; cron register loop `main.ts:3021` (initial `registerAgent` is wrapped in try/catch `main.ts:2450-2464` — a thrown `AgentQuarantinedError` is logged "unrouted" and swallowed, so surfacing a quarantined cron agent does NOT abort boot).
- Telemetry `agent-quarantined` is a **closed** union member with no `phase` field (`telemetry.ts:584`). No exhaustive `switch(kind)` reducer consumes `DaemonEvent` (adding a kind is additive-safe).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `runtime/daemon/agent-manager.ts` | `scanQuarantineDir()` — filtered readdir + rehydrate map + return records |
| modify | `runtime/daemon/main.ts` | Call the scan in `startDaemon`; emit surfacing telemetry |
| modify | `runtime/daemon/telemetry.ts` | New kind `agent-quarantine-surfaced` |
| modify | `runtime/daemon/agent-manager.test.ts` | RED-first: scan rehydrates + fail-safe |
| modify | `runtime/daemon/main.test.ts` | RED-first: boot surfaces + agent stays disabled + boot completes |

## Tasks

### Task 1: RED regression tests (author + fail BEFORE impl)
- **files:** `runtime/daemon/agent-manager.test.ts`, `runtime/daemon/main.test.ts`
- **action:** Write failing tests: (a) `scanQuarantineDir()` with two `quarantine/<agentId>.json` files → returns both, populates `quarantinedAgents`; a leftover `<agentId>.json.tmp` and a missing dir are handled (skipped / `[]`); a present-but-corrupt record is **surfaced** (synthesized record returned), not dropped; (b) boot integration — seed a `quarantine/<agentId>.json` for a registered cron agent, run the boot path, assert `agent-quarantine-surfaced` telemetry fired, `isAgentQuarantined(agentId) === true` post-boot (WITHOUT a re-registration attempt), and `startDaemon` **completes** (does not abort). Confirm all fail today.
- **verify:** `npm --prefix runtime test -- --run daemon/agent-manager.test.ts daemon/main.test.ts`
- **expected:** new tests FAIL (RED)

### Task 2: `scanQuarantineDir()` on AgentManager
- **files:** `runtime/daemon/agent-manager.ts`
- **action:** Add `async scanQuarantineDir(): Promise<QuarantineRecord[]>` beside `readQuarantineRecord` (`agent-manager.ts:718`) that `fsp.readdir(pathFor("quarantine"))`, **filters `entry.endsWith(".json")`** (skips `.tmp`/non-JSON, mirroring `agent-manager.ts:2049`), derives `agentId = entry.slice(0, -".json".length)`, loads each via the existing fail-safe `readQuarantineRecord(agentId)` (a present-but-corrupt record yields a synthesized record and IS surfaced), rehydrates `this.quarantinedAgents` for any not already mapped, and returns the list. Missing dir (ENOENT) → `[]`. A `readdir`-level fault logs and returns `[]` (never throws).
- **verify:** `npm --prefix runtime test -- --run daemon/agent-manager.test.ts` (test (a) GREEN)
- **expected:** scan returns records, rehydrates map, fail-safe on `.tmp`/corrupt/missing

### Task 3: Surface at boot (stays disabled, never aborts)
- **files:** `runtime/daemon/main.ts`, `runtime/daemon/telemetry.ts`
- **action:** Add `agent-quarantine-surfaced` to the `DaemonEvent` union (`telemetry.ts:56+`; a distinct kind — a `phase` field on `agent-quarantined` would NOT typecheck against the closed member). In `startDaemon`, after `bootRecovery` (`main.ts:2905`) and before the cron register loop (`main.ts:3021`), `await agentManager.scanQuarantineDir()` and emit `agent-quarantine-surfaced` per record (include `agentId`, `reason`, `atMs`, and the `releaseQuarantinedAgent` remediation hint). The scan is best-effort — a scan fault logs and boot continues. The rehydrated entry keeps the agent disabled via the existing `assertAgentIdAvailable` in-memory check; nothing releases it (release stays manual).
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts` (test (b) GREEN)
- **expected:** boot surfaces the quarantined agent, it stays disabled, `startDaemon` completes

## Stress Test

**Verdict:** PROCEED_WITH_NOTES → revised
**Date:** 2026-07-01 (analyst/opus, anchors verified against `2ec6c07`)

- **PRECISION (fixed):** telemetry uses a distinct `agent-quarantine-surfaced` kind — a `phase` field
  inside the closed `agent-quarantined` member fails TS excess-property checks (the naive reading
  would not compile). Task 2 now filters `.json`/skips `.tmp` and derives `agentId` by stripping the
  suffix (a raw `readdir`→`readQuarantineRecord(entry)` would mis-key `<file>.json.json`).
- **EDGE CASE (cleared):** the feared boot-abort regression does NOT exist — the cron loop's initial
  `registerAgent` is already wrapped in try/catch (`main.ts:2450-2464`) and a quarantined cron agent
  already throws `AgentQuarantinedError` today (swallowed). The scan only changes which branch fires.
  Added an explicit boot-resilience assertion (test (b): `startDaemon` completes).
- **MISSING AC (fixed):** added "agent stays disabled post-boot" (`isAgentQuarantined === true` without
  a re-registration) and the operator remediation path (`releaseQuarantinedAgent`) into the telemetry
  payload and Verification.
- **WORDING (fixed):** "skip malformed" clarified to mean per-entry fault tolerance — a present-but-
  corrupt record is *surfaced* (synthesized), NOT dropped (dropping would hide exactly the degraded-
  disk quarantines DD-R2 most needs surfaced).

## Verification

- `npm --prefix runtime run typecheck` → exit 0
- `npm --prefix runtime test -- --run daemon/agent-manager.test.ts daemon/main.test.ts` → green; ≥2 net-new tests (RED before impl)
- Manual trace: a quarantine record present at boot is surfaced via telemetry, stays disabled, and boot completes — no re-registration needed, no boot abort, corrupt records surfaced not swallowed.
