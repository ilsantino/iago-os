# `agent-runtime/`

Polymorphic `AgentRuntime` interface + module-scope registry + per-shape
adapter implementations. Every agent the daemon hosts — regardless of how it
actually runs — speaks this contract.

## The 5 shapes

| Shape | Mechanics |
|---|---|
| **PTY (Shape 1)** | Pseudo-terminal subprocess. Adapter spawns a CLI process (Claude Code, Codex, etc.) attached to a PTY, parses prompt/status markers from stdout, forwards `prompt`/`abort` messages over stdin. |
| **HTTP/SDK (Shape 2)** | Provider SDK call from the host process. Adapter runs in-process, holds the SDK client, dispatches requests on demand. Auth via systemd `LoadCredential=` (no runtime secrets). |
| **MCP-as-agent (Shape 3)** | Stdio JSON-RPC goal-taking subprocess. Adapter spawns an MCP server that exposes goal-shaped tools; daemon drives goals over the JSON-RPC channel. Hermes is the canonical Phase 3 candidate. |
| **Webhook/event (Shape 4)** | Triggered by an inbound event (webhook, GitHub, Sentry, cron-tick), runs to completion, exits. Adapter exposes an event handler; daemon's webhook-receiver dispatches matching events. |
| **Daemon/long-running (Shape 5)** | Always-on host process with an internal scheduler (e.g., IMAP polling). Adapter holds a long-lived handle; daemon manages restart + health probes only. |

Per-shape lifecycle semantics are documented in
`docs/specs/iago-os-v2-vision.md` § Per-shape lifecycle semantics. Adapter
authors MUST follow them — especially the spawn/restore/shutdown rules per
shape.

## Implementing a new adapter

1. Pick the shape directory: `runtime/agent-runtime/<shape>/<id>.ts`
   (e.g., `pty/claude-pty.ts`, `http/anthropic-sdk.ts`, `mcp/hermes-mcp.ts`).
2. Implement the `AgentRuntime` interface from `registry.ts`. Declare
   `interfaceVersion: "v1"`. All required methods (`spawn`, `send`,
   `onStatusChanged`, `isAlive`, `shutdown`, `restoreFromMarker`) must be
   present; the registry validates at registration and throws otherwise.
3. Register at module load: call `registerRuntime(yourAdapter)` at the
   bottom of the adapter module. This is the boot-time side-effect that
   makes the adapter discoverable via `resolveRuntime(id)`.

### Adapter file layout

```
agent-runtime/
└── <shape>/
    ├── <id>.ts        # Adapter implementation + registerRuntime() side-effect
    ├── <id>.test.ts   # Vitest unit tests (≥80% line coverage per Phase 1 criterion #2)
    └── README.md      # Adapter-specific notes: dependencies, config, failure modes, ops runbook
```

## Boot sequence

The daemon entry point (Phase 1 Plan 07) loads all adapter modules at
startup. Each module side-effects `registerRuntime()` at import time. The
registry validates each registration:

- `interfaceVersion` is `"v1"` (else throws).
- `shape` is one of the 5 valid values.
- All required methods are present (`typeof rt.method === "function"` probe).
- `id` is not already registered.

**Fail-isolated policy.** The registry itself throws on invalid
registration; isolation is the importer's job. The daemon entry point wraps
each adapter import in `try/catch` so that a single broken adapter does NOT
crash the daemon — the daemon logs the failed adapter id, skips it, and
continues booting the remaining registered runtimes. After all imports, the
daemon calls `listRuntimes()` to log which adapters loaded successfully and
refuses to spawn agents whose configured `runtime` id is not in the list.

A regression test for this policy lives alongside the daemon entry point
(Plan 07): "adapter module that throws at registerRuntime is skipped;
daemon continues with the remaining runtimes."

## Interface versioning + migration

Every adapter declares `interfaceVersion: "v1"`. When a breaking change to
`AgentRuntime` lands (Phase 3+), the new interface bumps to `"v2"`. Adapters
do NOT migrate in place. Instead:

1. The registry continues to validate the declared version against the
   currently-supported set (`v1` only today).
2. A `RuntimeAdapterShim` wraps legacy `v1` adapters so they keep working
   under a `v2`-aware daemon.
3. Adapters update at their own cadence; the shim is the migration boundary.

This is decided constraint — do not relitigate. See
`.iago/decisions/2026-05-15-agent-shape-taxonomy.md` § Interface versioning
+ migration.

## `AgentMessage` kinds — author rules

The `AgentMessage` discriminated union has five `kind`s. Two rules bind
adapter authors:

- **`custom` kind is the escape hatch.** `AgentMessage.custom.payload` is
  typed `unknown`. Adapters that accept structured `custom` payloads MUST
  document the expected payload shape in JSDoc on the adapter's `send()`
  override. The adapter OWNS its payload schema documentation — the
  interface intentionally does not generalize.
- **`approval` kind is RESERVED in Phase 1.** The active approval path is
  file-bus polling via `approval-bus.ts` (Plan 06). `runtime.send(handle,
  { kind: "approval", ... })` is not invoked by any Phase 1 caller. The kind
  exists on the interface as a reserved future channel for push-based
  approval notification. Phase 1 adapter `send()` implementations should
  no-op the `approval` arm; Plan 04's `claude-pty` does this.

The `prompt` payload is intentionally narrow (`{ text: string }`). When
Shape 2 (HTTP/SDK) lands in Phase 3, a new kind will be added (e.g.,
`sdk-request`) rather than extending `prompt`.

## `costTap` cancellation policy

`costTap?` is an optional async-iterable hook for streaming cost events
from an adapter. Consumer policy: when the consumer stops iterating, the
adapter MUST stop producing cost events within 100ms or accept the memory
pressure of buffered events. Phase 1 has no `costTap` consumer; this is
flagged for the Phase 3 cost-ledger work.

## References

- `runtime/README.md` — Top-level runtime/ purpose and configuration.
- `docs/specs/iago-os-v2-vision.md` § Per-shape lifecycle semantics —
  binding semantics per shape.
- `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` — Source of truth
  for the taxonomy + interface contract.
