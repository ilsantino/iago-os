# Research: cortextOS — should iago-os adopt it, and how?

**Date:** 2026-04-21
**Question:** Should Santiago adopt cortextOS (https://github.com/grandamenium/cortextos) on iago-os, and if so, how? Constraints: Windows 11, solo operator (no Mac mini, Sebas out of scope), existing mature iago-os stack.

---

## 1. What cortextOS actually is

One-line: **persistent 24/7 Claude Code agents controlled from Telegram/iOS, coordinated via file-based message bus, managed by PM2.**

Status snapshot (2026-04-21):
- v0.1.1, MIT, TypeScript, 20 stars / 27 forks
- Active dev (200+ open issues, commits today)
- Explicit platform note: **"macOS or Linux — Windows: not yet supported"**
- Core deps: `node-pty` (native binding), `chokidar`, `commander`, PM2 (peer), Claude Code CLI
- Vendor: Cortext LLC

Capabilities (from README + CHANGELOG 0.1.0/0.1.1):

| Capability | What it is |
|---|---|
| Persistent PTY agents | Claude Code sessions held open via `node-pty`, auto-restart on crash or 71h context rotation |
| PM2 fleet | Each agent is a PM2 process; `ecosystem.config.js` generated from configs |
| File-based message bus | `inbox → inflight → processed` atomic dir flow, priority queue, reply_to, 5-min redeliver |
| Task system | 17-field task JSON, stale/overdue detection, auto-archive, blocked-by graph |
| Event log (JSONL) | Per-agent per-day analytics stream feeding dashboard |
| Heartbeat | 60s liveness file per agent |
| Approval gate | `pending/` → `resolved/` dir flow, Telegram decision UX |
| Knowledge base | `mmrag` (ChromaDB) collections, shared-org + per-agent |
| Experiments ("theta wave") | Hypothesis → run → evaluate → manage-cycle |
| Templates | `orchestrator`, `analyst`, `agent` |
| Telegram bridge | Commands, approvals, reports via BotFather bot |
| Dashboard | Next.js 14 app |
| Agent catalog | Community skill marketplace |

---

## 2. Overlap with iago-os stack

Mapping cortextOS primitives onto what Santiago already has:

| cortextOS primitive | iago-os equivalent | Overlap |
|---|---|---|
| Task system (17-field JSON) | `.iago/plans/` + TaskCreate | **~70% overlap** — plans already have scope, status, acceptance criteria |
| Event log (JSONL) | `.iago/summaries/` + Obsidian `sessions/` digests | **~60% overlap** — session digests auto-captured by stop hook |
| Heartbeat | MemPalace diary stop hook | **~40% overlap** — diary is cross-session, not liveness |
| Approval gate | Pre-commit hooks + PR review loop (`claude.yml` + `claude-review-fix.yml`) | **~80% overlap** — PR approval is the existing gate |
| Knowledge base (mmrag/ChromaDB) | MemPalace (ChromaDB) + Obsidian + Graphify | **~90% overlap** — Santiago already runs ChromaDB over vault |
| Experiments | None | **0% — new** |
| Telegram control | None (CronCreate/RemoteTrigger exist but no chat UX) | **0% — new** |
| 24/7 persistent PTY | `autonomous-loops` skill (requires open session) + CronCreate (scheduled, not persistent) | **~30% — partial** |
| Agent-to-agent file bus | Hub-and-spoke (orchestrator dispatches, agents never spawn agents) | **0% — deliberately not there** |
| Dashboard | None | **0% — new** |
| PM2 fleet | None | **0% — new** |

**Net-new to iago-os:** Telegram control, persistent PTY sessions, file-bus multi-agent coordination, experiment loop, dashboard.

**Duplicate of existing:** tasks, KB, events, approvals, heartbeat.

---

## 3. Windows reality check

`README.md` line: *"macOS or Linux — Windows: not yet supported."*

But `install.mjs` has `IS_WINDOWS = platform() === 'win32'` branches and a documented Windows one-liner (`irm | iex`), so partial Windows path exists — it's just unblessed and not tested. `node-pty` itself works on Windows 11 via ConPTY (Microsoft actively maintains, Windows 1809+ required, WinPTY removed). So the technical blocker is soft, not hard.

What would break on Santiago's Windows 11:
- **PM2 startup**: needs `pm2-windows-startup` (extra dep, flakier than launchd/systemd)
- **Sleep/wake**: Windows sleep is more aggressive than Mac sleep; issue #204 shows the Mac version already drops crons on sleep/wake. Windows would be worse.
- **File-bus atomic rename**: cortextos relies on `rename()` semantics for atomic inbox flow. Windows `rename` doesn't overwrite existing files by default and has different concurrent-access behavior. Would need audit.
- **Shell wrapper scripts in `bus/`**: bash scripts that delegate to `dist/cli.js`. On Windows these need `.cmd` shims or WSL.
- **Chokidar FS watching**: works on Windows but uses different underlying watcher, higher latency.
- **24/7 always-on**: Santiago's machine is a personal laptop/desktop, not a server. Running cortextos on it means leaving the machine awake permanently.

Deployment options that sidestep these:
- **WSL2 on Santiago's machine** — viable. Ubuntu in WSL2 is the canonical cortextos target. Tradeoffs: machine must stay on, WSL2 memory cost, file-watching across WSL↔Windows boundary is slow (so don't cross it).
- **$5-10/mo Linux VPS (Hetzner CX11, DigitalOcean $6 droplet)** — clean. Dedicated Linux box, runs 24/7, ssh in. No Windows issues.
- **Raspberry Pi 5 / mini-PC always-on at home** — one-time $80-150, no cloud bill. Quieter than desktop.

---

## 4. BRAINSTORMING — options space

Following `/brainstorming` pattern: Socratic exploration of the option space before converging.

