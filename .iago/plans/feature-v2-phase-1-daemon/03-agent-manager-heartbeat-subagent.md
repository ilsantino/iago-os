---
phase: feature-v2-phase-1-daemon
plan: 03
wave: 2
depends_on: [01, 02]
context: .iago/plans/feature-v2-phase-1-daemon/CONTEXT.md
created: 2026-05-15
source: feature
---

# Plan: feature-v2-phase-1-daemon/03-agent-manager-heartbeat-subagent

## Goal

Build the agent-manager — the lifecycle layer over `AgentRuntime`. Handles registration, crash recovery via `.daemon-stop` markers, multi-org cascade, heartbeat health (60s probe + 512MB RSS recycling + restart-on-stall), subagent spawn semantics (parent-child linkage + cost rollup + auto-shutdown on parent exit), and session.jsonl replay fan-out on restart. The manager is shape-agnostic — it talks to `AgentRuntime` adapters via the registry from Plan 01.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/daemon/agent-manager.ts` | Agent registration + lifecycle + crash recovery + subagent semantics |
| create | `runtime/daemon/agent-manager.test.ts` | Unit tests with mocked AgentRuntime adapter |
| create | `runtime/daemon/heartbeat.ts` | Heartbeat loop (60s probe + RSS recycling + restartIfStalled) |
| create | `runtime/daemon/heartbeat.test.ts` | Unit tests for stall detection + recycling thresholds |
| create | `runtime/daemon/markers.ts` | `.daemon-stop` marker write/read for graceful-vs-crash detection on next boot |
| create | `runtime/daemon/markers.test.ts` | Marker write, marker read, marker presence/absence semantics |
| create | `runtime/daemon/README.md` | daemon/ ops runbook: failure modes, .daemon-stop semantics, recycling policy |

## Tasks

### Task 1: Implement .daemon-stop markers

- **files:** `runtime/daemon/markers.ts`, `runtime/daemon/markers.test.ts`
- **action:** Export async `writeStopMarker(handleId: string, reason: "graceful" | "crash" | "recycle"): Promise<void>` that writes `pathFor("markers") + "/" + handleId + ".daemon-stop"` containing `JSON.stringify({ reason, at: Date.now(), pid: process.pid })`. Export async `readStopMarker(handleId: string): Promise<{ reason: "graceful" | "crash" | "recycle"; at: number; pid: number } | null>`. Export async `clearStopMarker(handleId: string): Promise<void>` (deletes the file; idempotent). Export async `listAllMarkers(): Promise<Array<{ handleId: string; marker: { reason: string; at: number; pid: number } }>>` for boot-time scan. Tests: (1) write + read round-trips; (2) `readStopMarker` returns null for missing handle; (3) `clearStopMarker` deletes existing marker; (4) `clearStopMarker` is idempotent on missing marker; (5) `listAllMarkers` returns all written markers from the directory; (6) markers are JSON — corrupted file returns null with stderr warning. Use temp-dir scaffolding from plan 02.
- **verify:** `cd runtime && npx vitest run daemon/markers.test.ts --reporter=verbose 2>&1 | tail -15`
- **expected:** All 6 tests pass; output contains `6 passed`.

### Task 2: Implement heartbeat loop with stall detection + RSS recycling

- **files:** `runtime/daemon/heartbeat.ts`, `runtime/daemon/heartbeat.test.ts`
- **action:** Export `HeartbeatController` class. Constructor: `constructor(opts: { intervalMs?: number; rssLimitBytes?: number; stallThresholdMs?: number; onForceRestart: (handleId: string, reason: "stalled" | "rss-exceeded") => Promise<void> })`. Defaults: `intervalMs: 60_000`, `rssLimitBytes: 512 * 1024 * 1024`, `stallThresholdMs: 5 * 60_000` (5 min — no status change). Methods: `register(handleId: string, getStatus: () => Promise<{ alive: boolean; rssBytes?: number; lastStatusChangeMs: number }>): void` — adds to internal tracking map; `unregister(handleId: string): void`; `start(): void` — sets `setInterval` for `intervalMs`; `stop(): void` — clears interval, awaits in-flight probes. On each tick, iterate registered handles, call `getStatus()`, evaluate: if `!alive` → invoke `onForceRestart(handleId, "stalled")`; else if `rssBytes !== undefined && rssBytes > rssLimitBytes` → invoke `onForceRestart(handleId, "rss-exceeded")`; else if `Date.now() - lastStatusChangeMs > stallThresholdMs` → invoke `onForceRestart(handleId, "stalled")`. Probe errors are swallowed (logged to stderr) — heartbeat MUST NOT crash the daemon. Tests: (1) registered handle with alive=true, rss=100MB, recent status — no force restart called; (2) alive=false triggers force-restart "stalled"; (3) rss=600MB triggers force-restart "rss-exceeded"; (4) stale lastStatusChangeMs (>5min ago) triggers force-restart "stalled"; (5) probe throws — heartbeat survives, error logged; (6) `unregister` removes handle from tracking; (7) `stop` clears the interval. Use `vi.useFakeTimers()` for time-control tests.
- **verify:** `cd runtime && npx vitest run daemon/heartbeat.test.ts --reporter=verbose 2>&1 | tail -15`
- **expected:** All 7 tests pass.

### Task 3: Implement agent-manager core (registration + lifecycle)

- **files:** `runtime/daemon/agent-manager.ts`
- **action:** Export `AgentManager` class. Constructor: `constructor(opts?: { heartbeat?: HeartbeatController })`. Methods: `async registerAgent(config: { agentId: string; runtimeId: string; org?: string; cwd: string; env: Record<string, string>; sessionId: string }): Promise<AgentHandle>` — resolves runtime via `resolveRuntime(config.runtimeId)`, calls `runtime.spawn(spawnOpts)`, stores handle in internal `Map<handleId, { handle, runtime, unsubscribe, statusState }>`, subscribes via `runtime.onStatusChanged` and persists every status change to `session.jsonl` via `appendEvent`, registers handle in heartbeat. Methods: `getHandle(handleId): AgentHandle | undefined`; `listHandles(): AgentHandle[]`; `async shutdownAgent(handleId, signal): Promise<void>` — writes `.daemon-stop` marker with `reason: "graceful"` BEFORE calling `runtime.shutdown`; calls `unsubscribe`; removes from heartbeat; deletes from internal map; `async restartAgent(handleId, reason: "stalled" | "rss-exceeded" | "crash"): Promise<AgentHandle>` — calls `runtime.shutdown(handle, "SIGTERM")`, then re-spawns via `runtime.spawn(spawnOpts)` with the SAME `sessionId` so session.jsonl replay can resume, increments `handle.generationToken`, writes `.daemon-stop` marker with `reason: "recycle"` first if reason is not "crash"; `async resolveAgentOrg(agentId: string): Promise<string | null>` — multi-org cascade per cortextOS pattern: (a) check in-memory map's stored org; (b) scan `pathFor("agents")` directory for matching `agentId` across orgs; (c) return null if none found. Wire `onForceRestart` callback to `restartAgent`. No `any`. No top-level await.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (class|function|async function)" daemon/agent-manager.ts`
- **expected:** `tsc --noEmit` exits 0. `AgentManager` class exported.

