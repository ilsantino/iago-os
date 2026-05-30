# cortextOS Comms-Tab Gap Analysis — iago-os v2 Alignment

**Date:** 2026-05-29
**Author:** Synthesizer (Claude Opus, iaGO orchestration)
**Status:** DECISION ARTIFACT — supersedes (by dated amendment, not deletion) the locked anti-scope stances at `docs/specs/iago-os-v2-vision.md:476/254/256`, `docs/specs/iago-os-v2-master-prompt.md:177`, and refines (KEEPS) the one-bot decision at `vision.md:484` / `master-prompt.md:428`, per Santiago direction 2026-05-29. **Pending Santiago re-lock before any plan executes.**
**Doc routing:** research/decision artifact → `.iago/research/` per CLAUDE.md.

---

## 1. Trigger

Santiago surfaced a 76s cortextOS author walkthrough and directed: *"transcript the video, see wtf we need to do and how we should alter plans to implement into our own version of iago-os-v2... i want langchain, codex and claude code agents (even more) to be able to co-exist and communicate within our system as the video mentions... each one should also be able to get their own telegram bot (even though we are going to have one or multiple orchestrator agents - like chief agents or something)."*

Three of his asks collide with locked v2 decisions. Per CLAUDE.md's context-hygiene clash rule, the conflicts are surfaced as explicit decisions here, not silently implemented.

## 2. Video transcript (verbatim)

> Found the ultimate way to use Claude Code and Codex together. I just spun up my first Codex agent in my custom agent management system called Cortex OS. As you can see, I have a bunch of Claude Code agents already running and now they have a Codex friend. My Codex agent is actually messaging my Claude Code agent. Here you can see the Codex agent actually messaging one of my Claude Code agents in the comms tab that shows all the agent-to-agent communications. My system Cortex runs both Codex agents and Claude Code agents in a persistent 24-7 daemon. So the sessions always stay alive so they can all talk to each other. Because of that 24-7 daemon, I have a workflows tab that actually has cron jobs running in that daemon that can inject prompts at any time throughout the day into both my Claude Code agents and my Codex agents side by side. I can talk to all of these agents including my Codex agents and my Claude Code agents all through Telegram. Both Codex and Claude Code agents all share the same task kanban boards. They can all assign each other tasks and work on tasks throughout the day to push them from assigned to completed. My Codex and Claude Code agents together have built me full analytics software for all of my businesses. They've automated my full email outreach pipeline with nice analytic dashboards and they monitor and help me iterate on all of the open source GitHub repos that I maintain. You can see all of my community PRs here. If you want to install the system to use Codex and Claude Code agents remotely from your phone with 24-7 persistent sessions, the full install for Cortex-OS is hosted in my school community.

## 3. Extracted video features (architectural vs use-case)

| # | Feature | Category | Architectural |
|---|---|---|---|
| 1 | Heterogeneous cohabitation (Claude + Codex side by side) | cohabitation | yes |
| 2 | Spin up a new agent on demand | control | yes |
| 3 | Multiple concurrent same-type agents | cohabitation | yes |
| 4 | Agent-to-agent messaging | comms | yes |
| 5 | Cross-runtime messaging (Codex→Claude) | comms | yes |
| 6 | Comms tab (UI of all agent-to-agent comms) | dashboard | yes |
| 7 | Persistent 24/7 daemon | scheduling | yes |
| 8 | Always-alive sessions | cohabitation | yes |
| 9 | Daemon-as-precondition for comms | comms | yes |
| 10 | Workflows tab (scheduled-job UI) | dashboard | yes |
| 11 | Cron jobs inside the daemon | scheduling | yes |
| 12 | Scheduled prompt injection into running sessions | scheduling | yes |
| 13 | Prompt injection targets both runtimes | scheduling | yes |
| 14 | Telegram as unified control plane | comms | yes |
| 15 | Telegram reaches every agent type uniformly | comms | yes |
| 16 | Shared task kanban boards | scheduling | yes |
| 17 | Kanban board UI | dashboard | yes |
| 18 | Agents assign tasks to each other | comms | yes |
| 19 | Tasks progress assigned→completed autonomously | scheduling | yes |
| 20 | Task lifecycle (assigned→completed) | scheduling | yes |
| 21 | Agents built business analytics software | use-case | no |
| 22 | Automated email outreach + dashboards | use-case | no |
| 23 | Monitor/iterate on OSS GitHub repos | use-case | no |
| 24 | Community PRs view | dashboard | no |
| 25 | Remote operation from phone | control | yes |

