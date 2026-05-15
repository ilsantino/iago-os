# ADR — Agent Shape Taxonomy + `AgentRuntime` Polymorphic Interface

**Date:** 2026-05-15
**Status:** Accepted
**Decided by:** Santiago, 2026-05-15
**Author:** Claude (orchestrator) + Santiago direction
**Supersedes:** PTY adapter registry framing (2026-05-13 `docs/specs/iago-os-v2-vision.md` § "Pluggable PTY adapter registry")

---

## Context

The 2026-05-13 v2 vision lock formalized cortextOS's per-runtime PTY adapter pattern into a `PTYAdapter` registry. This was framed as the multi-LLM solution: a config + adapter file adds Claude / Codex / Gemini / opencode as cohabiting runtimes inside one daemon. Santiago's 2026-05-13 decision required multi-LLM flexibility; the PTY adapter registry was the answer.

On 2026-05-15, Santiago surfaced a **broader hard part**: v2 must work for **all types of agents**, not just terminal-shaped CLI runtimes.

A terminal subprocess is one execution shape. iaGO already has work in flight that does NOT fit the PTY shape:

- **Sentria** — Telegram-only incident triage runs as a long-running daemon listening for webhook events. No PTY.
- **Future client agents** built on the Anthropic SDK or OpenAI SDK directly. Host-process, no terminal.
- **LangGraph workflows** that may land as a client deliverable (Phase 3+). Python/Node host process, no terminal.
- **The Hermes runtime** itself — a goal-taking MCP server with stdio JSON-RPC, not a PTY.
- **Webhook-triggered workers** (Sentry → daemon → fix-agent → PR) — agent lives for the duration of one event, no persistent terminal.

The PTY adapter registry handles none of these correctly. Forcing them into a PTY abstraction would require fake terminals, useless lifecycle wrappers, and per-shape special-cases in the agent-manager.

Neither cortextOS (PTY-only) nor Hermes (MCP-only) ships an abstraction that covers all five shapes. This is the **iaGO-specific extension** that makes v2 a true multi-agent OS rather than a Claude/Codex cohabitation runtime.

---

## Decision

Replace the `PTYAdapter` registry with a **polymorphic `AgentRuntime` interface** that all agent shapes implement. PTY becomes Shape 1 of 5, not the universal abstraction.

### The five shapes

| Shape | Mechanics | Adapter location |
|---|---|---|
| **1. PTY** | Subprocess with a pseudo-terminal; bidirectional text stream; exit-code lifecycle | `runtime/agent-runtime/pty/` |
| **2. HTTP / SDK** | Host process invokes provider SDK directly (no terminal); request/response or streaming | `runtime/agent-runtime/http/` |
| **3. MCP-as-agent** | stdio JSON-RPC subprocess where the server takes a goal and emits tool calls | `runtime/agent-runtime/mcp/` |
| **4. Webhook / event** | Triggered by an inbound event; claims a task; runs to completion in a host process | `runtime/agent-runtime/event/` |
| **5. Daemon / long-running** | Always-on host process with internal scheduler; observed via health checks | `runtime/agent-runtime/daemon/` |

### Common interface

```ts
type AgentShape = "pty" | "http" | "mcp" | "event" | "daemon";

interface AgentRuntime {
  readonly shape: AgentShape;
  readonly id: string;
  readonly version: string;

  spawn(opts: SpawnOpts): Promise<AgentHandle>;
  send(handle: AgentHandle, message: AgentMessage): Promise<void>;
  onStatusChanged(handle: AgentHandle, cb: StatusCallback): () => void;
  isAlive(handle: AgentHandle): Promise<boolean>;
  shutdown(handle: AgentHandle, signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
  restoreFromMarker(markerPath: string): Promise<AgentHandle | null>;
  costTap?(handle: AgentHandle): AsyncIterable<CostEvent>;
}
```

Common lifecycle (spawn → status → restore → shutdown) is enforced for every shape. Per-shape mechanics live in the adapter implementation.

### Shape 4 adapter semantics (Webhook/event)

Shape 4 has non-obvious lifecycle semantics that must be specified to prevent incorrect heartbeat behavior:

- **`spawn()` is called once at daemon boot** (per registered event adapter). It registers a persistent inbound webhook handler and returns a long-lived `AgentHandle`. It is NOT called per event.
- **`isAlive()` returns `true` while the handler is registered** — not just when an event is being processed. A dormant handler between events is healthy, not dead. The heartbeat loop must not attempt to restart a dormant-but-registered event handler.
- **Event payloads arrive via `send()`** — the daemon delivers `{ kind: "custom", payload: eventData }` when an inbound webhook fires. The adapter then claims a file-bus task and runs the per-event work in an ephemeral child process. The persistent handle remains live throughout.
- **`SpawnOpts` needs no event-payload slot.** The spawn-then-send contract is sufficient; do not smuggle event data into `SpawnOpts.env`.

This resolves the `isAlive()` / heartbeat conflict: the handle is long-lived (isAlive = true), only the per-event worker is ephemeral.

### Per-shape adapter scope (Phase mapping)

| Phase | Shape work | Shipped adapters |
|---|---|---|
| 1 | `AgentRuntime` interface + registry skeleton + Shape 1 (PTY) | `claude-pty` |
| 3 | Shape 1 (PTY) deeper: `codex-pty`, `gemini-pty`, `opencode-pty`; Shape 2 (HTTP/SDK): `anthropic-sdk`, `openai-sdk` (also hosts LangGraph); Shape 3 (MCP-as-agent): `hermes-mcp` | 7 adapters across 3 shapes |
| 9 | Shape 4 (Webhook/event): daemon-managed inbound webhook receiver dispatches to event-shape adapters | `sentry-event`, `github-event`, `cron-tick-event` |
| 11 | Shape 5 (Daemon): email auto-provision IMAP poller | `imap-daemon` |

---

## Alternatives considered

### Alternative 1 — Keep PTY adapter registry; special-case non-PTY agents in the agent-manager

Rejected. Forces every non-PTY agent shape into a fake-terminal wrapper. Hermes (MCP-as-agent) and LangGraph (HTTP) would need spawning fake PTYs that wrap stdio or HTTP. The agent-manager grows special-case branches for "is this really a PTY or a wrapped HTTP." Failure modes diverge per shape; status semantics get muddy.

### Alternative 2 — Multiple registries (one per shape)

Rejected. Five registries × five adapter sets × five sets of agent-manager wiring = duplicated lifecycle logic in five places. Crash recovery, status events, cost tracking would have to be re-implemented per shape. The polymorphic interface lets the agent-manager treat all shapes uniformly at the lifecycle level.

### Alternative 3 — Don't host non-PTY agents; require them to run as separate services

Rejected. Defeats the purpose of v2. The point is one daemon hosting all agent shapes for one consultancy; if Sentria has to live in its own systemd unit and LangGraph workflows have to live in another, we are back to OpenClaw-era "multiple isolated services" instead of "one OS."

### Alternative 4 — Adopt LangGraph or similar agent framework as the universal abstraction

Rejected. LangGraph is a workflow framework, not an execution-shape abstraction. It assumes one shape (Python host process) and one programming model (graph of nodes). Doesn't help with PTY cohabitation or MCP-as-agent. Workflow frameworks are upstream of v2's hosting concern; v2 hosts them as Shape 2 agents, doesn't replace them.

---

## Consequences

### Schedule impact

| Phase | Old duration | New duration | Delta | Reason |
|---|---|---|---|---|
| 1 | 5–7d | 7–10d | +2–3d | `AgentRuntime` interface + cortextOS deeper-adoption (session.jsonl replay, heartbeat, subagent) |
| 3 | 5–7d | 7–10d | +2–3d | HTTP + MCP shape adapters (was PTY-only multi-LLM) |
| 5 | 2d | 4–5d | +2–3d | Hermes deeper-adoption bundle (rate-limiter, hook router, full compression) |
| 6 | 5–7d | 8–10d | +3d | Full Next.js dashboard (Streamlit fallback dropped) |
| 9 | 2–3d | 3–4d | +1d | Shape 4 (Webhook/event) adapters land here |
| 11 | 2d | 2–3d | +1d | Shape 5 (Daemon) IMAP poller adapter |

**Total operational-v2:** 27–32d → 38–46d (~11–14d added).

### Architecture impact

