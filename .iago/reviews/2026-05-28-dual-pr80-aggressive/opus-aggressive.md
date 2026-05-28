# PR #80 — Opus 4.7 Independent Aggressive Review

**Branch:** `feat/pr-triage-dispatch-handler`
**Plan:** `.iago/plans/feature-phase-2-vps-bootstrap/04d-pr-triage-dispatch-handler.md`
**Scope:** Classes the async @claude bot tends to miss — concurrency/race, data loss/claim semantics, auth/boundary, rollback safety, telemetry integrity, plan compliance, test quality.
**Previously reported (do not repeat):** I-1 (startDaemon integration tests missing), M-2 (removeAllListeners too broad), M-3 (empty-prompt silent no-op), M-4 (DN-4 comment mislabel).

---

Verdict: **PROCEED_WITH_FIXES**

Three findings require fixes before the next phase execution; the rest are advisory.

---

## Critical

None.

---

## Important

### I-A: DN-4 test does not actually validate the no-double-claim invariant it claims to prove

**File:** `runtime/daemon/agent-manager.test.ts:2079–2121`

The test title is "listener exception is caught by polling tick wrapper; no double-claim, claimTask NOT called." The body registers a synchronous throwing listener, then calls `_pollingTickForTests()` with `.catch(() => {})`.

