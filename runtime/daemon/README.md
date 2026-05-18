# `runtime/daemon/` — iaGO-OS v2 Daemon Lifecycle Layer

## Purpose

Lifecycle layer over `AgentRuntime`: registration, crash recovery, heartbeat,
subagent semantics, file-bus, session.jsonl, IPC. Shape-agnostic — talks to
adapters via the registry in `runtime/agent-runtime/`. Shape-specific behavior
lives in `runtime/agent-runtime/<shape>/`.

## File layout

| File | Purpose |
|------|---------|
| `state-paths.ts` | Cross-platform state-root resolution + `atomicRename` + identifier validation. Every other file calls `pathFor(kind)`. |
| `file-bus.ts` | O_EXCL task claim files + atomic resolved-output writes with owner-ID validation. |
| `session-log.ts` | Append-only NDJSON event log + two-phase replay primitive (`ReplayController`). |
| `markers.ts` | `.daemon-stop` marker write/read/clear/list for graceful-vs-crash detection on next boot. |
| `heartbeat.ts` | `HeartbeatController` — 60s probe loop, RSS-recycling, stall detection. Owns recycling decisions for ALL shapes. |
| `agent-manager.ts` | `AgentManager` — registration, status persistence, restart, subagent semantics, cost rollup, boot recovery. |
| `ipc-server.ts` (Plan 05) | IPC server (Unix socket / named pipe) for dashboard + CLI → daemon RPC. Phase 1 stub: `fleet-health` (30s cache), `list-agents`, `get-handle`. |
| `telemetry.ts` (Plan 05) | NDJSON telemetry events keyed on `CLAUDE_CODE_SESSION_ID`. |

## `.daemon-stop` semantics

The marker file at `pathFor("markers") + "/" + handleId + ".daemon-stop"` is
written BEFORE `runtime.shutdown` is called. Its reason field records WHY the
handle stopped, which drives the next-boot recovery branch:

| Reason | Meaning | Next-boot action |
|--------|---------|-------------------|
| `graceful` | Daemon stopped intentionally (user, SIGTERM, etc.) | Do NOT re-spawn. Clear marker. |
| `crash` | Daemon detected the agent crashed (heartbeat-triggered fallback) | Attempt `restoreFromMarker` + session.jsonl replay. |
| `recycle` | Voluntary restart from heartbeat (RSS-exceeded or stalled) | Re-spawn cleanly. NO replay. |

### Cascade marker reason propagation (review CRITICAL #2)

When a parent shuts down, every linked child also shuts down via
`cascadeShutdownChildren`. Each child's marker reason is the SAME as the
parent's reason — not unconditionally `graceful`:

| Parent exit path | Cascade reason on each child |
|------------------|------------------------------|
| User `shutdownAgent(parent, ...)` | `graceful` |
| Parent status callback `exited` | `graceful` |
| Parent status callback `crashed` | `crash` |
| Heartbeat-triggered `restartAgent(parent, "stalled"\|"rss-exceeded")` | `recycle` |
| Heartbeat-triggered `restartAgent(parent, "dead"\|"crash")` | `crash` |

Without reason propagation, every cascade-killed child would land on disk
as `graceful` and be silently skipped from the next-boot replay set — losing
work that was killed only because its parent crashed.

**Absent marker on next boot** means the daemon itself crashed (no chance to
write a marker). The boot recovery branch treats this as `crash` for any
agent listed in `knownConfigs` whose marker is absent and runs the same
two-phase replay path as a `crash`-marker case (review Codex H1).

The Phase 1 entry point (`runtime/daemon/main.ts`) supplies the
`knownConfigs` map via `loadPersistedConfigs()` — it reads every
`<state-root>/agents/<handleId>.json` written by
`AgentManager.persistAgentConfig` during prior `registerAgent` calls and
hands the resulting map to `bootRecovery({ knownConfigs })`. This means
the daemon-crash-without-marker recovery branch IS now wired on the
production startup path; a hard crash no longer strands formerly-registered
agents (Codex H1 / Opus I2 fix).