- **Renamed directory:** `runtime/pty/` → `runtime/agent-runtime/pty/` (Phase 1 lands the new path; PTY work that landed in PR #38 referenced `runtime/pty/` — Phase 1 implementation moves it).
- **New parent interface:** `runtime/agent-runtime/registry.ts` exports `registerRuntime(rt: AgentRuntime)`. The Shape-1-specific `PTYAdapter` interface (with `inject` method) extends `AgentRuntime` with PTY-specific affordances.
- **No protocol change.** Agents still coordinate via the file-bus. `AgentRuntime.send()` is the daemon-to-agent input channel, not an agent-to-agent message bus.

### Dashboard impact

- Per-shape filters required.
- Cost-per-shape breakdown required.
- Streamlit fallback dropped — full Next.js port is the only Phase 6 deliverable.

### Future flexibility

- Adding a sixth shape (e.g., "browser/extension" for embedded agents in client web apps) is a new sub-directory under `runtime/agent-runtime/` + new adapter implementations. No agent-manager changes.
- Adding a runtime within an existing shape (e.g., `qwen-pty`, `deepseek-pty`, `local-ollama-pty`, `cohere-sdk`) is one adapter file.

---

## Adoption depth changes (folded into this ADR)

Two related decisions land in the same amendment as the shape-taxonomy verdict:

### cortextOS — deeper than 2026-05-13 scope

| Primitive | New status |
|---|---|
| `session.jsonl` append-only event log + replay | **ADOPT** in Phase 1. Crash recovery without DB. Required by every shape. |
| Subagent spawn semantics (`spawnSubagent()` + parent-child handles + cost rollup) | **ADOPT** in Phase 1. Makes daemon truly multi-agent. |
| Heartbeat health checks + stall detection | **ADOPT** in Phase 1. Replaces "Santiago notices in dashboard" failure mode. |
| Full Next.js dashboard | **PROMOTED** from fallback to canonical. Streamlit dropped. |

### Hermes — deeper than 2026-05-13 scope

| Primitive | New status |
|---|---|
| MCP sampling rate-limiter (token-bucket per server) | **ADOPT** full impl in Phase 5. Bounds cost as Sentry/Google Workspace/other MCPs land. |
| Shell-hook matcher generalized to cross-shape event router | **ADOPT** generalized impl in Phase 5. One rule language for all 5 shapes. |
| Compression threshold (sliding-window summarizer) | **ADOPT** full impl in Phase 5. Required by long-running PTY + Daemon shapes. |
| Hermes runtime adoption | **REVISED** — Hermes runtime IS adopted in Phase 3 as a Shape 3 (MCP-as-agent) runtime via `hermes-mcp` adapter. Patterns + runtime adoption now both land. The 2026-05-13 rejection was because there was no native abstraction for stdio JSON-RPC — the PTY-only registry would have required a fake terminal wrapper around Hermes's stdio transport. Shape 3 (MCP-as-agent) provides a native home, making the prior objection void. |

---

## Open questions seeded by this ADR

1. **HTTP-shape adapter authentication.** SDK adapters need provider API keys at spawn time. Storage: 1Password CLI integration, systemd `LoadCredential=`, or daemon-managed encrypted store? Decision needed before Phase 3.
2. **LangGraph workflow hosting.** Confirmed default: HTTP shape inside v2 daemon, using `anthropic-sdk` or `openai-sdk` adapter with LangGraph as the workflow layer on top. Sub-question: does LangGraph state persistence (checkpointer) integrate with `session.jsonl` replay, or stay separate?
3. **Sentria port to v2 Daemon shape.** Defer port to Phase 12+ — keep Sentria standalone for MVP timeline.
4. **MCP-as-agent shape verification.** Hermes runtime is the only known goal-taking MCP server today. Are there other shape-3 candidates we should design for, or is Hermes the load-bearing case?

---

## References

- `docs/specs/iago-os-v2-vision.md` — § Agent Shape Taxonomy + `AgentRuntime` Interface
- `docs/specs/iago-os-v2-master-prompt.md` — Mission #1 (rewrites), P1 #5 (rewrites)
- `.iago/research/2026-05-13-multi-agent-cohabitation.md` — cortextOS/Hermes/Paperclip primitives source
- Memory: `feedback_garry_impressed_standard.md` (build-the-ocean standard motivating deeper adoption)
- Memory: `feedback_iago_v2_overrides_council.md` (override chain context)
