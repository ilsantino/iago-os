---
name: iago-os v2 agent-OS vision (LOCKED 2026-05-13)
description: iago-os is being rebuilt as a multi-agent OS (Telegram-controlled, Hostinger VPS + Tailscale runtime, cortextOS/Hermes/Paperclip adoption); supersedes the 2026-04-28 "Claude Code config layer" framing
type: project
originSessionId: f67f8e4e-ccef-4f01-9b2f-792dbd289bed
---
iago-os v2 is an active build, not a deferred concept.

**Vision (locked 2026-05-13):** Agent OS for multi-agent orchestration with phone control.

**5 layers:**

1. **Runtime substrate** — Hostinger VPS + Tailscale mesh. **Replaces OpenClaw** (current production runtime; OpenClaw installation gets deleted from VPS).
2. **Agent execution** — multiple agents cohabit and coordinate. cortextOS pattern: persistent PTY sessions, file-bus coordination, multi-model (Codex + Claude side by side, not one-or-the-other).
3. **Control plane** — Telegram is primary phone control surface (start/stop/inject/approve/abort agents from anywhere). Hermes gateway pattern, scoped to TG first; Slack/etc only on real demand.
4. **Dashboard** — web UI for live agent state, token spend, session threads, intervention. Inspiration: cortextOS Next.js dashboard + Hermes Agent View + agentic-os-dashboard MCP-health pattern.
5. **Pipeline (kept from current iago-os)** — cross-model Codex review, severity floors, secret-exclusion staging, skill routing. This is the existing moat — preserve, do not rewrite.

**Why:** Santiago explicit 2026-05-13. Multi-agent orchestration + phone control + runs on owned VPS. Prior council "defer until Sebas reads MWP / MUNET ships" gate is dismissed: MUNET is stalled; Sebas will be informed but not blocking.

**How to apply:**
- Every iago-os work session anchors to this vision FIRST. Do not default to old "Claude Code config layer" framing.
- Wedges J/B/K/L stay in scope but reinterpreted: foundation blocks for agent OS, NOT Claude Code config polish.
- Wedge F (Telegram) promotes from week-6 stretch to load-bearing control plane — top priority once foundation lands.
- Wedge H (webhooks) becomes load-bearing for VPS event triggers + control-plane callbacks.
- May-12 punch list (4.5d) is still valid as cheap wins — but DROP the "delete --n8n flag" item (n8n may return as VPS trigger plumbing). Agent View instrumentation explicitly serves the dashboard layer.
- Canonical anchor going forward: `docs/specs/iago-os-v2-vision.md` (written 2026-05-13). Reads first every session.
- Reopened decisions: Paperclip adoption (was DEFER), cortextOS heavy adoption (was cherry-pick), agentic-os-dashboard patterns (was patterns-only).

**OpenClaw migration note:** OpenClaw is currently running on the Hostinger VPS. Migration plan: delete OpenClaw installation, install iago-os v2 runtime in its place. Same VPS, same Tailscale mesh — greenfield software, existing infra. Sequencing TBD in v2 vision doc.