Integration test guard: `runtime/integration/hello-world.test.ts` >
"bootRecovery uses persisted agent records" pre-seeds a persisted record
WITHOUT a matching marker, starts the daemon, and asserts an
`agent-exited` telemetry event with `reason: "crash"` for the persisted
handleId — proving the recovery branch fires end-to-end.

## Boot recovery flow

`AgentManager.bootRecovery(opts?)` runs once at daemon startup:

1. `listAllMarkers()` scans `pathFor("markers")` for `*.daemon-stop` files.
2. For each marker:
   - `graceful` → push to `cleanShutdowns`, clear marker, do NOT re-spawn.
   - `recycle` → push to `cleanShutdowns`, re-spawn from `knownConfigs[handleId]`
     if present (no replay), clear marker.
   - `crash` → push to `crashes`, run two-phase replay: resolve runtime, call
     `restoreFromMarker(markerPath)` (skip if `null`), `pauseIntake()`, replay
     every line ≤ HWM re-feeding `prompt`/`inject` messages through
     `runtime.send` (others skipped per policy below), `resumeIntake()`.
3. Returns `{ recovered, cleanShutdowns, crashes }` for the entry point to log.

Idempotent: a second call returns the cached result (stress-test EC3).

### Adapter `restoreFromMarker` id contract (review I2)

Adapters MAY return a handle whose `id` differs from the original marker's
`handleId` (e.g., a new generation suffix). `recovered` is populated using
the **restored handle's id** — what `trackHandle` actually keyed on — not
the marker's `handleId`. This means a successful restore is always
observable in `recovered`, regardless of whether the adapter preserved the
original id.

### Adapter `costTap` shutdown contract (review M3)

Production adapters MUST terminate their `costTap` async iterator after
`shutdown` returns. The `consumeCostTap` consumer awaits the iterator; if the
adapter never closes it, the consumer hangs even after the handle is torn
down (memory + open-async-iterator leak). The Plan 03 mock test runtime
honors this contract (`shutdown` closes the cost stream and resolves the
pending `resolvers`). Adapter implementers MUST do the same.

### Per-kind replay policy

| AgentMessage kind | Replayed? | Why |
|-------------------|-----------|-----|
| `prompt` | Yes | Replaying the user's intent is required for resume. |
| `inject` | Yes | Mid-stream injections are part of the agent's input stream. |
| `approval` | No | Application-level decision; operators handle out of band. |
| `abort` | No | A prior abort already terminated the run; replay would re-trigger. |
| `custom` | No | Adapter-specific; outside the daemon's replay contract. |
| (status events) | No | Observational, not user input. |

### Heartbeat-restart NO-replay policy (stress-test MC1)

Heartbeat-triggered `restartAgent` calls do NOT replay `session.jsonl`.
Replay is BOOT-TIME only via `bootRecovery`. Mid-run restarts continue
appending to the same log; the new spawn picks up fresh from current state.
Rationale: replay during a running daemon would interleave with live appends
and produce duplicate effects.

## Heartbeat policy

| Setting | Default | Override |
|---------|---------|----------|
| Probe interval | 60_000 ms | `HeartbeatController` constructor `intervalMs` |
| RSS recycle threshold | 512 MB | `rssLimitBytes` |
| Stall threshold (no `lastStatusChangeMs` change) | 5 × 60_000 ms | `stallThresholdMs` |

### Canonical RSS gating (stress-test PR2 + Codex H3)

The heartbeat OWNS recycling decisions for ALL shapes. Adapter `isAlive()`
returns the liveness signal; the optional `AgentRuntime.getStatus(handle)`
hook supplies `{ alive, rssBytes? }`. The `AgentManager` heartbeat probe
prefers `getStatus` when present and falls back to `isAlive` (with
`rssBytes: undefined`, i.e. RSS recycling no-op) when absent. Adapters do
NOT decide recycling locally — they expose the data and let the heartbeat
enforce policy. Adapters that cannot measure RSS may omit `getStatus` or
return `rssBytes: undefined`; in either case stall and liveness recycling
still apply.

