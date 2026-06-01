# ADR 2026-05-30 — Per-agent Telegram bots + chief tier

_Date: 2026-05-30 | Status: **ACCEPTED — Santiago LOCKED 2026-05-30** | Authors: Claude (orchestrator) + Santiago direction_

---

## Status

ACCEPTED. Santiago LOCKED 2026-05-30. This decision supersedes the 2026-05-29 "keep one bot / per-agent tokens rejected" stance (`.iago/research/2026-05-29-cortextos-comms-gap-analysis.md` §5.2 + §10) and the council's unanimous Option-A ("one bot + per-agent identity") verdict from the same artifact.

## Context

The 2026-05-29 gap analysis and a follow-up `/council` run locked "one Telegram bot + per-agent identity (sticky `/agent` + optional forum-topics); per-agent tokens rejected." After the council ran, Santiago supplied new evidence:

1. **The cortextOS reference implementation uses PER-AGENT BOTS.** Its README says "Add Telegram credentials for each agent" — each agent has its own `.env` with its own `BOT_TOKEN`/`CHAT_ID`/`ALLOWED_USER`, and each agent runs as its own PM2 process polling its own token (`bus/_telegram-curl.sh` reads `${BOT_TOKEN}` from the agent env).
2. **A video frame + screenshot** showing separate per-agent Telegram chats (Donna, Tallybot, "Codex worker", CortextDesigner, Sentinel, Skoolio, Stephen) plus BotFather creating bots.

This contradicts the council's "transcript correction" (which claimed cortextOS uses one bot) and invalidates the central anti-per-agent-bot argument (HTTP-409 contention). The conflict is resolved here per CLAUDE.md's context-hygiene clash rule.

## Decision

- **Per-agent Telegram bots for STANDING agents.** Each long-lived agent gets its own BotFather-registered bot, its own token, and its own private DM with its single `ALLOWED_USER`.
- **One chief/orchestrator bot for EPHEMERAL workers + broadcast.** Short-lived workers do NOT get their own bot — they report through their chief's bot. The chief bot also carries broadcast/system messaging.
- **Forum-topics DROPPED.** The 2026-05-29 sticky-`/agent` + forum-topics path is no longer needed; per-agent private DMs deliver the per-agent felt-experience without reopening the group-chat surface.
- **Chief = a role flag, not a new shape.** `role:"chief"` remains a config flag on a normal agent (any `AgentRuntime` shape), granting the file-bus producer-capability. No new `AgentRuntime` shape, no broker, no titled org-chart (the Paperclip rejection stands).
- **Comms substrate UNCHANGED.** Inter-agent comms stay the file-bus envelope `{v, kind, from, to, body, threadId, seq, needsApproval, quality_signal, createdAt}` with signed-chief-as-blocker authority. This (the council's (B) verdict) STANDS — independently validated by the cortextOS repo (per-agent `inbox/` file-bus + `bus/send-message.sh` + the `comms` skill).

## Rationale

- **HTTP-409 is per-token, not global.** The 409 "terminated by other getUpdates" error fires only when TWO pollers hit the SAME token. N agents with N distinct tokens poll independently — zero collision. The one-bot premise was technically wrong.
- **Security IMPROVES.** Every per-agent bot is a private DM with its own single `ALLOWED_USER`, so the PR45 private-chat-only gate (`bot.ts:306`) stays CLOSED. It was the rejected one-bot + forum-topics path (supergroup = group chat) that would have reopened it.
- **Matches the proven reference impl.** cortextOS ships this exact pattern in production; we adopt rather than reinvent.
- **Fits the existing architecture.** N tokens store via the already-decided per-agent systemd `LoadCredential=` model (2026-05-15 ADR) — incremental, not a new mechanism.

## Consequences

- **Cost (bounded, not a blocker):** N one-time BotFather registrations (interactive) + N bot tokens persisted via per-agent `LoadCredential=`. Incremental per standing agent.
- **Ephemeral workers route via their chief's bot** — no registration for short-lived workers.
- **Standing-vs-ephemeral is a per-agent lifecycle config** — the agent config declares which tier it belongs to; the daemon provisions a bot binding only for standing agents.
- Affects Phase 3+ (Telegram control surface + multi-agent comms); **Phase 1 daemon-skeleton scope is UNCHANGED.**

## Tripwire to reconsider

If the standing-agent count grows large enough that interactive BotFather registration becomes a real operational bottleneck (e.g., onboarding dozens of standing agents), revisit a shared-bot + per-agent-identity fallback for a sub-tier of standing agents — keeping per-agent bots for the primary tier.

## Trail

- `.iago/research/2026-05-29-cortextos-comms-gap-analysis.md` §10 (post-council correction) + §5.2 (REVERSED note)
- `docs/specs/iago-os-v2-vision.md` — Amendment 2026-05-30 + Open-Questions item 2 supersede note
- `docs/specs/iago-os-v2-master-prompt.md` — Open-Questions item 2 supersede note
- `.iago/plans/feature-v2-phase-1-daemon/CONTEXT.md` — decided-constraints supersede + Amendment 2026-05-30 update
- Council transcript: Obsidian `decisions/2026-05-29-iago-v2-telegram-comms-council.md`
