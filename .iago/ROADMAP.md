# Roadmap — iaGO-OS v2

_Derived from `docs/specs/iago-os-v2-vision.md` § Phase Sequencing. Status as of 2026-06-02._

---

## Status legend
- ✅ DONE — merged to main, verified
- 🔄 IN FLIGHT — executing now
- ⏳ NEXT — planned, not yet started
- 🟡 DEFERRED — demand-triggered or trailing

---

## Pre-cutover gates

Three non-negotiable gates before Stage D (OpenClaw cutover):

| Gate | Status | Detail |
|---|---|---|
| **R1** — Agents never hold secrets; daemon makes all privileged calls | ✅ DONE | PR #84 merged 2026-06-02 — R1 daemon-creds rework; security confirmed by dual-adversarial security lens |
| **G3** — At-rest secret encryption (systemd `LoadCredential`/tmpfs) | ⏳ NEXT | Strict unit sandboxing (`NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`); lands in Phase 3 cred-bootstrap PR alongside Sentry/PostHog env vars |
| **daemon-recovery-hardening** | 🔄 IN FLIGHT | `.iago/plans/feature-daemon-recovery-hardening/01-recovery-hardening.md` — 8 tasks executing post-#87 merge; covers Task 1 `registerAgent` durability hole (Critical, escalated 2026-06-02), Tasks 2-5 Important/Minor, Tasks 6-8 deferred from PR #84 dual-adversarial gate (result-envelope run-correlation, bounded PR-fetch body, cron×heartbeat double-restart race). Must land before cutover. |

---

## Phases

### Phase 0 — VPS audit ✅ DONE
**Goal:** Read-only inventory of OpenClaw + VPS health baseline before touching daemon code.
**Key artifact:** `runtime/migration/00-vps-audit.md` — OpenClaw inventory, Tailscale/systemd health, active dependencies.
**Exit criterion:** Inventory written; no destructive ops.

---

### Phase 0.5 — Orphan cleanup ✅ DONE
**Goal:** Stop stranded services (`iaguito-hq.service`, pulsara vite), install ufw default-deny + Tailscale-only SSH inbound, close the public-exposure window.
**Key plan:** `.iago/plans/feature-v2-foundation/02-orphan-cleanup.md`
**Exit criterion:** `ufw status` shows default deny; only Tailscale SSH reachable; no stray processes.

---

### Phase 1 — Daemon skeleton (local) ✅ DONE
**Goal:** `runtime/` directory with full daemon foundation running on Santiago's Windows box (not VPS). Hello-world end-to-end: register one Claude Code agent, claim a task, receive Telegram approval, agent proceeds.
**Key work (7 plans / 43 tasks):** `AgentRuntime` interface + registry + Shape 1 PTY Claude adapter + agent-manager (crash markers, multi-org cascade, multi-restart guard) + O_EXCL file-bus (atomic rename, orphan recovery) + `session.jsonl` two-phase replay + heartbeat health checks + subagent spawn semantics + Telegram approval handshake + cron-scheduler + IPC server skeleton.
**PRs:** #60/#61/#62/#63/#64/#65 and subsequent Phase 1 PRs.
**Exit criterion:** Hello-world end-to-end on localhost; all tests green.

---

### Phase 1b — May-12 punch list ✅ DONE
**Goal:** Four correctness fixes independent of the daemon build: `CLAUDE_CODE_SESSION_ID` instrumentation (dashboard join key), learnings write path, dirty-branch guard, adversarial fallback parser fix.
**PRs:** Part of Phase 1 / early Phase 2 merge sequence.
**Exit criterion:** 4 of 6 punch-list items shipped; Routines migration dropped (BIND-NOT-VIABLE); n8n flag deferred.

---

### Phase 2 — VPS install alongside OpenClaw 🔄 IN FLIGHT (~80%)

**Goal:** `iago-os-v2-daemon.service` running on VPS in parallel with OpenClaw; one real workflow migrated; no OpenClaw impact.
**Effort:** 2-3d.
**Merged PRs (12/15):** #60/#61/#62/#63/#64/#65/#67/#68/#72/#74 (Plan 04b)/#76 (Plan 04d)/#80 (Plan 04d extension).

