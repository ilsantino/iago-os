# `runtime/integration/` — Phase 1 hello-world acceptance gate

## Purpose

End-to-end integration suite for the v2 daemon. The single test file
(`hello-world.test.ts`) is the Phase 1 ACCEPTANCE GATE per Plan 07
(`.iago/plans/feature-v2-phase-1-daemon/07-hello-world-integration-and-rollback.md`).
It drives the full daemon via `startDaemon()` — wiring `AgentManager`,
`HeartbeatController`, `IpcServer`, `TelegramBot`, and a real `claude-pty`
agent (`node-pty` mocked) — and exercises the canonical hello-world flow:

```
register Claude PTY agent (daemon auto-start)
  → file-bus claim via claimTask (emits task-claimed)
  → createApprovalRequest writes approvals/pending/<id>.json
  → bot.sendApprovalRequest posts inline keyboard (emits approval-requested)
  → simulate Telegram approve_allow_<id> by emitting on bot's callback_query listener
  → bot's production handler calls resolveApproval (emits approval-resolved)
  → approvals/pending → approvals/resolved transition observed
  → waitForApproval resolves with decision: "allow"
  → agent writes resolved output (owner-id matched; zombie write rejected)
  → graceful shutdown emits agent-exited per handle + daemon-stop
  → telemetry NDJSON contains ALL 7 canonical event kinds
```

The suite covers the five test cases that gate Phase 1 merge:

| Test | Acceptance criterion gated |
|------|-----------------------------|
| `claude-pty adapter registers via side-effect import` | #4 (registry contract from agent-runtime/README.md:64-65) |
| `full hello-world ... emits all 7 canonical events` | #3 (E2E), #5 (telemetry) |
| `SIGINT during pending spawn shuts down newly-spawned handle (EC1)` | Plan 07 stress notes EC1 |
| `bootRecovery uses persisted agent records (Codex H1 / Opus I2)` | crash-without-marker recovery |
| `daemon startup and shutdown lifecycle is idempotent` | basic lifecycle |
| `graceful shutdown writes daemon-stop markers per live handle` | Plan 03 marker contract |

## Dependencies

Runtime (production):
- `runtime/daemon/main.ts` (`startDaemon`, `loadPersistedConfigs`)
- `runtime/daemon/{file-bus, markers, state-paths, telemetry}.ts`
- `runtime/agent-runtime/registry.ts` + `runtime/agent-runtime/pty/claude-pty.ts`
- `runtime/telegram/{bot, approval-bus, commands}.ts`

Test-only:
- `vitest` ≥2.1
- `node:events` `EventEmitter` (stand-in for `node-telegram-bot-api`)

Mocked at module boundary (via `vi.mock`):
- `node-pty` — controllable PTY subprocesses; tracks every `spawn()` call.
- `node-telegram-bot-api` — constructor returns the per-test
  `FakeTelegramBot` (an `EventEmitter`) so the production
  `bot.on("callback_query", ...)` listener is the listener driven from
  the test.
- `agent-runtime/pty/version-pin.js` — skip `claude --version`; respect
  `ptySpawnDelayMs` knob to widen the spawn window for the EC1
  SIGINT-mid-spawn test.

## Configuration

The suite is hermetic — every test gets a fresh temp state root via
`fs.mkdtemp` and sets `IAGO_DAEMON_STATE_ROOT` for that scope.
`CLAUDE_CODE_SESSION_ID=hello-world-session` is set so telemetry lines
carry a deterministic session id (acceptance criterion #5 assertion
hook).

Environment that MUST be empty at suite start (or the test deletes them
in `beforeEach`):
- `IAGO_TELEGRAM_BOT_TOKEN`
- `IAGO_TELEGRAM_ALLOWED_USER_IDS`

The registry is reset in `beforeEach` via `_resetRegistryForTests()` and
the `claudePty` adapter export is re-registered manually (ESM module
caching means a dynamic re-import does not re-fire the side-effect
`registerRuntime` call).

