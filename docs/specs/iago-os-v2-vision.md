# Spec: iago-os v2 Vision — Agent OS

_Date: 2026-05-15 | Status: **CANONICAL** | Supersedes: `docs/specs/iago-os-vision.md` (2026-04-28, downgraded to research artifact) AND the 2026-05-13 lock | Locked by: Santiago, 2026-05-15_

**Amendment 2026-05-15:** Adds agent-shape taxonomy + `AgentRuntime` polymorphic interface (PTY adapter registry recontextualized as Shape 1 of 5). Deeper cortextOS adoption (full Next.js dashboard, session.jsonl replay, subagent semantics, heartbeat health). Deeper Hermes adoption (MCP rate-limiter full impl, shell-hook router generalized, compression threshold full impl). Effort total 27-32d → 38-46d. Trail: `.iago/decisions/2026-05-15-agent-shape-taxonomy.md`.

**Amendment 2026-05-29 (cortextOS video alignment — Santiago direction):** Refines the no-agent-to-agent-messaging anti-scope (§ What v2 is NOT) to PERMIT agents as file-bus producers (typed `agent-message`/`task-assignment` envelopes via the existing O_EXCL path) while keeping the broker/pub-sub/ACP ban intact — a SCOPE clarification, not an architecture reversal. Adds a `role:"chief"` supervisor capability (config flag, not a new shape). Keeps the one-bot lock; per-agent identity delivered via sticky default-target + optional forum-topics, not per-agent tokens. Effort delta ≈ +6-9d. Trail: `.iago/research/2026-05-29-cortextos-comms-gap-analysis.md`. (The 2026-05-29 ADR addendum to `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` and the standalone `.iago/decisions/2026-05-29-per-agent-identity-and-chief-tier.md` decision file were both PLANNED but never written; this 2026-05-29 stance was re-locked the next day — see the **Amendment 2026-05-30** below + ADR `.iago/decisions/2026-05-30-per-agent-bots-and-chief-tier.md`, the live decision of record.)

**Amendment 2026-05-30 (per-agent-bots — Santiago LOCKED, supersedes the 2026-05-29 one-bot stance):** The 2026-05-29 'keep one bot' decision is REVERSED on evidence. v2 ships **per-agent Telegram bots for standing agents + one chief/orchestrator bot for ephemeral workers & broadcast.** Rationale: the cortextOS reference impl uses per-agent bots (README 'Add Telegram credentials for each agent' → per-agent `BOT_TOKEN`; per-agent PM2 process); the one-bot HTTP-409 premise was wrong (409 is per-token, N tokens poll independently); per-agent bots are all private DMs so the private-chat security gate stays closed (forum-topics DROPPED). Cost: N one-time BotFather registrations + N tokens via the existing per-agent `LoadCredential=` model. Trail: `.iago/research/2026-05-29-cortextos-comms-gap-analysis.md` §10 + `.iago/decisions/2026-05-30-per-agent-bots-and-chief-tier.md`.

---

## Vision Statement

**iago-os v2 is a multi-agent operating system that hosts agents of any execution shape.** PTY-based CLI runtimes (Claude Code, Codex, Gemini, opencode), HTTP/SDK programs (Anthropic SDK, OpenAI SDK, LangGraph workflows), MCP-as-agent runtimes (Hermes-style goal-taking MCP servers), webhook/event-driven workers, and long-running daemons cohabit on a Hostinger VPS reached over a Tailscale mesh. All shapes are controlled from a phone via Telegram and observed through a web dashboard. The existing iago-os review pipeline (cross-model Codex, severity floors, secret-exclusion, skill routing) stays — it is the moat.

This **replaces OpenClaw** as the production agent runtime. Same VPS, same Tailscale mesh, new software.

This **overrides** the 2026-04-21 council "defer" verdict on iago-os-v2, the prior "Paperclip = DEFER" verdict, the prior "cortextOS = cherry-pick only" verdict, the prior "agentic-os-dashboard = patterns only" verdict, the 2026-04-28 "not a Hermes clone, not a Devin replacement" framing, and the 2026-05-13 "PTY-only adapter registry" framing. Closer-to-Hermes is now the target, and the daemon hosts **any agent shape**, not just PTY. Reasoning trail: `memory:feedback_iago_v2_overrides_council` + Santiago directions 2026-05-13 (multi-LLM) and 2026-05-15 (multi-shape) + supporting cortextOS adoption logic from `.iago/research/2026-05-13-multi-agent-cohabitation.md`.

---

## The 5 Layers

| # | Layer | What it is | Primary source pattern |
|---|---|---|---|
| 1 | **Runtime substrate** | Hostinger VPS + Tailscale mesh; systemd service host | OS-native (no Docker auth dance) |
| 2 | **Agent execution** | Daemon hosting `AgentRuntime` adapters across 5 shapes (PTY, HTTP/SDK, MCP-as-agent, Webhook/event, Daemon); file-bus coordination; crash markers + auto-restart; session.jsonl replay; heartbeat health checks; subagent spawn semantics | **cortextOS** `agent-pty.ts` + `codex-app-server-pty.ts` + `agent-manager.ts` + new `AgentRuntime` polymorphic interface (iaGO extension; PTY adapter registry is Shape 1 of 5) |
| 3 | **Control plane** | Telegram-primary phone control: start/stop/inject/approve/abort agents of any shape; file-based approval handshake (`pending/` → `resolved/`); cross-runtime event router (Hermes shell-hook matcher generalized) | **cortextOS** `fast-checker.ts` `appr_*` callbacks + **Hermes** generalized hook-router |
| 4 | **Dashboard** | Full Next.js web UI for live agent state across all shapes, token spend per agent/project/model/shape, intervention controls; same-host IPC, not REST. **Streamlit fallback dropped** per Garry-impressed standard — ship the real dashboard | **cortextOS** Next.js + `ipc-server.ts` (full port) |
| 5 | **Pipeline (preserved)** | Cross-model Codex review, severity floors, secret-exclusion staging, skill routing, stress test | **iago-os existing** — do not rewrite |

---

## Adopted Primitives (concrete, verbatim where possible)

Cited file paths are in the upstream repos; iaGO ports land under `runtime/` (new directory in this repo, to be created in Phase 1).

### From cortextOS — adopt verbatim

| Primitive | Upstream | Why we want it |
|---|---|---|
| **PTY adapter per runtime** | `src/pty/agent-pty.ts` (Claude Code), `src/pty/codex-app-server-pty.ts` (Codex), `hermes-pty.ts` (experimental) | Solves multi-runtime cohabitation with zero broker / zero container orchestration. iaGO extends cortextOS by formalizing it as **Shape 1 of the `AgentRuntime` registry** (see § Agent Shape Taxonomy) so Claude Code + Codex + Gemini + opencode all live in the same daemon (Santiago decision 2026-05-13: "flexibility to change LLMs at will"). Adding a fifth PTY runtime is a config + adapter file. |
| **O_EXCL file-lock task claiming** | `src/bus/task.ts` `claimTask()` (`wx` flag → `EEXIST` on collision) | ~10 lines of TS that prevent any double-work race in parallel agent runs. No DB. Replaces our currently-unprotected wave dispatch in `execute-pipeline.sh`. **iaGO extension:** resolved-output writes use temp-file-plus-atomic-rename (`tasks/resolved/.<id>.tmp` → rename to `tasks/resolved/<id>`) with the writer's claim owner-ID and attempt-ID embedded in the result. The daemon REJECTS resolved writes whose owner-ID doesn't match the current claim holder (prevents zombie writes from stale or replayed adapters from contaminating fresh claims). |
| **File-based approval handshake** | `src/daemon/fast-checker.ts` (`appr_(allow\|deny)_<id>` callbacks → file moves `pending/` → `resolved/`) | The right HITL primitive for Telegram. Simpler than webhook round-trip; survives network hiccups. |
| **`.daemon-stop` crash markers** | `src/daemon/agent-manager.ts` | Distinguishes graceful shutdown from crash on next boot. Decides restore-vs-cold-start. No DB. |
| **Multi-org agent resolution cascade** | `agent-manager.ts` `resolveAgentOrg()` (BUG-043 fix) | Lets one daemon host agents from multiple client orgs without collision. Maps to iaGO's `clients/*/` separation. |
| **`crons.json` per-agent schedule + `cron-scheduler.ts` daemon-managed wakeups** | `src/daemon/cron-scheduler.ts` | Replaces manual `claude -p` invocations. Hermes also has this; cortextOS's is the cleaner reference. |
| **Same-host IPC server (Unix socket / named pipe)** | `src/daemon/ipc-server.ts` (`fleet-health`, 30s cache) | Dashboard and CLI both talk to the daemon over this. No REST API surface to secure. |
| **`session.jsonl` append-only event log + replay** *(deeper adoption, added 2026-05-15)* | `src/daemon/session-log.ts` + `replayFromMarker()` in agent-manager | Crash recovery without DB. After daemon restart, replay last N events per handle to restore conversation/work state. Directly relevant to yesterday's Windows crash (2026-05-14) — without this, sessions are lost on hard reboot. Required by every shape, not just PTY. **Two-phase replay:** (1) read events up to a recorded byte-offset / event-sequence high-water mark while live event intake is PAUSED; (2) after all pre-crash events are replayed, live intake resumes. Prevents new appends from interleaving with restored events and producing duplicated or reordered state. |
| **Subagent spawn semantics** *(deeper adoption, added 2026-05-15)* | `agent-manager.ts` `spawnSubagent()` + parent-child handle linkage + cost rollup | Currently the spec adopts only the agent-manager skeleton. The subagent layer (parent-child tracking, inheritance of cwd/env/cost-budget, automatic shutdown when parent exits) is what makes the daemon truly multi-agent rather than single-agent-with-aliases. Pipeline review-fix loops, MWP stage handoffs, and the Hermes runtime's delegation all need this. |
| **Heartbeat health checks + stall detection** *(deeper adoption, added 2026-05-15)* | `agent-manager.ts` `heartbeat()` (60s) + `restartIfStalled()` | Detect adapters that hang (no status change in N minutes) and force-restart. Without this, a stalled PTY or wedged HTTP request consumes a slot indefinitely. Replaces our current "Santiago notices in the dashboard" failure mode. |
| **Full Next.js dashboard** *(promoted from fallback to canonical, 2026-05-15)* | `apps/dashboard/` (cortextOS Next.js port) | Drop the Streamlit minimal fallback. Garry-impressed standard: ship the real one in Phase 6. Dashboard spans all 5 agent shapes with per-shape filters, cost-per-shape breakdown, and intervention controls. |

