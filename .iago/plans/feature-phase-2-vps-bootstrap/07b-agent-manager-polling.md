---
phase: feature-phase-2-vps-bootstrap
plan: 07b
wave: 1
depends_on: [07a]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-18
source: feature
split_from: 07-cron-scheduler-subsystem
split_rationale: Pre-emptive split per .iago/decisions/2026-05-18-phase-2-split-and-dispatch.md. 07b ships AgentManager EventEmitter extension + claimTask emit + polling loop + tests (Tasks 3, 4 of original 07) and the OpenClaw cron inventory artifact (Task 6).
---

# Plan: feature-phase-2-vps-bootstrap/07b-agent-manager-polling

## Goal

Extend `AgentManager` with the EventEmitter base, `claimTask` method (emits `task-resolved`), and the `tasks/pending/` polling loop deferred from Phase 1 Plan 07 stress M3. The `task-resolved` emit completes the decrement chain that 07a's `CronScheduler` subscribes to — without this emit side, `runningCount` permanently blocks after the first cron-fire. Three deliverables: (1) `agent-manager.ts` extended with EventEmitter inheritance, `claimTask(filename, agentId)` (atomic rename + event emission), `startPollingLoop(opts?)`, `stopPollingLoop()`; (2) `agent-manager.test.ts` extended with ≥5 new test cases preserving the Phase 1 baseline (claim happy path, malformed JSON poisoning, unrouted task, decrement chain end-to-end, `.tmp` mid-rename skip); (3) `openclaw-cron-inventory.json` — static artifact closing migration-scope § 4 acceptance gate (Phase 0 audit confirmed empty inventory; this file documents the absence with re-verify steps). Source of truth: `.iago/research/2026-05-16-phase-2-vps-bootstrap-spec.md` § 1 + `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 4 + Phase 1 Plan 07 stress M3 polling-loop deferral.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `runtime/daemon/agent-manager.ts` | Extend EventEmitter; add `claimTask` (atomic rename + `task-resolved` emit); add `tasks/pending/` polling loop (5s default tick) |
| edit | `runtime/daemon/agent-manager.test.ts` | Add ≥5 polling-loop cases (claim, poisoned, unrouted, decrement-chain, .tmp skip) |
| create | `runtime/migration/openclaw-cron-inventory.json` | Static inventory per Phase 0 audit (empty by audit confirmation) |

## Tasks

### Task 1: Extend agent-manager.ts (EventEmitter + claimTask + polling loop)

- **files:** `runtime/daemon/agent-manager.ts`
- **action:** **Step 1a — Extend AgentManager with EventEmitter + claimTask (NEW — Phase 1 does not have this):** Verify `AgentManager` extends `EventEmitter` (or add `import { EventEmitter } from 'node:events'` + `class AgentManager extends EventEmitter`). Add `async claimTask(filename: string, agentId: string): Promise<void>` — atomically moves `<stateRoot>/tasks/pending/<filename>` to `<stateRoot>/tasks/resolved/<filename>` using `fs.rename`; if successful, emits `this.emit('task-resolved', { agentId, filename })`. This event is the decrement hook that `CronScheduler` (07a) subscribes to. **Without this step, `runningCount` never decrements after the first cron-fire and `maxConcurrent` permanently blocks.** **Step 1b — Add polling loop:** Add a `startPollingLoop(opts?: { intervalMs?: number }): void` method (default 5000ms) and matching `stopPollingLoop(): Promise<void>`. Behavior: every `intervalMs` the loop calls `fs.readdir(<stateRoot>/tasks/pending/)`; for each `.json` file only (filter: `filename.endsWith('.json')` — skip `.tmp` mid-rename files per C3 stress-test fix; see Task 2 PL-5 test); sorted ascending by name (unix timestamp embedded); (a) parse via `JSON.parse`; if malformed → move to `tasks/poisoned/` and emit `task-poisoned` telemetry, skip; (b) inspect `agentId` field; if no registered agent matches → leave the file in pending and emit `task-unrouted` telemetry once per filename (use an in-memory `Set<string>` to suppress repeat; clear the set on `stopPollingLoop` so a future restart re-emits); (c) if registered agent exists, call `this.claimTask(filename, agentId)` — which moves the file AND emits `task-resolved`, completing the decrement chain. The loop refuses overlapping ticks (boolean re-entrancy guard). Tick exceptions are caught + logged via telemetry `polling-loop-error`. `stop` clears the interval and awaits any in-flight tick. JSDoc explains: this is the production polling loop deferred from Phase 1 Plan 07 stress-test M3 (file-bus polling cadence). The wire-up (calling `startPollingLoop()` from `startDaemon`) is Plan 04b Task 3's responsibility. NO `any`, NO `as` casts.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "startPollingLoop|stopPollingLoop|claimTask|extends EventEmitter" daemon/agent-manager.ts`
- **expected:** `tsc --noEmit` exit 0. All four symbols (claimTask, startPollingLoop, stopPollingLoop, EventEmitter inheritance) present.