### Q1: What's the *actual* pain cortextos would solve for you?

You already have:
- `autonomous-loops` skill for overnight work
- `CronCreate` + `/iago-schedule` for cron jobs
- `RemoteTrigger` for remote session kickoff
- MemPalace diary for cross-session continuity
- Obsidian + Graphify for knowledge
- PR review loop for approvals
- STATE.md for session resumption

What you **don't** have:
1. **Phone-native control.** You're CEO, in meetings, often away from desk. Today, checking/approving agent work means opening Claude Code on laptop. Telegram on iPhone would change the ergonomics.
2. **Genuine 24/7 persistence.** `autonomous-loops` runs while a session is open. If you close the laptop, it stops. cortextos keeps agents alive independent of your presence.
3. **Multi-agent *parallel* coordination.** iago-os is hub-and-spoke by design (orchestrator dispatches, agents never spawn agents). cortextos is peer-to-peer via file bus. Different paradigm.
4. **Overnight experiments with auto-evaluation** (theta wave). Niche but interesting for research tasks (e.g., "try 5 prompt variants on this extraction task, pick best by F1").

### Q2: What's the cost of adopting?

- **Platform tax**: either WSL2 + leave machine on, or pay for VPS/mini-PC.
- **Duplication tax**: 60-90% of cortextos primitives (tasks, KB, events, approvals) duplicate your stack. Either you live with duplication or you fork cortextos to point at your stores, which is a maintenance burden.
- **Version risk**: v0.1.1 with 200+ open issues. Things will break and change. Your iago-os stack is stable; cortextos is not.
- **Context switch**: two sources of truth for "what agents are doing" (cortextos tasks vs `.iago/plans/`).

### Q3: What's the minimum-viable version of "I want it"?

If the only thing you really need is **"approve things from my phone"**, you don't need cortextos. You need:
- Telegram bot that posts PRs, plans, and decisions needing input
- Commands to trigger `RemoteTrigger` / `CronCreate` from chat
- That's it

Estimated build: 1-2 days with existing iago-os primitives.

### Q4: Is the multi-agent file bus actually useful for you?

