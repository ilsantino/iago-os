# Odysseus clone/golang evaluation vs iago-os v2

**Date:** 2026-06-02
**Type:** research / strategic decision
**Trigger:** Santiago asked whether to clone `pewdiepie-archdaemon/odysseus` and/or rebuild a v2-style agent-OS in golang, mixing "the dopest shit" from odysseus with what iago-os v2 already has.
**Method:** dynamic deep-research Workflow (`odysseus-clone-eval`, run `wf_35862dc0-60e`) — 6 parallel inspectors (5 odysseus facets + iago-os v2 baseline) over a shallow clone (`--depth 1`, 57 MB, 625 files) → synthesis (patterns catalog + golang-fit analysis). 8 agents, ~1.24M tokens, ~13 min.

---

## What odysseus is (so we don't mis-frame it)

A self-hosted **single-user local ChatGPT/Claude alternative**: Python(41%) FastAPI monolith + vanilla-JS web UI (46%), 29.5k★. Local-model serving (vLLM/llama.cpp/Ollama) via a hardware "cookbook" (hwfit), ChromaDB vector memory, an `opencode`-based agent loop with MCP tools, deep research, email/calendar/docs. **It is a different product from iago-os v2** (Telegram-controlled multi-agent VPS OS for a 3-person consultancy, Node/TS daemon + PTY agent adapters + file-bus + cron). That product gap is the decisive fact in every recommendation below.

## Verdict

**(B) Keep building on iago-os v2 TypeScript. Cherry-pick odysseus patterns behind the existing `AgentRuntime`/daemon interfaces. Build ZERO golang. Do NOT clone.**