### Task 2: Extend agent-manager.test.ts with polling-loop cases

- **files:** `runtime/daemon/agent-manager.test.ts`
- **action:** Add ≥5 new test cases preserving the Phase 1 baseline (whatever count exists today — do NOT remove or rewrite passing tests). New cases: (PL-1) happy path — manager has a registered agent `pr-triage`; a task file `pr-triage__1700000000.json` lands in `tasks/pending/` with a valid `agentId: "pr-triage"` body; one tick later `claimTask` was called exactly once with `(filename, "pr-triage")` AND `task-resolved` event was emitted with `{ agentId: "pr-triage", filename }`; (PL-2) malformed JSON in `tasks/pending/` → file is moved to `tasks/poisoned/` and `task-poisoned` telemetry event emitted; pending dir no longer contains the file; (PL-3) `agentId` references unregistered agent → file stays in pending; `task-unrouted` telemetry emitted once even across multiple ticks (assert exactly 1 telemetry event for the same filename); (PL-4) **`task-resolved` event drives `CronScheduler` decrement (integration test — bridges 07a+07b)**: instantiate a real `CronScheduler` (from 07a) over the extended `AgentManager`; register a cron with `maxConcurrent: 1`; force `runningCount` to 1 (pre-fire one tick OR direct set if test-accessible); polling loop claims the task file → `claimTask` emits `task-resolved` → CronScheduler listener decrements `runningCount` to 0 → next matching tick fires successfully (no `cron-overlap-prevented` event); assert: `cron-overlap-prevented` emitted 0 times on the second tick; (PL-5) `.tmp` mid-rename file in `tasks/pending/` → polling loop skips it; rename file to `.json` → next tick picks it up and processes normally (claim + task-resolved emitted). Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(5000)` to drive the loop deterministically. File expands by 200-350 lines.
- **verify:** `cd runtime && npx vitest run daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -25`
- **expected:** All Phase 1 baseline tests still pass + ≥5 new polling-loop tests pass (PL-1 through PL-5).

### Task 3: Generate openclaw-cron-inventory.json (Codex P1-7 fix)

- **files:** `runtime/migration/openclaw-cron-inventory.json`
- **action:** Per migration-scope § 4 acceptance gate. Per Phase 0 audit (`runtime/migration/00-vps-audit.md`), VPS has no crontab and no OpenClaw-owned systemd timers. This task creates `runtime/migration/openclaw-cron-inventory.json` with content: `{ "scanned_at": "<ISO-8601 timestamp at file authorship time>", "user": "ilsantino", "crontab_entries": [], "systemd_user_timers": [], "systemd_system_timers_owned_by_openclaw": [], "notes": "Per Phase 0 audit (runtime/migration/00-vps-audit.md), VPS has no crontab; no OpenClaw-owned timers. Inventory empty by audit confirmation; satisfies migration-scope § 4 acceptance gate. Re-verified at cutover-time via the verify command below — if cutover-time re-verification surfaces a forgotten cron or timer, this file MUST be updated with the entries BEFORE proceeding (Plan 03b cutover-runbook Day -1 prep includes a re-verify checkbox)." }`. The inventory file is a static artifact that documents the absence of OpenClaw scheduled work — the explicit "we checked, there's nothing" record that migration-scope § 4 demands.
- **verify:** `cat runtime/migration/openclaw-cron-inventory.json | jq . > /dev/null && jq -r '.crontab_entries | length, .systemd_user_timers | length, .systemd_system_timers_owned_by_openclaw | length' runtime/migration/openclaw-cron-inventory.json && (tailscale ssh ilsantino@srv1456441 -- 'crontab -l 2>&1 | grep -v "no crontab" | head' 2>/dev/null ; tailscale ssh root@srv1456441 -- 'systemctl --user --machine=ilsantino@.host list-timers --all --no-pager | grep -iE "openclaw|claw" | head' 2>/dev/null) || echo "(VPS re-verify skipped: requires Tailscale connectivity — re-run at Day -1 prep per 03b cutover-runbook)"`
- **expected:** JSON parses cleanly. All three array length fields output `0` (per Phase 0 audit). Re-verify commands return empty output (no crontab entries; no openclaw-named timers in the user systemd timer list) when Tailscale is available; skipped otherwise with explicit note.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -30 \
  && cd .. \
  && jq . runtime/migration/openclaw-cron-inventory.json > /dev/null
```

Expected:
- `tsc --noEmit` exit 0
- `agent-manager.test.ts` Phase 1 baseline tests still pass + ≥5 new polling-loop tests pass (PL-1 through PL-5)
- `openclaw-cron-inventory.json` is valid JSON; all three array fields empty

## Stress Test

**Verdict:** PROCEED (carried forward from original Plan 07 stress test, scoped to 07b tasks only)
**Date:** 2026-05-18 (pre-emptive split)
**Reviewer:** orchestrator inline (carve-out)