The problem: `processPendingTask` calls `this.emit("task-dispatch-needed", ...)` synchronously (Node's EventEmitter `emit` is sync). A synchronous throw from the listener propagates directly out of `this.emit(...)`, which propagates out of `processPendingTask`, which propagates out of `runPollingTick`, which is caught by the try/catch in `runPollingTick`'s `for` loop at line 1603–1612. That catch block emits `polling-loop-error` telemetry and continues the loop — crucially, `claimTask` is indeed NOT called because the throw exits `processPendingTask` before the dispatch branch returns.

So the invariant holds at runtime — but the test does not actually assert it correctly. The test asserts the file stays in `tasks/pending/` and `task-resolved` is not emitted, which are correct. However the `.catch(() => {})` on `_pollingTickForTests()` hides whether the tick itself threw or completed cleanly. More critically: the test passes vacuously in the "claimTask not called" sense because there is no claimTask spy — the mgr is a full `AgentManager` instance (not a stub), and the test can only infer claimTask absence via the file-system check. If a future refactor of `processPendingTask` reorders the `return` after `this.emit(...)` such that `claimTask` is called even after the listener throws (e.g., in a try/finally), the test would fail on the `fsp.access(pending)` check — but that check is the indirect proxy, not the primary assertion.

**Risk:** Future refactors of the emit-then-return pattern (e.g., wrapping in try/finally for cleanup) may silently break the no-double-claim contract without the test catching it cleanly. The contract is safety-critical: a double-claim moves the file to `resolved/` without the prompt ever having been sent to the agent.

**Fix:** Add a spy directly on `mgr.claimTask` (replace the method on the instance after construction) and assert `claimTaskSpy` was never called. Then remove the `.catch(() => {})` wrapper and let `_pollingTickForTests()` either resolve or assert-reject. Also assert that `polling-loop-error` telemetry was emitted (confirming the exception was surfaced, not swallowed silently).

---

### I-B: `TASK_PAYLOAD_MAX_BYTES` check uses `Buffer.byteLength(raw, "utf8")` but `raw` was already decoded from UTF-8 — check fires after the memory hit

**File:** `runtime/daemon/agent-manager.ts:1644–1656`

```
raw = await fsp.readFile(src, "utf8");
...
if (Buffer.byteLength(raw, "utf8") > TASK_PAYLOAD_MAX_BYTES) {
```

`fsp.readFile(src, "utf8")` allocates the full string in Node's V8 heap before the size check runs. A 10MB task file causes a 10MB string allocation plus the `Buffer.byteLength` computation, then gets poisoned. The I3 stress-test comment says "BEFORE JSON.parse" — true — but does NOT say "BEFORE memory allocation," which is the actual threat the plan specified ("prevent EventEmitter memory blow-up"). The cap fires before the parse but after the read.

**Severity rationale:** This is Important rather than Critical because the cap still prevents the EventEmitter payload blow-up (the parsed object is never constructed; the emit never fires). The memory allocation is bounded at read time per file, not multiplied by listeners. But the stated security rationale in the comment ("cap payload...to prevent EventEmitter memory blow-up") is misleading — the allocation already happened. A genuinely adversarial file writer can cause one large allocation per polling tick.

**Fix:** Two options: (a) use `fsp.stat` before `readFile` to check file size without allocating (preferred — avoids the allocation entirely for oversized files); (b) keep current approach but correct the comment to say "prevents parse + emit memory blow-up; the read allocation is still bounded at `TASK_PAYLOAD_MAX_BYTES + overhead`." Option (a) closes the actual threat; option (b) is a comment-only fix if the allocation cost is accepted.

---

### I-C: `registerAgent` called at daemon startup for cron agents uses the real PTY adapter — it actually spawns a PTY subprocess at startup

**File:** `runtime/daemon/main.ts:1168–1181`

```ts
await agentManager.registerAgent({
    agentId: opts.agentId,
    runtimeId: agentConfig.runtimeId,  // "claude-pty" in production
    ...
    sessionId: makeDaemonStartupSessionId(opts.agentId),
});
```

`registerAgent` calls `runtime.spawn(spawnOpts)` unconditionally (agent-manager.ts:334). For `runtimeId: "claude-pty"`, this spawns a real PTY subprocess at daemon startup. The plan says "pre-register pr-triage at daemon startup via `agentManager.registerAgent`" — the plan assumes this is a lightweight registration that makes `isAgentRegistered(agentId)` return true. It does not say "spawn a live PTY at boot."

This has two consequences:
1. The daemon now starts a Claude Code PTY process immediately on boot, consuming memory and credentials, even when no PR-triage task has fired yet.
2. If Claude Code exits (credential expiry, crash, etc.) between daemon boot and the first cron-fire, `isAgentRegistered("pr-triage")` returns false (heartbeat recycles or `handleStatusChange` fires `exited`), and the dispatch handler emits `pr-triage-dispatch-failed { reason: "unregistered" }` on the first cron-fire — the pre-registration is lost.

The plan's intent was to make the polling loop route through dispatch rather than emit `task-unrouted`. A cheaper mechanism exists: `isAgentRegistered` could be bypassed by a separate flag/set that records "this agentId has a dispatch handler." The current code couples "agent has a live runtime handle" with "dispatch is wired" — those are distinct concerns.

**Severity rationale:** Important rather than Critical because pr-triage's daily cadence means the PTY lifetime mismatch is unlikely to surface in Phase 2. However, this is a structural hazard that grows worse in Phase 3+ (multiple agents, longer uptimes, credential rotation). The boot-time spawn is load-bearing: removing it without providing an alternative mechanism for `isAgentRegistered` to return true would break dispatch routing. This needs a design decision before Phase 3.

**Fix options:** (a) Document the current behavior explicitly — "daemon boots a live PTY per cron agent" — and add a heartbeat-driven re-registration if the handle exits (closes the credential-expiry gap); (b) introduce a lightweight `preRegisterAgentId(agentId)` that makes `isAgentRegistered` return true without spawning, and defer the actual spawn until first dispatch. Option (b) requires an AgentManager API change.

For Phase 2 with one agent and daily cadence: document option (a) and add re-registration on handle exit. This is the minimum fix for the production hazard.

---

## Medium

### M-A: Teardown order: `removeAllListeners` runs after `scheduler.stop` but the interval between the two is the exact race window

**File:** `runtime/daemon/main.ts:1283–1315`

The shutdown sequence is:
1. `scheduler.stop()` — stops new cron-fires
2. `agentManager.removeAllListeners('task-dispatch-needed')`
3. `agentManager.stopPollingLoop()`

The plan stress test C2 says removeAllListeners must run BEFORE stopPollingLoop — the impl satisfies that. However between `scheduler.stop()` completing and `removeAllListeners` executing, the polling interval can still fire (it runs on its own `setInterval`). If a tick fires in that window and picks up a `tasks/pending/` file (written by a cron that fired before `scheduler.stop`), it will see `listenerCount('task-dispatch-needed') > 0` (listener is still wired), emit the event, the listener invokes `makeTaskDispatchHandler`, which calls `runtime.send` and then `claimTask`. This is the intended path and it is correct.

The actual race is narrower but still exists: between `removeAllListeners` completing and `stopPollingLoop` completing, a tick that was already in-flight (started before `removeAllListeners`) can be mid-`processPendingTask`. If it just passed the `listenerCount` check (it was > 0 at check time), the listener fires — but `removeAllListeners` has already unregistered it, so `this.emit('task-dispatch-needed', ...)` fires to zero listeners. The fallback path (`listenerCount > 0` was already evaluated as true before `removeAllListeners` ran) means the event goes to no listeners and `claimTask` is NOT called — the file stays in `pending/`. This is the correct failure mode (not a data-loss scenario), but it means a task that was in the middle of being dispatched during shutdown silently leaves the file in `pending/` for the next boot. The operator has no telemetry event indicating this happened.

**Fix:** Add a `pr-triage-dispatch-failed { reason: "shutdown-race" }` path (or reuse `listener-exception`) when `this.listenerCount('task-dispatch-needed') === 0` at dispatch time but the check at the top of `processPendingTask` was `> 0` (i.e., if the emit fires to no listeners). This requires knowing post-emit that nobody handled it, which EventEmitter does not expose directly. Alternative: check `listenerCount` again after `this.emit(...)` returns; if 0, fallthrough to `claimTask` with a log.

This is Medium because the failure is leave-in-pending (retried on next boot) not data loss, and the race window is milliseconds.

---

### M-B: `agentId` in the task file is used as a routing key without sanitization before `isAgentRegistered`

**File:** `runtime/daemon/agent-manager.ts:1672–1677`

```ts
const agentId = (parsed as { agentId: string }).agentId;
if (!this.isAgentRegistered(agentId)) {
```

`isAgentRegistered` does a linear scan over `this.handles.values()` comparing `tracked.handle.agentId === agentId`. There is no length cap or character validation on `agentId` at this point (the upstream `missing-agent-id` poison only checks `typeof ... === "string"` — not length, not content). A task file with `agentId: "x".repeat(10_000_000)` passes the type check and reaches `isAgentRegistered`. The scan itself is O(n) over registered agents (short in Phase 2), so this is not a DoS via scan. The agentId never reaches a filesystem path here (that happens in `claimTask` via `assertSafeIdentifier`). However the string itself sits in memory as part of the parsed object, and in the dispatch event payload.

The separate `assertSafeIdentifier` in `claimTask` will throw on a malformed agentId, which promotes to `listener-exception` telemetry. So data integrity is protected at the claim boundary. The gap is that a huge agentId string is held in memory in the EventEmitter payload between dispatch-emit and the failed claim.

**Fix:** Add a length cap check (e.g., 255 chars) on the `agentId` field after the type check, treating oversized agentIds as `missing-agent-id` poison. This closes the memory-hold without adding meaningful complexity.

---

## Minor

### m-1: `taskDispatchListener` is defined but `removeAllListeners` in shutdown does not target it specifically

(Already reported as M-2 by the async bot — not duplicating, noting it is confirmed by reading the exact shutdown code at `main.ts:1310`.)

### m-2: `loadAgentConfig` validates `env` values are strings but not that keys are strings

**File:** `runtime/daemon/main.ts:475–481`

```ts
for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
    if (typeof v !== "string") {
        throw new Error(...);
    }
    env[k] = v;
}
```

`Object.entries` always yields string keys — this is correct for plain objects. But the type cast `as Record<string, unknown>` could in theory apply to a Proxy or unusual object. This is safe for JSON-parsed input (JSON object keys are always strings). No fix required.

### m-3: `makeDaemonStartupSessionId` appends `agentId` verbatim without asserting safe-identifier compliance

**File:** `runtime/daemon/main.ts:657`

The agentId parameter is the directory name from `resolveAgentsDir()` (loaded via `loadCronEntries`). `loadCronEntries` does not call `assertSafeIdentifier` on the directory name before using it as `agentId`. If an `agents/` subdirectory has a name containing `/` or `..`, the session ID produced here would be malformed — and `registerAgent` would then throw via `assertSafeIdentifier(config.sessionId)`. The failure is noisy (throws) rather than silent. No fix strictly required, but a defensive note in the JSDoc would help the next reader.

### m-4: `DH-5` test comment calls "no-op" behavior "degraded but accountable" — but this contradicts the bot's M-3 finding

The test at `main.test.ts:1038` deliberately asserts that an empty prompt is sent and the task is claimed. The bot found M-3: "empty-prompt dispatch silently no-ops." These are inconsistent — re-read: the test sends `""` as the prompt text (the `typeof promptRaw === "string"` guard evaluates `""` as `""`, not as a no-op). The agent receives an empty-string prompt via PTY stdin. This is not a silent no-op; it is a degenerate prompt. The bot's M-3 finding appears to describe the behavior as a "silent no-op" from the plan's perspective (plan said wait for clean exit; impl claims on send). The test intentionally validates the current behavior. No new finding here — confirming consistency.

---

## Positive observations

1. **TASK_PAYLOAD_MAX_BYTES placement.** The cap fires before `JSON.parse` — CPU is protected even if RAM is not. The EventEmitter payload never contains a 1MB+ parsed object.

2. **Shutdown order (C2).** `removeAllListeners` at `main.ts:1310` is correctly placed before `stopPollingLoop` at `main.ts:1316`. The stress-test C2 contract is honoured in the final code.

3. **`makeTaskDispatchHandler` factory pattern.** Extracting the handler into a testable factory was the right call — DH-1 through DH-5 exercise it directly without standing up the full daemon. The outermost try/catch (I1 stress fix) correctly surfaces any unexpected throw as `listener-exception` rather than letting it propagate as an UnhandledPromiseRejection.

4. **`makeDaemonStartupSessionId` UUID4 suffix.** Using 32 hex chars from a UUID4 (128 bits) makes collision probability negligible at Phase 3+ scale. The SID-2 test (32 independent calls, no collisions) correctly validates this.

5. **`loadAgentConfig` fail-loud contract.** Every failure mode (ENOENT, bad JSON, missing field, wrong type) throws with a message that names the file and the field. The caller (`startDaemon`) catches per-agent and continues — degraded state is logged, not hidden.

6. **`TaskDispatchPayload` typed shape.** Keeping `agentId: string` in the index-signature interface rather than widening to `Record<string, unknown>` means upstream drift on the agentId field fails TypeScript at the emit site.

7. **DN-1, DN-2, DN-3, DN-5 test quality.** These four tests use real `AgentManager` instances with real filesystem state, verify the actual file-system outcome (not just mock calls), and are resilient to mock-papering. They would fail without the fix.

---

## Cross-cutting verification log

### Auth / boundary
- **Task file source authentication:** Anyone who can write a `.json` file to `tasks/pending/` triggers dispatch. Per the architecture, only the `CronScheduler` writes to `tasks/pending/`. `CronScheduler` is an in-process construct in `startDaemon` — it is not externally accessible. The IPC server does not expose a "write task" endpoint. **Confirmed safe in Phase 2.** Phase 3 expansion of IPC surface would need to re-audit this.
- **`agentId` as directory key / path traversal:** `agentId` from the task file is passed to `isAgentRegistered` (in-memory scan, no filesystem involvement) and then to `claimTask` → `assertSafeIdentifier`. `assertSafeIdentifier` rejects `/`, `\\`, and `..`. Path traversal is blocked at the claim boundary. **Confirmed safe**, with the caveat noted in M-B (memory hold of oversized strings before the boundary check).
- **`agentsDir` path traversal in `loadAgentConfig`:** `agentId` passed to `loadAgentConfig` comes from `opts.agentId` which comes from `loadCronEntries`. `loadCronEntries` derives agentId from `entry.name` (directory entries), which Node returns as bare names (no separators). Path join is safe. **Confirmed safe.**

### Data loss / claim semantics
- **Claim-on-send vs plan's claim-on-exit:** Documented deviation is in the `makeTaskDispatchHandler` JSDoc. The claim happens immediately after `runtime.send` resolves. If the PTY crashes between `send` returning and the agent reading stdin, the task is claimed (moved to `resolved/`) but never processed. This is an **accepted risk** for the daily-cadence Phase 2 use case. The comment is clear and the plan deviation is explicitly acknowledged. **Raising as I-C** (PTY crash between send and read = data loss without retry), but severity accepted at Important because the plan itself sanctioned the deviation.
- **`claimTask` rename failure:** If `fsp.rename` fails in `claimTask`, the error is surfaced as `claim-task-failed` telemetry and the function returns without throwing. The dispatch handler's `try { await agentManager.claimTask(...) } catch (err)` catches an unexpected throw from `claimTask` (e.g., `assertSafeIdentifier` failure) and emits `listener-exception`. The rename failure path never throws — it swallows and returns. So a rename failure leaves the file in `pending/` (correct retry behavior) AND emits `claim-task-failed` telemetry. **Confirmed safe.**
- **Telemetry throw inside dispatch handler:** `emit` in `makeTaskDispatchHandler` is the injected `emit` from `main.ts`. Telemetry `emit` in `telemetry.ts` never throws (it catches all write errors internally). So an `emit` call inside the dispatch handler cannot cause the outer try/catch to fire unexpectedly. **Confirmed safe.**

### Concurrency / races
- **`pollingTickInFlight` mutex:** `runPollingTickGuarded` uses a promise reference as a mutex. If `pollingTickInFlight` is non-null, the new tick skips. The `finally` block clears it. This is correct single-tick re-entrancy prevention. **No race found.**
- **`taskDispatchListener` fires while polling tick mid-claim:** The dispatch listener is invoked synchronously by `this.emit(...)` inside `processPendingTask`. The listener body is `void taskDispatchHandler(evt)` — fire-and-forget. `processPendingTask` returns immediately after the emit (the `return` at line 1690 exits before the async handler resolves). So the polling tick completes without waiting for the handler. A second tick can start while the first handler is still awaiting `runtime.send`. If both ticks pick up the same file: the second tick reads the file, parses it, passes `isAgentRegistered`, fires the dispatch event again. Both handler invocations call `claimTask`. The first `claimTask` renames `pending/X → resolved/X`. The second `claimTask` attempts to rename `pending/X` which is now ENOENT (or ENOENT after the rename). `claimTask`'s rename failure path emits `claim-task-failed` telemetry and returns — no double-move. **Duplicate dispatch to the agent is possible** (two `runtime.send` calls with the same prompt), but not a data-loss scenario. For daily cadence this is negligible. **Confirmed safe for Phase 2**, known hazard for high-frequency crons.
- **`AgentManager.registerAgent` concurrent with dispatch listener:** The `registrationLocks` mutex in `registerAgent` ensures sequential registration per agentId. The dispatch listener resolves the handle via `findHandleForAgent` (linear scan of `this.handles`). No lock is held during the scan. If `registerAgent` is called concurrently with a dispatch (e.g., bootRecovery + dispatch on the same agentId), the handle map may be mid-write. Node.js is single-threaded; the scan and the map write cannot interleave. **Confirmed safe.**

### Rollback safety
- **Partial agent registration (one of N agents fails):** `startDaemon` wraps each `registerAgent` in its own try/catch and continues on failure. Partially-registered agents emit `unregistered` on first dispatch. No cleanup of partial state: a failed `registerAgent` may have written a `.daemon-stop` marker or a `<handleId>.json` config file before the throw. Checking: `registerAgent` calls `assertAgentIdAvailable` → `runtime.spawn` → `trackHandle` → `persistAgentConfig`. A throw at `runtime.spawn` means no handle, no marker, no config file. A throw at `trackHandle` is very unlikely (map write). A throw at `persistAgentConfig` is also caught internally (it logs and returns). So partial state is minimal. **Confirmed safe** — no cleanup required for the spawn-failure case.
- **Cron-registered agent's handle dying mid-cycle:** If `registerAgent` succeeds at boot and the PTY handle later exits (crash, heartbeat recycle), `isAgentRegistered` will return false for subsequent polling ticks. The dispatch path will not fire; `task-unrouted` will be emitted instead. No re-registration is attempted automatically. This is the same issue raised in I-C. **Finding raised (I-C).**

### Telemetry integrity
- **Failure paths covered by `pr-triage-dispatch-failed`:** `unregistered`, `send-failed`, `listener-exception`. Checked against the code:
  - `handle === null` → `unregistered`. Covered.
  - `runtime.send` throws → `send-failed`. Covered.
  - `resolveRuntime` throws (missing runtime) → caught by outer try/catch → `listener-exception`. Covered (DH-4 tests this).
  - `claimTask` throws (e.g., `assertSafeIdentifier` on malformed filename) → caught by inner try/catch around `claimTask` call → `listener-exception`. Covered.
  - `claimTask` rename fails → handled inside `claimTask` (emits `claim-task-failed`, returns without throwing) → outer handler sees no exception, but task stays in `pending/`. This path produces `claim-task-failed` but NOT `pr-triage-dispatch-failed`. Operator gets the right telemetry event for the actual failure. **Confirmed intentional and correct.**
  - **Missing path:** payload-too-large and JSON parse failure are handled in `processPendingTask` via `poisonTask` BEFORE the listener fires — these produce `task-poisoned`, not `pr-triage-dispatch-failed`. Correct per the architecture.
  - **Missing path:** agentId missing from task is handled via `poisonTask(filename, "missing-agent-id")` BEFORE the listener fires. Correct.
  - No silent failure paths detected that should emit `pr-triage-dispatch-failed` but do not.