**Remaining work:**
1. **PR #84** — R1 daemon-creds rework ✅ merged 2026-06-02 (Santiago confirmed merge).
2. **`feature-daemon-recovery-hardening`** 🔄 — 8-task plan executing now (Tasks 1–8, `.iago/plans/feature-daemon-recovery-hardening/01-recovery-hardening.md`); blocks cutover.
3. **Phase 2 acceptance gate (05a/05b)** ⏳ — evidence template + checker + E2E test harness; not yet started. Gate for `/iago-verify phase-2-vps-bootstrap`.

**Exit criterion:** `/iago-verify phase-2-vps-bootstrap` passes; acceptance gate evidence for Plans 05a + 05b written; dual-adversarial clean on recovery-hardening PR; all pre-cutover gates satisfied.

---

### Phase 3 — Shape expansion (PTY ×3 + HTTP/SDK + MCP-as-agent) ⏳ NEXT
**Goal:** Multi-model cohabitation via four new runtime adapters + the model-independence layer.
**Effort:** 7-10d.
**Depends on:** Phase 2 stable.
**Key plan stacks (CONTEXT.md files written, plan files pending):**
- `feature-v2-per-agent-bots/` — per-agent Telegram bots for standing agents (ADR 2026-05-30); chief bot for ephemeral workers
- `feature-v2-supervisor-role/` — `role:"chief"` config flag + file-bus producer-capability gate
- `feature-v2-agent-comms-channel/` — typed `{v,kind,from,to,body,threadId,seq,needsApproval,quality_signal,createdAt}` envelope on the existing file-bus; `produceToPeer()` mirroring `cron-scheduler.ts:fire()`; `comms/<date>.ndjson` durable log
- `feature-v2-shape2-langchain-home/` — Shape 2 `anthropic-sdk` + `openai-sdk` adapters; LangGraph workflows run as HTTP-shape host scripts

**New adapters shipping in Phase 3:**
- Shape 1 (PTY): `codex-pty`, `gemini-pty`, `opencode-pty`
- Shape 2 (HTTP/SDK): `anthropic-sdk`, `openai-sdk`
- Shape 3 (MCP-as-agent): `hermes-mcp`

**Model-independence layer (CEO direction 2026-06-02, elevated to top Phase-3 priority):** provider routing (odysseus `llm_core`/`endpoint_resolver`/`model_discovery` concepts ported as TS skills behind existing `AgentRuntime` interface); Shape 2 OpenAI-compatible adapter unlocks OpenRouter + local models (ollama/vLLM); dead-host cooldown + Tailscale-DNS fallback. See `docs/specs/iago-os-v2-vision.md` § Model Independence.

**G3 pre-cutover gate lands here:** systemd `LoadCredential=` strict sandboxing + Sentry/PostHog credential provisioning.

**Exit criterion:** All 5+ new adapters registered; cross-runtime agent-message delivered (codex→claude via file-bus); model-independence routing layer running; G3 gate satisfied; Phase 2 still stable.

---

### Phase 3.5 — Inter-agent comms channel ⏳ NEXT (folded into Phase 3 delivery)
**Goal:** Chief-role agents can write typed envelopes; workers claim them; comms NDJSON renders in dashboard.
**Depends on:** Phase 3 supervisor-role + file-bus stable.
**Key plan:** `feature-v2-agent-comms-channel/` (2–4 plans).
**Exit criterion:** Envelope spoof-prevention (server-stamped `from`); worker rejects production from non-chief; cross-runtime delivery works; `comms/<date>.ndjson` non-empty; ≥80% line coverage.

---

### Phase 4 — Wedge J shell-hook matchers ⏳ NEXT
**Goal:** Regex + timeout on event hooks; generalized Hermes hook-matcher cross-shape (routes PTY exit, HTTP error, webhook arrival, MCP sampling event, cron tick to handler scripts).
**Effort:** 1d.
**Depends on:** Phase 2 stable.
**Exit criterion:** Hook matcher regex + timeout working; at least one cross-shape route tested.

---

### Phase 5 — Wedge B distiller + Hermes-deeper bundle ⏳
**Goal:** Stage compression for long-running sessions + Hermes full compression impl (sliding-window summarizer, `threshold:0.50`, `target_ratio:0.20`, `protect_last_n:20`) + MCP rate-limiter (token-bucket per MCP server) + generalized shell-hook event router.
**Effort:** 4-5d.
**Depends on:** Phase 3 + 4.

---

