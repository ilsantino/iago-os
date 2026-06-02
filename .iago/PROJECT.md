# Project — iaGO-OS v2

## What it is

iaGO-OS v2 is a **Telegram-controlled, model-agnostic multi-agent operating system** for a 3-person AI consultancy (CEO Santiago on Windows, CTO Sebas on Mac), running on a Hostinger VPS (KVM 2, Debian 13) behind a Tailscale mesh. It replaces OpenClaw as the production agent runtime. The core primitive is a Node.js/TypeScript daemon that hosts agents of any execution shape, dispatches them via phone (Telegram), and observes them through a web dashboard — without the daemon importing any LLM SDK. All LLM-facing work happens in external CLI subprocesses or separate host-process scripts.

---

## Architecture

### Runtime substrate
Hostinger VPS (`srv1456441.hstgr.cloud`, `187.77.135.32`, Tailscale node `srv1456441`). No Docker: systemd manages the v2 daemon directly. Tailscale-only SSH inbound after Phase 0.5 ufw lockdown.

### Agent execution — `AgentRuntime` registry (5 shapes)

The polymorphic `AgentRuntime` interface is the load-bearing abstraction. Any execution primitive that takes a goal and emits work qualifies as an agent; the shape determines the adapter mechanics.

| Shape | Mechanics | Shipped adapters |
|---|---|---|
| **1 — PTY** | Subprocess with pseudo-terminal; bidirectional text stream; exit-code lifecycle | `claude-pty` (Phase 1); `codex-pty`, `gemini-pty`, `opencode-pty` (Phase 3) |
| **2 — HTTP/SDK** | Host process invokes provider SDK; request/response or streaming; LangGraph workflows live here | `anthropic-sdk`, `openai-sdk` (Phase 3) |
| **3 — MCP-as-agent** | stdio JSON-RPC subprocess that takes a goal and emits tool calls | `hermes-mcp` (Phase 3) |
| **4 — Webhook/event** | Triggered by inbound event (Sentry, GitHub, cron tick); claims a file-bus task; runs ephemeral worker | `sentry-event`, `github-event` (Phase 9) |
| **5 — Daemon/long-running** | Always-on child process; observed via heartbeat; no spawn/exit lifecycle | `imap-daemon` (Phase 11) |

Adding a runtime = implement `AgentRuntime` for the right shape + register in `runtime/agent-runtime/registry.ts`. The agent-manager stays shape-agnostic.

### File-bus coordination — O_EXCL
`tasks/{pending,claimed,resolved}/` with atomic O_EXCL claim and temp-file+rename resolve. The canonical inter-agent communication transport. No pub/sub broker, no ACP wire protocol.

### Agent comms channel (Phase 3.5)
Standing agents with `role:"chief"` may write typed envelopes into `tasks/pending/`. Workers are consumers only. Envelope: `{v, kind, from, to, body, threadId, seq, needsApproval, quality_signal, createdAt}`. `from` is server-stamped (anti-spoof). Inter-agent comms is file-bus only — no new transport.

### Cron scheduler
`cron-scheduler.ts` (cortextOS pattern): `crons.json` per-agent schedule, daemon-managed wakeups, pre-LLM wake gate (Hermes pattern) avoids burning tokens when preconditions fail.

### Telegram control plane
- **Standing agents** each have a dedicated per-agent BotFather-registered bot (one token per agent, private DM with `ALLOWED_USER`). Secured per `bot.ts:306` private-chat gate.
- **Chief bot** routes ephemeral workers + broadcast.
- File-based approval handshake: `approvals/{pending,resolved}/` (cortextOS `fast-checker.ts` pattern). HITL survives network hiccups.

### IPC server
Unix socket / named pipe (`ipc-server.ts`): same-host dashboard and CLI talk to the daemon without an external REST surface.

