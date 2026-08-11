---
name: project-iago-v2-telegram-comms
description: v2 Telegram presence + agent-to-agent comms decision — per-agent bots for standing agents + chief bot for ephemeral; file-bus comms; reverses council
metadata: 
  node_type: memory
  type: project
  originSessionId: 26de3dbd-89a6-4155-b437-2e8e2c0257e0
---

LOCKED 2026-05-30 (Santiago): iago-os v2 Telegram presence = **per-agent bots for STANDING agents + ONE chief/orchestrator bot for EPHEMERAL workers & broadcast**. This REVERSES the 2026-05-29 "keep one bot" stance AND the /council's unanimous Option-A ("one bot + forum-topics") verdict. Do not re-litigate to "one bot."

**Why the reversal:** the council's killer anti-per-agent-bot argument (Telegram HTTP-409 "terminated by other getUpdates") is **per-token** — N bots with N tokens poll independently, zero collision. cortextOS (grandamenium/cortextos — the reference impl Santiago emulates) actually uses per-agent bots: README "Add Telegram credentials for each agent" → per-agent `.env` `BOT_TOKEN`, per-agent PM2 process; confirmed by a video frame (separate per-agent Telegram chats + BotFather). Per-agent bots are private DMs (one `ALLOWED_USER` each) so the private-chat security gate stays CLOSED; **forum-topics DROPPED**. Cost: N one-time BotFather registrations + N tokens via the existing per-agent systemd `LoadCredential=` model. Ephemeral/throwaway workers route through their chief's bot (don't mint a bot per worker).

**Comms (council (B) verdict — STANDS, repo-validated):** agent-to-agent = typed file-bus envelope `{v, kind:"agent-message"|"task-assignment", from, to, body, threadId, seq, needsApproval, quality_signal, createdAt}` over the existing `tasks/` file-bus — NO broker/pub-sub/ACP. `from` server-stamped; chief authority HMAC-signed/structural (NOT a prompt-assertable config flag) and that signing is a **BLOCKER not hardening**; stale-lock TTL/reclaim + monotonic `seq` (ordering) + `v` (schema versioning) required day-one. Matches cortextOS's per-agent `inbox/` bus + `bus/send-message.sh` + `comms` skill.

**Chief tier:** `role:"chief"` config flag on a normal agent (PTY/HTTP), NOT a new AgentRuntime shape — grants file-bus producer-capability. Reuses already-built `spawnSubagent` + cost-rollup.

**Lesson:** verify a reference system's ACTUAL implementation (repo + UI) before locking a decision on a partial-transcript inference — the 76s audio said "all through Telegram" which I wrongly read as one-bot; the repo + image showed per-agent bots. Santiago was right.

Trail: ADR `.iago/decisions/2026-05-30-per-agent-bots-and-chief-tier.md`; artifact `.iago/research/2026-05-29-cortextos-comms-gap-analysis.md` §10; specs amended (vision/master-prompt/phase-1 CONTEXT). New plan stacks: `feature-v2-agent-comms-channel`, `feature-v2-supervisor-role`, `feature-v2-shape2-langchain-home`, `feature-v2-dashboard-comms-kanban-tabs` (all on branch `docs/v2-cortextos-comms-replan`, uncommitted). Related: [[project_iago_v2_vision]] · [[feedback_iago_v2_overrides_council]].