### From Hermes v0.11.0 — adopt selectively + deeper (2026-05-15)

| Primitive | Upstream | Why |
|---|---|---|
| **Pre-LLM cron wake gate** | `cron/jobs.py` `wakeAgent` | Strictly cheaper than our current post-LLM `[SILENT]` token. Adopt as Wedge C addendum: `--wake-check <script>` flag. |
| **Shell-hook matchers + regex + timeout** | `cli-config.yaml` `hooks.<event>[].matcher` | Wedge J. Scoped pre/post-edit hooks ("before any Edit to `amplify/data/`, run schema-validate"). |
| **MCP sampling caps** | `cli-config.yaml.example` `mcp_servers.<n>.sampling.*` | Documented ops constraint on our 5 MCP servers. Native enforcement pending Anthropic. |
| **Compression-threshold safety valve** | `compression.{enabled,threshold:0.50,target_ratio:0.20,protect_last_n:20}` | Fold into Wedge B distiller. |
| **`max_concurrent_children` parallel limit** | `delegation.max_concurrent_children` (default 3) | Document our existing wave-grouping explicitly in pipeline config. |
| **MCP sampling rate-limiter full impl** *(deeper adoption, added 2026-05-15)* | `mcp_server/rate_limiter.py` (token-bucket per server) | Currently we adopt only the *concept* of sampling caps. The full token-bucket implementation (per-MCP-server budget, refill rate, hard-pause when exhausted) is what makes the cap operational. Required as we add Sentry, Google Workspace, and additional MCP servers — without it, a runaway agent burns through a server's quota in minutes. |
| **Shell-hook matcher generalized to cross-runtime event router** *(deeper adoption, added 2026-05-15)* | `cli-config.yaml` `hooks.<event>[]` extended | Hermes uses hook-matchers for one runtime. iaGO generalizes the same matcher syntax to route arbitrary daemon events (PTY exit, HTTP error, webhook arrival, MCP sampling event, cron tick) to handler scripts/agents. One rule language for all 5 shapes. Lands as the daemon's Layer 3 control-plane router. |
| **Compression threshold full impl** *(deeper adoption, added 2026-05-15)* | `compression/compress.py` (sliding-window summarizer, threshold trigger, `protect_last_n` guard, target-ratio enforcement) | Spec currently mentions the concept; ship the full sliding-window summarizer with Hermes's exact semantics. Required for long-running PTY shape (Phase 1) AND Daemon shape (Phase 11). |

### From Paperclip — adopt the pattern, not the stack

| Primitive | Upstream | Why |
|---|---|---|
| **Per-agent cost ledger + hard pause at budget** | Paperclip server, Postgres-backed | Activate when ANY client moves Claude Max flat-rate → API billing. Implement with SQLite, not Postgres. Skip ancestry tracking (over-engineered at our scale). |
| **DB-backed session state (resume mid-task)** | Paperclip Postgres | Adopt the pattern, implement with SQLite per cortextOS/Hermes precedent. |
| **Heartbeat-driven agent wakeup** | Paperclip heartbeat scheduler | Already covered by cortextOS `cron-scheduler.ts` — use cortextOS's impl, not Paperclip's. |

### Explicitly NOT adopted

- **Paperclip org chart / reporting lines** — three people don't need agent CEO/CTO titles. Adds confusion for clients.
- **Paperclip multi-tenant isolation (for internal use)** — `clients/*/` directory separation already does this. Multi-tenancy stays available as a client-deliverable product angle, not internal infra.
- **Paperclip Docker exec auth dance** — every container restart re-auths. systemd on the VPS directly.
- **Hermes 17-platform gateway** — Telegram only; Discord/Slack only on real demand.
- **Hermes single-agent assumption** — Hermes itself is one agent with delegation. We need cortextOS's multi-agent daemon over Hermes-style instances, not Hermes alone.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Santiago's phone                                                │
│  └─ Telegram app                                                 │
└────────────────┬────────────────────────────────────────────────┘
                 │  (over public internet → Tailscale entry)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Hostinger VPS (Tailscale node)                                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  iago-os v2 daemon  (systemd service, Node.js 20)         │   │
│  │                                                            │   │
│  │  ┌─────────────────────────────────────────────────────┐  │   │
│  │  │  AgentRuntime registry (5 shapes)                   │  │   │
│  │  │   ├─ Shape 1 (PTY): claude/codex/gemini/opencode   │  │   │
│  │  │   ├─ Shape 2 (HTTP/SDK): anthropic-sdk/openai-sdk  │  │   │
│  │  │   ├─ Shape 3 (MCP-as-agent): hermes-mcp            │  │   │
│  │  │   ├─ Shape 4 (Webhook/event): sentry/github/cron   │  │   │
│  │  │   └─ Shape 5 (Daemon): imap-daemon                 │  │   │
│  │  └──────┬──────────────────────────────────────────────┘  │   │
│  │         │                                                  │   │
│  │  ┌──────▼────────────────────────────────────────────┐    │   │
│  │  │  Agent manager (registration, crash/restart,       │    │   │
│  │  │  multi-org cascade, .daemon-stop markers,          │    │   │
│  │  │  session.jsonl two-phase replay, subagent spawn,   │    │   │
│  │  │  heartbeat health + RSS recycling)                 │    │   │
│  │  └──────┬─────────────────────────────────────────────┘    │   │
│  │         │                                                  │   │
│  │  ┌──────▼─────┐  ┌──────────┐  ┌───────────┐  ┌────────┐│   │
│  │  │  File bus  │  │ Telegram │  │   Cron    │  │  IPC   ││   │
│  │  │ (O_EXCL    │  │  router  │  │ scheduler │  │ server ││   │
│  │  │  + atomic  │  │ (one bot,│  │ (pre-LLM  │  │ (Unix  ││   │
│  │  │  rename)   │  │ per-agent│  │  wake     │  │ socket)││   │
│  │  │            │  │ tagging) │  │  gates)   │  │        ││   │
│  │  └──────┬─────┘  └────┬─────┘  └─────┬─────┘  └────┬───┘│   │
│  │         │             │              │              │     │   │
│  │  ┌──────▼─────────────▼──────────────▼──────────────▼─┐  │   │
│  │  │  Cross-shape event router (generalized Hermes hook) │  │   │
│  │  │   + MCP rate-limiter (token-bucket per server)      │  │   │
│  │  │   + Webhook receiver (Sentry/GitHub/Stripe HMAC)    │  │   │
│  │  └──────┬──────────────────────────────────────────────┘  │   │
│  └─────────┼──────────────────────────────────────────────────┘   │
│            │                                                       │
│  ┌─────────▼────────────────────────────────────────────────┐   │
│  │  Filesystem state: tasks/{pending,claimed,resolved}/,      │   │
│  │  approvals/{pending,resolved}/, events/dead-letter/,       │   │
│  │  orgs/<client>/agents/, crons.json,                        │   │
│  │  ledger.sqlite (cost + event_dedupe + replay_dedupe)      │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Dashboard (Next.js, same-host, IPC to daemon)            │   │
│  │  - Live agent state across all 5 shapes (per-shape filter)│   │
│  │  - Token spend per agent / project / model / shape        │   │
│  │  - Session threads + intervention controls                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