### Phase 6 — Full Next.js dashboard ⏳
**Goal:** Full cortextOS Next.js port: agent list across all 5 shapes (per-shape filters), current state, recent activity, token spend per agent/project/model/shape, intervention controls. Three read-only tabs: **Comms** (tail of `comms/<date>.ndjson`), **Board** (kanban over `tasks/{pending,claimed,resolved}/`), **Workflows** (cron registrations + last-fire telemetry). `feature-v2-dashboard-comms-kanban-tabs/` CONTEXT written.
**Effort:** 8-10d (+ 2-3d for the three read-only tabs).
**Depends on:** Phase 3 stable.
**Exit criterion:** Dashboard live on VPS; all 5 agent shapes represented; comms/board/workflows tabs rendering from live state.

---

### Phase 7 — OpenClaw cutover + cleanup ⏳
**Goal:** All workflows on v2 daemon, OpenClaw stopped, state archived (30-day retain).
**Effort:** 1d.
**Depends on:** Phase 6 stable + Santiago green-light.
**Pre-conditions:** All pre-cutover gates satisfied (R1 ✅, G3, daemon-recovery-hardening).
**Exit criterion:** `iaguito-hq.service` (or OpenClaw equivalent) stopped; no traffic to OpenClaw; v2 daemon handling all production workflows; `runtime/migration/D-cutover-complete.md` written.

---

### Phase 8 — Cost ledger (SQLite) 🟡 DEFERRED
**Goal:** Per-agent cost tracking + hard pause when budget breached; integrates with `AgentRuntime.costTap()`.
**Effort:** 2d.
**Trigger:** First API-billing client moves from Claude Max flat-rate to API billing.

---

### Phase 9 — Webhook surface + Shape 4 (Webhook/event) ⏳
**Goal:** HMAC webhook receiver → daemon trigger → event-shape adapter spawn; bounded queue (1000 events/source, 5 concurrent workers/source); `event_dedupe` SQLite table prevents double-processing; dead-letter queue at `events/dead-letter/`.
**Effort:** 3-4d.
**Depends on:** Phase 7 stable.

---

### Phase 10 — Auto-PR loop end-to-end ⏳
**Goal:** Sentry → daemon → file-bus task → event-shape agent → pipeline → PR loop wired end-to-end.
**Effort:** 1d.
**Depends on:** Phase 9 webhook surface live.

---

### Phase 11 — Email auto-provision + Shape 5 (Daemon) 🟡 DEFERRED
**Goal:** Per-agent email address via SES subdomain catch-all + IMAP polling. IMAP poller is the first Daemon-shape agent (`imap-daemon`), completing Shape 5 of the registry.
**Effort:** 2-3d.
**Depends on:** Phase 7 stable.

---

### Phase 12 — Learning loop pattern extraction 🟡 DEFERRED
**Goal:** Pipeline pattern-extraction stage writes to `.iago/learnings/patterns.md`; 5+ occurrences → CLAUDE.md promotion via daemon-managed PR. odysseus `skills_routes.py:_audit_one_skill` student/teacher/verifier loop ported as TS behind the pipeline interface (no write-straight-to-disk; all through review pipeline).
**Effort:** 1d.
**Depends on:** Phase 6 stable.

---

## Odysseus cherry-pick backlog (not a phase — fold into relevant phases)

Tier-1 security patterns fold into Phase 2/3 daemon-creds workstream. Other tiers are Phase 3+ features. See `.iago/research/2026-06-02-odysseus-clone-eval.md` for the full priority-ordered backlog. Language verdict: TypeScript through cutover; golang sidecar only if flip-triggers fire post-cutover. See `.iago/decisions/2026-06-02-model-independence-and-golang.md`.

---

## Sequence diagram (cutover path)

```
Phase 0/0.5 (done) → Phase 1/1b (done) → Phase 2 (IN FLIGHT ~80%)
  → daemon-recovery-hardening (IN FLIGHT)
  → Phase 2 acceptance gate 05a/05b (NEXT)
  → /iago-verify phase-2-vps-bootstrap
  → Phase 3 (shape expansion + model-independence layer + G3 gate)
  → Phase 4 (hooks)
  → Phase 5 (distiller)
  → Phase 6 (dashboard)
  → Phase 7 (OpenClaw CUTOVER ← human-triggered)
  → Phase 8/9/10/11/12 (demand-triggered or trailing)
```
