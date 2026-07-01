---
phase: feature-daemon-durability-hardening
plan: 01
wave: 1
depends_on: []
context: .iago/research/2026-06-13-daemon-durability-deferrals.md
created: 2026-07-01
updated: 2026-07-01
source: feature
---

# Plan: feature-daemon-durability-hardening/01-delivery-correlation-and-tombstone

## Goal

Remove the two delivery-correctness dependencies that can silently drop or duplicate the daily
pr-triage summary: (DD-03) correlate a result envelope to its run **by the single-flight active-run
invariant** — not by the LLM echoing a UUID — and (DD-02) replace destructive marker-unlink-on-
completion with a durable tombstone keyed by the source cron filename, so a marker cleared by result
completion while the source task is still pending can no longer trigger a fresh re-dispatch + a
duplicate Telegram push. This plan also exposes the tombstone seams that plan 02 (DD-01) consumes.

## Design decision (from stress test — supersedes the naive "echo the filename" approach)

`maxConcurrent:1` guarantees **exactly one active run per agentId** at envelope-processing time, and
the daemon already holds that run's `{runId, filename}` in the in-memory `timers` map and the on-disk
`result-pending/<agentId>.json` marker. Therefore the correct DD-03 fix is **single-flight
correlation in the send handler (`main.ts`, where `isActiveRun`/the marker are readable)**: a result
envelope arriving with a missing/empty/non-UUID `runId` **while a run is active** is, by the
invariant, that run's envelope — correlate it to the live marker's run and deliver it. Do NOT add a
second LLM-echoed field (that repeats the exact fragility DD-03 exists to remove) and do NOT put
correlation in `agent-manager.ts` (it cannot see `timers`/`isActiveRun`). The marker's `runId`
remains the sole authority; stale-run safety is preserved because correlation only ever binds to the
*currently active* marker (a prior run has no live marker). This is the fix direction the source doc
(§ D3 (a)) recommends and it subsumes DD-02's dedup story.

## Background anchors (main @ `2ec6c07`)