> **5-shape view.** Diagram now reflects the post-2026-05-15 amendment with the full `AgentRuntime` registry. Phase 1 ships Shape 1 (PTY/Claude) only; Phase 3 adds Shape 2 + Shape 3 adapters; Phase 9 lands Shape 4; Phase 11 lands Shape 5. See § Agent Shape Taxonomy + `AgentRuntime` Interface immediately below for per-shape lifecycle semantics and the polymorphic interface contract.

---

## Agent Shape Taxonomy + `AgentRuntime` Interface

**The hard part Santiago named on 2026-05-15:** v2 must host agents of any execution shape — not just PTY-based CLI runtimes. Neither cortextOS (PTY-only) nor Hermes (MCP-only) ships this abstraction. It is the load-bearing iaGO extension that makes v2 a true multi-agent OS rather than a Claude/Codex cohabitation runtime.

### Five shapes

| Shape | Mechanics | Examples | Adapter location |
|---|---|---|---|
| **1. PTY** | Subprocess with a pseudo-terminal; bidirectional text stream; lifecycle is exit-code based | Claude Code, Codex App Server, Gemini CLI, opencode | `runtime/agent-runtime/pty/` |
| **2. HTTP / SDK** | Host process invokes provider SDK directly (no terminal); request/response or streaming response | Anthropic SDK programs, OpenAI SDK programs, LangGraph workflows (run as host-process scripts) | `runtime/agent-runtime/http/` |
| **3. MCP-as-agent** | stdio JSON-RPC subprocess where the server takes a goal and emits tool calls (a goal-taking MCP server is an agent shape, distinct from a tool-source MCP server) | Hermes runtime itself (Phase 3), future goal-taking MCP servers | `runtime/agent-runtime/mcp/` |
| **4. Webhook / event** | Triggered by an inbound event (Sentry alert, GitHub PR webhook, Stripe charge, cron tick); claims a task; runs to completion in a host process | Sentry-triage agent, content-publishing agent on cron, GitHub-PR-handler agent | `runtime/agent-runtime/event/` |
| **5. Daemon / long-running** | Always-on host process with internal scheduler; no spawn/exit lifecycle; observed via health checks; receives commands via the IPC server | Email auto-provision IMAP poller (Phase 11), Sentria incident-triage daemon, future inventory-watching agents | `runtime/agent-runtime/daemon/` |

### `AgentRuntime` interface (polymorphic, all shapes implement)

```ts
type AgentShape = "pty" | "http" | "mcp" | "event" | "daemon";

type AgentMessage =
  | { kind: "prompt"; payload: { text: string } }
  | { kind: "approval"; payload: { approvalId: string; decision: "allow" | "deny" } }
  | { kind: "abort"; payload: { reason?: string } }
  | { kind: "inject"; payload: { text: string } }
  | { kind: "custom"; payload: unknown };

interface AgentRuntime {
  readonly shape: AgentShape;
  readonly id: string;            // e.g., "claude-pty", "anthropic-sdk", "hermes-mcp", "sentry-event", "imap-daemon"
  readonly version: string;
  readonly interfaceVersion: "v1";

  spawn(opts: SpawnOpts): Promise<AgentHandle>;
  send(handle: AgentHandle, message: AgentMessage): Promise<void>;
  onStatusChanged(handle: AgentHandle, cb: StatusCallback): () => void;  // returns unsubscribe — callers MUST call to prevent listener accumulation
  isAlive(handle: AgentHandle): Promise<boolean>;
  shutdown(handle: AgentHandle, signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
  restoreFromMarker(markerPath: string): Promise<AgentHandle | null>;
  costTap?(handle: AgentHandle): AsyncIterable<CostEvent>;  // optional, for ledger integration
}

interface SpawnOpts {
  cwd: string;
  env: Record<string, string>;
  agentId: string;
  sessionId: string;
  org?: string;        // for multi-org cascade
  parentHandle?: AgentHandle;  // for subagent spawn semantics (cortextOS deeper-adoption)
}
```

`AgentMessage` is a discriminated union — `kind` narrows the `payload` type at the type-checker level (Santiago decision 2026-05-15 PM, post-Plan-01-stress, replacing the prior `payload: unknown` shape). `custom` retains `unknown` as the explicit escape hatch.

Common lifecycle (spawn → status → restore → shutdown) is enforced for every shape. Per-shape mechanics live in the adapter implementation. Adding a runtime is "implement `AgentRuntime` for the right shape, register in `runtime/agent-runtime/registry.ts`."

### Per-shape lifecycle semantics (specialization of the common interface)

The common interface enforces a uniform lifecycle, but each shape specializes the underlying semantics. Adapter docs must follow these rules; the agent-manager assumes them.

- **Shape 1 (PTY) — text-stream lifecycle.** `spawn()` allocates a pseudo-terminal subprocess; `isAlive()` polls process state; `restoreFromMarker()` re-launches and replays from `session.jsonl` up to the recorded high-water mark before resuming live intake. **Version pinning required:** PTY adapters depend on each runtime's prompt-format (the on-screen string the daemon parses to derive `status`) — a Claude Code minor version that changes its prompt breaks status detection silently. Each PTY adapter pins a runtime version range, ships conformance tests with golden prompt/status transcripts captured from a known-good run, and **fails closed** on unknown parse rather than guessing (treats `status = "unknown"` as crash, triggers restart). See § Adopted Primitives → "session.jsonl append-only event log + replay" for the two-phase replay contract Shape 1 inherits.
- **Shape 2 (HTTP/SDK) — session lifecycle.** `spawn()` returns a session handle that may issue N HTTP/SDK requests over its lifetime; no actual HTTP call yet. `send()` issues one logical request and owns its retry policy at the adapter level. `isAlive()` reflects whether the session holds valid credentials + an allocated slot, not whether a request is in flight. `restoreFromMarker()` re-creates the handle from the persisted slot record but does NOT replay in-flight requests — a mid-flight HTTP request on crash is treated as failed, the file-bus task moves back to `pending/`, and crash-recovery does not double-bill the provider. Adapter MUST attach an idempotency key per `send()` (derived from `sessionId + agentId + send-sequence-number`) where the provider supports it (Anthropic ✓, OpenAI partial, Stripe ✓, GitHub ✓, SES requires SES Message-ID-based dedupe). **Generation tokens** on each `AgentHandle` (monotonic counter, incremented on every restart) defend against heartbeat-restart races: send() attempts include the generation token, and responses whose token doesn't match the handle's current generation are DISCARDED to prevent double-commit when a heartbeat-driven restart fires mid-request. Cancellation via `AbortController` is best-effort; stale-completion discard is mandatory. `shutdown()` releases the slot, closes keep-alive connections, persists a final cost-tap record.
- **Shape 3 (MCP-as-agent) — stdio JSON-RPC lifecycle with per-request deadlines.** `spawn()` starts the stdio JSON-RPC subprocess (e.g., `hermes-mcp`) and returns a handle holding both pipes. `send()` issues a JSON-RPC call with an adapter-enforced deadline (default 5 minutes per call, per-adapter override). The adapter MUST implement JSON-RPC cancellation (`$/cancel` notification or equivalent) when the daemon calls `shutdown()` mid-request. **Restart fencing:** if a request exceeds its deadline AND cancellation does not return within 30s, the adapter kills the subprocess and `restoreFromMarker()` spawns a fresh one — preventing a hung request from holding a slot indefinitely. `isAlive()` returns false on hung-request detection so the heartbeat loop force-restarts before manual intervention is needed.
- **Shape 4 (Webhook/event) — persistent-handler-plus-ephemeral-worker lifecycle.** See § Shape 4 detail in `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` for the full contract. Key points: `spawn()` is idempotent (registers persistent handler at daemon boot, not per event); `isAlive()` returns true while the handler is registered (not while a worker runs); events arrive via `send({ kind: "custom", payload })`; the adapter claims a file-bus task and dispatches an ephemeral child worker per event. **Burst handling:** inbound events route through a bounded queue (default 1000 events, configurable per source) with per-source concurrency limits (default 5 concurrent ephemeral workers per webhook source) so a Sentry burst cannot starve GitHub. Each event carries a durable ID (Sentry event ID, GitHub delivery ID, Stripe event ID); the daemon's `event_dedupe` SQLite table prevents double-processing on replay or duplicate delivery. Overflow events route to a dead-letter queue at `events/dead-letter/<source>/` with the original payload + dedupe key for manual replay.
- **Shape 5 (Daemon/long-running) — agent-manager-managed child process lifecycle.** `spawn()` starts the daemon child process (via Node `child_process.spawn` or equivalent) and returns a handle representing the process + its command socket. The agent-manager owns the process — systemd manages only the `iago-os-v2-daemon.service` parent, not child daemons. `isAlive()` returns true if the child process is running AND its heartbeat has fired within the configured window (default 60s); RSS / heap thresholds checked here (default 512 MB RSS — exceeding triggers a recycle). `restoreFromMarker()` re-spawns from persisted config (cwd, env, credentials reference) but does NOT replay in-flight work — the adapter recovers its own state from its own persistent storage (e.g., IMAP cursor position). `shutdown()` sends SIGTERM, waits 30s, then SIGKILL; adapters MUST flush in-flight work on SIGTERM (persist cursor state, exit cleanly). **Recycling policy:** periodic recycle check (default 24h, per-adapter override) avoids long-tail memory growth without requiring leak-free adapter implementations. **Task-bus participation:** daemon-shape agents typically don't claim from `tasks/pending/`; they generate work from their internal trigger and write results to `tasks/resolved/`. Adapter docs MUST state whether the daemon participates in claiming.

