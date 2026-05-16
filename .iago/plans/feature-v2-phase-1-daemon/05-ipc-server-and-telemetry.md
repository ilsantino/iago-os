---
phase: feature-v2-phase-1-daemon
plan: 05
wave: 2
depends_on: [01]
context: .iago/plans/feature-v2-phase-1-daemon/CONTEXT.md
created: 2026-05-15
source: feature
---

# Plan: feature-v2-phase-1-daemon/05-ipc-server-and-telemetry

## Goal

Ship the IPC server skeleton (Unix socket on Linux with named-pipe fallback on Windows) and the telemetry event emitter (NDJSON keyed on `CLAUDE_CODE_SESSION_ID`). Phase 1 scope: stub IPC sufficient for hello-world (`fleet-health` endpoint with 30s cache); full dashboard wiring is Phase 6. Telemetry must emit the 9 canonical event types from daemon lifecycle.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `runtime/daemon/ipc-server.ts` | Unix socket / named-pipe IPC with `fleet-health` endpoint + 30s cache |
| create | `runtime/daemon/ipc-server.test.ts` | Roundtrip tests, cache freshness, platform detection |
| create | `runtime/daemon/telemetry.ts` | NDJSON event emitter keyed on `CLAUDE_CODE_SESSION_ID` |
| create | `runtime/daemon/telemetry.test.ts` | Event emission tests; missing CLAUDE_CODE_SESSION_ID fallback |

## Tasks

### Task 1: Implement telemetry event emitter

- **files:** `runtime/daemon/telemetry.ts`
- **action:** Export the discriminated union type `DaemonEvent` with `kind` field one of: `"daemon-start" | "daemon-stop" | "agent-registered" | "agent-spawned" | "task-claimed" | "approval-requested" | "approval-resolved" | "agent-exited" | "agent-restarted" | "heartbeat"`. Each kind has a typed payload — daemon-start: `{ pid: number; nodeVersion: string }`; agent-registered: `{ agentId: string; runtimeId: string; org?: string }`; agent-spawned: `{ handleId: string; agentId: string; sessionId: string; runtimeId: string; generationToken: number }`; task-claimed: `{ taskId: string; ownerId: string; attemptId: string }`; approval-requested: `{ approvalId: string; agentId: string; reason: string }`; approval-resolved: `{ approvalId: string; decision: "allow" | "deny"; resolvedBy: string }`; agent-exited: `{ handleId: string; reason: "graceful" | "crash" | "recycle"; exitCode?: number }`; agent-restarted: `{ handleId: string; reason: "stalled" | "rss-exceeded" | "crash"; generationToken: number }`; heartbeat: `{ handleId: string; alive: boolean; rssBytes?: number }`. Export async `emit(event: DaemonEvent, extra?: Record<string, unknown>): Promise<void>` that writes one NDJSON line to `pathFor("telemetry") + "/" + <date-yyyy-mm-dd> + ".ndjson"`. Each line includes: `{ at: <ISO-8601>, sessionId: process.env.CLAUDE_CODE_SESSION_ID ?? "no-session-id", pid: process.pid, ...event, ...extra }`. If `CLAUDE_CODE_SESSION_ID` is unset, use literal `"no-session-id"` AND log a stderr warning ONCE per daemon process (use a module-scope boolean flag). Use `fs.promises.appendFile`. No throws on write failure — log to stderr, continue (telemetry MUST NOT break the daemon). Export `getTelemetryPath(date?: Date): string` for tests.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (const|async function|type)" daemon/telemetry.ts`
- **expected:** `tsc --noEmit` exits 0. Exports include `DaemonEvent`, `emit`, `getTelemetryPath`.

### Task 2: Write telemetry tests