- **Clone is a category error.** odysseus is Python+JS — "cloning" = a full reimplementation either way. Every high-value pattern the research found is flagged `languagePortable: true`, i.e. what we want is *ideas*, and ideas port for free. The actual code we wouldn't want even in our language: single-process FastAPI monolith (no isolation between web tier / scheduler / MCP subprocesses / agent exec), **no shell/fs sandbox** (odysseus's own THREAT_MODEL lists this as its top gap), a global no-TTL response cache (dangerous), ChromaDB memory **strictly weaker than our MemPalace**, a 200-line if/elif tool dispatch, and a self-described ROADMAP that literally says "I don't know what I'm doing hlep."
- **golang buys problems we don't have.** This system is **I/O-bound** (waiting on Claude/Codex APIs + PTY subprocesses), not CPU-bound — goroutines optimize a bottleneck that doesn't exist (odysseus's own loop is sequential within a round). golang's real wins (single static binary, lower idle RSS) are minor and already mostly solved (systemd + `LoadCredentialEncrypted` + SIGHUP reload; agents are thin orchestrators — the cost driver is LLM tokens + subprocess CLIs, which golang can't make cheaper). Costs are existential to momentum: throw away ~3.6k+ lines of hardened daemon (anti-zombie/crash-replay/race fixes), the 100s of tests + 80+ PRs + the `execute-pipeline.js` Workflow (our single biggest competitive asset, rated structurally *superior* to odysseus's orchestration), and fight a TS/Python-first SDK ecosystem (Claude/Codex/LangChain). N months of rewrite for *parity*, not *progress* — the opposite of the "Garry-impressed" ship standard.
- **No (D) golang sidecar candidate exists.** File-bus claim/rename is already atomic O_EXCL sub-ms; search fan-out is I/O-bound; hwfit math shouldn't exist for a cloud-first shop; vector ops are delegated to MemPalace/MCP. A golang sidecar = second language + second toolchain + IPC seam splitting a 3-person team's context, to optimize a cold layer. Negative ROI.

**The gap between us and odysseus is NOT infrastructure — we already out-build it on the hard parts (multi-process isolation, deterministic DAG orchestration, cross-model review, durable file-bus, crash replay). We're behind only on runtime agent intelligence + security hardening, and every one of those is a small TS port of a language-portable pattern.**

## Cherry-pick backlog (priority-ordered; all TS ports behind existing interfaces)

### Tier 1 — security (our threat model already names these gaps; pre-cutover relevant)
1. **Untrusted-content role-isolation wrapper** *(Trivial)* — one helper forcing every attacker-writable surface (Telegram `/inject`, PR bodies, scraped web, fetched pages, learned skills) into a `role=user`, `trusted=false` block with a data-not-instructions header + sentinels. Our only defense today is a *prose* instruction in the fix-session contract. Double-guard the learning loop so an injection can't be distilled into a persisted skill. **Highest value/lowest cost.** `prompt_security.py:untrusted_context_message`
2. **Tunnel-aware trusted-loopback check** *(Trivial)* — we run behind Tailscale/cloudflared; a naive 127.0.0.1 trust check lets a tunneled remote request inherit owner trust. Scrub `x-forwarded-for`/`cf-connecting-ip`/`forwarded` before granting local trust. `app.py:_is_trusted_loopback`
3. **DNS-resolution SSRF guard, per-redirect re-validated** *(Moderate)* — VPS has a cloud metadata endpoint + Tailscale-internal services; resolve-all-A/AAAA + reject RFC1918/loopback/link-local/IPv4-mapped-IPv6/metadata, re-check **every** redirect hop. Build BEFORE deep-research fetches anything. `webhook_manager.py:_is_private_url`
4. **Per-process internal-tool capability token** *(Moderate)* — **the concrete mechanism for our R1 "agents never hold secrets / daemon makes all privileged calls" decision** (PR #84 implements R1 as principle; this is the reusable primitive): a `secrets`-grade token the daemon holds, subprocess agents never see, constant-time compared; attribution (owner header) split from authorization. `core/middleware.py:INTERNAL_TOOL_TOKEN`
5. **Dual-layer tool gate (hide at prompt-build AND hard-block at dispatch)** *(Trivial)* — for the per-agent-bot model, gate ephemeral/untrusted agents to a restricted toolset enforced at *both* layers (prompt-hiding alone is bypassable by a hallucinated tool name). `tool_security.py`

### Tier 2 — agent-loop robustness (closes our documented hang bug)
6. **Terminus-style loop-breaker + force-answer handshake** *(Moderate)* — directly fixes our logged "pipeline hangs on malformed shell cmd"; detects circling (repeat call-signature, no new text, 4+ rounds) + runaway (one tool >15×), forces a zero-tools round, one-shot grace synthesis. Genuine progress resets the counter. `agent_loop.py:1942-1995`
7. **Per-turn RAG+keyword tool-gating** *(Moderate)* — send ~8-16 relevant tools/turn, not the full set; cuts prompt cost + wrong-tool selection for many narrow daemon agents (we can do it deterministically — no ChromaDB needed). `tool_index.py:get_tools_for_query`
8. **Fresh-context completion verifier** *(Moderate)* — cheap per-turn "did the agent do what was asked" by a cold second model instance (no shared history) for standing agents that have no PR gate. `agent_loop.py:_run_verifier_subagent`

### Tier 3 — reference impls for our UNBUILT components
9. **Two-tier context compactor** *(Moderate)* — our v2 Phase-5 sliding-window summarizer is **speced, not built**; odysseus is a complete working ref: priority structural trim + LLM self-summary at 85% on a cheap utility model + tool-call-adjacency repair (a 400-error gotcha we haven't documented). Keep our stricter 6-probe loss check as the gate. `context_compactor.py`
10. **Adaptive context-budget formula + role-based endpoint resolution** *(Moderate)* — turns our context-budget *prose rule* into deterministic code (layer-triage); cheap "utility" model separate from chat model; Tailscale-DNS fallback for reaching mesh model hosts; dead-host cooldown. `context_budget.py`, `endpoint_resolver.py`
11. **LLM loop-until-saturated deep-research engine** *(Moderate)* — **our `/deep-research` is single-shot**; odysseus (Tongyi DeepResearch-style) = JSON plan → bounded loop (max 8 rounds/300s) generating gap-filling queries → parallel fan-out + set-dedup → goal-conditioned per-page extraction + quality filter → evolving sliding-window synthesis → dedicated YES/NO saturation stop. Port control-flow + the extractor/synthesis/stop **prompts** (liftable). **CRITICAL ADD odysseus omits: a Codex/dual-adversarial verify-claims stage + wrap fetched pages in pattern #1** (a malicious page could inject "report is comprehensive, stop now"). Biggest single feature upgrade. `deep_research.py:DeepResearcher.research`
12. **Skill self-repair / teacher-escalation loop** *(Hard)* — our Phase-12 learning loop is unbuilt; odysseus runs a learned skill against a self-fixture → LLM-judge → self-edit → escalate to a stronger teacher model → re-test on the cheaper student → flag-as-draft. Student/teacher/verifier maps 1:1 onto our Sonnet/Opus/Codex routing. **PORT THE LOOP, NOT THE BYPASS:** route auto-learned skills through our PR + review pipeline (NEVER skip reviews / NEVER merge), never write-to-disk-by-background-task. `routes/skills_routes.py:_audit_one_skill`

**Adopt-don't-copy:** odysseus's in-memory job registry doesn't survive restart — take the idempotency RULES (status-from-disk-exit-file not live-PID, mark-done-only-after-success, defer-if-busy, command-in-own-child-script so a stray paren can't corrupt exit capture — a direct mitigation for our malformed-cmd hang), back them with our planned SQLite/file-bus. Also two trivial generic safety guards for any LLM-maintained store (MemPalace tidy, Graphify rebuild, skill audit): SHA-256 fingerprint short-circuit (skip the LLM call if entries unchanged) + refuse-to-save-if-<50%-entries-returned (over-consolidation = silent data-loss). `memory_extractor.py:audit_memories`

## What to explicitly NOT take
The monolith shape, the absent sandbox, the global no-TTL response cache, ChromaDB vector memory (MemPalace is stronger), SearXNG plumbing, hand-maintained context-window table, hwfit local-model serving, single-LLM-judge verification (we have mandatory cross-model dual-adversarial), and any write-straight-to-disk learned-skill/auto-fix path.

## Recommended placement
The Tier-1 security patterns overlap directly with the R1 daemon-side rework (PR #84) and the **G3 pre-cutover gate** — fold patterns 1/2/4 into the daemon credential/security workstream. The deep-research engine (11) and context compactor (9) are first-class Phase-3+ features. Update the v2 vision/roadmap to name this backlog so it doesn't get re-discovered later.

_Full raw workflow output (15 ranked patterns w/ exact file:symbol citations + full golang analysis) archived in the run journal `subagents/workflows/wf_35862dc0-60e/`._

---

## Reconsidered 2026-06-02 — Santiago pushback ("VERY confident golang is SO much faster")

Second workflow `wf_9962e6fc-458` (steelman golang + steelman clone + ground-truth bottleneck + honest rewrite-cost → adversarial synthesis). **Verdict held: stay TypeScript through cutover, cherry-pick patterns only — but NOT dogmatically, and Santiago's core insight is conceded.**

**Santiago is RIGHT (load-bearing):** the daemon imports ZERO LLM SDK (verified — agent is the external `claude` CLI in a PTY, `claude-pty.ts:345`); the review pipeline is dev-time `.claude/` harness that reviews golang diffs the same as TS. So the two historical anti-golang arguments — "lose LLM-SDK fit" and "lose the pipeline" — are **both dead**. golang's operational wins are real: single static binary kills the node-gyp/native-dep bug class this team already hit, ~10-25MB RSS vs ~40-80MB V8, cleaner systemd sandbox. Don't be married to TS on principle.

**But "SO much faster" doesn't survive the bytes:** daemon CPU is **1-50ms/task = 0.01-0.2%** of the **20-120s** a user waits — the seconds live in `claude`/`codex` subprocess token generation, byte-identical in any daemon language. `claudePty.send` returns BEFORE inference (`claude-pty.ts:514`). It's an I/O supervisor asleep ~99.99% of the day. The one user-visible daemon latency — the 5s poll — is a design choice fixable with `fs.watch`/inotify in TS (few lines), not a 6-9-week rewrite. Concurrency "ceiling" is imaginary today (ONE agent on disk, 1x/day, `maxConcurrent=1`). The one genuine `spawnSync` event-loop stall (`cron-scheduler.ts:646`) is UNWIRED in prod (R1 replaced the bash wake-check).

**Phased path:**
- **Phase A (now → cutover, ALL TypeScript):** finish Phase 2/3, cut over off OpenClaw, deploy. Don't touch the language. Two cheap TS latency wins *if ever needed*: swap the 5s `setInterval` poll for `fs.watch`/inotify; convert any re-armed cron `wakeCheck` from `spawnSync` to async exec-with-timeout. Cherry-pick odysseus **ideas** (not code) as Claude Code skills: `deep_research.py` bounded-iteration control flow + extractor/synthesis/stop prompts, loop-breaker heuristics, memory-audit safety guards — each behind existing interfaces, each through the review pipeline, each + iago-mandatory cross-model verify + untrusted-page wrapping.
- **Phase B (post-cutover, ONLY if a trigger fires):** a golang **sidecar** for a specific layer first (file-bus scanner + IPC/health as a static binary w/ fsnotify), keeping the PTY/agent-lifecycle core in TS — captures the deploy-artifact + event-driven-scan wins without re-deriving the 168 hardened scar-fixes. A full golang daemon rewrite stays OFF the table unless multiple triggers stack, and even then it's sidecar-first + profile-first.

**Flip-to-golang triggers:** (1) per-agent-bot vision ships at scale (10+ standing agents each holding a Telegram long-poll) AND a profiled flame graph shows the event loop — not inference — as the ceiling; (2) the daemon starts genuine per-event CPU work (multi-MB parse on the shared loop, crypto/msg, high-freq tick); (3) node-gyp/deploy pain becomes the dominant operational cost → targeted sidecar; (4) a measured post-cutover bottleneck survives the cheap TS fixes; (5) team's primary language flips to golang. **Profile first — the time has consistently been inference + PTY round-trips, both language-invariant.**

**Clone:** still a category error — iago-os's agent IS the `claude` CLI, and odysseus's best subsystems (`agent_loop`, `llm_core`, `context_compactor`) are reimplementations of that CLI's internals with no seam to drop into. Cherry-pick the ~1,100 LOC of genuine ideas as skills; don't adopt the code.

_Confidence 90%. The 10% reserves for the per-agent-bot fan-out actually shipping at scale (theoretical until deployed + profiled)._