Probably not — today. iago-os hub-and-spoke is deliberate (prevents orchestrator drift, agents don't spawn agents). The file bus is valuable when you have *different agents owning different domains* (sales agent, research agent, ops agent) that coordinate. You're a solo operator across a handful of clients. You don't have a fleet.

You *might* later, if you build client-facing agents (e.g., Munet support bot, scheduling bot). That's the real unlock path.

### Q5: Options space, concrete:

| Option | What | Upfront cost | Monthly cost | Net value to Santiago |
|---|---|---|---|---|
| **A — Don't adopt** | Wait for Windows support + your own needs to mature. Use autonomous-loops + CronCreate. | 0 | 0 | Low churn, no new capability |
| **B — Full adopt via WSL2** | Install cortextos in WSL2 Ubuntu. Telegram bot on iPhone. Leave laptop awake. | 1 day setup | electricity | All cortextos features, but heavy stack + Windows edge cases |
| **C — Full adopt via VPS** | Rent Hetzner CX11 ($5/mo) or DO droplet, install there, repo mirror for iago-os clients. | 1-2 days setup | $5-10 | All cortextos features + clean infra; real 24/7 |
| **D — Minimal bridge (no cortextos)** | Build small Telegram bot in iago-os that hits RemoteTrigger/CronCreate/Obsidian, adds approval UX. | 2-3 days build | ~$0 (Telegram free) | Phone control + no duplication + no version risk |
| **E — Hybrid** | Run cortextos on cheap mini-PC / VPS as "ops layer" for 24/7 monitoring + Telegram. iago-os stays on laptop for dev work. Cortextos points at same client repos. | 3-5 days setup | $5-10 | All new capabilities, no duplication in day-to-day dev workflow |

---

## 5. COUNCIL — 5 advisors + peer review + synthesis

Following `/council` pattern. Each advisor gives an opinionated verdict; then peer review; then synthesis.

### Advisor 1 — Systems Architect (coupling, dependency risk)

**Verdict: D (build bridge, don't adopt).**

cortextos is a v0.1.1 project with 200+ open issues, primary platform Mac, and explicit "Windows not supported" language. Adopting it couples your entire ops layer to an unstable upstream that will have breaking changes. 60-90% of its primitives duplicate what you already have (MemPalace, Obsidian, `.iago/plans/`, PR review loop). The 10-40% that's net-new (Telegram, 24/7 PTY, theta wave) is independently implementable on iago-os primitives in a weekend. Don't marry a v0.1 project for features you can build yourself in 3 days.

**Risk I'd flag:** atomic-rename semantics on Windows differ from POSIX. Even in WSL2, crossing the WSL↔Windows boundary for file watching is slow and has weird permission edge cases. If you adopt, go VPS, not WSL2.

### Advisor 2 — CEO / Operator (time, ROI)

**Verdict: E (hybrid, on a VPS).**

You're a CEO of a 3-person consultancy. Your time is the binding constraint. The ROI on "approve things from phone while at a client meeting" is high — it compresses your decision loop from hours to seconds. But building and maintaining your own Telegram bridge is a yak-shave. cortextos already solved it, even if imperfectly. Rent a $5/mo VPS, follow their install script, have Telegram up in an afternoon. If you hit Windows-specific bugs, skip them — you're on Linux on the VPS. You get to learn from their bus/approval UX before deciding whether to rebuild.

**Risk I'd flag:** duplication of task state. Decide upfront: cortextos tasks or `.iago/plans/`? Don't let both grow. I'd say cortextos tasks for *ops* (agent internal work tracking) and `.iago/plans/` for *engineering work* (the iago-os pipeline).

### Advisor 3 — Platform Engineer (Windows, reliability)

**Verdict: D or C.**

WSL2 is viable but brings two failure modes: (a) Windows sleep kills your 24/7 promise, (b) WSL↔Windows file boundary is slow and will surface weird `chokidar` race conditions. If you want 24/7, you need a real always-on Linux box. That's either a VPS (option C) or a mini-PC at home. If you go VPS, you get clean cortextos install; but then you're also paying bandwidth to ship data between your dev machine and the VPS.

Alternative: build option D *on* iago-os. You already have `RemoteTrigger` and `CronCreate`. Adding a Telegram bot that maps `/approve <id>` → RemoteTrigger is ~200 lines. No platform tax.

**Risk I'd flag:** cortextos issue #202 — "bus hard-restart is a no-op: writes markers but never kills PTY". That's the kind of bug that makes persistent-PTY frameworks lose you a week at the wrong moment. v0.1.1 has a lot of those.

### Advisor 4 — AI Agent Researcher (what's genuinely novel)

**Verdict: C (full adopt, VPS).**

The interesting thing in cortextos isn't the Telegram bridge — that's easy to replicate. The interesting thing is the **theta-wave experiment loop** (hypothesis → run → evaluate → manage-cycle with approval gate) and the **file-bus agent coordination pattern**. If you're going to do any multi-agent work for clients (Munet support bot, Sentria workflows, agent-based proposals), these patterns are worth studying hands-on. Running cortextos as a sandbox — even if you don't use it in anger — gives you a reference implementation. The npm publish model (`cortextos add-agent --template orchestrator`) also hints at a plugin/template pattern that might inform how you distribute iago-os to Sebas or other teams later.

**Risk I'd flag:** you adopt for learning but end up migrating real work into it. That's the slow trap. Box it: "this is a lab, not prod."

### Advisor 5 — Skeptical Pruner (do you need this at all?)

**Verdict: A (don't adopt), with a fallback to D.**

What actual, concrete work problem are you solving today? You already have:
- Overnight autonomous work via `autonomous-loops`
- Cross-session memory via MemPalace diary (auto-written by stop hook)
- Scheduled triggers via `CronCreate` / `/iago-schedule`
- Review pipeline via GitHub Actions
- Rich skill catalog

The Telegram pain is real, but how often this week have you actually been blocked because you couldn't approve something from your phone? If the honest answer is "sometimes, not often," then the ROI doesn't clear the adoption cost. Wait three months. See if the pain compounds. cortextos will be v0.3 by then with Windows support and fewer bugs. If the pain *doesn't* compound, you've saved yourself the platform tax.

**Risk I'd flag:** shiny-object syndrome. You're deep in Munet MVP, Agent Architecture v2 just shipped, markitdown MCP just shipped. Don't open a fifth front.

### Peer review

| Advisor | Strongest critique from peers |
|---|---|
| A1 (architect) | CEO: "You're ignoring that building a custom Telegram bridge still takes 2-3 days I don't have." Architect counter: "Still cheaper than 2-3 days + a $60/yr VPS + upstream churn." |
| A2 (CEO) | Pruner: "The assumption that phone-approval ROI is high is untested." CEO counter: "We already know from calendar data that Santiago is in meetings 40%+ of work hours; every phone-resolvable decision saves a context switch." |
| A3 (platform) | Researcher: "You're optimizing for uptime. Research-quality matters more for Santiago's work." Platform counter: "Uptime *is* research quality when the overnight run crashes at 3am and you find out at 9am." |
| A4 (researcher) | Architect: "The 'it's a lab' framing never holds. Lab becomes prod. You know this." Researcher concedes: "Fair. If you do this, hard-box it to non-client work — personal assistant tasks only." |
| A5 (pruner) | CEO: "By the time pain compounds, you're six months into a new workflow you could have had today." Pruner concedes: "Valid. Revised: if you adopt, do the minimum cost version (D), not full cortextos." |

### Synthesis

The council converges on **two viable paths**, ranked:

1. **Option D first (2-3 day investment).** Build a minimal Telegram bridge on iago-os primitives: approval UX + RemoteTrigger trigger + PR/plan notifications. This solves the *actual* CEO pain (phone control, approve-from-anywhere) without adopting a v0.1 project or paying a platform tax. You learn what you actually use from chat-first control. Three months from now you'll know whether cortextos's fuller feature set is worth the adopt cost.

2. **Escalate to Option C (VPS adopt) only if:** (a) D proves that chat-first operation moves your needle *and* (b) you start doing real multi-agent client work (peer-to-peer, not hub-and-spoke). At that point cortextos's file bus + experiment loop earn their keep.

Explicitly **not recommended**: Option B (WSL2 adopt). It inherits Windows edge cases, bus semantics assume POSIX rename, and your machine has to stay awake. Wrong deployment shape for your stack.

---

## Sources

- **cortextos repo** (github.com/grandamenium/cortextos) — README, CHANGELOG 0.1.0/0.1.1, install.mjs, package.json, open issues (#202, #204, etc.)
- **microsoft/node-pty** — ConPTY on Windows 1809+ (Windows 11 fully supported technically); WinPTY removed in current versions
- **iago-os local repo** — CLAUDE.md, available-skills.md, execution-pipeline.md, MEMORY.md (memory layers: Obsidian, MemPalace, Graphify, MarkItDown)
- **iago-os memory** — feedback/project memories on workflow pipeline, MemPalace wings, Obsidian auto-capture

---

## Recommendation

**Decision:** Start with **Option D** — build a minimal Telegram bridge on iago-os primitives. Do not adopt cortextos directly now.

**Confidence:** High.

**Reasoning:**
1. cortextos duplicates 60-90% of your existing stack (MemPalace, Obsidian, `.iago/plans/`, PR review loop). The net-new value is ~10-40%, concentrated in Telegram control and 24/7 PTY persistence.
2. Telegram-from-phone is implementable on your existing primitives (`RemoteTrigger`, `CronCreate`, `gh`, Obsidian MCP) in 2-3 days. This is the *actual* pain.
3. cortextos is v0.1.1 with 200+ open issues and explicit "Windows not supported." Adopting couples you to an unstable upstream for a feature you can build yourself.
4. 24/7 PTY persistence requires either a VPS ($5-10/mo ongoing) or leaving your machine awake (Windows sleep/wake will break things). Neither is justified until you've proved chat-first operation moves your needle.
5. You're already executing on Munet MVP + Agent Architecture v2 + markitdown. Opening a fifth front without clear ROI is the shiny-object trap.

**Next step (concrete):** Scope a `iago-bridge` feature:
- Telegram bot (single chat, Santiago only) posting: new PRs needing review, approvals needed, plans paused/blocked, stop-hook digest summaries
- Inbound commands: `/approve <pr>`, `/pause`, `/resume`, `/status`, `/trigger <skill> <args>`
- Runs via `CronCreate` + `RemoteTrigger` inside Claude Code — no new daemon
- Plan via `/iago-plan --feature "phone-native control for iago-os via Telegram"` after discussing scope with yourself

**Risk if wrong:**
- If chat-first operation turns out to be much more valuable than estimated, you'll be 3 days deep into your own bridge when you could have been in cortextos's dashboard already. Mitigation: if D doesn't feel right after 1 day of scoping, bail and do Option C (VPS adopt). Cheap pivot.
- If your work shifts toward multi-agent client deliverables (several peer agents coordinating), the file-bus pattern becomes load-bearing and D is insufficient. Mitigation: revisit in 3 months; Option C is still on the table, cortextos will be more mature then.

**I'd change this recommendation if:**
- You tell me you're about to build a multi-agent client product this quarter (file bus matters).
- You get a Linux box anyway for another reason (VPS for a demo, mini-PC for home) — then marginal cost of adopting cortextos drops enough that C becomes cheaper than D.
- cortextos ships Windows support + cuts its issue count below ~50 (signal of maturity).

---

# v2 — You already have the Linux box. And "Claude channels" is real.

**Date:** 2026-04-21 (same day, follow-up)
**New inputs from Santiago:**
- Has Hostinger VPS (Debian 13 KVM) + Tailscale mesh already running
- Already specified this stack in OpenClaw PRD (AWS control plane + VPS execution plane + Tailscale ACLs + Docker-per-client)
- Ready to kill OpenClaw-as-custom-runtime
- Asking: efficiency of overlapping primitives, "Claude channels", multi-session teams

The v1 recommendation (Option D, minimal Telegram bridge, don't adopt) collapses once we account for these. Rewriting the path below.

---

## 6. "Claude channels" — what's actually there

It's a real 2026 feature, shipped Feb with Opus 4.6. Formal name: **Claude Code Agent Teams**. "Channels" is the colloquial term the ecosystem uses for the mailbox layer inside it.

Concrete surface (from Claude Code docs):
- Enable: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `settings.json` or env
- Requires Claude Code **v2.1.32+**
- Architecture: **Team lead** session + N **teammates** (each a full independent Claude Code instance with its own context window, project `CLAUDE.md`, MCP servers, skills) + **shared task list** + **mailbox** (direct peer-to-peer messaging)
- Teammate addressing: named by the lead, any teammate can `SendMessage` to any other; `broadcast` available but expensive (scales linearly with team size)
- Task coordination: pending / in_progress / completed with dependencies; **file-locked claim** for race-free pickup; `~/.claude/teams/{team}/config.json` + `~/.claude/tasks/{team}/`
- Display: `in-process` (any terminal, Shift+Down to cycle) or `split-pane` (tmux or iTerm2 only — **not** Windows Terminal, VS Code terminal, Ghostty)
- Built-in hooks: `TeammateIdle`, `TaskCreated`, `TaskCompleted` — can shell out, call HTTP, run async. Push to Telegram, Obsidian, Redis from the hook.
- Subagent reuse: spawn a teammate using any existing subagent definition (project/user/plugin scope). The subagent's `tools`/`model` honored; `SendMessage` always available.
- **Known limitations**: one team per session; no `/resume` of in-process teammates; token cost scales linearly with N teammates; lead session is fixed for team lifetime; no nested teams.

**What this means**: the primary primitive cortextos duplicates — file-bus inter-agent messaging — is now a native Anthropic-maintained feature. The cost of running it is just Claude Code v2.1.32+ and a flag. No PM2, no `node-pty`, no `chokidar`, no atomic-rename carefulness.

---

## 7. OpenClaw (your own thing) — where it stands

From your PRD (`OpenClaw_PRD_Base_iaGO_v1`):
- Hybrid architecture: AWS control plane + **Hostinger VPS (Debian 13 KVM) + Tailscale mesh** execution plane + Docker container per client + SQLite+embeddings memory
- Custom runtime: PiEmbeddedRunner as harness, Claude Code as "execution backend"
- Custom Agent Communication Protocol (ACP) for intra-container subagents
- DynamoDB as inter-container message queue
- Roadmap plugins: `cost-router`, `eval-verify`, `learning-engine`, `agent-shield`, `swarm-coordinator`, `multi-agent-consensus`
- Version 1.0, dated 2026-03-25

**The split that matters**:

| OpenClaw layer | Status in 2026 |
|---|---|
| **Runtime** (PiEmbeddedRunner, custom session manager, custom skill engine) | **Redundant.** Claude Code + Agent Teams + hooks + subagents = what you were going to build. Anthropic shipped it in Feb. |
| **Custom ACP (Agent Communication Protocol)** | **Redundant.** Mailbox + shared task list in Agent Teams covers this natively, with file locking. |
| **AWS control plane** (API Gateway, Lambda router, DynamoDB task queue, Cognito, SES, S3, Secrets Manager) | **Keep.** Still needed for multi-tenant dashboard, secrets, billing, cost tracking, SLAs. |
| **VPS + Tailscale + Docker-per-client** | **Keep.** This is the deployment model. Agent Teams runs inside it fine. |
| **SQLite + embeddings memory layer** | **Reconsider.** You already have MemPalace (ChromaDB) + Obsidian + Graphify. Client-facing containers still need per-client vector storage — that's what this layer is for. Use `sqlite-vss` or `sqlite-vec` or pgvector on Postgres. |
| **Plugin roadmap** (cost-router, eval-verify, agent-shield, swarm-coordinator) | **Build as Claude Code plugins/hooks + subagents**, not as OpenClaw-specific. |
| **iaGO productized offering** (discovery process, pricing tiers, dashboard, SLAs, client workspaces) | **Keep and lean into.** This is your actual moat — process, packaging, trust. Not code. |

**Verdict: kill OpenClaw-the-runtime. Keep OpenClaw-the-service-offering. Productize stock Claude Code + Agent Teams with your control plane and multi-tenant containers.**

This matches what the comparison article concludes too: "OpenClaw requires 2-4 weeks of initial setup" for a custom runtime; Claude Code Channels is "medium complexity" and "strongest choice for software development automation." You'd be doing 4 weeks of work Anthropic already did.

---

## 8. Efficiency — which overlapping primitive actually wins

This is what you asked. Head-to-head on the primitives that duplicate:

| Function | cortextos impl | iago-os impl | Agent Teams impl | OpenClaw PRD impl | Winner |
|---|---|---|---|---|---|
| **Inter-agent messaging (live)** | File bus: `inbox/` → `inflight/` → `processed/` via atomic rename; ~5-50ms FS syscalls; POSIX assumptions | Hub-and-spoke (Task tool, no peer-to-peer) | Mailbox `SendMessage` + broadcast; in-memory during session; file-locked task claim | Custom ACP over shared container FS | **Agent Teams.** Native, faster than file bus, no rename-semantics risk, file-locked to avoid races, debuggable via `Shift+Down`. |
| **Inter-agent messaging (durable across restart)** | File bus survives crashes; 5-min redeliver for un-ACK'd | N/A | Lost when lead session dies | DynamoDB queue | **File bus OR durable queue (DynamoDB/Redis/Postgres LISTEN/NOTIFY).** Agent Teams mailbox is session-lifetime only — this is the real gap. |
| **Task store** | 17-field JSON per task, stale detection, auto-archive | `.iago/plans/` markdown, `TaskCreate` tool in-session | `~/.claude/tasks/{team}/` pending/in_progress/completed + deps + file locks | DynamoDB per tenant | **Agent Teams for in-team work + Postgres/DynamoDB for cross-team durability.** Two stores with clear separation. |
| **Knowledge base** | mmrag (ChromaDB subprocess, collection per agent/org) | MemPalace (ChromaDB) + Obsidian + Graphify | Falls back to project CLAUDE.md + MCP | SQLite+vss/pgvector per container | **MemPalace + Obsidian for personal; pgvector per client-container for productized.** Don't run mmrag AND MemPalace — same engine, two dirs, guaranteed drift. |
| **24/7 persistence** | PM2 + `node-pty` auto-restart; 71h context rotation handled | `autonomous-loops` (session must be open) | tmux/systemd hold the lead session; teammates die when lead dies | Docker `restart: always` + heartbeat | **tmux + systemd + Docker restart on VPS.** Claude Code Routines (managed) is the cloud alternative; tmux is the self-hosted standard per the 2026 VPS pattern. |
| **Phone/remote control** | Native Telegram bot (BotFather) | None (CronCreate + RemoteTrigger only) | None native — hooks + ~300 LOC | Slack/WhatsApp/Email/Discord/Teams "native adapters" (PRD only, not built) | **Small Telegram bot hitting hooks + tmux SSH via Tailscale.** The MindStudio/DanubeData articles describe exactly this setup. |
| **Approval gate** | `pending/` → `resolved/` via Telegram | PR review loop (`claude.yml` + `claude-review-fix.yml`) | `TaskCompleted` hook + HTTP endpoint | Configured per-client | **Your PR review loop for code; hook-based Telegram approval for ops.** Two lanes, different primitives. |
| **Multi-machine** | Single-machine-ish (bus assumes local FS) | Single-machine | Single-machine (one lead, teammates on same box) | Multi-machine via Tailscale + DynamoDB | **Tailscale mesh + shared Postgres/Redis + DynamoDB for queue.** Your OpenClaw PRD already nailed this shape. |
| **Debuggability** | `ls` on inbox dirs; dashboard (Next.js) | Session logs + STATE.md + summaries | `Shift+Down` cycle, split-pane tmux view, native hooks | Dashboard + CloudWatch | **Agent Teams split-pane (tmux on VPS).** Watching 5 teammates in 5 panes live is unmatched for research tasks. |
| **Setup time on your stack** | 1-2 days WSL2 or 2-3 days VPS | already built | Flip one env var + ~200 LOC of hooks | 2-4 weeks (per comparison article) | **Agent Teams by miles.** |

**Single-line verdicts for the overlap**:

- Live inter-agent messaging: **Agent Teams mailbox beats file bus.**
- Durable queue across restarts: **Postgres/Redis/DynamoDB beat file bus** (file bus is local-FS only, doesn't survive container recreate cleanly).
- Task state within a burst: **Agent Teams task list.**
- Task state for ops/cron/long-running: **Postgres or DynamoDB.**
- KB: **pick one engine. MemPalace for personal, pgvector for client-containers. Not mmrag.**
- 24/7 runtime: **tmux + systemd on VPS (stock Claude Code), not PM2 + `node-pty`.** The native PTY on Linux is fine; `node-pty` is only needed when you want to wrap/observe PTY output, which Claude Code itself already does.
- Phone control: **thin Telegram bot hitting hooks; skip cortextos's Telegram bot because adopting it drags the whole stack.**

---

## 9. BRAINSTORMING v2 — architectures for "a team of agents" given your actual infra

You have Hostinger VPS + Tailscale. You already specified the shape in the OpenClaw PRD. The design question isn't "should I build this" — it's **"which runtime lives inside the containers"**.

### Q1: What are the real modes you need?

Distinct work modes that drive different architectures:

1. **Focused dev work** (Munet, iago-os, client features) — linear, plan → impl → review → PR. Already works great via iago-os pipeline. Hub-and-spoke. Don't break it.
2. **Research / investigation bursts** — parallel lenses, debate, challenge. Best fit = Agent Teams. Spawn 3-5 teammates, let them argue.
3. **24/7 background ops** — morning inbox check, overnight experiments, scheduled reports, client-facing agents responding to webhooks. Needs persistence across reboots, no session dependency.
4. **Phone-driven interventions** — approve, pause, trigger. Telegram → hook → routed to the right runtime.
5. **Client-facing productized agents** (OpenClaw commercial offering) — multi-tenant, isolated containers, per-client billing and audit.

One runtime shape cannot do all five well. The architecture must route by mode.

### Q2: Runtime options per mode

| Mode | Runtime | Why |
|---|---|---|
| Focused dev work | iago-os `scripts/execute-pipeline.sh` (unchanged) on laptop or VPS | Already optimized for this, code review loop built in |
| Research bursts | Agent Teams (flag on, Shift+Down) | Native mailbox + split-pane debate |
| 24/7 background ops | Headless `claude -p` via tmux + systemd timers + Postgres task queue | No session dependency, survives reboot |
| Phone interventions | Telegram bot → Redis/HTTP → hook into any of above | One control surface, routes to runtime |
| Client containers | Docker-per-client on VPS + per-container Claude Code + Agent Teams inside when needed | OpenClaw PRD shape, stock runtime |

### Q3: Storage layer — what goes where

| Data | Store | Why |
|---|---|---|
| Session tasks (within a team burst) | Agent Teams task list (`~/.claude/tasks/`) | Native, file-locked, good enough |
| Durable task queue (cross-restart, cross-machine) | **Postgres with LISTEN/NOTIFY on VPS** (or DynamoDB if staying AWS-heavy) | Single source of truth, survives anything |
| Client vector memory | pgvector in same Postgres | One DB, one backup strategy |
| Your personal memory | MemPalace (ChromaDB) + Obsidian + Graphify (unchanged) | Already good |
| Telegram chat log | Redis + periodic dump to Obsidian | Hot path fast, cold path searchable |
| Analytics/event stream | Postgres append-only table (replaces cortextos JSONL) | Queryable |
| Secrets | AWS Secrets Manager (per OpenClaw PRD) | Already specified, auditable |

One Postgres instance on the VPS = durable queue + pgvector + event log + task store. Tailscale-accessible from laptop and all containers.

### Q4: Where does each piece run?

| Piece | Where |
|---|---|
| Your dev Claude Code (focused work) | Laptop (Windows), worktrees per session as today |
| Long-running Claude Code (ops, research, client) | VPS, one tmux socket per workstream, systemd unit per daemon |
| Postgres | VPS, single instance (small, ~512MB, fine) |
| Telegram bot | VPS, Python/Node, ~500 LOC, systemd |
| Agent Teams team lead (research bursts) | VPS inside tmux, you SSH in via Tailscale/Termius from iPhone or laptop |
| Client containers (OpenClaw productized) | VPS, Docker-per-client, Tailscale ACLs per container |
| AWS control plane | As per OpenClaw PRD (Amplify dashboard + Lambda routers + DynamoDB per-tenant task queue) |

### Q5: Five concrete options, ranked

| Option | What | Setup | Monthly | Net |
|---|---|---|---|---|
| **A — Kill OpenClaw-runtime, stock Claude Code + Agent Teams on VPS, Postgres queue, thin Telegram bot** | The "don't build what Anthropic shipped" path | 3-5 days | $5-10 (Hostinger you have) | Maximum leverage, minimum custom code, maximum alignment with upstream |
| **B — Finish OpenClaw-runtime as originally specified** | Build PiEmbeddedRunner + ACP + custom skill engine | 2-4 weeks | same | You own the stack but duplicate Anthropic's work, carry upstream drift forever |
| **C — Adopt cortextos on VPS** | Use their code as the daemon layer | 1-2 days setup | same | Save a few days building PM2+daemon, but inherit 200+ issues + overlap with your stack |
| **D — Hybrid: Agent Teams for multi-agent + keep your iago-os pipeline for dev work + cortextos only for Telegram** | Adopt cortextos's Telegram bridge only, extract it, leave rest | 3-4 days | same | Gets Telegram fast, still carries cortextos dep for one feature |
| **E — Anthropic Managed Agents** | Fully hosted | hours | per-use premium | Fastest but vendor-locked, no data residency, defeats your OpenClaw value prop |

---

## 10. COUNCIL v2 — given the new context

### Advisor 1 — Systems Architect

**Verdict: A.**

You specified the architecture months ago in the OpenClaw PRD. You had the right instinct: AWS control plane + VPS execution plane + Tailscale + Docker-per-client. The only thing that changed is that Anthropic shipped the runtime piece you were going to build. Accept the gift. Replace `PiEmbeddedRunner` → stock `claude` CLI. Replace custom ACP → Agent Teams mailbox. Keep everything else from the PRD. The comparison article literally calls out the choice: Claude Code Channels is "the strongest choice for software development automation — particularly in headless and CI/CD configurations." That's you.

**Critique I'd invite:** some of your PRD-specified plugins (cost-router, eval-verify, agent-shield) don't have direct stock equivalents. You'll still build those, but as Claude Code plugins/hooks, not as OpenClaw runtime pieces.

### Advisor 2 — CEO / Operator

**Verdict: A, and I'd start with the personal-use slice this week.**

The client-facing productized layer can wait until you have a signed client. For personal use on Munet + iago-os work: 3-5 days to stand up VPS with stock Claude Code + tmux + Postgres + Telegram bot gets you phone control, 24/7 ops, and research bursts. That's a step-change in leverage. Then every client deal you close slots into the same infra. No wasted work.

**Critique I'd invite:** don't over-engineer the productized layer upfront. Defer Docker-per-client until client #1 signs. Today, single-tenant you is the only tenant.

### Advisor 3 — Platform Engineer

**Verdict: A with caveats.**

The 2026 VPS pattern (VPS + Tailscale + tmux + headless Claude Code + mobile SSH client like Termius) is documented, battle-tested, and exactly your stack. `tmux` + `systemd` is boring and right. Postgres for durable queue + pgvector is boring and right. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is one line. The only real engineering is (1) Telegram bot, (2) hook wiring, (3) Postgres schema for the queue.

**Critique I'd invite:** Agent Teams limitations bite. "No `/resume` of in-process teammates" means if you kill the tmux session, your teammates are gone. Your durable state needs to live outside the team — Postgres queue + Obsidian digest — so you can respawn teammates cleanly. Design around this from day one.

### Advisor 4 — AI Agent Researcher

**Verdict: A, and you'll learn faster with Agent Teams than with cortextos.**

Agent Teams' peer-to-peer debate mode is genuinely novel. The "5 teammates investigate competing hypotheses and try to disprove each other" prompt in the docs is exactly the kind of ensemble reasoning that moves the frontier right now. cortextos doesn't have this — its agents are assigned work, not asked to argue. If you care about the research quality (not just the ops convenience), Agent Teams is the substrate that matters. Everything else — Telegram, persistence, task queue — is plumbing.

**Critique I'd invite:** token cost is linear. Don't use Agent Teams for routine ops; use headless `claude -p` for those. Reserve Agent Teams for high-value bursts.

### Advisor 5 — Skeptical Pruner

**Verdict: A, but enforce discipline on "iago-os stays iago-os."**

You have a working system. `scripts/execute-pipeline.sh` is your delivery moat. Don't rewrite it to run on Agent Teams. Keep the pipeline exactly as-is for dev work. Add Agent Teams as a second mode — accessed via a new skill like `/iago-team "investigate X"` — that opens a team on the VPS and streams progress via Telegram hooks. Keep the two modes separate. Do not mix.

**Critique I'd invite:** the temptation will be to merge. Resist. Two lanes.

### Peer review

| Advisor | Sharpest pushback |
|---|---|
| A1 → A2 | "Deferring client containers means you lose the marketing story of the productized offering." → A2 counter: "The story is 'we run it for you on our infra.' Whether container-per-client exists today or at client #1 signing is irrelevant to the pitch." |
| A2 → A3 | "Postgres is overkill for solo use." → A3 counter: "Postgres is a 20-min install, and the day you onboard a client you already have the queue. No rebuild." |
| A3 → A4 | "You're optimistic about Agent Teams maturity." → A4 counter: "Experimental flag, yes. But Anthropic-maintained. Upstream fixes come to you. Self-built = you're the one fixing." |
| A4 → A5 | "Keeping pipelines separate costs you unification." → A5 counter: "Unification is a vanity metric. Separate pipelines work today. Don't pay integration tax for aesthetics." |
| A5 → A1 | "You're assuming OpenClaw runtime was all going to be wasted." → A1 concedes: "Not wasted — you learned the shape. The PRD is the architecture doc for the stock-Claude-Code build. That's the ROI." |

### Synthesis

Unanimous on **Option A**: kill OpenClaw-the-runtime, keep OpenClaw-the-service-shape, deploy stock Claude Code + Agent Teams + Postgres + thin Telegram bridge on your Hostinger VPS, keep iago-os pipeline unchanged for dev work, add Agent Teams as a second mode for research bursts and client-facing agents.

---

## 11. Path — concrete phased plan

**Phase 0 — Validate (half day):**
- SSH into VPS via Tailscale from laptop + from iPhone (Termius) — confirm both paths work
- Install Claude Code v2.1.32+ on VPS; run `claude --version`
- Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; spawn a trivial 3-teammate research team to confirm Agent Teams boots on this Linux
- Confirm tmux split-pane view works (it does on Linux; this is your main debug surface)

**Phase 1 — Foundation (2-3 days):**
- `apt install tmux postgresql redis` on VPS
- Create Postgres schema: `tasks`, `task_deps`, `events`, `approvals` (4 tables, mirrors OpenClaw PRD)
- Install `pgvector` extension (for later per-client memory)
- Write `systemd` unit that starts a long-running tmux session named `iago-ops` on boot
- Create `~/.claude/settings.json` with `TaskCompleted`, `TeammateIdle`, `TaskCreated` hooks pointing to small scripts in `/opt/iago-bridge/hooks/`
- Port `MEMORY.md`, `CLAUDE.md`, `.claude/skills` to VPS home via rsync (or git clone iago-os)

**Phase 2 — Telegram bridge (1-2 days):**
- Python or Node bot (~300-500 LOC), single chat (you), systemd service
- Inbound commands: `/status`, `/approve <id>`, `/trigger <skill> <args>`, `/team <task>`, `/pause`, `/resume`
- Outbound: subscribe to Postgres `NOTIFY` channels for `task_completed`, `approval_needed`, `teammate_idle`; forward to you
- Hooks push to Postgres which bot reads via LISTEN/NOTIFY — keeps bot dumb, centralizes state
- SSH-over-Tailscale fallback: `/ssh` returns the tmux attach command for when you need full terminal

**Phase 3 — iago-os integration (1-2 days):**
- New skill `/iago-team "description"` on laptop that: picks up existing plan or creates lightweight spec, SSHs to VPS, writes spawn prompt, triggers team on VPS, streams progress to your terminal *and* Telegram
- New skill `/iago-remote {skill} {args}` that wraps RemoteTrigger to hit the VPS's tmux socket instead of laptop
- `scripts/execute-pipeline.sh` stays unchanged — still runs on laptop for dev work

**Phase 4 — Productization primitives (defer until client #1):**
- Docker-per-client wrapper (OpenClaw PRD section 2.3)
- Per-container Tailscale ACLs
- AWS control plane (dashboard + Lambda router + DynamoDB) for external-facing surface
- Per-client `cost-router`, `eval-verify`, `agent-shield` as Claude Code plugins, not custom runtime

Total Phase 0-3: **5-7 working days.** Phase 4 waits for revenue.

---

## Recommendation v2

**Decision:** **Option A** — kill OpenClaw-as-runtime, keep OpenClaw-as-service-offering, deploy stock Claude Code + Agent Teams + Postgres + thin Telegram bridge on your Hostinger VPS. Two lanes: iago-os pipeline (unchanged) for dev work on laptop, Agent Teams on VPS for research bursts and 24/7 ops.

**Confidence:** Very high.

**Reasoning:**
1. Agent Teams is a native Anthropic primitive that covers ~80% of what cortextos and OpenClaw-the-runtime were both trying to build. Shipping your own runtime now is negative ROI.
2. Your Hostinger + Tailscale stack is exactly the 2026 VPS pattern that's now documented. You're not pioneering infra — you're landing on a consensus shape.
3. Your OpenClaw PRD is not wasted — it becomes the architecture doc for this implementation, minus the custom runtime, plus pgvector/Postgres as the durable layer.
4. Efficiency: Agent Teams mailbox beats cortextos file-bus for live messaging; Postgres queue beats file bus for durable cross-restart state; tmux + systemd beats PM2 + `node-pty` for persistence on Linux. No primitive in cortextos wins against the native + Postgres combo.
5. iago-os's pipeline is unchanged — it's your delivery moat. Agent Teams adds a second mode without touching the first.
6. Phase 0-3 is 5-7 days of setup. Phase 4 (productized client containers) defers until you need it.

**Next step:** Phase 0 today — 30-min validation that Agent Teams runs on your VPS and you can `Shift+Down` into teammates from a Termius SSH on iPhone. If yes, green-light Phase 1. If Agent Teams boot fails on Debian 13, surface that and pivot to headless `claude -p` + custom mailbox (which is still strictly better than cortextos or custom OpenClaw).

**Risk if wrong:**
- Agent Teams is experimental and may break in ways that stall you mid-build. Mitigation: Postgres queue is the durable substrate; you can always fall back to headless `claude -p` per-workstream and custom mailbox over Postgres LISTEN/NOTIFY, which is what the 2026 production-pattern articles recommend anyway.
- Token cost of Agent Teams may be higher than expected. Mitigation: reserve teams for high-value research bursts; use single headless sessions for routine ops.
- You stop using this setup after a month. Mitigation: Phase 0-3 is 5-7 days. Low sunk cost. VPS stays useful for client containers either way.

**I'd change this if:**
- Agent Teams proves unusable on Debian 13 KVM — unlikely, but Phase 0 catches this.
- You want multi-machine teammates (different VPS nodes). Agent Teams is single-machine for now; multi-machine would require your own mailbox-over-network. Add pgvector+NOTIFY and keep teams bounded to one node.

## Sources (v2)

- [Claude Code Agent Teams docs](https://code.claude.com/docs/en/agent-teams)
- [Claude Code hooks docs](https://code.claude.com/docs/en/hooks) — TeammateIdle/TaskCreated/TaskCompleted
- [Claude Code on a VPS: The Complete Setup (Medium, Mar 2026)](https://medium.com/@0xmega/claude-code-on-a-vps-the-complete-setup-security-tmux-mobile-access-2d214f5a0b3b)
- [Claude Code Routines: 24/7 AI Agents (MindStudio)](https://www.mindstudio.ai/blog/claude-code-routines-24-7-agents)
- [Claude Code Channels on a VPS — Telegram and Discord (DanubeData, 2026)](https://danubedata.ro/blog/claude-code-channels-vps-telegram-discord-2026)
- [rohitg00/tailclaude](https://github.com/rohitg00/tailclaude) — Claude Code on Tailscale tailnet
- [OpenClaw vs Claude Code Channels vs Managed Agents (MindStudio, 2026)](https://www.mindstudio.ai/blog/openclaw-vs-claude-code-channels-vs-managed-agents-2026)
- [Claude Code Q1 2026 Update Roundup (MindStudio)](https://www.mindstudio.ai/blog/claude-code-q1-2026-update-roundup-2)
- [Shipyard — Multi-agent orchestration for Claude Code (2026)](https://shipyard.build/blog/claude-code-multi-agent/)
- **Santiago's own:** `OpenClaw_PRD_Base_iaGO_v1` (Obsidian vault, graphify-out/converted/) — AWS + VPS + Tailscale + Docker-per-client architecture, SQLite+embeddings memory, plugin roadmap
- **MemPalace:** Agent 3 research report on OpenClaw / NemoClaw / Claude Code native architecture (wing: santiago, room: architecture)