### `lastStatusChangeMs` refresh (stress-test PR1)

`AgentManager.handleStatusChange` updates `lastStatusChangeMs = Date.now()` on
EVERY status callback, regardless of new value. Without this refresh, every
handle would stall after 5 minutes regardless of activity and get
force-restarted.

### Probe / callback error swallowing

A `getStatus()` rejection logs to stderr and skips the handle for that tick.
An `onForceRestart` rejection logs to stderr; the sweep continues for the
remaining handles. The heartbeat MUST NOT crash the daemon — recycling
failure of one agent never stalls peers.

### Re-entrant restart guard (stress-test EC1 + review M1)

`AgentManager.restartingPromises: Map<handleId, Promise<AgentHandle>>` stores
the in-flight restart promise per handle. A concurrent `restartAgent` call
returns the SAME promise the first call kicked off — so both callers receive
the new generation even if the second call enters during the teardown→track
window, when the original handle is no longer in `this.handles`. No
"unknown handle" throw window remains.

### Heartbeat ↔ `restartAgent` auto-wiring (Plan 03 Task 3)

`AgentManager` constructor inspects the supplied `HeartbeatController` and
replaces its `onForceRestart` callback with
`(id, reason) => this.restartAgent(id, reason)` via
`HeartbeatController.setForceRestartCallback`. The original callback passed
to the heartbeat constructor is overwritten — callers MUST NOT rely on the
constructor-time callback for production wiring; it is preserved only as a
default for stand-alone heartbeat usage (e.g., unit tests of the heartbeat
itself). Without this binding, the heartbeat → recycle pipeline would be
silently inert.

## Subagent semantics

`AgentManager.spawnSubagent({ parentHandleId, agentId, runtimeId, sessionId, env? })`:

- **Parent-child linkage** — `parentChildren: Map<handleId, Set<childHandleId>>`.
- **Cost rollup** — when a child's `costTap` emits a `CostEvent`, the child's
  `selfCost` increments AND every ancestor's `rolledUpCost` increments by the
  same amount. Walks the parent chain on each event; missing ancestors are
  silently dropped (stress-test EC5).
- **Auto-shutdown on parent exit** — when the parent's status callback fires
  `exited` or `crashed`, `cascadeShutdownChildren` is invoked. Each child gets
  a graceful shutdown (`SIGTERM`).
- **Cascade independent of adapter callbacks (Codex H2)** —
  `shutdownAgent` and the restart path explicitly invoke
  `cascadeShutdownChildren` BEFORE calling `runtime.shutdown` on the
  parent. Adapters that do not emit a terminal `exited`/`crashed`
  callback during shutdown would otherwise leak children; the explicit
  cascade makes child cleanup independent of adapter callback semantics.
  Restart additionally severs the parent-child link entirely — the new
  parent generation has no children, and the application layer must
  respawn them (silently re-linking to a stale id would mask leaks).
- **Env-merge policy** — parent env wins for `AWS_*` and `IAGO_*` prefixes;
  child env wins otherwise. Prevents the child from overriding cloud
  credentials inherited from the parent's process tree.
- **Parent-died-during-spawn (stress-test EC2)** — after `runtime.spawn`
  returns, the manager re-checks parent liveness via `runtime.isAlive` before
  completing the linkage. If the parent is dead (or its handle is gone from
  the map), the new child is shut down and the spawn throws
  `ParentDiedDuringSpawn`. Prevents orphaned children when the parent exits
  mid-spawn.

## Multi-org cascade

`AgentManager.resolveAgentOrg(agentId)`:

1. Walk in-memory handle map; return stored `org` if a matching handle is found.
2. Otherwise scan `pathFor("agents")` for any `<handleId>.json` whose
   `agentId` matches.
