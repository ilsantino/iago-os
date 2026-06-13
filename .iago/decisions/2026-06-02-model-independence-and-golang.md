# ADR 2026-06-02 — Model independence (top Phase-3 priority) + golang phased path

_Date: 2026-06-02 | Status: **ACCEPTED — Santiago LOCKED 2026-06-02** | Authors: Claude (orchestrator) + Santiago direction_

---

## Status

ACCEPTED. Santiago LOCKED 2026-06-02. Two coupled decisions in one ADR because they share one root fact — the daemon imports no LLM SDK. Captured in `docs/specs/iago-os-v2-vision.md` (§ Model Independence, § Language Decision — golang phased path, + the 2026-06-02 amendment note) and `.iago/ROADMAP.md` (Phase 3 + the odysseus cherry-pick backlog note). Source of truth for the analysis: `.iago/research/2026-06-02-odysseus-clone-eval.md` (two deep-research Workflows — `wf_35862dc0-60e` pattern catalogue + `wf_9962e6fc-458` golang-steelman pushback; confidence 90%).

## Context

Santiago asked two questions: (1) should we clone `pewdiepie-archdaemon/odysseus` (29.5k★ self-hosted local ChatGPT/Claude alternative) and/or mix "the dopest shit" from it into v2; (2) he was "VERY confident golang is SO much faster" and wanted the daemon rebuilt in golang. odysseus is a Python FastAPI monolith + vanilla-JS UI — **a different product** from iaGO v2 (Telegram-controlled multi-agent VPS OS for a 3-person consultancy). The evaluation also surfaced that iaGO's stated "model-agnostic" north star was implied by the `AgentRuntime` taxonomy but never named as an explicit pillar or scheduled as concrete work.

The load-bearing fact both questions hinge on: **the v2 daemon imports zero LLM SDK** (the agent is the external `claude`/`codex` CLI in a PTY, `claude-pty.ts:345`; `claudePty.send` returns BEFORE inference, `claude-pty.ts:514`), and the review pipeline is a dev-time `.claude/` harness that reviews any language's diffs identically. So model choice and daemon language are both isolated, deferrable seams — not entangled with the daemon core.

## Decision

### D1 — Model independence is an explicit architectural pillar and the top Phase-3 priority

- The daemon stays **SDK-free**; every agent is an external CLI subprocess (Shape 1 PTY) or a host-process script (Shape 2 HTTP/SDK). The `AgentRuntime` registry **is** the model-independence abstraction — adding/swapping a model is an adapter file + a config field.
- Phase 3 ships, as top priority: (a) PTY adapters for `codex` / `gemini` / `opencode` (Shape 1); (b) **one OpenAI-compatible HTTP adapter** (Shape 2) that unlocks OpenRouter + any OpenAI-compatible endpoint + local models via ollama/vLLM — one adapter, N providers; (c) a **provider-routing layer** cherry-picked from odysseus `llm_core.py` / `endpoint_resolver.py` / `model_discovery.py` (ported as TS behind existing interfaces): role-based endpoint resolution (cheap utility model split from the agentic model), runtime model discovery (not a hardcoded table), dead-host cooldown, and Tailscale-DNS fallback for mesh-internal model hosts.
- Model independence = **optionality + cost control**, NOT "all models are equal." Claude/Codex stay default for hard agentic work + cross-model review; routing sends bulk/utility work to cheap/local models per the 60/30/10 layer-triage rule.
- **NOT taken from odysseus:** hwfit local-model *serving* (cloud-first; local models are an option via the OpenAI-compatible adapter, not a serving stack we operate), ChromaDB-coupled retrieval, the hand-maintained context-window table.

### D2 — Language decision: TypeScript through cutover; golang sidecar-first, post-cutover, trigger-gated

