# PR #64 — Plan 07b AgentManager Polling Loop + Cron Inventory

**Reviewer:** Opus (adversarial) · **Date:** 2026-05-18

## Critical
None.

## Important

**I1 — Poisoned cron-fired task leaks `runningCount` slot.** `runtime/daemon/agent-manager.ts:1649` emits `task-poisoned` with `agentId: "(unknown)"`. CronScheduler's `terminalListener` (`cron-scheduler.ts:393-415`) requires a real agentId match in `outstandingFilenames` — early-returns on the placeholder, slot never decrements. Violates the explicit header contract at `cron-scheduler.ts:50-53` ("otherwise a poisoned cron task would leak its slot forever"). Sustained occurrence surfaces as `cron-overlap-prevented` and halts cron firing. Fix: parse agentId from `<agentId>__<taskId>.json` filename prefix before emitting.

> **STATUS:** Fixed by GH Action loop commit `0582a22` ("fix: derive agentId from filename in poisonTask"). Verified.

**I2 — Missing test for `claim-task-failed` telemetry.** Branch at `agent-manager.ts:1433-1441` has no test coverage. Severity floor for missing-test-on-failure-path. Add PL-7: force `fs.rename` to throw, assert `claim-task-failed` emitted with errno, assert `task-resolved` NOT emitted.

> **STATUS:** OPEN — needs fix.

**I3 — Missing test for poisoned-cron-fired-task slot release.** No symmetric test to PL-4 (cron+resolved). Would have caught I1. Add PL-8: cron fires → corrupt file → assert `cron-overlap-prevented` does not fire next tick.

> **STATUS:** Fixed by GH Action loop commit `0582a22` (added PL-7 integration test: "cron fires → file corrupted → poisoned → CronScheduler runningCount decrements back to 0"). Verified.

## Minor

- **M1** `agent-manager.ts:1429-1432` — awaits telemetry disk I/O before emitting in-process event; flip order or `void` the telemetry call.
- **M2** `openclaw-cron-inventory.json:2` — `scanned_at` set to midnight, not actual verify-command time.
- **M3** `isAgentRegistered:1681-1686` — O(handles × files) per tick; build a registered-ids `Set`.
- **M4** Polling re-reads unrouted file body every tick; cache `(filename → agentId)`.
- **M5** `unroutedSet.clear()` only runs on `stopPollingLoop`; long-running daemon stays saturated.
- **M6** Overflow telemetry fires once per process lifetime; consider backoff re-emit.

## Cross-cutting

| Check | Status |
|---|---|
| Auth bypass | N/A |
| Data loss | Low — `claimTask` uses plain `fs.rename` not `atomicRenameStaleDest`; failures surface via `claim-task-failed` + retry |
| Races | OK — `pollingTickInFlight` guard + `unref()` correct |
| Rollback | OK — opt-in `startPollingLoop()`, not wired in this PR |
| Boot race (cross-listener) | Not triggered — wire-up is Plan 04b Task 3 |

## Spec compliance

All items PASS except `task-poisoned` agentId (see I1) and `claim-task-failed` test coverage (see I2). C1 (.json filter), C2 (Set cap), I2 (telemetry impl), `tasks/poisoned` state path, JSON inventory shape, PL-1..PL-6, TS strict, JSDoc — all verified.

## Verdict: PASS_WITH_CONCERNS

I1 is a real contract violation but gated to cron+poisoned path, recoverable by restart. Land with follow-up issue for I1 fix + PL-7/PL-8 tests before Plan 04b wires the loop into boot.

## Codex finding cross-reference (separate file: pr64-codex.md)

- **Codex CRITICAL #1 (claimTask resolves tasks without dispatching):** Plan 07b explicitly designs `claimTask` as decrement-only — the actual agent runtime dispatch is deferred to Plan 04b Task 3 (wire `startPollingLoop()` into `startDaemon`). Codex's finding is architecturally correct but out-of-scope for 07b. Document the design decision in agent-manager.ts JSDoc to prevent future readers from filing the same finding.
- **Codex HIGH #2 (poisoned cron slot leak):** Same as Opus I1 above. Fixed by GH Action 0582a22.