3. If found in more than one distinct org, throw
   `Ambiguous agentId across orgs: <name>` (stress-test PR4). AgentIds MUST
   be globally unique.

### Write-side uniqueness enforcement (review CRITICAL #1)

PR4 invariant is enforced at TWO points:

- **Write-side:** `registerAgent` holds a per-agentId in-process mutex
  (`registrationLocks: Map<agentId, Promise>`) AND runs a pre-spawn check
  via `assertAgentIdAvailable(agentId, attemptedOrg)`. The check walks
  in-memory handles + the on-disk `pathFor("agents")` scan. If a record
  exists in a DIFFERENT org, throws `AgentIdAlreadyRegisteredError`
  BEFORE `runtime.spawn` runs — no orphan adapter resources, no marker.
  Same-org re-registration is permitted.
- **Read-side:** `resolveAgentOrg` still throws on ambiguous on-disk
  records as a defense-in-depth check.

Parallel `registerAgent({agentId: "x", org: "a"})` /
`registerAgent({agentId: "x", org: "b"})` calls serialize through the
mutex; the second call sees the persisted record from the first and
throws `AgentIdAlreadyRegisteredError`.

## Handle-id stability across restart (review CRITICAL #3)

`AgentManager.restartAgent` passes the original `handleId` as
`SpawnOpts.restoreId` to `runtime.spawn`. Adapters MUST honor this — the
returned `AgentHandle.id` must equal `opts.restoreId`. Adapters that
cannot honor a caller-supplied id (e.g., because the underlying provider
mints the id externally) MUST throw rather than silently substitute a
fresh id; substitution re-introduces the staleness bug where a
concurrent `restartAgent(originalId)` caller receives a handle whose id
no longer matches anything `getHandle` knows about.

The contract: handle ids are STABLE across restart; generations are the
only signal callers should use to discriminate generations. The
generation token in `AgentHandle.generationToken` monotonically
increments on every restart.

`AgentManager` enforces the contract: if `restoreId` is supplied but the
adapter returns a handle with a different id, the rogue handle is shut
down and `Error("...violated SpawnOpts.restoreId contract...")` is
thrown — making the violation loud rather than producing a stale handle
map.

## Cost-unit convention (stress-test PR3)

`dollarsUsd: number` is a JavaScript float for Phase 1. The in-memory rollup
remains float until Phase 8 introduces the SQLite cost ledger, at which point
the ledger stores integer cents. Treat the in-memory total as advisory; the
ledger is canonical.

## Failure modes