## 4. Gap table (feature | v2 status | verdict)

| Feature | v2 Status | Verdict |
|---|---|---|
| Cohabitation (Claude + Codex + LangChain) | Planned-unbuilt (Phase 3) | Build as-planned; pull LangChain to first-class. No spec change. |
| Spin up agent on demand | Built (host N agents) | Covered; second adapter (codex-pty) gates the literal demo. |
| Multiple concurrent same-type agents | Built | Covered. |
| Agent-to-agent messaging | Triple-locked forbidden | REAL GAP — build as typed file-bus envelope (no broker). Refine the lock. |
| Cross-runtime messaging (Codex→Claude) | Not-in-scope | Free once envelope layer + codex-pty exist. |
| Comms tab | Not-in-scope (no dashboard) | DEFER to Phase 6; tail comms/<date>.ndjson. |
| 24/7 daemon | Built | Covered. |
| Always-alive sessions | Built (replay + heartbeat) | Covered. |
| Cron jobs in daemon | Built | Covered. |
| Scheduled prompt injection | Built (fire→pending→send) | Covered. |
| Workflows tab | Not-in-scope | Add list-crons IPC + tab in Phase 6. |
| Telegram control plane | Built (one bot) | Covered. |
| Telegram reaches all agents | Built (per-agent addressing) | Covered. |
| Shared task board (substrate) | Built (file-bus) | Covered as data; viz missing. |
| Kanban board UI | Not-in-scope | DEFER to Phase 6; 3-column view over file-bus. |
| Agents assign each other tasks | Not-in-scope | REAL GAP — same envelope layer (kind:task-assignment), chief-gated. |
| Tasks progress assigned→completed | Lifecycle built; producer unbuilt | Needs producer path + board view. |
| Chief/orchestrator tier | Not first-class; latent in spec; spawnSubagent built | REAL GAP, cheap — role flag, NOT a new shape, NOT a reversal. |
| Per-agent Telegram bots | Locked AGAINST | KEEP lock; identity via sticky /agent + optional topics; tokens = hard NO. |
| Remote from phone | Built | Covered. |
| Business analytics software | Not-in-scope | DROP — product, not infra. |
| Email outreach pipeline | Not-in-scope | DROP — lead-hunt/Apollo owns this. |
| GitHub PR monitoring | Built (pr-triage) | Covered; finish Plan 04d dispatch loop. |
| Community PRs view | Not-in-scope | DEFER (low priority). |

## 5. Decision reversals / refinements (with rationale)

### 5.1 Agent-to-agent comms — REFINE, not reverse (skeptic verdict: file-bus-layer-sufficient)

**Old (locked 2026-05-15):** `vision.md:476` / `master-prompt.md:177` — "No pub/sub broker, no agent-to-agent direct messaging, no ACP-style protocol. Inter-agent coordination is file-bus only."

**New (2026-05-29):** The ban stays on a *separate transport* (broker / socket bus / ACP wire protocol). It is refined to PERMIT agents as **file-bus producers**: a `role:"chief"` agent may write a typed **council-hardened envelope** `{v, kind:"agent-message"|"task-assignment", from, to, body, threadId, seq, needsApproval, quality_signal, createdAt}` into `tasks/pending/<toAgentId>__<uuid>.json` (mirroring `cron-scheduler.ts fire()` at lines 653-662), claimed via the existing O_EXCL primitive, logged append-only to `comms/<date>.ndjson`. Spend/prod sends gate through the existing `approval-bus.ts` handshake. Cross-runtime is free (file-bus is runtime-agnostic).