## How to run

Single command, from `runtime/`:

```bash
cd runtime
npm install
npx vitest run integration/hello-world.test.ts --reporter=verbose
```

Or as part of the full suite:

```bash
cd runtime && npm test
```

Coverage gate (acceptance criterion #2):

```bash
cd runtime && npx vitest run --coverage
```

## Ops runbook — what to check when this fails

| Symptom | Likely cause | First check |
|---------|--------------|-------------|
| `No AgentRuntime registered for id: claude-pty` | `_resetRegistryForTests()` ran without re-registering `claudePty`. | `beforeEach` calls `registerRuntime(claudePty)` after the reset. |
| `waitForApproval timed out` | Bot's `callback_query` handler did not fire; either `FakeTelegramBot` wasn't returned by the mocked constructor, or `bot.start()` was called before `vi.doMock` took effect. | Inspect `activeFakeBot` is non-null post-`startDaemon`; verify `bot.on("callback_query", ...)` listener count == 1. |
| Missing telemetry events | Side-effect emit chain broken (file-bus `claimTask` emits `task-claimed`; bot `sendApprovalRequest` emits `approval-requested`; bot `dispatchApprove` emits `approval-resolved`; main.ts shutdown emits `agent-exited` per handle). | `head -50 <stateRoot>/telemetry/<date>.ndjson` and grep for the missing `kind`. |
| `ENOENT` on `<state-root>/agents/<id>.json` during bootRecovery test | Test wrote the persisted record to the wrong path. | Confirm `pathFor("agents")` resolves under the test's `IAGO_DAEMON_STATE_ROOT`. |
| Ghost `ENOENT` on `~/.iago-os/daemon-state/session-logs/<id>.seq` after test exit | Status-callback raced afterEach; the test drains via 50ms sleep before unsetting env. | If frequent, increase the drain in `afterEach`. |

## Failure modes documented

- **Real claude binary on PATH overrides the mock.** `vi.mock("node-pty")` is
  module-boundary-scoped; if a future test file imports `node-pty` without
  the mock, it could attempt to spawn the real binary. Guard: keep
  `vi.mock` at file top.
- **Concurrent runs on the same machine.** Each test creates an isolated
  temp state root via `fs.mkdtemp`, so concurrent test processes do not
  collide on `tasks/`, `approvals/`, `markers/`, `session-logs/`, or
  `telemetry/`. The IPC socket path is also randomized
  (`iago-test-<pid>-<timestamp>-<random>`).
- **Telegram bot started polling against real Telegram.** Impossible in
  this suite — the `node-telegram-bot-api` constructor is mocked and
  never opens a network connection. Production deploys MUST set
  `IAGO_TELEGRAM_BOT_TOKEN` to a real bot.
- **`ptySpawnDelayMs` leaks across tests.** Reset in `_resetPtyMockState()`
  in `beforeEach`. If you add a new test that mutates the knob, ensure
  it sets `ptySpawnDelayMs = 0` in a `finally` block.
- **ESM module cache prevents `vi.resetModules` from clearing
  `registerRuntime`.** Worked around by importing `claudePty` directly
  and calling `registerRuntime(claudePty)` after reset. Do NOT switch to
  `await import("../agent-runtime/pty/claude-pty.js")` — it is a no-op
  on cached modules.

## What this suite does NOT cover

- Real Telegram bot polling (covered separately at deploy time in
  PHASE-1-EVIDENCE.md §4 — manual run by Santiago).
- Real Claude binary spawn (same — manual run).
- VPS systemd integration (Phase 2).
- IPC socket cross-process behavior (Plan 05 unit tests cover this).

Phase 2 will add: real-Telegram smoke test (one-shot, against a sandbox
bot token), real-Claude smoke test (skipped unless `claude` is on PATH),
and a full systemd integration test on the Hostinger VPS.