### Task 4: Implement subagent spawn semantics

- **files:** `runtime/daemon/agent-manager.ts`
- **action:** Add to `AgentManager`: `async spawnSubagent(opts: { parentHandleId: string; agentId: string; runtimeId: string; sessionId: string; env?: Record<string, string> }): Promise<AgentHandle>` — looks up parent handle; if not found, throws `Error("Parent handle not registered: <id>")`; constructs `SpawnOpts` with `parentHandle: parent.handle`, inherits `cwd` and `org` from parent, merges `env` (parent env wins for `AWS_*` and `IAGO_*` prefixes; child env wins otherwise — document the merge order in JSDoc); spawns via runtime; tracks parent-child linkage in `Map<handleId, Set<childHandleId>>`. When parent `onStatusChanged` fires with `exited` or `crashed`, automatically call `shutdownAgent(childHandleId, "SIGTERM")` for every linked child (auto-shutdown on parent exit). Cost rollup: maintain `Map<handleId, { selfCost: number; rolledUpCost: number }>`; when a child handle's `costTap` (optional) emits a `CostEvent`, add `dollarsUsd` to child's `selfCost` AND to every ancestor's `rolledUpCost`. Export helper `getCostSummary(handleId): { selfCost: number; rolledUpCost: number; total: number }`. Add unit-test scaffolding: a `_internalState()` debug method (test-only, prefixed underscore, documented test-only) returns parent-child map snapshot.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "(spawnSubagent|getCostSummary)" daemon/agent-manager.ts | wc -l`
- **expected:** `tsc --noEmit` exits 0. Method count ≥2.

### Task 5: Wire session.jsonl replay fan-out on boot