Three fields beyond the original four were added by the 2026-05-29 council (see §10): **`v`** = envelope schema version (the envelope is a public contract if this ever ships to a client — version it from day one); **`seq`** = monotonic per-thread sequence (the file-bus has NO ordering primitive — delivery order is otherwise filesystem/mtime-dependent, silently breaking multi-step A→B→C chains); **`quality_signal`** = nullable rating slot so `comms/<date>.ndjson` is a ready-to-use training corpus, not just a debug log. **`from` is server-stamped** (an agent cannot spoof the originator), and chief authority is **structurally enforced via a signed envelope (HMAC) or separate process identity — NOT a prompt-assertable config flag** (a hallucinating/compromised worker would otherwise self-assert `role:"chief"`). Per the council this signing is a **BLOCKER, not hardening** — it ships before the chief's first peer dispatch, because it is the authority boundary of the whole system.

**Rationale (verified on disk):** The "agents may not be producers" rule the first pass claimed to reverse does not exist in the spec — it was an inference from the current build, where only cron + Telegram happen to be producers. `master-prompt.md:62` already contemplates agent-producers ("the supervisor agent dispatches; specialists claim and execute"). The lock was written to kill the OpenClaw ACPX broker, not file reads/writes. This is a one-clause scope clarification, not an architecture reversal. No broker, no Postgres.

### 5.2 One Telegram bot — KEEP the lock (cheaper path exists)

**Old (locked 2026-05-13):** `vision.md:484` / `master-prompt.md:428` — one bot, per-agent file-bus tagging; per-agent tokens rejected for ops overhead at 3-person scale.

**New (2026-05-29):** Lock KEPT. Per-agent identity delivered via (a) sticky `/agent <id>` default-target (ship now, ~0.5d, private-chat gate untouched) and/or (b) OPTIONAL Telegram forum-topics (one supergroup, `message_thread_id ↔ agentId` binding) — gated on a separate decision because topics reopen the PR45 private-chat-only security gate (`bot.ts:306`). Per-agent bot TOKENS remain a hard NO.

**Rationale:** The video does NOT show per-agent bots — the author explicitly uses ONE bot. Per-agent tokens reintroduce the HTTP-409 single-polling-client hazard (`bot.ts:272`) × N, plus N LoadCredential secrets + N allowlists — the exact tax the lock rejected. The skeptic flagged a cost the first pass missed: forum-topics require a supergroup, reopening the group-chat-hijack gate PR45 closed. The sticky default-target delivers ~80% of the felt-experience at zero security cost.

**REVERSED 2026-05-30 (post-council evidence — Santiago LOCKED).** §5.2 is superseded. Decision = per-agent bots for standing agents + one chief/orchestrator bot for ephemeral workers & broadcast. The 'cheaper path' reasoning above relied on the HTTP-409 contention claim, which is FALSE for N distinct tokens (409 only fires for two pollers on ONE token). The cortextOS reference impl uses per-agent bots (README 'Add Telegram credentials for each agent'; per-agent PM2 process + per-agent `BOT_TOKEN`), confirmed by a screenshot of separate per-agent chats + BotFather. Security improves (per-agent private DMs keep the private-chat gate closed; forum-topics dropped). Cost: N one-time BotFather registrations + N tokens via per-agent `LoadCredential=`. Ephemeral workers report through their chief's bot. See §10 + ADR `.iago/decisions/2026-05-30-per-agent-bots-and-chief-tier.md`.

### 5.3 Chief / orchestrator tier — NOT a reversal (implement latent spec)

**Old:** No chief tier as a first-class concept; Paperclip org-chart/titles explicitly NOT adopted (`vision.md:74`).

**New (2026-05-29):** A "chief" is a `role:"chief"` config flag on a normal agent (any shape) granting the file-bus producer-capability. NOT a new AgentRuntime shape, NOT an orchestrator daemon, NOT titled hierarchy. `spawnSubagent` + parent-child linkage + cost-rollup + cascade-shutdown are already built (`agent-manager.ts:529-615`).

**Rationale:** `master-prompt.md:62` already names the supervisor-dispatch pattern, and the 2026-05-15 ADR adopted subagent spawn semantics in Phase 1. This is latent spec, not net-new architecture. Keeping it a mechanical capability flag respects the explicit Paperclip rejection. Top-down daemon-gated dispatch is asymmetric and distinct from the banned symmetric peer messaging.

## 6. Proposed designs (summary)