- Marker `result-pending/<agentId>.json`; `resultPendingPath` `main.ts:654`; `ResultPendingMarker` `{agentId,runId,filename,deadlineMs}` `main.ts:644`. `filename` = the **source cron task** (`pr-triage__*`), claimed at dispatch (`agent-manager.ts:claimTask ~2123`).
- `removeMarker` `main.ts:798`; completion sites `clearResultTimer` `main.ts:996`, `fireTimeout` `main.ts:838`, `recoverResultTimers` expired branch `main.ts:1157`.
- `isActiveRun` `main.ts:863-904`; send handler `makeTaskSendHandler` (Telegram send `main.ts:1400`, claim `main.ts:1365`, marker read for runId authority). `makeResultTimers` return `main.ts:1164-1174` (must also export the new tombstone helpers).
- Envelope runId read-back (the current LLM-echo dependency) `agent-manager.ts:2508-2528`; forwarded on `task-send-needed` `agent-manager.ts:2550-2558`.
- Atomic writer to mirror `writeMarker` `main.ts:1016`; `assertSafeIdentifier` (filename validator) imported in `agent-manager.ts`. State kinds `state-paths.ts:38-76` (`ensureStateDirsSync` iterates `ALL_KINDS`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `runtime/daemon/state-paths.ts` | Add `result-tombstones` to `StateKind` + `ALL_KINDS` (created 0o700) |
| modify | `runtime/daemon/main.ts` | Tombstone helpers (exported from `makeResultTimers`); tombstone at completion + boot; single-flight correlation in send handler; re-dispatch guard |
| modify | `runtime/daemon/telemetry.ts` | New kind `pr-triage-redispatch-suppressed` |
| modify | `runtime/daemon/state-paths.test.ts` | Assert `result-tombstones/` created at 0o700 |
| modify | `runtime/daemon/main.test.ts` | RED-first regression: DD-02 compound fault, DD-03 no-echo correlation, boot marker+tombstone |

## Tasks

### Task 1: State dir + tombstone helpers (scaffolding for RED tests)
- **files:** `runtime/daemon/state-paths.ts`, `runtime/daemon/main.ts`
- **action:** Add `result-tombstones` to `StateKind` and `ALL_KINDS` so `ensureStateDirsSync` creates it 0o700. In `makeResultTimers`, add `writeTombstone(sourceFilename, {agentId, runId, deliveredAt})` and `readTombstone(sourceFilename)` (atomic temp-then-rename per `writeMarker` `main.ts:1016`; key = `result-tombstones/<sanitized>.json` sanitized via `assertSafeIdentifier`, the SAME validator `claimTask` uses, so keys match), and **export both from the `makeResultTimers` return (`main.ts:1164-1174`)** and thread `readTombstone` into `makeTaskDispatchHandler`'s deps so plan 02 can consume them.
- **verify:** `npm --prefix runtime run typecheck`
- **expected:** exit 0

### Task 2: RED regression tests (author + see fail BEFORE impl Tasks 3-6)
- **files:** `runtime/daemon/main.test.ts`, `runtime/daemon/state-paths.test.ts`
- **action:** Write failing tests: (a) **DD-02** — send-success + *persistent* pending→resolved claim fault + result consumption (marker cleared) + source-still-pending retry → assert `telegramBot.sendAgentNotification` is called **exactly once** across the whole sequence AND `pr-triage-redispatch-suppressed` fires (no fresh re-dispatch); (b) **DD-03** — an active-run envelope whose `runId` is empty/absent → assert it is correlated + delivered (not quarantine-dropped); (c) **boot** — a recovered marker whose source has a `deliveredAt` tombstone → assert NO dead-letter timer is re-armed (no spurious `pr-triage-result-timeout`); (d) `state-paths.test.ts` asserts `result-tombstones/` exists at 0o700. Run and confirm all fail against current behavior.
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts daemon/state-paths.test.ts`
- **expected:** the 4 new tests FAIL (RED); pre-existing tests still pass

### Task 3: Single-flight correlation in the send handler (DD-03)
- **files:** `runtime/daemon/main.ts`, `runtime/daemon/agent-manager.ts`
- **action:** When the envelope's echoed `runId` is missing/empty/non-UUID, correlate at the `isActiveRun`/`makeTaskSendHandler` seam (`main.ts`) to the single live marker's run for that agentId and deliver it, keeping the UUID echo as a fast-path when present and keeping the marker `runId` as the authority. Do NOT introduce a new echoed envelope field; `agent-manager.ts:2508-2528` keeps forwarding whatever runId it read (may be undefined) — the correlation decision moves to `main.ts`. Preserve stale-run safety: correlate only to the currently-active marker.
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts` (test (b) now GREEN)
- **expected:** DD-03 test passes; no other regression

### Task 4: Tombstone at every completion site (DD-02)
- **files:** `runtime/daemon/main.ts`
- **action:** At `clearResultTimer` (`main.ts:996`), `fireTimeout` (`main.ts:838`), and the `recoverResultTimers` expired branch (`main.ts:1157`), write a tombstone keyed by the marker's `filename` (source cron task) **before** the existing `removeMarker`/`unlink`, recording `deliveredAt = now` on the delivered (`clearResultTimer`) path and `deliveredAt = null` on the dead-letter/timeout paths. Document in-code that a `null`-`deliveredAt` tombstone is a completion record but is **non-suppressing** (only a `deliveredAt`-set tombstone suppresses re-dispatch).
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts`
- **expected:** suite green; tombstone written before every marker removal

### Task 5: Re-dispatch + boot-recovery guards (DD-02)
- **files:** `runtime/daemon/main.ts`, `runtime/daemon/telemetry.ts`
- **action:** (a) In `makeTaskDispatchHandler`, before minting a fresh `runId` (`main.ts:1804` region), `readTombstone(evt.filename)`; if a `deliveredAt`-set tombstone exists, emit a new `pr-triage-redispatch-suppressed` kind (add to the `DaemonEvent` union `telemetry.ts:56+`, `pr-triage-<noun>-<state>` convention) and, when send-contract, emit `cron-result-complete` to release the slot instead of re-dispatching. (b) In `recoverResultTimers`, before re-arming/dead-lettering a recovered marker, check for a `deliveredAt`-set tombstone on its source and if present treat the run as delivered — remove the marker, do NOT re-arm (closes the crash-window where Task 4 wrote a tombstone before the marker removal but crashed between).
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts` (tests (a),(c) now GREEN)
- **expected:** suppression + boot-guard paths pass

### Task 6: Tombstone lifecycle / bounded GC
- **files:** `runtime/daemon/main.ts`, `runtime/daemon/agent-manager.ts`
- **action:** Expire a tombstone only when its source task is confirmed resolved (clear on `claimTask` success for that filename) OR by an age check in `recoverResultTimers` whose bound **exceeds `RESULT_TIMEOUT_MS` (120s) plus the max claim-retry window**, and which **skips any tombstone whose source task is still present in `tasks/pending/`** (so GC can never delete a tombstone the re-dispatch guard still needs). GC is best-effort (`.catch(() => undefined)`).
- **verify:** `npm --prefix runtime test -- --run daemon/main.test.ts daemon/agent-manager.test.ts`
- **expected:** both green; a test asserts the tombstone survives while the source is still pending and is removed once resolved

## Stress Test

**Verdict:** PROCEED_WITH_NOTES → revised
**Date:** 2026-07-01 (analyst/opus, anchors verified against `2ec6c07`)

- **SIMPLER ALTERNATIVE (adopted):** the original Task 4 "stamp the source filename onto the send
  envelope / correlate in `agent-manager.ts`" was self-defeating — the envelope is written by the
  LLM agent, so stamping a source filename would be *another* LLM-echoed field with the same forget-
  failure mode DD-03 targets; and `agent-manager.ts` cannot see `timers`/`isActiveRun`. Replaced with
  **single-flight correlation in the send handler** (Task 3) per source-doc § D3 (a). Correlation now
  needs no echoed field and lives where the marker is authoritative.
- **PRECISION (fixed):** tombstone key is the marker's `filename` = the **source cron task**
  (`pr-triage__*`), sanitized via the same `assertSafeIdentifier` as `claimTask` so guard/write keys
  match; null-`deliveredAt` tombstones documented as non-suppressing.
- **EDGE CASE (fixed):** the recovery-path interaction (crash between tombstone-write and marker-
  removal → boot re-arms a delivered run → spurious 120s dead-letter) is now guarded in Task 5(b) and
  covered by RED test (c). GC race closed by the age bound + "skip if source still pending" (Task 6).
- **CONTRADICTION (fixed):** TDD RED-first — regression tests moved to Task 2, authored and seen fail
  before impl Tasks 3-6. Send-count-exactly-once assertion added (not just suppression telemetry).
- **CROSS-PLAN:** Task 1 now exports `writeTombstone`/`readTombstone` from `makeResultTimers` and
  threads `readTombstone` into the dispatch handler deps, so plan 02 (DD-01) has a real seam to
  consume (the original plan left this plumbing implicit).

## Verification

- `npm --prefix runtime run typecheck` → exit 0
- `npm --prefix runtime test -- --run daemon/main.test.ts daemon/agent-manager.test.ts daemon/state-paths.test.ts` → all green; ≥4 net-new regression tests (were RED before impl)
- Manual trace: (1) no completion path unlinks a marker without first writing a source-keyed tombstone; (2) no delivery path drops an active-run envelope solely for a missing runId echo; (3) `sendAgentNotification` fires exactly once across the DD-02 compound fault.
