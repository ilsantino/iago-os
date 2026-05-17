---
phase: feature-phase-1-deferred-hardening
plan: 01
wave: 1
depends_on: []
context: .iago/plans/feature-phase-1-deferred-hardening/CONTEXT.md
created: 2026-05-17
source: feature
---

# Plan: feature-phase-1-deferred-hardening/01-ipc-server-hardening

## Goal

Close the 4 Important findings PR #44 surfaced against `runtime/daemon/ipc-server.ts` (review file `.iago/reviews/adv-pr44-opus-20260516-154126.md`). All four are hardening items the merge train deferred — none block the hello-world acceptance gate but every one is a defense-in-depth requirement for Phase 6 dashboard wiring. Concrete deliverables: (1) per-connection buffer cap with parse-error response + socket destroy when a line exceeds `MAX_LINE_BYTES = 64 * 1024`; (2) per-connection idle timeout (`socket.setTimeout(5 * 60 * 1000)`) destroying idle clients; (3) explicit no-op `previousTail.catch` on the `socketTails` chain to prevent stray unhandled rejection if a prior write rejected; (4) `cachedFleetHealthPromise` rejection-cache JSDoc explaining the thundering-herd posture + an optional 1s rejection-cooldown to absorb error bursts. Plus the README row 20 mislabel fix (Minor #1 from the same review). Source of truth: PR #44 review, Important #1-#4 + Minor #1.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| edit | `runtime/daemon/ipc-server.ts` | `MAX_LINE_BYTES` const + per-connection cap check; `socket.setTimeout` + timeout destroy; `previousTail.catch(() => {})` no-op; `cachedFleetHealthPromise` rejection-cooldown + JSDoc |
| edit | `runtime/daemon/ipc-server.test.ts` | 4 new tests covering each Important fix + a regression test for the README-documented `fleet-health` 30s cache (unchanged behavior, no regression) |
| edit | `runtime/daemon/README.md` | Row 20 mislabel — replace "IPC server for in-process tool dispatch + Telegram routing" with the spec-accurate one-liner "IPC server (Unix socket / named pipe) for dashboard + CLI → daemon RPC. Phase 1 stub: `fleet-health` (30s cache), `list-agents`, `get-handle`." |

## Tasks

### Task 1: Add per-connection buffer cap (`MAX_LINE_BYTES`)