- **files:** `runtime/daemon/agent-manager.ts`
- **action:** Add `async bootRecovery(): Promise<{ recovered: string[]; cleanShutdowns: string[]; crashes: string[] }>` — runs once at daemon startup: (1) call `listAllMarkers()` from markers.ts; (2) for each marker, branch by reason: "graceful" → push to `cleanShutdowns`, clear marker, do NOT re-spawn (the daemon was stopped intentionally); "crash" or absent-marker-but-known-config → push to `crashes`, attempt `restoreFromMarker` on the registered runtime; on success spawn replay controller via `new ReplayController(handleId)`, call `pauseIntake()`, call `setHWM(handleId, await getHWM(handleId))` if HWM was stored, run `replay(cb)` where `cb` re-feeds each event through `runtime.send` if appropriate (only "prompt" or "inject" kinds — "approval", "abort", "custom" are application-level, document the per-kind replay policy), then `resumeIntake()`, push to `recovered`; "recycle" → re-spawn cleanly, no replay, push to `cleanShutdowns`. Returns the three lists for the caller (entry point in plan 07) to log. Document in JSDoc: "Replay is best-effort. Adapters that cannot resume (e.g., PTY whose subprocess is gone) return null from `restoreFromMarker`; we record the crash and skip replay rather than failing boot."
- **verify:** `cd runtime && npx tsc --noEmit && grep -c "bootRecovery" daemon/agent-manager.ts`
- **expected:** `tsc --noEmit` exits 0. `bootRecovery` mentioned ≥3 times (declaration, JSDoc, body).

### Task 6: Write agent-manager Vitest tests

- **files:** `runtime/daemon/agent-manager.test.ts`
- **action:** Build a mock `AgentRuntime` adapter (interfaceVersion "v1", shape "pty", id "mock-pty") with stubbed methods: `spawn` returns a handle with deterministic id; `send`, `shutdown` resolve; `onStatusChanged` exposes a way for the test to emit events; `isAlive` returns a controllable value; `restoreFromMarker` returns null by default; optional `costTap` async-iterable that the test can push to. Tests: (1) `registerAgent` calls runtime.spawn with correct SpawnOpts and registers in heartbeat (assert heartbeat.register called via spy); (2) status change fires `appendEvent` to session-log; (3) `shutdownAgent` writes graceful marker BEFORE calling runtime.shutdown (assert order); (4) `restartAgent("stalled")` writes recycle marker, calls shutdown, re-spawns, increments generationToken; (5) `spawnSubagent` links parent-child; emitting `exited` on parent auto-shuts child; (6) cost rollup: emit costTap event on child, assert parent's `rolledUpCost` increments by same amount; (7) `bootRecovery` with one graceful marker + one crash marker returns correct categorization, attempts replay on crash; (8) `resolveAgentOrg` returns stored org when handle exists in memory. File <450 lines. Reset registry via `_resetRegistryForTests` in beforeEach.
- **verify:** `cd runtime && npx vitest run daemon/agent-manager.test.ts --reporter=verbose 2>&1 | tail -25`
- **expected:** All 8 tests pass.

### Task 7: Write runtime/daemon/README.md

- **files:** `runtime/daemon/README.md`
- **action:** Document the daemon/ subdir: (1) Purpose — "Lifecycle layer over AgentRuntime: registration, crash recovery, heartbeat, subagent semantics, file-bus, session.jsonl, IPC. Shape-agnostic — talks to adapters via the registry."; (2) File layout — file-bus.ts, session-log.ts, state-paths.ts, markers.ts, heartbeat.ts, agent-manager.ts, ipc-server.ts (Plan 05), telemetry.ts (Plan 05); (3) `.daemon-stop` semantics — write "graceful" BEFORE shutdown; absent marker on next boot means crash; "recycle" means voluntary restart; (4) Boot recovery flow — `bootRecovery()` scans markers, restores from session.jsonl with two-phase replay; (5) Heartbeat policy — 60s probe, 512MB RSS recycling default, 5min stall threshold; (6) Subagent semantics — parent-child handle linkage, cost rollup, auto-shutdown on parent exit, env-merge policy (parent wins for AWS_*/IAGO_*; child wins otherwise); (7) Failure modes — what happens when: adapter spawn fails, runtime.shutdown hangs (force-kill after 30s in plan 04), session.jsonl corrupted (skip malformed lines, warn), HWM marker corrupted (treat as null, full replay); (8) State directory layout under `pathFor()` — tasks/{pending,claimed,resolved}/, approvals/{pending,resolved}/, agents/, markers/, session-logs/, telemetry/. File 120-200 lines.
- **verify:** `wc -l runtime/daemon/README.md && grep -c "^##" runtime/daemon/README.md`
- **expected:** Line count 120-200. Heading count (`^##`) ≥7.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-15

### Critical precision

- **PR1 (Critical) — `lastStatusChangeMs` never reset → stall detector misfires.** Task 2 says heartbeat reads `lastStatusChangeMs` from `getStatus()`, but Task 3 only specifies that status changes are persisted to `session.jsonl`. If the in-memory status-state object's `lastStatusChangeMs` is never updated on every `onStatusChanged` callback, every handle stalls after 5 minutes and gets force-restarted. **Fix:** Task 3 MUST explicitly state: "On every status callback (regardless of new value), update `internalState[handleId].lastStatusChangeMs = Date.now()`." Add Task 6 test 9: "10 successive status callbacks keep lastStatusChangeMs fresh; stall detector does NOT trigger."