- **Comms channel:** new `runtime/daemon/peer-bus.ts` `produceToPeer()` mirroring `fire()`; typed envelope on the existing bus; `comms/<date>.ndjson` durable log; approval-gated spend/prod sends; delivery via the existing `AgentRuntime.send()`. (New Phase 3.5, 4-6d.)
- **Supervisor/chief role:** `role` field + daemon-gated `enqueueTask` guard (supervisor-only + same-org validation); result-merge injects worker summaries back to the supervisor on task-resolved; reuses spawnSubagent + cost-rollup. (Phase 3, 3-4d.)
- **Shape 2 / LangChain home:** `runtime/agent-runtime/http/anthropic-sdk.ts` + `openai-sdk.ts` + one runnable LangGraph host-process example. (Phase 3, first-class, 4-6d.)
- **Dashboard tabs:** Comms (tail NDJSON) + Board (kanban over file-bus) + Workflows (cron registrations) + `list-tasks`/`list-crons` IPC. (Phase 6 increment, 2-3d.)
- **Per-agent identity:** sticky `/agent <id>` default-target now (~0.5d); forum-topics gated on a separate decision.
- **Dropped from the video:** business-analytics software, email-outreach product (out of v2 scope).

## 7. Ordered plan-change list

1. **Approval gate** — Santiago re-locks §5.1 (comms refine), confirms §5.2 (one-bot KEEP) and §5.3 (chief = role flag). No plan executes before this.
2. **Apply doc amendments** (additive, dated) to `vision.md`, `master-prompt.md`, `feature-v2-phase-1-daemon/CONTEXT.md`; append ADR addendum to `.iago/decisions/2026-05-15-agent-shape-taxonomy.md`; create `.iago/decisions/2026-05-29-per-agent-identity-and-chief-tier.md`; add STATE.md row.
3. **Ship now (no lock dependency):** sticky `/agent <id>` default-target — `/iago-quick` or `/iago-fast`.
4. **Phase 3:** `feature-v2-shape2-langchain-home` + `feature-v2-codex-cohabitation` (cohabitation — no spec change) + `feature-v2-supervisor-role`.
5. **Phase 3.5:** `feature-v2-agent-comms-channel` (after a second runtime exists).
6. **Phase 6:** `feature-v2-dashboard-comms-kanban-tabs` (folds into the dashboard build).

## 8. Risks

- Both lock touches (§5.1, §5.2/topics) MUST be Santiago-approved before execution (CLAUDE.md clash rule + memory `feedback_iago_v2_overrides_council`).
- Autonomous agent-to-agent dispatch without the approval gate is a budget/runaway-loop hazard — the `needsApproval` gate + Phase 8 cost-ledger hard-pause must ship with/before broad enablement.
- Cross-shape fairness (Open-Q11) becomes load-bearing once agents are producers — per-agent inbound quota is in-scope, not deferred.
- Scope-creep toward a real broker under the "dopest shit" framing — hold the line at file-bus envelopes.
- Forum-topics reopen the PR45 private-chat-only security gate — highest-risk part of the per-agent-identity work; surface explicitly before building.

## 9. Sources

- `docs/specs/iago-os-v2-vision.md` (lines 254, 256, 476, 484, 74, 443, 255, 248)
- `docs/specs/iago-os-v2-master-prompt.md` (lines 62, 94, 177, 293-295, 307-308, 428)
- `.iago/decisions/2026-05-15-agent-shape-taxonomy.md`
- `runtime/daemon/cron-scheduler.ts` (fire(), 653-662), `runtime/daemon/file-bus.ts` (O_EXCL + atomicRenameStaleDest + validateAgentId), `runtime/daemon/agent-manager.ts` (spawnSubagent 529, getCostSummary 605), `runtime/telegram/bot.ts` (272 polling-error, 306 private-chat gate), `runtime/telegram/commands.ts` (per-agent addressing), `runtime/daemon/telemetry.ts` (NDJSON pattern)

---

## 10. Council ratification (2026-05-29) — `/council` run on the Telegram-presence + comms decision