### 6-layer memory
| Layer | Tool | Role |
|---|---|---|
| MEMORY.md | Always-loaded context | Session-start prefs + frozen snapshot |
| Obsidian | MCP (`read_note`, `write_note`) | Session digests, decisions, meetings |
| Graphify | MCP (`query_graph`, `get_node`) | Knowledge graph + entity relationships |
| MemPalace | MCP (`mempalace_search`, diary) | Conversation history + agent diary |
| MarkItDown | MCP (`convert_to_markdown`) | Document ingestion (DOCX/PPTX/PDF) |
| SQLite | `ledger.sqlite` | Per-agent cost ledger, event dedupe, session resume |

### Observability split (ADR 2026-05-20)
- **Sentry**: Layer A daemon errors (`@sentry/node` auto-instrument) + Layer D auto-fix dispatch webhook (Phase 10).
- **PostHog**: Layer B per-client app analytics/errors (free unlimited team) + Layer E LLM telemetry (Claude Code plugin, zero VPS infra).
- **Dual MCP** (Layer C): Sentry MCP for trace context, PostHog MCP for cost queries.

### Delivery pipeline (Layer 5 — preserved)
Cross-model Codex review, severity floors, secret-exclusion staging, skill routing, stress test. The daemon invokes the pipeline as a stage type; it does not replace it. This is the moat.

---

## North star: MODEL INDEPENDENCE

**The architecture is vendor-agnostic by design.** The `AgentRuntime` adapter registry IS the model-independence abstraction. The daemon imports no LLM SDK; every agent is an external CLI subprocess or separate host-process script. Today the implementation is Claude-heavy (Claude PTY built, Codex used in review), but the ARCHITECTURE supports any model/CLI/SDK.

Model independence means **optionality + cost control**, not "all models are equal." Claude/Codex are currently strongest at agentic work; a provider routing layer picks the right model per task (frontier for hard agentic work, cheap/local for bulk) — same layer-triage/cost-discipline principle the 60/30/10 framework mandates.

Concrete path: (a) PTY adapters for `codex`, `gemini-cli`, `opencode`; (b) one OpenAI-compatible HTTP adapter (Shape 2) unlocking OpenRouter + local models via ollama/vLLM; (c) odysseus-derived provider routing layer (cherry-pick `llm_core.py`/`endpoint_resolver.py`/`model_discovery.py` concepts as TS behind existing interfaces). See `docs/specs/iago-os-v2-vision.md` § Model Independence.

---

## Goals

- Give Santiago + Sebas remote control over agents from a phone, with approval gates for any spend/prod-touching action.
- Support any agent execution shape: PTY CLI, HTTP/SDK program, MCP goal-taker, webhook worker, long-running daemon.
- Replace OpenClaw at cutover; run alongside it until Phase 7 validation.
- Keep per-client directory separation (`clients/*/`) for multi-org cohabitation.
- Never break the delivery pipeline (the review gate that protects every client deliverable).

## Non-negotiable constraints

| Constraint | Basis |
|---|---|
| AWS Amplify Gen 2 for all client backends | Stack rules |
| Agents never hold secrets — daemon makes all privileged calls | R1 decision (PR #84) |
| Every code change through the 8-stage review pipeline | `CLAUDE.md` + `execution-pipeline.md` |
| Cost discipline: LLM only for the genuine 10% (judgment/NL/synthesis) | Layer-triage / 60-30-10 rule |
| No Docker runtime for agents | systemd on VPS; auth-dance fragility rejected |
| No pub/sub broker, no ACP protocol | File-bus is the protocol |
| No golang rewrite pre-cutover | Daemon is I/O-bound; rewrite torches 80+ PRs of hardened code for parity, not progress |

## Key source files

- `docs/specs/iago-os-v2-vision.md` — canonical vision + phase plan (read first)
- `.iago/ROADMAP.md` — phase statuses + exit criteria
- `.iago/STATE.md` — current phase, recent commits, in-flight work
- `runtime/` — daemon implementation (created Phase 1)
- `.iago/decisions/` — ADRs for all locked decisions