- **files:** `runtime/daemon/ipc-server.ts`
- **action:** Add a module-private constant `const MAX_LINE_BYTES = 64 * 1024;` near the existing `DEFAULT_CACHE_TTL_MS`. Inside `handleConnection` (lines ~199-217 per PR #44 review), after each `chunk` append to `buffer`, check `if (buffer.length > MAX_LINE_BYTES && !buffer.includes("\n"))`. On exceed: write `{ ok: false, error: "parse-error: line-too-long" }\n` via `socket.write`, then call `socket.destroy()`, and `return` from the chunk handler. Document the chosen 64 KiB cap with a one-line comment referencing PR #44 Important #1. Threat model: same-host owner-only socket (POSIX `0o600`); the cap is hygiene to prevent a compromised daemon-user process from exhausting RSS via never-newlined input.
- **verify:** `cd runtime && npx tsc --noEmit && grep -n "MAX_LINE_BYTES\|parse-error: line-too-long" daemon/ipc-server.ts`
- **expected:** `tsc --noEmit` exits 0. `MAX_LINE_BYTES` declared once, used in the chunk handler. `"parse-error: line-too-long"` appears once in the error path.

### Task 2: Test for buffer cap

- **files:** `runtime/daemon/ipc-server.test.ts`
- **action:** Add test `"handleConnection drops a connection that exceeds MAX_LINE_BYTES without a newline"`. Setup: start IPC server with the default `fleet-health` cache; connect via `net.createConnection`; write `Buffer.alloc(100 * 1024, "x")` (no newline) to the socket. Wait for the parse-error response (collect via `socket.on("data", buf => ...)`) AND the socket-close event. Assertions: response shape is `{ ok: false, error: <string containing "line-too-long"> }`; `socket.destroyed === true` within the test's `await` window; daemon's `IpcServer` internal state (via test-only accessor if exists, else assert via subsequent independent connection still working) is unchanged — a SECOND fresh connection issuing a normal `fleet-health` request still gets a normal response. Cleanup: server.stop().
- **verify:** `cd runtime && npx vitest run daemon/ipc-server.test.ts --reporter=verbose 2>&1 | tail -25`
- **expected:** New test passes alongside the prior 21 (now 22). No regression in the chunked-TCP test from EC3.

### Task 3: Per-connection idle timeout

- **files:** `runtime/daemon/ipc-server.ts`
- **action:** Inside `handleConnection`, after `socket.setEncoding("utf8")` (line ~204 per PR #44 review), call `socket.setTimeout(5 * 60 * 1000)`. Wire `socket.on("timeout", () => { socket.destroy(); })`. Add an inline comment naming the 5-minute floor + the Phase 6 dashboard long-poll override path. Update the file-header JSDoc (lines ~5-25) to mention the per-connection idle timeout alongside the existing EC1/EC2/EC3 documentation.
- **verify:** `cd runtime && npx tsc --noEmit && grep -n "setTimeout(5 \* 60 \* 1000)\|on(\"timeout\"" daemon/ipc-server.ts`
- **expected:** `tsc --noEmit` exits 0. Both grep patterns hit once each.

### Task 4: Test for idle timeout

- **files:** `runtime/daemon/ipc-server.test.ts`
- **action:** Add test `"idle connections are destroyed after the timeout"`. Use `vi.useFakeTimers()` to control time. Setup: start IPC server; connect via `net.createConnection`; send NO bytes; advance fake timers by 5 minutes + 1 second. Assert: socket `close` event fired AND `socket.destroyed === true`. Reset to real timers in `afterEach`. If `vi.useFakeTimers` interferes with the underlying `net` module, fall back to a smaller test-only timeout overridable via an `idleTimeoutMs` option on `IpcServer` constructor (adding the option is acceptable scope-creep — document in the constructor's JSDoc as test-affordance only; default still 5 min). The added option lets the test use `idleTimeoutMs: 50` for a deterministic ≤200ms run.
- **verify:** `cd runtime && npx vitest run daemon/ipc-server.test.ts --reporter=verbose 2>&1 | tail -30`
- **expected:** New test passes deterministically in ≤500ms. Existing tests unaffected.

### Task 5: `socketTails` previousTail unhandled-rejection guard

- **files:** `runtime/daemon/ipc-server.ts`
- **action:** In `processLine` (lines ~241-249 per PR #44 review), wrap the `previousTail` reference with `.catch(() => {})` before chaining the new work. Concretely: `const safePrevious = previousTail.catch(() => {}); const work = safePrevious.then(async () => { /* existing dispatched + write */ });`. This ensures a prior tail's rejection (e.g., a write error on the previous response) does not bubble as unhandledRejection while the new work proceeds. Add JSDoc on `processLine` explaining the tail chain bound (each handler resolves then writes; previous tail's reference is dropped on overwrite — but the rejection-swallow is the defensive layer).
- **verify:** `cd runtime && npx tsc --noEmit && grep -n "previousTail.catch\|safePrevious" daemon/ipc-server.ts`
- **expected:** `tsc --noEmit` exits 0. The `.catch(() => {})` swallow appears once on the tail-chain path.

### Task 6: Test for tail-chain rejection isolation

- **files:** `runtime/daemon/ipc-server.test.ts`
- **action:** Add test `"a previous handler's write rejection does not bubble as unhandledRejection on the next request"`. Setup: register an `unhandledRejection` listener on `process` for the test duration; configure IPC server with a `getFleetHealth` that synchronously throws on the FIRST call only, then returns normally; connect via `net.createConnection`; send TWO `{ "interfaceVersion": "v1", "method": "fleet-health" }\n` lines back-to-back; await responses. Assertion: the listener was never invoked (no unhandled rejection); both responses received (first is `{ ok: false, error: "internal: ..." }`, second is `{ ok: true, ... }`). Cleanup: remove the listener.
- **verify:** `cd runtime && npx vitest run daemon/ipc-server.test.ts --reporter=verbose 2>&1 | tail -25`
- **expected:** New test passes; unhandledRejection listener never fires; both client responses received.

### Task 7: `cachedFleetHealthPromise` rejection cooldown + JSDoc

- **files:** `runtime/daemon/ipc-server.ts`
- **action:** Add a 1-second rejection cooldown to absorb error bursts on a failing `getFleetHealth` upstream. Concrete shape: introduce a private field `private cachedFleetHealthRejectionUntilMs: number | null = null;`. In the `finally` of the in-flight promise (where rejection is currently allowed to clear the cache), set `this.cachedFleetHealthRejectionUntilMs = Date.now() + 1000;` AFTER the rejection propagates to in-flight callers. On the NEXT call: `if (this.cachedFleetHealthRejectionUntilMs !== null && Date.now() < this.cachedFleetHealthRejectionUntilMs) { throw new Error("fleet-health: cooldown — upstream rejected within last 1s"); }`. Successful calls clear the cooldown (`= null`). Add JSDoc on `resolveFleetHealth` (per PR #44 Important #4) explaining the thundering-herd posture, the cooldown rationale, and the Phase 6 forward-list pointer for richer error-state caching. The 1s cooldown is the minimum-viable absorb; document the value choice.
- **verify:** `cd runtime && npx tsc --noEmit && grep -n "cachedFleetHealthRejectionUntilMs\|cooldown" daemon/ipc-server.ts`
- **expected:** `tsc --noEmit` exits 0. Cooldown field + JSDoc present. Behavior on the happy path unchanged (test 14 from PR #44 still passes).

### Task 8: README row 20 mislabel + tests for cooldown + README check

- **files:** `runtime/daemon/README.md`, `runtime/daemon/ipc-server.test.ts`
- **action:** Edit `runtime/daemon/README.md` row 20 — replace the IPC server line with the PR #44 Minor #1 recommended text: `"IPC server (Unix socket / named pipe) for dashboard + CLI → daemon RPC. Phase 1 stub: \`fleet-health\` (30s cache), \`list-agents\`, \`get-handle\`."`. Add to `ipc-server.test.ts` two tests: (a) `"rejection cooldown prevents thundering-herd on persistent upstream failure"` — `getFleetHealth` always throws; fire 5 concurrent requests; assert only ONE invocation of `getFleetHealth` (verify via spy counter) AND all 5 callers received an error; then fire a 6th request within 1s; assert NO additional `getFleetHealth` invocation (cooldown fired); fire a 7th request after `vi.advanceTimersByTime(1100)` AND switch the spy to a resolving impl; assert the 7th call gets a successful response (cooldown cleared). (b) `"successful fleet-health clears the rejection cooldown"` — sets cooldown via a failing call, advances time past 1s, succeeds with a passing call, fires immediately again, asserts a fresh call (not cached) is made within the 30s TTL window even though rejection happened earlier.
- **verify:** `cd runtime && npx vitest run daemon/ipc-server.test.ts --reporter=verbose 2>&1 | tail -40 && grep -n "Phase 1 stub: \`fleet-health\`" daemon/README.md`
- **expected:** All previous + 4 new tests pass (total ≥25). README row 20 matches the recommended text exactly. No coverage regression on `ipc-server.ts` (still ≥75% lines per the file's plan-stated floor; aim for ≥85% with the new tests).

## Verification

```bash
cd runtime \
  && npx tsc --noEmit \
  && npx vitest run daemon/ipc-server.test.ts --coverage --reporter=verbose 2>&1 | tail -40 \
  && grep -c "MAX_LINE_BYTES\|setTimeout(5 \* 60 \* 1000)\|cachedFleetHealthRejectionUntilMs\|previousTail.catch\|safePrevious" daemon/ipc-server.ts \
  && grep -c "Phase 1 stub: \`fleet-health\`" daemon/README.md
```

Expected:
- `tsc --noEmit` exits 0
- ≥25 tests pass (was 21); coverage on `ipc-server.ts` ≥85% lines
- Source-file grep count ≥5 (one match per new construct)
- README grep count = 1 (row 20 fixed)

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-17
**Reviewer:** orchestrator inline (5-dimension rubric per `.claude/rules/skill-authoring.md` § 2)

### Critical (must fix in impl)

- **C1 — `MAX_LINE_BYTES` constant placement risks accidental Phase 6 inversion.** Hardcoding 64 KiB as a module-private constant means a Phase 6 dashboard request with a legitimately-large payload (e.g., a bulk `/agents` list with embedded telemetry — currently `list-agents` returns no payloads, but Phase 6 may extend) silently rejects with a parse-error before the dashboard implementer knows the cap exists. **Fix:** add a runtime option `maxLineBytes?: number` on `IpcServer` constructor (default 64 KiB). Document the default in the JSDoc + in `runtime/daemon/README.md` Failure Modes section. Test passes the default but a separate test passes `maxLineBytes: 256` to verify configurability.
- **C2 — Rejection-cooldown wedge: cooldown error message exposes "upstream rejected" — IPC clients don't know what "upstream" means.** The cooldown error string `"fleet-health: cooldown — upstream rejected within last 1s"` leaks internal terminology and is unactionable for a dashboard implementer. **Fix:** change the error to `"fleet-health: temporarily unavailable (retry in <Nms>)"` where N = the remaining cooldown. Keep the JSDoc + comment naming "thundering-herd absorb" so the rationale is preserved for the code reader.

### Important (forward to impl, don't block)

- **I1 — Idle-timeout test risk from `vi.useFakeTimers` interfering with `net`.** Task 4 acknowledges the risk and proposes the `idleTimeoutMs` constructor option as fallback. Adopt the fallback unconditionally — the option is useful for any future Phase 6 long-poll endpoint that needs to override per-instance. Do NOT use `vi.useFakeTimers` against `net` sockets.
- **I2 — `previousTail.catch(() => {})` silent swallow may hide real bugs.** The swallow is correct for unhandled-rejection prevention but masks "previous write actually failed" signal. **Mitigation:** in addition to the no-op catch, log the rejection via `console.error("[ipc-server] previous tail rejected:", err)` so a real bug is observable in stderr. Test 6 (Task 6) asserts the listener never fires AND captures the stderr output — if a real bug regressed, both assertions would still pass but stderr would carry the trace.
- **I3 — Cooldown clears on success but not on `socket.destroy()` path.** If the FIRST call enters the cooldown via a true rejection, and the SECOND call hits the cooldown branch + throws "temporarily unavailable", and the THIRD call's `getFleetHealth` succeeds, the cooldown clears correctly. But: between calls 2 and 3, if the IpcServer is `stop()`ed and `start()`ed, the cooldown state should NOT persist across restart (it's a per-process cache, not durable). Verify the cooldown field initializes to `null` in the constructor + add a test asserting `stop() → start() → fresh call ignores prior cooldown`.

### Minor

- M1 — The README row 20 fix mentions the exact phrasing from PR #44 Minor #1; if the README has changed since 2026-05-16 (re-flowed paragraphs, table re-ordered), confirm the row is still labeled "ipc-server" before editing. Defensive grep before patch.
- M2 — Task 5's renamed local `safePrevious` may collide with an existing variable name in `processLine`. If the existing function already uses `safePrevious`, pick `chainedPrevious` instead. Verify via `grep` before patch.
- M3 — Plan 02 audits state-paths atomicRename callers; Plan 01's `ipc-server.ts` does NOT call `atomicRename` (the IPC server is socket-only, no file renames). So Plan 02 audit does not block Plan 01.

### Dimension-by-dimension verdicts

- **Precision:** All 8 tasks have exact file paths + verify commands + expected output. No "TBD" or "see review for details".
- **Edge cases:** C1 (legitimate large payload), C2 (error-string leakage), I1 (fake-timer/net incompatibility), I3 (cooldown across restart) cover the four non-obvious failure modes.
- **Contradictions:** Plan claims "no scope creep" but Task 4 adds `idleTimeoutMs?` constructor option AND Task 8/C1 adds `maxLineBytes?` option. Both are test-affordances + Phase 6 forward-compat — the rationale is justified inline. Document as "test-affordance constructor options" in the README so the next reader knows they're acceptable additions, not unauthorized API growth.
- **Simpler alternatives:** Could skip the cooldown and just document "thundering herd is Phase 6 prep work" — REJECTED, PR #44 Important #4 explicitly recommended the 1s cooldown as the "Optional Phase 1 addition" and the merge train's deferral note flagged it for the sweep. Could skip the per-connection buffer cap and just rely on POSIX `0o600` permission — REJECTED, PR #44 Important #1 names the threat model explicitly (compromised daemon-user process).
- **Missing acceptance criteria:** Task 8 verifies the README row matches; Task 2/4/6/8 cover each Important fix with a regression test. Plan compliance ledger maps Task N → review finding N.

### Implementer forward-list

1. Add `maxLineBytes?: number` constructor option (C1 fix); default 64 KiB; document in JSDoc + README Failure Modes.
2. Change cooldown error string to `"fleet-health: temporarily unavailable (retry in <Nms>)"` (C2 fix); preserve internal "thundering-herd" JSDoc.
3. Use `idleTimeoutMs?` constructor option for Task 4 test instead of `vi.useFakeTimers` against `net` (I1 fix).
4. Add `console.error("[ipc-server] previous tail rejected:", err)` alongside the `.catch(() => {})` swallow (I2 fix).
5. Add a `stop() → start() → fresh call ignores cooldown` test (I3 fix).
6. Defensive grep on `runtime/daemon/README.md` row labeling before patch (M1 fix).
7. Pick `chainedPrevious` if `safePrevious` collides (M2 fix).