Santiago challenged the per-agent-bot call ("doesn't he say each agent gets a bot?") and asked for a `/council` to settle the architecture. 5 advisors (Contrarian, First-Principles, Expansionist, Outsider, Executor) → anonymized peer-draft revision → 3 peer reviews → Opus chairman synthesis. Obsidian transcript: `decisions/2026-05-29-iago-v2-telegram-comms-council.md`.

**Transcript correction:** the cortextOS clip never says "each agent gets its own bot" — the only Telegram line is *"I can talk to all of these agents… all through Telegram"* (one bot). Per-agent bots are Santiago's aspiration, not a demo feature. The council optimized for BEST, not demo-fidelity.

**Unanimous verdict (5/5):**
- **(A) Telegram presence = Option A** — ONE bot + per-agent identity (sticky `/agent <id>` + Telegram forum-topics, one thread per agent). The Expansionist abandoned Hybrid mid-deliberation. Per-agent bot TOKENS rejected on **correctness** (N long-poll clients → guaranteed HTTP-409 contention) + ops tax (N secrets, N×M permissions) — worse when sold to a client with 8 agents.
- **(B) Comms substrate = file-bus envelope, no broker** (5/5). SQLite-queue pivot rejected (O_EXCL already gives atomic claims).
- **Chief auth = signed/structural, and it is a BLOCKER** (4/5 blocker, 1 "before-scale") — ships before the first chief dispatch.

**Santiago's "each agent gets its own bot" — intent honored, implementation overturned.** The desire (each agent feels like a separate, individually addressable mind) is correct and fully delivered by per-agent identity on one bot: `🧠 Claude-Orchestrator` and `🔧 Codex` are distinct threads you each talk to — experientially identical to per-agent bots, none of the contention/secret-sprawl. **Tripwire that flips to real per-agent tokens:** a paying client wants a standalone, separately-branded bot for *their own staff* (their Telegram, not iaGO's control plane) — then it's a billable product feature, not internal debt.

**Three blind spots the council caught (all 5 advisors missed solo; folded into the design above + the CONTEXT decided-constraints):**
1. **Stale-lock / dead-agent recovery** — an O_EXCL-claimed task whose worker crashes is never reclaimed. *The most likely file-bus failure at 3-person scale* — more likely than the 409 contention everyone fixated on. Requires task TTL + reclaim sweep, day one.
2. **Message ordering** — no ordering primitive on the file-bus → the `seq` field (added to the envelope above).
3. **Envelope versioning** — public-contract risk if it ships to a client → the `v` field (added above).

**First action (council "one thing to do first"):** the Telegram **forum-TYPE supergroup precheck** — create a fresh Forum-type supergroup and confirm programmatic per-agent topic creation. You CANNOT convert an existing group, so this one binary fact decides threads-vs-sticky-`/agent`-only. Everything else is downstream.

**Voting record:** Q1 presence A/B/C → A,A,A,A,A · Q2 comms file-bus/broker → file-bus ×5 · Q3 chief sign/flag → sign ×5 · Q4 sign blocker/harden → blocker,blocker,before-scale,blocker,hardening · Q5 forum-type hard-prereq → yes,abstain,yes,yes,yes.

**Post-council correction (2026-05-30).** The council's (A) verdict and the 'transcript correction' above are SUPERSEDED by evidence Santiago supplied after the council ran: a video frame + the cortextOS repo. cortextOS DOES give each agent its own bot (README 'Add Telegram credentials for each agent'; per-agent PM2 process polling its own `BOT_TOKEN`; screenshot of separate per-agent chats + BotFather). The council's anti-per-agent-bot argument (HTTP-409 contention) was technically flawed — 409 only occurs with two pollers on the SAME token, not across N independent tokens. FINAL DECISION (Santiago LOCKED 2026-05-30): per-agent bots for standing agents + one chief/orchestrator bot for ephemeral workers & broadcast; forum-topics dropped (per-agent bots are private DMs, which keeps the private-chat security gate closed). The council's (B) comms verdict (file-bus envelope with seq/v/quality_signal + signed-chief-as-blocker) STANDS and was independently validated by the cortextOS repo (per-agent `inbox/` file-bus + `bus/send-message.sh` + the `comms` skill). Lesson recorded: verify a reference system's actual implementation (repo + UI) before locking a decision on a partial-transcript inference.