### Registry mechanism

`runtime/agent-runtime/registry.ts` exports `registerRuntime(rt: AgentRuntime)`. Agent config files reference runtime by `runtime` field (e.g., `runtime: "claude-pty"`, `runtime: "anthropic-sdk"`, `runtime: "sentria-daemon"`). The daemon's agent-manager:

1. Loads all adapters at boot
2. Validates interface compliance (TypeScript structural typing + runtime probe)
3. Routes `spawn()` calls to the registered runtime by `id`
4. Subscribes to status changes for all live handles
5. Persists handles to `.daemon-stop` markers (per shape) for crash recovery
6. Replays from `session.jsonl` per handle on restart (cortextOS deeper-adoption)
7. Runs heartbeat health checks every 60s; force-restarts stalled handles (cortextOS deeper-adoption)

The registry is shape-agnostic. The agent-manager doesn't know if it's spawning a PTY or sending an HTTP request — that's the adapter's job. Shape diversity costs nothing at the agent-manager layer.

### Interface versioning + migration

`AgentRuntime` itself is versioned. Each adapter declares an `interfaceVersion: "v1"` literal field alongside `shape`, `id`, and adapter `version`. The registry validates `interfaceVersion` at boot. When the contract evolves (Phase 3+ may need new `send()` signatures or extra optional methods), the registry supports concurrent v1 + v2 adapters via a `RuntimeAdapterShim` that wraps a v1 adapter to satisfy the v2 contract (or vice versa) for one sprint of deprecation, after which v1 support is removed. Prevents the "one interface change breaks every adapter in lockstep" risk identified by cross-model adversarial review 2026-05-15. ADR detail at `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` § Interface versioning + migration.

### Shape 4 adapter semantics (Webhook/event)

Shape 4 requires explicit clarification because its lifecycle diverges from PTY/HTTP/MCP patterns:

**`spawn()` is idempotent — registers a persistent handler, not a per-event process.** The daemon calls `spawn()` once at boot for each registered event-shape adapter (e.g., `sentry-event`). `spawn()` registers the inbound webhook receiver and returns a persistent `AgentHandle`. The adapter stays resident; it does not start and stop per event.

**`isAlive()` returns `true` while the handler is registered.** Because the handle is persistent, `isAlive()` reflects whether the receiver is up and listening — not whether an agent is actively processing an event. The heartbeat loop can safely call `isAlive()` without triggering false-restart: a dormant-but-registered `sentry-event` handler returns `true`, not `false`.

**Event payloads arrive via `send()`.** When an inbound webhook fires, the daemon delivers the event to the handler via `send(handle, { kind: "custom", payload: eventData })`. The adapter claims a file-bus task and dispatches an ephemeral worker for that single event. From the daemon's perspective, the handle never goes away — only the per-event worker is ephemeral.

**Consequence:** `SpawnOpts` needs no event-payload slot. The two-step spawn-then-send pattern is the intended contract for Shape 4. Implementers must NOT model Shape 4 as "one `spawn()` call per event" — that interpretation would cause the daemon to accumulate orphaned handles.

### Per-shape adapter scope (Phase mapping)

| Phase | Shape work | Shipped adapters |
|---|---|---|
| **1** | `AgentRuntime` interface + registry skeleton + Shape 1 (PTY) | `claude-pty` |
| **3** | Shape 1 (PTY) deeper: `codex-pty` + `gemini-pty` + `opencode-pty`; Shape 2 (HTTP/SDK): `anthropic-sdk` + `openai-sdk` (also enables LangGraph host scripts); Shape 3 (MCP-as-agent): `hermes-mcp` adapter | `claude-pty`, `codex-pty`, `gemini-pty`, `opencode-pty`, `anthropic-sdk`, `openai-sdk`, `hermes-mcp` |
| **9** | Shape 4 (Webhook/event): daemon-managed inbound webhook receiver dispatches events to event-shape adapters | + `sentry-event`, `github-event`, `cron-tick-event` |
| **11** | Shape 5 (Daemon): email auto-provision IMAP poller lands as first Daemon-shape agent | + `imap-daemon` |

### What this is NOT