- **files:** `runtime/daemon/telemetry.test.ts`
- **action:** Use temp-dir scaffolding. Tests: (1) `emit({ kind: "daemon-start", pid: 12345, nodeVersion: "v20.10.0" })` writes one valid NDJSON line containing all keys: `at`, `sessionId`, `pid`, `kind`, `nodeVersion`; (2) two emits append (file has 2 lines, last is the second event); (3) `CLAUDE_CODE_SESSION_ID="abc-123"` is captured in the `sessionId` field; (4) missing `CLAUDE_CODE_SESSION_ID` yields `sessionId: "no-session-id"` AND a stderr warning fires ONCE (assert via `vi.spyOn(console, "error")` that call count is 1 after two emits without the env var); (5) write failure (e.g., directory is read-only — mock `fs.promises.appendFile` to reject) does NOT throw from `emit` (assert returned promise resolves); (6) telemetry path includes today's date (yyyy-mm-dd from a mocked `Date.now`); (7) `extra` field is merged into the line (`emit({ kind: "heartbeat", handleId: "h1", alive: true }, { customKey: "value" })` → line has `customKey: "value"`); (8) lines remain parseable JSON after multiple concurrent emits (use `Promise.all` of 20 emits, then read file, split by `\n`, JSON.parse each — no failures). File <250 lines.
- **verify:** `cd runtime && npx vitest run daemon/telemetry.test.ts --reporter=verbose 2>&1 | tail -15`
- **expected:** All 8 tests pass.

### Task 3: Implement IPC server with platform detection

- **files:** `runtime/daemon/ipc-server.ts`
- **action:** Export the type `IpcRequest = { method: "fleet-health"; params?: Record<string, never> } | { method: "list-agents"; params?: Record<string, never> } | { method: "get-handle"; params: { handleId: string } }` and `IpcResponse = { ok: true; data: unknown } | { ok: false; error: string }`. Export `IpcServer` class: constructor takes `{ socketPath?: string; cacheTtlMs?: number; getFleetHealth: () => Promise<unknown>; listAgents: () => Promise<unknown>; getHandle: (id: string) => unknown }`. Default `socketPath`: on Linux/macOS `/tmp/iago-os-v2-daemon.sock`; on Windows `\\.\pipe\iago-os-v2-daemon`. Default `cacheTtlMs`: 30_000 (30s). Methods: `async start(): Promise<void>` — creates a `net.createServer` and listens; handles incoming connections by reading newline-delimited JSON requests, routing by `method`, writing newline-delimited JSON responses. `async stop(): Promise<void>` — close server, wait for all in-flight requests, unlink the socket file on Linux (best-effort). Cache: maintain a single `cachedFleetHealth: { data: unknown; at: number } | null` field; `fleet-health` requests serve from cache if `Date.now() - cached.at < cacheTtlMs`, else refresh via injected `getFleetHealth()`. Cache is fleet-health-specific (other methods are not cached). On request parse errors return `{ ok: false, error: "parse-error: <detail>" }`. Document in JSDoc: "Phase 1 is stub-scope for hello-world; full dashboard wiring (Phase 6) extends the request schema." Use only `node:net`, `node:fs/promises`, `node:os`, `node:path`.
- **verify:** `cd runtime && npx tsc --noEmit && grep -E "^export (class|type)" daemon/ipc-server.ts`
- **expected:** `tsc --noEmit` exits 0. Exports include `IpcServer`, `IpcRequest`, `IpcResponse`.

### Task 4: Write IPC server tests

- **files:** `runtime/daemon/ipc-server.test.ts`
- **action:** Tests using real `net` sockets but with a temp socket path (Linux) or skipping on Windows for socket-path tests via `it.skipIf(process.platform === "win32")` while including platform-detection tests separately: (1) default socketPath is platform-correct (asserted via direct field access); (2) start + connect + send `{ "method": "fleet-health" }` + receive response — assert response shape `{ ok: true, data: <whatever getFleetHealth returns> }`; (3) two consecutive fleet-health calls within 30s — second hits cache (assert `getFleetHealth` injected fn called exactly once); (4) fleet-health after `cacheTtlMs` expiry refreshes (use fake timers + advance time, then second call invokes getFleetHealth again); (5) unknown method returns `{ ok: false, error: "..." }`; (6) malformed JSON request returns `{ ok: false, error: "parse-error: ..." }`; (7) `stop()` closes server cleanly; subsequent connection attempts fail; (8) multiple concurrent connections served correctly (10 parallel clients, each gets correct response). File <350 lines. Use `net.createConnection` and stream parsing in the test (or `net.Socket` with `.on("data")` accumulator).
- **verify:** `cd runtime && npx vitest run daemon/ipc-server.test.ts --reporter=verbose 2>&1 | tail -15`
- **expected:** All applicable tests pass; Windows skip count documented in output. At least 6 passed on Linux/macOS; at least 2 passed on Windows.