| Failure | Behavior |
|---------|----------|
| `runtime.spawn` rejects | `registerAgent` propagates; no handle tracked, no marker, no config persisted. |
| `runtime.shutdown` hangs | Plan 04 adds 30s force-kill upgrade (`SIGTERM` → `SIGKILL`). Entry point may wrap with its own timeout. |
| `session.jsonl` corrupted | `readEventsUpToHWM` skips malformed lines (stderr warn). Sequence is line ordinal, not yield ordinal. |
| HWM corrupted | `getHWM` returns `null`. Replay falls back to log start (idempotent if events are; per-kind policy keeps the set small). |
| `restoreFromMarker` returns `null` | Adapter cannot resume. Crash recorded, replay skipped — never fail boot. |
| `.daemon-stop` corrupted | `readStopMarker` returns `null` with stderr warning. Treated as absent. |
| Cost event after parent shutdown | `applyCostEvent` silently drops missing ancestors (EC5). |
| Concurrent restart on same handle | `restartingPromises` map returns the same in-flight promise to both callers (EC1, M1). Handle id is STABLE across restart (CRITICAL #3). |
| Duplicate `agentId` across orgs | `registerAgent` throws `AgentIdAlreadyRegisteredError` at write-side (CRITICAL #1). Same-org re-registration permitted. |
| Cascade marker reason | Children inherit parent's exit reason (CRITICAL #2). Crash-cascaded children replayed on next boot; graceful-cascaded children skipped. |
| Adapter-version drift between boots | `persistAgentConfig` records `runtimeVersion`. `attemptCrashReplay` compares against current adapter version; logs `[agent-manager] adapter version drifted on replay for ${handleId}` warning and continues (IMPORTANT #7). |
| Adapter-version mismatch (Phase 3+) | Phase 1 has only `v1`. RuntimeAdapterShim translates later — gap documented, not handled now (EC4). |
| Heartbeat tick faster than sweep | Sample-and-skip — second tick during in-flight sweep is dropped (IMPORTANT #5). |
| Handle unregistered mid-sweep | Re-check `handles.has(handleId)` after `await probe()` skips spurious restarts (IMPORTANT #6). |
| Long steady-state operations (e.g., `git clone`) | Adapter registers a liveness probe via `AgentManager.registerLivenessProbe(runtimeId, probe)`. When the probe returns true, the stall trip is suppressed regardless of `lastStatusChangeMs` (IMPORTANT #5 / Q3). |
| IPC line exceeds buffer cap | `ipc-server` writes `{ ok: false, error: "parse-error: line-too-long" }` and destroys the socket. Default cap: 64 KiB; overridable via `IpcServer` constructor `maxLineBytes` (PR #44 Important #1). The cap is enforced as a UTF-8 byte bound on every extracted line and on the residual buffer — it cannot be bypassed by a newline arriving in the same data event or by multibyte input whose UTF-16 length is under the bound (Codex M). |
| IPC response fails to serialize | `ipc-server` emits a guaranteed-serializable `{ ok: false, error: "internal: response serialization failed" }` fallback line so the per-connection 1:1 request/response invariant holds (the newline-delimited protocol has no request IDs; dropping a response line would let a pipelined client misalign request N+1's response onto request N — Codex H). |
| IPC connection idle | `ipc-server` destroys the socket after `idleTimeoutMs` (default 5 min). Phase 6 dashboard long-poll endpoints may raise the bound per-instance via the constructor option (PR #44 Important #3). |
| IPC fleet-health upstream failure | `ipc-server` arms a 1s rejection cooldown. Calls during the cooldown short-circuit with `fleet-health: temporarily unavailable (retry in <Nms>)` without re-invoking the failing upstream (PR #44 Important #4). Cooldown does not persist across `stop()`/`start()`. |
| IPC previous-tail write rejection | `ipc-server.processLine` swallows the prior tail's rejection with `.catch` so request N's write error does not bubble as an unhandled rejection on request N+1. The swallow logs to stderr so a real regression remains observable (PR #44 Important #2). |

## State directory layout

Under `pathFor()` (resolved per `state-paths.ts`):

```
<state-root>/
  tasks/
    pending/    <agentId>__<taskId>.json
    claimed/    <agentId>__<taskId>.json + <agentId>__<taskId>.claim.json
    resolved/   <agentId>__<taskId>.json
  approvals/
    pending/    (Plan 06)
    resolved/   (Plan 06)
  agents/       <handleId>.json — persisted RegisterAgentConfig
  markers/      <handleId>.daemon-stop, <handleId>.hwm.json
  session-logs/ <handleId>.jsonl, <handleId>.seq
  telemetry/    <YYYY-MM-DD>.ndjson (Plan 05)
```

Resolution order for `<state-root>`:

1. `process.env.IAGO_DAEMON_STATE_ROOT`
2. `<cwd>/runtime/state` if `path.basename(cwd) === "iago-os"`
3. `<homedir>/.iago-os/daemon-state`

## Class-usage rationale

`AgentManager` and `HeartbeatController` are classes, not factory functions.
CLAUDE.md's "Functional components only" rule is React-component-scoped —
Node stateful daemon code uses classes where lifecycle methods, dependency
injection, and test reset surfaces are intrinsic. Each class carries an
inline JSDoc rationale block.
