# `runtime/` — iaGO-OS v2 Daemon

Polymorphic agent runtime for the v2 daemon. Hosts agents of any execution
shape (PTY subprocess, HTTP/SDK call, MCP stdio JSON-RPC, webhook/event,
long-running daemon) behind a single `AgentRuntime` interface. Phase 1 ships
Shape 1 (PTY) only via the `claude-pty` adapter; Shapes 2–5 land in Phases 3,
9, and 11 per the v2 vision spec.

## Directory layout

```
runtime/
├── agent-runtime/        # AgentRuntime interface + registry + per-shape adapter modules
│   ├── registry.ts       # Polymorphic interface + module-scope registry + boot-time validation
│   ├── types.ts          # Core types: AgentShape, AgentHandle, AgentMessage, SpawnOpts, ...
│   ├── pty/              # Shape 1 (PTY) adapters — Phase 1: claude-pty.ts. Phase 3: codex, gemini, opencode.
│   ├── http/             # Shape 2 (HTTP/SDK) adapters — Phase 3.
│   ├── mcp/              # Shape 3 (MCP-as-agent) adapters — Phase 3.
│   ├── event/            # Shape 4 (webhook/event) adapters — Phase 9.
│   └── daemon/           # Shape 5 (long-running daemon) adapters — Phase 11.
├── daemon/               # Phase 1: agent-manager, file-bus, IPC server, session-log, heartbeat, cron stub.
├── telegram/             # Phase 1: approval handshake + per-agent file-bus tagging + per-shape command gating.
├── migration/            # Per-phase audit + rollback docs (Phase 0/0.5 already shipped here).
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md             # (this file)
```

## How to run locally

Phase 1 is local-only on Santiago's Windows box. VPS install lands in Phase 2.

```bash
cd runtime
npm install
npm test            # Vitest unit + integration
npm run typecheck   # tsc --noEmit
npm run lint        # biome check .
```

The daemon entry point lands in Phase 1 Plan 07. Until then, only the
registry + types + adapter scaffold are runnable.

## Configuration

Per-agent config lives at `orgs/<client>/agents/<agent>/config.json`. Each
config declares a `runtime` field that maps to a registered adapter `id`:

```json
{
  "agentId": "claude-main",
  "runtime": "claude-pty",
  "org": "iago",
  "cwd": "/home/santi/work/iago-os"
}
```

The daemon resolves the runtime via `resolveRuntime(config.runtime)` and
spawns the agent through the adapter. If the runtime id is not registered,
the daemon refuses to start the agent (the registry throws `"No
AgentRuntime registered for id: <id>"`).

## Tech constraints

- **Runtime:** Node 20 + ESM (`"type": "module"`).
- **Language:** TypeScript strict; `noUncheckedIndexedAccess`; no `any`;
  named exports only.
- **No Docker.** systemd on the VPS directly (Phase 2). Phase 1 is local.
- **No Postgres.** SQLite for the cost ledger (Phase 8). JSON/JSONL for
  everything else.
- **No ORMs.** Direct file-bus + SQLite + JSON access.
- **State files are not committed.** `.gitignore` excludes `tasks/`,
  `approvals/`, `state/`, `telemetry/*.ndjson`, and `*.log`.

## Phase 1 scope

Phase 1 ships:

- `AgentRuntime` polymorphic interface (`interfaceVersion: "v1"`) +
  module-scope registry with boot-time validation.
- Shape 1 (PTY) only via `claude-pty` adapter. Shapes 2–5 are deferred.
- Daemon skeleton: agent-manager, file-bus (O_EXCL atomic-rename),
  IPC server, session.jsonl two-phase replay, heartbeat, subagent semantics.
- Telegram approval handshake with per-agent file-bus tagging.
- Hello-world end-to-end: register Claude PTY agent → claim task → Telegram
  approval → resume.

Shape 1 (PTY) is the canonical reference adapter — every other shape
implements the same `AgentRuntime` interface against its own substrate.

## References

- `docs/specs/iago-os-v2-vision.md` — Agent Shape Taxonomy + `AgentRuntime`
  interface + per-shape lifecycle semantics + Phase Sequencing.
- `docs/specs/iago-os-v2-master-prompt.md` — Mission brief + acceptance
  criteria + Garry-impressed checklist.
- `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` — ADR for the 5-shape
  taxonomy and interface contract.
- `runtime/CONTEXT.md` — Stage contract (L2) for the v2 daemon build.
- `runtime/agent-runtime/README.md` — Adapter authoring guide.
