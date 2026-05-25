---
phase: feature-phase-2-vps-bootstrap
plan: 04d
wave: 3
depends_on: [04a, 04b, 07a, 07b]
context: .iago/plans/feature-phase-2-vps-bootstrap/CONTEXT.md
created: 2026-05-25
source: feature
split_from: 04b-pr-triage-wiring-and-test
split_rationale: Carved out of 04b on 2026-05-25 after the post-merge dual aggressive adversarial review of PR #76 (Codex GPT-5.5 + Opus 4.7) jointly flagged that Plan 04b Task 3 — as written — omitted the dispatch handler wiring that Plan 04a's own `agent-config.json` `_comment_fields` documented as 04b's contract. The implementer faithfully built what Task 3 asked for (cron registration + lifecycle), but the plan was incomplete relative to its dependency contract. Splitting dispatch into its own plan prevents repeating 04b's 4-dispatch scope-explosion. 04d depends on 04b (the cron-registration infrastructure must be present before dispatch can fire).
---

# Plan: feature-phase-2-vps-bootstrap/04d-pr-triage-dispatch-handler

## Goal

Close the dispatch gap surfaced by PR #76 dual aggressive review. Cron-fired task files in `tasks/pending/pr-triage__<unix>.json` must trigger a real PTY spawn that executes the agent's prompt, sends the Telegram message, and exits — instead of sitting in pending or transitioning to resolved without execution. Three integration points:

1. **AgentManager API extension** — add a dispatch hook between `isAgentRegistered` check and `claimTask` in the polling-loop's `processPendingTask`. Either: (a) new `task-dispatch-needed` EventEmitter event that fires BEFORE `claimTask`; (b) new method `executeTask(filename, agentId)` on `AgentManager` that the polling loop calls between registered-check and claimTask. Choose (a) — keeps `AgentManager` framework-agnostic and lets `main.ts` own the runtime-specific dispatch.
2. **`loadAgentConfig(agentsDir, agentId)` in main.ts** — parallel to `loadCronEntries`. Reads `agent-config.json`, validates required fields (`runtimeId`, `cwd`, `env`, `authProfile`), returns typed config. ENOENT or invalid JSON → fail loud (no silent skip) since dispatch correctness depends on it.
3. **Dispatch handler subscription in startDaemon** — subscribe to `task-dispatch-needed`, for each event: read task file (the prompt), spawn the appropriate Shape 1 PTY runtime via `agentManager.registerAgent` + handle, forward the prompt content, wait for clean exit, then claim the task. Pre-register pr-triage at daemon startup so `isAgentRegistered("pr-triage")` returns true and the polling loop routes through dispatch rather than emitting `task-unrouted`.

Source of truth: `.iago/research/2026-05-16-v2-operational-migration-scope.md` § 1 + § 4. PR #76 dual-review synthesis: `.iago/reviews/2026-05-25-dual-pr76-aggressive/synthesis-and-fixes.md`.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `runtime/daemon/agent-manager.ts` | Add `task-dispatch-needed` event + emit between `isAgentRegistered` check and `claimTask` in `processPendingTask`. Optional payload includes raw parsed task content so the dispatcher doesn't re-read. |
| edit | `runtime/daemon/agent-manager.test.ts` | Add tests for new event: emits with correct payload; emit happens BEFORE claimTask; suppression set still works on unregistered path. |
| edit | `runtime/daemon/main.ts` | Add `loadAgentConfig(agentsDir, agentId)`; subscribe `agentManager.on('task-dispatch-needed', handler)`; handler reads agent-config.json, spawns runtime, forwards prompt, awaits exit, calls claimTask. Pre-register pr-triage at startup via `agentManager.registerAgent({ agentId: 'pr-triage', runtimeId: 'claude-pty', cwd, env, sessionId })`. |
| edit | `runtime/daemon/main.test.ts` | Tests for loadAgentConfig (happy path, ENOENT, invalid JSON, missing required fields) and dispatch handler (subscribes correctly, spawns runtime on event, calls claimTask after runtime exit, handles spawn failure). |
| edit | `.iago/plans/feature-phase-2-vps-bootstrap/04c-pr-triage-integration-test.md` | `depends_on` adds `04d`. |

## Tasks

### Task 1: Add `task-dispatch-needed` event to AgentManager