- **Stay TypeScript through cutover.** Finish Phase 2/3, cut over off OpenClaw, deploy — do not touch the daemon language.
- A golang **sidecar** is on the table only **post-cutover** and only if a flip-trigger fires — and even then it is **sidecar-first** (one layer: the file-bus scanner + IPC/health as a static binary with `fsnotify`, PTY/agent-lifecycle core staying TS) and **profile-first**. A full golang daemon rewrite stays off the table unless multiple triggers stack.
- **Do NOT clone odysseus** — category error: its best subsystems (`agent_loop`, `llm_core`, `context_compactor`) reimplement the `claude` CLI's internals, and iaGO's agent IS that CLI; there is no seam to drop the code into. Cherry-pick the ~1,100 LOC of genuine *ideas* as TS skills.
- **Flip-to-golang triggers (profile first):** (1) per-agent-bot fan-out at scale (10+ standing agents each holding a Telegram long-poll) AND a profiled flame graph shows the event loop, not inference, as the ceiling; (2) the daemon starts genuine per-event CPU work (multi-MB parse on the shared loop, crypto/msg, high-freq tick); (3) node-gyp/deploy pain becomes the dominant operational cost → targeted sidecar; (4) a measured post-cutover bottleneck survives the cheap TS fixes; (5) the team's primary language flips to golang.

## Rationale

- **Model independence is the realization of the v2 north star** and it's cheap — small TS adapters + a routing layer behind interfaces we already own. Naming it as a pillar + scheduling it as the top Phase-3 item converts a principle into shipped capability *before* cutover commits us operationally to one vendor.
- **Santiago is right that golang's wins are real** — single static binary kills the node-gyp/native-dep bug class this team has already hit; ~10–25 MB RSS vs ~40–80 MB V8; cleaner systemd sandbox. The old anti-golang arguments ("lose LLM-SDK fit", "lose the pipeline") are both dead given the SDK-decoupling. Don't be married to TS on principle.
- **But "SO much faster" does not survive profiling.** The daemon is I/O-bound: CPU is 1–50 ms/task ≈ 0.01–0.2% of the 20–120 s a user waits on token generation — byte-identical in any daemon language. The one user-visible latency (the 5 s poll) is a few-line `fs.watch`/inotify fix in TS, not a 6–9-week rewrite. Today's concurrency ceiling is imaginary (ONE agent, `maxConcurrent=1`). A rewrite now torches 80+ PRs of hardened scar-fixes for parity, not progress.
- **SDK-decoupling makes golang a deferrable, low-regret option** — keeping it viable later is precisely why we don't need to decide now.

## Consequences

- **Phase 3 scope** carries the model-independence layer as top priority (3 PTY adapters + 1 OpenAI-compatible HTTP adapter + routing layer). Reflected in `.iago/ROADMAP.md` Phase 3 and `docs/specs/iago-os-v2-vision.md` § Phase Sequencing / § Model Independence.
- **Cost-control surface:** routing + the eventual cost ledger (Phase 8, SQLite) gate spend per model/task; local/cheap models absorb bulk/utility work.
- **No language churn pre-cutover.** Any latency complaint is first answered with the two cheap TS fixes (event-driven poll; async cron wakeCheck), then with a profile, then — only if a trigger fires — a golang sidecar for one layer.
- **odysseus stays a pattern donor, not a clone/dependency.** The Tier-1 security cherry-picks (untrusted-content isolation, tunnel-aware loopback, SSRF guard, internal-tool capability token, dual-layer tool gate) fold into the Phase-2/3 daemon-creds + G3 pre-cutover workstream; the deep-research engine and context compactor are Phase-3+ features. Full backlog in the research doc.

## Tripwire to reconsider

- **D1:** if a routing layer proves it cannot reliably resolve/health-check heterogeneous endpoints without per-provider special-casing that bloats the daemon, narrow scope to PTY adapters + the single OpenAI-compatible adapter and defer the discovery/cooldown layer.
- **D2:** if any flip-trigger fires post-cutover, open a focused decision (sidecar layer + profile evidence first) — do NOT reopen as a wholesale rewrite. If the per-agent-bot vision ships at scale and profiling shows the event loop as the ceiling, the file-bus-scanner sidecar is the first move, not a daemon port.