## Stress Test

**Verdict:** PROCEED_WITH_NOTES
**Date:** 2026-05-15

### Critical edge cases

- **EC1 (Critical) — Stale socket file → EADDRINUSE on restart after crash.** Plan 05 Task 3 spec: `stop()` unlinks socket. But crashes mean `stop()` never runs. Next `startDaemon()` calls `ipcServer.start()` → `net.createServer.listen(path)` throws `EADDRINUSE`. The entire daemon boot fails — including `bootRecovery` (Plan 03), which is the recovery path. Single-crash bricks the next boot. **Fix:** in `IpcServer.start()` (Task 3), preemptively call `fs.promises.unlink(socketPath)` BEFORE `listen()`, catching `ENOENT` (expected if no stale file) and re-throwing other errors. Add Task 4 test 9: "start() with pre-existing stale socket file succeeds." Plan 07 main.ts inherits this automatically since it calls `ipcServer.start()`.

### Important edge cases + missing criteria

- **EC2 — Thundering herd on cache expiry.** Two concurrent fleet-health requests at TTL boundary both call injected `getFleetHealth()`. **Fix:** add `cachedFleetHealthPromise: Promise<unknown> | null` field; concurrent requests at expiry share the in-flight promise. Test: concurrent at expiry → exactly one underlying call.
- **EC3 — Chunked TCP write.** JSON request split across multiple `data` events. **Fix:** explicitly buffer chunks in IpcServer's connection handler until `\n`, then JSON.parse the line. Document this in Task 3.
- **MC1 — Telemetry directory not lazily created.** `emit()` may run before `ensureStateDirsSync()` (test harness importing telemetry.ts directly). **Fix:** `emit()` does `await fs.promises.mkdir(path.dirname(filePath), { recursive: true })` before `appendFile` (idempotent).
- **MC2 — Empty-string `CLAUDE_CODE_SESSION_ID` slips through.** `?? "no-session-id"` does not catch `""`. **Fix:** use `process.env.CLAUDE_CODE_SESSION_ID || "no-session-id"` (truthy check). Add test 9: empty-string env var → `sessionId: "no-session-id"`.

### Minor

- M1 — Cache strictly time-based: document Phase 6 will add event-driven invalidation via IPC event bus.
- M2 — NDJSON midnight rollover: log as known edge case in telemetry.ts file header.
- M3 — `Record<string, never>` for "no params" is the correct TS idiom; document.
- M4 — IPC traceability: Plan 07 hello-world test should optionally call `list-agents` via the IPC socket to exercise the non-fleet-health path; otherwise these methods are only tested by `ipc-server.test.ts`. Acceptable either way; add a note.

### Implementer forward-list

1. `IpcServer.start()` preemptively unlinks stale socket file before listen — see EC1.
2. Cache: in-flight-promise sharing on concurrent expiry refresh — see EC2.
3. TCP chunk accumulator buffers until `\n` — see EC3.
4. `emit()` lazily mkdir the telemetry dir — see MC1.
5. Use `||` not `??` for empty-string session ID detection; add test — see MC2.

## Verification

```bash
cd runtime && npx tsc --noEmit && npx vitest run daemon/telemetry.test.ts daemon/ipc-server.test.ts --coverage 2>&1 | tail -20
```

Expected:
- `tsc --noEmit` exits 0
- Vitest: ≥14 passed across both files (some IPC tests may skip on Windows)
- Coverage on `telemetry.ts` ≥85%; coverage on `ipc-server.ts` ≥75% (cross-platform skips lower the floor slightly)