### Critical edge cases

- **EC1 (Critical) — Heartbeat double-restart race.** `restartAgent` is async; heartbeat tick T1 invokes `onForceRestart(h)` which calls `restartAgent(h)`. Tick T2 fires before T1's `restartAgent` resolves — second restart call on the same handle. **Fix:** add `restartingHandles: Set<string>` field on `AgentManager`; `restartAgent` adds to set on entry, removes in `finally`; heartbeat callback checks the set and no-ops if handle is already restarting. Add Task 6 test 10 covering this race.

### Important edge cases

- **EC2 — Parent dies mid-subagent-spawn.** Between `runtime.spawn()` returning and the parent-child map insertion, parent's `onStatusChanged` fires `exited` and triggers shutdown cascade — the new child is orphaned. **Fix:** in `spawnSubagent`, after the spawn resolves, re-check parent's `isAlive()` before completing linkage; if parent is dead, immediately shutdown the new child and throw `ParentDiedDuringSpawn`.
- **EC3 — `bootRecovery` idempotency.** Calling twice replays markers twice → duplicate handles. **Fix:** add `_bootRecoveryRan: boolean` guard; second call returns the cached result. Add test covering double-call.
- **EC4 — Session.jsonl replay with mismatched adapter version.** Phase 1 has only one version, but document the gap in the README for Phase 3+ readers.
- **EC5 — costTap emits after parent shutdown.** Map entry deleted; rollup write to nonexistent ancestor. **Fix:** swallow `undefined` parent map entries silently (log debug); do not throw.

### Important precision

- **PR2 — RSS gating layer ownership.** Two RSS-check paths exist (heartbeat `getStatus().rssBytes` + adapter `isAlive()` per ADR Shape-5 semantics). Pick one canonical: heartbeat owns recycling decisions for ALL shapes; adapter `isAlive()` returns the data the heartbeat then evaluates. Document.
- **PR3 — Cost unit.** `dollarsUsd: number` float. Accept float for Phase 1; flag in `runtime/daemon/README.md` "Phase 8 SQLite ledger will use integer-cents; in-memory rollup remains float until then."
- **PR4 — Multi-org cascade tie-break.** If same `agentId` exists in two orgs, current spec returns "whichever directory entry is found first." **Fix:** require globally unique agentIds (preferred — fail loudly if duplicate found during cascade with `Error("Ambiguous agentId across orgs: <name>")`).

### Important missing criteria

- **MC1 — Restart-path replay policy.** Add to Task 3 explicitly: "Heartbeat-triggered `restartAgent` does NOT replay `session.jsonl`. Replay is BOOT-TIME only via `bootRecovery`. Mid-run restarts continue appending to the same log; the new spawn picks up fresh from current state. This is by design — replay during a running daemon would interleave with live appends."
- **MC2 — `bootRecovery` idempotency test.** See EC3.

### Standards / contradictions

- Class usage for `AgentManager` + `HeartbeatController`: CLAUDE.md's "Functional components only" rule is React-scoped. Plans correctly use classes for stateful Node server code. **Fix:** add one inline JSDoc on each class: "Class chosen over factory function for: lifecycle methods, dependency injection, test reset via `_internalState()`. CLAUDE.md rule is React-component-scoped."

### Simpler alternatives (noted, not blocking)

- `HeartbeatController` could be factory function returning `{ register, unregister, start, stop }`. Class is fine.
- Cost rollup walk-on-read vs eager-on-write: eager is correct for Phase 8 ledger integration; document tradeoff.

### Implementer forward-list

1. `lastStatusChangeMs` reset on EVERY status callback — see PR1.
2. `restartingHandles: Set<string>` guard — see EC1.
3. Parent-alive re-check before subagent linkage completion — see EC2.
4. `_bootRecoveryRan` idempotency guard + test — see EC3.
5. Pick canonical RSS gating layer (recommend heartbeat) — see PR2.
6. Multi-org cascade duplicate-agentId fails loudly — see PR4.
7. Document heartbeat-restart NO-replay policy — see MC1.
8. JSDoc inline rationale for class usage — see Standards.

## Verification

```bash
cd runtime && npx tsc --noEmit && npx vitest run daemon/markers.test.ts daemon/heartbeat.test.ts daemon/agent-manager.test.ts --coverage 2>&1 | tail -25
```

Expected:
- `tsc --noEmit` exits 0
- Vitest: `21 passed` (6 + 7 + 8)
- Coverage on `agent-manager.ts`, `heartbeat.ts`, `markers.ts` each ≥80% lines