- **Not a message-passing protocol.** Agents communicate via the file-bus (`tasks/{pending,claimed,resolved}/`). The `AgentRuntime.send()` method delivers a message **into** an agent's input channel (PTY stdin, HTTP request body, MCP JSON-RPC frame, event payload, daemon command socket). Agent-to-agent coordination is file-bus only.
- **Not a LangGraph reimplementation.** LangGraph workflows run as HTTP-shape agents — a Node/Python host process that imports LangGraph, runs the graph, returns the final state. The graph framework is upstream; v2 hosts it.
- **Not an ACP-protocol reimplementation.** ACPX (OpenClaw's agent communication protocol) dies at cutover. v2 has no equivalent inter-agent protocol — file-bus is the protocol.
  - *Amendment 2026-05-29:* 'file-bus is the protocol' now explicitly covers the typed `agent-message`/`task-assignment` envelope (see § What v2 is NOT, no-message-passing bullet, 2026-05-29 refinement). Still no broker, socket bus, or ACP wire format.
- **Not a runtime polymorphism for the pipeline.** The pipeline's `execute-pipeline.sh` is dispatched via plain `child_process.spawn` from the daemon, not via `AgentRuntime`. The pipeline is a script-runner with internal stage isolation, not an agent.
- **Not a "shape is determined at runtime" abstraction.** Each agent picks a shape at config time and stays in it. No shape morphing. Shape selection is a deliberate design choice per agent.
- **Not a blind replay system for external side effects.** `session.jsonl` replay reconstructs conversational state safely for Shape 1 (PTY); for Shapes 4 (Webhook/event) and 5 (Daemon) that perform external mutations, the adapter MUST attach an idempotency key per side-effect-causing operation (Stripe charge, GitHub PR creation, email send, etc.) and the daemon maintains a dedupe table in `ledger.sqlite` (`replay_dedupe(idempotency_key, completed_at)`). Replay skips operations whose key is already in the dedupe table. This is mandatory before Shape 4 ships in Phase 9.

### Supervisor (chief) role + inter-agent comms channel (Amendment 2026-05-29)

A **chief / supervisor agent is a ROLE, not a sixth shape.** Any agent (typically Shape 1 `claude-pty`/`codex-pty` or Shape 2 `anthropic-sdk`) may carry `role: "chief"` in its config. The only added privilege is the **producer-capability**: a chief may write peer-addressed task/message envelopes into `tasks/pending/`; regular agents (`role:"worker"`, the default) are denied this and remain pure consumers. This realizes the master-prompt Mission #5 line ('the supervisor agent dispatches; specialists claim and execute') and reuses the already-built `spawnSubagent` parent-child linkage + cost-rollup (`agent-manager.ts`). It is NOT an org-chart with titles (Paperclip pattern stays rejected, see § What v2 is NOT) — it is a mechanical dispatch permission. Dispatch is top-down and daemon-gated; symmetric peer-to-peer messaging stays out of scope.

**Comms channel (file-bus-native).** The canonical typed envelope is `{v, kind: "agent-message" | "task-assignment", from, to, body, threadId, seq, needsApproval, quality_signal, createdAt}` (single source of truth: ADR `.iago/decisions/2026-05-30-per-agent-bots-and-chief-tier.md` + `.iago/plans/feature-v2-agent-comms-channel/CONTEXT.md` — do not change the field set without an ADR). `from` is server-stamped by the daemon (anti-spoof); `seq` is the monotonic per-thread ordering/replay-dedupe key (the file-bus has no native ordering primitive); `quality_signal` carries the signed-chief-as-blocker authority. It rides the existing file-bus (`tasks/pending/` for assignments; same O_EXCL claim + atomic rename). Every create/claim/resolve appends one line to `comms/<date>.ndjson` (telemetry.ts pattern). Status is the directory (pending=To-Do, claimed=In-Progress, resolved=Done) — never a field. No new transport, no DB.

---

## Wedge Reinterpretation (existing roadmap under new frame)

| Wedge | Original purpose | New purpose | Status change |
|---|---|---|---|
| **A** Frozen-snapshot MEMORY | Pipeline context discipline | Same — kept | ✅ shipped, no change |
| **B** Distiller (+ compression safety valve) | Pipeline context compression between stages | Same + becomes load-bearing for long-running daemon sessions | Phase 5, gated on Phase 3+4 |
| **C** `/routines` bind audit | Cron + `[SILENT]` token | **CLOSED** — `/routines` BIND-NOT-VIABLE (PR #37). Replaced by **cortextOS `cron-scheduler.ts` + Hermes pre-LLM wake gate** as v2 cron substrate | Adopted via cortextOS daemon, not via `/routines` |
| **D** Memory provider doc | MCP sampling caps doc | Same — kept as doc-only | ✅ ship doc, no daemon change — standalone `/iago-fast` task, before or in parallel with Phase 1 |
| **F** Telegram gateway | Week-6 stretch, "Telegram only" scoped narrow | **PROMOTED to load-bearing control plane.** First v2 deliverable after daemon foundation. cortextOS `fast-checker.ts` approval handshake is the reference impl | Wave 1, top priority |
| **G** Skill body progressive disclosure | Deferred (yellow feasibility) | Same — defer | No change |
| **H** Webhook + HMAC | Stripe-events for installflow | **PROMOTED to load-bearing VPS event trigger surface.** GitHub events + Stripe events + arbitrary HMAC webhooks → daemon → agent wakeup | Wave 2, ahead of original schedule |
| **J** Shell-hook matchers | Regex-scoped lifecycle hooks | Same — Wave 1 next move | 🟢 NEXT |
| **K** Pre-stage pipeline checkpoints | Rollback safety in pipeline | Same — kept (still load-bearing for daemon crash recovery) | Wave 2 |
| **L** Externalize review-checks | Per-client review-rule overrides | Same — kept | Wave 2 |
| **M, N** Plan dashboard / trajectory ingestion | Deferred | **Folded into Dashboard layer (#4)** — no separate wedges needed. Dashboard ships agent state + cost; trajectory ingestion lands as a dashboard query | Promoted into Layer 4 |
| **E, I** | Dropped (vision-confirmed) | Still dropped | No change |

**Removed from scope:** `--n8n` dispatch flag (was already dead per May-12 review). However, n8n may return as a VPS automation primitive — leave that question to Phase 3.

---

## OpenClaw → VPS Migration Sequence

**Naming note:** These migration stages use letters (A–E) to avoid collision with the roadmap `Phase 0–12` numbering further down. The roadmap phases describe the v2 build calendar; the cutover stages below describe the OpenClaw→v2 transition within that calendar. Stage A maps to roadmap Phase 0; Stage E maps to roadmap Phase 7+.

**Stage A — VPS audit (read-only, no destructive ops).** Maps to roadmap Phase 0.

1. SSH into Hostinger VPS via Tailscale.
2. Inventory: what is OpenClaw running right now? What workflows touch it? What state lives in `~/openclaw/` or equivalent?
3. Confirm Tailscale mesh health, Node.js version, systemd availability.
4. Write `runtime/migration/00-vps-audit.md` with the inventory.

**Stage B — Daemon skeleton land (local first).** Maps to roadmap Phase 1.

1. Create `runtime/` directory in iago-os.
2. Port cortextOS minimal daemon: agent-manager + file-bus + one PTY adapter (Claude Code first).
3. Local-only — runs on Santiago's Windows box for development, not on VPS yet.
4. systemd unit file authored but not deployed.
5. Hello-world: register one Claude Code agent, claim a task, send Telegram message via test bot, receive `appr_allow` callback, agent proceeds. End-to-end on localhost.

**Stage C — VPS install alongside OpenClaw.** Maps to roadmap Phase 2.

1. Deploy daemon to VPS as `iago-os-v2-daemon.service`. Run in parallel with OpenClaw, different ports / state dirs.
2. Validate on one non-critical workflow.
3. Migrate Telegram bot token from OpenClaw to v2 daemon (or use a separate bot during cutover).

**Stage D — Cutover.** Maps to roadmap Phase 7 (gated on Phase 6 dashboard stable).

1. Migrate remaining workflows from OpenClaw to v2 daemon.
2. Stop OpenClaw systemd unit.
3. Archive OpenClaw state (do not delete yet — keep 30 days).
4. Update DNS / Telegram bot bindings.

**Stage E — Cleanup.** Trailing 30 days after Stage D.

1. Uninstall OpenClaw from VPS.
2. Delete archived state.
3. Document removal in `runtime/migration/E-openclaw-removed.md`.

**Open question (need Santiago input):** does OpenClaw run anything you actively depend on right now that would break if it stops? If yes, list it before Stage C cutover. If no, Stage C + D can collapse into one stage.

---

## Pipeline Preservation (do not touch)

The existing iaGO pipeline is the moat. Per the 2026-05-12 adversarial review's evidence, it works end-to-end (6 telemetry-recorded runs, 39.5 min wall-clock on the latest). The v2 daemon **invokes** the pipeline as a stage type, it does not replace the pipeline.

What stays unchanged:

- `scripts/execute-pipeline.sh` (self-freeze, byte-offset hack, telemetry)
- Codex cross-model adversarial review (`codex-companion.mjs`)
- Review check modules (`scripts/review-checks/*.md`)
- Skill routing (`/iago-fast`, `/iago-quick`, `/iago-execute`)
- Severity floors, secret-exclusion staging patterns
- 5-layer memory architecture (MEMORY.md, Obsidian, Graphify, MemPalace, MarkItDown) + SQLite session state as 6th layer (formalized 2026-05-20 — per-agent resume + cost ledger + event-dedupe; already planned in this doc §§ 132, 472, now named explicitly as a memory layer; see `.iago/decisions/2026-05-20-posthog-sentry-split-and-memory.md`)

What changes:

- Pipeline is dispatched **by** the daemon (cron / Telegram / webhook trigger), not manually invoked from Santiago's terminal.
- Pipeline telemetry NDJSON gets streamed to the dashboard via the IPC server.
- `CLAUDE_CODE_SESSION_ID` injection (May-12 punch list) becomes the join key between Agent View and the dashboard.

### Shape 1 detail — Pluggable PTY adapter registry (sub-section of `AgentRuntime`)

> See § Agent Shape Taxonomy + `AgentRuntime` Interface for the full multi-shape picture. This section is Shape 1 (PTY) detail. The `PTYAdapter` interface below is the Shape 1 specialization of the polymorphic `AgentRuntime` interface — it adds PTY-specific methods (`inject`) on top of the common lifecycle.

iaGO formalizes cortextOS's per-runtime PTY adapter pattern as the Shape 1 specialization of the `AgentRuntime` registry. Required by Santiago's 2026-05-13 decision to preserve multi-LLM flexibility (claude + codex + gemini + opencode) currently delivered by OpenClaw's ACP backend.

**Interface (sketch — finalized in Phase 1 implementation):**

```ts
// Extensible via module augmentation — do not widen to bare `string` at call sites
type RuntimeId = "claude" | "codex" | "gemini" | "opencode";

interface PTYAdapter {
  readonly runtime: RuntimeId | string;
  readonly version: string;
  spawn(opts: { cwd: string; env: Record<string, string>; agentId: string; sessionId: string }): Promise<PTYHandle>;
  inject(handle: PTYHandle, text: string): Promise<void>;
  // Returns unsubscribe fn — callers MUST call it when the handle is destroyed to prevent listener accumulation
  onStatusChanged(handle: PTYHandle, cb: (status: "running" | "idle" | "exited" | "crashed", code?: number) => void): () => void;
  shutdown(handle: PTYHandle, signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
  restoreFromMarker(markerPath: string): Promise<PTYHandle | null>; // for crash recovery
  isAlive(handle: PTYHandle): Promise<boolean>; // poll liveness; don't rely solely on status callbacks
}
```

**Registry:** `runtime/agent-runtime/registry.ts` exports `registerRuntime(rt: AgentRuntime)`. Agent config files reference adapter by `runtime` field. Daemon loads adapters at boot, validates interface compliance, and routes spawn calls.

**Phase mapping:**
- **Phase 1:** Ship the interface + registry + Claude Code adapter. Hello-world end-to-end uses Claude only.
- **Phase 3:** Add Codex adapter (was already planned). Same phase: Gemini adapter (CLI via `gemini` if Google ships a CLI, OR API-backed pseudo-PTY) and opencode adapter (sst/opencode wrapper). Effort within Phase 3 grows from 3–4d to 5–7d to accommodate three adapters.
- **Beyond:** new runtimes (qwen, deepseek, local models via ollama, etc.) drop in as adapter files.

**What this is NOT:** not an ACP-protocol reimplementation. ACPX dies at cutover (see audit doc § Active OpenClaw dependencies). The registry is purely about hosting multiple runtime PTYs in one daemon process; inter-agent communication still goes through the file-bus, not an ACP-style message protocol.

---

### Pipeline invocation contract (daemon → pipeline)

The daemon is the new dispatch surface; the pipeline script is unchanged. Integration seam:

- **Spawn mechanism:** daemon spawns a child process via Node.js `child_process.spawn('bash', ['scripts/execute-pipeline.sh', '--plan', <path>, '--project-dir', <cwd>], { env, cwd, stdio })`. No PTY for pipeline stages — the script's existing self-freeze + bash semantics are preserved.
- **Environment contract:** daemon must inject `CLAUDE_CODE_SESSION_ID` (UUID per invocation, becomes dashboard join key), `IAGO_PARALLEL_BUILD` (0 or 1 per build-gate policy), `IAGO_PIPELINE_FROZEN_DIR` is set BY the script (do not preset), `IAGO_PIPELINE_FROZEN` must NOT be pre-set — clear it from the spawn env if inherited (inherited value of `1` would cause the child process to skip the self-freeze protection), `PATH` must include `node`, `git`, `gh`, `claude`, `codex` for the running user. Other pipeline-relevant env vars are documented in `scripts/lib/pipeline-telemetry.sh`.
- **Working directory:** repo root for the target project (e.g., `clients/munet-web/` or iago-os root). The daemon resolves project-dir from the task's `org`/`project` fields per cortextOS multi-org cascade.
- **Stdio sink:** daemon captures stdout+stderr per stage and streams to a per-task log file at `tasks/<taskId>/pipeline-<sessionId>.log`. NDJSON telemetry events emitted by `pipeline-telemetry.sh` go to `telemetry/<date>.ndjson` (existing iaGO convention) AND are tee'd to the IPC server's event bus for live dashboard render.
- **Exit-code semantics:** 0 = pipeline clean, PR open, ready for review. Non-zero = stage failed before PR creation (build gate, review-fix loop max-rounds, codex failure). Daemon surfaces non-zero exits as `task.status = "blocked"` and pings Santiago via Telegram with the failing stage + log path.
- **Cancellation:** SIGTERM from daemon → script's EXIT trap cleans `IAGO_PIPELINE_FROZEN_DIR`. SIGKILL only if SIGTERM doesn't return within 30s.
- **Concurrency:** daemon respects `max_concurrent_children` (default 3, Hermes pattern). Pipeline invocations queue per-org to prevent two pipelines on the same project tree.

This contract is what Phase 2 implements. Phase 1 builds the daemon skeleton without daemon-driven pipeline invocation; manual `claude -p` dispatch continues to work in parallel.

---

## Reopened Decisions (formerly closed, now active)

| Decision | Old verdict | New status |
|---|---|---|
| Paperclip adoption | DEFER ("iaGO = build env, not runtime") | **REOPENED** — adopt cost-ledger pattern + heartbeat pattern; skip stack/Docker/Postgres |
| cortextOS adoption | Cherry-pick patterns only | **REOPENED + DEEPENED 2026-05-15** — adopt daemon architecture as v2 runtime spine; also adopt session.jsonl replay, subagent spawn semantics, heartbeat health checks, and the **full Next.js dashboard** (was "fallback") |
| agentic-os-dashboard | Cherry-pick MCP health check only | **CLOSED 2026-05-15** — Streamlit fallback dropped; full cortextOS dashboard is canonical |
| iago-os-v2 (MWP parallel project) | PAUSED pending Sebas + MUNET | **ACTIVE** — this doc is the v2 spec; MWP-native framing is not the architecture (filesystem-as-orchestration was wrong fit; cortextOS daemon is the right fit) |
| Wedge F Telegram | Stretch goal, scoped narrow | **PROMOTED** to first v2 deliverable after daemon foundation |
| Wedge H webhooks | Stripe-events for installflow | **PROMOTED** to general VPS event trigger surface |
| PTY adapter registry (2026-05-13) | "PTY adapter registry is the multi-LLM solution" | **SUPERSEDED 2026-05-15** — recontextualized as Shape 1 of 5 under the polymorphic `AgentRuntime` interface. Multi-LLM is one slice of multi-shape. |
| Hermes adoption depth (2026-05-13) | "Patterns only, runtime NOT adopted" | **REVISED 2026-05-15** — Hermes runtime IS adopted in Phase 3 as a Shape 3 (MCP-as-agent) runtime via `hermes-mcp` adapter. Patterns adoption deepens (full MCP rate-limiter, generalized shell-hook router, full compression impl). |

---

## May-12 Punch List (reinterpreted)

The 4.5-day punch list from `.iago/research/iago-os-adversarial-review-2026-05.md` is still valid but reinterpreted under v2 frame:

| Item | Original purpose | v2 interpretation | Keep? |
|---|---|---|---|
| Instrument pipeline with `CLAUDE_CODE_SESSION_ID` → Agent View | Free monitoring win | **Becomes dashboard join key** (Layer 4) | ✅ Keep |
| Fix learnings system write path | Dead infrastructure → actually accumulate | Daemon writes pattern-extraction back to `.iago/learnings/` | ✅ Keep |
| Fix `/iago-execute` Step 3 dirty-branch guard | Silent work loss prevention | Same — correctness fix | ✅ Keep |
| Fix Claude adversarial fallback false-clean parser | Latent correctness bug | Same — correctness fix | ✅ Keep |
| Migrate one Routine (nightly PR triage) | Validate Routines for iago-os | **Replaced**: validate cortextOS `cron-scheduler.ts` pattern instead. `/routines` is BIND-NOT-VIABLE per PR #37; cortextOS cron is the v2 substrate | ❌ Drop — use cortextOS cron |
| Delete dead `--n8n` flag + `.iago/config.json` ref | Remove false documentation | **HOLD** — n8n may return as VPS automation primitive in Phase 3 | 🟡 Defer decision |

**Net: 4 of 6 punch-list items still apply (~3 days work). Drop the Routines migration; hold the n8n deletion.**

---

## Phase Sequencing (v2, supersedes old roadmap waves)

**Effort math revised 2026-05-15** to absorb agent-shape taxonomy + deeper cortextOS adoption (session.jsonl replay, subagent semantics, heartbeat health, full Next.js dashboard) + deeper Hermes adoption (MCP rate-limiter, shell-hook router, compression full impl). Phase 1 +2-3d, Phase 3 +2-3d, Phase 6 +3d, new Hermes-deeper folded into Phase 5, Phase 9 +1d (Shape 4 adapter scope). Total 27-32d → 38-46d.

| Phase | Duration | Deliverable | Gate |
|---|---|---|---|
| **0 — VPS audit** | 0.5d | `runtime/migration/00-vps-audit.md` with OpenClaw inventory + Tailscale/systemd health | Before any daemon code |
| **0.5 — Orphan cleanup** | 0.5d | Stop `iaguito-hq.service`, kill pulsara vite, install ufw default-deny + Tailscale-only SSH | Phase 0 complete + Santiago auth |
| **1 — Daemon skeleton (local)** | 7-10d *(was 5-7d)* | `runtime/` directory with agent-manager + file-bus + **`AgentRuntime` interface + registry** + Shape 1 (PTY) Claude adapter + Telegram approval handshake + **session.jsonl replay + heartbeat health checks + subagent spawn semantics**; hello-world end-to-end on Santiago's Windows | Local validation |
| **1b — May-12 punch list (4 of 6 items)** | 3d | `CLAUDE_CODE_SESSION_ID` instrumentation, learnings write path, dirty-branch guard, fallback parser fix | Parallel to Phase 1 — independent |
| **2 — VPS install alongside OpenClaw** | 2-3d | `iago-os-v2-daemon.service` running on VPS, one workflow migrated, no OpenClaw impact | Phase 1 + 1b complete |
| **3 — Shape expansion (PTY ×3 + HTTP + MCP)** | 7-10d *(was 5-7d)* | Shape 1 (PTY): `codex-pty` + `gemini-pty` + `opencode-pty`. Shape 2 (HTTP/SDK): `anthropic-sdk` + `openai-sdk` (LangGraph workflows host on top). Shape 3 (MCP-as-agent): `hermes-mcp` adapter. All cohabit with Claude in the daemon via the `AgentRuntime` registry. | Phase 2 stable |
| **4 — Wedge J shell-hook matchers** | 1d | regex + timeout on hooks; lands in daemon hook config | Phase 2 stable |
| **5 — Wedge B distiller + Hermes-deeper bundle** | 4-5d *(was 2d)* | Stage compression for long-running daemon sessions **PLUS** Hermes compression-threshold full impl (sliding-window summarizer with `threshold:0.50` + `target_ratio:0.20` + `protect_last_n:20`) **PLUS** Hermes MCP rate-limiter full impl (token-bucket per MCP server) **PLUS** generalized shell-hook event router (cross-shape) | Phase 3 + 4 |
| **6 — Full Next.js dashboard** | 8-10d *(was 5-7d)* | Full cortextOS Next.js port: agent list across all 5 shapes, per-shape filters, current state, recent activity, token spend per agent/project/model/shape, intervention controls. Streamlit fallback dropped per Garry-impressed standard. *Amendment 2026-05-29:* Phase 6 dashboard adds three read-only tabs over existing state: **Comms** (tail of `comms/<date>.ndjson`, threaded agent-to-agent view = the video's comms tab), **Board** (kanban over `tasks/{pending,claimed,resolved}/` = assigned→in-progress→completed), **Workflows** (cron registrations + last-fire telemetry). No new data model; +2-3d on the Phase 6 budget. The literal cortextOS 'analytics software for businesses' and 'email outreach pipeline' are NOT ported — out of v2 scope (operational telemetry + Phase 8 cost ledger only). | Phase 3 stable |
| **7 — OpenClaw cutover + cleanup** | 1d | All workflows on v2 daemon, OpenClaw stopped, state archived (30d retain) | Phase 6 stable + Santiago green-light |
| **8 — Cost ledger (SQLite)** | 2d | Per-agent cost tracking + hard pause when budget breached; integrates with `AgentRuntime.costTap()` | Triggered when first API-billing client lands |
| **9 — Wedge H webhook surface + Shape 4 (Webhook/event)** | 3-4d *(was 2-3d)* | HMAC webhook receiver → daemon trigger → event-shape adapter spawn (`sentry-event`, `github-event`, `cron-tick-event`) → agent runs to completion. Shape 4 lands here, not in Phase 3, because it depends on the inbound webhook surface. | Phase 7 stable |
| **10 — Auto-PR loop end-to-end** | 1d | Sentry → daemon → file-bus task → event-shape agent → pipeline → PR loop wired end-to-end | Phase 9 webhook surface live |
| **11 — Email auto-provision + Shape 5 (Daemon)** | 2-3d *(was 2d)* | Per-agent email address via SES subdomain catch-all + IMAP polling. IMAP poller lands as the first Daemon-shape agent (`imap-daemon`), completing Shape 5 of the registry. | Phase 7 stable |
| **12 — Learning loop pattern extraction** | 1d | Pipeline pattern-extraction stage writes to `.iago/learnings/patterns.md`; 5+ occurrence → CLAUDE.md promotion via daemon-managed PR | Phase 6 stable |

**Total Phase 0–7 + Phase 9–10 effort:** ~38-46 dev-days (~8-9.5 weeks at sustainable pace).
- Phase 1 grew +2-3d for `AgentRuntime` interface + cortextOS deeper-adoption (session.jsonl replay, heartbeat, subagent semantics)
- Phase 3 grew +2-3d for HTTP + MCP shape adapters (was PTY-only multi-LLM)
- Phase 5 grew +2-3d for Hermes-deeper bundle (rate-limiter, hook router, full compression impl)
- Phase 6 grew +3d for full Next.js dashboard (Streamlit fallback dropped)
- Phase 9 (3-4d) is always-on alongside Phase 10 — Shape 4 lands here

**Phases 8, 11, 12 are demand-triggered or trailing**, not scheduled.

**Phase 0.5 (orphan cleanup)** is new — derived from Phase 0 audit findings (`iaguito-hq.service` + pulsara vite running publicly on VPS for 60-70 days, no ufw). Plan exists at `.iago/plans/feature-v2-foundation/02-orphan-cleanup.md`; runs before Phase 1 daemon code.

---

## What v2 is NOT

Stay scoped:

- **Not a Cursor/Aider/Continue replacement.** Those are IDEs. iaGO v2 is a delivery runtime.
- **Not a Devin clone.** Devin replaces developers. iaGO v2 augments a 3-person consultancy by giving Santiago + Sebas remote control over the agents that do the work.
- **Not 17-platform messaging.** Telegram only. WhatsApp **explicitly dropped at cutover** (Santiago decision 2026-05-13: "Telegram works fine"). Slack/Discord only on real demand from a paying client.
- **Not multi-tenant SaaS (internal use).** Per-client directory separation is sufficient. Multi-tenancy stays a possible product angle, not internal infra.
- **Not Postgres.** SQLite for cost ledger + session state. JSON/JSONL for everything else (cortextOS pattern).
- **Not Docker for agent runtime.** systemd on VPS. Docker auth dance is operational fragility.
- **Not PTY-only.** The daemon hosts 5 agent shapes (PTY, HTTP/SDK, MCP-as-agent, Webhook/event, Daemon) via the polymorphic `AgentRuntime` interface — Santiago decision 2026-05-15. Anything that takes a goal and emits work qualifies, regardless of execution mechanics.
- **Not a workflow framework reimplementation.** LangGraph, CrewAI, AutoGen, and similar workflow frameworks run as HTTP-shape agents (host process imports the framework, executes, returns final state). v2 hosts them; it does not replace them.
- **Not a message-passing protocol.** No pub/sub broker, no agent-to-agent direct messaging, no ACP-style protocol. Inter-agent coordination is file-bus only (`tasks/{pending,claimed,resolved}/`).
  - *Amendment 2026-05-29:* The ban above is on a **separate message transport** (pub/sub broker, always-connected socket bus, ACP-style wire protocol). It is **refined** to explicitly PERMIT agents as **file-bus producers**: a running agent (typically a `role:"chief"` agent) MAY write the canonical typed envelope `{v, kind: "agent-message" | "task-assignment", from, to, body, threadId, seq, needsApproval, quality_signal, createdAt}` (server-stamped `from`, monotonic `seq` for ordering/replay-dedupe, signed-chief `quality_signal`; single source of truth: ADR `.iago/decisions/2026-05-30-per-agent-bots-and-chief-tier.md`) into `tasks/pending/<toAgentId>__<uuid>.json` for another agent to claim via the existing `O_EXCL` primitive, mirroring the cron `fire()` producer (`cron-scheduler.ts`). Such envelopes are appended to a durable `comms/<date>.ndjson` log (the dashboard 'comms tab' data source). An agent-message **is** a file-bus envelope — not a new transport. Spend/prod-touching peer sends route through the existing `approvals/{pending,resolved}/` handshake. Cross-runtime (e.g. a `codex-pty` agent → a `claude-pty` agent) is free because the file-bus is runtime-agnostic.
- **Not a Streamlit dashboard.** The Streamlit minimal fallback is dropped (2026-05-15) per Garry-impressed standard — Phase 6 ships the full cortextOS Next.js port directly.

---

## Open Questions (need Santiago verdict before Phase 1)

1. **OpenClaw active dependencies.** Phase 0 audit answered most of this (see `runtime/migration/00-vps-audit.md` § Active dependencies). Remaining: Pulsara/alfallo project status — active, personal, abandoned? Gates Phase 0.5 orphan cleanup.
2. **Telegram bot strategy.** ✅ DECIDED 2026-05-13 — **one bot for v2 with per-agent message tagging in the file bus** (Hermes-style routing wrapped around cortextOS's `appr_*` approval handshake). cortextOS's per-agent-token pattern rejected — operational overhead too high for 3-person scale. Subject to revisit only if a paying client requires strict per-tenant bot isolation.
   - *Revisit 2026-05-29 (cortextOS video, Santiago direction):* One-bot lock and per-agent-token rejection are **KEPT**. Santiago's 'each agent gets its own bot' intent is met via per-agent IDENTITY on the single bot: (a) sticky `/agent <id>` default-target (ship now, no spec change, private-chat gate untouched); (b) OPTIONAL Telegram forum-topics (one supergroup, `message_thread_id ↔ agentId` binding) for true per-agent threads — **gated on a separate Santiago decision** because forum-topics reopen the PR45 private-chat-only security gate (`bot.ts:306`). Per-agent bot TOKENS remain rejected (N polling clients = N HTTP-409 hazards + N secrets). Trail: `.iago/research/2026-05-29-cortextos-comms-gap-analysis.md` (the planned `2026-05-29-per-agent-identity-and-chief-tier.md` decision file was never written; superseded the next day — see below).
   - *Superseded 2026-05-30:* One-bot KEPT is REVERSED. Decision = per-agent bots for standing agents + one chief bot for ephemeral workers/broadcast. Forum-topics dropped (private DMs instead). See Amendment 2026-05-30 above + ADR `.iago/decisions/2026-05-30-per-agent-bots-and-chief-tier.md`.
3. **Sebas integration.** Does Sebas get his own Tailscale node + Telegram bot binding from day 1, or after v2 stabilizes? Default recommendation: **single user (Santiago) for Phases 1-3**; add Sebas in Phase 6 when dashboard is up.
4. **Dashboard scope (v1).** ✅ DECIDED 2026-05-15 — **full Next.js port, Streamlit fallback dropped** per Garry-impressed standard. Phase 6 ships the real dashboard directly.
5. **MUNET handling during v2 build.** MUNET is currently stalled. Does v2 work proceed in parallel, or does MUNET MVP need to ship first? Per memory `project_munet_mvp_scope`, M2 03-06 + ticket-email-fix wave 2 are deferred post-MVP. Default: **v2 build proceeds in parallel; MUNET remains highest-revenue priority when it unblocks**.
6. **Sentria daemon agent shape.** Sentria is the most likely first Shape-5 (Daemon) candidate after `imap-daemon`. Open question: ship Sentria's incident-triage as a daemon-shape agent inside v2 (Phase 11+), or keep it standalone on the BAS Labs repo? Default recommendation: **standalone now, port to v2 daemon shape in Phase 12+ when Sentria stabilizes** — avoids coupling Sentria's MVP timeline to v2's roadmap.
7. **LangGraph workflow hosting.** When the first LangGraph workflow lands (likely a client deliverable), does it run as a Shape 2 (HTTP/SDK) agent inside the v2 daemon, or as a separate process? Default: **HTTP shape inside v2 daemon, using `anthropic-sdk` or `openai-sdk` adapter with LangGraph as the workflow layer on top**. **Sub-question:** does LangGraph state persistence (checkpointer) integrate with the daemon's `session.jsonl` replay, or stay separate (LangGraph manages its own)? Decision in Phase 3 when SDK adapters ship.
8. **HTTP-shape adapter authentication.** ✅ DECIDED 2026-05-15 — **systemd `LoadCredential=` with per-adapter credential files** under the v2 threat model (single-VPS, Tailscale-only inbound, systemd-managed daemon). Leak-mode reasoning: 1Password CLI at runtime leaks via session state / shell history / logged env; daemon-managed encrypted store leaks if the key lives beside ciphertext or backups; `LoadCredential=` leaks only if credentials propagate to env / stdout — preventable with strict unit sandboxing (`NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`). 1Password CLI used as **provisioning input** at deploy time only, never at runtime. Confirmed by cross-model verdict (Codex GPT-5.5, 2026-05-15). Full reasoning in `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` § Decisions made under this amendment.
9. **Replay safety idempotency-key schema for Shape 4 + Shape 5.** What is the canonical idempotency-key format per operation type — derived from `sessionId + agentId + operation-sequence`, or operation-specific (Stripe `idempotency_key` header, GitHub `client_mutation_id`)? Decision needed before Phase 9 (Shape 4 ships). Default recommendation: derive from `sessionId + agentId + operation-sequence-number` for daemon-internal dedupe, AND pass the same key to external providers when their API supports it (Anthropic ✓, OpenAI partial, Stripe ✓, GitHub ✓, SES uses SES Message-ID-based dedupe).
10. **MCP-as-agent shape verification.** Hermes runtime is the only known goal-taking MCP server today. Are there other Shape 3 candidates to design for (future Anthropic-managed agents shipping as MCP servers, third-party goal-taking MCPs), or is Hermes the load-bearing case? Affects adapter test coverage and registry validation. Confirms in Phase 3 when `hermes-mcp` adapter ships.
11. **Cross-shape task fairness.** Shapes have different polling cadences — a Daemon-shape agent may poll `tasks/pending/` 10x/second while a Webhook-shape agent only wakes on inbound events. The O_EXCL claim primitive prevents double-claims but doesn't prevent starvation. Should the file-bus implement per-shape claim quotas, per-agent quotas, or weighted-fair-queueing? Defer answer to Phase 3 when multiple shapes coexist for real; flag for monitoring as a Phase-3 acceptance gate.

---

## Sources

- **ADR — agent-shape taxonomy (2026-05-15):** `.iago/decisions/2026-05-15-agent-shape-taxonomy.md` — captures Santiago's "must work for all agent types" decision + `AgentRuntime` polymorphic interface verdict
- **Phase 0 audit artifact (2026-05-13):** `runtime/migration/00-vps-audit.md` — OpenClaw inventory + Tailscale/systemd baseline + Active dependencies
- **Phase 0.5 orphan cleanup plan:** `.iago/plans/feature-v2-foundation/02-orphan-cleanup.md` — pending Santiago authorization
- **Research artifact (2026-05-13):** `.iago/research/2026-05-13-multi-agent-cohabitation.md` — comparison + adoption verdicts
- **Hermes details:** `.iago/research/team-2-hermes-state.md`
- **cortextOS eval (verdict now overridden):** `~/dev/obsidian-brain/projects/cortextos-eval.md` (Santiago-local Obsidian vault; not reachable from builder agents on VPS or in `claude -p` subprocess — key adoption verdicts captured inline in `.iago/research/2026-05-13-multi-agent-cohabitation.md`)
- **Paperclip eval (verdict now overridden):** `~/dev/obsidian-brain/projects/paperclip-eval.md` (Santiago-local; see above)
- **agentic-os-dashboard eval (verdict now overridden):** `~/dev/obsidian-brain/projects/agentic-os-dashboard-eval.md` (Santiago-local; see above)
- **May-12 adversarial review:** `.iago/research/iago-os-adversarial-review-2026-05.md`
- **Old vision (superseded):** `docs/specs/iago-os-vision.md` — keep for historical reasoning trail; do not execute against
- **Old wedge roadmap (partially superseded):** `docs/specs/iago-os-roadmap.md` — wedge primitives still valid; framing reinterpreted per this doc
- **Council decision (now overridden):** `~/dev/obsidian-brain/decisions/2026-04-21-iago-os-v2-council.md` (Santiago-local Obsidian vault) — keep for historical reasoning; verdict reversed by Santiago 2026-05-13 per `memory:feedback_iago_v2_overrides_council`

---

## What Reads This Doc

Every iago-os work session anchors here first. Specifically:

- `/iago-plan` for any wedge work → read this doc, interpret wedge under v2 frame
- `/iago-execute` → pipeline still applies, daemon dispatch waits on Phase 2
- Future research subagents → this doc is canonical, not the 2026-04-28 vision spec
- Session digests written to Obsidian → reference this doc by name