- **files:** `runtime/daemon/agent-manager.ts`, `runtime/daemon/agent-manager.test.ts`
- **action:** In `processPendingTask`, between the `isAgentRegistered(agentId)` check and the `claimTask(filename, agentId)` call, emit a new EventEmitter event `task-dispatch-needed` with payload `{ filename, agentId, taskContent: parsed }`. If no listeners are subscribed → fall through to existing `claimTask` (backwards-compatible). If listeners are subscribed → AgentManager DOES NOT call claimTask itself; the listener is responsible for calling `claimTask` after dispatch completes (this inversion lets the dispatcher control claim timing — claim happens after runtime exits, not before runtime is spawned). Update the JSDoc on `processPendingTask` + `claimTask` to reflect the new contract. Add `listenerCount('task-dispatch-needed')` check; if > 0 the new path runs; if 0 the legacy decrement-only path runs (preserves the polling-loop semantic for test scenarios that don't wire a dispatcher).
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** `tsc --noEmit` exit 0. agent-manager.test.ts: existing 40+ tests still pass. New tests added: `(a) processPendingTask emits 'task-dispatch-needed' when listeners are subscribed`; `(b) processPendingTask falls through to claimTask when no listener`; `(c) payload includes parsed task content`; `(d) listener exception does NOT cause double-claim`. Total ≥4 new tests.

### Task 2: `loadAgentConfig` in main.ts

- **files:** `runtime/daemon/main.ts`, `runtime/daemon/main.test.ts`
- **action:** Add `loadAgentConfig(agentsDir: string, agentId: string): Promise<AgentConfigShape>` parallel to `loadCronEntries`. Reads `<agentsDir>/<agentId>/agent-config.json`, parses JSON, validates: `runtimeId: string`, `cwd: string`, `env: Record<string, string>`, `authProfile: string` (org optional). ENOENT or parse error or missing required field → throw with a clear message including which file + which field failed. Define the `AgentConfigShape` type adjacent. Export `loadAgentConfig` for testability.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/main.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** `tsc --noEmit` exit 0. main.test.ts: ≥4 new tests for loadAgentConfig (happy path with pr-triage fixture, ENOENT throws, JSON parse error throws, missing runtimeId throws).

### Task 3: Wire dispatch handler + pre-register pr-triage

- **files:** `runtime/daemon/main.ts`, `runtime/daemon/main.test.ts`
- **action:** In `startDaemon`, after constructing `CronScheduler` (post-04b wiring) but BEFORE `agentManager.startPollingLoop`:
  1. For each registered cron entry (from `loadCronEntries` result), load its `agent-config.json` via `loadAgentConfig`. If load fails — log structured error and CONTINUE registering other agents; do NOT throw (degraded state: some agents may dispatch, others may not — better than no daemon).
  2. Register the agent via `agentManager.registerAgent({ agentId, runtimeId: config.runtimeId, cwd: config.cwd, env: config.env, org: config.org, sessionId: <generated> })` so `isAgentRegistered(agentId)` returns true and the polling loop routes through dispatch.
  3. Subscribe a dispatch handler: `agentManager.on('task-dispatch-needed', async ({ filename, agentId, taskContent }) => { ... })`. The handler:
     - Reads the prompt content from the task file (already parsed in `taskContent`)
     - Spawns the agent's runtime via the registered handle (the runtime is Shape 1 PTY for pr-triage; the handle from registerAgent carries the spawn spec)
     - Forwards the prompt content to the PTY stdin
     - Awaits clean exit (with timeout — bound at `stageTimeoutMs` for parity with shutdown handling)
     - On clean exit: `await agentManager.claimTask(filename, agentId)` (moves pending→resolved + decrements cron slot)
     - On runtime crash or timeout: emit telemetry `pr-triage-dispatch-failed` with reason + leave file in pending so next polling tick retries; do NOT call claimTask (cron slot stays held; eventual `cron-overlap-prevented` surfaces the stall to operator)
  4. Subscription happens BEFORE `startPollingLoop` so the first polling tick post-startup already has the listener in place.
  5. Tear-down: in the existing shutdown block, `agentManager.removeAllListeners('task-dispatch-needed')` before `agentManager.stopPollingLoop`. Prevents dispatch from firing on a polling-tick that races shutdown.
- **verify:** `cd runtime && npx tsc --noEmit && npx vitest run daemon/main.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** `tsc --noEmit` exit 0. main.test.ts: ≥4 new tests for dispatch handler (a) listener subscribed at startup, (b) registered agent pre-registered, (c) successful dispatch → claimTask called after runtime exit, (d) failed dispatch → telemetry emitted, file left in pending, claimTask NOT called.

## Verification

```bash
cd runtime && npx tsc --noEmit \
  && npx vitest run daemon/cron-scheduler.test.ts daemon/cred-bootstrap.test.ts daemon/agent-manager.test.ts daemon/main.test.ts --coverage 2>&1 | tail -40
```

Expected:
- `tsc --noEmit` exit 0
- All listed test files pass
- ≥12 new tests across Tasks 1-3
- Coverage ≥80% on new dispatch-handler path

## Stress Test

**Verdict:** PROCEED (carve-out from PR #76 dual-review; depends_on chain reviewed against 04b shipped state)
**Date:** 2026-05-25
**Reviewer:** orchestrator inline (post-dual-review synthesis)

### Critical (must fix in impl)

- **C1 — Backwards-compat preservation on the new `task-dispatch-needed` event.** Task 1's contract change (listener-driven vs decrement-only) must not break existing 07b tests. The `listenerCount > 0` switch is the safety net: tests that don't wire a dispatcher continue to see decrement-only behavior. The Task 1 test list explicitly includes "(b) processPendingTask falls through to claimTask when no listener" to enforce this.
- **C2 — Order of operations in Task 3 shutdown.** `removeAllListeners('task-dispatch-needed')` must run BEFORE `stopPollingLoop` (which awaits any in-flight tick). If shutdown removes listeners after stopping the polling loop, an in-flight tick could fire `task-dispatch-needed` to no listeners → falls through to `claimTask` decrement-only → file moves to resolved without execution. Wrong direction of the race.

### Important (forward to impl, don't block)

- **I1 — Listener exception handling.** The dispatch handler must catch its own exceptions so they don't propagate back through EventEmitter and crash the polling tick. Wrap the handler body in try/catch; on exception emit `pr-triage-dispatch-failed` + log + return (do NOT call claimTask).
- **I2 — Pre-registration sessionId generation.** `RegisterAgentConfig.sessionId` is required (assertSafeIdentifier-validated). Use a UUID4 with a `daemon-startup-` prefix or similar — must be unique per daemon run AND safe-identifier compliant. Document the choice.
- **I3 — `taskContent` payload size cap.** Task files are user-prompt content; a malicious or buggy upstream could write a huge file. Cap payload at a reasonable size (e.g., 1MB) in the event payload to prevent EventEmitter memory blow-up. Reject larger files with `task-poisoned` reason `oversized-task`.

### Minor

- **M1 — `registerAgent` per-cron loop is sequential.** With multiple agents (Phase 3+) this could slow startup. Parallelize with `Promise.all` once there are ≥3 agents. Not relevant for Phase 2 (only pr-triage).
- **M2 — Dispatch handler timeout is `stageTimeoutMs`.** A long-running agent could hit the shutdown stage-timeout; ensure the per-stage timeout is generous enough for a 30-60 second LLM call. Plan 06 SIGHUP shipped `stageTimeoutMs` at 60 seconds; verify it's appropriate. If too tight, raise to 120s.

### Dimension-by-dimension verdicts (04d scope)

- **Precision:** 3 tasks, each with file paths + actions + verify + expected. New event contract specified explicitly (listenerCount switch).
- **Edge cases:** Backwards-compat preservation (C1), shutdown race (C2), listener exception (I1), oversized payload (I3).
- **Contradictions:** None — 04d is purely additive to 04b's wiring. Updates 04c's depends_on for consistency.
- **Simpler alternatives:** Could inline the dispatch in `claimTask` rather than introduce a new event. REJECTED — claimTask is decrement-only by 07b's design contract; inlining dispatch couples AgentManager to runtime specifics and breaks framework-agnostic separation. The event-based approach keeps AgentManager neutral.
- **Missing acceptance criteria:** Same migration-scope § 1 criteria covered by 04b — 04d adds the actual execution path that satisfies them.

### Implementer forward-list

1. Task 1 first — `task-dispatch-needed` event is foundation for Tasks 2-3.
2. Task 2 — loadAgentConfig is small and parallel to existing loadCronEntries pattern.
3. Task 3 LAST — wires the handler that depends on both prior tasks.
4. Order of teardown: removeAllListeners → stopPollingLoop → scheduler.stop (C2).
5. Catch dispatch handler exceptions (I1).
6. UUID4 sessionId with safe-identifier prefix (I2).
7. Cap taskContent payload (I3).