### Critical (must fix in impl)

- **C1 — Polling loop race with cron-fired task writes.** 07b polls `tasks/pending/` every 5s; 07a writes to `tasks/pending/` from the scheduler tick. Two writers (different intervals) → eventually the polling loop reads a half-written file and JSON.parse throws. **Fix:** 07a already uses tmp-rename pattern for atomicity (Windows-safe). 07b polling loop MUST ignore any file whose name doesn't end in `.json` (during the tmp-rename window the file is named `.tmp` and only renames to `.json` atomically). Task 1 has explicit `filename.endsWith('.json')` filter; Task 2 test case PL-5 enforces.
- **C2 — `task-unrouted` Set memory leak.** Task 1's in-memory `Set<string>` to suppress repeat `task-unrouted` events grows unbounded if many tasks reference unregistered agents. **Fix:** Cap the set at 1000 entries; on overflow, log a single `task-unrouted-set-overflow` telemetry event (one-time) and continue without further suppression. Add to Task 1 action; add Task 2 test case PL-6 (write 1001 unique unrouted task files, assert set capped + overflow event emitted once).

### Important (forward to impl, don't block)

- **I1 — agent-manager polling-loop interval is hardcoded 5s.** Some agents may want faster (1s) or slower (30s) polling. **Fix:** Accept `intervalMs` in `startPollingLoop(opts?: { intervalMs?: number })` (Task 1 already does this). Document the default + tunability in 07a's cron-scheduler.README.md § 4 (lifecycle) where the agent-manager wire-up is referenced.
- **I2 — `claimTask` failure modes.** If `fs.rename` throws (e.g., destination filesystem full, permission denied), the task file stays in pending AND `task-resolved` is NOT emitted → `runningCount` stays elevated → next overlap blocks. **Fix:** Catch the rename error, emit `claim-task-failed { filename, agentId, error: String(err) }` telemetry, AND leave the file in pending (next tick retries). Without auto-decrement on failure, a sustained filesystem fault eventually exhausts the overlap budget — that's intentional: the operator sees `cron-overlap-prevented` events and investigates the underlying `claim-task-failed` events first.
- **I3 — Resolved-task directory growth.** `tasks/resolved/` accumulates indefinitely; over a year the dir can have 10k+ JSON files, slowing `fs.readdir` on the polling loop's `tasks/pending/` (different dir but same FS). Out of scope for 07b — Phase 6 dashboard or Phase 8 cost-ledger will prune. Document as a deferred housekeeping item in `runtime/daemon/cron-scheduler.README.md` § 6.

### Minor

- M1 — Inventory JSON timestamp choice: use ISO-8601 UTC at file authorship time, NOT at execution time. The file documents the audit moment; if re-verify changes the result, the file is updated and `scanned_at` advances. Static for the duration of Phase 2.
- M2 — `EventEmitter` extension on `AgentManager` is a non-breaking API change for Phase 1 consumers (Phase 1 callers don't subscribe to any events; they only call methods). Type signature surface widens (new methods); existing tests that mock `AgentManager` must be updated to mock the new methods OR ignore them if they don't trigger.

### Dimension-by-dimension verdicts (07b scope)

- **Precision:** All 3 tasks have file paths + actions + verify commands + expected output. PL-1 through PL-6 test names map 1:1 to behaviors.
- **Edge cases:** C1 (race) + C2 (set leak) cover the non-obvious failures. I2 (claim failure) covers the sustained-fault mode that exhausts overlap budget.
- **Contradictions:** 07b extends AgentManager; 07a authors CronScheduler. EventEmitter is the contract surface. No code duplication.
- **Simpler alternatives:** Could poll less frequently (30s) to reduce I/O. REJECTED — 5s gives sub-tick latency between cron-fired and task-claimed, keeping `runningCount` accurate. Could skip polling-loop and use `fs.watch` instead. REJECTED — `fs.watch` is unreliable across platforms (Windows behavior differs); polling is the floor.
- **Missing acceptance criteria:** 07b closes Phase 1 Plan 07 stress M3 carry-over (polling loop) + migration-scope § 4 acceptance gate (cron inventory). Plan 04b Task 3 consumer wires `startPollingLoop()` into `startDaemon`; its passing integration test is the downstream acceptance signal.

### Implementer forward-list

1. EventEmitter inheritance on `AgentManager` — verify Phase 1 consumers + mocks survive (M2 mitigation).
2. `claimTask` failure handling — emit `claim-task-failed`, leave file in pending, log to journal (I2 fix).
3. `task-unrouted` Set cap at 1000 entries + overflow telemetry (C2 fix).
4. `filename.endsWith('.json')` filter in polling loop readdir (C1 fix; Task 1 already specifies).
5. Inventory JSON `scanned_at` is authorship timestamp; re-verify updates the file (M1 fix).
